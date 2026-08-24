from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (ROOT / "template.yaml").read_text()
GUARD = (ROOT / "src" / "guard.py").read_text()
PARSER = (ROOT / "src" / "parser.py").read_text()


class TemplateContractTests(unittest.TestCase):
    def test_ses_classic_rule_is_us_east_1_tls_scanned_and_guarded_first(self) -> None:
        self.assertIn("AWS::SES::ReceiptRule", TEMPLATE)
        self.assertIn("AWS::SES::ReceiptRuleSet", TEMPLATE)
        self.assertIn("!Ref AWS::Region, us-east-1", TEMPLATE)
        self.assertIn("TlsPolicy: Require", TEMPLATE)
        self.assertIn("ScanEnabled: true", TEMPLATE)
        actions = TEMPLATE[
            TEMPLATE.index("        Actions:\n") : TEMPLATE.index(
                "  OperationsAlertTopic:"
            )
        ]
        self.assertLess(actions.index("LambdaAction:"), actions.index("S3Action:"))
        self.assertIn("InvocationType: RequestResponse", actions)
        self.assertNotIn("SNSAction", actions)
        self.assertIn('Default: "false"', TEMPLATE)
        self.assertIn("Enabled: !If [EnableReceiptRule, true, false]", TEMPLATE)

    def test_raw_bucket_is_private_unversioned_sse_s3_with_one_day_backstop(
        self,
    ) -> None:
        self.assertIn("SSEAlgorithm: AES256", TEMPLATE)
        self.assertIn("BlockPublicAcls: true", TEMPLATE)
        self.assertIn("RestrictPublicBuckets: true", TEMPLATE)
        self.assertNotIn("VersioningConfiguration", TEMPLATE)
        self.assertIn("ExpirationInDays: 1", TEMPLATE)
        self.assertIn("Prefix: raw/", TEMPLATE)

    def test_queue_is_pointer_only_bounded_encrypted_and_dead_lettered(self) -> None:
        parser = TEMPLATE[
            TEMPLATE.index("  MimeParserFunction:") : TEMPLATE.index(
                "  RetentionSweeperFunction:"
            )
        ]
        self.assertIn("SqsManagedSseEnabled: true", TEMPLATE)
        self.assertIn("MessageRetentionPeriod: 21600", TEMPLATE)
        self.assertIn("MessageRetentionPeriod: 86400", TEMPLATE)
        self.assertIn("maxReceiveCount: 24", TEMPLATE)
        self.assertIn("Event: s3:ObjectCreated:Put", TEMPLATE)
        self.assertIn("FunctionResponseTypes: [ReportBatchItemFailures]", parser)
        self.assertIn("BatchSize: 1", parser)
        self.assertIn("MaximumConcurrency: 2", parser)
        self.assertNotIn("ReservedConcurrentExecutions", TEMPLATE)

    def test_no_component_has_outbound_ses_or_iam_authority(self) -> None:
        self.assertIsNone(
            re.search(r"ses:(?:Send|SendRaw|SendBounce)", TEMPLATE, re.IGNORECASE)
        )
        self.assertIsNone(re.search(r"Action:\s*(?:\[)?iam:", TEMPLATE, re.IGNORECASE))
        self.assertNotIn("ses:Send", GUARD + PARSER)
        self.assertNotIn('boto3.client("ses', GUARD + PARSER)

    def test_guard_has_only_the_granular_dynamodb_transaction_permissions(self) -> None:
        guard_role = TEMPLATE[
            TEMPLATE.index("  GuardRole:") : TEMPLATE.index("  ParserRole:")
        ]
        self.assertIn("dynamodb:GetItem", guard_role)
        self.assertIn("dynamodb:PutItem", guard_role)
        self.assertIn("dynamodb:UpdateItem", guard_role)
        self.assertNotIn("dynamodb:DeleteItem", guard_role)
        self.assertNotIn("dynamodb:Scan", guard_role)
        self.assertNotIn("dynamodb:TransactWriteItems", guard_role)

    def test_retention_retries_privacy_and_rotation_are_explicit(self) -> None:
        sweeper = TEMPLATE[
            TEMPLATE.index("  RetentionSweeperFunction:") : TEMPLATE.index(
                "  AllowSesInvokeGuard:"
            )
        ]
        self.assertIn("Timeout: 60", sweeper)
        self.assertEqual(sweeper.count("Type: Schedule"), 1)
        self.assertIn("Schedule: rate(5 minutes)", sweeper)
        self.assertIn("RAW_PURGE_AGE_SECONDS", GUARD)
        self.assertIn("_counter_update(table_name, alias_key, 10", GUARD)
        self.assertIn("_counter_update(table_name, source_key, 60", GUARD)
        self.assertIn("SweeperFreshnessAlarm:", TEMPLATE)
        self.assertIn("SweeperErrorAlarm:", TEMPLATE)
        self.assertIn("Threshold: 21600", TEMPLATE)
        self.assertIn("TreatMissingData: breaching", TEMPLATE)
        self.assertIn("status == 425", PARSER)
        self.assertIn("500 <= status < 600", PARSER)
        self.assertIn("400 <= status < 500", PARSER)
        self.assertIn('document.get("signWith", "current")', PARSER)
        self.assertNotIn("print(event", GUARD + PARSER)
        self.assertNotIn("print(raw", GUARD + PARSER)

    def test_budget_alerts_at_two_dollars_and_five_dollar_review(self) -> None:
        ses_budget = TEMPLATE[
            TEMPLATE.index("  RelaySesServiceMonthlyBudget:") : TEMPLATE.index(
                "  RelayTaggedInfrastructureBudget:"
            )
        ]
        self.assertIn("Amount: 5", ses_budget)
        self.assertIn("Threshold: 40", ses_budget)
        self.assertIn("Threshold: 100", ses_budget)
        self.assertEqual(TEMPLATE.count("NotificationType: ACTUAL"), 4)
        self.assertIn("CostFilters:", ses_budget)
        self.assertIn("Service:", ses_budget)
        self.assertIn("Amazon Simple Email Service", ses_budget)
        self.assertNotIn("TagKeyValue:", ses_budget)
        self.assertIn("NoOtherSesWorkloadsOnly:", TEMPLATE)
        self.assertIn('NoOtherSesWorkloadsAcknowledged, "true"', TEMPLATE)
        self.assertNotIn("DedicatedRelayAccount", TEMPLATE)
        self.assertNotIn("RelayAccountMonthlyBudget:", TEMPLATE)
        self.assertIn("user:PentraComponent$inbound-relay", TEMPLATE)


if __name__ == "__main__":
    unittest.main()
