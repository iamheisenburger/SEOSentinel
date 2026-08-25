"""Dependency-free security and protocol helpers for Pentra managed SES.

The adapter is deliberately opaque to Pentra tenant identifiers.  It accepts
only application-generated operation keys, never logs request bodies, and
persists no recipient, subject, body, reply alias, or unsubscribe URL.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from datetime import datetime, timezone
from email.headerregistry import Address
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr, getaddresses
from typing import Any, Mapping
from urllib.parse import urlsplit

ADAPTER_PROTOCOL_VERSION = 1
AUTH_WINDOW_SECONDS = 5 * 60
NONCE_TTL_SECONDS = 10 * 60
MAX_REQUEST_BYTES = 96 * 1024
MAX_RAW_MESSAGE_BYTES = 128 * 1024
MAX_SUBJECT_CHARACTERS = 240
MAX_TEXT_CHARACTERS = 40_000
MAX_DISPLAY_NAME_CHARACTERS = 120
MIN_SEND_SPACING_SECONDS = 30 * 60

_OPAQUE_KEY = re.compile(r"^[A-Za-z0-9_-]{32,96}$")
_ADAPTER_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
_RELAY_ALIAS = re.compile(
    r"^reply-[a-z0-9_-]{32,64}@"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)
_SAFE_HEADER = re.compile(r"^[\x20-\x7e]{1,995}$")


class AdapterInputError(Exception):
    """A terminal request failure whose message is safe to return."""


class AdapterRetryableError(Exception):
    """A bounded retry signal that never carries provider response text."""

    def __init__(self, code: str = "adapter_retry", retry_after: int = 60) -> None:
        super().__init__(code)
        self.code = safe_code(code)
        self.retry_after = max(30, min(int(retry_after), 900))


def safe_code(value: Any, fallback: str = "invalid_request") -> str:
    if isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{1,63}", value):
        return value
    return fallback


def deterministic_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def require_opaque_key(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _OPAQUE_KEY.fullmatch(value):
        raise AdapterInputError(f"invalid_{field}")
    return value


def require_generation(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < 2**31:
        raise AdapterInputError("invalid_generation")
    return value


def require_adapter_version(value: Any, expected: str) -> str:
    if (
        not isinstance(value, str)
        or not _ADAPTER_VERSION.fullmatch(value)
        or not hmac.compare_digest(value, expected)
    ):
        raise AdapterInputError("adapter_version_mismatch")
    return value


def parse_secret_document(value: Any) -> dict[str, str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise AdapterInputError("secret_contract_invalid") from exc
    if not isinstance(value, dict):
        raise AdapterInputError("secret_contract_invalid")

    current = value.get("current")
    next_value = value.get("next")
    sign_with = value.get("signWith", "current")
    resource_key = value.get("resourceKey")
    if not isinstance(current, str) or len(current) < 32:
        raise AdapterInputError("secret_contract_invalid")
    if next_value is not None and (
        not isinstance(next_value, str) or len(next_value) < 32
    ):
        raise AdapterInputError("secret_contract_invalid")
    if sign_with not in {"current", "next"} or (
        sign_with == "next" and next_value is None
    ):
        raise AdapterInputError("secret_contract_invalid")
    if not isinstance(resource_key, str) or len(resource_key) < 32:
        raise AdapterInputError("secret_contract_invalid")
    return {
        "current": current,
        **({"next": next_value} if next_value is not None else {}),
        "signWith": sign_with,
        "resourceKey": resource_key,
    }


def parse_disposition_key(value: Any) -> str:
    if isinstance(value, str) and len(value) >= 32:
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return value
        value = decoded
    if isinstance(value, dict):
        value = value.get("key")
    if not isinstance(value, str) or len(value) < 32:
        raise AdapterInputError("disposition_secret_invalid")
    return value


def request_signing_bytes(
    method: str, path: str, timestamp: str, nonce: str, body: bytes
) -> bytes:
    return (
        "v1\n"
        + method.upper()
        + "\n"
        + path
        + "\n"
        + timestamp
        + "\n"
        + nonce
        + "\n"
        + sha256_hex(body)
    ).encode("utf-8")


def sign_request(
    secret: str,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        request_signing_bytes(method, path, timestamp, nonce, body),
        hashlib.sha256,
    ).hexdigest()


def verify_request_signature(
    headers: Mapping[str, Any],
    *,
    method: str,
    path: str,
    body: bytes,
    secrets: Mapping[str, str],
    now: int | None = None,
) -> tuple[str, int]:
    lowered = {str(key).lower(): value for key, value in headers.items()}
    timestamp = lowered.get("x-pentra-timestamp")
    nonce = lowered.get("x-pentra-nonce")
    signature = lowered.get("x-pentra-signature")
    if not isinstance(timestamp, str) or not timestamp.isdigit():
        raise AdapterInputError("request_auth_invalid")
    if not isinstance(nonce, str) or not _OPAQUE_KEY.fullmatch(nonce):
        raise AdapterInputError("request_auth_invalid")
    if not isinstance(signature, str) or not re.fullmatch(r"[a-f0-9]{64}", signature):
        raise AdapterInputError("request_auth_invalid")
    requested_at = int(timestamp)
    clock = int(time.time()) if now is None else int(now)
    if abs(clock - requested_at) > AUTH_WINDOW_SECONDS:
        raise AdapterInputError("request_auth_expired")

    valid = False
    for key in ("current", "next"):
        candidate = secrets.get(key)
        if candidate:
            expected = sign_request(candidate, method, path, timestamp, nonce, body)
            valid = hmac.compare_digest(signature, expected) or valid
    if not valid:
        raise AdapterInputError("request_auth_invalid")
    return nonce, requested_at


def response_signature(
    secret: str, request_nonce: str, timestamp: int, body: bytes
) -> str:
    material = (
        f"v1\nresponse\n{request_nonce}\n{timestamp}\n{sha256_hex(body)}"
    ).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), material, hashlib.sha256).hexdigest()


def verify_response_signature(
    headers: Mapping[str, Any],
    *,
    request_nonce: str,
    body: bytes,
    secrets: Mapping[str, str],
    now: int | None = None,
) -> int:
    lowered = {str(key).lower(): value for key, value in headers.items()}
    timestamp = lowered.get("x-pentra-response-timestamp")
    signature = lowered.get("x-pentra-response-signature")
    if not isinstance(timestamp, str) or not timestamp.isdigit():
        raise AdapterInputError("response_auth_invalid")
    if not isinstance(signature, str) or not re.fullmatch(r"[a-f0-9]{64}", signature):
        raise AdapterInputError("response_auth_invalid")
    responded_at = int(timestamp)
    clock = int(time.time()) if now is None else int(now)
    if abs(clock - responded_at) > AUTH_WINDOW_SECONDS:
        raise AdapterInputError("response_auth_expired")
    valid = False
    for key in ("current", "next"):
        candidate = secrets.get(key)
        if candidate:
            expected = response_signature(
                candidate, request_nonce, responded_at, body
            )
            valid = hmac.compare_digest(signature, expected) or valid
    if not valid:
        raise AdapterInputError("response_auth_invalid")
    return responded_at


def disposition_signature(
    secret: str,
    operation_key: str,
    resource_operation_key: str,
    generation: int,
    authorized_at: int,
) -> str:
    material = (
        "v1\ndisposition\nquarantine_no_replay\n"
        f"{operation_key}\n{resource_operation_key}\n{generation}\n{authorized_at}"
    ).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), material, hashlib.sha256).hexdigest()


def verify_disposition_authorization(
    payload: Mapping[str, Any],
    disposition_key: str,
    *,
    operation_key: str,
    resource_operation_key: str,
    generation: int,
    now: int,
) -> tuple[int, str]:
    authorized_at = payload.get("authorizedAt")
    receipt = payload.get("authorizationReceipt")
    if (
        not isinstance(authorized_at, int)
        or isinstance(authorized_at, bool)
        or abs(int(now) - authorized_at) > AUTH_WINDOW_SECONDS
        or not isinstance(receipt, str)
        or not re.fullmatch(r"[a-f0-9]{64}", receipt)
    ):
        raise AdapterInputError("disposition_authorization_invalid")
    expected = disposition_signature(
        disposition_key,
        operation_key,
        resource_operation_key,
        generation,
        authorized_at,
    )
    if not hmac.compare_digest(receipt, expected):
        raise AdapterInputError("disposition_authorization_invalid")
    return authorized_at, receipt


def derive_resource_names(
    resource_key: str, operation_key: str, generation: int, sender_domain: str
) -> tuple[str, str, str]:
    material = f"resource|{operation_key}|{generation}".encode("utf-8")
    digest = hmac.new(resource_key.encode("utf-8"), material, hashlib.sha256).hexdigest()
    tenant_name = f"pentra-{digest[:40]}"
    local_part = f"outreach-{digest[32:64]}"
    return tenant_name, local_part, f"{local_part}@{sender_domain}"


def derive_send_message_binding(
    resource_key: str,
    operation_key: str,
    resource_operation_key: str,
    generation: int,
    raw_message: bytes,
) -> str:
    """Bind an idempotency key to an exact message without storing its content hash."""
    if not isinstance(resource_key, str) or len(resource_key) < 32:
        raise AdapterInputError("secret_contract_invalid")
    operation = require_opaque_key(operation_key, "operation_key")
    resource_operation = require_opaque_key(
        resource_operation_key, "resource_operation_key"
    )
    receipt_generation = require_generation(generation)
    if not isinstance(raw_message, bytes) or not raw_message:
        raise AdapterInputError("invalid_body")
    material = (
        "v1\nsend-message-binding\n"
        f"{operation}\n{resource_operation}\n{receipt_generation}\n"
        f"{sha256_hex(raw_message)}"
    ).encode("utf-8")
    return hmac.new(
        resource_key.encode("utf-8"), material, hashlib.sha256
    ).hexdigest()


def utc_day(timestamp: int) -> str:
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).strftime("%Y-%m-%d")


def seconds_until_next_utc_day(timestamp: int) -> int:
    clock = datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
    tomorrow = datetime.fromtimestamp(
        ((int(timestamp) // 86_400) + 1) * 86_400, tz=timezone.utc
    )
    return max(1, int((tomorrow - clock).total_seconds()))


def warmup_daily_cap(settled_sending_days: int) -> int:
    days = max(0, int(settled_sending_days))
    if days < 2:
        return 3
    if days < 4:
        return 5
    if days < 7:
        return 10
    if days < 14:
        return 20
    return 30


def normalize_address(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 500:
        return ""
    parsed = getaddresses([value])
    if len(parsed) != 1:
        return ""
    _, addr = parsed[0]
    addr = addr.strip().lower()
    if addr.count("@") != 1 or len(addr) > 320:
        return ""
    local, domain = addr.rsplit("@", 1)
    if not local or len(local) > 64 or not domain or len(domain) > 253:
        return ""
    try:
        local.encode("ascii")
        ascii_domain = domain.encode("idna").decode("ascii")
        if not re.fullmatch(
            r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",
            ascii_domain,
        ):
            return ""
        Address(addr_spec=f"{local}@{ascii_domain}")
    except (UnicodeError, ValueError):
        return ""
    return f"{local}@{ascii_domain}"


def require_https_url(value: Any, field: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 1_500:
        raise AdapterInputError(f"invalid_{field}")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise AdapterInputError(f"invalid_{field}")
    return value


def require_reply_alias(value: Any, relay_domain: str) -> str:
    address = normalize_address(value)
    if not address or not _RELAY_ALIAS.fullmatch(address):
        raise AdapterInputError("invalid_reply_to")
    if address.rsplit("@", 1)[1] != relay_domain:
        raise AdapterInputError("invalid_reply_to")
    return address


def build_raw_message(
    *,
    from_email: str,
    to_email: str,
    display_name: str,
    subject: str,
    text: str,
    reply_to: str,
    unsubscribe_url: str,
) -> bytes:
    normalized_from = normalize_address(from_email)
    normalized_to = normalize_address(to_email)
    if normalized_from != from_email or not normalized_to:
        raise AdapterInputError("invalid_mailbox_address")
    if (
        not isinstance(display_name, str)
        or not 1 <= len(display_name.strip()) <= MAX_DISPLAY_NAME_CHARACTERS
        or "\r" in display_name
        or "\n" in display_name
    ):
        raise AdapterInputError("invalid_display_name")
    if (
        not isinstance(subject, str)
        or not 1 <= len(subject.strip()) <= MAX_SUBJECT_CHARACTERS
        or "\r" in subject
        or "\n" in subject
    ):
        raise AdapterInputError("invalid_subject")
    if not isinstance(text, str) or not 1 <= len(text) <= MAX_TEXT_CHARACTERS:
        raise AdapterInputError("invalid_body")
    if "\x00" in text:
        raise AdapterInputError("invalid_body")
    if not _SAFE_HEADER.fullmatch(reply_to) or not _SAFE_HEADER.fullmatch(unsubscribe_url):
        raise AdapterInputError("invalid_header")

    message = EmailMessage(policy=SMTP)
    message["From"] = formataddr((display_name.strip(), normalized_from))
    message["To"] = normalized_to
    message["Subject"] = subject.strip()
    message["Reply-To"] = reply_to
    message["List-Unsubscribe"] = f"<{unsubscribe_url}>"
    message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    message.set_content(text, subtype="plain", charset="utf-8", cte="quoted-printable")
    encoded = message.as_bytes()
    if len(encoded) > MAX_RAW_MESSAGE_BYTES:
        raise AdapterInputError("message_too_large")
    return encoded


EVENT_TYPES = {
    "Email Sent": "sent",
    "Email Delivered": "delivered",
    "Email Bounced": "bounced",
    "Email Complaint Received": "complaint",
    "Email Delivery Delayed": "delayed",
    "Email Rejected": "rejected",
    "Email Rendering Failed": "rendering_failed",
}


def normalize_event_envelope(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise AdapterInputError("event_invalid")
    event_type = EVENT_TYPES.get(value.get("eventType"))
    event_id = value.get("eventId")
    event_time = value.get("eventTime")
    message_id = value.get("messageId")
    attempts = value.get("attempt")
    if not event_type:
        raise AdapterInputError("event_type_invalid")
    if not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", event_id):
        raise AdapterInputError("event_invalid")
    if not isinstance(event_time, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", event_time
    ):
        raise AdapterInputError("event_invalid")
    if not isinstance(message_id, str) or not 1 <= len(message_id) <= 256:
        raise AdapterInputError("event_invalid")
    if isinstance(attempts, str):
        attempts = [attempts]
    if not isinstance(attempts, list) or len(attempts) != 1:
        raise AdapterInputError("event_invalid")
    operation_key = require_opaque_key(attempts[0], "operation_key")
    message_id_digest = sha256_hex(message_id)
    event_key_digest = sha256_hex(
        f"v1|{operation_key}|{event_type}|{message_id_digest}"
    )
    return {
        "eventType": event_type,
        "eventIdDigest": sha256_hex(event_id),
        "eventKeyDigest": event_key_digest,
        "eventTime": event_time,
        "messageId": message_id,
        "messageIdDigest": message_id_digest,
        "operationKey": operation_key,
    }


def metric(component: str, outcome: str, **values: int | str) -> None:
    allowed_outcomes = {
        "accepted",
        "ambiguous",
        "auth_rejected",
        "delivered",
        "duplicate",
        "invalid",
        "provider_rejected",
        "released",
        "retried",
        "terminal",
    }
    record: dict[str, int | str] = {
        "component": component if component in {"api", "events"} else "api",
        "outcome": outcome if outcome in allowed_outcomes else "invalid",
        "count": 1,
    }
    for key in ("statusClass", "retryAfter", "attempt"):
        value = values.get(key)
        if isinstance(value, int) and 0 <= value <= 100_000:
            record[key] = value
        elif key == "statusClass" and value in {"2xx", "4xx", "5xx"}:
            record[key] = value
    print(json.dumps(record, sort_keys=True, separators=(",", ":")))
