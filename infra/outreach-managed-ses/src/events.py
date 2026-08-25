"""Privacy-reduced SES event settlement and signed Pentra delivery."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from adapter import (
    ADAPTER_VERSION,
    RFC_MESSAGE_ID_CANARY_OPERATION_KEY,
    RFC_MESSAGE_ID_CANARY_RECIPIENT_SHA256,
    RFC_MESSAGE_ID_SUFFIX,
    TABLE_NAME,
    _client,
    _error_code,
    _get,
    _load_secrets,
    _mark_disposed_send_event_confirmed,
    _mark_send_terminal,
    _provider_thread_identity,
    _quarantine_send_integrity,
    _rfc_canary_marker_key,
    _rfc_message_id_canary_is_verified,
    _send_key,
)
from common import (
    AdapterInputError,
    AdapterRetryableError,
    TERMINAL_DELIVERY_EVENT_TYPES,
    derive_rfc_canary_receipt,
    deterministic_json,
    metric,
    normalize_event_envelope,
    require_opaque_key,
    sha256_hex,
    sign_request,
    verify_response_signature,
)

PENTRA_WEBHOOK_URL = os.environ.get("PENTRA_WEBHOOK_URL", "")
MAX_WEBHOOK_ACK_BYTES = 4 * 1024
SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS = 2 * 60
TERMINAL_DELIVERY_EVENTS = TERMINAL_DELIVERY_EVENT_TYPES


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


_OPENER = urllib.request.build_opener(_NoRedirect())


def _event_key(event_key_digest: str) -> str:
    return f"event#{event_key_digest}"


def _begin_event(envelope: dict[str, str], now: int) -> dict[str, Any]:
    event_key = _event_key(envelope["eventKeyDigest"])
    item = {
        "pk": {"S": event_key},
        "kind": {"S": "event"},
        "state": {"S": "pending"},
        "operationKey": {"S": envelope["operationKey"]},
        "eventType": {"S": envelope["eventType"]},
        "eventTime": {"S": envelope["eventTime"]},
        "messageIdDigest": {"S": envelope["messageIdDigest"]},
        "rfcMessageIdDigest": {"S": envelope["rfcMessageIdDigest"]},
        "createdAt": {"N": str(now)},
        "updatedAt": {"N": str(now)},
    }
    try:
        _client("dynamodb").put_item(
            TableName=TABLE_NAME,
            Item=item,
            ConditionExpression="attribute_not_exists(pk)",
        )
    except Exception as exc:
        if _error_code(exc) != "ConditionalCheckFailedException":
            raise AdapterRetryableError("event_store_unavailable") from exc
        existing = _get(event_key)
        if not existing:
            raise AdapterRetryableError("event_store_unavailable") from exc
        for field in (
            "operationKey",
            "eventType",
            "messageIdDigest",
            "rfcMessageIdDigest",
        ):
            if existing.get(field) != envelope[
                "messageIdDigest" if field == "messageIdDigest" else field
            ]:
                raise AdapterInputError("event_binding_conflict") from exc
        return existing
    existing = _get(event_key)
    if not existing:
        raise AdapterRetryableError("event_store_unavailable")
    return existing


def _settle_ambiguous_send(
    envelope: dict[str, str],
    send: dict[str, Any],
    secrets: dict[str, str],
    now: int,
) -> dict[str, Any]:
    resource_operation_key = send.get("resourceOperationKey")
    generation = send.get("generation")
    recipient_binding = send.get("recipientBinding")
    sequence_step = send.get("sequenceStep")
    if (
        not isinstance(resource_operation_key, str)
        or not isinstance(generation, int)
        or not isinstance(recipient_binding, str)
        or not isinstance(sequence_step, int)
    ):
        raise AdapterInputError("send_receipt_invalid")
    (
        event_message_id_digest,
        event_rfc_message_id_digest,
        event_rfc_message_id_ciphertext,
        event_thread_receipt,
    ) = _provider_thread_identity(
        envelope["messageId"],
        rfc_message_id=envelope["rfcMessageId"],
        operation_key=envelope["operationKey"],
        resource_operation_key=resource_operation_key,
        generation=generation,
        recipient_binding=recipient_binding,
        sequence_step=sequence_step,
        secrets=secrets,
    )
    if event_message_id_digest != envelope["messageIdDigest"]:
        raise AdapterInputError("event_binding_conflict")
    settled_view = {
        **send,
        "providerMessageIdDigest": event_message_id_digest,
        "rfcMessageIdDigest": event_rfc_message_id_digest,
        "threadReceipt": event_thread_receipt,
    }
    terminal_delivery: dict[str, str] | None = None
    if envelope.get("eventType") in TERMINAL_DELIVERY_EVENTS:
        terminal_delivery = {
            "eventType": envelope["eventType"],
            "occurredAt": envelope["eventTime"],
            "eventKeyDigest": envelope["eventKeyDigest"],
            "eventReceipt": _derive_event_receipt(envelope, settled_view),
        }
    if send.get("state") == "external_attempted":
        attempted_at = send.get("createdAt")
        if not isinstance(attempted_at, int):
            raise AdapterInputError("send_receipt_invalid")
        eligible_at = attempted_at + SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS
        if now < eligible_at:
            # Give the synchronous SendEmail response path time to seal its
            # exact message-ID digest. A mismatched provider event must not win
            # that race and be delivered to Pentra as an accepted receipt.
            raise AdapterRetryableError(
                "provider_receipt_settlement_wait", eligible_at - now
            )
        return _mark_send_terminal(
            envelope["operationKey"],
            resource_operation_key,
            generation,
            "event_confirmed",
            now,
            provider_message_id_digest=event_message_id_digest,
            rfc_message_id_digest=event_rfc_message_id_digest,
            rfc_message_id_ciphertext=event_rfc_message_id_ciphertext,
            thread_receipt=event_thread_receipt,
            terminal_delivery=terminal_delivery,
        )
    if send.get("state") == "quarantined_no_replay":
        return _mark_disposed_send_event_confirmed(
            envelope["operationKey"],
            event_message_id_digest,
            event_rfc_message_id_digest,
            event_rfc_message_id_ciphertext,
            event_thread_receipt,
            now,
            terminal_delivery=terminal_delivery,
        )
    expected_digest = send.get("providerMessageIdDigest")
    expected_rfc_digest = send.get("rfcMessageIdDigest")
    expected_thread_receipt = send.get("threadReceipt")
    if (
        expected_digest != envelope["messageIdDigest"]
        or expected_rfc_digest != envelope["rfcMessageIdDigest"]
        or expected_thread_receipt != event_thread_receipt
    ):
        if isinstance(expected_digest, str):
            _quarantine_send_integrity(envelope["operationKey"], now)
        raise AdapterInputError("provider_receipt_mismatch")
    if send.get("state") not in {
        "submitted",
        "event_confirmed",
        "event_confirmed_after_disposition",
    }:
        raise AdapterInputError("send_receipt_invalid")
    return send


def _webhook_payload(
    envelope: dict[str, str], send: dict[str, Any], event_receipt: str
) -> bytes:
    return deterministic_json(
        {
            "version": 1,
            "adapterVersion": send["adapterVersion"],
            "operationKey": envelope["operationKey"],
            "resourceOperationKey": send["resourceOperationKey"],
            "generation": send["generation"],
            "eventType": envelope["eventType"],
            "occurredAt": envelope["eventTime"],
            "sequenceStep": send["sequenceStep"],
            "purpose": send["purpose"],
            "providerMessageIdDigest": send["providerMessageIdDigest"],
            "rfcMessageIdDigest": send["rfcMessageIdDigest"],
            "threadReceipt": send["threadReceipt"],
            "eventReceipt": event_receipt,
        }
    )


def _mark_terminal_delivery_event(
    envelope: dict[str, str],
    send: dict[str, Any],
    event_receipt: str,
    now: int,
) -> dict[str, Any]:
    if envelope["eventType"] not in TERMINAL_DELIVERY_EVENTS:
        return send
    try:
        _client("dynamodb").update_item(
            TableName=TABLE_NAME,
            Key={"pk": {"S": _send_key(envelope["operationKey"])}},
            UpdateExpression=(
                "SET terminalDeliveryEvent=:eventType, "
                "terminalDeliveryEventAt=:eventTime, "
                "terminalDeliveryEventKeyDigest=:eventKey, "
                "terminalDeliveryEventReceipt=:eventReceipt, updatedAt=:now"
            ),
            ConditionExpression=(
                "attribute_not_exists(terminalDeliveryEvent) AND "
                "providerMessageIdDigest=:providerDigest AND "
                "rfcMessageIdDigest=:rfcDigest AND "
                "(#state=:submitted OR #state=:confirmed "
                "OR #state=:disposedConfirmed)"
            ),
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":eventType": {"S": envelope["eventType"]},
                ":eventTime": {"S": envelope["eventTime"]},
                ":eventKey": {"S": envelope["eventKeyDigest"]},
                ":eventReceipt": {"S": event_receipt},
                ":now": {"N": str(now)},
                ":providerDigest": {"S": envelope["messageIdDigest"]},
                ":rfcDigest": {"S": envelope["rfcMessageIdDigest"]},
                ":submitted": {"S": "submitted"},
                ":confirmed": {"S": "event_confirmed"},
                ":disposedConfirmed": {
                    "S": "event_confirmed_after_disposition"
                },
            },
        )
    except Exception as exc:
        current = _get(_send_key(envelope["operationKey"]))
        if current and isinstance(current.get("terminalDeliveryEvent"), str):
            return current
        raise AdapterRetryableError("event_settlement_unavailable") from exc
    current = _get(_send_key(envelope["operationKey"]))
    if not current:
        raise AdapterRetryableError("event_settlement_unavailable")
    return current


def _derive_event_receipt(
    envelope: dict[str, str], send: dict[str, Any]
) -> str:
    return sha256_hex(
        "|".join(
            [
                "v1",
                send["adapterVersion"],
                envelope["operationKey"],
                send["resourceOperationKey"],
                str(send["generation"]),
                envelope["eventType"],
                envelope["eventTime"],
                envelope["messageIdDigest"],
                envelope["rfcMessageIdDigest"],
                str(send["sequenceStep"]),
                send["purpose"],
                send["threadReceipt"],
                envelope["eventKeyDigest"],
            ]
        )
    )


def _record_rfc_canary_marker(
    envelope: dict[str, str],
    send: dict[str, Any],
    secrets: dict[str, str],
    now: int,
    *,
    common_header_present: bool,
) -> None:
    """Activate derivation only from the exact delivered common-header proof."""
    if (
        envelope.get("eventType") != "delivered"
        or not common_header_present
        or envelope.get("operationKey")
        != RFC_MESSAGE_ID_CANARY_OPERATION_KEY
        or send.get("purpose") != "rfc_message_id_canary"
        or send.get("adapterVersion") != ADAPTER_VERSION
        or send.get("sequenceStep") != 0
        or send.get("parentOperationKey") is not None
        or send.get("canaryRecipientSha256")
        != RFC_MESSAGE_ID_CANARY_RECIPIENT_SHA256
    ):
        raise AdapterInputError("rfc_canary_event_invalid")
    receipt = derive_rfc_canary_receipt(
        secrets.get("resourceKey", ""),
        adapter_version=ADAPTER_VERSION,
        operation_key=RFC_MESSAGE_ID_CANARY_OPERATION_KEY,
        recipient_sha256=RFC_MESSAGE_ID_CANARY_RECIPIENT_SHA256,
        rfc_message_id_suffix=RFC_MESSAGE_ID_SUFFIX,
        provider_message_id_digest=envelope["messageIdDigest"],
        rfc_message_id_digest=envelope["rfcMessageIdDigest"],
        thread_receipt=send["threadReceipt"],
        event_key_digest=envelope["eventKeyDigest"],
    )
    marker = {
        "pk": {"S": _rfc_canary_marker_key()},
        "kind": {"S": "rfc_message_id_canary"},
        "state": {"S": "verified"},
        "adapterVersion": {"S": ADAPTER_VERSION},
        "operationKey": {"S": RFC_MESSAGE_ID_CANARY_OPERATION_KEY},
        "recipientSha256": {"S": RFC_MESSAGE_ID_CANARY_RECIPIENT_SHA256},
        "rfcMessageIdSuffix": {"S": RFC_MESSAGE_ID_SUFFIX},
        "providerMessageIdDigest": {"S": envelope["messageIdDigest"]},
        "rfcMessageIdDigest": {"S": envelope["rfcMessageIdDigest"]},
        "threadReceipt": {"S": send["threadReceipt"]},
        "eventKeyDigest": {"S": envelope["eventKeyDigest"]},
        "verifiedAt": {"N": str(now)},
        "canaryReceipt": {"S": receipt},
    }
    try:
        _client("dynamodb").put_item(
            TableName=TABLE_NAME,
            Item=marker,
            ConditionExpression="attribute_not_exists(pk)",
        )
    except Exception as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            if _rfc_message_id_canary_is_verified(secrets):
                return
            _quarantine_send_integrity(envelope["operationKey"], now)
            raise AdapterInputError("rfc_canary_marker_conflict") from exc
        raise AdapterRetryableError("rfc_canary_marker_unavailable") from exc


def _post_event(
    body: bytes,
    secrets: dict[str, str],
    event_key_digest: str,
    event_receipt: str,
) -> tuple[int, int | None]:
    parsed = urlsplit(PENTRA_WEBHOOK_URL)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise AdapterInputError("webhook_configuration_invalid")
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    timestamp = str(int(time.time()))
    signing_key = secrets[secrets["signWith"]]
    signature = sign_request(
        signing_key,
        "POST",
        path,
        timestamp,
        event_key_digest,
        body,
    )
    request = urllib.request.Request(
        PENTRA_WEBHOOK_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "Pentra-Managed-SES/1",
            "X-Pentra-Timestamp": timestamp,
            "X-Pentra-Nonce": event_key_digest,
            "X-Pentra-Signature": signature,
            "X-Pentra-Adapter-Version": ADAPTER_VERSION,
        },
    )
    try:
        with _OPENER.open(request, timeout=10) as response:
            status = int(response.status)
            if 200 <= status < 300:
                ack_body = response.read(MAX_WEBHOOK_ACK_BYTES + 1)
                if len(ack_body) > MAX_WEBHOOK_ACK_BYTES:
                    raise AdapterRetryableError("webhook_ack_invalid")
                try:
                    verify_response_signature(
                        response.headers,
                        request_nonce=event_key_digest,
                        body=ack_body,
                        secrets=secrets,
                    )
                    acknowledgement = json.loads(ack_body)
                except (AdapterInputError, json.JSONDecodeError) as exc:
                    raise AdapterRetryableError("webhook_ack_invalid") from exc
                if acknowledgement != {
                    "version": 1,
                    "ok": True,
                    "eventReceipt": event_receipt,
                }:
                    raise AdapterRetryableError("webhook_ack_invalid")
            return status, None
    except urllib.error.HTTPError as exc:
        retry_after = exc.headers.get("Retry-After") if exc.headers else None
        try:
            delay = int(retry_after) if retry_after is not None else None
        except ValueError:
            delay = None
        return int(exc.code), delay
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        raise AdapterRetryableError("webhook_unavailable") from exc


def _mark_event(event_key_digest: str, state: str, now: int) -> None:
    _client("dynamodb").update_item(
        TableName=TABLE_NAME,
        Key={"pk": {"S": _event_key(event_key_digest)}},
        UpdateExpression="SET #state=:state, updatedAt=:now",
        ConditionExpression="#state=:pending OR #state=:state",
        ExpressionAttributeNames={"#state": "state"},
        ExpressionAttributeValues={
            ":pending": {"S": "pending"},
            ":state": {"S": state},
            ":now": {"N": str(now)},
        },
    )


def process_envelope(value: Any, *, now: int | None = None) -> None:
    clock = int(time.time()) if now is None else int(now)
    secrets = _load_secrets()
    rfc_canary_verified = _rfc_message_id_canary_is_verified(secrets)
    common_header_present = isinstance(
        value.get("rfcMessageId") if isinstance(value, dict) else None, str
    )
    try:
        envelope = normalize_event_envelope(
            value,
            rfc_message_id_suffix=RFC_MESSAGE_ID_SUFFIX,
            allow_derived_rfc_message_id=rfc_canary_verified,
        )
    except AdapterInputError as exc:
        # The EventBridge-only queue has already reduced the attempt tag to one
        # opaque operation. If SES's provider ID and common RFC header disagree,
        # quarantine an identity-established send instead of leaving it usable.
        if str(exc) == "event_binding_conflict" and isinstance(value, dict):
            attempts = value.get("attempt")
            if isinstance(attempts, str):
                attempts = [attempts]
            if isinstance(attempts, list) and len(attempts) == 1:
                try:
                    operation_key = require_opaque_key(
                        attempts[0], "operation_key"
                    )
                    send = _get(_send_key(operation_key))
                    if send and isinstance(
                        send.get("providerMessageIdDigest"), str
                    ):
                        _quarantine_send_integrity(operation_key, clock)
                except (AdapterInputError, AdapterRetryableError):
                    pass
        raise
    event_row = _begin_event(envelope, clock)
    if event_row.get("state") in {"delivered", "terminal"}:
        metric("events", "duplicate")
        return
    # EventBridge can assign a fresh event id (and slightly different delivery
    # time) when it redelivers the same SES message event.  The semantic event
    # key deliberately ignores both values.  Reuse the first accepted time so
    # every retry has the same signed body and event receipt.
    persisted_event_time = event_row.get("eventTime")
    if not isinstance(persisted_event_time, str):
        raise AdapterRetryableError("event_store_unavailable")
    envelope["eventTime"] = persisted_event_time
    send = _get(_send_key(envelope["operationKey"]))
    if not send:
        raise AdapterRetryableError("send_receipt_pending")
    send = _settle_ambiguous_send(envelope, send, secrets, clock)
    if not isinstance(send.get("providerMessageIdDigest"), str):
        raise AdapterRetryableError("send_receipt_pending")
    if not isinstance(send.get("rfcMessageIdDigest"), str):
        raise AdapterRetryableError("send_receipt_pending")
    send_adapter_version = send.get("adapterVersion")
    if send_adapter_version != ADAPTER_VERSION:
        raise AdapterRetryableError("send_adapter_version_unavailable")
    if not isinstance(send.get("threadReceipt"), str):
        raise AdapterRetryableError("send_receipt_pending")
    event_receipt = _derive_event_receipt(envelope, send)
    send = _mark_terminal_delivery_event(
        envelope, send, event_receipt, clock
    )

    if send.get("purpose") == "rfc_message_id_canary":
        # The one deployment-global RFC invariant operation has no Pentra
        # tenant event row. It settles only inside this adapter. Every tenant
        # relay canary uses inbound_relay_canary and follows the signed webhook.
        if envelope["eventType"] == "delivered":
            _record_rfc_canary_marker(
                envelope,
                send,
                secrets,
                clock,
                common_header_present=common_header_present,
            )
            _mark_event(envelope["eventKeyDigest"], "delivered", clock)
            metric("events", "delivered")
        else:
            _mark_event(envelope["eventKeyDigest"], "terminal", clock)
            metric("events", "terminal")
        return

    body = _webhook_payload(envelope, send, event_receipt)
    status, retry_after = _post_event(
        body,
        secrets,
        envelope["eventKeyDigest"],
        event_receipt,
    )
    if 200 <= status < 300:
        _mark_event(envelope["eventKeyDigest"], "delivered", clock)
        metric("events", "delivered", statusClass="2xx")
        return
    # Only the signed exact acknowledgement is terminal success. Every HTTP
    # rejection remains pending and is retried into the alarmed DLQ; a bad key,
    # clock skew, route drift, or app validation bug must not erase a bounce or
    # complaint merely because it returned a deterministic 4xx.
    raise AdapterRetryableError(
        "webhook_retry", retry_after if retry_after is not None else 60
    )


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []

    def retain_for_retry(message_id: Any) -> None:
        metric("events", "retried")
        if isinstance(message_id, str) and 1 <= len(message_id) <= 256:
            failures.append({"itemIdentifier": message_id})
            return
        # SQS normally guarantees messageId. If the invocation envelope itself
        # is malformed, fail the whole batch with a finite string so Lambda
        # retries without logging the underlying SDK/provider exception.
        raise RuntimeError("event_batch_identifier_invalid") from None

    for record in event.get("Records", []):
        message_id = record.get("messageId") if isinstance(record, dict) else None
        try:
            body = record.get("body") if isinstance(record, dict) else None
            if not isinstance(body, str) or len(body) > 16 * 1024:
                raise AdapterInputError("event_invalid")
            process_envelope(json.loads(body))
        except AdapterInputError:
            # EventBridge already removed message PII. Invalid transformed
            # envelopes and binding/provider conflicts are all integrity
            # incidents on this EventBridge-only queue. Quarantine them in the
            # alarmed DLQ instead of acknowledging a potentially important
            # bounce/complaint away.
            retain_for_retry(message_id)
        except json.JSONDecodeError:
            retain_for_retry(message_id)
        except AdapterRetryableError:
            retain_for_retry(message_id)
        except Exception:
            retain_for_retry(message_id)
    return {"batchItemFailures": failures}
