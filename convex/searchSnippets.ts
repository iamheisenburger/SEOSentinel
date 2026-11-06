/** Phase 3 (Nov 2026): search title tests (convex/lib/searchSnippet.ts). The weekly diagnosis reads which of the site's own
 * articles may get one (`context`) and writes the new titles (`propose`); Autopilot's repair round places each on its page
 * through the exact correction path (contentImprovements.requestRelatedReadingRepair), checked live; four weeks later the
 * diagnosis judges it by clicks (`decide`): kept, or the old title comes back the same way. Rollout sites only. */
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { siteExecutionActive } from "./lib/planSiteAllowance";
import { servedOnItsOwnUrl } from "./lib/pentraConsolidation";
import { isApiCmsMethod } from "./lib/cmsDestinations";
import { topicChoiceRollout } from "./lib/topicVerdict";
import { SNIPPET_RETEST_DAYS } from "./lib/searchSnippet";
import { mergedSlugs } from "./siteRedirects";
import { bringRepairForward } from "./articleImages";

const DAY = 86_400_000;
/** A GitHub site's tests go through the repair round (spaced: each change is a deploy); every other platform's are placed by
 * contentImprovements.requestSnippetTests (P370). */
async function placeTests(ctx: MutationCtx, site: Doc<"sites">) {
  if ((site.publishMethod ?? "github") === "github") await bringRepairForward(ctx, site._id);
  else await ctx.scheduler.runAfter(0, internal.contentImprovements.requestSnippetTests, { siteId: site._id });
}
const snippet = v.object({ metaTitle: v.string(), description: v.string() });
const measure = v.object({ clicks: v.number(), impressions: v.number(), expectedClicks: v.number(), position: v.number(), days: v.number() });

/** A page Pentra may give a new search title: its own article (written by Autopilot or adopted as Pentra's), served on its
 * own address, enrolled under the site's current connection and profile, on a platform whose title the correction path
 * can change (GitHub, Ghost, Shopify, Webflow). */
function testable(site: Doc<"sites">, page: Doc<"pages">, merged: ReadonlySet<string>): boolean {
  const e = page.editable;
  return Boolean(e?.active && (e.managedArticleId || e.origin === "published_refresh") && (e.kind === "github" || isApiCmsMethod(e.kind)) &&
    servedOnItsOwnUrl(site.domain, page.slug, merged));
}

/** What the weekly run needs: the pages that may get a test now (none tested in SNIPPET_RETEST_DAYS, none waiting), and
 * the tests placed earlier with whether they went live (their job verified) or failed. */
export const context = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !siteExecutionActive(site) || site.deletionStatus || !topicChoiceRollout(site.domain)) return null;
  const [pages, tests, merged] = await Promise.all([
    ctx.db.query("pages").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(501),
    ctx.db.query("search_snippets").withIndex("by_site_page", (q) => q.eq("siteId", siteId)).take(2000),
    mergedSlugs(ctx, siteId)]);
  const now = Date.now();
  const recent = new Set(tests.filter((t) => ["ready", "queued"].includes(t.status) || now - t.createdAt < SNIPPET_RETEST_DAYS * DAY).map((t) => t.pageId));
  const eligible = pages.filter((p) => testable(site, p, merged) && !recent.has(p._id)).map((p) => ({ pageId: p._id, url: p.url }));
  const placed = [];
  for (const t of tests.filter((row) => row.status === "queued")) {
    const job = t.jobId ? await ctx.db.get(t.jobId) : null, cw = job?.contentWork;
    placed.push({ id: t._id, url: t.url, restore: Boolean(t.restoreOf), baseline: t.baseline,
      liveAt: cw?.stage === "verified" ? cw.verifiedAt ?? null : null, failed: !job || cw?.stage === "failed" });
  }
  return { domain: site.domain, eligible, placed };
} });

/** The chosen pages' current title, description, headline and opening, for writing their new titles. */
export const pageDetails = internalQuery({ args: { siteId: v.id("sites"), pageIds: v.array(v.id("pages")) }, handler: async (ctx, { siteId, pageIds }) => {
  const out = [];
  for (const id of pageIds.slice(0, 5)) {
    const page = await ctx.db.get(id), e = page?.editable;
    if (!page || page.siteId !== siteId || !e?.active) continue;
    out.push({ pageId: page._id, url: page.url, title: e.title, metaTitle: e.metaTitle, description: e.description, markdown: e.markdown.slice(0, 20_000) });
  }
  return out;
} });

/** Records the week's new titles, each for a page that still carries the title it was written against and has no test
 * waiting, and brings the repair round forward so they go live this week. */
