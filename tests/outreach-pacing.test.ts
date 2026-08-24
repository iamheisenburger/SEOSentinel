import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAILY_SEND_CAP,
  DOMAIN_CONTACT_COOLDOWN_DAYS,
  MAX_SEQUENCE_STEP,
  OUTREACH_PACING_VERSION,
  OUTREACH_MIN_SEND_INTERVAL_MS,
  WARMUP_DAYS,
  WARMUP_INITIAL_DAILY_CAP,
  contactEligibility,
  nextFollowUpAt,
  normalizeDomain,
  outreachComplianceIssues,
  outreachSendDecision,
  outreachSenderReadinessIssues,
  utcDayKey,
  warmupDailyCap,
} from "../convex/lib/outreachPacing.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

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

test("outreach sender must use a secondary-domain Gmail business mailbox", () => {
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "gmail",
    fromEmail: "outreach@leadpilot.chat",
  }).some((issue) => /primary/.test(issue)));
  assert.ok(outreachSenderReadinessIssues({
    siteDomain: "leadpilot.chat",
    provider: "resend",
    fromEmail: "outreach@getleadpilot.com",
  }).some((issue) => /transactional/.test(issue)));
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
    history: [{ domain: "example.com", lastContactedAt: NOW - 10 * DAY }],
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

test("follow-ups stop after the sequence and after any reply", () => {
  const first = nextFollowUpAt({ sequenceStep: 0, lastSentAt: NOW });
  assert.equal(first, NOW + 4 * DAY);
  assert.equal(
    nextFollowUpAt({ sequenceStep: 1, lastSentAt: first! }),
    NOW + 9 * DAY,
    "the second follow-up lands nine days after the initial, not nine days after the first follow-up",
  );
  assert.equal(nextFollowUpAt({ sequenceStep: 0, lastSentAt: NOW, replied: true }), null);
  assert.equal(nextFollowUpAt({ sequenceStep: MAX_SEQUENCE_STEP, lastSentAt: NOW }), null);
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
