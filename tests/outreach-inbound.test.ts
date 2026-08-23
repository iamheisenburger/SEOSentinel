import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyOutreachInbound,
  outreachInboundReceipt,
  requestsOutreachOptOut,
  shouldPromoteOutreachInbound,
  type OutreachInboundCandidate,
  type OutreachInboundEvidence,
} from "../convex/lib/outreachInbound.ts";

const SENT_AT = Date.UTC(2026, 7, 23, 12, 0, 0);
const candidate: OutreachInboundCandidate = {
  messageId: "message-a",
  providerMessageId: "gmail-sent-a",
  providerThreadId: "gmail-thread-a",
  toEmail: "editor@example.org",
  toDomain: "example.org",
  sentAt: SENT_AT,
};

function evidence(
  overrides: Partial<OutreachInboundEvidence> = {},
): OutreachInboundEvidence {
  return {
    providerMessageId: "gmail-inbound-a",
    providerThreadId: "gmail-thread-a",
    fromEmail: "Editor <editor@example.org>",
    subject: "Re: Broken resource",
    bodyText: "Thanks, I will take a look.",
    mimeTypes: ["text/plain"],
    receivedAt: SENT_AT + 60_000,
    ...overrides,
  };
}

test("an exact non-automatic Gmail thread reply is receipt-bound", () => {
  assert.deepEqual(
    classifyOutreachInbound({
      evidence: evidence(),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    }),
    { candidate, kind: "reply" },
  );
  assert.equal(
    classifyOutreachInbound({
      evidence: evidence({ providerThreadId: "another-thread" }),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    }),
    null,
  );
});

test("explicit STOP suppresses but a quoted Pentra footer does not", () => {
  assert.equal(requestsOutreachOptOut("STOP"), true);
  assert.equal(requestsOutreachOptOut("Please remove me from your list."), true);
  assert.equal(
    requestsOutreachOptOut(
      "Thanks, I will review this.\n\nOn Sun, Aug 23, 2026 Alex wrote:\nReply STOP and I will not contact you.",
    ),
    false,
  );
  assert.equal(
    classifyOutreachInbound({
      evidence: evidence({ bodyText: "Please do not contact me again." }),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    })?.kind,
    "unsubscribe",
  );
});

test("automatic vacation responses do not masquerade as human replies", () => {
  assert.equal(
    classifyOutreachInbound({
      evidence: evidence({
        subject: "Automatic reply: Broken resource",
        autoSubmitted: "auto-replied",
      }),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    }),
    null,
  );
});

test("hard bounces require a daemon, failure evidence, and the exact recipient", () => {
  assert.deepEqual(
    classifyOutreachInbound({
      evidence: evidence({
        providerThreadId: "bounce-thread",
        fromEmail: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        bodyText: "550 5.1.1 Address not found: editor@example.org",
        mimeTypes: ["multipart/report", "message/delivery-status"],
        failedRecipients: ["editor@example.org"],
      }),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    }),
    { candidate, kind: "bounce" },
  );
  assert.equal(
    classifyOutreachInbound({
      evidence: evidence({
        providerThreadId: "bounce-thread",
        fromEmail: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        bodyText: "550 5.1.1 Address not found: someone-else@example.org",
        failedRecipients: ["someone-else@example.org"],
      }),
      candidates: [candidate],
      senderEmail: "alex@gettenant.com",
    }),
    null,
  );
});

test("inbound evidence receipts contain digests, not mailbox body text", () => {
  const receipt = outreachInboundReceipt({
    siteId: "site-a",
    messageId: "message-a",
    providerMessageId: "gmail-inbound-a",
    providerThreadId: "gmail-thread-a",
    kind: "unsubscribe",
    fromEmail: "editor@example.org",
    receivedAt: SENT_AT + 60_000,
    subjectDigest: "subject-hash",
    bodyDigest: "body-hash",
  });
  assert.match(receipt, /body-hash/);
  assert.doesNotMatch(receipt, /do not contact me/i);
  assert.equal(receipt, outreachInboundReceipt({
    siteId: "site-a",
    messageId: "message-a",
    providerMessageId: "gmail-inbound-a",
    providerThreadId: "gmail-thread-a",
    kind: "unsubscribe",
    fromEmail: "editor@example.org",
    receivedAt: SENT_AT + 60_000,
    subjectDigest: "subject-hash",
    bodyDigest: "body-hash",
  }));
});

test("stronger inbound outcomes dominate while older pages cannot overwrite newer receipts", () => {
  assert.equal(
    shouldPromoteOutreachInbound({
      existingKind: "reply",
      existingAt: SENT_AT + 120_000,
      nextKind: "reply",
      nextAt: SENT_AT + 60_000,
    }),
    false,
  );
  assert.equal(
    shouldPromoteOutreachInbound({
      existingKind: "reply",
      existingAt: SENT_AT + 120_000,
      nextKind: "unsubscribe",
      nextAt: SENT_AT + 60_000,
    }),
    true,
  );
  assert.equal(
    shouldPromoteOutreachInbound({
      existingKind: "unsubscribe",
      existingAt: SENT_AT + 60_000,
      nextKind: "bounce",
      nextAt: SENT_AT + 120_000,
    }),
    false,
  );
});

test("the durable inbound path is leased, tenant-scoped, bodyless, and suppression-first", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  const schema = readFileSync("convex/schema.ts", "utf8");
  const privacy = readFileSync("src/app/legal/privacy/page.tsx", "utf8");

  assert.match(backend, /claimInboundSync = internalMutation/);
  assert.match(backend, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(backend, /inboundSyncLeaseId/);
  assert.match(backend, /recordInboundReceipt = internalMutation/);
  assert.match(backend, /addSuppression\(ctx, args\.siteId, "domain"/);
  assert.match(backend, /addSuppression\(ctx, args\.siteId, "email"/);
  assert.match(action, /OUTREACH_INBOUND_TOTAL_DEADLINE_MS/);
  assert.match(action, /boundedResponseJson/);
  assert.doesNotMatch(schema, /inbound(?:Message)?Body/i);
  assert.match(schema, /inboundReceiptHash/);
  assert.match(privacy, /Inbound message bodies are processed transiently/);
  assert.match(privacy, /Google API Services User Data Policy/);
  assert.match(privacy, /Limited Use requirements/);
  assert.match(
    privacy,
    /never used to train, retrain, or improve a generalized or non-personalized AI/,
  );
  assert.match(privacy, /Google Workspace and Gmail APIs/);
});
