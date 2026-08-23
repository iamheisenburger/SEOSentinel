import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES,
  OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS,
  classifyInboundRelay,
  classifyInboundRelayDsnCanary,
  inboundRelayAliasAddress,
  inboundRelayAliasHash,
  inboundRelayCanaryEvidenceReceipt,
  inboundRelayConfigurationHash,
  inboundRelayConfigured,
  inboundRelayEvidenceReceipt,
  inboundRelayEmailHash,
  inboundRelayMessageIdHash,
  inboundRelayOutboundMessageId,
  parseInboundRelayPayload,
  verifyInboundRelaySignature,
  type InboundRelayPayload,
} from "../convex/lib/outreachInboundRelay.ts";

const NOW = Date.UTC(2026, 7, 23, 15, 0, 0);
const SENT_AT = NOW - 60_000;
const SECRET = "relay-test-secret-that-is-longer-than-thirty-two-bytes";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const OUTBOUND_ID = `<pentra.${TOKEN.toLowerCase()}@sender.example>`;
const ADAPTER_VERSION = "relay-adapter-2026.08.23";
const RETENTION_POLICY_HASH = "9".repeat(64);
const RUNTIME_CONFIG = {
  domain: "inbound.pentra.example",
  secrets: [SECRET],
  adapterVersion: ADAPTER_VERSION,
  retentionPolicyHash: RETENTION_POLICY_HASH,
  retentionAudited: true,
};

function rawPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    adapterVersion: ADAPTER_VERSION,
    retentionPolicyHash: RETENTION_POLICY_HASH,
    eventId: "evt_20260823_abcdefgh",
    receivedAt: NOW,
    recipient: `reply-${TOKEN.toLowerCase()}@inbound.pentra.example`,
    from: "Editor <editor@example.org>",
    messageId: "<reply-abcdefgh@example.org>",
    inReplyTo: OUTBOUND_ID,
    references: [OUTBOUND_ID],
    subject: "Re: Broken resource",
    text: "Thanks, I will take a look.",
    authentication: {
      verdict: "pass",
      method: "dmarc",
      alignedFrom: "editor@example.org",
    },
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}): InboundRelayPayload {
  const parsed = parseInboundRelayPayload(JSON.stringify(rawPayload(overrides)));
  assert.ok(parsed);
  return parsed;
}

const candidate = {
  messageId: "message-a",
  toEmail: "editor@example.org",
  toDomain: "example.org",
  sentAt: SENT_AT,
  outboundRfcMessageIdHash: inboundRelayMessageIdHash(OUTBOUND_ID),
};

test("relay configuration and per-message aliases fail closed", () => {
  assert.equal(OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS, 24 * 60 * 60 * 1000);
  assert.equal(inboundRelayConfigured(RUNTIME_CONFIG), true);
  assert.match(inboundRelayConfigurationHash(RUNTIME_CONFIG)!, /^[a-f0-9]{64}$/);
  assert.equal(inboundRelayConfigured({ ...RUNTIME_CONFIG, domain: "bad domain" }), false);
  assert.equal(inboundRelayConfigured({ ...RUNTIME_CONFIG, secrets: ["short"] }), false);
  assert.equal(inboundRelayConfigured({ ...RUNTIME_CONFIG, retentionAudited: false }), false);
  assert.equal(inboundRelayConfigured({ ...RUNTIME_CONFIG, adapterVersion: undefined }), false);
  const alias = inboundRelayAliasAddress(TOKEN, "INBOUND.PENTRA.EXAMPLE");
  assert.equal(alias, `reply-${TOKEN.toLowerCase()}@inbound.pentra.example`);
  assert.match(inboundRelayAliasHash(alias!), /^[a-f0-9]{64}$/);
  assert.equal(
    inboundRelayOutboundMessageId({ token: TOKEN, senderDomain: "sender.example" }),
    OUTBOUND_ID,
  );
  assert.equal(inboundRelayAliasAddress("guessable", "inbound.pentra.example"), null);
});

test("HMAC covers exact bytes, timestamp and event id with bounded skew", async () => {
  const raw = new TextEncoder().encode(JSON.stringify(rawPayload()));
  const timestamp = Math.floor(NOW / 1_000);
  const eventId = "evt_20260823_abcdefgh";
  const signature = createHmac("sha256", SECRET)
    .update(`${timestamp}.${eventId}.`)
    .update(raw)
    .digest("hex");
  const verify = (changes: Partial<Parameters<typeof verifyInboundRelaySignature>[0]> = {}) =>
    verifyInboundRelaySignature({
      rawBody: raw,
      timestampHeader: String(timestamp),
      eventIdHeader: eventId,
      signatureHeader: `v1=${signature}`,
      secrets: [SECRET],
      now: NOW,
      ...changes,
    });
  assert.equal(await verify(), true);
  assert.equal(await verify({ rawBody: new TextEncoder().encode("{}") }), false);
  assert.equal(await verify({ eventIdHeader: "evt_20260823_different" }), false);
  assert.equal(await verify({ now: NOW + 5 * 60 * 1000 + 1 }), false);
  assert.equal(await verify({ secrets: ["short"] }), false);
});