export const propose = internalMutation({ args: { siteId: v.id("sites"), proposals: v.array(v.object({ pageId: v.id("pages"), url: v.string(), query: v.string(),
  before: snippet, after: snippet, baseline: measure, costMicroUsd: v.number() })) },
  handler: async (ctx, { siteId, proposals }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus || !topicChoiceRollout(site.domain)) return { added: 0 };
    const now = Date.now();
    let added = 0;
    for (const p of proposals.slice(0, 5)) {
      const page = await ctx.db.get(p.pageId), e = page?.editable;
      if (!page || page.siteId !== siteId || !e?.active || e.metaTitle !== p.before.metaTitle || e.description !== p.before.description) continue;
      const waiting = (await ctx.db.query("search_snippets").withIndex("by_site_page", (q) => q.eq("siteId", siteId).eq("pageId", p.pageId)).take(50))
        .some((t) => ["ready", "queued"].includes(t.status));
      if (waiting) continue;
      await ctx.db.insert("search_snippets", { siteId, pageId: p.pageId, url: p.url, query: p.query.slice(0, 200), status: "ready",
        before: p.before, after: p.after, baseline: p.baseline, costMicroUsd: Math.max(0, Math.round(p.costMicroUsd)), createdAt: now, updatedAt: now });
      added++;
    }
    // Tests still waiting (Autopilot was off, or a page was busy) are offered again with the week's new ones.
    const waiting = added > 0 || (await ctx.db.query("search_snippets").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "ready")).first()) !== null;
    if (waiting) await placeTests(ctx, site);
    return { added };
  } });

/** The week's verdicts: a test that failed to go live is set aside; a restore that went live is done; a test judged by
 * its clicks is kept, or restored (a new test row that puts the old title back, placed the same way). */
export const decide = internalMutation({ args: { siteId: v.id("sites"), decisions: v.array(v.object({ id: v.id("search_snippets"),
  outcome: v.union(v.literal("keep"), v.literal("restore"), v.literal("failed"), v.literal("restored_live")), liveAt: v.optional(v.number()),
  after: v.optional(measure), ratioBefore: v.optional(v.number()), ratioAfter: v.optional(v.number()) })) },
  handler: async (ctx, { siteId, decisions }) => {
    const now = Date.now();
    let restores = 0;
    for (const d of decisions) {
      const t = await ctx.db.get(d.id);
      if (!t || t.siteId !== siteId || t.status !== "queued") continue;
      if (d.outcome === "failed") { await ctx.db.patch(t._id, { status: "skipped", note: "Its change did not go live; the page keeps its title", updatedAt: now }); continue; }
      if (d.outcome === "restored_live") { await ctx.db.patch(t._id, { status: "kept", liveAt: d.liveAt, note: "The old title is back", updatedAt: now }); continue; }
      if (!d.after || d.ratioBefore === undefined || d.ratioAfter === undefined) continue;
      const verdict = { decidedAt: now, outcome: d.outcome === "keep" ? "kept" as const : "restored" as const, clicks: d.after.clicks,
        impressions: d.after.impressions, expectedClicks: d.after.expectedClicks, ratioBefore: d.ratioBefore, ratioAfter: d.ratioAfter };
      await ctx.db.patch(t._id, { status: verdict.outcome, liveAt: d.liveAt, verdict, updatedAt: now });
      if (d.outcome === "restore") {
        await ctx.db.insert("search_snippets", { siteId, pageId: t.pageId, url: t.url, query: t.query, status: "ready", before: t.after, after: t.before,
          baseline: d.after, restoreOf: t._id, note: `${d.after.clicks} clicks from ${d.after.impressions} impressions with the new title, against ${t.baseline.clicks} from ${t.baseline.impressions} before`,
          costMicroUsd: 0, createdAt: now, updatedAt: now });
        restores++;
      }
    }
    const site = await ctx.db.get(siteId);
    if (restores && site) await placeTests(ctx, site);
    return { restores };
  } });

/** The owner's view (and the weekly email's): the latest tests, newest first. */
export async function recentSnippetTests(ctx: QueryCtx, siteId: Id<"sites">, limit = 20): Promise<Doc<"search_snippets">[]> {
  const rows = await ctx.db.query("search_snippets").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(500);
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export const listForSite = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity(), site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject) return [];
  return (await recentSnippetTests(ctx, siteId)).map((t) => ({ url: t.url, query: t.query, status: t.status, before: t.before, after: t.after,
    restore: Boolean(t.restoreOf), liveAt: t.liveAt ?? null, verdict: t.verdict ?? null, createdAt: t.createdAt }));
} });
