import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLAN_CANDIDATE_CHECKPOINT_STATUS,
  inlinePlanSerpReceiptValid,
  planCheckpointCandidateFingerprint,
  planCheckpointTopicDeletionLocked,
  planCheckpointTopicExecutionLocked,
  planSeedBatchManifestHash,
  planSerpResultFingerprint,
  terminalCheckpointCandidateDecision,
  type PlanCheckpointCandidate,
} from "../convex/lib/planCandidateCheckpoint.ts";
import { AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD } from
  "../convex/lib/planProviderBudget.ts";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
} from "../convex/lib/expectedClickEvidenceBackfill.ts";

test("checkpoint execution and deletion fences are durable", () => {
  assert.equal(planCheckpointTopicExecutionLocked({
    status: PLAN_CANDIDATE_CHECKPOINT_STATUS,
  }), true);
  assert.equal(planCheckpointTopicExecutionLocked({
    status: "disqualified",
    planCheckpointTerminalFailureCode: "ambiguous",
  }), true);
  assert.equal(planCheckpointTopicExecutionLocked({
    status: "planned",
    planCheckpointId: "checkpoint-1",
  }), false);
  assert.equal(planCheckpointTopicDeletionLocked({
    status: "used",
    planCheckpointId: "checkpoint-1",
  }), true);
  assert.equal(planCheckpointTopicDeletionLocked({ status: "used" }), false);
});

const candidate: PlanCheckpointCandidate = {
  label: "Automated sales follow-up",
  primaryKeyword: "automated sales follow up",
  secondaryKeywords: ["sales follow up automation"],
  searchVolume: 320,
  keywordDifficulty: 12,
  keywordDifficultyMeasured: true,
  cpc: 4.2,
  searchDemandSource: "dataforseo_google_ads",
  searchDemandMeasuredAt: Date.UTC(2026, 7, 24, 12),
  searchDemandLocationCode: 2840,
  searchDemandLanguageCode: "en",
  businessFitEligible: true,
  businessFitScore: 8,
  businessFitVersion: 5,
  businessFitReasons: ["product_anchor:follow up"],
};

const manifest = {
  siteId: "site_a",
  planJobId: "job_a",
  workerExecution: 1,
  replenishmentSequence: 2,
  locationCode: 2840,
  languageCode: "en",
  candidateCapacity: 7,
  seedBatches: [
    ["sales follow up", "lead response"],
    ["pipeline automation"],
  ],
};

test("seed manifests are stable, ordered, execution-bound, and tenant-bound", () => {
  const fingerprint = planSeedBatchManifestHash(manifest);
  assert.equal(fingerprint, planSeedBatchManifestHash({ ...manifest }));
  assert.notEqual(fingerprint, planSeedBatchManifestHash({
    ...manifest,
    siteId: "site_b",
  }));
  assert.notEqual(fingerprint, planSeedBatchManifestHash({
    ...manifest,
    planJobId: "job_b",
  }));
  assert.notEqual(fingerprint, planSeedBatchManifestHash({
    ...manifest,
    workerExecution: 2,
  }));
  assert.notEqual(fingerprint, planSeedBatchManifestHash({
    ...manifest,
    seedBatches: [...manifest.seedBatches].reverse(),
  }));
});

test("candidate fingerprints bind exact tenant, execution, seed window and ordinal", () => {
  const seedManifestHash = planSeedBatchManifestHash(manifest);
  const base = {
    siteId: manifest.siteId,
    planJobId: manifest.planJobId,
    workerExecution: manifest.workerExecution,
    seedManifestHash,
    ordinal: 0,
    candidate,
  };
  const fingerprint = planCheckpointCandidateFingerprint(base);
  assert.notEqual(fingerprint, planCheckpointCandidateFingerprint({
    ...base,
    siteId: "site_b",
  }));
  assert.notEqual(fingerprint, planCheckpointCandidateFingerprint({
    ...base,
    workerExecution: 2,
  }));
  assert.notEqual(fingerprint, planCheckpointCandidateFingerprint({
    ...base,
    ordinal: 1,
  }));
  assert.notEqual(fingerprint, planCheckpointCandidateFingerprint({
    ...base,
    candidate: { ...candidate, keywordDifficulty: 13 },
  }));
});

