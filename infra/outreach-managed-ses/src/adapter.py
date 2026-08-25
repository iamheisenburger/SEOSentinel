"""Signed control plane and send boundary for Pentra's managed SES transport."""

from __future__ import annotations

import base64
import json
import os
import re
import secrets as random_secrets
import time
from typing import Any
from urllib.parse import urlsplit

try:  # Lambda includes boto3. Local tests inject clients without installing it.
    import boto3  # type: ignore
    from botocore.config import Config as BotoConfig  # type: ignore
except ImportError:  # pragma: no cover - exercised only outside Lambda/tests
    boto3 = None
    BotoConfig = None

from common import (
    ADAPTER_PROTOCOL_VERSION,
    MAX_REQUEST_BYTES,
    MIN_SEND_SPACING_SECONDS,
    NONCE_TTL_SECONDS,
    AdapterInputError,
    AdapterRetryableError,
    build_raw_message,
    derive_send_message_binding,
    derive_resource_names,
    deterministic_json,
    metric,
    normalize_address,
    parse_disposition_key,
    parse_secret_document,
    require_adapter_version,
    require_generation,
    require_https_url,
    require_opaque_key,
    require_reply_alias,
    response_signature,
    safe_code,
    sha256_hex,
    seconds_until_next_utc_day,
    utc_day,
    verify_disposition_authorization,
    verify_request_signature,
    warmup_daily_cap,
)

TABLE_NAME = os.environ.get("STATE_TABLE_NAME", "")
SECRET_ARN = os.environ.get("HMAC_SECRET_ARN", "")
DISPOSITION_SECRET_ARN = os.environ.get("DISPOSITION_SECRET_ARN", "")
ADAPTER_VERSION = os.environ.get("ADAPTER_VERSION", "")
SENDER_DOMAIN = os.environ.get("SENDER_DOMAIN", "").lower()
RELAY_DOMAIN = os.environ.get("RELAY_DOMAIN", "").lower()
UNSUBSCRIBE_ORIGIN = os.environ.get("UNSUBSCRIBE_ORIGIN", "")
IDENTITY_ARN = os.environ.get("IDENTITY_ARN", "")
CONFIGURATION_SET_NAME = os.environ.get("CONFIGURATION_SET_NAME", "")
CONFIGURATION_SET_ARN = os.environ.get("CONFIGURATION_SET_ARN", "")
EVENT_DESTINATION_NAME = os.environ.get("EVENT_DESTINATION_NAME", "")
EVENT_BUS_ARN = os.environ.get("EVENT_BUS_ARN", "")
PROVISION_LEASE_SECONDS = 90
PROVISION_AMBIGUITY_SECONDS = 15 * 60
RELEASE_STABILITY_SECONDS = 2 * 60
AMBIGUOUS_DISPOSITION_MIN_AGE_SECONDS = 72 * 60 * 60
MAX_WARMUP_SETTLED_DAYS = 14

_CLIENTS: dict[str, Any] = {}


def _client(name: str) -> Any:
    if name in _CLIENTS:
        return _CLIENTS[name]
    if boto3 is None:
        raise RuntimeError("aws_sdk_unavailable")
    _CLIENTS[name] = boto3.client(name)
    return _CLIENTS[name]


def _ses_send_client() -> Any:
    """Return an SES client that can issue at most one provider request.

    SendEmail is not safely retryable after a timeout: SES may have accepted the
    message even when the caller did not receive its MessageId. The durable send
    marker handles that ambiguity, so botocore must never retry inside one call.
    Explicit configuration takes precedence over shared AWS retry settings.
    """

    cache_key = "sesv2_send_no_retry"
    if cache_key in _CLIENTS:
        return _CLIENTS[cache_key]
    if boto3 is None or BotoConfig is None:
        raise RuntimeError("aws_sdk_unavailable")
    config = BotoConfig(
        retries={"mode": "standard", "total_max_attempts": 1}
    )
    _CLIENTS[cache_key] = boto3.client("sesv2", config=config)
    return _CLIENTS[cache_key]


def _error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return "unknown"
    error = response.get("Error")
    if not isinstance(error, dict):
        return "unknown"
    code = error.get("Code")
    return code if isinstance(code, str) and len(code) <= 100 else "unknown"


def _av(value: Any) -> dict[str, str]:
    if isinstance(value, bool):
        return {"BOOL": value}  # type: ignore[return-value]
    if isinstance(value, int):
        return {"N": str(value)}
    return {"S": str(value)}


def _decode_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    result: dict[str, Any] = {}
    for key, value in item.items():
        if not isinstance(value, dict):
            continue
        if "S" in value:
            result[key] = value["S"]
        elif "N" in value:
            try:
                result[key] = int(value["N"])
            except (TypeError, ValueError):
                return None
        elif "BOOL" in value:
            result[key] = bool(value["BOOL"])
    return result


def _get(pk: str) -> dict[str, Any] | None:
    response = _client("dynamodb").get_item(
        TableName=TABLE_NAME, Key={"pk": {"S": pk}}, ConsistentRead=True
    )
    return _decode_item(response.get("Item"))


