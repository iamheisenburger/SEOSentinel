from __future__ import annotations

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class TemplateSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.template = (ROOT / "template.yaml").read_text()
        cls.readme = (ROOT / "README.md").read_text()
        cls.adapter = (ROOT / "src" / "adapter.py").read_text()
        cls.common = (ROOT / "src" / "common.py").read_text()
        cls.events = (ROOT / "src" / "events.py").read_text()

    def test_only_adapter_role_can_send(self) -> None:
        self.assertEqual(self.template.count("Action: ses:SendEmail"), 1)
        self.assertNotIn("ses:SendRawEmail", self.template)
        self.assertNotIn("ses:Send*", self.template)
        event_role = self.template.split("  EventFunctionRole:", 1)[1]
        self.assertNotIn("ses:SendEmail", event_role)
        self.assertNotIn("DispositionSecretArn", event_role)
        adapter_role = self.template.split("  AdapterFunctionRole:", 1)[1].split(
            "\n  AdapterFunction:", 1
        )[0]
        self.assertIn("ses:TenantName: pentra-*", adapter_role)
        self.assertIn("ses:TagResource", adapter_role)

    def test_runtime_iam_covers_exact_transaction_boundaries(self) -> None:
        self.assertEqual(self.template.count("dynamodb:TransactWriteItems"), 2)
        self.assertIn("Path: /v1/disposition", self.template)
        self.assertNotIn("  AdapterVersion:\n    Type: String", self.template)
        self.assertIn("ADAPTER_VERSION: managed-ses-v1", self.template)
        self.assertIn("AllowedValues: [mail.pentra.dev]", self.template)
        self.assertIn("AllowedValues: [reply.pentra.dev]", self.template)
        self.assertIn("PurposeKeysMustBeDistinct:", self.template)
        self.assertIn("- !Ref HmacSecretArn", self.template)
        self.assertIn("- !Ref DispositionSecretArn", self.template)
        self.assertIn("- !Ref InboundCanarySecretArn", self.template)
        self.assertIn("Path: /v1/inbound-canary", self.template)

    def test_thread_identity_uses_context_bound_rotating_kms_key(self) -> None:
        self.assertIn("ThreadMessageKey:", self.template)
        self.assertIn("EnableKeyRotation: true", self.template)
        self.assertIn("PendingWindowInDays: 30", self.template)
        self.assertIn("kms:EncryptionContext:purpose: managed-ses-rfc-message-id", self.template)
        for required in (
            "operationKey",
            "resourceOperationKey",
            "generation",
            "recipientBinding",
        ):
            self.assertIn(f"kms:EncryptionContext:{required}", self.template)
        self.assertEqual(self.template.count("- kms:Decrypt"), 1)
        event_role = self.template.split("  EventFunctionRole:", 1)[1].split(
            "\n  EventFunction:", 1
        )[0]
        self.assertIn("Action: kms:Encrypt", event_role)
        self.assertNotIn("kms:Decrypt", event_role)

    def test_rfc_event_schema_has_exact_and_missing_header_routes(self) -> None:
        self.assertIn("EventRuleMissingRfcMessageId:", self.template)
        self.assertIn("- exists: true", self.template)
        self.assertIn("- exists: false", self.template)
        self.assertIn("rfcMessageId: $.detail.mail.commonHeaders.messageId", self.template)
        self.assertNotIn("RfcMessageIdCanaryReceipt:", self.template)
        self.assertNotIn("RFC_MESSAGE_ID_CANARY_RECEIPT", self.template)
        self.assertIn("rfc-canary#", self.adapter)

    def test_provider_events_are_reduced_before_queue(self) -> None:
        transformer = self.template.split("          InputTransformer:", 1)[1].split(
            "\n\n  EventQueuePolicy:", 1
        )[0]
        for required in ("eventType", "eventId", "eventTime", "messageId", "attempt"):
            self.assertIn(required, transformer)
        for forbidden in (
            "$.detail.mail.source",
            "$.detail.mail.destination",
            "$.detail.mail.headers",
            "$.detail.bounce",
            "$.detail.complaint",
        ):
            self.assertNotIn(forbidden, transformer)

    def test_public_api_disables_body_tracing_and_requires_hmac_secret(self) -> None:
        self.assertIn("DataTraceEnabled: false", self.template)
        self.assertIn("HmacSecretArn:", self.template)
        self.assertIn("NoEcho: true", self.template)
        self.assertNotRegex(self.template, r"secretsmanager:GetSecretValue\s+Resource: [\"']?\*")
        self.assertIn("request_auth_expired", self.common)
        self.assertIn("request_replay", self.adapter)
        self.assertIn("verify_response_signature", self.events)
        self.assertIn("webhook_ack_invalid", self.events)

    def test_dedicated_account_and_dns_boundaries_are_explicit(self) -> None:
        self.assertIn("DedicatedSesAccountAcknowledged", self.template)
        self.assertIn('Default: "false"', self.template)
        self.assertIn("DkimTokenName1", self.template)
        self.assertIn("cannot make DKIM valid without", self.readme)
        self.assertIn("separately deployed inbound relay healthy", self.readme)

    def test_source_has_no_request_body_or_exception_logging(self) -> None:
        combined = self.adapter + self.events
        self.assertNotRegex(combined, r"print\((?:payload|body|event|exc|exception)")
        self.assertNotIn("logger.exception", combined)
        self.assertNotIn("traceback", combined)
        self.assertIn("metric(\"api\"", self.adapter)
        self.assertIn("metric(\"events\"", self.events)

    def test_release_is_two_phase_and_sender_guard_is_retained(self) -> None:
        self.assertIn("PROVISION_AMBIGUITY_SECONDS = 15 * 60", self.adapter)
        self.assertIn("RELEASE_STABILITY_SECONDS = 2 * 60", self.adapter)
        self.assertIn('"release_verifying"', self.adapter)
        self.assertIn("_tenant_is_absent", self.adapter)
        self.assertNotRegex(
            self.adapter,
            re.compile(r"REMOVE[^\n]*sender", re.IGNORECASE),
        )
        self.assertIn("sender collision guards: retained", (ROOT / "RETENTION_POLICY.md").read_text())
        self.assertNotIn("OPERATION_TTL_SECONDS", self.adapter + self.events)

    def test_every_runtime_alarm_has_an_email_action(self) -> None:
        self.assertIn("EventFunctionErrorsAlarm:", self.template)
        self.assertIn("EventRuleFailedInvocationsAlarm:", self.template)
        self.assertIn("MetricName: FailedInvocations", self.template)
        self.assertIn("AdapterApi5xxAlarm:", self.template)
        self.assertIn("StateTableItemCountAlarm:", self.template)
        self.assertIn("LedgerMetricsFunctionErrorsAlarm:", self.template)
        self.assertIn("MetricName: DurableLedgerItemCount", self.template)
        self.assertIn("Schedule: rate(1 hour)", self.template)
        self.assertIn("Period: 7200", self.template)
        self.assertIn("Action: dynamodb:DescribeTable", self.template)
        self.assertIn("cloudwatch:namespace: Pentra/ManagedSES", self.template)
        self.assertNotIn("Namespace: AWS/DynamoDB\n      MetricName: ItemCount", self.template)
        self.assertIn("AlarmTopic:", self.template)
        self.assertNotIn("KmsMasterKeyId: alias/aws/sns", self.template)
        self.assertGreaterEqual(self.template.count("!Ref AlarmTopic"), 8)

    def test_event_batch_and_visibility_cover_worst_case_webhook_time(self) -> None:
        self.assertIn("VisibilityTimeout: 240", self.template)
        self.assertIn("BatchSize: 1", self.template)
        self.assertIn("MaximumBatchingWindowInSeconds: 0", self.template)
        self.assertIn("LoggingLevel: OFF", self.template)
        self.assertIn(
            "EVENT_BUS_ARN: !Sub arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:event-bus/default",
            self.template,
        )


if __name__ == "__main__":
    unittest.main()
