import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY,
  ARTICLE_PROVIDER_FLEET_CONCURRENCY,
  articleGenerationAttemptAllowance,
  articleGenerationAttemptKey,
  articleGenerationAttemptMonth,
  decideArticleProviderAdmission,
} from "../convex/lib/articleGenerationAttempt.ts";

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedBlock(text: string, name: string): string {
  const start = text.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

test("plan-derived attempt ceilings preserve every purchased article plus bounded recovery", () => {
  assert.deepEqual(
    [3, 10, 25, 60, 150].map(articleGenerationAttemptAllowance),
    [5, 12, 30, 72, 170],
  );
  assert.equal(ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY, 2);
  assert.equal(ARTICLE_PROVIDER_FLEET_CONCURRENCY, 3);
});

test("one worker execution is idempotent while each paid retry gets a new receipt", () => {
  assert.equal(articleGenerationAttemptKey("job-a", 0), "job-a:0");
  assert.equal(articleGenerationAttemptKey("job-a", 0), "job-a:0");
  assert.equal(articleGenerationAttemptKey("job-a", 1), "job-a:1");
  assert.notEqual(
    articleGenerationAttemptKey("job-a", 0),
    articleGenerationAttemptKey("job-a", 1),
  );
  assert.equal(
    articleGenerationAttemptMonth(Date.UTC(2026, 7, 31, 23, 59)),
    "2026-08",
  );
  assert.equal(
    articleGenerationAttemptMonth(Date.UTC(2026, 8, 1, 0, 0)),
    "2026-09",
  );
});

test("admission reuses the exact live receipt before applying account or fleet limits", () => {
  assert.deepEqual(
    decideArticleProviderAdmission({
      existingStatus: "reserved",
      existingOwnedByAccount: true,
      attemptsUsed: 170,
      attemptAllowance: 170,
      activeAccountAttempts: 2,
      activeFleetAttempts: 3,
    }),
    { status: "reuse" },
  );
  assert.deepEqual(
    decideArticleProviderAdmission({
      existingStatus: "funding_paused",
      existingOwnedByAccount: true,
      attemptsUsed: 170,
      attemptAllowance: 170,
      activeAccountAttempts: 2,
      activeFleetAttempts: 3,
    }),
    { status: "reuse" },
  );
  assert.deepEqual(
    decideArticleProviderAdmission({
      existingStatus: "failed",
      existingOwnedByAccount: true,
      attemptsUsed: 1,
      attemptAllowance: 5,
      activeAccountAttempts: 0,
      activeFleetAttempts: 0,
    }),
    { status: "reject", reason: "attempt_already_settled" },
  );
  assert.deepEqual(
    decideArticleProviderAdmission({
      existingStatus: "reserved",
      existingOwnedByAccount: false,
      attemptsUsed: 0,
      attemptAllowance: 5,
      activeAccountAttempts: 0,
      activeFleetAttempts: 0,
    }),
    { status: "reject", reason: "attempt_already_settled" },
  );
});

test("monthly, account-concurrency, and fleet-concurrency breakers fail closed", () => {
  const base = {
    attemptsUsed: 0,
    attemptAllowance: 5,
    activeAccountAttempts: 0,
    activeFleetAttempts: 0,
  };
  assert.deepEqual(
    decideArticleProviderAdmission({ ...base, attemptsUsed: 5 }),
    { status: "reject", reason: "monthly_attempt_limit" },
  );
  assert.deepEqual(
    decideArticleProviderAdmission({ ...base, activeAccountAttempts: 2 }),
    { status: "reject", reason: "account_concurrency" },
  );
  assert.deepEqual(
    decideArticleProviderAdmission({ ...base, activeFleetAttempts: 3 }),
    { status: "reject", reason: "fleet_concurrency" },
  );
  assert.deepEqual(decideArticleProviderAdmission(base), { status: "reserve" });
});

test("atomic reservation rechecks lease, tenant, rollout, and canonical plan", () => {
  const jobs = source("convex/jobs.ts");
  const reserve = exportedBlock(jobs, "reserveArticleProviderAttempt");
  const insert = reserve.indexOf('ctx.db.insert("article_generation_attempts"');

  assert.match(reserve, /job\.siteId !== args\.siteId/);
  assert.match(reserve, /ownsJob\(job, args\.workerToken\)/);
  assert.match(reserve, /job\.leaseExpiresAt <= currentTime/);
  assert.match(reserve, /jobAuthorizedForExecution\(site, job\)/);
  assert.match(reserve, /currentSitePlanAllowance\(ctx, site\)/);
  assert.match(reserve, /by_attempt_key/);
  assert.match(reserve, /by_user_month/);
  assert.match(reserve, /by_user_status_expires/);
  assert.match(reserve, /by_status_expires/);
  assert.ok(reserve.indexOf("decideArticleProviderAdmission") < insert);
  assert.doesNotMatch(reserve, /provider_spend_reservations|reservedMicroUsd/);
});

test("all paid article provider calls reserve while link sealing and publication stay provider-free", () => {
  const pipeline = source("convex/actions/pipeline.ts");
  const worker = exportedBlock(pipeline, "processNextJob");
  const linkHandler = pipeline.slice(
    pipeline.indexOf("async function handleLinks"),
    pipeline.indexOf("async function handleAnalyzeSite"),
  );
  const publishStart = worker.indexOf("if (payload?.publishOnly)");
  const publishEnd = worker.indexOf("const checkpointId", publishStart);
  const publishOnly = worker.slice(publishStart, publishEnd);

  assert.match(worker, /reserveArticleProviderAttempt\("generation"\)[\s\S]*handleArticle\(/);
  assert.match(worker, /reserveArticleProviderAttempt\("quality_review"\)[\s\S]*reviewExistingArticleHandler\(/);
  assert.doesNotMatch(worker, /reserveArticleProviderAttempt\("internal_links"\)/);
  assert.doesNotMatch(linkHandler, /callClaude/);
  assert.match(linkHandler, /selectRelatedInternalLinks/);
  assert.match(linkHandler, /validateInternalLinkSuggestions/);
  assert.doesNotMatch(publishOnly, /reserveArticleProviderAttempt\(/);
});

test("failed, retried, and expired executions retain immutable attempt receipts", () => {
  const jobs = source("convex/jobs.ts");
  const reset = exportedBlock(jobs, "resetStuckJobs");
  const recover = exportedBlock(jobs, "recoverParentTimeoutJob");
  const failed = exportedBlock(jobs, "markFailed");
  const retry = exportedBlock(jobs, "markRetryableFailure");
  const done = exportedBlock(jobs, "markDone");
  const publishFailed = exportedBlock(jobs, "markPublishFailed");
  const cleanup = exportedBlock(jobs, "cleanupExpiredGenerationReservations");
  const releaseStart = jobs.indexOf("async function releaseReservedUsage");
  const releaseEnd = jobs.indexOf("async function raiseJobAlert", releaseStart);
  const release = jobs.slice(releaseStart, releaseEnd);

  assert.ok(
    reset.indexOf('settleArticleProviderAttempt(ctx, job, "ambiguous"') <
      reset.indexOf("const attempts = (job.workerAttempts ?? 0) + 1"),
  );
  assert.ok(
    recover.indexOf('settleArticleProviderAttempt(ctx, job, "ambiguous"') <
      recover.indexOf("await releaseReservedUsage(ctx, job)"),
  );
  assert.match(failed, /settleArticleProviderAttempt\(ctx, job, "failed"/);
  assert.match(failed, /cadenceFailure,/);
  assert.match(retry, /settleArticleProviderAttempt\(ctx, job, "failed"/);
  assert.match(retry, /cadenceFailure,/);
  assert.match(done, /settleArticleProviderAttempt\(ctx, job, "completed"/);
  assert.match(publishFailed, /cadenceFailure: undefined/);
  assert.match(cleanup, /article_generation_attempts/);
  assert.match(cleanup, /status: "ambiguous"/);
  assert.match(cleanup, /normalizeId\("jobs", attempt\.jobKey\)/);
  assert.doesNotMatch(release, /article_generation_attempts/);
});

test("funding and monthly allowance pauses preserve cadence with exact future wakes", () => {
  const jobs = source("convex/jobs.ts");
  const pipeline = source("convex/actions/pipeline.ts");
  const funding = exportedBlock(jobs, "deferArticleProviderFunding");
  const allowance = exportedBlock(
    jobs,
    "deferArticleProviderMonthlyAllowance",
  );
  const resume = exportedBlock(
    jobs,
    "resumeArticleProviderFundingJobInternal",
  );
  const worker = exportedBlock(pipeline, "processNextJob");

  assert.match(funding, /pauseArticleProviderAttemptForFunding/);
  assert.doesNotMatch(funding, /settleArticleProviderAttempt/);
  assert.doesNotMatch(funding, /workerAttempts.*\+\s*1/);
  assert.match(funding, /CADENCE_BALANCE_RECHECK_MS/);
  assert.match(funding, /status: "pending"/);
  assert.match(funding, /nextAttemptAt/);
  assert.match(funding, /internal\.autopilot\.dispatchSiteFollowup/);
  assert.match(funding, /article_provider_funding_recheck/);
  assert.doesNotMatch(funding, /qualityRevisionCount|publicationGateStatus/);

  assert.match(allowance, /nextUtcMonthAt\(currentTime\)/);
  assert.match(allowance, /status: "pending"/);
  assert.match(allowance, /article_provider_allowance_recheck/);
  assert.doesNotMatch(allowance, /settleArticleProviderAttempt/);

  assert.match(
    resume,
    /article_provider_funding_unavailable\|no available funded capacity/,
  );
  assert.match(resume, /job\.status === "failed"/);
  assert.match(resume, /status: "pending"/);
  assert.ok(
    resume.indexOf("await reconcileJobTopicLifecycle(ctx, job)") >
      resume.indexOf('status: "pending"'),
  );
  assert.match(resume, /article_provider_funding_restored/);

  assert.match(
    worker,
    /error\.reason === "monthly_attempt_limit"[\s\S]*deferArticleProviderMonthlyAllowance/,
  );
  assert.match(
    worker,
    /error\.code === "article_provider_funding_unavailable"[\s\S]*deferArticleProviderFunding/,
  );
});

test("attempt ledger survives site deletion while exact article quota semantics stay separate", () => {
  const schema = source("convex/schema.ts");
  const sites = source("convex/sites.ts");
  const jobs = source("convex/jobs.ts");
  const tableStart = schema.indexOf("article_generation_attempts: defineTable");
  const tableEnd = schema.indexOf("autopilot_runs: defineTable", tableStart);
  const table = schema.slice(tableStart, tableEnd);
  const deletionStages = sites.slice(
    sites.indexOf("const SITE_DELETION_STAGES"),
    sites.indexOf("async function gateSiteDeletionForOutreach"),
  );
  const cancellation = sites.slice(
    sites.indexOf("async function cancelAutonomousJobsForEpochTransition"),
    sites.indexOf("const PLAN_SITE_RECONCILIATION_PAGE_SIZE"),
  );
  const reserveUsage = exportedBlock(jobs, "reserveGenerationSlot");

  assert.match(table, /userId: v\.string\(\)/);
  assert.match(table, /jobKey: v\.string\(\)/);
  assert.match(table, /attemptKey: v\.string\(\)/);
  assert.doesNotMatch(table, /siteId/);
  assert.doesNotMatch(deletionStages, /article_generation_attempts/);
  assert.match(cancellation, /article_generation_attempts/);
  assert.match(cancellation, /status: "ambiguous"/);
  assert.match(reserveUsage, /usage_log/);
  assert.match(reserveUsage, /limits\.maxArticles/);
  assert.doesNotMatch(reserveUsage, /article_generation_attempts/);
});

test("manual, run-now, and autonomous jobs converge on the same metered worker", () => {
  const jobs = source("convex/jobs.ts");
  const pipeline = source("convex/actions/pipeline.ts");
  const scheduler = source("convex/actions/scheduler.ts");

  assert.match(exportedBlock(pipeline, "generateArticle"), /processNextJob/);
  assert.match(exportedBlock(pipeline, "generateNow"), /processNextJob/);
  assert.match(exportedBlock(jobs, "runQueuedTopic"), /processNextJob/);
  assert.match(exportedBlock(jobs, "queueArticleNow"), /processNextJob/);
  assert.match(scheduler, /queueTopicArticleIfAbsent/);
  assert.match(
    exportedBlock(pipeline, "reviewExistingArticleInternal"),
    /Direct internal article review is disabled/,
  );
});
