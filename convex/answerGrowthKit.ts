/** Get named, part two (P398): the screen's comparison pages, answer videos and directory listings, and the owner's
 * buttons for each. Every model call runs in convex/actions/answerGrowthKit.ts with spend held first; nothing is posted,
 * uploaded or submitted without the owner. */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { answersEnabled } from "./lib/answersAccess";
import { hostOf, questionKey, recommendedInstead } from "./lib/answerEngine";
import { sourceMap } from "./lib/answerGrowth";
import { directoryPlan, rivalPairs, videoQuestions, type BusinessKind } from "./lib/growthKit";
import { uniqueSlug } from "./lib/answerPages";
import { ANSWER_PAGES_PER_MONTH } from "./answerPages";
import { businessOf } from "./answers";

const WINDOW_MS = 14 * 86_400_000;
const LIVE_PAGE = new Set(["writing", "draft", "publishing", "published", "publish_failed"]);
/** Videos a site may have made in a month (each about 15 cents of script, voice and screenshot). */
export const VIDEOS_PER_MONTH = 30;

async function ownedSite(ctx: QueryCtx, siteId: Id<"sites">): Promise<Doc<"sites"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const site = await ctx.db.get(siteId);
  return site && site.userId === identity.subject && answersEnabled(site) ? site : null;
}
async function requireSite(ctx: QueryCtx, siteId: Id<"sites">) {
  const site = await ownedSite(ctx, siteId);
  if (!site) throw new ConvexError("This site isn't yours, or it doesn't run Pentra Answers.");
  return site;
}
const monthStart = () => Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);

export const extras = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedSite(ctx, siteId);
  if (!site) return null;
  const checks = await ctx.db.query("answer_checks").withIndex("by_site_asked", (q) => q.eq("siteId", siteId).gte("askedAt", Date.now() - WINDOW_MS)).take(800);
  const answered = checks.filter((c) => c.status === "answered");
  const business = businessOf(site);
  const sources = sourceMap(checks, [], 200);
  const rivals = rivalPairs(recommendedInstead(answered, business, 25), sources.map((s) => s.domain), site.domain, 6);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(600);
  const comparisons = rivals.map((r) => {
    const page = pages.filter((p) => p.comparisonWith && hostOf(p.comparisonWith.domain) === r.domain).sort((a, b) => b.createdAt - a.createdAt)[0];
    return { ...r, page: page ? { pageId: page._id, status: page.status, title: page.title, publishedUrl: page.publishedUrl ?? null, reason: page.notWrittenReason ?? null } : null };
  });
  const videos = await ctx.db.query("answer_videos").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").take(30);
  const made = new Set(videos.map((x) => x.question));
  const kit = await ctx.db.query("answer_listing_kits").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").first();
  const statuses = await ctx.db.query("answer_listings").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(200);
  const byDomain = new Map(statuses.map((s) => [s.domain, s]));
  const kind = (kit?.status === "ready" ? kit.kind : null) as BusinessKind | null;
  const directories = directoryPlan(kind, business.country ?? null, sources.filter((s) => s.kind === "directory").map((s) => ({ domain: s.domain, answers: s.answers })))
    .map((d) => ({ ...d, status: byDomain.get(d.domain)?.status ?? "todo", liveUrl: byDomain.get(d.domain)?.liveUrl ?? null }));
  return {
    business: { name: business.name, domain: business.domain },
    comparisons,
    videoSuggestions: videoQuestions(answered, 10).filter((q) => !made.has(q.question)).slice(0, 5),
    videos: videos.map((x) => ({ videoId: x._id, question: x.question, status: x.status, title: x.title ?? null, description: x.description ?? null, tags: x.tags ?? [],
      youtubeUrl: x.youtubeUrl ?? null, error: x.error ?? null, durationMs: x.durationMs ?? null, createdAt: x.createdAt })),
    listing: {
      kit: kit ? { status: kit.status, error: kit.error ?? null, kind: kit.kind ?? null, fields: kit.status === "ready" ? {
        tagline: kit.tagline ?? "", shortDescription: kit.shortDescription ?? "", longDescription: kit.longDescription ?? "", categories: kit.categories ?? [],
        features: kit.features ?? [], useCases: kit.useCases ?? [], pricing: kit.pricing ?? "", audience: kit.audience ?? "", faqs: kit.faqs ?? [] } : null,
        createdAt: kit.createdAt } : null,
      directories,
      counts: { live: directories.filter((d) => d.status === "live").length, submitted: directories.filter((d) => d.status === "submitted").length, total: directories.length },
    },
  };
} });

// ── Comparison pages ──

