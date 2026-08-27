import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_DAILY_SEND_CAP,
  DOMAIN_CONTACT_COOLDOWN_DAYS,
  FOLLOW_UP_SCHEDULE_DAYS,
  MAX_SEQUENCE_STEP,
  OUTREACH_PACING_VERSION,
  OUTREACH_MIN_SEND_INTERVAL_MS,
  WARMUP_DAYS,
  WARMUP_INITIAL_DAILY_CAP,
  contactEligibility,
  nextFollowUpAt,
  normalizeDomain,
  outreachComplianceIssues,
  outreachDeliverySettlementDecision,
  outreachSendDecision,
  outreachSenderConnectionIssues,
  outreachSenderReadinessIssues,
  utcDayKey,
  warmupDailyCap,
} from "../convex/lib/outreachPacing.ts";
import {
  durablePacingReceiptOwnership,
  effectiveDurablePacingState,
  mergeDurablePacingState,
  outreachRecipientDomainKey,
} from "../convex/lib/outreachDurability.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const durabilitySource = readFileSync("convex/lib/outreachDurability.ts", "utf8");

test("consumer Gmail may connect for a self-test but never becomes outreach-ready", () => {
  assert.deepEqual(outreachSenderConnectionIssues({
    siteDomain: "leadpilot.chat",
    provider: "gmail",
    fromEmail: "leadpilotchat@gmail.com",
  }), []);
  assert.match(
    outreachSenderReadinessIssues({
      siteDomain: "leadpilot.chat",
      provider: "gmail",
      fromEmail: "leadpilotchat@gmail.com",
    }).join(" "),
    /consumer mailbox/,
  );
});

test("the bounded follow-up schedule stretches from verified predecessor receipts", () => {
  assert.deepEqual(FOLLOW_UP_SCHEDULE_DAYS, [4, 9]);
  assert.equal(MAX_SEQUENCE_STEP, 2);
  assert.equal(nextFollowUpAt({ sequenceStep: 0, lastSentAt: NOW }), NOW + 4 * DAY);
  const delayedFirstFollowUp = NOW + 6 * DAY;
  assert.equal(
    nextFollowUpAt({ sequenceStep: 1, lastSentAt: delayedFirstFollowUp }),
    delayedFirstFollowUp + 5 * DAY,
  );
  assert.equal(nextFollowUpAt({ sequenceStep: 2, lastSentAt: NOW }), null);
  assert.equal(nextFollowUpAt({ sequenceStep: 0, lastSentAt: NOW, cancelled: true }), null);
  assert.equal(nextFollowUpAt({ sequenceStep: -1, lastSentAt: NOW }), null);
});

test("a brand new inbox starts at the small warm-up volume", () => {
  assert.equal(
    warmupDailyCap({ now: NOW, targetCap: DEFAULT_DAILY_SEND_CAP }),
    WARMUP_INITIAL_DAILY_CAP,
  );
});

test("warm-up ramps to the configured cap and never exceeds it", () => {
  const started = NOW - 7 * DAY;
  const mid = warmupDailyCap({ warmupStartedAt: started, now: NOW, targetCap: 30 });
  assert.ok(mid > WARMUP_INITIAL_DAILY_CAP && mid < 30);

  const complete = warmupDailyCap({
    warmupStartedAt: NOW - (WARMUP_DAYS + 5) * DAY,
    now: NOW,
    targetCap: 30,
  });
  assert.equal(complete, 30);

  // A small configured cap is respected even after warm-up.
  assert.equal(
    warmupDailyCap({ warmupStartedAt: NOW - 60 * DAY, now: NOW, targetCap: 3 }),
    3,
  );
});

test("sending is refused without a connected inbox", () => {
  const decision = outreachSendDecision({ inbox: null, now: NOW });
  assert.equal(decision.allowed, false);
  assert.equal(decision.version, OUTREACH_PACING_VERSION);
  assert.match(decision.reason, /No outreach inbox/);
});

