import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseSmartleadWebhookEvent,
  smartleadCanaryOperationKey,
  smartleadCampaignBindingHash,
  smartleadLeadCustomFields,
  smartleadManagedInboxIssues,
  smartleadOperationKey,
  smartleadRuntimeIssues,
  smartleadSequenceCustomFields,
  verifySmartleadWebhookSignature,
} from "../convex/lib/smartlead.ts";

test("managed Smartlead runtime fails closed without paid sender access", () => {
  assert.deepEqual(smartleadRuntimeIssues({}), [
    "smartlead_api_key_unavailable",
    "smartlead_webhook_secret_unavailable",
    "smart_senders_paid_api_access_unverified",
  ]);
});

test("Smartlead HMAC covers exact raw bytes", async () => {
  const secret = "s".repeat(32);
  const rawBody = new TextEncoder().encode('{"event_type":"EMAIL_REPLY"}');
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.equal(await verifySmartleadWebhookSignature({ rawBody, signatureHeader: signature, secret }), true);
  assert.equal(await verifySmartleadWebhookSignature({ rawBody, signatureHeader: `sha256=${signature}`, secret }), true);
  rawBody[1] ^= 1;
  assert.equal(await verifySmartleadWebhookSignature({ rawBody, signatureHeader: signature, secret }), false);
});

test("Smartlead derives stable dedupe identity and classifies reply STOP without retaining content", () => {
  const input = {
    rawText: JSON.stringify({
      event_type: "EMAIL_REPLY",
      time_replied: "2026-08-27T10:00:00.000Z",
      to_email: "person@example.com",
      campaign_id: 123,
      sequence_number: 1,
      reply_body: "STOP\n\nOn Tuesday Pentra wrote: reply STOP",
      message_id: "provider-message-123",
    }),
    requestIdHeader: null,
    now: Date.parse("2026-08-27T10:01:00.000Z"),
  };
  const first = parseSmartleadWebhookEvent(input);
  const replay = parseSmartleadWebhookEvent(input);
  assert.equal(first?.kind, "unsubscribe");
  assert.equal(first?.stopRequest, true);
  assert.match(first?.requestId ?? "", /^sl-[a-f0-9]{64}$/);
  assert.equal(first?.requestId, replay?.requestId);
  assert.equal(JSON.stringify(first).includes("STOP"), false);
  assert.equal(JSON.stringify(first).includes("person@example.com"), false);
});

test("Smartlead event parser correlates documented payloads without retaining addresses", () => {
  const parsed = parseSmartleadWebhookEvent({
    rawText: JSON.stringify({
      event_type: "EMAIL_REPLY",
      time_replied: "2026-08-27T10:00:00.000Z",
      to_email: "person@example.com",
      campaign_id: 123,
      sequence_number: 2,
      reply_body: "private response",
    }),
    requestIdHeader: "request-12345678",
    now: Date.parse("2026-08-27T10:01:00.000Z"),
  });
  assert.equal(parsed?.kind, "reply");
  assert.equal(parsed?.campaignBindingHash, smartleadCampaignBindingHash(123));
  assert.match(parsed?.recipientHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(parsed?.sequenceStep, 1);
  assert.equal(JSON.stringify(parsed).includes("private response"), false);
  assert.equal(JSON.stringify(parsed).includes("person@example.com"), false);
});

test("Smartlead sequences preserve one initial message and at most two follow-ups", () => {
  const operationKey = "a".repeat(64);
  const fields = smartleadSequenceCustomFields({
    operationKey,
    messages: [
      { subject: "First", body: "First body" },
      { subject: "Re: First", body: "Second body" },
      { subject: "Re: First", body: "Last body" },
    ],
  });
  assert.equal(fields.pentra_subject_0, "First");
  assert.equal(fields.pentra_body_2, "Last body");
  assert.throws(() => smartleadSequenceCustomFields({
    operationKey,
    messages: Array.from({ length: 4 }, () => ({ subject: "S", body: "B" })),
  }), /one to three/);
});

test("managed Smartlead inboxes remain unavailable until warm-up is over and active", () => {
  const startedAt = Date.parse("2026-08-01T00:00:00.000Z");
  const inbox = {
    provider: "smartlead",
    managedTransportKind: "smartlead_managed",
    credentialSource: "managed_adapter",
    managedTransportAdapterVersion: "smartlead-managed-v1",
    managedTransportOperationKey: "a".repeat(64),
    managedTransportGeneration: 1,
    managedTransportResourceReceipt: "b".repeat(64),
    status: "active",
    warmupStartedAt: startedAt,
  };
  assert.deepEqual(smartleadManagedInboxIssues({
    inbox,
    now: startedAt + 13 * 24 * 60 * 60 * 1000,
  }), ["smartlead_mailbox_warming"]);
  assert.deepEqual(smartleadManagedInboxIssues({
    inbox,
    now: startedAt + 14 * 24 * 60 * 60 * 1000,
  }), []);
});

test("operation keys bind one tenant generation, message, and bounded step", () => {
  const key = smartleadOperationKey({
    siteId: "site-a",
    inboxGeneration: 1,
    campaignGeneration: 2,
    messageId: "message-a",
    sequenceStep: 2,
  });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(smartleadLeadCustomFields({ operationKey: key, subject: "Subject", body: "Body" }).pentra_subject, "Subject");
  assert.throws(() => smartleadOperationKey({
    siteId: "site-a",
    inboxGeneration: 1,
    campaignGeneration: 2,
    messageId: "message-a",
    sequenceStep: 3,
  }), /zero and two/);
});

test("controlled canary keys bind a secret target hash without storing the address", () => {
  const targetHash = "b".repeat(64);
  const key = smartleadCanaryOperationKey({
    siteId: "site-a",
    resourceOperationKey: "a".repeat(64),
    generation: 3,
    kind: "bounce",
    targetHash,
  });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, smartleadCanaryOperationKey({
    siteId: "site-a",
    resourceOperationKey: "a".repeat(64),
    generation: 3,
    kind: "reply",
    targetHash,
  }));
  assert.throws(() => smartleadCanaryOperationKey({
    siteId: "site-a",
    resourceOperationKey: "invalid",
    generation: 3,
    kind: "reply",
    targetHash,
  }), /controlled-canary/);
});

