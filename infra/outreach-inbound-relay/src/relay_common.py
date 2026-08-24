"""Shared, dependency-free controls for Pentra's receiving-only SES adapter.

This module deliberately contains no mail-sending client and no logging of
message identifiers, aliases, addresses, headers, bodies, or exception text.
"""

from __future__ import annotations

import hashlib
import json
import re
from email.headerregistry import Address
from email.utils import getaddresses
from typing import Any

MAX_RELAY_BODY_BYTES = 64 * 1024
MAX_RAW_MIME_BYTES = 10 * 1024 * 1024
MAX_MIME_PARTS = 100
MAX_MIME_DEPTH = 12
MAX_TEXT_CHARACTERS = 50_000
RAW_RETENTION_SECONDS = 6 * 60 * 60
RETENTION_SAFETY_MARGIN_SECONDS = 15 * 60
RAW_PURGE_AGE_SECONDS = RAW_RETENTION_SECONDS - RETENTION_SAFETY_MARGIN_SECONDS

_ALIAS_PATTERN = re.compile(
    r"^(?P<kind>reply|dsn)-(?P<token>[a-z0-9_-]{32,64})@(?P<domain>"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$",
    re.IGNORECASE,
)
_MESSAGE_ID_PATTERN = re.compile(r"^<[^<>\s]{1,180}@[^<>\s]{1,190}>$")


class RelayInputError(Exception):
    """A terminal, privacy-safe input failure."""


class RetryableRelayError(Exception):
    """A bounded retry signal carrying only a delay, never message content."""

    def __init__(self, delay_seconds: int = 60) -> None:
        super().__init__("relay_retry")
        self.delay_seconds = max(30, min(int(delay_seconds), 900))


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def normalize_address(value: Any, *, maximum_tld_length: int = 24) -> str:
    """Return a conservative lower-case addr-spec or an empty string."""

    if (
        not isinstance(value, str)
        or len(value) > 500
        or not 2 <= maximum_tld_length <= 63
    ):
        return ""
    parsed_values = getaddresses([value])
    if len(parsed_values) != 1:
        return ""
    _, parsed = parsed_values[0]
    parsed = parsed.strip().lower()
    if len(parsed) > 320 or parsed.count("@") != 1:
        return ""
    local, domain = parsed.rsplit("@", 1)
    if not local or len(local) > 64 or not domain or len(domain) > 253:
        return ""
    try:
        local.encode("ascii")
        ascii_domain = domain.encode("idna").decode("ascii")
        if not re.fullmatch(
            rf"[a-z0-9.-]+\.[a-z]{{2,{maximum_tld_length}}}", ascii_domain
        ):
            return ""
        # HeaderRegistry is used only as a strict syntax check. It does not
        # perform network access or rewrite the local part.
        Address(addr_spec=f"{local}@{ascii_domain}")
    except (UnicodeError, ValueError):
        return ""
    return f"{local}@{ascii_domain}"


def parse_relay_alias(value: Any, relay_domain: str) -> tuple[str, str] | None:
    normalized = normalize_address(value, maximum_tld_length=63)
    match = _ALIAS_PATTERN.fullmatch(normalized)
    if not match or match.group("domain") != relay_domain.strip().lower():
        return None
    return match.group("kind").lower(), normalized


def normalize_message_id(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 220:
        return ""
    raw = value.strip()
    matches = re.findall(r"<[^<>\s]+@[^<>\s]+>", raw)
    if matches:
        if len(matches) != 1 or raw != matches[0]:
            return ""
        normalized = matches[0].lower()
    else:
        normalized = raw.lower()
    return normalized if _MESSAGE_ID_PATTERN.fullmatch(normalized) else ""


def verdict(receipt: dict[str, Any], name: str) -> str:
    candidate = receipt.get(name)
    return (
        str(candidate.get("status", "")).upper() if isinstance(candidate, dict) else ""
    )


def trusted_authentication(
    mail: dict[str, Any], receipt: dict[str, Any]
) -> tuple[str, str] | None:
    """Select only an SES-audited aligned sender authentication result.

    SES documents DKIM ``GRAY`` as unsigned *or* a mismatch between the
    RFC5322.From domain and DKIM signing domain. Consequently ``PASS`` is the
    aligned DKIM state. Bare SPF is intentionally not admitted because the
    receipt event does not expose sufficient alignment detail by itself.
    """

    if verdict(receipt, "spamVerdict") != "PASS":
        return None
    if verdict(receipt, "virusVerdict") != "PASS":
        return None
    common = mail.get("commonHeaders")
    from_values = common.get("from") if isinstance(common, dict) else None
    if not isinstance(from_values, list) or len(from_values) != 1:
        return None
    aligned_from = normalize_address(from_values[0])
    if not aligned_from:
        return None
    if verdict(receipt, "dmarcVerdict") == "PASS":
        return "dmarc", aligned_from
    if verdict(receipt, "dkimVerdict") == "PASS":
        return "dkim", aligned_from
    return None


def metric(component: str, outcome: str, **aggregate: int | str) -> None:
    """Write one redacted aggregate record to CloudWatch Logs.

    Callers may pass only low-cardinality counters, status classes, delays and
    byte buckets. No free-form provider error or message data is accepted.
    """

    allowed = {
        "accepted",
        "auth_rejected",
        "bytes_0_64k",
        "bytes_64k_1m",
        "bytes_1m_10m",
        "bytes_over_10m",
        "collision",
        "deleted",
        "duplicate",
        "internal_rejected",
        "mime_rejected",
        "rate_rejected",
        "retried",
        "terminal",
    }
    safe_outcome = outcome if outcome in allowed else "internal_rejected"
    record: dict[str, int | str] = {
        "component": component,
        "outcome": safe_outcome,
        "count": 1,
    }
    for key in (
        "statusClass",
        "delaySeconds",
        "byteBucket",
        "deletedCount",
        "oldestAgeSeconds",
    ):
        value = aggregate.get(key)
        if isinstance(value, int) and 0 <= value <= 100_000:
            record[key] = value
        elif key in {"statusClass", "byteBucket"} and isinstance(value, str):
            if value in {
                "2xx",
                "3xx",
                "4xx",
                "5xx",
                "0-64k",
                "64k-1m",
                "1m-10m",
                ">10m",
            }:
                record[key] = value
    print(json.dumps(record, sort_keys=True, separators=(",", ":")))


def byte_bucket(size: int) -> str:
    if size <= 64 * 1024:
        return "0-64k"
    if size <= 1024 * 1024:
        return "64k-1m"
    if size <= MAX_RAW_MIME_BYTES:
        return "1m-10m"
    return ">10m"


def deterministic_json(payload: dict[str, Any]) -> bytes:
    """Serialize with stable ordering and trim only text to the 64 KiB bound."""

    candidate = dict(payload)
    text = str(candidate.get("text", ""))[:MAX_TEXT_CHARACTERS]
    candidate["text"] = text

    def encode() -> bytes:
        return json.dumps(
            candidate,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    encoded = encode()
    if len(encoded) <= MAX_RELAY_BODY_BYTES:
        return encoded
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        candidate["text"] = text[:middle]
        if len(encode()) <= MAX_RELAY_BODY_BYTES:
            low = middle
        else:
            high = middle - 1
    candidate["text"] = text[:low]
    encoded = encode()
    if len(encoded) > MAX_RELAY_BODY_BYTES:
        raise RelayInputError("payload_bound")
    return encoded