test("approval mode never sends automatically", () => {
  const decision = outreachSendDecision({
    inbox: { provider: "gmail", status: "active", mode: "approval", dailySendCap: 30, warmupStartedAt: NOW - 60 * DAY },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /approval mode/);
});

test("one explicitly approved message may send while automatic approval-mode delivery stays off", () => {
  const inbox = {
    provider: "gmail",
    status: "active",
    mode: "approval",
    dailySendCap: 30,
    warmupStartedAt: NOW - 60 * DAY,
  };
  assert.equal(outreachSendDecision({ inbox, now: NOW }).allowed, false);
  assert.equal(
    outreachSendDecision({ inbox, now: NOW, release: "approved" }).allowed,
    true,
  );
});

test("live mode sends within the effective cap and stops at it", () => {
  const inbox = {
    provider: "gmail",
    status: "active",
    mode: "live",
    dailySendCap: 30,
    warmupStartedAt: NOW - 60 * DAY,
    sentTodayDay: utcDayKey(NOW),
  };
  const ok = outreachSendDecision({ inbox: { ...inbox, sentToday: 10 }, now: NOW });
  assert.equal(ok.allowed, true);
  assert.equal(ok.effectiveDailyCap, 30);

  const capped = outreachSendDecision({ inbox: { ...inbox, sentToday: 30 }, now: NOW });
  assert.equal(capped.allowed, false);
  assert.match(capped.reason, /Daily send cap reached/);
});

test("yesterday's counter cannot authorise or block today", () => {
  const decision = outreachSendDecision({
    inbox: {
      provider: "gmail",
      status: "active",
      mode: "live",
      dailySendCap: 30,
      warmupStartedAt: NOW - 60 * DAY,
      sentToday: 30,
      sentTodayDay: utcDayKey(NOW - DAY),
    },
    now: NOW,
  });
  assert.equal(decision.allowed, true, "a stale day counter must reset");
});

test("the first post-rollout receipt preserves the legacy inbox count", () => {
  const merged = mergeDurablePacingState({
    mailboxKey: "mailbox-a",
    inboxWarmupStartedAt: NOW - 30 * DAY,
    inboxSentToday: 4,
    inboxSentTodayDay: utcDayKey(NOW),
    deliveredAt: NOW,
    increment: true,
  });
  assert.equal(merged.sentToday, 5);
  assert.equal(merged.sentTodayDay, utcDayKey(NOW));
});

test("a late older settlement cannot rewind the durable day or counter", () => {
  const merged = mergeDurablePacingState({
    existing: {
      mailboxKey: "mailbox-current",
      warmupStartedAt: NOW - 30 * DAY,
      sentToday: 5,
      sentTodayDay: utcDayKey(NOW),
      lastSentAt: NOW,
      updatedAt: NOW,
    },
    mailboxKey: "mailbox-old",
    inboxWarmupStartedAt: NOW - 60 * DAY,
    inboxSentToday: 9,
    inboxSentTodayDay: utcDayKey(NOW - DAY),
    deliveredAt: NOW - DAY,
    increment: true,
  });
  assert.equal(merged.sentTodayDay, utcDayKey(NOW));
  assert.equal(merged.sentToday, 5);
  assert.equal(merged.lastSentAt, NOW);
  assert.equal(merged.mailboxKey, "mailbox-current");
});

test("verified deletion preserves only unlinked monotonic sender reputation", () => {
  const helper = durabilitySource.slice(
    durabilitySource.indexOf(
      "export async function recordUnlinkedDurablePacingReceipt",
    ),
  );
  assert.match(helper, /withIndex\("by_sender"/);
  assert.match(helper, /accountKey: existing\.accountKey/);
  assert.match(helper, /tenantDomainKey: existing\.tenantDomainKey/);
  assert.match(helper, /mailboxKey: existing\.mailboxKey/);
  assert.match(helper, /increment = false/);
  assert.match(helper, /increment,/);
  assert.doesNotMatch(helper, /accountDeletionKey/);
});

test("a durable sender receipt written after connect controls preflight and claim pacing", () => {
  const effective = effectiveDurablePacingState({
    now: NOW,
    fromEmail: "new-alias@sender.example",
    inboxWarmupStartedAt: NOW,
    inboxSentToday: 1,
    inboxSentTodayDay: utcDayKey(NOW),
    inboxLastSentAt: NOW - OUTREACH_MIN_SEND_INTERVAL_MS - 1,
    durable: {
      mailboxKey: "different-mailbox-digest",
      warmupStartedAt: NOW - 60 * DAY,
      sentToday: WARMUP_INITIAL_DAILY_CAP,
      sentTodayDay: utcDayKey(NOW),
      lastSentAt: NOW - 1_000,
      updatedAt: NOW - 1_000,
    },
  });
  assert.equal(effective.warmupStartedAt, NOW, "a new mailbox keeps cold warm-up");
  assert.equal(effective.sentToday, WARMUP_INITIAL_DAILY_CAP);
  assert.equal(effective.lastSentAt, NOW - 1_000);
  const decision = outreachSendDecision({
    inbox: {
      provider: "gmail",
      status: "warming",
      mode: "live",
      dailySendCap: DEFAULT_DAILY_SEND_CAP,
      ...effective,
    },
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Daily send cap reached/);

  const spacingOnly = outreachSendDecision({
    inbox: {
      provider: "gmail",
      status: "active",
      mode: "live",
      dailySendCap: DEFAULT_DAILY_SEND_CAP,
      warmupStartedAt: NOW - 60 * DAY,
      sentToday: 1,
      sentTodayDay: utcDayKey(NOW),
      lastSentAt: effective.lastSentAt,
    },
    now: NOW,
  });
  assert.equal(spacingOnly.allowed, false);
  assert.match(spacingOnly.reason, /spacing/);
});

test("late historical materialization cannot steal a newer sender owner", () => {
  const ownership = durablePacingReceiptOwnership({
    existingAccountKey: "account-b",
    existingTenantDomainKey: "tenant-b",
    incomingAccountKey: "account-a",
    incomingTenantDomainKey: "tenant-a",
  });
  assert.deepEqual(ownership, {
    accountKey: "account-b",
    tenantDomainKey: "tenant-b",
    preservesExistingOwner: true,
  });
  assert.equal(
    durablePacingReceiptOwnership({
      existingAccountKey: "account-a",
      existingTenantDomainKey: "tenant-a",
      incomingAccountKey: "account-a",
      incomingTenantDomainKey: "tenant-a",
    }).preservesExistingOwner,
    false,
  );
  assert.deepEqual(
    durablePacingReceiptOwnership({
      existingAccountKey: undefined,
      existingTenantDomainKey: undefined,
      incomingAccountKey: "account-b",
      incomingTenantDomainKey: "tenant-b",
    }),
    {
      accountKey: undefined,
      tenantDomainKey: undefined,
      preservesExistingOwner: true,
    },
  );
});

test("recipient cooldown identity follows an organisation across subdomains", () => {
  assert.equal(
    outreachRecipientDomainKey("blog.example.com"),
    outreachRecipientDomainKey("news.example.com"),
  );
  assert.notEqual(
    outreachRecipientDomainKey("alice.substack.com"),
    outreachRecipientDomainKey("bob.substack.com"),
  );
});

test("messages are spaced even after explicit approval", () => {
  const decision = outreachSendDecision({
    inbox: {
      provider: "gmail",
      status: "active",
      mode: "approval",
      dailySendCap: 30,
      warmupStartedAt: NOW - 60 * DAY,
      lastSentAt: NOW - OUTREACH_MIN_SEND_INTERVAL_MS + 1,
    },
    now: NOW,
    release: "approved",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /spacing/);
});

test("outreach sender must use secondary-domain Gmail or the exact managed platform sender", () => {
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "gmail",
    fromEmail: "outreach@leadpilot.chat",
  }).some((issue) => /primary/.test(issue)));
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "resend",
    fromEmail: "outreach@getleadpilot.com",
  }).some((issue) => /Gmail or Pentra's managed sender/.test(issue)));
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "https://app.example.co.uk",
    provider: "gmail",
    fromEmail: "outreach@mailer.example.co.uk",
  }).some((issue) => /primary/.test(issue)));
  assert.deepEqual(outreachSenderReadinessIssues({
    siteDomain: "https://app.example.co.uk",
    provider: "gmail",
    fromEmail: "outreach@mailer.another.co.uk",
  }), []);
  assert.deepEqual(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "managed_ses",
    fromEmail: "tenant@mail.pentra.dev",
  }), []);
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "managed_ses",
    fromEmail: "tenant@unreviewed.example",
  }).some((issue) => /reviewed platform outreach domain/.test(issue)));
});