test("controlled canaries are isolated from prospect delivery and settle through signed events", async () => {
  const [schema, action, node, outreach, http] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/schema.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/actions/smartlead.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/lib/smartleadNode.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/outreach.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/http.ts", import.meta.url), "utf8")),
  ]);
  assert.match(schema, /smartlead_canary_operations: defineTable/);
  assert.match(schema, /targetHash: v\.string\(\)/);
  assert.doesNotMatch(schema, /smartlead_canary_operations[\s\S]{0,1600}targetEmail/);
  assert.match(node, /SMARTLEAD_CANARY_DELIVERY_EMAIL/);
  assert.match(action, /smartleadCanaryTarget/);
  assert.match(action, /runControlledCanary/);
  assert.match(action, /path: "\/api\/v1\/webhook\/create"/);
  assert.match(action, /event_type_map: SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP/);
  assert.match(action, /\/api\/v1\/leads\/\$\{binding\.leadId\}\/unsubscribe/);
  assert.match(action, /globalUnsubscribeAttemptedAt/);
  assert.match(outreach, /recordSmartleadControlledCanaryWebhookReceipt/);
  assert.match(outreach, /cancellationCanaryReceipt/);
  assert.match(outreach, /recordSmartleadGlobalUnsubscribeBoundaryInternal/);
  assert.match(outreach, /providerGlobalUnsubscribeState: args\.stopRequest/);
  assert.match(http, /verifySmartleadWebhookSignature/);
  assert.match(http, /getSmartleadControlledCanaryWebhookCandidate/);
});

test("campaign configuration is read-reconciled after every ambiguous provider write", async () => {
  const [action, outreach] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/actions/smartlead.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/outreach.ts", import.meta.url), "utf8")),
  ]);
  assert.match(action, /async function ensureCampaignConfiguration/);
  assert.match(action, /\/campaigns\/\$\{args\.campaignId\}\/sequences/);
  assert.match(action, /\/campaigns\/\$\{args\.campaignId\}\/email-accounts/);
  assert.match(action, /current = await inspect\(\)/);
  assert.match(action, /campaign_configuration_verification_failed/);
  assert.match(action, /campaign_configuration_drift/);
  assert.doesNotMatch(
    action,
    /campaignConfigurationRequestedAt\) \{[\s\S]{0,100}campaign_configuration_ambiguous/,
  );
  const progress = outreach.slice(
    outreach.indexOf("export const recordSmartleadProviderProgressInternal"),
    outreach.indexOf("export const getSmartleadReconciliationOperationInternal"),
  );
  assert.match(progress, /completed: v\.optional\(v\.boolean\(\)\)/);
  assert.match(progress, /campaignConfiguredAt: args\.completed/);
  assert.doesNotMatch(progress, /campaignConfiguredAt: args\.encryptedCampaignBinding/);
});
