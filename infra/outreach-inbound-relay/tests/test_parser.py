from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import parser  # noqa: E402
from relay_common import RelayInputError, RetryableRelayError, sha256_hex  # noqa: E402

NOW = 1_787_500_000
TOKEN = "abcdefghijklmnopqrstuvwxyz012345"
DOMAIN = "inbound.pentra.example"
REPLY_ALIAS = f"reply-{TOKEN}@{DOMAIN}"
DSN_ALIAS = f"dsn-{TOKEN}@{DOMAIN}"
OUTBOUND_ID = f"<pentra.{TOKEN}@sender.example>"
MESSAGE_KEY = "ses-message-abcdefgh"


def proof(kind: str = "reply", sender: str = "editor@example.org") -> dict:
    recipient = REPLY_ALIAS if kind == "reply" else DSN_ALIAS
    return {
        "pk": {"S": f"proof#{sha256_hex(MESSAGE_KEY)}"},
        "recipient": {"S": recipient},
        "recipientKind": {"S": kind},
        "fromHash": {"S": sha256_hex(sender)},
        "authenticationMethod": {"S": "dmarc"},
        "receivedAt": {"N": str(NOW * 1000)},
        "expiresAt": {"N": str(NOW + 21_600)},
    }


def reply_mime(body: str = "Thanks, I will review it.") -> bytes:
    return (
        "From: Editor <editor@example.org>\r\n"
        f"To: {REPLY_ALIAS}\r\n"
        "Message-ID: <reply-abcdefgh@example.org>\r\n"
        f"In-Reply-To: {OUTBOUND_ID}\r\n"
        f"References: {OUTBOUND_ID}\r\n"
        "Subject: Re: useful resource\r\n"
        "Auto-Submitted: no\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "\r\n"
        f"{body}"
    ).encode()


def dsn_mime(*, reply_alias: str = REPLY_ALIAS, message_id: str = OUTBOUND_ID) -> bytes:
    return (
        "From: Mailer Daemon <mailer-daemon@mx.example>\r\n"
        f"To: {DSN_ALIAS}\r\n"
        "Message-ID: <dsn-abcdefgh@mx.example>\r\n"
        "Subject: Delivery Status Notification (Failure)\r\n"
        "Content-Type: multipart/report; report-type=delivery-status; "
        "boundary=dsn-boundary\r\n"
        "\r\n"
        "--dsn-boundary\r\n"
        "Content-Type: text/plain\r\n\r\nDelivery failed.\r\n"
        "--dsn-boundary\r\n"
        "Content-Type: message/delivery-status\r\n\r\n"
        "Reporting-MTA: dns; mx.example\r\n\r\n"
        "Final-Recipient: rfc822; editor@example.org\r\n"
        "Original-Recipient: rfc822; editor@example.org\r\n"
        "Action: failed\r\n"
        "Status: 5.1.1\r\n\r\n"
        "--dsn-boundary\r\n"
        "Content-Type: message/rfc822\r\n\r\n"
        "From: Outreach <outreach@sender.example>\r\n"
        "To: editor@example.org\r\n"
        f"Reply-To: {reply_alias}\r\n"
        f"Message-ID: {message_id}\r\n"
        "Subject: resource\r\n\r\n"
        "Original body must be discarded.\r\n"
        "--dsn-boundary--\r\n"
    ).encode()


class Body:
    def __init__(self, value: bytes) -> None:
        self.value = value

    def read(self, maximum: int) -> bytes:
        return self.value[:maximum]


class FakeS3:
    def __init__(self, raw: bytes) -> None:
        self.raw = raw
        self.deleted: list[tuple[str, str]] = []

    def get_object(self, **_kwargs):
        return {"ContentLength": len(self.raw), "Body": Body(self.raw)}

    def delete_object(self, **kwargs):
        self.deleted.append((kwargs["Bucket"], kwargs["Key"]))