test("inline SERP receipts are exact while terminal recovery never adopts begun rows", () => {
  const attemptedAt = Date.UTC(2026, 7, 24, 12, 0);
  const results = [1, 2, 3, 4, 5].map((position) => ({
    position,
    url: `https://www.example${position}.com/page/?utm=test#fragment`,
  }));
  const normalizedUrlFingerprint = planSerpResultFingerprint(results);
  assert.ok(normalizedUrlFingerprint);
  assert.equal(normalizedUrlFingerprint, planSerpResultFingerprint(
    results.map((result) => ({
      ...result,
      url: result.url.replace("www.", "").replace("/?utm=test#fragment", ""),
    })),
  ));
  const seedManifestHash = planSeedBatchManifestHash(manifest);
  const candidateFingerprint = planCheckpointCandidateFingerprint({
    siteId: manifest.siteId,
    planJobId: manifest.planJobId,
    workerExecution: 1,
    seedManifestHash,
    ordinal: 0,
    candidate,
  });
  const receipt = {
    version: 1,
    candidateFingerprint,
    seedManifestHash,
    workerExecution: 1,
    normalizedUrlFingerprint: normalizedUrlFingerprint!,
    observedAt: attemptedAt + 1_000,
    locationCode: 2840,
    languageCode: "en",
    results,
    businessIntentAligned: true as const,
    attainable: true as const,
    cannibalizationClear: true as const,
  };
  const validation = {
    receipt,
    candidateFingerprint,
    seedManifestHash,
    workerExecution: 1,
    locationCode: 2840,
    languageCode: "en",
    attemptedAt,
    now: attemptedAt + 2_000,
  };
  assert.equal(inlinePlanSerpReceiptValid(validation), true);
  assert.equal(inlinePlanSerpReceiptValid({
    ...validation,
    locationCode: 2826,
  }), false);
  assert.equal(inlinePlanSerpReceiptValid({
    ...validation,
    receipt: { ...receipt, normalizedUrlFingerprint: "drifted" },
  }), false);

  assert.equal(terminalCheckpointCandidateDecision({
    status: PLAN_CANDIDATE_CHECKPOINT_STATUS,
    receiptValid: false,
  }), "activate_unattempted");
  assert.equal(terminalCheckpointCandidateDecision({
    status: PLAN_CANDIDATE_CHECKPOINT_STATUS,
    attemptedAt,
    receiptValid: true,
  }), "disqualify_attempted");
  assert.equal(terminalCheckpointCandidateDecision({
    status: PLAN_CANDIDATE_CHECKPOINT_STATUS,
    attemptedAt,
    receiptValid: false,
  }), "disqualify_attempted");
  assert.equal(terminalCheckpointCandidateDecision({
    status: "disqualified",
    attemptedAt,
    receiptValid: true,
    terminalFailureCode: "serp_business_intent_mismatch",
  }), "terminally_excluded");
});

test("checkpoint staging precedes SERP HTTP without changing legacy seed discovery", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const staging = pipeline.indexOf("planCandidateCheckpoints.stage");
  const firstSerpAfterStaging = pipeline.indexOf("serp = await analyzeSERP", staging);
  const zeroCandidate = pipeline.indexOf(
    "recording an honest inventory miss without SERP spend",
    staging,
  );
  assert.ok(staging > 0);
  assert.ok(zeroCandidate > staging && zeroCandidate < firstSerpAfterStaging);
  assert.ok(pipeline.indexOf("planCandidateCheckpoints.beginInlineSerp", staging) <
    firstSerpAfterStaging);
  assert.match(
    pipeline,
    /if \(!checkpointPlanningEnabled && \(site\.competitors \?\? \[\]\)\.length > 0\)/,
  );
  assert.match(pipeline, /Strict verified planning skips competitor-gap discovery/);
  assert.doesNotMatch(pipeline, /workerExecution - 1\) \* 23/);
});

