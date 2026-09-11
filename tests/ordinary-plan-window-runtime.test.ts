import assert from "node:assert/strict";
import test from "node:test";
import { corePipelineFixture, START } from "./helpers/core-pipeline-fixture.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

const DAY = 86_400_000;
function fixture(cadencePerWeek = 7) {
  const f = corePipelineFixture(async () => { assert.fail("Window receipt cannot contact providers"); });
  const features = ["max_sites_unlimited", "max_articles_150"];
  const siteId = f.add("sites", { domain: "planning.example", userId: "synthetic-owner",
    createdAt: START - 10 * DAY, updatedAt: START, expectedClickSchedulingEnabled: true,
    autopilotEnabled: true, autopilotRolloutMode: "live", cadencePerWeek, planFeatures: features });
  f.add("account_plan_entitlements", { userId: "synthetic-owner", status: "completed",
    maxSites: 9999, maxArticles: 150, planFeatures: features });
  const addPlan = (patch: Record<string, unknown> = {}) => f.add("jobs", {
    siteId, type: "plan", status: "done", createdAt: START - 60_000,
    updatedAt: START - 30_000, payload: { reason: "topic_evidence_replenishment" }, ...patch,
  });
  const read = () => f.invoke("jobs:inspectOrdinaryPlanWindow", { siteId });
  return { ...f, siteId, addPlan, read };
}

test("ordinary window counts every history state and topic reason, excluding only proven pre-paid releases", async () => {
  const f = fixture();
  const statuses = ["done", "failed", "cancelled", "expired", "historic_unknown", "running", "pending"];
  for (const [i, status] of statuses.entries()) f.addPlan({ status, createdAt: START - 1000 - i,
    payload: { reason: i % 2 ? "topic_overlap_replenishment" : "topic_business_fit_replenishment", private: "private-payload" },
    workerToken: "private-worker" });
  f.addPlan({ payload: { reason: "topic_evidence_replenishment", manual: true } });
  f.addPlan({ payload: { reason: "topic_horizon_replenishment", growthParentArticleId: "articles:synthetic" } });
  f.addPlan({ providerReservationReleasedAt: START - 1, providerReservationReleaseReason: "ambiguous_unknown_release" });
  for (const reason of ["provider_balance_insufficient", "provider_balance_preflight_unavailable",
    "plan_cancelled_before_execution", "plan_reservation_day_expired_before_execution",
    "one_setup_planning_context_superseded_before_execution"]) {
    f.addPlan({ providerReservationReleasedAt: START - 1, providerReservationReleaseReason: reason });
  }
  f.addPlan({ payload: { reason: "one_setup_initial_plan" } });
  f.addPlan({ siteId: "sites:foreign-synthetic" });
  f.addPlan({ createdAt: START - DAY - 1 });
  const before = structuredClone(f.tables), receipt = await f.read();
  assert.equal(receipt.window.counted, 10); assert.equal(receipt.maximumRecent, 3);
  assert.equal(receipt.window.decision, "limited");
  assert.equal(receipt.selectionAndFunding, "not_evaluated");
  assert.ok(!JSON.stringify(receipt).includes("private-")); assert.deepEqual(f.tables, before);
  for (const read of f.queryReads) {
    assert.ok(["jobs", "article_summaries"].includes(read.table));
    assert.ok(read.range.some(r => r.key === "siteId" && r.value === f.siteId));
    assert.ok([13, 201].includes(read.limit!));
  }
  f.assertOffline();
});

test("read-only count and next slot match the actual atomic queue's rolling guard without changing its behavior", async () => {
  for (const cadence of [7, 21]) {
    const f = fixture(cadence), maximum = cadence === 7 ? 3 : 5;
    for (let i = 0; i < maximum; i++) f.addPlan({ createdAt: START - 100_000 - i * 1000 });
    const receipt = await f.read();
    const expected = START - 100_000 - (maximum - 1) * 1000 + DAY + 1000;
    assert.equal(receipt.maximumRecent, maximum); assert.equal(receipt.window.nextSlotAt, expected);
    const queue = await f.invoke("jobs:queuePlanIfAbsent", { siteId: f.siteId,
      reason: "topic_portfolio_evidence_replenishment", since: START - DAY, maximumRecent: 999 });
    assert.equal(queue.reason, "recent_limit"); assert.equal(queue.recent, receipt.window.counted);
    assert.equal(f.tables.provider_spend_reservations.length, 0);
    assert.equal(f.tables.jobs.length, maximum);
    assert.ok(f.tables._scheduled_functions.some(row => row.args.dueAt === expected), "Actual exact refill deadline matches the receipt");
    f.assertOffline();
  }
});

