from __future__ import annotations

import json
import pathlib
import sys
import unittest
from email import policy
from email.parser import BytesParser

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import adapter  # noqa: E402
import events  # noqa: E402
from common import (  # noqa: E402
    AdapterInputError,
    AdapterRetryableError,
    build_raw_message,
    disposition_signature,
    inbound_canary_signature,
    normalize_event_envelope,
)
import test_no_replay as base_tests  # noqa: E402


class ThreadingProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tests.NoReplayTests.setUp(self)
        events.RFC_MESSAGE_ID_SUFFIX = ""

    def payload(self, **updates):
        value = base_tests.NoReplayTests.payload(self)
        value.update(updates)
        return value

    def send_root(self, *, now: int = 100):
        return adapter._send(self.payload(), self.secrets, now)

    def child_payload(
        self,
        parent_receipt: str,
        *,
        operation_key: str = "t" * 40,
        sequence_step: int = 1,
        **updates,
    ):
        return self.payload(
            operationKey=operation_key,
            sequenceStep=sequence_step,
            parent={
                "operationId": self.send_operation,
                "threadReceipt": parent_receipt,
            },
            subject="Useful follow-up",
            text="Following up with one additional detail.",
            **updates,
        )

    def test_root_receipt_status_and_ledger_are_ciphertext_only(self) -> None:
        receipt = self.send_root()
        self.assertEqual(receipt["state"], "submitted")
        self.assertEqual(receipt["sequenceStep"], 0)
        self.assertRegex(receipt["providerMessageIdDigest"], r"^[a-f0-9]{64}$")
        self.assertRegex(receipt["rfcMessageIdDigest"], r"^[a-f0-9]{64}$")
        self.assertRegex(receipt["threadReceipt"], r"^[A-Za-z0-9_-]{32,96}$")

        status = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.send_operation,
                "kind": "send",
            },
            101,
        )
        self.assertEqual(status, receipt)
        row = self.ddb.items[adapter._send_key(self.send_operation)]
        self.assertIn("rfcMessageIdCiphertext", row)
        serialized = json.dumps(row, sort_keys=True)
        self.assertNotIn("provider-message-0001", serialized)
        self.assertNotIn("<provider-message-0001>", serialized)
        self.assertNotIn("prospect@example.com", serialized)
        self.assertNotIn("providerMessageId", row)
        self.assertNotIn("rfcMessageId", row)

    def test_child_sends_one_exact_reply_and_replay_never_resends(self) -> None:
        root = self.send_root(now=100)
        child = self.child_payload(root["threadReceipt"])
        first = adapter._send(child, self.secrets, 1900)
        second = adapter._send(child, self.secrets, 1900)
        self.assertEqual(first["state"], "submitted")
        self.assertEqual(second, first)
        self.assertEqual(self.ses.send_count, 2)

        raw = self.ses.send_calls[-1]["Content"]["Raw"]["Data"]
        message = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(message.get_all("In-Reply-To"), ["<provider-message-0001>"])
        self.assertEqual(message.get_all("References"), ["<provider-message-0001>"])
        row = self.ddb.items[adapter._send_key("t" * 40)]
        self.assertEqual(row["sequenceStep"], 1)
        self.assertEqual(row["parentOperationKey"], self.send_operation)

    def test_grandchild_references_are_root_to_parent_ordered(self) -> None:
        root = self.send_root(now=100)
        child_operation = "t" * 40
        child = adapter._send(
            self.child_payload(root["threadReceipt"], operation_key=child_operation),
            self.secrets,
            1900,
        )
        grandchild = self.payload(
            operationKey="u" * 40,
            sequenceStep=2,
            parent={
                "operationId": child_operation,
                "threadReceipt": child["threadReceipt"],
            },
            subject="Final useful follow-up",
            text="One final relevant note.",
        )
        adapter._send(grandchild, self.secrets, 3700)
        raw = self.ses.send_calls[-1]["Content"]["Raw"]["Data"]
        message = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(message["In-Reply-To"], "<provider-message-0002>")
        self.assertEqual(
            str(message["References"]),
            "<provider-message-0001> <provider-message-0002>",
        )

    def test_cross_resource_parent_is_rejected_before_provider(self) -> None:
        root = self.send_root()
        second_resource = "q" * 40
        self.ddb.items[adapter._send_key(self.send_operation)][
            "resourceOperationKey"
        ] = second_resource
        attempt = self.child_payload(root["threadReceipt"])
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(attempt, self.secrets, 1900)
        self.assertEqual(self.ses.send_count, 1)

    def test_recipient_mismatch_and_forged_receipt_are_rejected(self) -> None:
        root = self.send_root()
        wrong_recipient = self.child_payload(
            root["threadReceipt"], toEmail="other@example.com"
        )
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(wrong_recipient, self.secrets, 1900)
        forged = self.child_payload("0" * 64, operation_key="u" * 40)
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(forged, self.secrets, 1900)
        self.assertEqual(self.ses.send_count, 1)

    def test_sequence_requires_exact_parent_and_root_forbids_one(self) -> None:
        root = self.send_root()
        missing = self.payload(operationKey="t" * 40, sequenceStep=1)
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(missing, self.secrets, 1900)
        skipped = self.child_payload(
            root["threadReceipt"], operation_key="u" * 40, sequence_step=2
        )
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(skipped, self.secrets, 1900)
        root_with_parent = self.payload(
            operationKey="v" * 40,
            parent={
                "operationId": self.send_operation,
                "threadReceipt": root["threadReceipt"],
            },
        )
        with self.assertRaisesRegex(AdapterInputError, "parent_not_allowed"):
            adapter._send(root_with_parent, self.secrets, 1900)
        self.assertEqual(self.ses.send_count, 1)

    def test_thread_headers_reject_crlf_lists_duplicates_and_overflow(self) -> None:
        base = {
            "from_email": "outreach-abc@mail.pentra.dev",
            "to_email": "prospect@example.com",
            "display_name": "Sender",
            "subject": "Subject",
            "text": "Body",
            "reply_to": "reply-" + "a" * 32 + "@reply.pentra.dev",
            "unsubscribe_url": "https://pentra.dev/unsubscribe/token",
        }
        unsafe = (
            "<provider-message-1>\r\nBcc: victim@example.com"
        )
        with self.assertRaises(AdapterInputError):
            build_raw_message(
                **base, in_reply_to=unsafe, references=[unsafe]
            )
        with self.assertRaises(AdapterInputError):
            build_raw_message(
                **base,
                in_reply_to="<provider-message-2>",
                references=["<provider-message-1>, <provider-message-2>"],
            )
        with self.assertRaisesRegex(AdapterInputError, "invalid_thread_headers"):
            build_raw_message(
                **base,
                in_reply_to="<provider-message-1>",
                references=["<provider-message-1>", "<provider-message-1>"],
            )
        long_references = [f"<{('x' * 60)}-{index}>" for index in range(20)]
        with self.assertRaises(AdapterInputError):
            build_raw_message(
                **base,
                in_reply_to=long_references[-1],
                references=long_references,
            )

    def test_event_response_identity_mismatch_quarantines_send(self) -> None:
        self.send_root()
        row = self.ddb.items[adapter._send_key(self.send_operation)]
        envelope = {
            "operationKey": self.send_operation,
            "messageId": "provider-message-forged",
            "messageIdDigest": adapter.sha256_hex("provider-message-forged"),
            "rfcMessageId": "<provider-message-forged>",
            "rfcMessageIdDigest": adapter.sha256_hex(
                "<provider-message-forged>"
            ),
        }
        with self.assertRaisesRegex(AdapterInputError, "provider_receipt_mismatch"):
            events._settle_ambiguous_send(envelope, row, self.secrets, 200)
        self.assertEqual(row["state"], "quarantined_integrity")
        public = adapter._public_send(row)
        self.assertTrue(public["noReplay"])
        self.assertEqual(public["code"], "provider_receipt_mismatch")
        self.assertIn("threadReceipt", public)
        self.assertEqual(
            adapter._status(
                {
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": self.send_operation,
                    "kind": "send",
                },
                201,
            ),
            public,
        )

    def test_event_recovery_seals_both_digests_receipt_and_ciphertext(self) -> None:
        row, claimed = adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
            recipient_binding=self.recipient_binding,
            sequence_step=0,
            parent_operation_key=None,
        )
        self.assertTrue(claimed)
        value = {
            "operationKey": self.send_operation,
            "messageId": "provider-message-recovered",
            "messageIdDigest": adapter.sha256_hex(
                "provider-message-recovered"
            ),
            "rfcMessageId": "<provider-message-recovered>",
            "rfcMessageIdDigest": adapter.sha256_hex(
                "<provider-message-recovered>"
            ),
        }
        settled = events._settle_ambiguous_send(
            value,
            row,
            self.secrets,
            100 + events.SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS,
        )
        self.assertEqual(settled["state"], "event_confirmed")
        self.assertRegex(settled["threadReceipt"], r"^[A-Za-z0-9_-]{32,96}$")
        self.assertIn("rfcMessageIdCiphertext", settled)
        self.assertNotIn("provider-message-recovered", json.dumps(settled))

    def test_event_common_header_absent_mismatch_and_match_contract(self) -> None:
        base = {
            "eventType": "Email Delivered",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-1",
            "attempt": ["a" * 40],
        }
        with self.assertRaisesRegex(AdapterInputError, "event_invalid"):
            normalize_event_envelope(base)
        derived = normalize_event_envelope(
            base, allow_derived_rfc_message_id=True
        )
        self.assertEqual(derived["rfcMessageId"], "<provider-message-1>")
        with self.assertRaisesRegex(AdapterInputError, "event_binding_conflict"):
            normalize_event_envelope(
                {**base, "rfcMessageId": "<different-message>"}
            )
        exact = normalize_event_envelope(
            {**base, "rfcMessageId": "<provider-message-1>"}
        )
        self.assertEqual(exact["rfcMessageIdDigest"], derived["rfcMessageIdDigest"])

    def test_event_common_header_mismatch_quarantines_established_send(self) -> None:
        self.send_root()
        value = {
            "eventType": "Email Delivered",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-0001",
            "rfcMessageId": "<different-message>",
            "attempt": [self.send_operation],
        }
        original_secrets = events._load_secrets
        try:
            events._load_secrets = lambda: self.secrets
            with self.assertRaisesRegex(
                AdapterInputError, "event_binding_conflict"
            ):
                events.process_envelope(value, now=200)
        finally:
            events._load_secrets = original_secrets
        self.assertEqual(
            self.ddb.items[adapter._send_key(self.send_operation)]["state"],
            "quarantined_integrity",
        )

    def test_arbitrary_hex_env_cannot_activate_rfc_invariant(self) -> None:
        self.ddb.items.pop(adapter._rfc_canary_marker_key())
        adapter.RFC_MESSAGE_ID_CANARY_RECEIPT = "f" * 64
        with self.assertRaisesRegex(
            AdapterRetryableError, "rfc_message_id_canary_required"
        ):
            adapter._send(self.payload(), self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)

        with self.assertRaisesRegex(
            AdapterRetryableError, "rfc_message_id_canary_required"
        ):
            adapter._send(
                self.payload(
                    operationKey="j" * 40,
                    purpose="inbound_relay_canary",
                    toEmail="canary@pentra.dev",
                ),
                self.secrets,
                100,
            )
        self.assertEqual(self.ses.send_count, 0)

        global_canary = self.payload(
            operationKey=adapter.RFC_MESSAGE_ID_CANARY_OPERATION_KEY,
            purpose="rfc_message_id_canary",
            toEmail="canary@pentra.dev",
        )
        result = adapter._send(global_canary, self.secrets, 100)
        self.assertEqual(result["state"], "submitted")
        self.assertEqual(self.ses.send_count, 1)
        self.assertFalse(adapter._rfc_message_id_canary_is_verified(self.secrets))

    def test_exact_common_header_delivery_activates_global_marker_only(self) -> None:
        self.ddb.items.pop(adapter._rfc_canary_marker_key())
        operation = adapter.RFC_MESSAGE_ID_CANARY_OPERATION_KEY
        adapter._send(
            self.payload(
                operationKey=operation,
                purpose="rfc_message_id_canary",
                toEmail="canary@pentra.dev",
            ),
            self.secrets,
            100,
        )
        value = {
            "eventType": "Email Delivered",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-0001",
            "rfcMessageId": "<provider-message-0001>",
            "attempt": [operation],
        }
        original_secrets = events._load_secrets
        original_post = events._post_event
        try:
            events._load_secrets = lambda: self.secrets
            events._post_event = lambda *_args, **_kwargs: (_ for _ in ()).throw(
                AssertionError("global_canary_must_not_call_tenant_webhook")
            )
            events.process_envelope(value, now=200)
        finally:
            events._load_secrets = original_secrets
            events._post_event = original_post
        self.assertTrue(adapter._rfc_message_id_canary_is_verified(self.secrets))
        marker = self.ddb.items[adapter._rfc_canary_marker_key()]
        self.assertEqual(marker["operationKey"], operation)
        self.assertEqual(marker["recipientSha256"], adapter.sha256_hex(
            "canary@pentra.dev"
        ))
        self.assertNotIn("canary@pentra.dev", json.dumps(marker))

        per_resource = adapter._send(
            self.payload(
                operationKey="j" * 40,
                purpose="inbound_relay_canary",
                toEmail="canary@pentra.dev",
            ),
            self.secrets,
            1900,
        )
        self.assertEqual(per_resource["purpose"], "inbound_relay_canary")

    def test_transient_global_marker_write_retries_without_quarantine(self) -> None:
        self.ddb.items.pop(adapter._rfc_canary_marker_key())
        operation = adapter.RFC_MESSAGE_ID_CANARY_OPERATION_KEY
        adapter._send(
            self.payload(
                operationKey=operation,
                purpose="rfc_message_id_canary",
                toEmail="canary@pentra.dev",
            ),
            self.secrets,
            100,
        )
        envelope = normalize_event_envelope(
            {
                "eventType": "Email Delivered",
                "eventId": "12345678-1234-1234-1234-123456789abc",
                "eventTime": "2026-08-25T19:00:00Z",
                "messageId": "provider-message-0001",
                "rfcMessageId": "<provider-message-0001>",
                "attempt": [operation],
            }
        )
        send = self.ddb.items[adapter._send_key(operation)]
        self.ddb.fail_next_put = True
        with self.assertRaisesRegex(
            AdapterRetryableError, "rfc_canary_marker_unavailable"
        ):
            events._record_rfc_canary_marker(
                envelope,
                send,
                self.secrets,
                200,
                common_header_present=True,
            )
        self.assertEqual(send["state"], "submitted")
        self.assertNotIn(adapter._rfc_canary_marker_key(), self.ddb.items)

    def test_canary_bypass_rejects_arbitrary_recipient_before_provider(self) -> None:
        canary = self.payload(
            operationKey=adapter.RFC_MESSAGE_ID_CANARY_OPERATION_KEY,
            purpose="rfc_message_id_canary",
            toEmail="prospect@example.com",
        )
        with self.assertRaisesRegex(AdapterInputError, "canary_send_binding_invalid"):
            adapter._send(canary, self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)

    def test_terminal_provider_events_and_race_block_children(self) -> None:
        root = self.send_root()
        row = self.ddb.items[adapter._send_key(self.send_operation)]
        for index, event_type in enumerate(sorted(events.TERMINAL_DELIVERY_EVENTS)):
            with self.subTest(event_type=event_type):
                for field in (
                    "terminalDeliveryEvent",
                    "terminalDeliveryEventAt",
                    "terminalDeliveryEventKeyDigest",
                    "terminalDeliveryEventReceipt",
                ):
                    row.pop(field, None)
                envelope = {
                    "operationKey": self.send_operation,
                    "eventType": event_type,
                    "eventTime": f"2026-08-25T19:00:0{index}Z",
                    "eventKeyDigest": str(index + 5) * 64,
                    "messageIdDigest": row["providerMessageIdDigest"],
                    "rfcMessageIdDigest": row["rfcMessageIdDigest"],
                }
                events._mark_terminal_delivery_event(
                    envelope,
                    row,
                    events._derive_event_receipt(envelope, row),
                    200 + index,
                )
                with self.assertRaisesRegex(
                    AdapterInputError, "parent_thread_receipt_invalid"
                ):
                    adapter._send(
                        self.child_payload(
                            root["threadReceipt"],
                            operation_key=chr(ord("t") + index) * 40,
                        ),
                        self.secrets,
                        1900,
                    )
        self.assertEqual(self.ses.send_count, 1)

        for field in (
            "terminalDeliveryEvent",
            "terminalDeliveryEventAt",
            "terminalDeliveryEventKeyDigest",
            "terminalDeliveryEventReceipt",
        ):
            row.pop(field, None)
        self.ddb.before_next_transact = lambda: row.update(
            {"terminalDeliveryEvent": "complaint"}
        )
        with self.assertRaisesRegex(
            AdapterInputError, "parent_thread_receipt_invalid"
        ):
            adapter._send(
                self.child_payload(
                    root["threadReceipt"], operation_key="z" * 40
                ),
                self.secrets,
                1900,
            )
        self.assertNotIn(adapter._send_key("z" * 40), self.ddb.items)
        self.assertEqual(self.ses.send_count, 1)

    def test_late_delivery_never_clears_terminal_provider_event(self) -> None:
        self.send_root()
        row = self.ddb.items[adapter._send_key(self.send_operation)]
        common = {
            "operationKey": self.send_operation,
            "eventTime": "2026-08-25T19:00:00Z",
            "messageIdDigest": row["providerMessageIdDigest"],
            "rfcMessageIdDigest": row["rfcMessageIdDigest"],
        }
        events._mark_terminal_delivery_event(
            {
                **common,
                "eventType": "bounced",
                "eventKeyDigest": "5" * 64,
            },
            row,
            events._derive_event_receipt(
                {
                    **common,
                    "eventType": "bounced",
                    "eventKeyDigest": "5" * 64,
                },
                row,
            ),
            200,
        )
        events._mark_terminal_delivery_event(
            {
                **common,
                "eventType": "delivered",
                "eventKeyDigest": "6" * 64,
            },
            row,
            events._derive_event_receipt(
                {
                    **common,
                    "eventType": "delivered",
                    "eventKeyDigest": "6" * 64,
                },
                row,
            ),
            201,
        )
        self.assertEqual(row["terminalDeliveryEvent"], "bounced")
        self.assertEqual(row["terminalDeliveryEventKeyDigest"], "5" * 64)

    def test_status_exposes_terminal_event_while_webhook_is_delayed(self) -> None:
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
            recipient_binding=self.recipient_binding,
            sequence_step=0,
            parent_operation_key=None,
        )
        value = {
            "eventType": "Email Bounced",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-recovered",
            "rfcMessageId": "<provider-message-recovered>",
            "attempt": [self.send_operation],
        }
        original_secrets = events._load_secrets
        original_post = events._post_event
        try:
            events._load_secrets = lambda: self.secrets
            events._post_event = lambda *_args, **_kwargs: (503, 60)
            with self.assertRaisesRegex(AdapterRetryableError, "webhook_retry"):
                events.process_envelope(
                    value,
                    now=100 + events.SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS,
                )
        finally:
            events._load_secrets = original_secrets
            events._post_event = original_post
        status = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.send_operation,
                "kind": "send",
            },
            221,
        )
        self.assertEqual(status["state"], "event_confirmed")
        self.assertEqual(
            status["terminalDeliveryEvent"]["eventType"], "bounced"
        )
        self.assertEqual(
            status["terminalDeliveryEvent"]["occurredAt"],
            "2026-08-25T19:00:00Z",
        )
        self.assertRegex(
            status["terminalDeliveryEvent"]["eventReceipt"],
            r"^[a-f0-9]{64}$",
        )
        self.assertIn("providerMessageIdDigest", status)
        self.assertIn("rfcMessageIdDigest", status)
        self.assertIn("threadReceipt", status)

    def test_ambiguous_adverse_settlement_atomically_blocks_parent_race(self) -> None:
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
            recipient_binding=self.recipient_binding,
            sequence_step=0,
            parent_operation_key=None,
        )
        envelope = {
            "operationKey": self.send_operation,
            "eventType": "bounced",
            "eventTime": "2026-08-25T19:00:00Z",
            "eventKeyDigest": "7" * 64,
            "messageId": "provider-message-recovered",
            "messageIdDigest": adapter.sha256_hex(
                "provider-message-recovered"
            ),
            "rfcMessageId": "<provider-message-recovered>",
            "rfcMessageIdDigest": adapter.sha256_hex(
                "<provider-message-recovered>"
            ),
        }
        observed: list[str] = []

        def attempt_child_at_commit_boundary() -> None:
            parent = self.ddb.items[adapter._send_key(self.send_operation)]
            try:
                adapter._send(
                    self.child_payload(
                        parent["threadReceipt"], operation_key="z" * 40
                    ),
                    self.secrets,
                    1900,
                )
                observed.append("provider_crossed")
            except AdapterInputError as exc:
                observed.append(str(exc))

        self.ddb.after_next_transact = attempt_child_at_commit_boundary
        settled = events._settle_ambiguous_send(
            envelope,
            self.ddb.items[adapter._send_key(self.send_operation)],
            self.secrets,
            100 + events.SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS,
        )
        self.assertEqual(
            observed, ["parent_thread_receipt_invalid"]
        )
        self.assertEqual(settled["state"], "event_confirmed")
        self.assertEqual(settled["terminalDeliveryEvent"], "bounced")
        self.assertRegex(
            settled["terminalDeliveryEventReceipt"], r"^[a-f0-9]{64}$"
        )
        self.assertNotIn(adapter._send_key("z" * 40), self.ddb.items)
        self.assertEqual(self.ses.send_count, 0)

    def test_inbound_canary_activation_is_exact_signed_and_bodyless(self) -> None:
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        for field in (
            "inboundCanaryOperationKey",
            "inboundCanaryInboxBinding",
            "inboundCanaryRelayConfigurationHash",
            "inboundCanaryRetentionPolicyHash",
            "inboundCanaryRelayReceipt",
            "inboundCanaryVerifiedAt",
            "inboundCanaryReceipt",
        ):
            resource.pop(field, None)
        with self.assertRaisesRegex(
            AdapterRetryableError, "inbound_relay_canary_required"
        ):
            adapter._send(self.payload(), self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)

        canary_operation = "j" * 40
        canary = self.payload(
            operationKey=canary_operation,
            purpose="inbound_relay_canary",
            toEmail="canary@pentra.dev",
        )
        adapter._send(canary, self.secrets, 100)
        send = self.ddb.items[adapter._send_key(canary_operation)]
        inbox_binding = send["inboxBinding"]
        relay_key = "d" * 40
        verified_at = 150
        relay_receipt = inbound_canary_signature(
            relay_key,
            adapter_version=adapter.ADAPTER_VERSION,
            resource_operation_key=self.resource_operation,
            generation=2,
            canary_operation_key=canary_operation,
            inbox_binding=inbox_binding,
            relay_configuration_hash="b" * 64,
            retention_policy_hash="c" * 64,
            verified_at=verified_at,
        )
        request = {
            "version": 1,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "operationKey": canary_operation,
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "inboxBinding": inbox_binding,
            "classifications": ["reply", "stop"],
            "relayConfigurationHash": "b" * 64,
            "retentionPolicyHash": "c" * 64,
            "verifiedAt": verified_at,
            "relayReceipt": relay_receipt,
        }
        activated = adapter._activate_inbound_canary(
            request, relay_key, self.secrets, verified_at
        )
        replayed = adapter._activate_inbound_canary(
            request, relay_key, self.secrets, verified_at
        )
        self.assertEqual(activated, replayed)
        self.assertEqual(
            activated["inboundCanary"]["classifications"], ["reply", "stop"]
        )
        self.assertRegex(
            activated["inboundCanary"]["inboundCanaryReceipt"],
            r"^[a-f0-9]{64}$",
        )
        serialized = json.dumps(self.ddb.items, sort_keys=True)
        self.assertNotIn("canary@pentra.dev", serialized)
        self.assertNotIn(canary["text"], serialized)

        normal = adapter._send(self.payload(), self.secrets, 1900)
        self.assertEqual(normal["state"], "submitted")

    def test_inbound_canary_forgery_wrong_inbox_and_expiry_fail_closed(self) -> None:
        canary_operation = "j" * 40
        adapter._send(
            self.payload(
                operationKey=canary_operation,
                purpose="inbound_relay_canary",
                toEmail="canary@pentra.dev",
            ),
            self.secrets,
            100,
        )
        send = self.ddb.items[adapter._send_key(canary_operation)]
        inbox_binding = send["inboxBinding"]
        request = {
            "adapterVersion": adapter.ADAPTER_VERSION,
            "operationKey": canary_operation,
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "inboxBinding": inbox_binding,
            "classifications": ["reply", "stop"],
            "relayConfigurationHash": "b" * 64,
            "retentionPolicyHash": "c" * 64,
            "verifiedAt": 150,
            "relayReceipt": "0" * 64,
        }
        with self.assertRaisesRegex(
            AdapterInputError, "inbound_canary_receipt_invalid"
        ):
            adapter._activate_inbound_canary(
                request, "d" * 40, self.secrets, 150
            )
        request["relayReceipt"] = inbound_canary_signature(
            "d" * 40,
            adapter_version=adapter.ADAPTER_VERSION,
            resource_operation_key=self.resource_operation,
            generation=2,
            canary_operation_key=canary_operation,
            inbox_binding="f" * 64,
            relay_configuration_hash="b" * 64,
            retention_policy_hash="c" * 64,
            verified_at=150,
        )
        request["inboxBinding"] = "f" * 64
        with self.assertRaisesRegex(
            AdapterInputError, "inbound_canary_send_invalid"
        ):
            adapter._activate_inbound_canary(
                request, "d" * 40, self.secrets, 150
            )

        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        resource["inboundCanaryVerifiedAt"] = 1
        with self.assertRaisesRegex(
            AdapterRetryableError, "inbound_relay_canary_required"
        ):
            adapter._send(
                self.payload(operationKey="v" * 40),
                self.secrets,
                adapter.INBOUND_CANARY_MAX_AGE_SECONDS + 2,
            )

    def test_forged_durable_inbound_activation_cannot_enable_outreach(self) -> None:
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        resource["inboundCanaryReceipt"] = "0" * 64
        with self.assertRaisesRegex(
            AdapterRetryableError, "inbound_relay_canary_required"
        ):
            adapter._send(self.payload(), self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)

    def test_ambiguous_child_blocks_release_until_disposition(self) -> None:
        root = self.send_root(now=100)
        self.ses.failure = OSError("ambiguous")
        child_operation = "t" * 40
        with self.assertRaisesRegex(AdapterRetryableError, "provider_attempt_ambiguous"):
            adapter._send(
                self.child_payload(
                    root["threadReceipt"], operation_key=child_operation
                ),
                self.secrets,
                1900,
            )
        with self.assertRaisesRegex(AdapterRetryableError, "resource_has_unsettled_send"):
            adapter._release(
                {
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": self.resource_operation,
                    "generation": 2,
                },
                2000,
            )
        now = 1900 + adapter.AMBIGUOUS_DISPOSITION_MIN_AGE_SECONDS
        disposition_key = "d" * 40
        disposition = adapter._disposition(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": child_operation,
                "resourceOperationKey": self.resource_operation,
                "generation": 2,
                "decision": "quarantine_no_replay",
                "authorizedAt": now,
                "authorizationReceipt": disposition_signature(
                    disposition_key,
                    child_operation,
                    self.resource_operation,
                    2,
                    now,
                ),
            },
            disposition_key,
            now,
        )
        self.assertEqual(disposition["state"], "quarantined_no_replay")
        release = adapter._release(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.resource_operation,
                "generation": 2,
            },
            now + 1,
        )
        self.assertEqual(release["state"], "releasing")


if __name__ == "__main__":
    unittest.main()