class FakeDdb:
    def __init__(self, item: dict | None) -> None:
        self.item = item
        self.deleted: list[str] = []

    def get_item(self, **_kwargs):
        return {"Item": self.item} if self.item else {}

    def delete_item(self, **kwargs):
        self.deleted.append(kwargs["Key"]["pk"]["S"])
        self.item = None


class FakeSecrets:
    def __init__(self, document: dict) -> None:
        self.document = document

    def get_secret_value(self, **_kwargs):
        return {"SecretString": json.dumps(self.document)}


class ParserTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.update(
            RELAY_DOMAIN=DOMAIN,
            RAW_BUCKET_NAME="relay-raw-test",
            STATE_TABLE_NAME="state",
            ADAPTER_VERSION="ses-classic-v1",
            RETENTION_POLICY_HASH="9" * 64,
            HMAC_SECRET_ARN="arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
            PENTRA_WEBHOOK_URL="https://example.convex.site/webhooks/outreach-inbound",
            QUEUE_URL="https://sqs.us-east-1.amazonaws.com/123/queue",
        )
        parser._s3_client = None
        parser._ddb_client = None
        parser._secrets_client = None
        parser._sqs_client = None

    def test_human_reply_payload_is_deterministic_and_bounded(self) -> None:
        event_a, body_a = parser._build_payload(
            reply_mime("😀" * 50_000), proof(), MESSAGE_KEY
        )
        event_b, body_b = parser._build_payload(
            reply_mime("😀" * 50_000), proof(), MESSAGE_KEY
        )
        self.assertEqual(event_a, event_b)
        self.assertEqual(body_a, body_b)
        self.assertLessEqual(len(body_a), 64 * 1024)
        decoded = json.loads(body_a)
        self.assertEqual(decoded["recipient"], REPLY_ALIAS)
        self.assertEqual(decoded["inReplyTo"], OUTBOUND_ID)
        self.assertEqual(decoded["authentication"]["alignedFrom"], "editor@example.org")

    def test_attachment_is_never_decoded_or_forwarded(self) -> None:
        raw = (
            "From: editor@example.org\r\n"
            "Message-ID: <reply-abcdefgh@example.org>\r\n"
            f"In-Reply-To: {OUTBOUND_ID}\r\n"
            "Subject: reply\r\n"
            "Content-Type: multipart/mixed; boundary=mix\r\n\r\n"
            "--mix\r\nContent-Type: text/plain\r\n\r\nVisible text\r\n"
            "--mix\r\nContent-Type: application/octet-stream\r\n"
            "Content-Disposition: attachment; filename=private.bin\r\n\r\n"
            "ATTACHMENT-SECRET-MUST-DISAPPEAR\r\n"
            "--mix\r\nContent-Type: text/plain\r\n"
            "Content-Disposition: inline; filename=inline-secret.txt\r\n\r\n"
            "INLINE-ATTACHMENT-MUST-DISAPPEAR\r\n--mix--\r\n"
        ).encode()
        _, body = parser._build_payload(raw, proof(), MESSAGE_KEY)
        self.assertIn(b"Visible text", body)
        self.assertNotIn(b"ATTACHMENT-SECRET", body)
        self.assertNotIn(b"INLINE-ATTACHMENT", body)
        self.assertNotIn(b"private.bin", body)

    def test_metadata_less_mixed_text_attachment_fails_closed(self) -> None:
        raw = (
            "From: editor@example.org\r\n"
            "Message-ID: <reply-abcdefgh@example.org>\r\n"
            f"In-Reply-To: {OUTBOUND_ID}\r\n"
            "Subject: reply\r\n"
            "Content-Type: multipart/mixed; boundary=mix\r\n\r\n"
            "--mix\r\nContent-Type: text/plain\r\n\r\nVisible body\r\n"
            "--mix\r\nContent-Type: text/plain\r\n\r\n"
            "SECRET-ATTACHMENT-WITHOUT-METADATA\r\n"
            "--mix--\r\n"
        ).encode()
        with self.assertRaises(RelayInputError):
            parser._build_payload(raw, proof(), MESSAGE_KEY)

    def test_multipart_alternative_selects_one_plain_body(self) -> None:
        raw = (
            "From: editor@example.org\r\n"
            "Message-ID: <reply-abcdefgh@example.org>\r\n"
            f"In-Reply-To: {OUTBOUND_ID}\r\n"
            "Subject: reply\r\n"
            "Content-Type: multipart/alternative; boundary=alt\r\n\r\n"
            "--alt\r\nContent-Type: text/plain\r\n\r\nVisible plain body\r\n"
            "--alt\r\nContent-Type: text/html\r\n\r\n"
            "<p>HTML alternative body</p>\r\n"
            "--alt--\r\n"
        ).encode()
        _, body = parser._build_payload(raw, proof(), MESSAGE_KEY)
        self.assertIn(b"Visible plain body", body)
        self.assertNotIn(b"HTML alternative body", body)

    def test_dsn_requires_structured_status_and_returned_original_binding(self) -> None:
        dsn_proof = proof("dsn", "mailer-daemon@mx.example")
        _, body = parser._build_payload(dsn_mime(), dsn_proof, MESSAGE_KEY)
        decoded = json.loads(body)
        self.assertEqual(decoded["recipient"], REPLY_ALIAS)
        self.assertEqual(decoded["dsn"]["source"], "message/delivery-status")
        self.assertEqual(decoded["dsn"]["originalMessageId"], OUTBOUND_ID)
        self.assertEqual(decoded["dsn"]["status"], "5.1.1")
        self.assertEqual(decoded["text"], "")
        self.assertNotIn("Original body must be discarded", body.decode())

    def test_ambiguous_or_spoofed_dsn_fails_closed(self) -> None:
        dsn_proof = proof("dsn", "mailer-daemon@mx.example")
        with self.assertRaises(RelayInputError):
            parser._build_payload(
                dsn_mime(reply_alias=f"dsn-{TOKEN}@{DOMAIN}"), dsn_proof, MESSAGE_KEY
            )
        with self.assertRaises(RelayInputError):
            parser._build_payload(
                dsn_mime(reply_alias=f"{REPLY_ALIAS}, attacker@evil.example"),
                dsn_proof,
                MESSAGE_KEY,
            )
        with self.assertRaises(RelayInputError):
            parser._build_payload(
                dsn_mime(message_id="<ordinary-message@sender.example>"),
                dsn_proof,
                MESSAGE_KEY,
            )
        with self.assertRaises(RelayInputError):
            parser._build_payload(dsn_mime(), proof(), MESSAGE_KEY)
        multi_recipient = dsn_mime().replace(
            b"Status: 5.1.1\r\n\r\n",
            (
                b"Status: 5.1.1\r\n\r\n"
                b"Final-Recipient: rfc822; second@example.org\r\n"
                b"Action: delayed\r\nStatus: 4.2.0\r\n\r\n"
            ),
        )
        with self.assertRaises(RelayInputError):
            parser._build_payload(multi_recipient, dsn_proof, MESSAGE_KEY)
        duplicate_fields = {
            b"Final-Recipient: rfc822; editor@example.org\r\n": (
                b"Final-Recipient: rfc822; editor@example.org\r\n"
                b"Final-Recipient: rfc822; attacker@evil.example\r\n"
            ),
            b"Original-Recipient: rfc822; editor@example.org\r\n": (
                b"Original-Recipient: rfc822; editor@example.org\r\n"
                b"Original-Recipient: rfc822; attacker@evil.example\r\n"
            ),
            b"Action: failed\r\n": b"Action: failed\r\nAction: delayed\r\n",
            b"Status: 5.1.1\r\n": b"Status: 5.1.1\r\nStatus: 4.2.0\r\n",
        }
        for original, duplicated in duplicate_fields.items():
            with self.subTest(field=original):
                with self.assertRaises(RelayInputError):
                    parser._build_payload(
                        dsn_mime().replace(original, duplicated),
                        dsn_proof,
                        MESSAGE_KEY,
                    )
        with self.assertRaises(RelayInputError):
            parser._build_payload(
                reply_mime().replace(
                    b"Editor <editor@example.org>", b"Attacker <attacker@evil.example>"
                ),
                proof(),
                MESSAGE_KEY,
            )

    def _install_process_fakes(self, raw: bytes, item: dict):
        s3 = FakeS3(raw)
        ddb = FakeDdb(item)
        parser._s3_client = s3
        parser._ddb_client = ddb
        parser._secrets_client = FakeSecrets(
            {"current": "c" * 40, "next": "n" * 40, "signWith": "next"}
        )
        return s3, ddb

    def test_2xx_deletes_while_425_and_5xx_retain_for_at_least_once_retry(self) -> None:
        original_post = parser._post
        try:
            s3, ddb = self._install_process_fakes(reply_mime(), proof())
            parser._post = lambda *_args, **_kwargs: (202, None)
            self.assertEqual(
                parser.process_pointer(
                    "relay-raw-test", f"raw/{MESSAGE_KEY}", now_seconds=NOW
                ),
                "deleted",
            )
            self.assertEqual(len(s3.deleted), 1)
            self.assertEqual(len(ddb.deleted), 1)

            for status, retry_after in [(425, 47), (503, None)]:
                s3, ddb = self._install_process_fakes(reply_mime(), proof())
                parser._post = (
                    lambda *_args, _status=status, _retry=retry_after, **_kwargs: (
                        _status,
                        _retry,
                    )
                )
                with self.assertRaises(RetryableRelayError) as raised:
                    parser.process_pointer(
                        "relay-raw-test",
                        f"raw/{MESSAGE_KEY}",
                        receive_count=2,
                        now_seconds=NOW,
                    )
                self.assertEqual(
                    raised.exception.delay_seconds, 47 if status == 425 else 60
                )
                self.assertEqual(s3.deleted, [])
                self.assertEqual(ddb.deleted, [])
        finally:
            parser._post = original_post

    def test_terminal_4xx_deletes_raw_and_proof(self) -> None:
        original_post = parser._post
        try:
            s3, ddb = self._install_process_fakes(reply_mime(), proof())
            parser._post = lambda *_args, **_kwargs: (401, None)
            self.assertEqual(
                parser.process_pointer(
                    "relay-raw-test", f"raw/{MESSAGE_KEY}", now_seconds=NOW
                ),
                "terminal",
            )
            self.assertEqual(len(s3.deleted), 1)
            self.assertEqual(len(ddb.deleted), 1)
        finally:
            parser._post = original_post

    def test_rotation_secret_selects_explicit_next_without_logging_it(self) -> None:
        parser._secrets_client = FakeSecrets(
            {"current": "c" * 40, "next": "n" * 40, "signWith": "next"}
        )
        self.assertEqual(parser._active_secret(), "n" * 40)
        parser._secrets_client = FakeSecrets({"next": "n" * 40, "signWith": "next"})
        with self.assertRaises(RetryableRelayError):
            parser._active_secret()

    def test_sqs_body_is_pointer_only_and_strictly_bounded(self) -> None:
        body = json.dumps(
            {
                "Records": [
                    {
                        "s3": {
                            "bucket": {"name": "relay-raw-test"},
                            "object": {"key": f"raw%2F{MESSAGE_KEY}"},
                        }
                    }
                ]
            }
        )
        self.assertEqual(
            list(parser._pointers({"body": body})),
            [("relay-raw-test", f"raw/{MESSAGE_KEY}")],
        )
        with self.assertRaises(RelayInputError):
            list(parser._pointers({"body": "x" * (64 * 1024 + 1)}))


if __name__ == "__main__":
    unittest.main()
