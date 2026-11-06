/** Images for articles published without one (Nov 2026). Autopilot published no image from Aug 27 to Nov 5 (its jobs ran
 * with images off); new articles carry one again (pipeline.ts reviewPlannedArticle). For the ones already live, the paid
 * step (convex/actions/articleImages.ts, run on the owner's yes) makes an image per article, most-seen in Search Console
 * first, and records it here; the live-page repair chain (contentImprovements.requestRelatedReadingRepair) then adds it
 * above the article's first paragraph, one page at a time, through the exact correction path. */
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { siteExecutionActive } from "./lib/planSiteAllowance";
import { takeCurrentGscQueryRows } from "./lib/currentGscRows";
import { refreshWindowStart } from "./lib/articleRefresh";
import { servedOnItsOwnUrl } from "./lib/pentraConsolidation";
import { firstPlainParagraph } from "./lib/contentCorrection";
import { mergedSlugs } from "./siteRedirects";
import { releaseSharedProviderReservation, reserveSharedProviderBudget, settleSharedProviderReservation } from "./lib/providerSpendReservation";

const pageKey = (url: string) => url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** The site's own articles that show no image and can take one above a plain first paragraph, most impressions first. */
export const candidates = internalQuery({ args: { siteId: v.id("sites"), limit: v.number() }, handler: async (ctx, { siteId, limit }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !siteExecutionActive(site) || !site.userId || site.deletionStatus) return null;
  const pages = await ctx.db.query("pages").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(501);
  const merged = await mergedSlugs(ctx, siteId);
  const prepared = new Set((await ctx.db.query("article_images").withIndex("by_site_page", (q) => q.eq("siteId", siteId)).take(1000)).map((r) => r.pageId));
  const shown = new Map<string, number>();
  const windowStart = refreshWindowStart((site.gscDateEpochs ?? []).map((receipt) => receipt.date));
  try {
    const { rows } = await takeCurrentGscQueryRows(ctx, site, 3000, windowStart ? { startDate: windowStart } : undefined);
    for (const r of rows) if (r.page) shown.set(pageKey(r.page), (shown.get(pageKey(r.page)) ?? 0) + r.impressions);
  } catch { /* no Search Console: the order is the pages' own */ }
  const eligible = pages.flatMap((page) => {
    const e = page.editable;
    if (!e?.active || e.kind !== "github" || !e.managedArticleId || prepared.has(page._id) || !servedOnItsOwnUrl(site.domain, page.slug, merged) ||
      /!\[[^\]]*\]\(|<img\b/i.test(e.markdown) || firstPlainParagraph(e.markdown) === null) return [];
    return [{ pageId: page._id, url: page.url, title: e.title, impressions: shown.get(pageKey(page.url)) ?? 0 }];
  }).sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url));
  return { userId: site.userId, niche: site.niche ?? "", brandingPrompt: site.imageBrandingPrompt ?? undefined, brandColor: site.brandPrimaryColor ?? undefined,
    total: eligible.length, pages: eligible.slice(0, Math.max(0, Math.floor(limit))) };
} });

export const reserve = internalMutation({ args: { siteId: v.id("sites"), reservedMicroUsd: v.number() }, handler: async (ctx, { siteId, reservedMicroUsd }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.userId) return { ok: false as const, reason: "no_owner" };
  const reserved = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId, purpose: "media_backfill", trigger: `media_backfill:${Date.now()}`,
    reservedMicroUsd, timestamp: Date.now() });
  return reserved.ok ? { ok: true as const, reservationId: reserved.reservationId } : { ok: false as const, reason: String(reserved.reason) };
} });

/** Settled at what the images cost (an image whose answer was lost counts at its ceiling), or released when none was made. */
export const close = internalMutation({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations"), actualMicroUsd: v.number() },
  handler: async (ctx, { siteId, reservationId, actualMicroUsd }) => {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.siteId !== siteId || reservation.purpose !== "media_backfill" ||
      reservation.settledAt !== undefined || reservation.releasedAt !== undefined) return;
    const actual = Math.max(0, Math.round(actualMicroUsd));
    if (actual === 0) {
      await releaseSharedProviderReservation(ctx, { reservationId, siteId, purpose: "media_backfill", reason: "plan_cancelled_before_execution", timestamp: Date.now() });
      return;
    }
    if (!Number.isSafeInteger(actual) || actual > reservation.reservedMicroUsd) return;
    await settleSharedProviderReservation(ctx, { reservationId, siteId, purpose: "media_backfill", actualMicroUsd: actual,
      reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  } });

export const record = internalMutation({ args: { siteId: v.id("sites"), pageId: v.id("pages"), url: v.string(), alt: v.string(), costMicroUsd: v.number() },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || page.siteId !== args.siteId) return null;
    const existing = await ctx.db.query("article_images").withIndex("by_site_page", (q) => q.eq("siteId", args.siteId).eq("pageId", args.pageId)).first();
    if (existing) return existing._id;
    const id = await ctx.db.insert("article_images", { siteId: args.siteId, pageId: args.pageId, url: args.url, alt: args.alt.slice(0, 200),
      status: "ready", costMicroUsd: args.costMicroUsd, createdAt: Date.now() });
    await bringRepairForward(ctx, args.siteId);
    return id;
  } });

/** P358 (Nov 5 2026): a prepared image brings the live-page repair round forward. The round that visits every page had
 * finished, clean, before any image existed, so the next one was a week away and no image reached its page. The
 * round's own rules still hold (one page every two hours, never close to a publishing slot). */
export async function bringRepairForward(ctx: MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId), schedule = site?.contentSchedule, now = Date.now();
  // During a round, this carries to its end and starts the next one, so a page the round already passed gets its image too.
  if (!schedule || (schedule.relatedRepairRetryAt !== undefined && schedule.relatedRepairRetryAt <= now)) return;
  await ctx.db.patch(siteId, { contentSchedule: { ...schedule, relatedRepairRetryAt: now } });
}

/** For images prepared before P358: brings the repair round forward and starts it. */
export const queueImageRepairs = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const ready = (await ctx.db.query("article_images").withIndex("by_site_page", (q) => q.eq("siteId", siteId)).take(1000)).filter((r) => r.status === "ready").length;
  if (!ready) return { ready: 0 };
  await bringRepairForward(ctx, siteId);
  await ctx.scheduler.runAfter(0, internal.contentImprovements.requestRelatedReadingRepair, { siteId });
  return { ready };
} });