export const writeComparison = mutation({ args: { siteId: v.id("sites"), name: v.string(), domain: v.string() }, handler: async (ctx, { siteId, name, domain }) => {
  const site = await requireSite(ctx, siteId);
  const rivalDomain = hostOf(domain);
  const rivalName = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!rivalName || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rivalDomain) || rivalDomain === hostOf(site.domain)) throw new ConvexError("That competitor's name or address doesn't look right.");
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(1000);
  if (pages.some((p) => p.comparisonWith && hostOf(p.comparisonWith.domain) === rivalDomain && LIVE_PAGE.has(p.status))) throw new ConvexError("That comparison page already exists.");
  const thisMonth = pages.filter((p) => p.createdAt >= monthStart()).length;
  if (thisMonth >= ANSWER_PAGES_PER_MONTH + 5) throw new ConvexError(`This month's ${ANSWER_PAGES_PER_MONTH} pages are written. More next month.`);
  const business = businessOf(site);
  const question = `${business.name} vs ${rivalName}`;
  const now = Date.now();
  // The page's question is never asked: a question naming the business would count it as named in every answer.
  const questionId = await ctx.db.insert("answer_questions", { siteId, question, key: `${questionKey(question)} comparison`, intent: "comparison", source: "comparison",
    status: "removed", createdAt: now });
  const pageId = await ctx.db.insert("answer_pages", { siteId, questionId, question, status: "writing", title: question, slug: uniqueSlug(question, new Set(pages.map((p) => p.slug))),
    metaDescription: "", markdown: "", facts: [], sources: [], issues: [], version: 1, contentHash: "", writerModel: "", costMicroUsd: 0, createdAt: now, updatedAt: now,
    citations: 0, comparisonWith: { name: rivalName, domain: rivalDomain } });
  await ctx.db.patch(questionId, { pageId });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.writeComparison, { pageId });
  return { pageId };
} });

export const comparisonContext = internalQuery({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  if (!page || page.status !== "writing" || !page.comparisonWith) return null;
  const site = await ctx.db.get(page.siteId);
  if (!site || !answersEnabled(site)) return null;
  const business = businessOf(site);
  const autopublish = site.answers?.autopublish !== false && Boolean(site.answers?.confirmedAt);
  return { pageId, siteId: site._id, rival: page.comparisonWith, autopublish,
    business: { name: business.name, domain: business.domain, summary: site.siteSummary ?? "", features: site.keyFeatures ?? [], pricing: site.pricingInfo ?? "",
      ctaText: site.ctaText ?? "", ctaUrl: site.ctaUrl ?? "", language: site.language ?? "en",
      market: [site.answers?.local && site.answers.location ? site.answers.location : "", site.targetCountry ?? business.country].filter(Boolean).join(", ") },
    competitors: business.competitors.filter((c) => !c.domain || hostOf(c.domain) !== hostOf(page.comparisonWith!.domain)).map((c) => ({ name: c.name, ...(c.domain ? { domain: c.domain } : {}) })) };
} });

// ── Answer videos ──

export const makeVideo = mutation({ args: { siteId: v.id("sites"), question: v.string() }, handler: async (ctx, { siteId, question }) => {
  await requireSite(ctx, siteId);
  const q = question.replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 8) throw new ConvexError("Pick a question for the video.");
  const videos = await ctx.db.query("answer_videos").withIndex("by_site", (x) => x.eq("siteId", siteId)).take(400);
  if (videos.filter((x) => x.status === "writing").length >= 3) throw new ConvexError("Three videos are being made. Start another when one is ready.");
  if (videos.filter((x) => x.createdAt >= monthStart()).length >= VIDEOS_PER_MONTH) throw new ConvexError(`This month's ${VIDEOS_PER_MONTH} videos are made. More next month.`);
  const now = Date.now();
  const videoId = await ctx.db.insert("answer_videos", { siteId, question: q, status: "writing", createdAt: now, updatedAt: now, costMicroUsd: 0 });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.makeVideoKit, { videoId });
  return { videoId };
} });

export const setVideo = mutation({ args: { videoId: v.id("answer_videos"), status: v.union(v.literal("ready"), v.literal("uploaded"), v.literal("skipped")),
  youtubeUrl: v.optional(v.string()) }, handler: async (ctx, { videoId, status, youtubeUrl }) => {
  const video = await ctx.db.get(videoId);
  if (!video || !(await ownedSite(ctx, video.siteId))) throw new ConvexError("This video isn't yours.");
  if (video.status === "writing" || video.status === "failed") throw new ConvexError("This video isn't made yet.");
  const url = youtubeUrl?.trim();
  if (url && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/.test(url)) throw new ConvexError("Paste the video's YouTube address.");
  await ctx.db.patch(videoId, { status, updatedAt: Date.now(), ...(status === "uploaded" && url ? { youtubeUrl: url.slice(0, 300) } : {}) });
} });

/** Everything the owner's browser needs to assemble one video: the script, the voice and the screenshot. */
export const videoKit = query({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  const site = video ? await ownedSite(ctx, video.siteId) : null;
  if (!video || !site || !video.segments || !video.audioId) return null;
  const business = businessOf(site);
  return { videoId, question: video.question, title: video.title ?? video.question, description: video.description ?? "", tags: video.tags ?? [],
    segments: video.segments, productSegment: video.productSegment ?? -1, durationMs: video.durationMs ?? null,
    audioUrl: await ctx.storage.getUrl(video.audioId), screenshotUrl: video.screenshotId ? await ctx.storage.getUrl(video.screenshotId) : null,
    business: { name: business.name, domain: business.domain } };
} });

