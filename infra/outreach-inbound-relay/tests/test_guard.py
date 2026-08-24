from __future__ import annotations

import contextlib
import io
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import guard  # noqa: E402

NOW = 1_787_500_000
TOKEN = "abcdefghijklmnopqrstuvwxyz012345"
DOMAIN = "inbound.pentra.example"


class FakeDdb:
    def __init__(self, reject: bool = False) -> None:
        self.reject = reject
        self.items: dict[str, dict] = {}
        self.transactions: list[dict] = []

    def transact_write_items(self, **kwargs):
        self.transactions.append(kwargs)
        item = kwargs["TransactItems"][0]["Put"]["Item"]
        key = item["pk"]["S"]
        if self.reject or key in self.items:
            raise RuntimeError("conditional")
        self.items[key] = item

    def get_item(self, **kwargs):
        return {"Item": self.items.get(kwargs["Key"]["pk"]["S"])}


def event(
    *,
    alias_kind: str = "reply",
    dmarc: str = "PASS",
    dkim: str = "GRAY",
    spf: str = "PASS",
    spam: str = "PASS",
    virus: str = "PASS",
    from_value: str = "Editor <editor@example.org>",
    message_id: str = "ses-message-abcdefgh",
    recipients: list[str] | None = None,
) -> dict:
    stamp = datetime.fromtimestamp(NOW, timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "Records": [
            {
                "eventSource": "aws:ses",
                "ses": {
                    "mail": {
                        "timestamp": stamp,
                        "messageId": message_id,
                        "headersTruncated": False,
                        "headers": [
                            {
                                "name": "Received",
                                "value": (
                                    "from mx.example ([203.0.113.9]) by "
                                    "inbound-smtp.us-east-1.amazonaws.com with SMTP"
                                ),
                            },
                            {
                                "name": "Received",
                                "value": (
                                    "from attacker ([198.51.100.3]) by evil.example"
                                ),
                            },
                        ],
                        "commonHeaders": {"from": [from_value]},
                    },
                    "receipt": {
                        "timestamp": stamp,
                        "recipients": recipients or [f"{alias_kind}-{TOKEN}@{DOMAIN}"],
                        "spamVerdict": {"status": spam},
                        "virusVerdict": {"status": virus},
                        "spfVerdict": {"status": spf},
                        "dkimVerdict": {"status": dkim},
                        "dmarcVerdict": {"status": dmarc},
                        "action": {
                            "type": "Lambda",
                            "invocationType": "RequestResponse",
                        },
                    },
                },
            }
        ]
    }


class GuardTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.update(RELAY_DOMAIN=DOMAIN, STATE_TABLE_NAME="state")
        self.ddb = FakeDdb()
        guard._ddb_client = self.ddb

    def tearDown(self) -> None:
        guard._ddb_client = None

    def test_exact_reply_and_dsn_aliases_are_separate_rate_keys(self) -> None:
        self.assertEqual(guard.evaluate(event(alias_kind="reply"), NOW), "CONTINUE")
        self.assertEqual(
            guard.evaluate(
                event(alias_kind="dsn", message_id="ses-message-dsn12345"), NOW
            ),
            "CONTINUE",
        )
        reply_keys = [
            action["Update"]["Key"]["pk"]["S"]
            for action in self.ddb.transactions[0]["TransactItems"][1:]
        ]
        dsn_keys = [
            action["Update"]["Key"]["pk"]["S"]
            for action in self.ddb.transactions[1]["TransactItems"][1:]
        ]
        self.assertTrue(any("rate#alias#reply#" in key for key in reply_keys))
        self.assertTrue(any("rate#alias#dsn#" in key for key in dsn_keys))
        values = self.ddb.transactions[0]["TransactItems"]
        self.assertEqual(
            values[1]["Update"]["ExpressionAttributeValues"][":limit"]["N"], "10"
        )
        self.assertEqual(
            values[2]["Update"]["ExpressionAttributeValues"][":limit"]["N"], "60"
        )

    def test_bare_spf_and_spoofed_or_unsafe_verdicts_fail_closed(self) -> None:
        self.assertEqual(
            guard.evaluate(event(dmarc="GRAY", dkim="GRAY", spf="PASS"), NOW),
            "STOP_RULE_SET",
        )
        self.assertEqual(guard.evaluate(event(spam="FAIL"), NOW), "STOP_RULE_SET")
        self.assertEqual(guard.evaluate(event(virus="GRAY"), NOW), "STOP_RULE_SET")
        self.assertEqual(
            guard.evaluate(
                event(recipients=[f"reply-{TOKEN}@{DOMAIN}", f"dsn-{TOKEN}@{DOMAIN}"]),
                NOW,
            ),
            "STOP_RULE_SET",
        )
        self.assertEqual(
            guard.evaluate(event(recipients=[f"other-{TOKEN}@{DOMAIN}"]), NOW),
            "STOP_RULE_SET",
        )

    def test_ses_aligned_dkim_pass_is_admitted_and_bound_to_from_hash(self) -> None:
        self.assertEqual(
            guard.evaluate(event(dmarc="GRAY", dkim="PASS", spf="FAIL"), NOW),
            "CONTINUE",
        )
        proof = self.ddb.transactions[0]["TransactItems"][0]["Put"]["Item"]
        self.assertEqual(proof["authenticationMethod"]["S"], "dkim")
        self.assertNotIn("editor@example.org", str(proof["fromHash"]))
        self.assertEqual(
            set(proof),
            {
                "pk",
                "recordType",
                "proofDigest",
                "recipient",
                "recipientKind",
                "fromHash",
                "authenticationMethod",
                "receivedAt",
                "expiresAt",
            },
        )

    def test_untrusted_received_header_and_dynamodb_failure_fail_closed(self) -> None:
        candidate = event()
        candidate["Records"][0]["ses"]["mail"]["headers"].reverse()
        self.assertEqual(guard.evaluate(candidate, NOW), "STOP_RULE_SET")
        guard._ddb_client = FakeDdb(reject=True)
        self.assertEqual(guard.evaluate(event(), NOW), "STOP_RULE_SET")

    def test_at_least_once_guard_replay_does_not_increment_again(self) -> None:
        candidate = event()
        self.assertEqual(guard.evaluate(candidate, NOW), "CONTINUE")
        self.assertEqual(guard.evaluate(candidate, NOW), "CONTINUE")
        self.assertEqual(len(self.ddb.items), 1)
        self.assertEqual(len(self.ddb.transactions), 2)

    def test_same_provider_id_with_changed_evidence_fails_as_collision(self) -> None:
        self.assertEqual(guard.evaluate(event(), NOW), "CONTINUE")
        self.assertEqual(
            guard.evaluate(event(from_value="Attacker <attacker@evil.example>"), NOW),
            "STOP_RULE_SET",
        )

    def test_redacted_log_contains_no_alias_address_or_source_ip(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            guard.evaluate(event(), NOW)
        logged = output.getvalue()
        self.assertNotIn(TOKEN, logged)
        self.assertNotIn("editor@example.org", logged)
        self.assertNotIn("203.0.113.9", logged)


if __name__ == "__main__":
    unittest.main()