def _put_nonce(nonce: str, now: int) -> None:
    try:
        _client("dynamodb").put_item(
            TableName=TABLE_NAME,
            Item={
                "pk": {"S": f"nonce#{sha256_hex(nonce)}"},
                "kind": {"S": "nonce"},
                "expiresAt": {"N": str(now + NONCE_TTL_SECONDS)},
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
    except Exception as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            raise AdapterInputError("request_replay") from exc
        raise AdapterRetryableError("nonce_store_unavailable") from exc


def _load_secrets() -> dict[str, str]:
    response = _client("secretsmanager").get_secret_value(SecretId=SECRET_ARN)
    return parse_secret_document(response.get("SecretString"))


def _load_disposition_key() -> str:
    response = _client("secretsmanager").get_secret_value(
        SecretId=DISPOSITION_SECRET_ARN
    )
    return parse_disposition_key(response.get("SecretString"))


def _public_resource(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {"state": "missing"}
    raw_state = row.get("state")
    state = "releasing" if raw_state == "release_verifying" else raw_state
    if state not in {
        "provisioning",
        "ready",
        "blocked",
        "releasing",
        "released",
    }:
        state = "blocked"
    result: dict[str, Any] = {
        "state": state,
        "generation": row.get("generation"),
        "adapterVersion": row.get("adapterVersion"),
        "updatedAt": row.get("updatedAt"),
    }
    if state == "ready":
        result.update(
            {
                "fromEmail": row.get("fromEmail"),
                "verifiedAt": row.get("verifiedAt"),
                "resourceReceipt": row.get("resourceReceipt"),
                "eventCanaryRequired": True,
            }
        )
    if state == "blocked":
        result["code"] = safe_code(row.get("code"), "resource_blocked")
    if state == "releasing" and isinstance(row.get("releaseVerifyAfter"), int):
        result["nextEligibleAt"] = row["releaseVerifyAfter"]
    return result


def _public_send(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {"state": "missing"}
    state = row.get("state")
    if state not in {
        "external_attempted",
        "submitted",
        "event_confirmed",
        "event_confirmed_after_disposition",
        "quarantined_no_replay",
        "terminal_rejected",
    }:
        state = "external_attempted"
    result: dict[str, Any] = {
        "state": state,
        "generation": row.get("generation"),
        "adapterVersion": row.get("adapterVersion"),
        "updatedAt": row.get("updatedAt"),
    }
    if row.get("providerMessageIdDigest"):
        result["providerMessageIdDigest"] = row["providerMessageIdDigest"]
    if state == "terminal_rejected":
        result["code"] = safe_code(row.get("code"), "provider_rejected")
    if state in {"external_attempted", "quarantined_no_replay"}:
        result["noReplay"] = True
    if state == "quarantined_no_replay":
        result["code"] = "owner_reviewed_no_replay_disposition"
    return result


def _resource_key(operation_key: str) -> str:
    return f"resource#{operation_key}"


def _send_key(operation_key: str) -> str:
    return f"send#{operation_key}"


def _sender_key(from_email: str) -> str:
    return f"sender#{sha256_hex(from_email)}"


def _pacing_key(resource_operation_key: str, day: str) -> str:
    return f"pacing#{sha256_hex(resource_operation_key)}#{day}"


def _warmup_day_key(resource_operation_key: str, day: str) -> str:
    return f"warmup-day#{sha256_hex(resource_operation_key)}#{day}"


def _pacing_wait(
    resource: dict[str, Any], resource_operation_key: str, now: int
) -> int:
    last_attempt = resource.get("lastSendAttemptAt")
    if isinstance(last_attempt, int):
        remaining = last_attempt + MIN_SEND_SPACING_SECONDS - now
        if remaining > 0:
            return remaining
    settled_days = resource.get("warmupSettledDayCount", 0)
    if not isinstance(settled_days, int) or settled_days < 0:
        return MIN_SEND_SPACING_SECONDS
    day = utc_day(now)
    counter = _get(_pacing_key(resource_operation_key, day))
    count = counter.get("count", 0) if counter else 0
    if not isinstance(count, int):
        return seconds_until_next_utc_day(now)
    if count >= warmup_daily_cap(settled_days):
        return seconds_until_next_utc_day(now)
    return 0


def _resource_binding_is_valid(
    resource: dict[str, Any], resource_operation_key: str, generation: int
) -> bool:
    tenant_name = resource.get("tenantName")
    from_email = resource.get("fromEmail")
    unsettled = resource.get("unsettledSendCount")
    settled_days = resource.get("warmupSettledDayCount", 0)
    verified_at = resource.get("verifiedAt")
    receipt = resource.get("resourceReceipt")
    if (
        resource.get("state") != "ready"
        or resource.get("generation") != generation
        or resource.get("adapterVersion") != ADAPTER_VERSION
        or resource.get("senderDomain") != SENDER_DOMAIN
        or resource.get("identityArn") != IDENTITY_ARN
        or resource.get("configurationSetName") != CONFIGURATION_SET_NAME
        or resource.get("configurationSetArn") != CONFIGURATION_SET_ARN
        or resource.get("eventDestinationName") != EVENT_DESTINATION_NAME
        or resource.get("eventBusArn") != EVENT_BUS_ARN
        or not isinstance(tenant_name, str)
        or not re.fullmatch(r"pentra-[a-f0-9]{40}", tenant_name)
        or not isinstance(from_email, str)
        or normalize_address(from_email) != from_email
        or not from_email.endswith("@" + SENDER_DOMAIN)
        or not isinstance(unsettled, int)
        or unsettled < 0
        or not isinstance(settled_days, int)
        or settled_days < 0
        or not isinstance(verified_at, int)
        or not isinstance(receipt, str)
        or not re.fullmatch(r"[a-f0-9]{64}", receipt)
    ):
        return False
    guard = _get(_sender_key(from_email))
    return bool(
        guard
        and guard.get("kind") == "sender_guard"
        and guard.get("resourceOperationKey") == resource_operation_key
        and guard.get("generation") == generation
    )


def _is_exact_release_tombstone(
    row: dict[str, Any] | None, generation: int
) -> bool:
    return bool(
        row
        and row.get("kind") == "resource"
        and row.get("state") == "released"
        and row.get("releaseTombstone") is True
        and row.get("generation") == generation
        and row.get("adapterVersion") == ADAPTER_VERSION
        and isinstance(row.get("releasedAt"), int)
    )


def _create_resource_row(
    operation_key: str,
    generation: int,
    tenant_name: str,
    from_email: str,
    now: int,
) -> dict[str, Any]:
    row = {
        "pk": _resource_key(operation_key),
        "kind": "resource",
        "state": "provisioning",
        "generation": generation,
        "adapterVersion": ADAPTER_VERSION,
        "senderDomain": SENDER_DOMAIN,
        "identityArn": IDENTITY_ARN,
        "configurationSetName": CONFIGURATION_SET_NAME,
        "configurationSetArn": CONFIGURATION_SET_ARN,
        "eventDestinationName": EVENT_DESTINATION_NAME,
        "eventBusArn": EVENT_BUS_ARN,
        "tenantName": tenant_name,
        "fromEmail": from_email,
        "unsettledSendCount": 0,
        "warmupSettledDayCount": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    existing = _get(_resource_key(operation_key))
    if existing:
        if _is_exact_release_tombstone(existing, generation):
            return existing
        if (
            existing.get("generation") != generation
            or existing.get("adapterVersion") != ADAPTER_VERSION
            or existing.get("senderDomain") != SENDER_DOMAIN
            or existing.get("identityArn") != IDENTITY_ARN
            or existing.get("configurationSetName") != CONFIGURATION_SET_NAME
            or existing.get("configurationSetArn") != CONFIGURATION_SET_ARN
            or existing.get("eventDestinationName") != EVENT_DESTINATION_NAME
            or existing.get("eventBusArn") != EVENT_BUS_ARN
            or existing.get("tenantName") != tenant_name
            or existing.get("fromEmail") != from_email
        ):
            raise AdapterInputError("operation_binding_conflict")
        return existing
    sender_guard = {
        "pk": _sender_key(from_email),
        "kind": "sender_guard",
        "resourceOperationKey": operation_key,
        "generation": generation,
        "createdAt": now,
    }
    try:
        _client("dynamodb").transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": TABLE_NAME,
                        "Item": {key: _av(value) for key, value in row.items()},
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
                {
                    "Put": {
                        "TableName": TABLE_NAME,
                        "Item": {
                            key: _av(value) for key, value in sender_guard.items()
                        },
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
            ]
        )
        return row
    except Exception as exc:
        existing = _get(_resource_key(operation_key))
        sender = _get(_sender_key(from_email))
        if _is_exact_release_tombstone(existing, generation):
            return existing  # type: ignore[return-value]
        if existing is None and sender is None:
            raise AdapterRetryableError("resource_marker_unavailable") from exc
        if (
            not existing
            or not sender
            or existing.get("generation") != generation
            or existing.get("adapterVersion") != ADAPTER_VERSION
            or existing.get("senderDomain") != SENDER_DOMAIN
            or existing.get("identityArn") != IDENTITY_ARN
            or existing.get("configurationSetName") != CONFIGURATION_SET_NAME
            or existing.get("configurationSetArn") != CONFIGURATION_SET_ARN
            or existing.get("eventDestinationName") != EVENT_DESTINATION_NAME
            or existing.get("eventBusArn") != EVENT_BUS_ARN
            or existing.get("tenantName") != tenant_name
            or existing.get("fromEmail") != from_email
            or sender.get("resourceOperationKey") != operation_key
            or sender.get("generation") != generation
        ):
            if existing is not None or sender is not None:
                raise AdapterInputError("operation_binding_conflict") from exc
            raise AdapterRetryableError("resource_marker_unavailable") from exc
        return existing


def _provider_is_not_found(exc: Exception) -> bool:
    return _error_code(exc) in {"NotFoundException", "NotFound"}


def _provider_is_already_exists(exc: Exception) -> bool:
    return _error_code(exc) in {"AlreadyExistsException", "AlreadyExists"}


def _claim_provision(
    operation_key: str, generation: int, now: int
) -> tuple[dict[str, Any], str] | None:
    token = random_secrets.token_hex(24)
    try:
        _client("dynamodb").update_item(
            TableName=TABLE_NAME,
            Key={"pk": {"S": _resource_key(operation_key)}},
            UpdateExpression=(
                "SET provisionLeaseToken=:token, provisionLeaseExpiresAt=:expires, "
                "provisionExternalAttemptedAt=:now, updatedAt=:now"
            ),
            ConditionExpression=(
                "generation=:generation AND #state=:provisioning AND "
                "(attribute_not_exists(provisionLeaseExpiresAt) "
                "OR provisionLeaseExpiresAt <= :now)"
            ),
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":token": {"S": token},
                ":expires": {"N": str(now + PROVISION_LEASE_SECONDS)},
                ":now": {"N": str(now)},
                ":generation": {"N": str(generation)},
                ":provisioning": {"S": "provisioning"},
            },
        )
    except Exception as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            return None
        raise AdapterRetryableError("provision_claim_unavailable") from exc
    row = _get(_resource_key(operation_key))
    if not row or row.get("provisionLeaseToken") != token:
        raise AdapterRetryableError("provision_claim_unavailable")
    return row, token


def _associate_resource(ses: Any, tenant_name: str, resource_arn: str) -> None:
    try:
        ses.create_tenant_resource_association(
            TenantName=tenant_name, ResourceArn=resource_arn
        )
    except Exception as exc:
        if not _provider_is_already_exists(exc):
            raise


def _verify_resource(
    ses: Any,
    tenant_name: str,
    operation_key: str,
    identity_arn: str,
    configuration_set_arn: str,
) -> bool:
    account = ses.get_account()
    if (
        account.get("ProductionAccessEnabled") is not True
        or account.get("SendingEnabled") is not True
    ):
        return False
    try:
        identity = ses.get_email_identity(EmailIdentity=SENDER_DOMAIN)
    except Exception as exc:
        if _provider_is_not_found(exc):
            return False
        raise
    if identity.get("VerifiedForSendingStatus") is not True:
        return False
    dkim = identity.get("DkimAttributes")
    if (
        not isinstance(dkim, dict)
        or dkim.get("Status") != "SUCCESS"
        or dkim.get("SigningEnabled") is not True
    ):
        return False
    try:
        configuration = ses.get_configuration_set(
            ConfigurationSetName=CONFIGURATION_SET_NAME
        )
    except Exception as exc:
        if _provider_is_not_found(exc):
            return False
        raise
    sending_options = configuration.get("SendingOptions")
    if (
        not isinstance(sending_options, dict)
        or sending_options.get("SendingEnabled") is not True
    ):
        return False
    try:
        destinations = ses.get_configuration_set_event_destinations(
            ConfigurationSetName=CONFIGURATION_SET_NAME
        ).get("EventDestinations")
    except Exception as exc:
        if _provider_is_not_found(exc):
            return False
        raise
    expected_events = {
        "SEND",
        "DELIVERY",
        "BOUNCE",
        "COMPLAINT",
        "DELIVERY_DELAY",
        "REJECT",
        "RENDERING_FAILURE",
    }
    if not isinstance(destinations, list) or not any(
        isinstance(destination, dict)
        and destination.get("Name") == EVENT_DESTINATION_NAME
        and destination.get("Enabled") is True
        and set(destination.get("MatchingEventTypes") or []) == expected_events
        and isinstance(destination.get("EventBridgeDestination"), dict)
        and destination["EventBridgeDestination"].get("EventBusArn")
        == EVENT_BUS_ARN
        for destination in destinations
    ):
        return False
    try:
        response = ses.get_tenant(TenantName=tenant_name)
    except Exception as exc:
        if _provider_is_not_found(exc):
            return False
        raise
    tenant = response.get("Tenant")
    if not isinstance(tenant, dict):
        return False
    if tenant.get("TenantName") != tenant_name:
        return False
    if tenant.get("SendingStatus") not in {"ENABLED", "REINSTATED"}:
        return False
    expected_tag = sha256_hex(operation_key)[:32]
    tags = tenant.get("Tags")
    if not isinstance(tags, list) or not any(
        isinstance(item, dict)
        and item.get("Key") == "OperationDigest"
        and item.get("Value") == expected_tag
        for item in tags
    ):
        return False
    suppression = tenant.get("SuppressionAttributes")
    if not isinstance(suppression, dict):
        return False
    if suppression.get("SuppressionScope") != "TENANT":
        return False
    reasons = suppression.get("SuppressedReasons")
    if not isinstance(reasons, list) or set(reasons) != {"BOUNCE", "COMPLAINT"}:
        return False
    try:
        resources = ses.list_tenant_resources(TenantName=tenant_name, PageSize=10)
    except Exception as exc:
        if _provider_is_not_found(exc):
            return False
        raise
    if resources.get("NextToken"):
        return False
    actual = {
        item.get("ResourceArn")
        for item in resources.get("TenantResources", [])
        if isinstance(item, dict)
    }
    return actual == {identity_arn, configuration_set_arn}


def _mark_resource_ready(
    operation_key: str,
    generation: int,
    provision_token: str,
    resource_receipt: str,
    now: int,
) -> dict[str, Any]:
    try:
        _client("dynamodb").update_item(
            TableName=TABLE_NAME,
            Key={"pk": {"S": _resource_key(operation_key)}},
            UpdateExpression=(
                "SET #state=:ready, verifiedAt=:now, updatedAt=:now, "
                "resourceReceipt=:receipt REMOVE provisionLeaseToken, "
                "provisionLeaseExpiresAt"
            ),
            ConditionExpression=(
                "generation=:generation AND adapterVersion=:version "
                "AND #state=:provisioning AND provisionLeaseToken=:token"
            ),
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":ready": {"S": "ready"},
                ":provisioning": {"S": "provisioning"},
                ":now": {"N": str(now)},
                ":receipt": {"S": resource_receipt},
                ":generation": {"N": str(generation)},
                ":version": {"S": ADAPTER_VERSION},
                ":token": {"S": provision_token},
            },
        )
    except Exception as exc:
        raise AdapterRetryableError("resource_settlement_unavailable") from exc
    row = _get(_resource_key(operation_key))
    if not row:
        raise AdapterRetryableError("resource_settlement_unavailable")
    return row


def _provision(payload: dict[str, Any], secrets: dict[str, str], now: int) -> dict[str, Any]:
    require_adapter_version(payload.get("adapterVersion"), ADAPTER_VERSION)
    operation_key = require_opaque_key(payload.get("operationKey"), "operation_key")
    generation = require_generation(payload.get("generation"))
    tenant_name, _, from_email = derive_resource_names(
        secrets["resourceKey"], operation_key, generation, SENDER_DOMAIN
    )
    row = _create_resource_row(
        operation_key, generation, tenant_name, from_email, now
    )
    if row.get("state") in {"ready", "released", "releasing", "blocked"}:
        return _public_resource(row)
    claim = _claim_provision(operation_key, generation, now)
    if claim is None:
        return _public_resource(_get(_resource_key(operation_key)))
    row, provision_token = claim
    identity_arn = row.get("identityArn")
    configuration_set_arn = row.get("configurationSetArn")
    event_destination_name = row.get("eventDestinationName")
    event_bus_arn = row.get("eventBusArn")
    if not isinstance(identity_arn, str) or not isinstance(
        configuration_set_arn, str
    ) or not isinstance(event_destination_name, str) or not isinstance(
        event_bus_arn, str
    ):
        raise AdapterInputError("resource_receipt_invalid")

    ses = _client("sesv2")
    try:
        try:
            ses.create_tenant(
                TenantName=tenant_name,
                Tags=[
                    {"Key": "PentraComponent", "Value": "managed-ses"},
                    {"Key": "OperationDigest", "Value": sha256_hex(operation_key)[:32]},
                ],
                SuppressionAttributes={
                    "SuppressionScope": "TENANT",
                    "SuppressedReasons": ["BOUNCE", "COMPLAINT"],
                },
            )
        except Exception as exc:
            if not _provider_is_already_exists(exc):
                raise
        _associate_resource(ses, tenant_name, identity_arn)
        _associate_resource(ses, tenant_name, configuration_set_arn)
        ses.put_tenant_suppression_attributes(
            TenantName=tenant_name,
            SuppressionScope="TENANT",
            SuppressedReasons=["BOUNCE", "COMPLAINT"],
        )
        if not _verify_resource(
            ses,
            tenant_name,
            operation_key,
            identity_arn,
            configuration_set_arn,
        ):
            raise AdapterRetryableError("provider_receipt_incomplete")
    except AdapterRetryableError:
        raise
    except Exception as exc:
        code = _error_code(exc)
        if code in {"BadRequestException", "LimitExceededException"}:
            _client("dynamodb").update_item(
                TableName=TABLE_NAME,
                Key={"pk": {"S": _resource_key(operation_key)}},
                UpdateExpression=(
                    "SET #state=:blocked, code=:code, updatedAt=:now "
                    "REMOVE provisionLeaseToken, provisionLeaseExpiresAt"
                ),
                ConditionExpression=(
                    "generation=:generation AND #state=:provisioning "
                    "AND provisionLeaseToken=:token"
                ),
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    ":blocked": {"S": "blocked"},
                    ":code": {"S": "provider_provisioning_blocked"},
                    ":now": {"N": str(now)},
                    ":generation": {"N": str(generation)},
                    ":provisioning": {"S": "provisioning"},
                    ":token": {"S": provision_token},
                },
            )
            return _public_resource(_get(_resource_key(operation_key)))
        raise AdapterRetryableError("provider_provisioning_retry") from exc

    resource_receipt = sha256_hex(
        f"v1|{tenant_name}|{identity_arn}|{configuration_set_arn}|"
        f"{EVENT_BUS_ARN}|{generation}|{ADAPTER_VERSION}"
    )
    metric("api", "accepted")
    return _public_resource(
        _mark_resource_ready(
            operation_key,
            generation,
            provision_token,
            resource_receipt,
            now,
        )
    )


def _mark_send_terminal(
    operation_key: str,
    resource_operation_key: str,
    generation: int,
    state: str,
    now: int,
    *,
    provider_message_id_digest: str | None = None,
    code: str | None = None,
    expected_message_binding: str | None = None,
) -> dict[str, Any]:
    if state in {"submitted", "event_confirmed"}:
        if (
            not isinstance(provider_message_id_digest, str)
            or not re.fullmatch(r"[a-f0-9]{64}", provider_message_id_digest)
            or code is not None
        ):
            raise AdapterInputError("send_receipt_invalid")
    elif state == "terminal_rejected":
        if provider_message_id_digest is not None or code != "provider_rejected":
            raise AdapterInputError("send_receipt_invalid")
    else:
        raise AdapterInputError("send_receipt_invalid")
    current_send = _get(_send_key(operation_key))
    if not current_send:
        raise AdapterRetryableError("send_settlement_unavailable")
    message_binding = current_send.get("messageBinding")
    if (
        current_send.get("kind") != "send"
        or current_send.get("resourceOperationKey") != resource_operation_key
        or current_send.get("generation") != generation
        or current_send.get("adapterVersion") != ADAPTER_VERSION
        or not isinstance(message_binding, str)
        or not re.fullmatch(r"[a-f0-9]{64}", message_binding)
        or (
            expected_message_binding is not None
            and not random_secrets.compare_digest(
                message_binding, expected_message_binding
            )
        )
    ):
        raise AdapterInputError("send_receipt_invalid")
    attempted_at = current_send.get("createdAt")
    settled_day = utc_day(attempted_at) if isinstance(attempted_at, int) else None
    advances_warmup = state in {"submitted", "event_confirmed"}
    if advances_warmup and settled_day is None:
        raise AdapterInputError("send_receipt_invalid")
    send_values: dict[str, Any] = {
        ":external": {"S": "external_attempted"},
        ":state": {"S": state},
        ":now": {"N": str(now)},
    }
    set_parts = ["#sendState=:state", "updatedAt=:now"]
    if provider_message_id_digest:
        set_parts.append("providerMessageIdDigest=:messageDigest")
        send_values[":messageDigest"] = {"S": provider_message_id_digest}
    if code:
        set_parts.append("code=:code")
        send_values[":code"] = {"S": safe_code(code, "provider_rejected")}

    def transact(*, warmup_mode: str | None) -> None:
        resource_values: dict[str, Any] = {
            ":minusOne": {"N": "-1"},
            ":one": {"N": "1"},
            ":generation": {"N": str(generation)},
            ":version": {"S": ADAPTER_VERSION},
            ":ready": {"S": "ready"},
            ":blocked": {"S": "blocked"},
            ":now": {"N": str(now)},
        }
        resource_update = "SET updatedAt=:now ADD unsettledSendCount :minusOne"
        resource_condition = (
            "generation=:generation AND adapterVersion=:version "
            "AND (#resourceState=:ready OR #resourceState=:blocked) "
            "AND unsettledSendCount >= :one"
        )
        warmup_guard: dict[str, Any] | None = None
        if warmup_mode in {"new", "existing"}:
            warmup_key = _warmup_day_key(
                resource_operation_key, str(settled_day)
            )
            if warmup_mode == "new":
                resource_values[":dayOne"] = {"N": "1"}
                resource_values[":warmupMax"] = {
                    "N": str(MAX_WARMUP_SETTLED_DAYS)
                }
                resource_update = (
                    "SET updatedAt=:now ADD unsettledSendCount :minusOne, "
                    "warmupSettledDayCount :dayOne"
                )
                resource_condition += (
                    " AND (attribute_not_exists(warmupSettledDayCount) "
                    "OR warmupSettledDayCount < :warmupMax)"
                )
                warmup_guard = {
                    "Put": {
                        "TableName": TABLE_NAME,
                        "Item": {
                            "pk": {"S": warmup_key},
                            "kind": {"S": "warmup_day"},
                            "resourceOperationKey": {
                                "S": resource_operation_key
                            },
                            "day": {"S": str(settled_day)},
                            "createdAt": {"N": str(now)},
                        },
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                }
            else:
                warmup_guard = {
                    "ConditionCheck": {
                        "TableName": TABLE_NAME,
                        "Key": {"pk": {"S": warmup_key}},
                        "ConditionExpression": (
                            "attribute_exists(pk) AND "
                            "resourceOperationKey=:resource AND #day=:day"
                        ),
                        "ExpressionAttributeNames": {"#day": "day"},
                        "ExpressionAttributeValues": {
                            ":resource": {"S": resource_operation_key},
                            ":day": {"S": str(settled_day)},
                        },
                    }
                }
        elif warmup_mode == "capped":
            resource_values[":warmupMax"] = {
                "N": str(MAX_WARMUP_SETTLED_DAYS)
            }
            resource_condition += (
                " AND warmupSettledDayCount >= :warmupMax"
            )
        writes: list[dict[str, Any]] = [
            {
                "Update": {
                    "TableName": TABLE_NAME,
                    "Key": {"pk": {"S": _send_key(operation_key)}},
                    "UpdateExpression": "SET " + ", ".join(set_parts),
                    "ConditionExpression": (
                        "#sendState=:external AND resourceOperationKey=:resource "
                        "AND generation=:generation AND adapterVersion=:version "
                        "AND messageBinding=:messageBinding"
                    ),
                    "ExpressionAttributeNames": {"#sendState": "state"},
                    "ExpressionAttributeValues": {
                        **send_values,
                        ":resource": {"S": resource_operation_key},
                        ":generation": {"N": str(generation)},
                        ":version": {"S": ADAPTER_VERSION},
                        ":messageBinding": {"S": message_binding},
                    },
                }
            },
            {
                "Update": {
                    "TableName": TABLE_NAME,
                    "Key": {
                        "pk": {"S": _resource_key(resource_operation_key)}
                    },
                    "UpdateExpression": resource_update,
                    "ConditionExpression": resource_condition,
                    "ExpressionAttributeNames": {"#resourceState": "state"},
                    "ExpressionAttributeValues": resource_values,
                }
            },
        ]
        if warmup_guard is not None:
            writes.append(warmup_guard)
        _client("dynamodb").transact_write_items(
            TransactItems=writes
        )

    try:
        transact(warmup_mode="new" if advances_warmup else None)
    except Exception as first_exc:
        row = _get(_send_key(operation_key))
        if row and row.get("state") != "external_attempted":
            return _require_matching_terminal_send(
                row,
                resource_operation_key=resource_operation_key,
                generation=generation,
                state=state,
                provider_message_id_digest=provider_message_id_digest,
                code=code,
                message_binding=message_binding,
            )
        if advances_warmup:
            try:
                transact(warmup_mode="existing")
            except Exception as second_exc:
                row = _get(_send_key(operation_key))
                if row and row.get("state") != "external_attempted":
                    return _require_matching_terminal_send(
                        row,
                        resource_operation_key=resource_operation_key,
                        generation=generation,
                        state=state,
                        provider_message_id_digest=provider_message_id_digest,
                        code=code,
                        message_binding=message_binding,
                    )
                try:
                    transact(warmup_mode="capped")
                except Exception as capped_exc:
                    row = _get(_send_key(operation_key))
                    if row and row.get("state") != "external_attempted":
                        return _require_matching_terminal_send(
                            row,
                            resource_operation_key=resource_operation_key,
                            generation=generation,
                            state=state,
                            provider_message_id_digest=provider_message_id_digest,
                            code=code,
                            message_binding=message_binding,
                        )
                    raise AdapterRetryableError(
                        "send_settlement_unavailable"
                    ) from capped_exc
        else:
            raise AdapterRetryableError(
                "send_settlement_unavailable"
            ) from first_exc
    row = _get(_send_key(operation_key))
    if not row:
        raise AdapterRetryableError("send_settlement_unavailable")
    return _require_matching_terminal_send(
        row,
        resource_operation_key=resource_operation_key,
        generation=generation,
        state=state,
        provider_message_id_digest=provider_message_id_digest,
        code=code,
        message_binding=message_binding,
    )


def _require_matching_terminal_send(
    row: dict[str, Any],
    *,
    resource_operation_key: str,
    generation: int,
    state: str,
    provider_message_id_digest: str | None,
    code: str | None,
    message_binding: str,
) -> dict[str, Any]:
    exact_binding = (
        row.get("kind") == "send"
        and row.get("resourceOperationKey") == resource_operation_key
        and row.get("generation") == generation
        and row.get("adapterVersion") == ADAPTER_VERSION
        and row.get("messageBinding") == message_binding
    )
    if not exact_binding:
        raise AdapterInputError("provider_receipt_mismatch")
    if state in {"submitted", "event_confirmed"}:
        valid = (
            row.get("state") in {"submitted", "event_confirmed"}
            and isinstance(provider_message_id_digest, str)
            and row.get("providerMessageIdDigest")
            == provider_message_id_digest
            and row.get("code") is None
        )
    elif state == "terminal_rejected":
        valid = (
            row.get("state") == "terminal_rejected"
            and row.get("providerMessageIdDigest") is None
            and row.get("code") == safe_code(code, "provider_rejected")
        )
    else:
        valid = False
    if not valid:
        raise AdapterInputError("provider_receipt_mismatch")
    return row


def _mark_disposed_send_event_confirmed(
    operation_key: str,
    provider_message_id_digest: str,
    now: int,
) -> dict[str, Any]:
    try:
        _client("dynamodb").update_item(
            TableName=TABLE_NAME,
            Key={"pk": {"S": _send_key(operation_key)}},
            UpdateExpression=(
                "SET #state=:confirmed, providerMessageIdDigest=:digest, "
                "updatedAt=:now"
            ),
            ConditionExpression=(
                "#state=:quarantined AND attribute_not_exists(providerMessageIdDigest)"
            ),
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":confirmed": {"S": "event_confirmed_after_disposition"},
                ":quarantined": {"S": "quarantined_no_replay"},
                ":digest": {"S": provider_message_id_digest},
                ":now": {"N": str(now)},
            },
        )
    except Exception as exc:
        current = _get(_send_key(operation_key))
        if (
            current
            and current.get("state") == "event_confirmed_after_disposition"
            and current.get("providerMessageIdDigest")
            == provider_message_id_digest
        ):
            return current
        raise AdapterRetryableError("send_settlement_unavailable") from exc
    row = _get(_send_key(operation_key))
    if not row:
        raise AdapterRetryableError("send_settlement_unavailable")
    return row


def _disposition(
    payload: dict[str, Any], disposition_key: str, now: int
) -> dict[str, Any]:
    require_adapter_version(payload.get("adapterVersion"), ADAPTER_VERSION)
    operation_key = require_opaque_key(payload.get("operationKey"), "operation_key")
    resource_operation_key = require_opaque_key(
        payload.get("resourceOperationKey"), "resource_operation_key"
    )
    generation = require_generation(payload.get("generation"))
    if payload.get("decision") != "quarantine_no_replay":
        raise AdapterInputError("invalid_disposition")
    row = _get(_send_key(operation_key))
    if (
        not row
        or row.get("resourceOperationKey") != resource_operation_key
        or row.get("generation") != generation
        or row.get("adapterVersion") != ADAPTER_VERSION
    ):
        raise AdapterInputError("operation_binding_conflict")
    if row.get("state") in {
        "quarantined_no_replay",
        "event_confirmed_after_disposition",
    }:
        return _public_send(row)
    if row.get("state") != "external_attempted":
        raise AdapterInputError("send_not_ambiguous")
    created_at = row.get("createdAt")
    if not isinstance(created_at, int):
        raise AdapterInputError("send_receipt_invalid")
    eligible_at = created_at + AMBIGUOUS_DISPOSITION_MIN_AGE_SECONDS
    if now < eligible_at:
        raise AdapterRetryableError("disposition_review_wait", eligible_at - now)
    authorized_at, authorization_receipt = verify_disposition_authorization(
        payload,
        disposition_key,
        operation_key=operation_key,
        resource_operation_key=resource_operation_key,
        generation=generation,
        now=now,
    )
    try:
        _client("dynamodb").transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"pk": {"S": _send_key(operation_key)}},
                        "UpdateExpression": (
                            "SET #state=:quarantined, code=:code, "
                            "dispositionAuthorizedAt=:authorizedAt, "
                            "dispositionReceipt=:receipt, updatedAt=:now"
                        ),
                        "ConditionExpression": (
                            "#state=:external AND resourceOperationKey=:resource "
                            "AND generation=:generation AND adapterVersion=:version "
                            "AND createdAt <= :eligibleCutoff"
                        ),
                        "ExpressionAttributeNames": {"#state": "state"},
                        "ExpressionAttributeValues": {
                            ":quarantined": {"S": "quarantined_no_replay"},
                            ":external": {"S": "external_attempted"},
                            ":code": {
                                "S": "owner_reviewed_no_replay_disposition"
                            },
                            ":authorizedAt": {"N": str(authorized_at)},
                            ":receipt": {"S": authorization_receipt},
                            ":now": {"N": str(now)},
                            ":eligibleCutoff": {
                                "N": str(
                                    now - AMBIGUOUS_DISPOSITION_MIN_AGE_SECONDS
                                )
                            },
                            ":resource": {"S": resource_operation_key},
                            ":generation": {"N": str(generation)},
                            ":version": {"S": ADAPTER_VERSION},
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {
                            "pk": {"S": _resource_key(resource_operation_key)}
                        },
                        "UpdateExpression": (
                            "SET updatedAt=:now ADD unsettledSendCount :minusOne"
                        ),
                        "ConditionExpression": (
                            "generation=:generation AND adapterVersion=:version "
                            "AND (#state=:ready OR #state=:blocked) "
                            "AND unsettledSendCount >= :one"
                        ),
                        "ExpressionAttributeNames": {"#state": "state"},
                        "ExpressionAttributeValues": {
                            ":minusOne": {"N": "-1"},
                            ":one": {"N": "1"},
                            ":generation": {"N": str(generation)},
                            ":version": {"S": ADAPTER_VERSION},
                            ":ready": {"S": "ready"},
                            ":blocked": {"S": "blocked"},
                            ":now": {"N": str(now)},
                        },
                    }
                },
            ]
        )
    except Exception as exc:
        current = _get(_send_key(operation_key))
        if current and current.get("state") in {
            "quarantined_no_replay",
            "event_confirmed_after_disposition",
        }:
            return _public_send(current)
        raise AdapterRetryableError("disposition_settlement_unavailable") from exc
    row = _get(_send_key(operation_key))
    if not row:
        raise AdapterRetryableError("disposition_settlement_unavailable")
    metric("api", "terminal")
    return _public_send(row)


