import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("convex/actions/gscSync.ts", "utf8");
const persistence = readFileSync("convex/searchPerformance.ts", "utf8");

function exportedBlock(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("the GSC fleet dispatcher isolates every tenant action", () => {
  const fleet = exportedBlock(
    "export const syncAllSites",
    "export const syncSite = action",
  );

  assert.match(fleet, /internal\.sites\.listGrowthPage/);
  assert.match(fleet, /internal\.actions\.gscSync\.syncSiteInternal/);
  assert.match(fleet, /for \(const \[index, summary\] of page\.page\.entries\(\)\)/);
  assert.match(fleet, /try \{[\s\S]*scheduler\.runAfter[\s\S]*\} catch/);
  assert.match(fleet, /internal\.actions\.gscSync\.syncAllSites/);
  assert.doesNotMatch(fleet, /syncSiteGSC\(/);
  assert.doesNotMatch(fleet, /internal\.sites\.getFull/);
});

test("every outbound GSC request is time bounded and error bodies stay private", () => {
  const timeoutUses = source.match(
    /signal: AbortSignal\.timeout\(GSC_HTTP_TIMEOUT_MS\)/g,
  ) ?? [];

  // Token refresh, sitemap PUT, sitemap GET, and URL inspection use the
  // fixed cap. Analytics additionally intersects it with the run deadline.
  assert.equal(timeoutUses.length, 4);
  assert.match(source, /const GSC_HTTP_TIMEOUT_MS = 20_000/);
  assert.match(
    source,
    /Math\.min\(GSC_HTTP_TIMEOUT_MS, timeoutMs\)/,
  );
  assert.doesNotMatch(source, /await\s+[a-zA-Z]+\.text\(\)/);
  assert.doesNotMatch(source, /text\.slice\(/);
});

test("tenant analytics sync uses complete offset pagination before persistence", () => {
  const sync = exportedBlock(
    "async function syncAnalyticsWindow",
    "async function syncSiteGSC",
  );

  assert.match(source, /fetchCompleteDailySearchAnalytics/);
  assert.match(source, /startRow,\s*rowLimit,\s*dataState: "final"/);
  assert.ok(
    sync.indexOf("beginSyncEpoch") <
      sync.indexOf("fetchCompleteDailySearchAnalytics"),
  );
  assert.ok(
    sync.indexOf("fetchCompleteDailySearchAnalytics") <
      sync.indexOf("internal.searchPerformance.upsertBatch"),
  );
  assert.match(sync, /completeSyncEpoch/);
  assert.match(sync, /syncedDates: analytics\.dates/);
  assert.match(sync, /buildGscPageTotalRollups/);
  assert.match(source, /dimensions: dataset === "query_detail"/);
});

test("56-day history uses one isolated backfill and keeps steady-state refresh at 28 days", () => {
  const backfill = exportedBlock(
    "export const syncHistoryBackfillInternal",
    "// Search Console's Sitemap API",
  );
  const recent = exportedBlock(
    "async function syncSiteGSC",
    "\n}",
  );

  assert.match(backfill, /args:\s*\{[\s\S]*siteId: v\.id\("sites"\)/);
  assert.match(backfill, /site\.gscDataThrough !== anchorDataThrough/);
  assert.ok(
    backfill.indexOf("site.gscDataThrough !== anchorDataThrough") <
      backfill.indexOf("refreshedSiteAccessToken"),
  );
  assert.match(backfill, /addSearchConsoleDays\(anchorDataThrough, -55\)/);
  assert.match(backfill, /addSearchConsoleDays\(anchorDataThrough, -28\)/);
  assert.match(recent, /addSearchConsoleDays\(endStr, -27\)/);
  assert.match(recent, /!recent\.completeWindows\.includes\(56\)/);
  assert.match(recent, /syncHistoryBackfillInternal/);
  assert.doesNotMatch(recent, /addSearchConsoleDays\(endStr, -55\)/);
});

test("every staged GSC batch fences tenant deletion before inserting rows", () => {
  for (const marker of ["export const upsertBatch", "export const upsertPageBatch"]) {
    const start = persistence.indexOf(marker);
    const end = persistence.indexOf("\n});", start);
    assert.ok(start >= 0 && end > start);
    const block = persistence.slice(start, end);
    assert.match(block, /const site = await ctx\.db\.get\(siteId\)/);
    assert.match(block, /siteExecutionAuthorized\(ctx, site\)/);
    assert.match(block, /site\.gscPendingSyncEpoch !== syncEpoch/);
    assert.ok(block.indexOf("siteExecutionAuthorized") < block.indexOf("ctx.db.insert"));
    assert.ok(block.indexOf("gscPendingSyncEpoch") < block.indexOf("ctx.db.insert"));
  }
});

test("every outbound GSC phase rechecks the canonical account entitlement", () => {
  const guardStart = source.indexOf("async function assertGscExecutionAuthorized");
  const guardEnd = source.indexOf("function sitemapUrlForDomain", guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(
    guard,
    /internal\.executionAuthorization\.isSiteExecutionAuthorized/,
  );

  const refresh = exportedBlock(
    "async function refreshedSiteAccessToken",
    "type AnalyticsWindowResult",
  );
  const analytics = exportedBlock(
    "async function syncAnalyticsWindow",
    "async function syncSiteGSC",
  );
  const sync = source.slice(
    source.indexOf("async function syncSiteGSC"),
  );
  const sitemap = exportedBlock(
    "export const submitSitemapInternal",
    "async function scheduleEpochPruning",
  );

  assert.ok(
    refresh.indexOf("assertGscExecutionAuthorized") <
      refresh.indexOf("refreshAccessToken"),
  );
  assert.match(analytics, /async \(\{ dataset,[\s\S]*assertGscExecutionAuthorized/);
  assert.ok(
    sync.indexOf("assertGscExecutionAuthorized") <
      sync.indexOf("refreshedSiteAccessToken"),
  );
  assert.ok(
    sitemap.indexOf("assertGscExecutionAuthorized") <
      sitemap.indexOf("refreshAccessToken"),
  );
  assert.match(source, /await assertStillAuthorized\(\);[\s\S]*method: "PUT"/);
  assert.match(source, /await assertStillAuthorized\(\);[\s\S]*const verified = await fetch/);
  assert.match(source, /await assertGscExecutionAuthorized\(ctx, site\._id\);[\s\S]*fetchUrlInspection/);
});

test("epoch completion and pruning are receipt-scoped and bounded", () => {
  assert.match(persistence, /gscDateEpochs: history\.receipts/);
  assert.match(persistence, /gscCompleteWindows: history\.completeWindows/);
  assert.match(persistence, /syncedDates: v\.array\(v\.string\(\)\)/);
  assert.match(persistence, /takeCurrentGscQueryRows/);
  assert.match(persistence, /takeCurrentGscPageRows/);
  assert.match(persistence, /completeCurrentGscRows/);
  assert.match(persistence, /activeEpochByDate\.get\(row\.date\) !== args\.syncEpoch/);
  assert.match(persistence, /numItems: EPOCH_PRUNE_BATCH/);
  assert.match(persistence, /cursor: result\.continueCursor/);
});