test("operational terminal paths activate once while semantic failures only close", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const checkpoints = readFileSync(
    "convex/planCandidateCheckpoints.ts",
    "utf8",
  );
  assert.match(
    jobs,
    /Plan worker lease expired[\s\S]{0,500}activateTerminalPlanCheckpoints/,
  );
  assert.match(
    jobs,
    /Plan parent timed out[\s\S]{0,500}activateTerminalPlanCheckpoints/,
  );
  assert.match(
    jobs,
    /if \(!willRetry && job\.type === "plan"\) \{[\s\S]{0,120}activateTerminalPlanCheckpoints/,
  );
  const markFailed = jobs.slice(
    jobs.indexOf("export const markFailed"),
    jobs.indexOf("export const markRetryableFailure"),
  );
  assert.match(markFailed, /terminallyClosePlanCheckpoints/);
  assert.doesNotMatch(markFailed, /activateTerminalPlanCheckpoints/);
  assert.match(
    checkpoints,
    /\["active", "inline_sealed"\]\.includes\(checkpoint\.status\)/,
  );
  assert.match(
    checkpoints,
    /status: authorization && manifestValid \? "activated"/,
  );
  assert.match(checkpoints, /queueExpectedClickEvidenceBackfillFleet/);
  assert.match(
    jobs,
    /const checkpointSettlement = firstExecution[\s\S]*terminallyClosePlanCheckpoints[\s\S]*activateTerminalPlanCheckpoints/,
  );

  const terminalClose = checkpoints.slice(
    checkpoints.indexOf("export async function terminallyClosePlanCheckpoints"),
    checkpoints.indexOf("export async function activateTerminalPlanCheckpoints"),
  );
  assert.match(terminalClose, /checkpoint\.siteId !== job\.siteId/);
  assert.match(terminalClose, /checkpoint\.userId !== site\.userId/);
  assert.match(terminalClose, /checkpoint\.planJobId !== jobId/);
  assert.match(terminalClose, /exactCheckpointTopicBinding/);
  assert.ok(
    terminalClose.indexOf("checkpoint.siteId !== job.siteId") <
      terminalClose.indexOf("ctx.db.patch(checkpoint._id"),
  );
});

test("checkpoint rows cannot be queued, rewritten, or owner-deleted", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");
  for (const mutationName of [
    "queueTopicArticleIfAbsent",
    "runQueuedTopic",
    "queueArticleNow",
  ]) {
    const start = jobs.indexOf(`export const ${mutationName}`);
    assert.ok(start > 0, mutationName);
    const body = jobs.slice(start, start + 8_000);
    assert.match(body, /topicUnavailableForArticleQueue/);
  }
  const genericCreate = jobs.slice(
    jobs.indexOf("export const create ="),
    jobs.indexOf("async function activeJobsForSite"),
  );
  assert.match(
    genericCreate,
    /type === "article" && topicUnavailableForArticleQueue\(topic\)/,
  );
  for (const mutationName of ["remove", "removeUnused", "removeUsed"]) {
    const start = topics.indexOf(`export const ${mutationName}`);
    assert.ok(start > 0, mutationName);
    const body = topics.slice(start, start + 2_500);
    assert.match(body, /planCheckpointTopicDeletionLocked/);
  }
  assert.match(
    topics,
    /recordBusinessFitAuditsInternal[\s\S]*planCheckpointTopicExecutionLocked/,
  );
  assert.match(
    topics,
    /export const listBySite[\s\S]*planCheckpointTopicExecutionLocked/,
  );
  assert.match(
    topics,
    /export const get = query[\s\S]*planCheckpointTopicExecutionLocked/,
  );
});

test("rollout, configuration, parking, and deletion cancellation close plan checkpoints", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const cancellation = sites.slice(
    sites.indexOf("async function cancelAutonomousJobsForEpochTransition"),
    sites.indexOf("const PLAN_SITE_RECONCILIATION_PAGE_SIZE"),
  );
  assert.match(cancellation, /status: "failed"/);
  assert.match(cancellation, /job\.type === "plan"/);
  assert.match(cancellation, /terminallyClosePlanCheckpoints/);
  assert.match(
    cancellation,
    /plan_checkpoint_cancelled_by_epoch_transition/,
  );
  assert.ok(
    cancellation.indexOf("status: \"failed\"") <
      cancellation.indexOf("terminallyClosePlanCheckpoints"),
  );
  assert.equal(planCheckpointTopicExecutionLocked({
    status: "disqualified",
    planCheckpointTerminalFailureCode:
      "plan_checkpoint_cancelled_by_epoch_transition",
  }), true);
});