def _begin_send(
    operation_key: str,
    resource_operation_key: str,
    generation: int,
    message_binding: str,
    now: int,
) -> tuple[dict[str, Any], bool]:
    if not isinstance(message_binding, str) or not re.fullmatch(
        r"[a-f0-9]{64}", message_binding
    ):
        raise AdapterInputError("send_receipt_invalid")
    existing = _get(_send_key(operation_key))
    if existing:
        if (
            existing.get("resourceOperationKey") != resource_operation_key
            or existing.get("generation") != generation
            or existing.get("adapterVersion") != ADAPTER_VERSION
            or existing.get("messageBinding") != message_binding
        ):
            raise AdapterInputError("operation_binding_conflict")
        return existing, False

    resource = _get(_resource_key(resource_operation_key))
    if not resource or not _resource_binding_is_valid(
        resource, resource_operation_key, generation
    ):
        raise AdapterInputError("resource_not_sendable")
    wait = _pacing_wait(resource, resource_operation_key, now)
    if wait > 0:
        raise AdapterRetryableError("sender_pacing_wait", wait)
    settled_days = resource.get("warmupSettledDayCount", 0)
    if not isinstance(settled_days, int) or settled_days < 0:
        raise AdapterInputError("resource_not_sendable")
    day = utc_day(now)
    daily_cap = warmup_daily_cap(settled_days)

    item = {
        "pk": {"S": _send_key(operation_key)},
        "kind": {"S": "send"},
        "state": {"S": "external_attempted"},
        "resourceOperationKey": {"S": resource_operation_key},
        "generation": {"N": str(generation)},
        "adapterVersion": {"S": ADAPTER_VERSION},
        "messageBinding": {"S": message_binding},
        "createdAt": {"N": str(now)},
        "updatedAt": {"N": str(now)},
    }
    try:
        _client("dynamodb").transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": TABLE_NAME,
                        "Item": item,
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"pk": {"S": _resource_key(resource_operation_key)}},
                        "UpdateExpression": (
                            "SET updatedAt=:now, lastSendAttemptAt=:now "
                            "ADD unsettledSendCount :one"
                        ),
                        "ConditionExpression": (
                            "generation=:generation AND adapterVersion=:version "
                            "AND #state=:ready AND "
                            "(attribute_not_exists(lastSendAttemptAt) "
                            "OR lastSendAttemptAt <= :spacingCutoff)"
                        ),
                        "ExpressionAttributeNames": {"#state": "state"},
                        "ExpressionAttributeValues": {
                            ":one": {"N": "1"},
                            ":now": {"N": str(now)},
                            ":spacingCutoff": {
                                "N": str(now - MIN_SEND_SPACING_SECONDS)
                            },
                            ":generation": {"N": str(generation)},
                            ":version": {"S": ADAPTER_VERSION},
                            ":ready": {"S": "ready"},
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {
                            "pk": {"S": _pacing_key(resource_operation_key, day)}
                        },
                        "UpdateExpression": (
                            "SET expiresAt=:expires, updatedAt=:now ADD #count :one"
                        ),
                        "ConditionExpression": (
                            "attribute_not_exists(#count) OR #count < :cap"
                        ),
                        "ExpressionAttributeNames": {"#count": "count"},
                        "ExpressionAttributeValues": {
                            ":one": {"N": "1"},
                            ":cap": {"N": str(daily_cap)},
                            ":now": {"N": str(now)},
                            ":expires": {"N": str(now + 8 * 86_400)},
                        },
                    }
                },
            ]
        )
    except Exception as exc:
        existing = _get(_send_key(operation_key))
        if existing:
            if (
                existing.get("resourceOperationKey") != resource_operation_key
                or existing.get("generation") != generation
                or existing.get("adapterVersion") != ADAPTER_VERSION
                or existing.get("messageBinding") != message_binding
            ):
                raise AdapterInputError("operation_binding_conflict") from exc
            return existing, False
        resource = _get(_resource_key(resource_operation_key))
        if not resource or not _resource_binding_is_valid(
            resource, resource_operation_key, generation
        ):
            raise AdapterInputError("resource_not_sendable") from exc
        wait = _pacing_wait(resource, resource_operation_key, now)
        if wait > 0:
            raise AdapterRetryableError("sender_pacing_wait", wait) from exc
        raise AdapterRetryableError("send_marker_unavailable") from exc
    row = _get(_send_key(operation_key))
    if not row:
        raise AdapterRetryableError("send_marker_unavailable")
    return row, True


