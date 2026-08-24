"""SQS-driven MIME parser and signed Pentra inbound webhook client."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from email import policy
from email.message import Message
from email.parser import BytesHeaderParser, BytesParser
from html.parser import HTMLParser
from typing import Any

from relay_common import (
    MAX_MIME_DEPTH,
    MAX_MIME_PARTS,
    MAX_RAW_MIME_BYTES,
    MAX_TEXT_CHARACTERS,
    RelayInputError,
    RetryableRelayError,
    byte_bucket,
    deterministic_json,
    metric,
    normalize_address,
    normalize_message_id,
    parse_relay_alias,
    sha256_hex,
)

MAX_DECODED_TEXT_BYTES = 512 * 1024
_PENTRA_MESSAGE_ID = re.compile(
    r"^<pentra\.[a-z0-9_-]{32,64}@"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}>$",
    re.IGNORECASE,
)
_SAFE_S3_MESSAGE_KEY = re.compile(r"^[A-Za-z0-9._-]{8,200}$")

_s3_client: Any | None = None
_ddb_client: Any | None = None
_secrets_client: Any | None = None
_sqs_client: Any | None = None


def _client(service: str) -> Any:
    global _s3_client, _ddb_client, _secrets_client, _sqs_client
    slot = {
        "s3": "_s3_client",
        "dynamodb": "_ddb_client",
        "secretsmanager": "_secrets_client",
        "sqs": "_sqs_client",
    }[service]
    existing = globals()[slot]
    if existing is None:
        import boto3

        existing = boto3.client(service)
        globals()[slot] = existing
    return existing


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.fragments: list[str] = []
        self.suppressed = 0

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "svg"}:
            self.suppressed += 1
        elif not self.suppressed and tag.lower() in {"br", "p", "div", "li", "tr"}:
            self.fragments.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "svg"} and self.suppressed:
            self.suppressed -= 1
        elif not self.suppressed and tag.lower() in {"p", "div", "li", "tr"}:
            self.fragments.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.suppressed:
            self.fragments.append(data)


def _sanitize_text(value: str, maximum: int) -> str:
    value = value.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    return value.strip()[:maximum]


def _parts(root: Message) -> list[tuple[Message, tuple[str, ...]]]:
    result: list[tuple[Message, tuple[str, ...]]] = []
    stack: list[tuple[Message, int, tuple[str, ...]]] = [(root, 0, ())]
    while stack:
        part, depth, parents = stack.pop()
        if depth > MAX_MIME_DEPTH or len(result) >= MAX_MIME_PARTS:
            raise RelayInputError("mime_shape")
        result.append((part, parents))
        payload = part.get_payload()
        if isinstance(payload, list):
            parent_types = (*parents, part.get_content_type().lower())
            for child in reversed(payload):
                if not isinstance(child, Message):
                    raise RelayInputError("mime_shape")
                stack.append((child, depth + 1, parent_types))
    return result


def _decode_text_part(part: Message) -> tuple[str, int]:
    raw = part.get_payload(decode=True)
    if raw is None:
        payload = part.get_payload()
        raw = payload.encode("utf-8", "replace") if isinstance(payload, str) else b""
    if len(raw) > MAX_DECODED_TEXT_BYTES:
        raise RelayInputError("decoded_text_bound")
    charset = part.get_content_charset() or "utf-8"
    try:
        text = raw.decode(charset, "replace")
    except LookupError:
        text = raw.decode("utf-8", "replace")
    return text, len(raw)


def _select_body_part(part: Message) -> Message | None:
    """Select one structural body path without decoding attachment candidates.

    Only ``multipart/alternative`` may contain multiple representations of one
    body. Every other multipart must resolve to at most one filename-less text
    descendant. This deliberately rejects metadata-less text attachments in a
    ``multipart/mixed`` instead of forwarding them as message text.
    """

    content_type = part.get_content_type().lower()
    if content_type in {
        "message/rfc822",
        "message/delivery-status",
        "text/rfc822-headers",
    }:
        return None
    if part.get_content_disposition() == "attachment" or part.get_filename():
        return None
    if not part.is_multipart():
        return part if content_type in {"text/plain", "text/html"} else None

    payload = part.get_payload()
    if not isinstance(payload, list):
        raise RelayInputError("mime_shape")
    candidates = [
        candidate
        for child in payload
        if isinstance(child, Message)
        and (candidate := _select_body_part(child)) is not None
    ]
    if content_type == "multipart/alternative":
        by_type: dict[str, Message] = {}
        for candidate in candidates:
            candidate_type = candidate.get_content_type().lower()
            if candidate_type in by_type:
                raise RelayInputError("ambiguous_body")
            by_type[candidate_type] = candidate
        return by_type.get("text/plain") or by_type.get("text/html")
    if len(candidates) > 1:
        raise RelayInputError("ambiguous_body")
    return candidates[0] if candidates else None


def _body_text(root: Message) -> str:
    selected = _select_body_part(root)
    if selected is None:
        return ""
    text, _ = _decode_text_part(selected)
    if selected.get_content_type().lower() == "text/plain":
        return _sanitize_text(text, MAX_TEXT_CHARACTERS)
    extractor = _TextExtractor()
    extractor.feed(text)
    extractor.close()
    return _sanitize_text("".join(extractor.fragments), MAX_TEXT_CHARACTERS)


def _header(message: Message, name: str, maximum: int) -> str:
    values = message.get_all(name, [])
    if len(values) > 1:
        raise RelayInputError("ambiguous_header")
    return _sanitize_text(str(values[0]) if values else "", maximum)


def _reference_ids(message: Message) -> list[str]:
    raw_values = message.get_all("References", [])
    matches: list[str] = []
    for value in raw_values:
        matches.extend(re.findall(r"<[^<>\s]+@[^<>\s]+>", str(value)))
    normalized = [normalize_message_id(value) for value in matches]
    return [value for value in normalized if value][:20]


def _recipient_field(value: str) -> str:
    candidate = value.split(";", 1)[1] if ";" in value else value
    return normalize_address(candidate.strip())


def _dsn_status(parts: list[tuple[Message, tuple[str, ...]]]) -> dict[str, str]:
    delivery_parts = [
        part
        for part, _ in parts
        if part.get_content_type().lower() == "message/delivery-status"
    ]
    if len(delivery_parts) != 1:
        raise RelayInputError("dsn_structure")
    recipient_blocks: list[Message] = []
    payload = delivery_parts[0].get_payload()
    if not isinstance(payload, list):
        raise RelayInputError("dsn_structure")
    for block in payload:
        if not isinstance(block, Message):
            continue
        if any(
            block.get(name) is not None
            for name in ("Action", "Status", "Final-Recipient")
        ):
            recipient_blocks.append(block)
    if len(recipient_blocks) != 1:
        raise RelayInputError("dsn_ambiguous_status")
    block = recipient_blocks[0]
    critical: dict[str, str] = {}
    for name in ("Action", "Status", "Final-Recipient"):
        values = block.get_all(name, [])
        if len(values) != 1:
            raise RelayInputError("dsn_ambiguous_status")
        critical[name] = str(values[0])
    original_values = block.get_all("Original-Recipient", [])
    if len(original_values) > 1:
        raise RelayInputError("dsn_ambiguous_status")
    action = critical["Action"].strip().lower()
    status = critical["Status"].strip()
    final_recipient = _recipient_field(critical["Final-Recipient"])
    original_recipient = _recipient_field(
        str(original_values[0]) if original_values else ""
    )
    if (
        action != "failed"
        or not re.fullmatch(r"5\.\d{1,3}\.\d{1,3}", status)
        or not final_recipient
    ):
        raise RelayInputError("dsn_ambiguous_status")
    return {
        "action": "failed",
        "status": status,
        "finalRecipient": final_recipient,
        **({"originalRecipient": original_recipient} if original_recipient else {}),
    }


def _returned_headers(parts: list[tuple[Message, tuple[str, ...]]]) -> list[Message]:
    candidates: list[Message] = []
    for part, _ in parts:
        content_type = part.get_content_type().lower()
        if content_type == "message/rfc822":
            payload = part.get_payload()
            if isinstance(payload, list):
                candidates.extend(item for item in payload if isinstance(item, Message))
        elif content_type == "text/rfc822-headers":
            raw = part.get_payload(decode=True)
            if raw is None:
                payload = part.get_payload()
                raw = (
                    payload.encode("utf-8", "replace")
                    if isinstance(payload, str)
                    else b""
                )
            if len(raw) > 64 * 1024:
                raise RelayInputError("returned_headers_bound")
            candidates.append(BytesHeaderParser(policy=policy.default).parsebytes(raw))
    return candidates


def _recover_dsn_binding(
    parts: list[tuple[Message, tuple[str, ...]]], relay_domain: str
) -> tuple[str, str]:
    matches: list[tuple[str, str]] = []
    for returned in _returned_headers(parts):
        message_id_values = returned.get_all("Message-ID", [])
        reply_values = returned.get_all("Reply-To", [])
        if len(message_id_values) != 1 or len(reply_values) != 1:
            continue
        message_id = normalize_message_id(str(message_id_values[0]))
        if not _PENTRA_MESSAGE_ID.fullmatch(message_id):
            continue
        alias = parse_relay_alias(str(reply_values[0]), relay_domain)
        if alias and alias[0] == "reply":
            matches.append((message_id, alias[1]))
    if len(matches) != 1:
        raise RelayInputError("dsn_ambiguous_binding")
    return matches[0]


def _proof_value(item: dict[str, Any], key: str, kind: str = "S") -> str:
    field = item.get(key)
    if not isinstance(field, dict) or not isinstance(field.get(kind), str):
        raise RelayInputError("proof_shape")
    return field[kind]


def _load_proof(table_name: str, message_key: str) -> dict[str, Any] | None:
    response = _client("dynamodb").get_item(
        TableName=table_name,
        Key={"pk": {"S": f"proof#{sha256_hex(message_key)}"}},
        ConsistentRead=True,
    )
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _build_payload(
    raw: bytes, proof: dict[str, Any], message_key: str
) -> tuple[str, bytes]:
    message = BytesParser(policy=policy.default).parsebytes(raw)
    parts = _parts(message)
    if any(part.defects for part, _ in parts):
        raise RelayInputError("mime_defect")
    relay_domain = os.environ["RELAY_DOMAIN"].strip().lower()
    recipient = _proof_value(proof, "recipient")
    recipient_kind = _proof_value(proof, "recipientKind")
    proof_alias = parse_relay_alias(recipient, relay_domain)
    if not proof_alias or proof_alias[0] != recipient_kind:
        raise RelayInputError("proof_alias")
    routing_recipient_hash = sha256_hex(proof_alias[1])
    from_values = message.get_all("From", [])
    if len(from_values) != 1:
        raise RelayInputError("from_binding")
    from_email = normalize_address(str(from_values[0]))
    if not from_email or sha256_hex(from_email) != _proof_value(proof, "fromHash"):
        raise RelayInputError("from_binding")
    authentication_method = _proof_value(proof, "authenticationMethod")
    if authentication_method not in {"dmarc", "dkim"}:
        raise RelayInputError("authentication_method")
    received_at = int(_proof_value(proof, "receivedAt", "N"))
    message_id_values = message.get_all("Message-ID", [])
    if len(message_id_values) != 1:
        raise RelayInputError("message_id")
    outer_message_id = normalize_message_id(str(message_id_values[0]))
    if not outer_message_id:
        raise RelayInputError("message_id")

    root_is_dsn = (
        message.get_content_type().lower() == "multipart/report"
        and str(message.get_param("report-type", "")).lower() == "delivery-status"
    )
    dsn_parts_present = any(
        part.get_content_type().lower() == "message/delivery-status"
        for part, _ in parts
    )
    if recipient_kind == "dsn":
        if not root_is_dsn or not dsn_parts_present:
            raise RelayInputError("dsn_structure")
        dsn = _dsn_status(parts)
        original_message_id, recipient = _recover_dsn_binding(parts, relay_domain)
        dsn["originalMessageId"] = original_message_id
        # Keep the intake alias non-routing and private while allowing the
        # signed application receipt to prove that Workspace used the exact
        # per-inbox target the owner was shown.
        dsn["routingRecipientHash"] = routing_recipient_hash
        dsn["source"] = "message/delivery-status"
        text = ""
    else:
        if root_is_dsn or dsn_parts_present:
            raise RelayInputError("reply_dsn_mismatch")
        dsn = None
        text = _body_text(message)

    event_id = f"ses_{sha256_hex(message_key)}"
    payload: dict[str, Any] = {
        "version": 1,
        "adapterVersion": os.environ["ADAPTER_VERSION"],
        "retentionPolicyHash": os.environ["RETENTION_POLICY_HASH"],
        "eventId": event_id,
        "receivedAt": received_at,
        "recipient": recipient,
        "from": from_email,
        "messageId": outer_message_id,
        "references": _reference_ids(message),
        "subject": _header(message, "Subject", 500),
        "text": text,
        "authentication": {
            "verdict": "pass",
            "method": authentication_method,
            "alignedFrom": from_email,
        },
    }
    in_reply_to_values = message.get_all("In-Reply-To", [])
    if len(in_reply_to_values) > 1:
        raise RelayInputError("ambiguous_header")
    in_reply_to = normalize_message_id(
        str(in_reply_to_values[0]) if in_reply_to_values else ""
    )
    if in_reply_to:
        payload["inReplyTo"] = in_reply_to
    auto_submitted = _header(message, "Auto-Submitted", 100)
    if auto_submitted:
        payload["autoSubmitted"] = auto_submitted
    if dsn:
        payload["dsn"] = dsn
    body = deterministic_json(payload)
    return event_id, body


def _active_secret() -> str:
    response = _client("secretsmanager").get_secret_value(
        SecretId=os.environ["HMAC_SECRET_ARN"], VersionStage="AWSCURRENT"
    )
    secret_string = response.get("SecretString")
    if not isinstance(secret_string, str) or len(secret_string) > 10_000:
        raise RetryableRelayError(60)
    try:
        document = json.loads(secret_string)
    except json.JSONDecodeError as error:
        raise RetryableRelayError(60) from error
    if not isinstance(document, dict):
        raise RetryableRelayError(60)
    current = document.get("current")
    next_secret = document.get("next")
    if not isinstance(current, str) or len(current.strip()) < 32:
        raise RetryableRelayError(60)
    if next_secret is not None and (
        not isinstance(next_secret, str) or len(next_secret.strip()) < 32
    ):
        raise RetryableRelayError(60)
    active = document.get("signWith", "current")
    if active not in {"current", "next"}:
        raise RetryableRelayError(60)
    value = document.get(active)
    if not isinstance(value, str) or len(value.strip()) < 32:
        raise RetryableRelayError(60)
    return value.strip()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def _post(
    event_id: str, body: bytes, now_seconds: int | None = None
) -> tuple[int, int | None]:
    timestamp = int(time.time()) if now_seconds is None else int(now_seconds)
    secret = _active_secret()
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{event_id}.".encode() + body,
        hashlib.sha256,
    ).hexdigest()
    request = urllib.request.Request(
        os.environ["PENTRA_WEBHOOK_URL"],
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "User-Agent": "pentra-receiving-relay/1",
            "X-Pentra-Relay-Timestamp": str(timestamp),
            "X-Pentra-Relay-Event-Id": event_id,
            "X-Pentra-Relay-Signature": f"v1={signature}",
        },
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=10) as response:
            return int(response.status), None
    except urllib.error.HTTPError as error:
        retry_after: int | None = None
        try:
            retry_after = int(error.headers.get("Retry-After", ""))
        except (TypeError, ValueError):
            pass
        return int(error.code), retry_after
    except (OSError, urllib.error.URLError) as error:
        raise RetryableRelayError(60) from error


def _delete_material(bucket: str, key: str, table_name: str, proof_key: str) -> None:
    try:
        _client("s3").delete_object(Bucket=bucket, Key=key)
        _client("dynamodb").delete_item(
            TableName=table_name, Key={"pk": {"S": proof_key}}
        )
    except Exception as error:
        raise RetryableRelayError(60) from error


def _backoff(receive_count: int, retry_after: int | None = None) -> int:
    if retry_after is not None:
        return max(30, min(retry_after, 900))
    return min(30 * (2 ** max(receive_count - 1, 0)), 900)


def process_pointer(
    bucket: str,
    key: str,
    receive_count: int = 1,
    now_seconds: int | None = None,
) -> str:
    expected_bucket = os.environ["RAW_BUCKET_NAME"]
    table_name = os.environ["STATE_TABLE_NAME"]
    prefix = "raw/"
    if bucket != expected_bucket or not key.startswith(prefix):
        raise RelayInputError("pointer_scope")
    message_key = key[len(prefix) :]
    if not _SAFE_S3_MESSAGE_KEY.fullmatch(message_key):
        raise RelayInputError("pointer_key")
    proof_key = f"proof#{sha256_hex(message_key)}"
    try:
        proof = _load_proof(table_name, message_key)
    except Exception as error:
        raise RetryableRelayError(_backoff(receive_count)) from error
    if proof is None:
        if receive_count <= 3:
            raise RetryableRelayError(_backoff(receive_count))
        _delete_material(bucket, key, table_name, proof_key)
        metric("parser", "terminal")
        return "terminal"

    now_seconds = int(time.time()) if now_seconds is None else int(now_seconds)
    try:
        expires_at = int(_proof_value(proof, "expiresAt", "N"))
    except (RelayInputError, ValueError):
        expires_at = 0
    if expires_at <= now_seconds:
        _delete_material(bucket, key, table_name, proof_key)
        metric("parser", "terminal")
        return "terminal"

    try:
        response = _client("s3").get_object(Bucket=bucket, Key=key)
        content_length = int(response.get("ContentLength", 0))
        if content_length <= 0 or content_length > MAX_RAW_MIME_BYTES:
            _delete_material(bucket, key, table_name, proof_key)
            metric("parser", "mime_rejected", byteBucket=byte_bucket(content_length))
            return "terminal"
        raw = response["Body"].read(MAX_RAW_MIME_BYTES + 1)
    except RetryableRelayError:
        raise
    except Exception as error:
        raise RetryableRelayError(_backoff(receive_count)) from error
    if len(raw) != content_length or len(raw) > MAX_RAW_MIME_BYTES:
        _delete_material(bucket, key, table_name, proof_key)
        metric("parser", "mime_rejected", byteBucket=byte_bucket(len(raw)))
        return "terminal"

    try:
        event_id, body = _build_payload(raw, proof, message_key)
    except (RelayInputError, ValueError, KeyError, UnicodeError):
        _delete_material(bucket, key, table_name, proof_key)
        metric("parser", "mime_rejected", byteBucket=byte_bucket(len(raw)))
        return "terminal"

    status, retry_after = _post(event_id, body, now_seconds)
    status_class = f"{status // 100}xx" if 100 <= status <= 599 else "3xx"
    if 200 <= status < 300:
        _delete_material(bucket, key, table_name, proof_key)
        metric("parser", "deleted", statusClass="2xx", byteBucket=byte_bucket(len(raw)))
        return "deleted"
    if status == 425 or 500 <= status < 600 or 300 <= status < 400:
        delay = _backoff(receive_count, retry_after if status == 425 else None)
        metric("parser", "retried", statusClass=status_class, delaySeconds=delay)
        raise RetryableRelayError(delay)
    if 400 <= status < 500:
        _delete_material(bucket, key, table_name, proof_key)
        metric(
            "parser", "terminal", statusClass="4xx", byteBucket=byte_bucket(len(raw))
        )
        return "terminal"
    raise RetryableRelayError(_backoff(receive_count))


def _pointers(record: dict[str, Any]) -> Iterable[tuple[str, str]]:
    body = record.get("body")
    if not isinstance(body, str) or len(body) > 64 * 1024:
        raise RelayInputError("queue_body")
    notification = json.loads(body)
    records = notification.get("Records") if isinstance(notification, dict) else None
    if not isinstance(records, list) or len(records) != 1:
        raise RelayInputError("s3_notification")
    s3 = records[0].get("s3") if isinstance(records[0], dict) else None
    bucket = s3.get("bucket") if isinstance(s3, dict) else None
    obj = s3.get("object") if isinstance(s3, dict) else None
    name = bucket.get("name") if isinstance(bucket, dict) else None
    key = obj.get("key") if isinstance(obj, dict) else None
    if not isinstance(name, str) or not isinstance(key, str):
        raise RelayInputError("s3_notification")
    yield name, urllib.parse.unquote_plus(key)


def handler(event: dict[str, Any], _context: Any) -> dict[str, list[dict[str, str]]]:
    failures: list[dict[str, str]] = []
    records = event.get("Records")
    if not isinstance(records, list):
        return {"batchItemFailures": []}
    for record in records:
        item_id = str(record.get("messageId", "")) if isinstance(record, dict) else ""
        try:
            if not isinstance(record, dict):
                raise RelayInputError("queue_record")
            receive_count = int(
                record.get("attributes", {}).get("ApproximateReceiveCount", "1")
            )
            for bucket, key in _pointers(record):
                process_pointer(bucket, key, receive_count)
        except RetryableRelayError as error:
            try:
                receipt_handle = str(record.get("receiptHandle", ""))
                if receipt_handle:
                    _client("sqs").change_message_visibility(
                        QueueUrl=os.environ["QUEUE_URL"],
                        ReceiptHandle=receipt_handle,
                        VisibilityTimeout=error.delay_seconds,
                    )
            except Exception:
                pass
            if item_id:
                failures.append({"itemIdentifier": item_id})
        except (RelayInputError, ValueError, json.JSONDecodeError):
            metric("parser", "terminal")
        except Exception:
            metric("parser", "retried", delaySeconds=60)
            if item_id:
                failures.append({"itemIdentifier": item_id})
    return {"batchItemFailures": failures}
