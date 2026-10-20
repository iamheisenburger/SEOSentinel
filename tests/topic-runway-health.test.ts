import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { healthFingerprint } from "../convex/lib/opsEmail.ts";

// The daily health email's topic rule (P134). A site's topic runway is the
// articles already ready plus the topics left, one per slot; it is flagged only
// when keyword research will not refill it before it ends.
const source = buildSync({ entryPoints: ["convex/contentHealth.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*", "@clerk/backend", "nodemailer", "imapflow", "mailparser"], write: false }).outputFiles[0].text;
const runtime = { exports: {} as Record<string, never> };
runInNewContext(source, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder,
  console, setTimeout, clearTimeout, process });
type Verdict = { status: "ok" | "attention"; problems: string[]; nudge: boolean };
const { describeSiteHealth, formatHealthReport, TOPIC_RUNWAY_ALERT_MS } = runtime.exports as unknown as {
  describeSiteHealth(input: Record<string, unknown>): Verdict;
  formatHealthReport(sites: Record<string, unknown>[], now: number, detailDomains?: string[]): { subject: string; text: string } | string;
  TOPIC_RUNWAY_ALERT_MS: number;
};

const HOUR = 3_600_000, DAY = 24 * HOUR, NOW = Date.UTC(2026, 9, 20, 13);
function health(input: { ready: number; planned: number; researchDueAt: number | null; intervalMs?: number; paused?: boolean }): Verdict {
  // A plain copy: the bundle runs in its own realm, whose arrays fail strict deep equality.
  return JSON.parse(JSON.stringify(describeSiteHealth({ now: NOW, schedule: { nextDeadlineAt: NOW + 5 * HOUR, intervalMs: input.intervalMs ?? DAY, paused: input.paused },
    autopilotEnabled: true, approvalRequired: false, lastPublishedAt: NOW - 19 * HOUR, readyForNextSlots: input.ready, strandedReady: 0,
    failedAtSlot: null, unresolvedFailures: [], destinationVerified: true, topicsLeft: input.planned, plannedTopics: input.planned,
    researchDueAt: input.researchDueAt })));
}
const topicProblems = (v: Verdict) => v.problems.filter(p => /topic/.test(p));

test("a short topic list is not flagged while ready articles and the next research cover every slot", () => {
  // LeadPilot on Oct 20 2026: 1 topic, 2 ready, one article a day, research due the next day.
  const leadpilot = health({ ready: 2, planned: 1, researchDueAt: NOW + 20 * HOUR });
  assert.deepEqual(leadpilot, { status: "ok", problems: [], nudge: false });
  // Research that is just due starts at the next slot: a nudge, not a problem.
  const due = health({ ready: 2, planned: 0, researchDueAt: NOW - HOUR });
  assert.deepEqual(topicProblems(due), []);
  assert.equal(due.nudge, true, "the scheduler is nudged so research starts now");
  assert.deepEqual(topicProblems(health({ ready: 0, planned: 12, researchDueAt: null })), [], "12 days of topics need no research yet");
});

test("the runway is flagged when research comes after it ends, is overdue, or never runs", () => {
  const late = health({ ready: 0, planned: 1, researchDueAt: NOW + 3 * DAY });
  assert.equal(late.status, "attention");
  assert.deepEqual(topicProblems(late), ["topics run out after 10-20 18:00 UTC, before the next keyword research; keyword research next runs 10-23 13:00 UTC"]);
  // Research a slot and six hours overdue (it starts at the next slot, so it is stuck) with under 3 days left.
  assert.deepEqual(topicProblems(health({ ready: 1, planned: 0, researchDueAt: NOW - 31 * HOUR })),
    ["topics run out after 10-20 18:00 UTC; keyword research is due now"]);
  assert.deepEqual(topicProblems(health({ ready: 1, planned: 0, researchDueAt: NOW - 29 * HOUR })), [], "not yet stuck");
  assert.deepEqual(topicProblems(health({ ready: 5, planned: 0, researchDueAt: NOW - 31 * HOUR })), [], "a long runway gives research time");
  // No Autopilot research scheduled: flagged once under 3 days are left.
  assert.ok(TOPIC_RUNWAY_ALERT_MS === 3 * DAY);
  assert.deepEqual(topicProblems(health({ ready: 1, planned: 1, researchDueAt: null })), ["topics run out after 10-21 18:00 UTC and no keyword research is scheduled"]);
  assert.deepEqual(topicProblems(health({ ready: 1, planned: 3, researchDueAt: null })), [], "runs out 10-23 18:00, over 3 days away");
});

test("nothing left is always flagged; a paused site is not counted", () => {
  const empty = health({ ready: 0, planned: 0, researchDueAt: NOW - HOUR });
  assert.deepEqual(topicProblems(empty), ["no topics left to write; keyword research is due now"]);
  assert.equal(empty.nudge, true);
  assert.deepEqual(topicProblems(health({ ready: 0, planned: 0, researchDueAt: NOW + DAY })), ["no topics left to write; keyword research next runs 10-21 13:00 UTC"]);
  assert.deepEqual(topicProblems(health({ ready: 0, planned: 0, researchDueAt: NOW + 3 * DAY, paused: true })), []);
});

test("the daily report shows the runway with ready articles, and topic lines never change the six-hourly fingerprint", () => {
  const site = { siteId: "s", domain: "leadpilot.chat", status: "ok", problems: [], lastPublishedAt: NOW - 19 * HOUR, nextDeadlineAt: NOW + 5 * HOUR,
    intervalMs: DAY, readyForNextSlots: 2, strandedReady: 0, destinationVerified: true, topicsLeft: 1, plannedTopics: 1, lastResearchAt: NOW - 2 * DAY,
    lastResearchAdded: 4, researchDueAt: NOW + 20 * HOUR, nudge: false };
  const report = formatHealthReport([site], NOW, ["leadpilot.chat"]);
  const text = typeof report === "string" ? report : report.text;
  assert.match(text, /topics left 1 \(1 with search demand\); with 2 ready, about 3 days of slots covered; last keyword research 10-18 13:00 UTC \(\+4\); next 10-21 09:00 UTC/);
  const watch = [{ siteId: "s", status: "attention", problems: ["next article is 4h overdue"] }];
  assert.equal(healthFingerprint([{ siteId: "s", status: "attention", problems: ["next article is 3h overdue",
    "topics run out after 10-21 18:00 UTC, before the next keyword research"] }]), healthFingerprint(watch));
});