def _send(
    payload: dict[str, Any], secrets: dict[str, str], now: int
) -> dict[str, Any]:
    require_adapter_version(payload.get("adapterVersion"), ADAPTER_VERSION)
    operation_key = require_opaque_key(payload.get("operationKey"), "operation_key")
    resource_operation_key = require_opaque_key(
        payload.get("resourceOperationKey"), "resource_operation_key"
    )
    generation = require_generation(payload.get("generation"))
    resource = _get(_resource_key(resource_operation_key))
    if not resource or not _resource_binding_is_valid(
        resource, resource_operation_key, generation
    ):
        raise AdapterInputError("resource_not_sendable")
    from_email = resource.get("fromEmail")
    identity_arn = resource.get("identityArn")
    configuration_set_name = resource.get("configurationSetName")
    tenant_name = resource.get("tenantName")
    if (
        not isinstance(from_email, str)
        or not isinstance(identity_arn, str)
        or not isinstance(configuration_set_name, str)
        or not isinstance(tenant_name, str)
    ):
        raise AdapterInputError("resource_not_sendable")

    to_email = normalize_address(payload.get("toEmail"))
    if not to_email:
        raise AdapterInputError("invalid_recipient")
    reply_to = require_reply_alias(payload.get("replyTo"), RELAY_DOMAIN)
    unsubscribe_url = require_https_url(payload.get("unsubscribeUrl"), "unsubscribe_url")
    unsubscribe = urlsplit(unsubscribe_url)
    if (
        f"{unsubscribe.scheme}://{unsubscribe.netloc}" != UNSUBSCRIBE_ORIGIN
        or not unsubscribe.path.startswith("/unsubscribe/")
    ):
        raise AdapterInputError("invalid_unsubscribe_url")
    raw_message = build_raw_message(
        from_email=from_email,
        to_email=to_email,
        display_name=payload.get("displayName"),
        subject=payload.get("subject"),
        text=payload.get("text"),
        reply_to=reply_to,
        unsubscribe_url=unsubscribe_url,
    )
    message_binding = derive_send_message_binding(
        secrets.get("resourceKey", ""),
        operation_key,
        resource_operation_key,
        generation,
        raw_message,
    )

    row, claimed_new = _begin_send(
        operation_key,
        resource_operation_key,
        generation,
        message_binding,
        now,
    )
    if row.get("state") != "external_attempted":
        return _public_send(row)
    if not claimed_new:
        # A previous request crossed the provider boundary. It may be reconciled
        # only by a signed SES event; calling SendEmail again is forbidden.
        metric("api", "ambiguous")
        return _public_send(row)

    ses = _ses_send_client()
    try:
        response = ses.send_email(
            FromEmailAddress=from_email,
            FromEmailAddressIdentityArn=identity_arn,
            Destination={"ToAddresses": [to_email]},
            Content={"Raw": {"Data": raw_message}},
            EmailTags=[
                {"Name": "pentraAttempt", "Value": operation_key},
                {"Name": "pentraAdapter", "Value": ADAPTER_VERSION},
            ],
            ConfigurationSetName=configuration_set_name,
            TenantName=tenant_name,
        )
        message_id = response.get("MessageId")
        if not isinstance(message_id, str) or not 1 <= len(message_id) <= 256:
            raise AdapterRetryableError("provider_receipt_incomplete")
    except AdapterRetryableError:
        raise
    except Exception as exc:
        code = _error_code(exc)
        if code in {
            "AccountSuspendedException",
            "BadRequestException",
            "MailFromDomainNotVerifiedException",
            "MessageRejected",
            "SendingPausedException",
        }:
            metric("api", "provider_rejected")
            return _public_send(
                _mark_send_terminal(
                    operation_key,
                    resource_operation_key,
                    generation,
                    "terminal_rejected",
                    now,
                    code="provider_rejected",
                    expected_message_binding=message_binding,
                )
            )
        # Network, timeout, throttling, and 5xx paths are ambiguous. The durable
        # marker remains unsettled and this operation can never be replayed.
        metric("api", "ambiguous")
        raise AdapterRetryableError("provider_attempt_ambiguous") from exc

    metric("api", "accepted")
    return _public_send(
        _mark_send_terminal(
            operation_key,
            resource_operation_key,
            generation,
            "submitted",
            now,
            provider_message_id_digest=sha256_hex(message_id),
            expected_message_binding=message_binding,
        )
    )