test("expected-click toggles cancel every crossing plan contract and release only untouched spend", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const cancellation = sites.slice(
    sites.indexOf("async function cancelAutonomousJobsForEpochTransition"),
    sites.indexOf("const PLAN_SITE_RECONCILIATION_PAGE_SIZE"),
  );
  assert.match(cancellation, /if \(autonomousPlansOnly\)/);
  assert.match(cancellation, /job\.type !== "plan"/);
  assert.match(cancellation, /payload\.manual === true && !expectedClickMigration/);
  assert.match(cancellation, /job\.status === "pending"/);
  assert.match(cancellation, /\(job\.workerAttempts \?\? 0\) === 0/);
  assert.match(cancellation, /plan_cancelled_before_execution/);
  assert.match(cancellation, /reservation\.userId === site\.userId/);
  assert.match(
    cancellation,
    /reservation\.trigger === expectedReservationTrigger/,
  );
  assert.match(
    cancellation,
    /topicPlanProviderReservationTriggerFromPayload\(payload\)/,
  );
  assert.ok((cancellation.match(/AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD/g) ?? [])
    .length >= 3);
  assert.match(cancellation, /job\.status === "running"/);
  assert.match(cancellation, /status: "ambiguous"/);
  assert.match(cancellation, /expectedClickPlanMigrationJobId === job\._id/);
  assert.match(cancellation, /expectedClickPlanMigrationReservedAt === job\.createdAt/);

  const toggle = sites.slice(
    sites.indexOf("export const setExpectedClickScheduling"),
    sites.indexOf("export const resetAll"),
  );
  assert.match(toggle, /if \(changed\)/);
  assert.match(toggle, /cancelAutonomousJobsForEpochTransition/);
  assert.match(toggle, /false,\s*true/);
  assert.doesNotMatch(toggle, /autopilotRolloutEpoch:/);
});

