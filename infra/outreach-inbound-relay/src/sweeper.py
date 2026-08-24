"""Six-hour raw-MIME and ephemeral-state retention sweeper."""

from __future__ import annotations

import os
import time
from datetime import timezone
from typing import Any

from relay_common import RAW_PURGE_AGE_SECONDS, metric

_s3_client: Any | None = None
_ddb_client: Any | None = None


def _client(service: str) -> Any:
    global _s3_client, _ddb_client
    slot = "_s3_client" if service == "s3" else "_ddb_client"
    existing = globals()[slot]
    if existing is None:
        import boto3

        existing = boto3.client(service)
        globals()[slot] = existing
    return existing


def sweep(now_seconds: int | None = None) -> tuple[int, int]:
    now_seconds = int(time.time()) if now_seconds is None else int(now_seconds)
    cutoff = now_seconds - RAW_PURGE_AGE_SECONDS
    bucket = os.environ["RAW_BUCKET_NAME"]
    table = os.environ["STATE_TABLE_NAME"]
    deleted_objects = 0
    deleted_rows = 0
    oldest_age_seconds = 0

    token: str | None = None
    while True:
        request: dict[str, Any] = {"Bucket": bucket, "Prefix": "raw/", "MaxKeys": 1_000}
        if token:
            request["ContinuationToken"] = token
        response = _client("s3").list_objects_v2(**request)
        stale: list[dict[str, str]] = []
        for candidate in response.get("Contents", []):
            if not isinstance(candidate, dict):
                continue
            key = candidate.get("Key")
            modified = candidate.get("LastModified")
            modified_seconds = (
                int(modified.astimezone(timezone.utc).timestamp())
                if hasattr(modified, "timestamp")
                else None
            )
            if (
                isinstance(key, str)
                and key.startswith("raw/")
                and isinstance(modified_seconds, int)
            ):
                oldest_age_seconds = max(
                    oldest_age_seconds,
                    max(0, now_seconds - modified_seconds),
                )
            if (
                isinstance(key, str)
                and key.startswith("raw/")
                and isinstance(modified_seconds, int)
                and modified_seconds <= cutoff
            ):
                stale.append({"Key": key})
        if stale:
            result = _client("s3").delete_objects(
                Bucket=bucket,
                Delete={"Objects": stale, "Quiet": True},
            )
            if result.get("Errors"):
                raise RuntimeError("sweeper_delete_failed")
            deleted_objects += len(stale)
        if not response.get("IsTruncated"):
            break
        token = response.get("NextContinuationToken")
        if not isinstance(token, str):
            raise RuntimeError("sweeper_pagination_failed")

    start_key: dict[str, Any] | None = None
    while True:
        request = {
            "TableName": table,
            "FilterExpression": "#expiresAt <= :now",
            "ProjectionExpression": "pk",
            "ExpressionAttributeNames": {"#expiresAt": "expiresAt"},
            "ExpressionAttributeValues": {":now": {"N": str(now_seconds)}},
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        response = _client("dynamodb").scan(**request)
        for item in response.get("Items", []):
            pk = item.get("pk") if isinstance(item, dict) else None
            if isinstance(pk, dict) and isinstance(pk.get("S"), str):
                _client("dynamodb").delete_item(
                    TableName=table,
                    Key={"pk": {"S": pk["S"]}},
                    ConditionExpression="#expiresAt <= :now",
                    ExpressionAttributeNames={"#expiresAt": "expiresAt"},
                    ExpressionAttributeValues={":now": {"N": str(now_seconds)}},
                )
                deleted_rows += 1
        start_key = response.get("LastEvaluatedKey")
        if not isinstance(start_key, dict) or not start_key:
            break

    metric(
        "sweeper",
        "deleted",
        deletedCount=min(deleted_objects + deleted_rows, 100_000),
        oldestAgeSeconds=min(oldest_age_seconds, 100_000),
    )
    return deleted_objects, deleted_rows


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    try:
        objects, rows = sweep()
        return {"deletedObjects": objects, "deletedRows": rows}
    except Exception:
        # Provider exceptions can contain object keys. Emit only a stable
        # aggregate signal and let EventBridge/Lambda perform its bounded retry.
        metric("sweeper", "internal_rejected")
        raise RuntimeError("sweeper_retry") from None
