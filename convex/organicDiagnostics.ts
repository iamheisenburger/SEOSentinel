import { internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { addSearchConsoleDays, isBrandedSearchQuery, publishedArticlePageUrl } from "./lib/searchPerformance";
import { articleMatchesCurrentDomain, gscConnectionMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { takeCurrentGscPageRows, takeCurrentGscQueryRows } from "./lib/currentGscRows";
import type { Doc } from "./_generated/dataModel";
import { CONTENT_PAGE_COOLDOWN_MS, CONTENT_PAGE_REVIEW_MS, confirmedContentProfileHash, contentConnectionHash, refreshInsertTarget } from "./lib/contentSelection";
import { REFRESH_COOLDOWN_MS, REFRESH_REVIEW_MS, refreshOpportunities, refreshSlotAvailable, refreshWindowStart } from "./lib/articleRefresh";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals } from "./lib/autopilotBuffer";

/** The page-improvement chooser reads at most this many Search Console rows (selectedPages.chooseImprovement). */
const CHOOSER_GSC_ROW_LIMIT = 3000;

/** Why Autopilot has (or has not) refreshed or improved its editable pages:
 * each gate chooseImprovement applies, counted over the pages, plus the
 * Search Console opportunities each page would have in the chooser's window.
 * Read-only: nothing is patched (the chooser itself marks pages reviewed). */
async function improvementGates(ctx: QueryCtx, site: Doc<"sites">, editablePages: Doc<"pages">[], recentJobs: Doc<"jobs">[]) {
  const now = Date.now();
  let connection: string | null = null;
  try { connection = contentConnectionHash(site); } catch { connection = null; }
  const profile = confirmedContentProfileHash(site);
  const slotAvailable = refreshSlotAvailable(recentJobs);
  const gates = { inactive: 0, connectionChanged: 0, profileChanged: 0, reviewedRecently: 0, improvedRecently: 0,
    refreshSlotOrCooldown: 0, inFlight: 0, passGates: 0 };
  const current: Doc<"pages">[] = [];
  for (const page of editablePages) {
    const e = page.editable!;
    if (!e.active) { gates.inactive++; continue; }
    if (e.connectionHash !== connection) { gates.connectionChanged++; continue; }
    if (e.profileHash !== profile) { gates.profileChanged++; continue; }
    current.push(page);
    if (now - (e.lastReviewedAt ?? 0) < (e.origin === "published_refresh" ? REFRESH_REVIEW_MS : CONTENT_PAGE_REVIEW_MS)) { gates.reviewedRecently++; continue; }
    if (now - (e.lastImprovedAt ?? 0) < CONTENT_PAGE_COOLDOWN_MS) { gates.improvedRecently++; continue; }
    if (e.origin === "published_refresh" && (!slotAvailable || now - (e.lastImprovedAt ?? 0) < REFRESH_COOLDOWN_MS)) { gates.refreshSlotOrCooldown++; continue; }
    if (recentJobs.some(j => j.contentWork?.targetPageId === page._id && !["verified", "failed"].includes(j.contentWork.stage))) { gates.inFlight++; continue; }
    gates.passGates++;
  }
  // Opportunities over every current page (whatever its review timing), in
  // exactly the rows the chooser would read.
  const windowStart = refreshWindowStart((site.gscDateEpochs ?? []).map(receipt => receipt.date));
  if (!windowStart) return { origins: originCount(editablePages), slotAvailable, gates, opportunities: null };
  const chooserRows = await takeCurrentGscQueryRows(ctx, site, CHOOSER_GSC_ROW_LIMIT, { startDate: windowStart });
  const fullRows = await takeCurrentGscQueryRows(ctx, site, 12_000, { startDate: windowStart });
  const signals = tenantTopicBusinessSignals(site);
  const opportunity = { refreshPages: 0, withOpportunity: 0, withOpportunityInFullWindow: 0, onBusiness: 0, insertTarget: 0 };
  const samples: { url: string; query: string | null; position: number | null; impressions: number | null; blockedBy: string }[] = [];
  for (const page of current.filter(p => p.editable!.origin === "published_refresh")) {
    const e = page.editable!;
    opportunity.refreshPages++;
    const all = refreshOpportunities(fullRows.rows, page.url);
    if (all.length) opportunity.withOpportunityInFullWindow++;
    const seen = refreshOpportunities(chooserRows.rows, page.url);
    let blockedBy = "no opportunity";
    if (seen.length) {
      opportunity.withOpportunity++;
      const fit = seen.filter(o => !isBrandedSearchQuery(o.query, site.domain) &&
        evaluateTopicBusinessFit({ keyword: o.query, label: e.title, ...signals }).eligible);
      blockedBy = "off business";
      if (fit.length) {
        opportunity.onBusiness++;
        const managed = e.managedArticleId ? await ctx.db.get(e.managedArticleId) : null;
        blockedBy = refreshInsertTarget(e, managed?.articleType) ? "ready" : "no insert target";
        if (blockedBy === "ready") opportunity.insertTarget++;
      }
    } else if (all.length) blockedBy = "outside chooser rows";
    if (samples.length < 8) samples.push({ url: page.url, query: (seen[0] ?? all[0])?.query ?? null,
      position: (seen[0] ?? all[0]) ? Math.round((seen[0] ?? all[0]).position * 10) / 10 : null,
      impressions: (seen[0] ?? all[0])?.impressions ?? null, blockedBy });
  }
  return { origins: originCount(editablePages), slotAvailable, gates, windowStart,
    chooserRows: chooserRows.rows.length, chooserRowsCapped: chooserRows.exhausted, fullWindowRows: fullRows.rows.length,
    opportunities: opportunity, samples };
}
function originCount(pages: Doc<"pages">[]) {
  return pages.reduce<Record<string, number>>((acc, p) => { const k = p.editable!.origin ?? "selected"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
}
/** The last three days of content slots: deadline, outcome and any rebinding. */
function recentSlots(recentJobs: Doc<"jobs">[]) {
  const since = Date.now() - 3 * 86_400_000;
  const iso = (at?: number) => at ? new Date(at).toISOString().slice(5, 16) : null;
  return recentJobs.filter(j => j.contentWork!.deadlineAt >= since && !j.contentWork!.ownerRequest)
    .sort((a, b) => a.contentWork!.deadlineAt - b.contentWork!.deadlineAt)
    .map(j => ({ deadline: iso(j.contentWork!.deadlineAt), created: iso(j.createdAt), intent: j.contentWork!.intent, stage: j.contentWork!.stage,
      published: iso(j.contentWork!.publishedAt), failure: j.contentWork!.failure ?? null, replaces: Boolean(j.contentWork!.replacesJobId),
      rebinds: (j.contentWork!.slotRebinds ?? []).map(r => `${iso(r.fromDeadlineAt)}->${iso(r.toDeadlineAt)} ${r.reason}`) }));
}

/** Why automatic drafts fail review, over the last 21 days: every draft the
 * quality check rejected (failed slots, and first topics a slot replaced),
 * tallied by the issues and editor notes the final review recorded on it.
 * Read-only; reads only this site's article summaries. */
async function qualityFailures(ctx: QueryCtx, siteId: Doc<"sites">["_id"], recentJobs: Doc<"jobs">[]) {
  const since = Date.now() - 21 * 86_400_000;
  const creates = recentJobs.filter(j => j.contentWork!.intent === "create" && !j.contentWork!.ownerRequest && j.createdAt >= since);
  const finished = creates.filter(j => ["verified", "failed"].includes(j.contentWork!.stage));
  const failed = finished.filter(j => j.contentWork!.stage === "failed");
  const rejectedIds = [...new Set(creates.flatMap(j => [...j.contentWork!.discardedArticleIds,
    ...(j.contentWork!.stage === "failed" && j.articleId ? [j.articleId] : [])]).map(String))];
  const key = (text: string, length: number) => text.toLowerCase().replace(/\d+(?:\.\d+)?/g, "#").replace(/["'`]+[^"'`]{0,80}["'`]+/g, "\"…\"")
    .replace(/\s+/g, " ").trim().slice(0, length);
  const issues = new Map<string, number>(), notes = new Map<string, number>(), scores: number[] = [];
  let found = 0;
  for (const id of rejectedIds.slice(0, 60)) {
    const summary = await ctx.db.query("article_summaries").withIndex("by_article", q => q.eq("articleId", id as Doc<"articles">["_id"])).first();
    if (!summary || summary.siteId !== siteId) continue;
    found++;
    if (typeof summary.editorialQualityScore === "number") scores.push(summary.editorialQualityScore);
    for (const issue of new Set((summary.publicationGateIssues ?? []).map(i => key(i, 110)))) issues.set(issue, (issues.get(issue) ?? 0) + 1);
    for (const note of new Set((summary.editorialQualityNotes ?? []).map(n => key(n, 90)))) notes.set(note, (notes.get(note) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([text, count]) => ({ count, text }));
  scores.sort((a, b) => a - b);
  return { days: 21, createJobs: creates.length, finished: finished.length, failedSlots: failed.length,
    passedAfterRevision: finished.filter(j => j.contentWork!.stage === "verified" && j.contentWork!.revisions > 0).length,
    replacedFirstTopic: finished.filter(j => j.contentWork!.stage === "verified" && j.contentWork!.replacements > 0).length,
    rejectedDrafts: rejectedIds.length, summariesRead: found, editorialScoreMedian: scores.length ? scores[Math.floor(scores.length / 2)] : null,
    topIssues: top(issues, 15), topNotes: top(notes, 10) };
}

/** Read-only organic health snapshot for ONE site (operator diagnostics).
 * Aggregates only: no OAuth material, no other tenant, nothing written. */
export const snapshot = internalQuery({
  args: { siteId: v.id("sites"), days: v.optional(v.number()) },
  handler: async (ctx, { siteId, days }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) throw new Error("Site not found");
    const window = Math.max(28, Math.min(days ?? 90, 180));
    const through = site.gscDataThrough ?? null;

    // Published articles and Google's index verdicts (URL Inspection, recent cohort only).
    const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "published")).take(2001))
      .filter(row => articleMatchesCurrentDomain(site, row));
    const count = (values: (string | undefined)[]) => values.reduce<Record<string, number>>((acc, value) => {
      const key = value ?? "none"; acc[key] = (acc[key] ?? 0) + 1; return acc;
    }, {});
    const month = (at?: number) => at ? new Date(at).toISOString().slice(0, 7) : "unknown";
    const inspected = summaries.filter(row => row.gscInspectedAt);
    const notIndexed = inspected.filter(row => row.gscIndexVerdict && row.gscIndexVerdict !== "PASS")
      .slice(0, 25).map(row => ({ slug: row.slug, coverage: row.gscCoverageState ?? null, verdict: row.gscIndexVerdict ?? null,
        lastCrawl: row.gscLastCrawlTime ?? null, published: month(row.publishedAt) }));
    const articles = {
      published: summaries.length,
      liveVerified: summaries.filter(row => row.publicUrlStatus === "verified").length,
      byMonth: count(summaries.map(row => month(row.publishedAt ?? row.articleCreatedAt))),
      inspected: inspected.length,
      byVerdict: count(inspected.map(row => row.gscIndexVerdict)),
      byCoverage: count(inspected.map(row => row.gscCoverageState)),
      inspectionErrors: inspected.filter(row => row.gscInspectionError).length,
      crawledAtLeastOnce: inspected.filter(row => row.gscLastCrawlTime).length,
      notIndexedSample: notIndexed,
    };

    // Autopilot's own page improvements (a slot spent improving a published
    // page near page one instead of writing a new article): what exists, what ran.
    const since = Date.now() - 60 * 86_400_000;
    const recentJobs = (await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", since)).take(501))
      .filter(job => job.contentWork);
    const editablePages = (await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501)).filter(page => page.editable);
    const improvements = {
      editablePages: editablePages.length,
      activeEditablePages: editablePages.filter(page => page.editable!.active).length,
      everImproved: editablePages.filter(page => page.editable!.lastImprovedAt).length,
      lastImprovedAt: Math.max(0, ...editablePages.map(page => page.editable!.lastImprovedAt ?? 0)) || null,
      slots60d: count(recentJobs.map(job => `${job.contentWork!.intent}:${job.contentWork!.stage}`)),
      recentImprove: recentJobs.filter(job => job.contentWork!.intent === "improve").slice(-10)
        .map(job => ({ at: job.contentWork!.deadlineAt, stage: job.contentWork!.stage, opportunity: (job.contentWork!.opportunity ?? "").slice(0, 160) })),
    };

    const gates = await improvementGates(ctx, site, editablePages, recentJobs);
    const slots = recentSlots(recentJobs);
    const quality = await qualityFailures(ctx, siteId, recentJobs);
    if (!gscConnectionMatchesCurrentDomain(site) || !through) {
      return { domain: site.domain, gscProperty: site.gscProperty ?? null, gscConnected: false, through, articles, improvements: { ...improvements, gates }, slots, quality };
    }
    const start = addSearchConsoleDays(through, -(window - 1));
    const pages = await takeCurrentGscPageRows(ctx, site, 12_000, { startDate: start, endDate: through });
    const receiptDays = new Set((site.gscDateEpochs ?? []).filter(r => r.date >= start && r.date <= through).map(r => r.date)).size;
    const articleUrls = new Set(summaries.map(row => publishedArticlePageUrl(site.domain, site.urlStructure, row.slug)));
    const byPage = new Map<string, { impressions: number; clicks: number; weighted: number }>();
    const byWeek = new Map<string, { impressions: number; clicks: number }>();
    const buckets: Record<string, number> = { "1-3": 0, "4-10": 0, "11-20": 0, "21-50": 0, "51+": 0 };
    let impressions = 0, clicks = 0, nonBrandedImpressions = 0, nonBrandedClicks = 0;
    for (const row of pages.rows) {
      impressions += row.impressions; clicks += row.clicks;
      nonBrandedImpressions += row.nonBrandedImpressions; nonBrandedClicks += row.nonBrandedClicks;
      const page = byPage.get(row.page) ?? { impressions: 0, clicks: 0, weighted: 0 };
      page.impressions += row.impressions; page.clicks += row.clicks; page.weighted += row.weightedPosition;
      byPage.set(row.page, page);
      const weekStart = addSearchConsoleDays(row.date, -((new Date(`${row.date}T00:00:00Z`).getUTCDay() + 6) % 7));
      const week = byWeek.get(weekStart) ?? { impressions: 0, clicks: 0 };
      week.impressions += row.impressions; week.clicks += row.clicks; byWeek.set(weekStart, week);
      if (row.impressions > 0) {
        const position = row.weightedPosition / row.impressions;
        const bucket = position <= 3 ? "1-3" : position <= 10 ? "4-10" : position <= 20 ? "11-20" : position <= 50 ? "21-50" : "51+";
        buckets[bucket] += row.impressions;
      }
    }
    const pageList = [...byPage.entries()].map(([page, p]) => ({ page, impressions: p.impressions, clicks: p.clicks,
      position: p.impressions ? Math.round((p.weighted / p.impressions) * 10) / 10 : null, article: articleUrls.has(page) }));
    const queriesStart = addSearchConsoleDays(through, -27);
    const queries = await takeCurrentGscQueryRows(ctx, site, 12_000, { startDate: queriesStart, endDate: through });
    const byQuery = new Map<string, { impressions: number; clicks: number; weighted: number; pages: Set<string> }>();
    for (const row of queries.rows) {
      const q = byQuery.get(row.query) ?? { impressions: 0, clicks: 0, weighted: 0, pages: new Set<string>() };
      q.impressions += row.impressions; q.clicks += row.clicks; q.weighted += row.position * row.impressions;
      if (row.page) q.pages.add(row.page);
      byQuery.set(row.query, q);
    }
    const queryList = [...byQuery.entries()].map(([query, q]) => ({ query, impressions: q.impressions, clicks: q.clicks,
      position: q.impressions ? Math.round((q.weighted / q.impressions) * 10) / 10 : null, pages: q.pages.size,
      branded: isBrandedSearchQuery(query, site.domain) }));
    return {
      domain: site.domain, gscProperty: site.gscProperty ?? null, gscConnected: true, through,
      window: { start, days: window, receiptDays, pageRowsExhausted: pages.exhausted, queryRowsExhausted: queries.exhausted },
      totals: { impressions, clicks, nonBrandedImpressions, nonBrandedClicks },
      pages: {
        withImpressions: pageList.filter(p => p.impressions > 0).length,
        articlePagesWithImpressions: pageList.filter(p => p.article && p.impressions > 0).length,
        articlePagesWithClicks: pageList.filter(p => p.article && p.clicks > 0).length,
        impressionsByPosition: buckets,
        top: pageList.sort((a, b) => b.impressions - a.impressions).slice(0, 20),
      },
      weeks: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ...w })),
      queries28: {
        distinct: queryList.length,
        withPositionUnder20: queryList.filter(q => q.position !== null && q.position <= 20).length,
        multiPageQueries: queryList.filter(q => q.pages > 1).length,
        top: queryList.sort((a, b) => b.impressions - a.impressions).slice(0, 25),
      },
      articles,
      improvements: { ...improvements, gates },
      slots,
      quality,
    };
  },
});
