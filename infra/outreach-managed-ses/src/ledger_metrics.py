"""Emit one aggregate, content-free durability metric for the SES receipt ledger."""

from __future__ import annotations

import os
from typing import Any

try:  # Lambda includes boto3. Local tests inject clients without installing it.
    import boto3  # type: ignore
except ImportError:  # pragma: no cover - exercised only outside Lambda/tests
    boto3 = None

TABLE_NAME = os.environ.get("STATE_TABLE_NAME", "")
METRIC_NAMESPACE = "Pentra/ManagedSES"
METRIC_NAME = "DurableLedgerItemCount"

_CLIENTS: dict[str, Any] = {}


def _client(name: str) -> Any:
    if name in _CLIENTS:
        return _CLIENTS[name]
    if boto3 is None:
        raise RuntimeError("aws_sdk_unavailable")
    _CLIENTS[name] = boto3.client(name)
    return _CLIENTS[name]


def handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        response = _client("dynamodb").describe_table(TableName=TABLE_NAME)
        table = response.get("Table")
        item_count = table.get("ItemCount") if isinstance(table, dict) else None
        if (
            not isinstance(item_count, int)
            or isinstance(item_count, bool)
            or item_count < 0
        ):
            raise ValueError("invalid_item_count")
        _client("cloudwatch").put_metric_data(
            Namespace=METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": METRIC_NAME,
                    "Dimensions": [
                        {"Name": "TableName", "Value": TABLE_NAME}
                    ],
                    "Unit": "Count",
                    "Value": item_count,
                }
            ],
        )
        return {"ok": True, "itemCount": item_count}
    except Exception:
        # Do not let SDK responses or table metadata enter Lambda error logs.
        raise RuntimeError("ledger_metric_unavailable") from None
