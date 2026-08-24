import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync("infra/outreach-inbound-relay/template.yaml", "utf8");
const common = readFileSync(
  "infra/outreach-inbound-relay/src/relay_common.py",
  "utf8",
);
const guard = readFileSync("infra/outreach-inbound-relay/src/guard.py", "utf8");
const parser = readFileSync("infra/outreach-inbound-relay/src/parser.py", "utf8");
const retention = readFileSync(
  "infra/outreach-inbound-relay/RETENTION_POLICY.md",
  "utf8",
);
const sesBudget = template.slice(
  template.indexOf("  RelaySesServiceMonthlyBudget:"),
  template.indexOf("  RelayTaggedInfrastructureBudget:"),
);

test("SES relay remains receiving-only, pointer-only and fail-closed", () => {
  assert.match(template, /InvocationType: RequestResponse/);
  assert.match(template, /TlsPolicy: Require/);
  assert.match(template, /ScanEnabled: true/);
  assert.match(template, /Event: s3:ObjectCreated:Put/);
  assert.match(template, /ReceiptRuleEnabled:[\s\S]*Default: "false"/);
  assert.match(template, /Enabled: !If \[EnableReceiptRule, true, false\]/);
  assert.doesNotMatch(template, /SNSAction/);
  assert.doesNotMatch(template, /ses:(?:Send|SendRaw|SendBounce)/i);
  assert.doesNotMatch(template, /Action:\s*(?:\[)?iam:/i);
  assert.doesNotMatch(`${guard}\n${parser}`, /boto3\.client\(["']ses/);
});

test("SES relay binds both alias classes and structured returned-message DSNs", () => {
  assert.match(common, /reply\|dsn/);
  assert.match(common, /dmarcVerdict/);
  assert.match(common, /dkimVerdict/);
  assert.doesNotMatch(common, /spfVerdict[^\n]*==\s*["']PASS/);
  assert.match(parser, /message\/delivery-status/);
  assert.match(parser, /message\/rfc822/);
  assert.match(parser, /_PENTRA_MESSAGE_ID\.fullmatch/);
  assert.match(parser, /alias\[0\] == "reply"/);
});

test("SES relay retention, retry and cost fences are source-controlled", () => {
  assert.match(template, /MessageRetentionPeriod: 21600/);
  assert.match(template, /MessageRetentionPeriod: 86400/);
  assert.match(template, /ExpirationInDays: 1/);
  assert.match(template, /Schedule: rate\(5 minutes\)/);
  assert.match(template, /SweeperFreshnessAlarm:/);
  assert.match(template, /SweeperErrorAlarm:/);
  assert.match(template, /RelaySesServiceMonthlyBudget:/);
  assert.match(template, /RelayTaggedInfrastructureBudget:/);
  assert.match(template, /NoOtherSesWorkloadsOnly:/);
  assert.match(template, /NoOtherSesWorkloadsAcknowledged, "true"/);
  assert.match(sesBudget, /CostFilters:[\s\S]*Service:/);
  assert.match(sesBudget, /Amazon Simple Email Service/);
  assert.doesNotMatch(sesBudget, /TagKeyValue:/);
  assert.doesNotMatch(template, /DedicatedRelayAccount/);
  assert.doesNotMatch(template, /RelayAccountMonthlyBudget:/);
  assert.match(sesBudget, /Amount: 5/);
  assert.match(sesBudget, /Threshold: 40/);
  assert.match(sesBudget, /Threshold: 100/);
  assert.match(parser, /status == 425/);
  assert.match(parser, /500 <= status < 600/);
  assert.match(parser, /400 <= status < 500/);
  assert.match(retention, /runs every five minutes/);
  assert.match(retention, /five\s+hours forty-five minutes/);
  assert.match(retention, /one-day S3 lifecycle/);
});