test("suppression and prior contact block a domain", () => {
  assert.equal(
    contactEligibility({
      sourceDomain: "https://www.example.com/post",
      now: NOW,
      suppressedDomains: ["example.com"],
    }).eligible,
    false,
  );
  assert.equal(
    contactEligibility({
      sourceDomain: "example.com",
      now: NOW,
      toEmail: "editor@example.com",
      suppressedEmails: ["Editor@Example.com"],
    }).eligible,
    false,
  );
  const recent = contactEligibility({
    sourceDomain: "example.com",
    now: NOW,
    history: [
      { domain: "example.com", lastContactedAt: NOW - 95 * DAY },
      { domain: "news.example.com", lastContactedAt: NOW - 10 * DAY },
    ],
  });
  assert.equal(recent.eligible, false);
  assert.match(recent.reason, /cooldown/);

  const expired = contactEligibility({
    sourceDomain: "example.com",
    now: NOW,
    history: [
      { domain: "example.com", lastContactedAt: NOW - (DOMAIN_CONTACT_COOLDOWN_DAYS + 1) * DAY },
    ],
  });
  assert.equal(expired.eligible, true);
});

function completeAfterAuthorityInterleaving(
  opportunityStatus: string,
  opportunityEvidenceHash = "evidence-a",
): { opportunityStatus: string } {
  const decision = outreachDeliverySettlementDecision({
    sequenceStep: 0,
    messageSiteId: "site-a",
    opportunitySiteId: "site-a",
    messageEvidenceHash: "evidence-a",
    opportunityEvidenceHash,
    messageSourceUrl: "https://example.com/source",
    opportunitySourceUrl: "https://example.com/source",
    messageTargetUrl: "https://tenant.example/target",
    opportunityTargetUrl: "https://tenant.example/target",
    opportunityStatus,
  });
  return {
    opportunityStatus: decision.shouldMarkContacted
      ? "contacted"
      : opportunityStatus,
  };
}

