import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { publishedArticlePageUrl } from "./lib/searchPerformance";

const publishedArticlePageUrlOrNull = (domain: string, urlStructure: string | undefined, slug: string) => {
  try { return publishedArticlePageUrl(domain, urlStructure, slug); } catch { return null; }
};


export const siteForCheck = internalQuery({ args: { siteId: v.id("sites"), userId: v.optional(v.string()) },
  handler: async (ctx, { siteId, userId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || (userId !== undefined && site.userId !== userId)) return null;
    const latest = await ctx.db.query("site_health_checks").withIndex("by_site_checked", q => q.eq("siteId", siteId)).order("desc").first();
    const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(50);
    // Newest published articles on the current domain, for the discovery pass.
    const published = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "published"))
      .order("desc").take(60)).filter(row => row.publishedAt && articleMatchesCurrentDomain(site, row));
    const articles = published.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 25).flatMap(row => {
      const url = row.publicUrl?.startsWith("https://") ? row.publicUrl : publishedArticlePageUrlOrNull(site.domain, site.urlStructure, row.slug);
      return url ? [{ url, publishedAt: row.publishedAt! }] : [];
    });
    return { domain: site.domain, lastCheckedAt: latest?.checkedAt ?? null, knownUrls: pages.map(p => p.url).filter(Boolean) as string[],
      ctaUrl: site.ctaUrl?.startsWith("https://") ? site.ctaUrl : null, articles };
  } });

export const record = internalMutation({ args: { siteId: v.id("sites"), score: v.number(), error: v.optional(v.string()),
  pages: v.array(v.object({ url: v.string(), status: v.number(), title: v.optional(v.string()),
    issues: v.array(v.object({ code: v.string(), severity: v.union(v.literal("critical"), v.literal("warning")), message: v.string() })) })) },
  handler: async (ctx, args) => { await ctx.db.insert("site_health_checks", { ...args, checkedAt: Date.now() }); } });

export const latest = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity(), site: Doc<"sites"> | null = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject) return null;
  return await ctx.db.query("site_health_checks").withIndex("by_site_checked", q => q.eq("siteId", siteId)).order("desc").first();
} });

/** Weekly checks for sites on the content service. Bounded fan-out. */
export const scheduleWeekly = internalMutation({ args: {}, handler: async (ctx) => {
  const sites = await ctx.db.query("sites").order("desc").take(500); // newest first
  let scheduled = 0;
  for (const site of sites) {
    if (site.serviceMode !== "growth_first" || !site.contentSchedule || site.deletionStatus) continue;
    // Only sites set up through the new Pentra setup, or whose owner has
    // already run a check, are checked automatically. Nothing else is touched.
    if (!site.contentSchedule.autopilotSelectedAt && !(await ctx.db.query("site_health_checks")
      .withIndex("by_site_checked", q => q.eq("siteId", site._id)).first())) continue;
    await ctx.scheduler.runAfter(scheduled * 20_000, internal.actions.siteHealth.runInternal, { siteId: site._id });
    scheduled++;
  }
  return { scheduled };
} });
