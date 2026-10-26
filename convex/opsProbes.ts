import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getLimitsFromFeatures } from "./planLimits";
import { autopilotPublicationConsented } from "./lib/autopilotEditor";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { publishedArticleInternalHref, relatedReadingTitle } from "./lib/internalLinks";
import { relatedReadingRepairProposal } from "./lib/contentCorrection";
import { confirmedContentProfileHash, contentConnectionHash } from "./lib/contentSelection";
import { publicRevisionProjection } from "./lib/publicRevisionProjection";

/** Operator reads for V9 (Oct 24 2026): how large the documents are that the
 * product reads most often, as byte counts, stage labels and field names only
 * (never document content). Owner sites only, one call at a time. */
const bytes = (value: unknown) => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
function jobSize(job: Doc<"jobs">, nextDeadlineAt: number) {
  const cw = job.contentWork;
  return { stage: cw?.stage ?? null, status: job.status, intent: cw?.intent ?? null, operation: cw?.operation ?? null,
    future: (cw?.deadlineAt ?? 0) >= nextDeadlineAt, bytes: bytes(job), contentWork: bytes(cw), calls: cw?.providerCalls.length ?? 0,
    inlineResults: (cw?.providerCalls ?? []).reduce((sum, call) => sum + bytes(call.result), 0),
    payload: bytes(job.payload), result: bytes(job.result) };
}

