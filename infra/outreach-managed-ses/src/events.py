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
    TABLE_NAME,
    _client,
    _error_code,
    _get,
    _load_secrets,
    _mark_disposed_send_event_confirmed,
    _mark_send_terminal,
    _send_key,
)
from common import (
    AdapterInputError,
    AdapterRetryableError,
    deterministic_json,
    metric,
    normalize_event_envelope,
    sha256_hex,
    sign_request,
    verify_response_signature,
)

PENTRA_WEBHOOK_URL = os.environ.get("PENTRA_WEBHOOK_URL", "")
MAX_WEBHOOK_ACK_BYTES = 4 * 1024
SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS = 2 * 60


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
        for field in ("operationKey", "eventType", "messageIdDigest"):
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
    envelope: dict[str, str], send: dict[str, Any], now: int
) -> dict[str, Any]:
    if send.get("state") == "external_attempted":
        resource_operation_key = send.get("resourceOperationKey")
        generation = send.get("generation")
        attempted_at = send.get("createdAt")
        if (
            not isinstance(resource_operation_key, str)
            or not isinstance(generation, int)
            or not isinstance(attempted_at, int)
        ):
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
            provider_message_id_digest=envelope["messageIdDigest"],
        )
    if send.get("state") == "quarantined_no_replay":
        return _mark_disposed_send_event_confirmed(
            envelope["operationKey"],
            envelope["messageIdDigest"],
            now,
        )
    expected_digest = send.get("providerMessageIdDigest")
    if expected_digest != envelope["messageIdDigest"]:
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
            "eventType": envelope["eventType"],
            "occurredAt": envelope["eventTime"],
            "providerMessageIdDigest": send["providerMessageIdDigest"],
            "eventReceipt": event_receipt,
        }
    )


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
    envelope = normalize_event_envelope(value)
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
    send = _settle_ambiguous_send(envelope, send, clock)
    if not isinstance(send.get("providerMessageIdDigest"), str):
        raise AdapterRetryableError("send_receipt_pending")
    send_adapter_version = send.get("adapterVersion")
    if send_adapter_version != ADAPTER_VERSION:
        raise AdapterRetryableError("send_adapter_version_unavailable")

    event_receipt = sha256_hex(
        "|".join(
            [
                "v1",
                send_adapter_version,
                envelope["operationKey"],
                envelope["eventType"],
                envelope["eventTime"],
                envelope["messageIdDigest"],
                envelope["eventKeyDigest"],
            ]
        )
    )
    secrets = _load_secrets()
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