test("authenticated exact replies and STOP are classified without storing content", () => {
  assert.deepEqual(
    classifyInboundRelay({ payload: payload(), candidate, now: NOW }),
    { kind: "reply", fromEmail: "editor@example.org" },
  );
  assert.deepEqual(
    classifyInboundRelay({
      payload: payload({ text: "STOP" }),
      candidate,
      now: NOW,
    }),
    { kind: "unsubscribe", fromEmail: "editor@example.org" },
  );
  const receipt = inboundRelayEvidenceReceipt({
    eventKey: "a".repeat(64),
    siteId: "site-a",
    messageId: "message-a",
    inboundMessageId: "<reply-abcdefgh@example.org>",
    outboundMessageIdHash: inboundRelayMessageIdHash(OUTBOUND_ID),
    aliasHash: "b".repeat(64),
    kind: "unsubscribe",
    fromEmail: "editor@example.org",
    receivedAt: NOW,
    subjectDigest: "subject-digest",
    bodyDigest: "body-digest",
  });
  assert.match(receipt, /body-digest/);
  assert.doesNotMatch(receipt, /STOP|Broken resource/);
});

test("a hard-DSN canary is exact-ID, exact-recipient and bodyless", () => {
  const bounce = payload({
    from: "Mailer Daemon <mailer-daemon@mx.example>",
    authentication: {
      verdict: "pass",
      method: "spf",
      alignedFrom: "mailer-daemon@mx.example",
    },
    dsn: {
      source: "message/delivery-status",
      action: "failed",
      status: "5.1.1",
      finalRecipient: "pentra-bounce@reject.example",
      originalMessageId: OUTBOUND_ID,
    },
  });
  const canary = {
    testRecipientHash: inboundRelayEmailHash("pentra-bounce@reject.example"),
    outboundRfcMessageIdHash: inboundRelayMessageIdHash(OUTBOUND_ID),
    issuedAt: SENT_AT,
    expiresAt: NOW + 60_000,
  };
  assert.deepEqual(
    classifyInboundRelayDsnCanary({ payload: bounce, candidate: canary, now: NOW }),
    { fromEmail: "mailer-daemon@mx.example" },
  );
  assert.equal(
    classifyInboundRelayDsnCanary({
      payload: payload({
        ...rawPayload(),
        from: "Mailer Daemon <mailer-daemon@mx.example>",
        authentication: {
          verdict: "pass",
          method: "spf",
          alignedFrom: "mailer-daemon@mx.example",
        },
        dsn: {
          source: "message/delivery-status",
          action: "failed",
          status: "5.1.1",
          finalRecipient: "attacker@example.org",
          originalMessageId: OUTBOUND_ID,
        },
      }),
      candidate: canary,
      now: NOW,
    }),
    null,
  );
  const receipt = inboundRelayCanaryEvidenceReceipt({
    eventKey: "a".repeat(64),
    siteId: "site-a",
    inboxId: "inbox-a",
    canaryId: "canary-a",
    aliasHash: "b".repeat(64),
    inboundMessageId: "<dsn@example.org>",
    outboundMessageIdHash: inboundRelayMessageIdHash(OUTBOUND_ID),
    receivedAt: NOW,
    adapterVersion: ADAPTER_VERSION,
    retentionPolicyHash: RETENTION_POLICY_HASH,
  });
  assert.doesNotMatch(receipt, /pentra-bounce@|reply-|hard-bounce routing canary/i);
});

test("same-domain handoffs can record replies but cannot create STOP suppression", () => {
  assert.deepEqual(
    classifyInboundRelay({
      payload: payload({
        from: "Owner <owner@example.org>",
        text: "STOP",
        authentication: {
          verdict: "pass",
          method: "dmarc",
          alignedFrom: "owner@example.org",
        },
      }),
      candidate,
      now: NOW,
    }),
    { kind: "reply", fromEmail: "owner@example.org" },
  );
});

test("spoofed sender evidence and missing reply headers fail closed", () => {
  assert.equal(
    classifyInboundRelay({
      payload: payload({
        authentication: {
          verdict: "pass",
          method: "dkim",
          alignedFrom: "attacker@evil.example",
        },
      }),
      candidate,
      now: NOW,
    }).kind,
    "ignored",
  );
  assert.deepEqual(
    classifyInboundRelay({
      payload: payload({ inReplyTo: undefined, references: [] }),
      candidate,
      now: NOW,
    }),
    {
      kind: "ignored",
      reason: "missing_reply_proof",
      fromEmail: "editor@example.org",
    },
  );
});