test("inclusive 24h window, expiry safety, latest counted history and semantic cooldown retain exact times", async () => {
  const f = fixture();
  f.addPlan({ createdAt: START - DAY });
  const semantic = f.addPlan({ status: "failed", createdAt: START - 600_000,
    cadenceFailure: { version: 1, category: "semantic_zero_yield", code: "private-code",
      retryable: false, terminal: true, eligibleAt: START + DAY, recordedAt: START - 500_000 } });
  const manual = f.addPlan({ createdAt: START - 1, payload: { manual: true, reason: "topic_manual" } });
  let receipt = await f.read();
  assert.equal(receipt.window.counted, 3); assert.equal(receipt.latestCounted.plan.jobId, manual);
  assert.equal(receipt.failureCooldown.plan.jobId, semantic);
  assert.equal(receipt.failureCooldown.eligibleAt, START + 300_000);
  assert.equal(receipt.failureCooldown.blocked, true); assert.ok(!JSON.stringify(receipt).includes("private-code"));
  f.setTime(START + 1000); receipt = await f.read();
  assert.equal(receipt.window.counted, 2);
  f.setTime(START + 300_000); assert.equal((await f.read()).failureCooldown.blocked, false);
  f.setTime(START + 2 * DAY); receipt = await f.read();
  assert.equal(receipt.window.counted, 0); assert.equal(receipt.latestCounted.plan.jobId, manual);
  assert.equal(receipt.latestCounted.plan.windowExpiresAt, START - 1 + DAY + 1000);
  f.assertOffline();
});

test("buffer-full policy uses the actual one-plan limit, and ambiguous bounded reads never certify capacity", async () => {
  const full = fixture(7);
  for (let i = 0; i < 4; i++) full.add("article_summaries", { siteId: full.siteId,
    articleId: `articles:ready-${i}`, status: "ready", publicationGateStatus: "passed",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION, auditedContentHash: "synthetic-metadata" });
  assert.equal((await full.read()).maximumRecent, 1);
  for (let i = 0; i < 201; i++) full.addPlan({ payload: { reason: "one_setup_initial_plan" } });
  const overflow = await full.read();
  assert.equal(overflow.complete, false); assert.equal(overflow.window.decision, "overflow");
  assert.equal(overflow.window.counted, undefined); assert.equal(overflow.window.countedLowerBound, 0);
  assert.equal(overflow.latestCounted.complete, false); assert.equal(overflow.failureCooldown.complete, false);
  assert.equal(overflow.failureCooldown.blocked, undefined);
  const saturated = fixture();
  for (let i = 0; i < 201; i++) saturated.add("article_summaries", { siteId: saturated.siteId,
    articleId: `articles:old-${i}`, status: "ready", canonicalDomain: "old.example", domainRevision: 1 });
  const incomplete = await saturated.read();
  assert.equal(incomplete.complete, false); assert.equal(incomplete.reason, "buffer_count_incomplete");
  assert.equal(incomplete.maximumRecent, undefined);
  const legacy = fixture(); legacy.get(legacy.siteId)!.expectedClickSchedulingEnabled = false;
  assert.equal((await legacy.read()).reason, "checkpoint_scheduling_disabled");
  assert.equal(legacy.queryReads.length, 0);
  full.assertOffline(); saturated.assertOffline(); legacy.assertOffline();
});

test("funding/budget cooldowns keep their recorded deadlines and a saturated count can prove only its lower bound", async () => {
  for (const category of ["provider_funding", "budget_window", "terminal_invariant"]) {
    const f = fixture();
    f.addPlan({ status: "failed", createdAt: START - DAY,
      cadenceFailure: { version: 1, category, code: "synthetic", retryable: false,
        terminal: true, eligibleAt: START + DAY, recordedAt: START - DAY + 1 } });
    assert.equal((await f.read()).failureCooldown.eligibleAt, START + DAY);
    assert.equal((await f.read()).failureCooldown.blocked, true);
    f.assertOffline();
  }
  const f = fixture();
  for (let i = 0; i < 201; i++) f.addPlan({ createdAt: START - i - 1 });
  const result = await f.read();
  assert.equal(result.complete, false); assert.equal(result.window.decision, "limited");
  assert.equal(result.window.counted, undefined); assert.equal(result.window.countedLowerBound, 200);
  assert.equal(result.window.nextSlotAt, START - 3 + DAY + 1000);
  const broken = fixture(); broken.addPlan({ createdAt: NaN });
  assert.equal((await broken.read()).reason, "plan_timestamps_unverified");
  f.assertOffline(); broken.assertOffline();
});
