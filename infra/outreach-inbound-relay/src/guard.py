"""Synchronous SES receipt-rule guard.

The guard runs before S3 delivery. Unsafe mail receives STOP_RULE_SET, so raw
MIME is never persisted. It has no S3, Secrets Manager, HTTP, or SES-send
authority.
"""

from __future__ import annotations

import ipaddress
import os
import re
import time
from datetime import datetime
from typing import Any

from relay_common import (
    RAW_PURGE_AGE_SECONDS,
    metric,
    parse_relay_alias,
    sha256_hex,
    trusted_authentication,
)

_MESSAGE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._-]{8,200}$")
_SES_RECEIVED_PATTERN = re.compile(
    r"\[(?:IPv6:)?(?P<ip>[0-9A-Fa-f:.]+)\].*\bby\s+"
    r"inbound-smtp\.us-east-1\.amazonaws\.com\b",
    re.IGNORECASE | re.DOTALL,
)

_ddb_client: Any | None = None


def _ddb() -> Any:
    global _ddb_client
    if _ddb_client is None:
        import boto3

        _ddb_client = boto3.client("dynamodb")
    return _ddb_client


def _received_at_ms(value: Any) -> int:
    if not isinstance(value, str) or len(value) > 64:
        return 0
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(parsed.timestamp() * 1000)
    except (ValueError, OverflowError):
        return 0


def _trusted_source_ip(mail: dict[str, Any]) -> str:
    """Read only the first SES-added Received field.

    SES prepends this field and identifies its own us-east-1 inbound SMTP
    endpoint. Later Received fields are sender-controlled and never used.
    """

    headers = mail.get("headers")
    if not isinstance(headers, list):
        return ""
    first_received: str | None = None
    for header in headers:
        if not isinstance(header, dict):
            continue
        if str(header.get("name", "")).lower() == "received":
            first_received = str(header.get("value", ""))
            break
    if not first_received or len(first_received) > 2_000:
        return ""
    match = _SES_RECEIVED_PATTERN.search(first_received)
    if not match:
        return ""
    try:
        return ipaddress.ip_address(match.group("ip")).compressed
    except ValueError:
        return ""


def _proof_item(args: dict[str, Any]) -> dict[str, dict[str, str]]:
    return {
        "pk": {"S": args["proofKey"]},
        "recordType": {"S": "receipt_proof"},
        "proofDigest": {"S": args["proofDigest"]},
        # This one short-lived envelope route is necessary because AWS's S3
        # event contains only an object pointer. The table is encrypted, has
        # no backups/streams, and parser/sweeper delete it within six hours.
        "recipient": {"S": args["recipient"]},
        "recipientKind": {"S": args["recipientKind"]},
        "fromHash": {"S": args["fromHash"]},
        "authenticationMethod": {"S": args["authenticationMethod"]},
        "receivedAt": {"N": str(args["receivedAt"])},
        "expiresAt": {"N": str(args["expiresAt"])},
    }


def _counter_update(
    table_name: str,
    key: str,
    limit: int,
    expires_at: int,
) -> dict[str, Any]:
    return {
        "Update": {
            "TableName": table_name,
            "Key": {"pk": {"S": key}},
            "UpdateExpression": (
                "SET #count = if_not_exists(#count, :zero) + :one, "
                "#recordType = :recordType, #expiresAt = :expiresAt"
            ),
            "ConditionExpression": ("attribute_not_exists(#count) OR #count < :limit"),
            "ExpressionAttributeNames": {
                "#count": "count",
                "#recordType": "recordType",
                "#expiresAt": "expiresAt",
            },
            "ExpressionAttributeValues": {
                ":zero": {"N": "0"},
                ":one": {"N": "1"},
                ":limit": {"N": str(limit)},
                ":recordType": {"S": "rate_window"},
                ":expiresAt": {"N": str(expires_at)},
            },
        }
    }


def _existing_proof_matches(
    table_name: str,
    proof_key: str,
    proof_digest: str,
) -> bool:
    try:
        response = _ddb().get_item(
            TableName=table_name,
            Key={"pk": {"S": proof_key}},
            ConsistentRead=True,
            ProjectionExpression="proofDigest",
        )
    except Exception:
        return False
    item = response.get("Item")
    return bool(
        isinstance(item, dict)
        and isinstance(item.get("proofDigest"), dict)
        and item["proofDigest"].get("S") == proof_digest
    )