def _delete_external_resource(
    ses: Any,
    tenant_name: str,
    identity_arn: str,
    configuration_set_arn: str,
) -> None:
    for resource_arn in (configuration_set_arn, identity_arn):
        try:
            ses.delete_tenant_resource_association(
                TenantName=tenant_name, ResourceArn=resource_arn
            )
        except Exception as exc:
            if not _provider_is_not_found(exc):
                raise
    try:
        ses.delete_tenant(TenantName=tenant_name)
    except Exception as exc:
        if not _provider_is_not_found(exc):
            raise


def _tenant_is_absent(ses: Any, tenant_name: str) -> bool:
    try:
        ses.get_tenant(TenantName=tenant_name)
        return False
    except Exception as exc:
        if _provider_is_not_found(exc):
            return True
        raise


def _mark_release_verifying(
    operation_key: str, generation: int, now: int
) -> dict[str, Any]:
    verify_after = now + RELEASE_STABILITY_SECONDS
    _client("dynamodb").update_item(
        TableName=TABLE_NAME,
        Key={"pk": {"S": _resource_key(operation_key)}},
        UpdateExpression=(
            "SET #state=:verifying, releaseVerifyAfter=:verifyAfter, updatedAt=:now "
            "REMOVE provisionLeaseToken, provisionLeaseExpiresAt"
        ),
        ConditionExpression="generation=:generation AND #state=:releasing",
        ExpressionAttributeNames={"#state": "state"},
        ExpressionAttributeValues={
            ":verifying": {"S": "release_verifying"},
            ":releasing": {"S": "releasing"},
            ":verifyAfter": {"N": str(verify_after)},
            ":now": {"N": str(now)},
            ":generation": {"N": str(generation)},
        },
    )
    row = _get(_resource_key(operation_key))
    if not row:
        raise AdapterRetryableError("release_settlement_unavailable")
    return row


