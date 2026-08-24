from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import sweeper  # noqa: E402

NOW = 1_787_500_000


class FakeS3:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def list_objects_v2(self, **_kwargs):
        return {
            "IsTruncated": False,
            "Contents": [
                {
                    "Key": "raw/stale-message",
                    "LastModified": datetime.fromtimestamp(NOW - 20_701, timezone.utc),
                },
                {
                    "Key": "raw/fresh-message",
                    "LastModified": datetime.fromtimestamp(NOW - 20_699, timezone.utc),
                },
                {
                    "Key": "not-raw/ignored",
                    "LastModified": datetime.fromtimestamp(NOW - 99_999, timezone.utc),
                },
            ],
        }

    def delete_objects(self, **kwargs):
        self.deleted.extend(item["Key"] for item in kwargs["Delete"]["Objects"])
        return {"Deleted": kwargs["Delete"]["Objects"]}


class FakeDdb:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def scan(self, **_kwargs):
        return {"Items": [{"pk": {"S": "proof#expired"}}]}

    def delete_item(self, **kwargs):
        self.deleted.append(kwargs["Key"]["pk"]["S"])


class SweeperTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.update(RAW_BUCKET_NAME="relay-raw-test", STATE_TABLE_NAME="state")
        self.s3 = FakeS3()
        self.ddb = FakeDdb()
        sweeper._s3_client = self.s3
        sweeper._ddb_client = self.ddb

    def tearDown(self) -> None:
        sweeper._s3_client = None
        sweeper._ddb_client = None

    def test_safety_margin_deletes_only_stale_raw_and_expired_state(self) -> None:
        self.assertEqual(sweeper.sweep(NOW), (1, 1))
        self.assertEqual(self.s3.deleted, ["raw/stale-message"])
        self.assertEqual(self.ddb.deleted, ["proof#expired"])


if __name__ == "__main__":
    unittest.main()
