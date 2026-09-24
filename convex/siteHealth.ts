import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { analyzePageHealth, healthScore, sitemapUrls, type PageHealthResult } from "./lib/siteHealth";

const MAX_PAGES = 10, TIMEOUT_MS = 10_000, MAX_BYTES = 1_500_000, MIN_INTERVAL_MS = 10 * 60_000;

async function fetchPage(url: string): Promise<{ status: number; finalUrl: string; html: string; robots: string | null }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal,
      headers: { "user-agent": "PentraSiteHealth/1.0 (+https://pentra.dev)", accept: "text/html,application/xhtml+xml,application/xml" } });
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.length; chunks.push(value);
      if (size >= MAX_BYTES) { await reader.cancel(); break; }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk.subarray(0, Math.min(chunk.length, size - offset)), offset); offset += chunk.length; }
    return { status: response.status, finalUrl: response.url || url, html: new TextDecoder().decode(bytes), robots: response.headers.get("x-robots-tag") };
  } catch { return { status: 0, finalUrl: url, html: "", robots: null }; }
  finally { clearTimeout(timer); }
}

export const siteForCheck = internalQuery({ args: { siteId: v.id("sites"), userId: v.optional(v.string()) },
  handler: async (ctx, { siteId, userId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || (userId !== undefined && site.userId !== userId)) return null;
    const latest = await ctx.db.query("site_health_checks").withIndex("by_site_checked", q => q.eq("siteId", siteId)).order("desc").first();
    const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(50);
    return { domain: site.domain, lastCheckedAt: latest?.checkedAt ?? null, knownUrls: pages.map(p => p.url).filter(Boolean) as string[] };
  } });

export const record = internalMutation({ args: { siteId: v.id("sites"), score: v.number(), error: v.optional(v.string()),
  pages: v.array(v.object({ url: v.string(), status: v.number(), title: v.optional(v.string()),
    issues: v.array(v.object({ code: v.string(), severity: v.union(v.literal("critical"), v.literal("warning")), message: v.string() })) })) },
  handler: async (ctx, args) => { await ctx.db.insert("site_health_checks", { ...args, checkedAt: Date.now() }); } });

async function runCheck(ctx: ActionCtx, siteId: Id<"sites">, userId?: string) {
  const site = await ctx.runQuery(internal.siteHealth.siteForCheck, { siteId, userId });
  if (!site) throw new ConvexError("Website not found");
  if (site.lastCheckedAt && Date.now() - site.lastCheckedAt < MIN_INTERVAL_MS) return { skipped: true as const };
  const host = site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const home = `https://${host}/`;
  const urls = [home];
  const sitemap = await fetchPage(`https://${host}/sitemap.xml`);
  if (sitemap.status > 0 && sitemap.status < 400) for (const url of sitemapUrls(sitemap.html, host, MAX_PAGES)) if (!urls.includes(url)) urls.push(url);
  for (const url of site.knownUrls) if (urls.length < MAX_PAGES && url.startsWith("https://") && !urls.includes(url)) urls.push(url);
  const results: PageHealthResult[] = [];
  for (const url of urls.slice(0, MAX_PAGES)) {
    const page = await fetchPage(url);
    results.push(analyzePageHealth({ url, status: page.status, finalUrl: page.finalUrl, html: page.html, robotsHeader: page.robots }));
  }
  const pages = results.map(r => ({ url: r.url, status: r.status, ...(r.title ? { title: r.title.slice(0, 200) } : {}), issues: r.issues }));
  const score = healthScore(results);
  await ctx.runMutation(internal.siteHealth.record, { siteId, score, pages,
    ...(results[0]?.status === 0 ? { error: "Pentra couldn't reach your homepage over HTTPS." } : {}) });
  return { skipped: false as const, score };
}

/** Owner-triggered check (rate limited). */
export const run = action({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first");
  return runCheck(ctx, siteId, identity.subject);
} });

/** Scheduled check for automatic service. */
export const runInternal = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => runCheck(ctx, siteId) });

export const latest = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity(), site: Doc<"sites"> | null = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject) return null;
  return await ctx.db.query("site_health_checks").withIndex("by_site_checked", q => q.eq("siteId", siteId)).order("desc").first();
} });

/** Weekly checks for sites on the content service. Bounded fan-out. */
export const scheduleWeekly = internalMutation({ args: {}, handler: async (ctx) => {
  const sites = await ctx.db.query("sites").take(500);
  let scheduled = 0;
  for (const site of sites) {
    if (site.serviceMode !== "growth_first" || !site.contentSchedule || site.deletionStatus) continue;
    // Only sites set up through the new Pentra setup, or whose owner has
    // already run a check, are checked automatically. Nothing else is touched.
    if (!site.contentSchedule.autopilotSelectedAt && !(await ctx.db.query("site_health_checks")
      .withIndex("by_site_checked", q => q.eq("siteId", site._id)).first())) continue;
    await ctx.scheduler.runAfter(scheduled * 20_000, internal.siteHealth.runInternal, { siteId: site._id });
    scheduled++;
  }
  return { scheduled };
} });