def _seal_missing_release(
    operation_key: str, generation: int, now: int
) -> dict[str, Any]:
    tombstone = {
        "pk": {"S": _resource_key(operation_key)},
        "kind": {"S": "resource"},
        "state": {"S": "released"},
        "releaseTombstone": {"BOOL": True},
        "generation": {"N": str(generation)},
        "adapterVersion": {"S": ADAPTER_VERSION},
        "releasedAt": {"N": str(now)},
        "createdAt": {"N": str(now)},
        "updatedAt": {"N": str(now)},
    }
    try:
        _client("dynamodb").put_item(
            TableName=TABLE_NAME,
            Item=tombstone,
            ConditionExpression="attribute_not_exists(pk)",
        )
    except Exception as exc:
        row = _get(_resource_key(operation_key))
        if row:
            return row
        raise AdapterRetryableError("release_settlement_unavailable") from exc
    row = _get(_resource_key(operation_key))
    if not row:
        raise AdapterRetryableError("release_settlement_unavailable")
    return row


def _release(payload: dict[str, Any], now: int) -> dict[str, Any]:
    require_adapter_version(payload.get("adapterVersion"), ADAPTER_VERSION)
    operation_key = require_opaque_key(payload.get("operationKey"), "operation_key")
    generation = require_generation(payload.get("generation"))
    row = _get(_resource_key(operation_key))
    if not row:
        row = _seal_missing_release(operation_key, generation, now)
    if row.get("generation") != generation or row.get("adapterVersion") != ADAPTER_VERSION:
        raise AdapterInputError("operation_binding_conflict")
    if row.get("state") == "released":
        return _public_resource(row)
    if int(row.get("unsettledSendCount", 0)) != 0:
        raise AdapterRetryableError("resource_has_unsettled_send")
    if (
        row.get("state") == "provisioning"
        and isinstance(row.get("provisionLeaseExpiresAt"), int)
        and row["provisionLeaseExpiresAt"] > now
    ):
        raise AdapterRetryableError(
            "resource_provision_in_flight", row["provisionLeaseExpiresAt"] - now
        )
    if row.get("state") == "provisioning" and isinstance(
        row.get("provisionExternalAttemptedAt"), int
    ):
        ambiguity_until = (
            row["provisionExternalAttemptedAt"] + PROVISION_AMBIGUITY_SECONDS
        )
        if ambiguity_until > now:
            raise AdapterRetryableError(
                "resource_provision_ambiguous", ambiguity_until - now
            )

    tenant_name = row.get("tenantName")
    identity_arn = row.get("identityArn")
    configuration_set_arn = row.get("configurationSetArn")
    if (
        not isinstance(tenant_name, str)
        or not isinstance(identity_arn, str)
        or not isinstance(configuration_set_arn, str)
    ):
        raise AdapterRetryableError("release_receipt_invalid")
    ses = _client("sesv2")

    if row.get("state") == "release_verifying":
        verify_after = row.get("releaseVerifyAfter")
        if not isinstance(verify_after, int) or verify_after > now:
            return _public_resource(row)
        try:
            _delete_external_resource(
                ses,
                tenant_name,
                identity_arn,
                configuration_set_arn,
            )
            if not _tenant_is_absent(ses, tenant_name):
                raise AdapterRetryableError("provider_release_retry")
        except AdapterRetryableError:
            _client("dynamodb").update_item(
                TableName=TABLE_NAME,
                Key={"pk": {"S": _resource_key(operation_key)}},
                UpdateExpression="SET releaseVerifyAfter=:next, updatedAt=:now",
                ConditionExpression=(
                    "generation=:generation AND #state=:verifying"
                ),
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    ":next": {"N": str(now + RELEASE_STABILITY_SECONDS)},
                    ":now": {"N": str(now)},
                    ":generation": {"N": str(generation)},
                    ":verifying": {"S": "release_verifying"},
                },
            )
            raise
        except Exception as exc:
            raise AdapterRetryableError("provider_release_retry") from exc

        try:
            _client("dynamodb").update_item(
                TableName=TABLE_NAME,
                Key={"pk": {"S": _resource_key(operation_key)}},
                UpdateExpression=(
                    "SET #state=:released, releasedAt=:now, updatedAt=:now "
                    "REMOVE tenantName, fromEmail, resourceReceipt, "
                    "releaseVerifyAfter"
                ),
                ConditionExpression=(
                    "generation=:generation AND #state=:verifying "
                    "AND releaseVerifyAfter <= :now"
                ),
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    ":released": {"S": "released"},
                    ":verifying": {"S": "release_verifying"},
                    ":now": {"N": str(now)},
                    ":generation": {"N": str(generation)},
                },
            )
        except Exception as exc:
            current = _get(_resource_key(operation_key))
            if current and current.get("state") == "released":
                return _public_resource(current)
            raise AdapterRetryableError("release_settlement_unavailable") from exc
        metric("api", "released")
        return _public_resource(_get(_resource_key(operation_key)))

    try:
        _client("dynamodb").update_item(
            TableName=TABLE_NAME,
            Key={"pk": {"S": _resource_key(operation_key)}},
            UpdateExpression="SET #state=:releasing, updatedAt=:now",
            ConditionExpression=(
                "generation=:generation AND unsettledSendCount=:zero "
                "AND (#state=:ready OR #state=:provisioning OR #state=:blocked "
                "OR #state=:releasing) AND "
                "(attribute_not_exists(provisionLeaseExpiresAt) "
                "OR provisionLeaseExpiresAt <= :now)"
            ),
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":releasing": {"S": "releasing"},
                ":ready": {"S": "ready"},
                ":provisioning": {"S": "provisioning"},
                ":blocked": {"S": "blocked"},
                ":zero": {"N": "0"},
                ":now": {"N": str(now)},
                ":generation": {"N": str(generation)},
            },
        )
    except Exception as exc:
        current = _get(_resource_key(operation_key))
        if current and current.get("state") == "released":
            return _public_resource(current)
        raise AdapterRetryableError("release_claim_unavailable") from exc

    try:
        _delete_external_resource(
            ses,
            tenant_name,
            identity_arn,
            configuration_set_arn,
        )
    except Exception as exc:
        raise AdapterRetryableError("provider_release_retry") from exc
    # A second not-found inspection after the provider-call lease horizon is
    # mandatory. This makes release delete-wins even if a timed-out CreateTenant
    # materializes after the first delete request.
    return _public_resource(
        _mark_release_verifying(operation_key, generation, now)
    )


