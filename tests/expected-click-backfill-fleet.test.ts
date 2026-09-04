import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  expectedClickFleetJitterMs,
  planExpectedClickBackfillFleetSite,
  scheduleExpectedClickFleetContinuation,
  type ExpectedClickBackfillFleetSiteState,
} from "../convex/actions/expectedClickBackfillFleet.ts";
import {
  oldestUnresolvedFleetJob,
  planDemandPhaseReservation,
  planEvidencePhaseReservation,
  planExpectedClickFleetRecovery,
} from "../convex/lib/expectedClickBackfillFleet.ts";
import {
  SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
  SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
} from "../convex/lib/providerSpendReservation.ts";
import { EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD } from
  "../convex/lib/expectedClickDemandBackfill.ts";
import { EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD } from
  "../convex/lib/expectedClickEvidenceBackfill.ts";

const fleet = readFileSync(
  "convex/actions/expectedClickBackfillFleet.ts",
  "utf8",
);
const demandAction = readFileSync(
  "convex/actions/expectedClickDemandBackfill.ts",
  "utf8",
);
const evidenceAction = readFileSync(
  "convex/actions/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const demand = readFileSync("convex/expectedClickDemandBackfill.ts", "utf8");
const evidence = readFileSync(
  "convex/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const sites = readFileSync("convex/sites.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const runbook = readFileSync(
  "docs/EXPECTED_CLICK_AUTONOMOUS_BACKFILL_RUNBOOK.md",
  "utf8",
);

function state(
  overrides: Partial<ExpectedClickBackfillFleetSiteState> = {},
): ExpectedClickBackfillFleetSiteState {
  return {
    siteId: "tenant-a",
    autopilotEnabled: true,
    expectedClickSchedulingEnabled: true,
    autopilotRolloutMode: "live",
    deleting: false,
    ...overrides,
  };
}

test("fleet rollout is explicit, tenant-generic, and fail-closed", () => {
  assert.equal(planExpectedClickBackfillFleetSite(state()).advance, true);
  assert.equal(planExpectedClickBackfillFleetSite(state({
    autopilotRolloutMode: "warm",
  })).advance, true);
  for (const overrides of [
    { autopilotEnabled: false },
    { expectedClickSchedulingEnabled: false },
    { autopilotRolloutMode: "observe" },
    { autopilotRolloutMode: "off" },
    { deleting: true },
  ]) {
    assert.equal(
      planExpectedClickBackfillFleetSite(state(overrides)).advance,
      false,
    );
  }
  assert.doesNotMatch(fleet, /leadpilot|jh7cccny/i);
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  assert.match(
    autopilot,
    /expectedClickSchedulingEnabled === undefined[\s\S]{0,320}site\.expectedClickSchedulingEnabled \?\? true/,
  );
  assert.match(
    autopilot,
    /site\.verifiedKeywordDataRequired !== true[\s\S]{0,400}verifiedKeywordDataRequired: true/,
  );
  assert.match(
    autopilot,
    /autopilotRolloutMode: "warm"[\s\S]{0,220}expectedClickSchedulingEnabled: true/,
  );
});

test("daily deterministic jitter rotates constrained-ledger priority", () => {
  const first = expectedClickFleetJitterMs("tenant-a", "2026-08-20");
  assert.equal(
    first,
    expectedClickFleetJitterMs("tenant-a", "2026-08-20"),
  );
  assert.notEqual(
    first,
    expectedClickFleetJitterMs("tenant-a", "2026-08-21"),
  );
  assert.ok(first >= 0 && first < 5 * 60 * 1000);
  assert.notEqual(
    first,
    expectedClickFleetJitterMs("tenant-b", "2026-08-20"),
  );
});

test("one paginated daily fleet isolates tenants and durably preserves the cursor", async () => {
  assert.match(sites, /export const listExpectedClickBackfillFleetPage = internalQuery/);
  assert.match(sites, /withIndex\("by_autopilot"/);
  assert.match(sites, /expectedClickSchedulingEnabled/);
  assert.match(sites, /paginate\(\{ cursor: cursor \?\? null, numItems: 25 \}\)/);
  assert.match(fleet, /for \(const state of page\.page\)/);
  assert.match(fleet, /try \{[\s\S]*scheduler\.runAfter[\s\S]*\} catch/);
  assert.match(fleet, /cursor: page\.continueCursor, dispatchDay: day/);
  assert.match(fleet, /expectedClickFleetJitterMs\(String\(state\.siteId\), day\)/);
  assert.match(schema, /expected_click_fleet_dispatch_runs: defineTable/);
  assert.match(schema, /by_kind_key/);
  assert.match(schema, /by_status_updated/);
  assert.match(sites, /beginExpectedClickFleetDispatchPage/);
  assert.match(sites, /advanceExpectedClickFleetDispatchPage/);
  assert.match(sites, /listRecoverableExpectedClickFleetDispatchRuns/);
  assert.match(sites, /pruneExpectedClickFleetDispatchRuns/);
  const dailyDispatch = fleet.slice(
    fleet.indexOf("export const dispatchFleet"),
    fleet.indexOf("export const runSite"),
  );
  assert.ok(
    dailyDispatch.indexOf("advanceExpectedClickFleetDispatchPage") <
      dailyDispatch.indexOf("scheduleExpectedClickFleetContinuation"),
  );
  let failureReceipts = 0;
  const scheduled = await scheduleExpectedClickFleetContinuation(
    async () => {
      throw new Error("injected scheduler failure");
    },
    async () => {
      failureReceipts += 1;
    },
  );
  assert.equal(scheduled, false);
  assert.equal(failureReceipts, 1);
  assert.match(fleet, /resumeStalledDispatchRuns/);
  assert.match(fleet, /recordExpectedClickFleetContinuationFailure/);
  assert.match(fleet, /DISPATCH_RECEIPT_RETENTION_MS = 14/);
  assert.match(crons, /"expected-click-backfill-fleet"/);
  assert.match(
    crons,
    /\{ hourUTC: 13, minuteUTC: 15 \}[\s\S]*expectedClickBackfillFleet\.dispatchFleet/,
  );
  assert.doesNotMatch(crons, /expected-click-evidence-backfill-fleet/);
});

test("demand completes before evidence and operator canaries never auto-chain", () => {
  assert.match(
    fleet,
    /queueExpectedClickDemandBackfillFleet/,
  );
  assert.match(
    fleet,
    /queueExpectedClickEvidenceBackfillFleet/,
  );
  assert.doesNotMatch(
    fleet,
    /\.queueExpectedClickDemandBackfill,|\.queueExpectedClickEvidenceBackfill,/,
  );
  assert.ok(
    fleet.indexOf("getFleetReadinessInternal") <
      fleet.indexOf("queueExpectedClickDemandBackfillFleet"),
  );
  assert.match(demand, /job\.origin === "autonomous_fleet"/);
  assert.match(
    demand,
    /expectedClickBackfillFleet\.runEvidenceSite/,
  );
  assert.match(evidence, /demand_phase_incomplete/);
  assert.match(evidence, /pendingDemandCount/);
  assert.match(evidence, /planEvidencePhaseReservation/);
  assert.match(demandAction, /origin: "operator_canary"/);
  assert.match(demandAction, /origin: fleetOrigin/);
  assert.match(evidenceAction, /origin: "operator_canary"/);
  assert.match(evidenceAction, /origin: fleetOrigin/);
  assert.match(schema, /origin: v\.optional\(v\.string\(\)\)/);
  assert.match(evidence, /origin === undefined[\s\S]*operator_canary_v/);
});

test("atomic phase plans reject concurrent demand and evidence reservations", () => {
  assert.deepEqual(planDemandPhaseReservation({
    todayEvidenceJobs: 1,
    unresolvedDemandJobs: 0,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), { allowed: false, reason: "evidence_phase_already_started" });
  assert.deepEqual(planDemandPhaseReservation({
    todayEvidenceJobs: 0,
    unresolvedDemandJobs: 1,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), { allowed: false, reason: "prior_fleet_job_incomplete" });
  assert.deepEqual(planEvidencePhaseReservation({
    origin: "autonomous_fleet",
    todayDemandJob: {
      id: "operator-demand",
      status: "completed",
      origin: "operator_canary",
    },
    pendingDemandCandidates: 0,
    unresolvedDemandJobs: 0,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), { allowed: false, reason: "demand_phase_origin_mismatch" });
  assert.deepEqual(planEvidencePhaseReservation({
    origin: "autonomous_fleet",
    todayDemandJob: {
      id: "fleet-demand",
      status: "completed",
      origin: "autonomous_fleet",
    },
    pendingDemandCandidates: 1,
    unresolvedDemandJobs: 0,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), { allowed: false, reason: "demand_candidates_remaining" });
  assert.deepEqual(planEvidencePhaseReservation({
    origin: "autonomous_fleet",
    todayDemandJob: {
      id: "fleet-demand",
      status: "completed",
      origin: "autonomous_fleet",
    },
    pendingDemandCandidates: 58,
    readyEvidenceCandidates: 10,
    unresolvedDemandJobs: 0,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), {
    allowed: true,
    prerequisiteMode: "completed_fleet_demand",
    prerequisiteJobId: "fleet-demand",
  });
  assert.deepEqual(planEvidencePhaseReservation({
    origin: "autonomous_fleet",
    todayDemandJob: {
      id: "fleet-demand",
      status: "completed",
      origin: "autonomous_fleet",
    },
    pendingDemandCandidates: 0,
    unresolvedDemandJobs: 0,
    unresolvedEvidenceJobs: 0,
    unresolvedReadLimitExhausted: false,
  }), {
    allowed: true,
    prerequisiteMode: "completed_fleet_demand",
    prerequisiteJobId: "fleet-demand",
  });
  assert.match(demand, /planDemandPhaseReservation[\s\S]*reserveSharedProviderBudget/);
  assert.match(evidence, /planEvidencePhaseReservation[\s\S]*reserveSharedProviderBudget/);
  assert.match(schema, /demandPrerequisiteMode: v\.optional/);
  assert.match(schema, /demandPrerequisiteJobId: v\.optional/);
});

test("old unresolved fleet work cannot be masked by newer terminal or operator jobs", () => {
  const selected = oldestUnresolvedFleetJob([
    {
      _id: "older-fleet-partial",
      origin: "autonomous_fleet",
      status: "partial",
      createdAt: 1,
    },
    {
      _id: "newer-fleet-completed",
      origin: "autonomous_fleet",
      status: "completed",
      createdAt: 2,
    },
    {
      _id: "newer-operator-partial",
      origin: "operator_canary",
      status: "partial",
      createdAt: 3,
    },
  ]);
  assert.equal(selected?._id, "older-fleet-partial");
  assert.match(schema, /by_site_origin_status/);
  assert.match(demand, /withIndex\("by_site_origin_status"/);
  assert.match(evidence, /withIndex\("by_site_origin_status"/);
  assert.doesNotMatch(
    demand.slice(demand.indexOf("export const getFleetRecoveryInternal"),
      demand.indexOf("export const reserveAndQueue")),
    /by_site_created/,
  );
  assert.doesNotMatch(
    evidence.slice(evidence.indexOf("export const getFleetRecoveryInternal"),
      evidence.indexOf("export const reserveAndQueue")),
    /by_site_created/,
  );
});

test("clean terminal evidence history cannot permanently stop the fleet", () => {
  assert.doesNotMatch(
    evidence,
    /EXPECTED_CLICK_FLEET_AMBIGUITY_HISTORY_LIMIT|ambiguity_history_limit_exhausted/,
  );
  const ambiguityScan = evidence.slice(
    evidence.indexOf("async function unresolvedEvidenceJobsForAmbiguity"),
    evidence.indexOf("export const getStatus"),
  );
  assert.match(ambiguityScan, /withIndex\("by_site_status"/);
  assert.match(
    ambiguityScan,
    /take\(FLEET_UNRESOLVED_STATUS_READ_LIMIT \+ 1\)/,
  );
  assert.doesNotMatch(ambiguityScan, /by_site_created/);
});

test("bounded unresolved evidence receipts still fail closed on ambiguity", () => {
  const readiness = evidence.slice(
    evidence.indexOf("export async function expectedClickEvidenceFleetReadiness"),
    evidence.indexOf("export const getFleetRecoveryInternal"),
  );
  assert.match(readiness, /unresolvedEvidenceJobsForAmbiguity/);
  assert.match(readiness, /ambiguityCandidates\.exhausted/);
  assert.match(readiness, /filter\(evidenceJobHasAmbiguousAttempt\)/);
  assert.match(readiness, /provider_attempt_ambiguous/);
});

test("failed evidence topics have a versioned pre-HTTP no-repurchase receipt", () => {
  assert.match(schema, /expectedClickEvidenceAttemptVersion: v\.optional/);
  assert.match(schema, /expectedClickEvidenceAttemptJobId: v\.optional/);
  assert.match(schema, /expectedClickEvidenceAttemptKeyword: v\.optional/);
  assert.match(schema, /expectedClickEvidenceAttemptTopicUpdatedAt: v\.optional/);
  assert.match(evidence, /function hasCurrentEvidenceAttempt/);
  assert.ok(
    evidence.indexOf("hasCurrentEvidenceAttempt(topic)") <
      evidence.indexOf("reserveSharedProviderBudget(ctx"),
  );
  const begin = evidence.slice(
    evidence.indexOf("export const beginProviderCall"),
    evidence.indexOf("export const recordSerpSnapshot"),
  );
  assert.match(evidence, /async function currentSelectedTopic/);
  assert.match(begin, /currentSelectedTopic\(ctx, site, selectedTopic\)/);
  assert.match(begin, /topic_or_artifact_changed/);
  assert.match(begin, /expectedClickEvidenceAttemptVersion/);
  assert.match(begin, /expectedClickEvidenceAttemptTopicUpdatedAt/);
  const processing = evidenceAction.slice(
    evidenceAction.indexOf("export const processExpectedClickEvidenceBackfill"),
  );
  assert.ok(
    processing.indexOf("api.beginProviderCall") <
      processing.indexOf("analysis = await analyzeSERPFromDataForSEO"),
  );
});

test("recovery is bounded, fleet-origin-only, and never replays ambiguity", () => {
  assert.match(crons, /"expected-click-backfill-recovery"/);
  assert.match(crons, /\{ hours: 1 \}/);
  assert.match(fleet, /getFleetRecoveryInternal/);
  assert.match(fleet, /RECOVERY_STALE_AFTER_MS = 10 \* 60 \* 1000/);
  assert.match(demand, /eq\("origin", "autonomous_fleet"\)/);
  assert.match(evidence, /eq\("origin", "autonomous_fleet"\)/);
  assert.match(demand, /provider_attempt_ambiguous/);
  assert.match(evidence, /evidenceJobHasAmbiguousAttempt/);
  assert.match(demand, /reservation_day_expired/);
  assert.match(evidence, /reservation_day_expired/);
  const recovery = fleet.slice(fleet.indexOf("export const recoverSite"));
  assert.doesNotMatch(recovery, /reserveAndQueue|queueExpectedClick.*Fleet/);
  assert.match(recovery, /suppressEvidenceChain: true/g);
  assert.match(demandAction, /suppressEvidenceChain: v\.optional\(v\.boolean\(\)\)/);
  assert.match(
    demand,
    /job\.origin === "autonomous_fleet" &&[\s\S]*args\.suppressEvidenceChain !== true/,
  );
});

test("recovery plans both phases before choosing one globally safe job", () => {
  assert.deepEqual(planExpectedClickFleetRecovery([
    {
      phase: "demand",
      action: "process",
      jobId: "demand-safe",
      policyVersion: 1,
      createdAt: 10,
    },
    {
      phase: "evidence",
      action: "blocked",
      reason: "provider_attempt_ambiguous",
      actionable: true,
    },
  ]), {
    action: "blocked",
    phase: "evidence",
    reason: "provider_attempt_ambiguous",
    actionable: true,
  });
  assert.deepEqual(planExpectedClickFleetRecovery([
    { phase: "demand", action: "none", reason: "worker_not_stale" },
    {
      phase: "evidence",
      action: "process",
      jobId: "evidence-safe",
      policyVersion: 1,
      createdAt: 5,
    },
  ]), {
    action: "wait",
    phase: "demand",
    reason: "worker_not_stale",
    actionable: false,
  });
  assert.deepEqual(planExpectedClickFleetRecovery([
    {
      phase: "demand",
      action: "process",
      jobId: "newer-demand",
      policyVersion: 1,
      createdAt: 20,
    },
    {
      phase: "evidence",
      action: "resume",
      jobId: "older-evidence",
      policyVersion: 1,
      createdAt: 10,
    },
  ]), {
    action: "recover",
    phase: "evidence",
    mode: "resume",
    jobId: "older-evidence",
    policyVersion: 1,
  });
  const recovery = fleet.slice(fleet.indexOf("export const recoverSite"));
  assert.match(recovery, /Promise\.all/);
  assert.match(recovery, /planExpectedClickFleetRecovery/);
  assert.ok(
    recovery.indexOf("planExpectedClickFleetRecovery") <
      recovery.indexOf("processExpectedClickDemandBackfill"),
  );
});

test("demand recovery claims with the exact strict validator arguments", () => {
  const process = demandAction.slice(
    demandAction.indexOf("export const processExpectedClickDemandBackfill"),
  );
  const claim = process.slice(
    process.indexOf("api.claimWorker"),
    process.indexOf("if (!claimed)"),
  );
  assert.doesNotMatch(claim, /\.\.\.args/);
  assert.match(claim, /siteId: args\.siteId/);
  assert.match(claim, /jobId: args\.jobId/);
  assert.match(claim, /policyVersion: args\.policyVersion/);
  assert.match(claim, /workerToken/);
  assert.doesNotMatch(claim, /suppressEvidenceChain/);
});

test("every paid evidence call revalidates its exact current-day reservation", () => {
  const reservationFence = evidence.slice(
    evidence.indexOf("async function requireCurrentProviderReservation"),
    evidence.indexOf("async function currentSelectedTopic"),
  );
  assert.match(reservationFence, /providerSpendReservationId/);
  assert.match(reservationFence, /expected_click_evidence_backfill/);
  assert.match(reservationFence, /reservation\.siteId !== site\._id/);
  assert.match(reservationFence, /reservation\.userId !== site\.userId/);
  assert.match(reservationFence, /reservation\.releasedAt !== undefined/);
  assert.match(reservationFence, /job\.reservationDay !== utcBackfillDay\(timestamp\)/);
  const begin = evidence.slice(
    evidence.indexOf("export const beginProviderCall"),
    evidence.indexOf("export const recordSerpSnapshot"),
  );
  assert.ok(
    begin.indexOf("requireCurrentProviderReservation") <
      begin.indexOf("expectedClickEvidenceAttemptVersion"),
  );
});

test("daily idempotency and the shared provider ceilings remain decisive", () => {
  assert.match(demand, /withIndex\("by_site_day_epoch_policy"/);
  assert.match(evidence, /withIndex\("by_site_day_epoch_policy"/);
  assert.match(demand, /\.take\(CURRENT_DAY_BATCH_READ_LIMIT \+ 1\)/);
  assert.match(evidence, /\.take\(CURRENT_DAY_BATCH_READ_LIMIT \+ 1\)/);
  assert.doesNotMatch(
    demand,
    /withIndex\("by_site_day"[\s\S]{0,200}\.collect\(\)/,
  );
  assert.doesNotMatch(
    evidence,
    /withIndex\("by_site_day"[\s\S]{0,200}\.collect\(\)/,
  );
  assert.match(demand, /const existing = todayJobs\[0\]/);
  assert.match(evidence, /const existing = todayJobs\[0\]/);
  assert.equal(EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.equal(SHARED_PROVIDER_DAILY_CEILING_MICRO_USD, 9_850_000);
  assert.equal(SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD, 35_000_000);
  assert.match(runbook, /13:15 UTC/);
  assert.match(runbook, /\$0\.20\/day/);
  assert.match(runbook, /\$9\.85\/day/);
  assert.match(runbook, /\$35\/month/);
});
