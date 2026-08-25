from __future__ import annotations

import pathlib
import sys
import unittest

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import ledger_metrics  # noqa: E402


class FakeDynamo:
    def __init__(self, item_count=42):
        self.item_count = item_count

    def describe_table(self, **kwargs):
        if kwargs != {"TableName": "state"}:
            raise AssertionError("unexpected_table")
        return {"Table": {"ItemCount": self.item_count}}


class FakeCloudWatch:
    def __init__(self):
        self.calls = []

    def put_metric_data(self, **kwargs):
        self.calls.append(kwargs)
        return {}


class LedgerMetricTests(unittest.TestCase):
    def setUp(self):
        self.ddb = FakeDynamo()
        self.cloudwatch = FakeCloudWatch()
        ledger_metrics.TABLE_NAME = "state"
        ledger_metrics._CLIENTS.clear()
        ledger_metrics._CLIENTS.update(
            {"dynamodb": self.ddb, "cloudwatch": self.cloudwatch}
        )

    def test_emits_only_the_aggregate_table_count(self):
        result = ledger_metrics.handler({}, None)
        self.assertEqual(result, {"ok": True, "itemCount": 42})
        self.assertEqual(len(self.cloudwatch.calls), 1)
        call = self.cloudwatch.calls[0]
        self.assertEqual(call["Namespace"], "Pentra/ManagedSES")
        self.assertEqual(
            call["MetricData"][0]["MetricName"], "DurableLedgerItemCount"
        )
        self.assertEqual(call["MetricData"][0]["Value"], 42)
        self.assertEqual(
            set(call["MetricData"][0]),
            {"MetricName", "Dimensions", "Unit", "Value"},
        )

    def test_invalid_provider_shape_fails_with_a_finite_error(self):
        self.ddb.item_count = "not-a-count"
        with self.assertRaisesRegex(RuntimeError, "ledger_metric_unavailable"):
            ledger_metrics.handler({}, None)
        self.assertEqual(self.cloudwatch.calls, [])


if __name__ == "__main__":
    unittest.main()
