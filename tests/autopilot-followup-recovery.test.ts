import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("convex/autopilot.ts", "utf8");
const operatorProjection = readFileSync(
  "convex/lib/operatorSnapshot.ts",
  "utf8",
);
const start = source.indexOf(
  "export const recoverFailedPublicUrlVerifiedFollowup",
);
const end = source.indexOf(
  "export const promoteWarmSiteIfReady",
  start,
);
const recovery = source.slice(start, end);
const schema = readFileSync("convex/schema.ts", "utf8");
const backfillStart = source.indexOf(
  "export const backfillPublicUrlVerifiedRecoveryReceipt",
);
const backfill = source.slice(backfillStart, end);

test("post-verification recovery is scoped to the exact failed tenant run", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(recovery, /siteId: v\.id\("sites"\)/);
  assert.match(recovery, /failedRunId: v\.id\("autopilot_runs"\)/);
  assert.match(recovery, /failedRun\.siteId !== siteId/);
  assert.match(recovery, /failedRun\.trigger !== PUBLIC_URL_VERIFIED_TRIGGER/);
  assert.match(recovery, /failedRun\.status !== "failed"/);
  assert.match(recovery, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(recovery, /site\.autopilotEnabled/);
  assert.match(recovery, /\["warm", "live"\]\.includes/);
  assert.match(recovery, /pendingJob \|\| runningJob/);
  assert.match(
    recovery,
    /failedRun\.scheduledAt < latestPublished\.publicUrlVerifiedAt/,
  );
});

test("post-verification recovery has an immutable indexed replay receipt", () => {
  assert.match(
    schema,
    /recoveryOfRunId: v\.optional\(v\.id\("autopilot_runs"\)\)/,
  );
  assert.match(
    schema,
    /index\("by_site_recovery_source", \["siteId", "recoveryOfRunId"\]\)/,
  );
  assert.match(recovery, /withIndex\("by_site_recovery_source"/);
  assert.match(recovery, /\.eq\("recoveryOfRunId", failedRunId\)/);
  assert.match(recovery, /recoveryOfRunId: failedRunId/);
  assert.match(recovery, /reason: "already_replayed"/);
  assert.match(recovery, /health\.lastRunId !== failedRunId/);
  assert.match(recovery, /ctx\.db\.insert\("autopilot_runs"/);
  assert.match(recovery, /ctx\.scheduler\.runAfter\(0/);
  assert.doesNotMatch(recovery, /ctx\.db\.patch\(failedRunId/);
  assert.doesNotMatch(
    recovery,
    /q\.field\("detail"\), recovery(?:Marker|Detail)/,
  );
});

test("run completion may overwrite detail without erasing replay idempotency", () => {
  const finishStart = source.indexOf("export const markRunFinished");
  const finishEnd = source.indexOf("export const markRunFailed", finishStart);
  const finish = source.slice(finishStart, finishEnd);
  assert.match(finish, /detail: args\.detail/);
  assert.doesNotMatch(finish, /recoveryOfRunId:/);
  assert.match(recovery, /withIndex\("by_site_recovery_source"/);
  assert.doesNotMatch(recovery, /q\.field\("detail"\)/);
  assert.match(source, /runs\.map\(operatorContinuationRunReceipt\)/);
  assert.match(
    operatorProjection,
    /recoveryOfRunId: run\.recoveryOfRunId/,
  );
});

test("post-verification recovery cannot republish or move the cadence", () => {
  assert.match(
    recovery,
    /latestPublished\.publicUrlStatus !== "verified"/,
  );
  assert.match(
    recovery,
    /scheduledAt \+ PUBLIC_URL_VERIFIED_RECOVERY_HEADROOM_MS >=[\s\S]*nextPublicationDueAt/,
  );
  assert.match(
    recovery,
    /health\.nextPublicationDueAt !== nextPublicationDueAt/,
  );
  assert.match(recovery, /health\.lastPublishedAt !== lastPublishedAt/);
  assert.doesNotMatch(recovery, /queuePublicationIfAbsent/);
  assert.doesNotMatch(recovery, /publishArticle/);
  const healthPatch = recovery.slice(
    recovery.indexOf("await upsertHealth"),
    recovery.indexOf("await ctx.scheduler.runAfter"),
  );
  assert.doesNotMatch(healthPatch, /nextPublicationDueAt/);
});

test("legacy receipt backfill is strict, one-shot, and scheduling-inert", () => {
  assert.ok(backfillStart >= 0);
  assert.match(backfill, /backfillVersion: v\.literal\(1\)/);
  assert.match(backfill, /failedRunId === recoveryRunId/);
  assert.match(backfill, /failedRun\.siteId !== siteId/);
  assert.match(backfill, /recoveryRun\.siteId !== siteId/);
  assert.match(backfill, /failedRun\.status !== "failed"/);
  assert.match(backfill, /recoveryRun\.status !== "completed"/);
  assert.match(backfill, /recoveryRun\._creationTime <= failedRun\._creationTime/);
  assert.match(backfill, /recoveryRun\.scheduledAt < failedRun\.completedAt/);
  assert.match(backfill, /reason: "already_bound"/);
  assert.match(
    backfill,
    /ctx\.db\.patch\(recoveryRunId, \{ recoveryOfRunId: failedRunId \}\)/,
  );
  assert.doesNotMatch(backfill, /scheduler\./);
  assert.doesNotMatch(backfill, /upsertHealth/);
  assert.doesNotMatch(backfill, /queuePublicationIfAbsent|publishArticle/);
});