def _status(payload: dict[str, Any], now: int) -> dict[str, Any]:
    require_adapter_version(payload.get("adapterVersion"), ADAPTER_VERSION)
    operation_key = require_opaque_key(payload.get("operationKey"), "operation_key")
    kind = payload.get("kind")
    if kind == "resource":
        row = _get(_resource_key(operation_key))
        if row and row.get("state") in {"ready", "blocked"}:
            generation = row.get("generation")
            structurally_ready = {
                **row,
                "state": "ready",
            }
            if (
                not isinstance(generation, int)
                or row.get("state") == "blocked"
                and row.get("code") != "provider_resource_invalid"
                or not _resource_binding_is_valid(
                    structurally_ready, operation_key, generation
                )
            ):
                return {
                    "state": "blocked",
                    "code": "resource_receipt_invalid",
                    "adapterVersion": ADAPTER_VERSION,
                }
            tenant_name = row.get("tenantName")
            identity_arn = row.get("identityArn")
            configuration_set_arn = row.get("configurationSetArn")
            if not all(
                isinstance(value, str)
                for value in (tenant_name, identity_arn, configuration_set_arn)
            ):
                return {
                    "state": "blocked",
                    "code": "resource_receipt_invalid",
                    "adapterVersion": ADAPTER_VERSION,
                }
            try:
                provider_ready = _verify_resource(
                    _client("sesv2"),
                    tenant_name,
                    operation_key,
                    identity_arn,
                    configuration_set_arn,
                )
                _client("dynamodb").update_item(
                    TableName=TABLE_NAME,
                    Key={"pk": {"S": _resource_key(operation_key)}},
                    UpdateExpression=(
                        (
                            "SET #state=:state, updatedAt=:now, verifiedAt=:now "
                            "REMOVE code"
                        )
                        if provider_ready
                        else "SET #state=:state, updatedAt=:now, code=:code"
                    ),
                    ConditionExpression=(
                        "generation=:generation AND adapterVersion=:version "
                        "AND tenantName=:tenant AND identityArn=:identity "
                        "AND configurationSetArn=:configuration "
                        "AND (#state=:ready OR #state=:blocked)"
                    ),
                    ExpressionAttributeNames={"#state": "state"},
                    ExpressionAttributeValues={
                        ":state": {
                            "S": "ready" if provider_ready else "blocked"
                        },
                        ":ready": {"S": "ready"},
                        ":blocked": {"S": "blocked"},
                        ":now": {"N": str(now)},
                        ":generation": {"N": str(generation)},
                        ":version": {"S": ADAPTER_VERSION},
                        ":tenant": {"S": tenant_name},
                        ":identity": {"S": identity_arn},
                        ":configuration": {"S": configuration_set_arn},
                        **(
                            {
                                ":code": {"S": "provider_resource_invalid"}
                            }
                            if not provider_ready
                            else {}
                        ),
                    },
                )
            except Exception as exc:
                raise AdapterRetryableError("provider_status_retry") from exc
            row = _get(_resource_key(operation_key))
        return _public_resource(row)
    if kind == "send":
        return _public_send(_get(_send_key(operation_key)))
    raise AdapterInputError("invalid_status_kind")