/** The documents a full-buffer scheduler pass reads (contentWork:advance). */
export const schedulerReadSizes = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  const next = site.contentSchedule?.nextDeadlineAt ?? 0;
  const seen = new Map<string, Doc<"jobs">>();
  const keep = (rows: Doc<"jobs">[]) => { for (const row of rows) seen.set(row._id, row); };
  keep(await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", next)).take(50));
  for (const status of ["pending", "running"]) keep(await ctx.db.query("jobs").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", status)).take(50));
  for (const stage of ["verify", "ready"] as const) {
    keep(await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", stage)).take(50));
  }
  const fields = Object.entries(site).map(([field, value]) => ({ field, bytes: bytes(value) })).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
  const schedule = site.contentSchedule as Record<string, unknown> | undefined;
  const scheduleFields = Object.entries(schedule ?? {}).map(([field, value]) => ({ field, bytes: bytes(value) }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  return { siteBytes: bytes(site), siteFields: fields, scheduleFields, jobs: [...seen.values()].map(job => jobSize(job, next)) };
} });

/** What an article-preparation pass reads besides jobs: every page of the site
 * (chooseImprovement), the topic inventory (chooseTopic) and up to 3,000 Search
 * Console rows. Totals and the largest fields, per table, one table a call. */
export const siteTableSizes = internalQuery({ args: { siteId: v.id("sites"),
  table: v.union(v.literal("pages"), v.literal("topic_clusters"), v.literal("search_performance")) },
  handler: async (ctx, { siteId, table }) => {
    const rows: Record<string, unknown>[] = table === "pages"
      ? await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501)
      : table === "topic_clusters"
        ? await ctx.db.query("topic_clusters").withIndex("by_site", q => q.eq("siteId", siteId)).take(2001)
        : await ctx.db.query("search_performance").withIndex("by_site", q => q.eq("siteId", siteId)).take(3000);
    const fieldBytes = new Map<string, number>();
    for (const row of rows) for (const [field, value] of Object.entries(row)) {
      if (field === "editable" && value && typeof value === "object") {
        for (const [inner, innerValue] of Object.entries(value)) fieldBytes.set(`editable.${inner}`, (fieldBytes.get(`editable.${inner}`) ?? 0) + bytes(innerValue));
      } else fieldBytes.set(field, (fieldBytes.get(field) ?? 0) + bytes(value));
    }
    return { rows: rows.length, bytes: rows.reduce((sum, row) => sum + bytes(row), 0),
      largestFields: [...fieldBytes.entries()].map(([field, total]) => ({ field, bytes: total })).sort((a, b) => b.bytes - a.bytes).slice(0, 8) };
  } });

/** One page of a site's content jobs this month (what the usage recount reads):
 * totals only, split at P118 (Oct 20 2026), when provider results moved out of
 * job documents. */
export const monthJobSizes = internalQuery({ args: { siteId: v.id("sites"), monthStart: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { siteId, monthStart, cursor }) => {
    const page = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", monthStart))
      .paginate({ numItems: 16, cursor });
    const sizes = page.page.map(job => ({ ...jobSize(job, Number.MAX_SAFE_INTEGER), createdAt: job.createdAt }));
    return { isDone: page.isDone, continueCursor: page.continueCursor, jobs: sizes.length, bytes: sizes.reduce((s, j) => s + j.bytes, 0),
      inlineResults: sizes.reduce((s, j) => s + j.inlineResults, 0), largest: Math.max(0, ...sizes.map(j => j.bytes)),
      byIntent: sizes.reduce<Record<string, number>>((m, j) => ({ ...m, [`${j.intent}`]: (m[`${j.intent}`] ?? 0) + 1 }), {}) };
  } });

/** V8 (Oct 25 2026): where new customers' sites stand, fleet-wide, as counts
 * only (never a domain, account or article): how many sites were added since
 * a time and how far each got through setup to its first article. Real users
 * arrived from distribution; a step where they stop shows here first. */
export const signupFunnel = internalQuery({ args: { since: v.number() }, handler: async (ctx, { since }) => {
  const sites = await ctx.db.query("sites").withIndex("by_creation_time", q => q.gte("_creationTime", since)).take(500);
  const counts = { sites: sites.length, accounts: new Set(sites.map(site => site.userId).filter(Boolean)).size, removed: 0, freePlan: 0, paidPlan: 0,
    profileRead: 0, contentServiceChosen: 0, autopilotChosen: 0, publishesAutomatically: 0, reviewFirst: 0, destinationVerified: 0,
    searchConsole: 0, workStarted: 0, articleWaiting: 0, articlePublished: 0, planActive: 0, pasteChosen: 0 };
  // P184: which website each verified destination is, and whether the account's plan lets "Start Pentra" run.
  const publishMethods: Record<string, number> = {}, verifiedDestinations: Record<string, number> = {};
  // P198: how far GitHub sites got through connecting, by presence only (never a value). New sites default to
  // GitHub, so "github" in publishMethods includes owners who never chose a platform: "connectStarted" tells them apart.
  const github = { sites: 0, connectStarted: 0, accountConnected: 0, repositoryChosen: 0, verified: 0 };
  const has = async (siteId: Id<"sites">, status: string) =>
    (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", status)).take(1)).length > 0;
  for (const site of sites) {
    if (site.deletionStatus || site.planParkedAt) { counts.removed++; continue; }
    if (getLimitsFromFeatures(site.planFeatures ?? []).maxArticles <= 3) counts.freePlan++; else counts.paidPlan++;
    if (site.siteSummary?.trim()) counts.profileRead++;
    if (site.serviceMode === "growth_first") counts.contentServiceChosen++;
    if (site.contentSchedule?.autopilotSelectedAt) counts.autopilotChosen++;
    if (autopilotPublicationConsented(site)) counts.publishesAutomatically++;
    if (site.approvalRequired || site.contentSchedule?.ownerReviewedOnly) counts.reviewFirst++;
    const receipt = site.publisherDestinationReceipt;
    if (receipt) {
      counts.destinationVerified++;
      const kind = receipt.status === "verified" ? receipt.method : `${receipt.method} (${receipt.status})`;
      verifiedDestinations[kind] = (verifiedDestinations[kind] ?? 0) + 1;
    }
    if (site.publishMethod === "manual") counts.pasteChosen++;
    const entitlement = site.userId ? await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique() : null;
    if (entitlement?.status === "completed" && await siteExecutionAuthorized(ctx, site)) counts.planActive++;
    if (site.gscProperty) counts.searchConsole++;
    const method = site.publishMethod ?? "none";
    publishMethods[method] = (publishMethods[method] ?? 0) + 1;
    if (method === "github") {
      github.sites++;
      const account = Boolean(site.githubToken), repository = Boolean(site.repoOwner && site.repoName);
      if (account || repository || receipt) github.connectStarted++;
      if (account) github.accountConnected++;
      if (repository) github.repositoryChosen++;
      if (receipt?.method === "github" && receipt.status === "verified") github.verified++;
    }
    if ((await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(1)).length) counts.workStarted++;
    if (await has(site._id, "published")) counts.articlePublished++;
    else if (await has(site._id, "ready") || await has(site._id, "review")) counts.articleWaiting++;
  }
  // P202: accounts that opened the dashboard since then (Pentra records their contact) and how many never added a site.
  const contactRows = await ctx.db.query("account_contacts").withIndex("by_creation_time", q => q.gte("_creationTime", since)).take(500);
  const contacts = { since: contactRows.length, withoutSite: 0 };
  for (const contact of contactRows) {
    if (!(await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", contact.userId)).first())) contacts.withoutSite++;
  }
  return { since, ...counts, publishMethods, verifiedDestinations, github, contacts };
} });

/** P191 (Oct 25 2026): why Autopilot's Related reading repair (P176/P180) left a
 * published article with cut link titles. pentra.dev's pass ended with 4 cut
 * titles on 3 pages untouched. Owner sites only: slugs, counts and reasons,
 * never content. The live text is the article with its delivered revisions. */
export const relatedRepairBlockers = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "published")).take(2001))
    .filter(row => articleMatchesCurrentDomain(site, row));
  const titles = new Map<string, string>();
  for (const row of summaries) {
    try { titles.set(publishedArticleInternalHref(site.urlStructure, row.slug), row.title); } catch { /* an unsafe slug links nowhere */ }
  }
  const pages = new Map((await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(1001))
    .map(page => [page.slug.replace(/^\/+|\/+$/g, ""), page] as const));
  const cutCount = (proposal: { before: string; replacement: string }) => {
    const before = proposal.before.split("\n"), after = proposal.replacement.split("\n");
    return before.filter((line, i) => line !== after[i]).length;
  };
  const blocked: Array<{ slug: string; cuts: number; reason: string }> = [];
  for (const row of summaries) {
    const article = await ctx.db.get(row.articleId);
    const live = article ? await publicRevisionProjection(ctx, site, article) : null;
    if (!live?.markdown) continue;
    const proposal = relatedReadingRepairProposal(live.markdown, titles, relatedReadingTitle);
    if (!proposal) continue;
    const page = pages.get(row.slug.replace(/^\/+|\/+$/g, "")), e = page?.editable;
    const reason = !page ? "no_page" : !e ? "not_enrolled" : !e.active ? "enrollment_inactive" : e.kind !== "github" ? `not_github_${e.kind}`
      : e.profileHash !== confirmedContentProfileHash(site) || e.connectionHash !== contentConnectionHash(site) ? "enrollment_stale"
      : !relatedReadingRepairProposal(e.markdown, titles, relatedReadingTitle) ? "enrolled_source_differs" : "repairable";
    blocked.push({ slug: row.slug, cuts: cutCount(proposal), reason });
  }
  return { published: summaries.length, blocked };
} });