export const videoContext = internalQuery({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  if (!video || video.status !== "writing") return null;
  const site = await ctx.db.get(video.siteId);
  if (!site || !answersEnabled(site)) return null;
  const business = businessOf(site);
  return { videoId, siteId: site._id, question: video.question,
    business: { name: business.name, domain: business.domain, summary: site.siteSummary ?? "", features: site.keyFeatures ?? [], pricing: site.pricingInfo ?? "",
      ctaText: site.ctaText ?? "", ctaUrl: site.ctaUrl ?? "" } };
} });

export const saveVideoKit = internalMutation({ args: { videoId: v.id("answer_videos"), title: v.string(), description: v.string(), tags: v.array(v.string()),
  segments: v.array(v.object({ heading: v.string(), lines: v.array(v.string()), narration: v.string() })), productSegment: v.number(),
  audioId: v.id("_storage"), screenshotId: v.optional(v.id("_storage")), durationMs: v.number(), costMicroUsd: v.number() }, handler: async (ctx, { videoId, ...kit }) => {
  const video = await ctx.db.get(videoId);
  if (!video || video.status !== "writing") return;
  await ctx.db.patch(videoId, { ...kit, status: "ready", updatedAt: Date.now() });
} });

export const failVideo = internalMutation({ args: { videoId: v.id("answer_videos"), error: v.string(), costMicroUsd: v.number() }, handler: async (ctx, { videoId, error, costMicroUsd }) => {
  const video = await ctx.db.get(videoId);
  if (!video || video.status !== "writing") return;
  await ctx.db.patch(videoId, { status: "failed", error: error.slice(0, 300), costMicroUsd, updatedAt: Date.now() });
} });

// ── Directory listings ──

export const makeListingKit = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  await requireSite(ctx, siteId);
  const last = await ctx.db.query("answer_listing_kits").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").first();
  if (last && Date.now() - last.createdAt < 3_600_000 && last.status !== "failed") throw new ConvexError("The listing was written less than an hour ago.");
  const kitId = await ctx.db.insert("answer_listing_kits", { siteId, status: "writing", createdAt: Date.now(), costMicroUsd: 0 });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.makeListingKit, { kitId });
  return { kitId };
} });

export const setListing = mutation({ args: { siteId: v.id("sites"), domain: v.string(), name: v.string(),
  status: v.union(v.literal("todo"), v.literal("submitted"), v.literal("live"), v.literal("skipped")), liveUrl: v.optional(v.string()) },
  handler: async (ctx, { siteId, domain, name, status, liveUrl }) => {
    await requireSite(ctx, siteId);
    const d = hostOf(domain);
    const url = liveUrl?.trim();
    if (url && !/^https:\/\/\S+$/.test(url)) throw new ConvexError("Paste the listing's address, starting with https://");
    const row = await ctx.db.query("answer_listings").withIndex("by_site_domain", (q) => q.eq("siteId", siteId).eq("domain", d)).first();
    const patch = { status, name: name.slice(0, 80), updatedAt: Date.now(), ...(status === "live" && url ? { liveUrl: url.slice(0, 500) } : {}) };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("answer_listings", { siteId, domain: d, ...patch });
  } });

export const listingContext = internalQuery({ args: { kitId: v.id("answer_listing_kits") }, handler: async (ctx, { kitId }) => {
  const kit = await ctx.db.get(kitId);
  if (!kit || kit.status !== "writing") return null;
  const site = await ctx.db.get(kit.siteId);
  if (!site || !answersEnabled(site)) return null;
  const business = businessOf(site);
  const checks = await ctx.db.query("answer_checks").withIndex("by_site_asked", (q) => q.eq("siteId", site._id).gte("askedAt", Date.now() - WINDOW_MS)).take(800);
  return { kitId, siteId: site._id, alternativesTo: recommendedInstead(checks, business, 6).map((r) => r.name),
    business: { name: business.name, domain: business.domain, summary: site.siteSummary ?? "", features: site.keyFeatures ?? [], pricing: site.pricingInfo ?? "",
      ctaText: site.ctaText ?? "", ctaUrl: site.ctaUrl ?? "" } };
} });

export const saveListingKit = internalMutation({ args: { kitId: v.id("answer_listing_kits"), kind: v.string(), tagline: v.string(), shortDescription: v.string(),
  longDescription: v.string(), categories: v.array(v.string()), features: v.array(v.string()), useCases: v.array(v.string()), pricing: v.string(), audience: v.string(),
  faqs: v.array(v.object({ q: v.string(), a: v.string() })), costMicroUsd: v.number() }, handler: async (ctx, { kitId, ...kit }) => {
  const row = await ctx.db.get(kitId);
  if (!row || row.status !== "writing") return;
  await ctx.db.patch(kitId, { ...kit, status: "ready" });
} });

export const failListingKit = internalMutation({ args: { kitId: v.id("answer_listing_kits"), error: v.string(), costMicroUsd: v.number() }, handler: async (ctx, { kitId, error, costMicroUsd }) => {
  const row = await ctx.db.get(kitId);
  if (!row || row.status !== "writing") return;
  await ctx.db.patch(kitId, { status: "failed", error: error.slice(0, 300), costMicroUsd });
} });