def _parse_event(event: dict[str, Any]) -> tuple[str, str, bytes, dict[str, Any]]:
    request = event.get("requestContext")
    http = request.get("http") if isinstance(request, dict) else None
    method = http.get("method") if isinstance(http, dict) else event.get("httpMethod")
    path = event.get("rawPath") or event.get("path")
    if not isinstance(method, str) or not isinstance(path, str):
        raise AdapterInputError("request_invalid")
    raw_body = event.get("body", "")
    if not isinstance(raw_body, str):
        raise AdapterInputError("request_invalid")
    try:
        body = base64.b64decode(raw_body, validate=True) if event.get("isBase64Encoded") else raw_body.encode("utf-8")
    except (ValueError, UnicodeError) as exc:
        raise AdapterInputError("request_invalid") from exc
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise AdapterInputError("request_invalid")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AdapterInputError("request_invalid") from exc
    if not isinstance(payload, dict) or payload.get("version") != ADAPTER_PROTOCOL_VERSION:
        raise AdapterInputError("request_invalid")
    return method, path, body, payload


def _api_response(
    status: int,
    payload: dict[str, Any],
    *,
    secrets: dict[str, str] | None = None,
    request_nonce: str | None = None,
    retry_after: int | None = None,
) -> dict[str, Any]:
    body = deterministic_json({"version": ADAPTER_PROTOCOL_VERSION, **payload})
    headers = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    }
    if retry_after is not None:
        headers["retry-after"] = str(retry_after)
    if secrets and request_nonce:
        timestamp = int(time.time())
        signing_key = secrets[secrets["signWith"]]
        headers.update(
            {
                "x-pentra-response-timestamp": str(timestamp),
                "x-pentra-response-signature": response_signature(
                    signing_key, request_nonce, timestamp, body
                ),
                "x-pentra-adapter-version": ADAPTER_VERSION,
            }
        )
    return {"statusCode": status, "headers": headers, "body": body.decode("utf-8")}


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    secrets: dict[str, str] | None = None
    request_nonce: str | None = None
    try:
        method, path, body, payload = _parse_event(event)
        if method.upper() != "POST":
            raise AdapterInputError("method_not_allowed")
        secrets = _load_secrets()
        request_nonce, _ = verify_request_signature(
            event.get("headers") or {},
            method=method,
            path=path,
            body=body,
            secrets=secrets,
        )
        now = int(time.time())
        _put_nonce(request_nonce, now)
        routes = {
            "/v1/provision": lambda: _provision(payload, secrets, now),
            "/v1/status": lambda: _status(payload, now),
            "/v1/send": lambda: _send(payload, secrets, now),
            "/v1/disposition": lambda: _disposition(
                payload, _load_disposition_key(), now
            ),
            "/v1/release": lambda: _release(payload, now),
        }
        route = routes.get(path)
        if route is None:
            raise AdapterInputError("route_not_found")
        return _api_response(
            200, {"ok": True, "receipt": route()}, secrets=secrets, request_nonce=request_nonce
        )
    except AdapterInputError as exc:
        metric("api", "auth_rejected" if str(exc).startswith("request_auth") else "invalid")
        status = 401 if str(exc).startswith("request_auth") else 409 if str(exc) == "request_replay" else 400
        return _api_response(
            status,
            {"ok": False, "code": safe_code(str(exc))},
            secrets=secrets,
            request_nonce=request_nonce,
        )
    except AdapterRetryableError as exc:
        metric("api", "retried", retryAfter=exc.retry_after)
        return _api_response(
            503,
            {"ok": False, "code": exc.code},
            secrets=secrets,
            request_nonce=request_nonce,
            retry_after=exc.retry_after,
        )
    except Exception:
        metric("api", "invalid")
        return _api_response(
            500,
            {"ok": False, "code": "internal_error"},
            secrets=secrets,
            request_nonce=request_nonce,
        )
