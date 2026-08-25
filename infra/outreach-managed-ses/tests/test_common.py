from __future__ import annotations

import pathlib
import sys
import unittest
from email import policy
from email.parser import BytesParser

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from common import (  # noqa: E402
    AdapterInputError,
    build_raw_message,
    derive_send_message_binding,
    derive_resource_names,
    normalize_event_envelope,
    parse_disposition_key,
    parse_secret_document,
    response_signature,
    seconds_until_next_utc_day,
    sign_request,
    verify_request_signature,
    verify_response_signature,
    warmup_daily_cap,
)


class CommonContractTests(unittest.TestCase):
    def test_request_signature_accepts_rotation_and_rejects_expiry(self) -> None:
        body = b'{"version":1}'
        nonce = "n" * 32
        timestamp = "1000"
        next_secret = "n" * 40
        headers = {
            "X-Pentra-Timestamp": timestamp,
            "X-Pentra-Nonce": nonce,
            "X-Pentra-Signature": sign_request(
                next_secret, "POST", "/v1/status", timestamp, nonce, body
            ),
        }
        actual = verify_request_signature(
            headers,
            method="POST",
            path="/v1/status",
            body=body,
            secrets={"current": "c" * 40, "next": next_secret},
            now=1100,
        )
        self.assertEqual(actual, (nonce, 1000))
        with self.assertRaisesRegex(AdapterInputError, "request_auth_expired"):
            verify_request_signature(
                headers,
                method="POST",
                path="/v1/status",
                body=body,
                secrets={"current": "c" * 40, "next": next_secret},
                now=1400,
            )

    def test_response_signature_is_nonce_body_and_time_bound(self) -> None:
        body = b'{"eventReceipt":"abc","ok":true,"version":1}'
        nonce = "n" * 32
        secret = "s" * 40
        timestamp = 1_000
        headers = {
            "X-Pentra-Response-Timestamp": str(timestamp),
            "X-Pentra-Response-Signature": response_signature(
                secret, nonce, timestamp, body
            ),
        }
        self.assertEqual(
            verify_response_signature(
                headers,
                request_nonce=nonce,
                body=body,
                secrets={"current": secret},
                now=1_100,
            ),
            timestamp,
        )
        with self.assertRaisesRegex(AdapterInputError, "response_auth_invalid"):
            verify_response_signature(
                headers,
                request_nonce="x" * 32,
                body=body,
                secrets={"current": secret},
                now=1_100,
            )

    def test_resource_derivation_is_stable_generation_bound_and_opaque(self) -> None:
        operation = "operation_" + "a" * 40
        first = derive_resource_names("r" * 48, operation, 3, "mail.pentra.dev")
        again = derive_resource_names("r" * 48, operation, 3, "mail.pentra.dev")
        next_generation = derive_resource_names(
            "r" * 48, operation, 4, "mail.pentra.dev"
        )
        self.assertEqual(first, again)
        self.assertNotEqual(first, next_generation)
        self.assertNotIn(operation, "|".join(first))
        self.assertTrue(first[0].startswith("pentra-"))
        self.assertTrue(first[2].endswith("@mail.pentra.dev"))

    def test_raw_message_is_plain_text_and_has_reply_and_one_click_headers(self) -> None:
        raw = build_raw_message(
            from_email="outreach-abc123@mail.pentra.dev",
            to_email="prospect@example.com",
            display_name="Pentra customer",
            subject="A useful resource",
            text="Hello.\n\nUnsubscribe any time.",
            reply_to="reply-" + "a" * 32 + "@reply.pentra.dev",
            unsubscribe_url="https://pentra.dev/unsubscribe/token",
        )
        message = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(message["To"], "prospect@example.com")
        self.assertEqual(
            message["Reply-To"], "reply-" + "a" * 32 + "@reply.pentra.dev"
        )
        self.assertEqual(
            message["List-Unsubscribe"],
            "<https://pentra.dev/unsubscribe/token>",
        )
        self.assertEqual(message["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")
        self.assertIsNone(message["Message-ID"])
        self.assertEqual(message.get_content_type(), "text/plain")

    def test_send_binding_is_content_bound_and_opaque(self) -> None:
        common = {
            "resource_key": "k" * 40,
            "operation_key": "o" * 40,
            "resource_operation_key": "r" * 40,
            "generation": 3,
        }
        first = derive_send_message_binding(**common, raw_message=b"message one")
        again = derive_send_message_binding(**common, raw_message=b"message one")
        changed = derive_send_message_binding(**common, raw_message=b"message two")
        self.assertEqual(first, again)
        self.assertNotEqual(first, changed)
        self.assertRegex(first, r"^[a-f0-9]{64}$")
        self.assertNotIn("message", first)

    def test_header_injection_is_rejected(self) -> None:
        with self.assertRaisesRegex(AdapterInputError, "invalid_subject"):
            build_raw_message(
                from_email="outreach-abc123@mail.pentra.dev",
                to_email="prospect@example.com",
                display_name="Sender",
                subject="Hello\r\nBcc: victim@example.com",
                text="Body",
                reply_to="reply-" + "a" * 32 + "@reply.pentra.dev",
                unsubscribe_url="https://pentra.dev/unsubscribe/token",
            )

    def test_event_normalization_retains_only_opaque_receipts(self) -> None:
        value = {
            "eventType": "Email Bounced",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-1",
            "attempt": ["a" * 40],
            "destination": ["must-not-survive@example.com"],
        }
        actual = normalize_event_envelope(value)
        self.assertEqual(actual["eventType"], "bounced")
        self.assertEqual(actual["operationKey"], "a" * 40)
        self.assertNotIn("destination", actual)
        self.assertNotIn("must-not-survive", str(actual))
        self.assertNotEqual(actual["messageIdDigest"], value["messageId"])

    def test_event_rejects_ambiguous_attempt_tag(self) -> None:
        with self.assertRaisesRegex(AdapterInputError, "event_invalid"):
            normalize_event_envelope(
                {
                    "eventType": "Email Delivered",
                    "eventId": "12345678-1234-1234-1234-123456789abc",
                    "eventTime": "2026-08-25T19:00:00Z",
                    "messageId": "provider-message-1",
                    "attempt": ["a" * 40, "b" * 40],
                }
            )

    def test_event_semantic_key_ignores_provider_redelivery_identity(self) -> None:
        base = {
            "eventType": "Email Delivered",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-1",
            "attempt": ["a" * 40],
        }
        redelivery = {
            **base,
            "eventId": "87654321-4321-4321-4321-cba987654321",
            "eventTime": "2026-08-25T19:00:03Z",
        }
        first = normalize_event_envelope(base)
        second = normalize_event_envelope(redelivery)
        self.assertEqual(first["eventKeyDigest"], second["eventKeyDigest"])
        self.assertNotEqual(first["eventIdDigest"], second["eventIdDigest"])

    def test_secret_contract_requires_stable_derivation_key(self) -> None:
        parsed = parse_secret_document(
            {
                "current": "c" * 40,
                "next": "n" * 40,
                "signWith": "next",
                "resourceKey": "r" * 40,
            }
        )
        self.assertEqual(parsed["signWith"], "next")
        self.assertEqual(parse_disposition_key({"key": "d" * 40}), "d" * 40)
        with self.assertRaisesRegex(AdapterInputError, "disposition_secret_invalid"):
            parse_disposition_key("short")
        with self.assertRaisesRegex(AdapterInputError, "secret_contract_invalid"):
            parse_secret_document({"current": "c" * 40})

    def test_warmup_cap_is_bounded_and_day_wait_is_exact(self) -> None:
        self.assertEqual(warmup_daily_cap(0), 3)
        self.assertEqual(warmup_daily_cap(2), 5)
        self.assertEqual(warmup_daily_cap(4), 10)
        self.assertEqual(warmup_daily_cap(7), 20)
        self.assertEqual(warmup_daily_cap(14), 30)
        self.assertEqual(warmup_daily_cap(400), 30)
        self.assertEqual(seconds_until_next_utc_day(86_400 - 1), 1)


if __name__ == "__main__":
    unittest.main()