test("hard bounce needs an authenticated daemon, structured DSN and exact recipient", () => {
  const bounce = payload({
    from: "Mailer Daemon <mailer-daemon@mx.example>",
    authentication: {
      verdict: "pass",
      method: "spf",
      alignedFrom: "mailer-daemon@mx.example",
    },
    dsn: {
      source: "message/delivery-status",
      action: "failed",
      status: "5.1.1",
      finalRecipient: "editor@example.org",
      originalMessageId: OUTBOUND_ID,
    },
  });
  assert.deepEqual(classifyInboundRelay({ payload: bounce, candidate, now: NOW }), {
    kind: "bounce",
    fromEmail: "mailer-daemon@mx.example",
  });
  assert.equal(
    classifyInboundRelay({
      payload: payload({
        from: "Mailer Daemon <mailer-daemon@mx.example>",
        authentication: {
          verdict: "pass",
          method: "spf",
          alignedFrom: "mailer-daemon@mx.example",
        },
        dsn: {
          source: "message/delivery-status",
          action: "failed",
          status: "4.2.0",
          finalRecipient: "editor@example.org",
          originalMessageId: OUTBOUND_ID,
        },
      }),
      candidate,
      now: NOW,
    }).kind,
    "ignored",
  );
  assert.equal(
    parseInboundRelayPayload(JSON.stringify(rawPayload({
      dsn: {
        source: "body_guess",
        action: "failed",
        status: "5.1.1",
        finalRecipient: "editor@example.org",
        originalMessageId: OUTBOUND_ID,
      },
    }))),
    null,
  );
});

test("the relay contract bounds every body and rejects missing authentication", () => {
  assert.equal(OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES, 64 * 1024);
  assert.equal(parseInboundRelayPayload(JSON.stringify(rawPayload({ authentication: undefined }))), null);
  assert.equal(parseInboundRelayPayload(JSON.stringify(rawPayload({ text: "x".repeat(50_001) }))), null);
  assert.equal(parseInboundRelayPayload(JSON.stringify(rawPayload({ references: Array(21).fill(OUTBOUND_ID) }))), null);
});

test("durable relay ingestion is bodyless, replay-safe, tenant-gated and receiving-only", () => {
  const http = readFileSync("convex/http.ts", "utf8");
  const backend = readFileSync("convex/outreach.ts", "utf8");
  const schema = readFileSync("convex/schema.ts", "utf8");
  const delivery = readFileSync("convex/actions/outreach.ts", "utf8");

  const route = http.slice(
    http.indexOf('path: "/webhooks/outreach-inbound"'),
    http.indexOf('path: "/internal/oauth/site"'),
  );
  assert.match(route, /verifyInboundRelaySignature/);
  assert.match(route, /OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES/);
  assert.match(route, /getInboundRelayCandidate/);
  assert.match(route, /recordInboundRelayReceipt/);
  assert.doesNotMatch(route, /sendApproved|deliver\(|messages\/send/);
  assert.match(backend, /relaySettlementAuthorized/);
  assert.match(backend, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(backend, /outreachSettlementPolicy/);
  assert.match(backend, /maximumDeliveryBoundaryAt < cutoff/);
  assert.match(backend, /accountDeletionRequestedAt/);
  assert.match(backend, /inboundRelayRolloutEpoch/);
  assert.match(backend, /inboundRelayInboxConfigurationVersion/);
  assert.match(backend, /priorEvent\.payloadHash !== args\.payloadHash/);
  assert.match(schema, /outreach_inbound_relay_receipts/);
  assert.match(schema, /outreach_inbound_relay_canaries/);
  assert.match(schema, /inboundRelayOutboundMessageIdHash/);
  assert.doesNotMatch(schema, /inboundRelayOutboundMessageId: v/);
  assert.doesNotMatch(schema, /relay(?:Subject|Body)|inbound(?:Message)?Body/i);
  assert.match(delivery, /relayAliasToken[\s\S]*relayMessageToken/);
  assert.match(delivery, /sendInboundRelayDsnCanary/);
  assert.match(delivery, /OUTREACH_INBOUND_RELAY_CANARY_RECIPIENT/);
  assert.match(backend, /inboundRelayDsnRoutingReady/);
  assert.match(backend, /OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS/);
  assert.match(backend, /already been attempted for this inbox today/);
  assert.match(backend, /\["claimed", "accepted", "unverified"\]\.includes/);
  assert.match(delivery, /Reply-To/);
  assert.match(delivery, /Message-ID/);
});