test("claim -> markAcquired -> complete preserves acquired and creates no follow-up", () => {
  assert.deepEqual(completeAfterAuthorityInterleaving("acquired"), {
    opportunityStatus: "acquired",
  });
});

test("claim -> rejectUnconfirmed -> complete preserves rejected and creates no follow-up", () => {
  assert.deepEqual(completeAfterAuthorityInterleaving("rejected"), {
    opportunityStatus: "rejected",
  });
});

test("settlement updates only the initial opportunity lifecycle; follow-up creation is separately receipt-gated", () => {
  assert.deepEqual(completeAfterAuthorityInterleaving("outreach_prepared"), {
    opportunityStatus: "contacted",
  });
  assert.deepEqual(
    outreachDeliverySettlementDecision({
      sequenceStep: 1,
      messageSiteId: "site-a",
      opportunitySiteId: "site-a",
      messageEvidenceHash: "evidence-a",
      opportunityEvidenceHash: "evidence-a",
      messageSourceUrl: "https://example.com/source",
      opportunitySourceUrl: "https://example.com/source",
      messageTargetUrl: "https://tenant.example/target",
      opportunityTargetUrl: "https://tenant.example/target",
      opportunityStatus: "contacted",
    }),
    {
      opportunityBindingMatchesClaim: true,
      lifecycleMatchesClaim: false,
      shouldMarkContacted: false,
    },
  );
});

test("claim -> refreshed opportunity evidence -> complete records no lifecycle or follow-up", () => {
  assert.deepEqual(
    completeAfterAuthorityInterleaving("outreach_prepared", "evidence-b"),
    {
      opportunityStatus: "outreach_prepared",
    },
  );
});

test("compliance blocks unsafe or unfinished messages", () => {
  const issues = outreachComplianceIssues({
    body: "Hi {{FIRST_NAME}}, short.",
    toEmail: "not-an-email",
    fromEmail: "",
    brandName: "Tenant",
  });
  assert.ok(issues.some((i) => /too short/.test(i)));
  assert.ok(issues.some((i) => /valid email/.test(i)));
  assert.ok(issues.some((i) => /verified sender/.test(i)));
  assert.ok(issues.some((i) => /physical mailing address/.test(i)));
  assert.ok(issues.some((i) => /opt out/.test(i)));
  assert.ok(issues.some((i) => /commercial outreach/.test(i)));
  assert.ok(issues.some((i) => /placeholders/.test(i)));

  const clean = outreachComplianceIssues({
    body:
      "Hi Sam, your guide to conversion testing links to a page that now 404s. " +
      "We published a replacement that covers the same ground if it is useful. " +
      "This is a commercial outreach message from LeadPilot. " +
      "Reply STOP and I will not contact you again. 123 Market Street, San Francisco, CA 94105",
    toEmail: "sam@example.com",
    fromEmail: "hello@leadpilot.chat",
    brandName: "LeadPilot",
    physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
  });
  assert.deepEqual(clean, []);
});

test("domain normalisation is consistent", () => {
  assert.equal(normalizeDomain("https://www.Example.com/a/b"), "example.com");
  assert.equal(normalizeDomain("EXAMPLE.com"), "example.com");
});