def evaluate(event: dict[str, Any], now_seconds: int | None = None) -> str:
    now_seconds = int(time.time()) if now_seconds is None else int(now_seconds)
    records = event.get("Records")
    if not isinstance(records, list) or len(records) != 1:
        metric("guard", "internal_rejected")
        return "STOP_RULE_SET"
    record = records[0]
    if not isinstance(record, dict) or record.get("eventSource") != "aws:ses":
        metric("guard", "internal_rejected")
        return "STOP_RULE_SET"
    ses = record.get("ses") if isinstance(record, dict) else None
    if not isinstance(ses, dict):
        metric("guard", "internal_rejected")
        return "STOP_RULE_SET"
    mail = ses.get("mail")
    receipt = ses.get("receipt")
    if not isinstance(mail, dict) or not isinstance(receipt, dict):
        metric("guard", "internal_rejected")
        return "STOP_RULE_SET"
    action = receipt.get("action")
    if (
        mail.get("headersTruncated") is not False
        or not isinstance(action, dict)
        or action.get("type") != "Lambda"
        or action.get("invocationType") != "RequestResponse"
    ):
        metric("guard", "auth_rejected")
        return "STOP_RULE_SET"

    relay_domain = os.environ.get("RELAY_DOMAIN", "").strip().lower()
    table_name = os.environ.get("STATE_TABLE_NAME", "").strip()
    recipients = receipt.get("recipients")
    if not relay_domain or not table_name or not isinstance(recipients, list):
        metric("guard", "internal_rejected")
        return "STOP_RULE_SET"
    if len(recipients) != 1:
        metric("guard", "auth_rejected")
        return "STOP_RULE_SET"
    alias = parse_relay_alias(recipients[0], relay_domain)
    if not alias:
        metric("guard", "auth_rejected")
        return "STOP_RULE_SET"
    alias_kind, recipient = alias

    authentication = trusted_authentication(mail, receipt)
    source_ip = _trusted_source_ip(mail)
    message_id = str(mail.get("messageId", ""))
    received_at = _received_at_ms(receipt.get("timestamp") or mail.get("timestamp"))
    if (
        not authentication
        or not source_ip
        or not _MESSAGE_KEY_PATTERN.fullmatch(message_id)
        or received_at <= 0
        or abs(received_at - now_seconds * 1000) > 15 * 60 * 1000
    ):
        metric("guard", "auth_rejected")
        return "STOP_RULE_SET"
    method, aligned_from = authentication

    message_digest = sha256_hex(message_id)
    proof_key = f"proof#{message_digest}"
    proof_digest = sha256_hex(
        "\n".join(
            [
                message_id,
                recipient,
                alias_kind,
                sha256_hex(aligned_from),
                method,
                str(received_at),
            ]
        )
    )
    hour = now_seconds // 3_600
    minute = now_seconds // 60
    alias_key = f"rate#alias#{alias_kind}#{sha256_hex(recipient)}#{hour}"
    source_key = f"rate#source#{sha256_hex(source_ip)}#{minute}"
    # Expire proof state at the same 5h45 purge threshold as raw MIME. The
    # five-minute sweeper cadence leaves ten minutes of operational headroom
    # before the six-hour privacy boundary.
    proof_expiry = now_seconds + RAW_PURGE_AGE_SECONDS
    counter_expiry = now_seconds + 2 * 3_600
    proof = _proof_item(
        {
            "proofKey": proof_key,
            "proofDigest": proof_digest,
            "recipient": recipient,
            "recipientKind": alias_kind,
            "fromHash": sha256_hex(aligned_from),
            "authenticationMethod": method,
            "receivedAt": received_at,
            "expiresAt": proof_expiry,
        }
    )

    try:
        _ddb().transact_write_items(
            ClientRequestToken=proof_digest[:36],
            TransactItems=[
                {
                    "Put": {
                        "TableName": table_name,
                        "Item": proof,
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
                _counter_update(table_name, alias_key, 10, counter_expiry),
                _counter_update(table_name, source_key, 60, counter_expiry),
            ],
        )
    except Exception:
        if _existing_proof_matches(table_name, proof_key, proof_digest):
            metric("guard", "duplicate")
            return "CONTINUE"
        metric("guard", "rate_rejected")
        return "STOP_RULE_SET"
    metric("guard", "accepted")
    return "CONTINUE"


def handler(event: dict[str, Any], _context: Any) -> dict[str, str]:
    try:
        return {"disposition": evaluate(event)}
    except Exception:
        # SES must fail closed. Never emit exception text because SDK errors
        # can include request material.
        metric("guard", "internal_rejected")
        return {"disposition": "STOP_RULE_SET"}