test("cancelled legacy planners cannot persist through an ordinary upsert race", () => {
  const topics = readFileSync("convex/topics.ts", "utf8");
  const upsert = topics.slice(
    topics.indexOf("export const upsertMany"),
    topics.indexOf("export const remove"),
  );
  assert.match(upsert, /planExecution: v\.optional\(v\.object/);
  assert.match(upsert, /job\.siteId !== siteId/);
  assert.match(upsert, /job\.status !== "running"/);
  assert.match(upsert, /job\.workerToken !== planExecution\.workerToken/);
  assert.match(upsert, /\(job\.leaseExpiresAt \?\? 0\) <= timestamp/);
  assert.match(
    upsert,
    /\(job\.workerAttempts \?\? 0\) \+ 1 !== planExecution\.workerExecution/,
  );
  assert.match(
    upsert,
    /site\.expectedClickSchedulingEnabled !==\s*planExecution\.expectedClickSchedulingEnabled/,
  );
  assert.match(upsert, /jobAuthorizedForExecution\(site, job\)/);
  assert.match(upsert, /siteExecutionAuthorized\(ctx, site\)/);
  assert.ok(
    upsert.indexOf("job.status !== \"running\"") <
      upsert.indexOf("const existing = await ctx.db"),
  );

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const upsertCallOffsets = [
    ...pipeline.matchAll(/internal\.topics\.upsertMany/g),
  ].map((match) => match.index);
  assert.equal(upsertCallOffsets.length, 2);
  for (const offset of upsertCallOffsets) {
    const call = pipeline.slice(offset, offset + 500);
    assert.match(call, /planExecution:/);
    assert.match(call, /jobId: jobId!/);
    assert.match(call, /workerToken: workerToken!/);
    assert.match(call, /workerExecution/);
    assert.match(call, /expectedClickSchedulingEnabled/);
  }
});

test("ordinary plan persistence and job success share one serializable commit", () => {
  const topics = readFileSync("convex/topics.ts", "utf8");
  const upsert = topics.slice(
    topics.indexOf("export const upsertMany"),
    topics.indexOf("export const remove"),
  );
  const firstTopicWrite = Math.min(
    ...["ctx.db.patch(existingTopic._id", "ctx.db.insert(\"topic_clusters\""]
      .map((needle) => upsert.indexOf(needle))
      .filter((offset) => offset >= 0),
  );
  const jobCommit = upsert.indexOf("ctx.db.patch(owningPlanJob._id");
  assert.ok(firstTopicWrite >= 0 && jobCommit > firstTopicWrite);
  assert.match(upsert, /status: "done"/);
  assert.match(upsert, /planPersistenceCommit:/);
  assert.match(upsert, /commitNonce: planExecution\.commitNonce/);
  assert.match(upsert, /acceptedTopicCount: accepted/);
  assert.match(upsert, /reservation\.userId !== site\.userId/);
  assert.match(
    upsert,
    /reservation\.trigger !==\s*topicPlanProviderReservationTriggerFromPayload\(job\.payload\)/,
  );
  assert.match(
    upsert,
    /planRetryUsesCurrentReservationDay\(\s*job\.providerCostReservationDay/,
  );
  assert.ok(
    upsert.indexOf("job.status !== \"running\"") < firstTopicWrite,
    "cancel-before-commit must fail before any topic write",
  );
  assert.ok(
    jobCommit < upsert.indexOf("return {\n      inserted"),
    "topic writes and terminal job success must finish in one mutation",
  );

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const continuation = jobs.slice(
    jobs.indexOf("export const continueSuccessfulUnderfilledPlan"),
    jobs.indexOf("export const finalizeCommittedPlanResult"),
  );
  assert.match(continuation, /job\.status !== "done"/);
  assert.match(continuation, /exactPlanPersistenceCommit/);
  assert.match(
    continuation,
    /site\.expectedClickSchedulingEnabled !==\s*persistenceCommit\.expectedClickSchedulingEnabled/,
  );
  assert.match(continuation, /const activePlan = \[\.\.\.pendingPlans, \.\.\.runningPlans\]/);
  assert.match(continuation, /candidate\.type === "plan"/);
  assert.match(continuation, /reason: "active_plan"/);
  assert.match(continuation, /const newerPlan = contemporaryPlans\.find/);
  assert.match(continuation, /reason: "newer_plan"/);
  const finalize = jobs.slice(
    jobs.indexOf("export const finalizeCommittedPlanResult"),
    jobs.indexOf("export const authorizeUnderfilledPlanContinuationExecution"),
  );
  assert.match(finalize, /job\.status !== "done"/);
  assert.match(finalize, /exactPlanPersistenceCommit/);
  assert.doesNotMatch(finalize, /topic_clusters|status: "pending"|status: "running"/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const bestEffortFinalize = pipeline.slice(
    pipeline.indexOf("async function finalizeCommittedPlanResultBestEffort"),
    pipeline.indexOf("async function commitInlinePlanSuccessExactly"),
  );
  assert.match(bestEffortFinalize, /try \{/);
  assert.match(bestEffortFinalize, /catch \(error\)/);
  assert.doesNotMatch(bestEffortFinalize, /throw error|throw new Error/);
  const postCommitAudit = pipeline.slice(
    pipeline.indexOf('status: "audit_pending"'),
    pipeline.indexOf("return {\n    count: savedTopicCount"),
  );
  assert.match(postCommitAudit, /try \{/);
  assert.match(postCommitAudit, /catch \(error\)/);
  assert.match(postCommitAudit, /if \(!planPersistenceCommit\) throw error/);
  assert.match(
    postCommitAudit,
    /Atomic plan commit succeeded; portfolio audit will reconcile later/,
  );
  const directPlan = pipeline.slice(
    pipeline.indexOf("async function generatePlanHandler"),
    pipeline.indexOf("export const generatePlanInternal"),
  );
  const queuedPlanStart = pipeline.indexOf('if (job.type === "plan")');
  const queuedPlan = pipeline.slice(
    queuedPlanStart,
    pipeline.indexOf('if (job.type === "links")', queuedPlanStart),
  );
  for (const entrypoint of [directPlan, queuedPlan]) {
    assert.match(entrypoint, /finalizeCommittedPlanResult/);
    assert.doesNotMatch(entrypoint, /internal\.jobs\.markDone/);
  }
  assert.match(
    queuedPlan,
    /try \{[\s\S]*continueSuccessfulUnderfilledPlan[\s\S]*catch \(error\)[\s\S]*optional continuation deferred/,
  );

  const sites = readFileSync("convex/sites.ts", "utf8");
  const cancellation = sites.slice(
    sites.indexOf("async function cancelAutonomousJobsForEpochTransition"),
    sites.indexOf("const PLAN_SITE_RECONCILIATION_PAGE_SIZE"),
  );
  assert.match(cancellation, /eq\("status", "pending"\)/);
  assert.match(cancellation, /eq\("status", "running"\)/);
  assert.doesNotMatch(cancellation, /eq\("status", "done"\)/);
});

test("lost atomic commit responses recover only their exact durable receipts", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.equal(
    (pipeline.match(/internal\.jobs\.inspectCommittedPlanPersistence/g) ?? [])
      .length,
    2,
  );
  for (const offset of [
    ...pipeline.matchAll(/internal\.jobs\.inspectCommittedPlanPersistence/g),
  ].map((match) => match.index)) {
    const recovery = pipeline.slice((offset ?? 0) - 250, (offset ?? 0) + 650);
    assert.match(recovery, /catch \(error\)/);
    assert.match(recovery, /siteId/);
    assert.match(recovery, /jobId: jobId!/);
    assert.match(recovery, /commitNonce: planPersistenceCommitNonce!/);
    assert.match(recovery, /workerExecution/);
    assert.match(recovery, /if \(!recovered\.committed\) throw error/);
    assert.match(recovery, /acceptedKeywordKeys: recovered\.acceptedKeywordKeys/);
  }

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const inspectOrdinary = jobs.slice(
    jobs.indexOf("export const inspectCommittedPlanPersistence"),
    jobs.indexOf("export const finalizeCommittedPlanResult"),
  );
  assert.match(inspectOrdinary, /job\.siteId !== args\.siteId/);
  assert.match(inspectOrdinary, /job\.status !== "done"/);
  assert.match(inspectOrdinary, /exactPlanPersistenceCommit/);
  assert.match(
    inspectOrdinary,
    /storedResult\.count !== persistenceCommit\.cumulativeTopicCount/,
  );

  const topics = readFileSync("convex/topics.ts", "utf8");
  const upsert = topics.slice(
    topics.indexOf("export const upsertMany"),
    topics.indexOf("export const remove"),
  );
  assert.match(upsert, /atomicPlanPersistenceCumulativeCount/);
  assert.match(upsert, /count: cumulativeTopicCount/);
  assert.match(upsert, /cumulativeTopicCount,/);
  assert.match(upsert, /acceptedKeywordKeys,/);

  const checkpoints = readFileSync(
    "convex/planCandidateCheckpoints.ts",
    "utf8",
  );
  const inspectCheckpoint = checkpoints.slice(
    checkpoints.indexOf("export const inspectCommittedInlineSuccess"),
    checkpoints.indexOf("export async function terminallyClosePlanCheckpoints"),
  );
  assert.match(inspectCheckpoint, /job\.status !== "done"/);
  assert.match(inspectCheckpoint, /checkpoints\.length !== 1/);
  assert.match(inspectCheckpoint, /checkpoint\.status !== "inline_completed"/);
  assert.match(inspectCheckpoint, /inlineSuccessCommitNonce/);
  assert.match(inspectCheckpoint, /planCheckpointCommit/);
  assert.match(
    inspectCheckpoint,
    /topic\.planCheckpointTerminalFailureCode !== undefined/,
  );
  assert.doesNotMatch(inspectCheckpoint, /topic\.status !== "planned"/);

  const helper = pipeline.slice(
    pipeline.indexOf("async function commitInlinePlanSuccessExactly"),
    pipeline.indexOf("async function handlePlan"),
  );
  assert.match(helper, /completionNonce = randomUUID\(\)/);
  assert.match(helper, /commitInlineSuccess/);
  assert.match(helper, /inspectCommittedInlineSuccess/);
  assert.match(helper, /if \(!recovered\.committed\) throw error/);
});

test("live organic SERP gets one bounded response window and empty plans stop before authority", () => {
  const seoData = readFileSync("convex/actions/seoData.ts", "utf8");
  const liveSerp = seoData.slice(
    seoData.indexOf("async function analyzeSERPFromAPI"),
    seoData.indexOf("async function analyzeSERPFromAI"),
  );
  assert.match(liveSerp, /serp\/google\/organic\/live\/regular/);
  assert.match(liveSerp, /45_000/);
  assert.equal((liveSerp.match(/dataForSEORequest\(/g) ?? []).length, 1);
  assert.doesNotMatch(liveSerp, /retry|Promise\.race|setTimeout/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const zeroGuard = pipeline.indexOf("if (enrichedPlan.length === 0)");
  const authorityCollection = pipeline.indexOf(
    "const authorityPlan = planSerpAuthorityCollection",
    zeroGuard,
  );
  assert.ok(zeroGuard >= 0 && zeroGuard < authorityCollection);
  assert.match(
    pipeline.slice(zeroGuard, authorityCollection),
    /No topic survived live SERP evidence, tenant intent, cannibalization, and business-fit gates/,
  );
});

test("only canary-on automatic topic plans receive the immutable checkpoint marker", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const queue = jobs.slice(
    jobs.indexOf("export const queuePlanIfAbsent"),
    jobs.indexOf("export const queueExpectedClickPlanMigrationAfterPreflight"),
  );
  assert.match(queue, /const automaticPlan = args\.manual !== true/);
  assert.match(queue, /const automaticTopicPlan = automaticPlan/);
  assert.match(
    queue,
    /automaticTopicPlan &&\s*site\.expectedClickSchedulingEnabled === true/,
  );
  assert.match(queue, /\(planYieldTarget \? \{ planYieldTarget \} : \{\}\)/);
  assert.match(queue, /planCheckpointModeVersion:\s*PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /checkpointYieldTarget\?\.requiredVerifiedYield \?\?\s*AUTOMATIC_PLAN_TOPIC_CAPACITY/,
  );
  assert.match(
    pipeline,
    /underfilledContinuation\?\.remainingTopicCapacity \?\?\s*checkpointYieldTarget\?\.requiredVerifiedYield \?\?\s*AUTOMATIC_PLAN_TOPIC_CAPACITY/,
  );
  assert.doesNotMatch(pipeline, /workerExecution - 1\) \* 23/);
});

test("checkpoint transient failure is terminal while legacy retry remains bounded", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const retry = jobs.slice(
    jobs.indexOf("export const markRetryableFailure"),
    jobs.indexOf("export const markPublishFailed"),
  );
  assert.match(retry, /const checkpointSingleExecution = Boolean/);
  assert.match(
    retry,
    /const maximumRetries = checkpointSingleExecution\s*\? 0\s*:\s*job\.type === "plan"\s*\? AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES/,
  );
  assert.match(retry, /!willRetry && job\.type === "plan"/);
  assert.match(retry, /activateTerminalPlanCheckpoints/);
});

test("an empty checkpoint never receives an active completion handle", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const stage = pipeline.indexOf("planCandidateCheckpoints.stage");
  const empty = pipeline.indexOf("if (!checkpoint.active || enrichedPlan.length === 0)", stage);
  const active = pipeline.indexOf("activePlanCheckpoint = {", stage);
  const complete = pipeline.indexOf("planCandidateCheckpoints.completeInline", stage);
  assert.ok(stage > 0 && empty > stage && active > empty && complete > active);

  const checkpoints = readFileSync(
    "convex/planCandidateCheckpoints.ts",
    "utf8",
  );
  assert.match(checkpoints, /status: accepted\.length > 0 \? "active" : "empty"/);
  assert.match(checkpoints, /active: staged\.length > 0/);
});

test("inline success stays locked until one atomic job-terminal commit", () => {
  const checkpoints = readFileSync(
    "convex/planCandidateCheckpoints.ts",
    "utf8",
  );
  const completion = checkpoints.slice(
    checkpoints.indexOf("export const completeInline"),
    checkpoints.indexOf("export const commitInlineSuccess"),
  );
  assert.match(completion, /status: "inline_sealed"/);
  assert.match(completion, /inlineCompletedTopicIds: completed/);
  assert.doesNotMatch(completion, /status: "planned"/);
  assert.doesNotMatch(completion, /planCheckpointActivatedAt: timestamp/);

  const commit = checkpoints.slice(
    checkpoints.indexOf("export const commitInlineSuccess"),
    checkpoints.indexOf("terminallyClosePlanCheckpoints"),
  );
  assert.match(commit, /checkpoint\.status !== "inline_sealed"/);
  assert.match(commit, /checkpointManifestMatchesJob/);
  assert.match(commit, /currentWorker/);
  assert.match(commit, /jobAuthorizedForExecution/);
  assert.match(commit, /siteExecutionAuthorized/);
  assert.match(commit, /exactReservation/);
  assert.match(commit, /exactCheckpointTopicBinding/);
  assert.match(commit, /status: "planned"/);
  assert.match(commit, /status: "inline_completed"/);
  assert.match(commit, /status: "done"/);

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const markDone = jobs.slice(
    jobs.indexOf("export const markDone"),
    jobs.indexOf("export const markFailed"),
  );
  assert.match(markDone, /commitInlineSuccess/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.equal(
    (pipeline.match(/planCandidateCheckpoints\.commitInlineSuccess/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (pipeline.match(/await commitInlinePlanSuccessExactly/g) ?? []).length,
    2,
  );
});

test("checkpoint mode admits one execution before balance and disables continuation", () => {
  const checkpoints = readFileSync(
    "convex/planCandidateCheckpoints.ts",
    "utf8",
  );
  const authorization = checkpoints.slice(
    checkpoints.indexOf("export const authorizeSingleExecution"),
    checkpoints.indexOf("async function exactCandidate"),
  );
  assert.match(authorization, /args\.workerExecution !== 1/);
  assert.match(authorization, /\(job\.workerAttempts \?\? 0\) !== 0/);

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const continuation = jobs.slice(
    jobs.indexOf("export const continueSuccessfulUnderfilledPlan"),
    jobs.indexOf("export const authorizeUnderfilledPlanContinuationExecution"),
  );
  assert.match(continuation, /checkpoint_single_execution/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  for (const start of [
    pipeline.indexOf("async function generatePlanHandler"),
    pipeline.indexOf('if (job.type === "plan")'),
  ]) {
    const body = pipeline.slice(start, start + 16_000);
    const authorize = body.indexOf("authorizeSingleExecution");
    const balance = body.indexOf("assertDataForSeoAccountBalance");
    const provider = body.indexOf("handlePlan(");
    assert.ok(authorize >= 0 && authorize < balance && balance < provider);
  }
});

test("checkpoint receipts are never adopted into evidence recovery", () => {
  const evidence = readFileSync(
    "convex/expectedClickEvidenceBackfill.ts",
    "utf8",
  );
  const worker = readFileSync(
    "convex/actions/expectedClickEvidenceBackfill.ts",
    "utf8",
  );
  const schema = readFileSync("convex/schema.ts", "utf8");
  const deletion = readFileSync("convex/sites.ts", "utf8");
  assert.equal(AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD, 2_000_000);
  assert.equal(
    EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    100_000,
  );
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS, 90_000);
  assert.match(evidence, /serpSnapshots: \[\]/);
  assert.match(evidence, /serpAttemptedTopicIds: \[\]/);
  assert.doesNotMatch(evidence, /adoptedSerpSnapshots|adoptedAttemptMarkersReleased/);
  assert.match(worker, /const alreadyRecorded =/);
  assert.match(worker, /state\.job\.serpSnapshots\.some/);
  assert.match(worker, /state\.job\.serpAttemptedTopicIds\.includes/);
  const plannedRecovery = readFileSync(
    "convex/lib/plannedTopicEvidenceRecovery.ts",
    "utf8",
  );
  assert.match(
    plannedRecovery,
    /plan_checkpoint_serp_already_attempted/,
  );
  assert.match(evidence, /expectedClickEvidenceAttemptVersion:/);
  assert.ok(
    evidence.indexOf("expectedClickEvidenceAttemptVersion:") <
      evidence.indexOf("providerCallsAttempted: job.providerCallsAttempted + 1"),
  );
  assert.match(schema, /plan_candidate_checkpoints: defineTable/);
  assert.match(schema, /normalizedUrlFingerprint: v\.string\(\)/);
  assert.match(deletion, /"plan_candidate_checkpoints"/);
});
