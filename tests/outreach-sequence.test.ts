import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  inboundRelayMessageIdHash,
  inboundRelayOutboundMessageIdForAttempt,
} from
  "../convex/lib/outreachInboundRelay.ts";
import { followUpPredecessorDecision } from
  "../convex/lib/outreachSequence.ts";

const DAY = 24 * 60 * 60 * 1000;
const SENT_AT = Date.UTC(2026, 7, 25, 12, 0, 0);
const OWNER = "a".repeat(64);
const RFC_MESSAGE_ID = "<verified-parent-1234@sender.example>";

test("thread references are reconstructed transiently from an exact attempt", async () => {
  const args = {
    siteId: "site-a",
    inboxId: "inbox-a",
    deliveryAttemptId: "attempt-a",
    senderDomain: "sender.example",
    secret: "s".repeat(32),
  };
  const first = await inboundRelayOutboundMessageIdForAttempt(args);
  const replay = await inboundRelayOutboundMessageIdForAttempt(args);
  const otherAttempt = await inboundRelayOutboundMessageIdForAttempt({
    ...args,
    deliveryAttemptId: "attempt-b",
  });
  assert.match(first ?? "", /^<pentra\.[a-f0-9]{48}@sender\.example>$/);
  assert.equal(replay, first);
  assert.notEqual(otherAttempt, first);
  assert.equal(
    await inboundRelayOutboundMessageIdForAttempt({ ...args, secret: "short" }),
    null,
  );
});

const predecessor = {
  _id: "parent",
  siteId: "site-a",
  ownerAccountKey: OWNER,
  inboxId: "inbox-a",
  opportunityId: "opportunity-a",
  toEmail: "editor@publisher.example",
  toDomain: "publisher.example",
  threadKey: "site-a:publisher.example",
  sequenceStep: 0,
  status: "sent",
  sentAt: SENT_AT,
  providerThreadId: "gmail_thread_123",
  inboundRelayOutboundMessageIdHash:
    inboundRelayMessageIdHash(RFC_MESSAGE_ID),
};

const followUp = {
  _id: "follow-up-one",
  siteId: "site-a",
  ownerAccountKey: OWNER,
  inboxId: "inbox-a",
  opportunityId: "opportunity-a",
  toEmail: "editor@publisher.example",
  toDomain: "www.publisher.example",
  threadKey: "site-a:publisher.example",
  sequenceStep: 1,
  status: "approved",
  scheduledAt: SENT_AT + 4 * DAY,
  parentMessageId: "parent",
  deliveryExpectedThreadId: "gmail_thread_123",
  inReplyToRfcMessageIdHash: inboundRelayMessageIdHash(RFC_MESSAGE_ID),
};

test("an exact accepted predecessor authorizes one due threaded follow-up", () => {
  assert.deepEqual(
    followUpPredecessorDecision({
      message: followUp,
      predecessor,
      ownerAccountKey: OWNER,
      threadStopped: false,
    }),
    { allowed: true, providerThreadId: "gmail_thread_123" },
  );
});

test("ambiguous, reviewed, cross-owner and unthreaded predecessors fail closed", () => {
  for (const status of ["sending", "delivery_unverified", "delivery_reviewed_sent"] as const) {
    assert.equal(
      followUpPredecessorDecision({
        message: followUp,
        predecessor: { ...predecessor, status },
        ownerAccountKey: OWNER,
        threadStopped: false,
      }).allowed,
      false,
      status,
    );
  }
  assert.equal(
    followUpPredecessorDecision({
      message: followUp,
      predecessor: { ...predecessor, ownerAccountKey: "b".repeat(64) },
      ownerAccountKey: OWNER,
      threadStopped: false,
    }).allowed,
    false,
  );
  assert.equal(
    followUpPredecessorDecision({
      message: { ...followUp, deliveryExpectedThreadId: "other_thread" },
      predecessor,
      ownerAccountKey: OWNER,
      threadStopped: false,
    }).allowed,
    false,
  );
  assert.equal(
    followUpPredecessorDecision({
      message: { ...followUp, inReplyToRfcMessageIdHash: "b".repeat(64) },
      predecessor,
      ownerAccountKey: OWNER,
      threadStopped: false,
    }).allowed,
    false,
  );
});

test("a reply, STOP or bounce interleaving wins over an otherwise exact due step", () => {
  assert.deepEqual(
    followUpPredecessorDecision({
      message: followUp,
      predecessor,
      ownerAccountKey: OWNER,
      threadStopped: true,
    }),
    { allowed: false, reason: "thread_stopped" },
  );
});

test("follow-up creation is atomic with verified settlement and never runs on ambiguity", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  const helper = backend.slice(
    backend.indexOf("async function queueNextVerifiedAutonomousFollowUp"),
    backend.indexOf("export const completeDeliveryAttempt"),
  );
  const completion = backend.slice(
    backend.indexOf("export const completeDeliveryAttempt"),
    backend.indexOf("export const failDeliveryAttempt"),
  );
  const ambiguity = completion.slice(
    0,
    completion.indexOf('status: "sent"'),
  );
  assert.match(helper, /parent\.status !== "sent"/);
  assert.match(helper, /ctx\.db\.insert\("outreach_messages"/);
  assert.doesNotMatch(helper, /ctx\.scheduler/);
  assert.doesNotMatch(ambiguity, /queueNextVerifiedAutonomousFollowUp/);
  assert.ok(
    completion.indexOf('status: "sent"') <
      completion.lastIndexOf("queueNextVerifiedAutonomousFollowUp"),
    "the accepted parent is sealed before its child is inserted in the same mutation",
  );

  const failureAndReview = backend.slice(
    backend.indexOf("export const failDeliveryAttempt"),
    backend.indexOf("export const recordReply"),
  );
  assert.doesNotMatch(failureAndReview, /queueNextVerifiedAutonomousFollowUp/);
});

test("receipt-fenced cancellation covers owner disable, config drift and parking", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const cancellation = backend.slice(
    backend.indexOf("export const cancelAutonomousSequenceInternal"),
    backend.indexOf("export const enableAutonomousOutreach"),
  );
  assert.match(cancellation, /ownerAccountKey/);
  assert.match(cancellation, /consentVersion/);
  assert.match(cancellation, /consentPolicyHash/);
  assert.match(cancellation, /consentAcceptedAt/);
  assert.match(cancellation, /\.take\(50\)/);
  assert.match(cancellation, /cancelAutonomousSequenceInternal/);
  for (const marker of [
    "Authority autopilot was disabled",
    "sender identity or compliance profile changed",
    "signed reply, STOP, and bounce route changed",
    "outreach mailbox was disconnected",
  ]) assert.match(backend, new RegExp(marker, "i"));
  assert.match(sites, /tenant domain changed before this message became due/i);
  assert.match(sites, /parked outside its plan allowance before this message became due/i);
  assert.match(sites, /mode: "approval"/);
});
