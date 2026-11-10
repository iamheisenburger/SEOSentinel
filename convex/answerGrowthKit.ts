/** Get named, part two (P398): the screen's comparison pages, answer videos and directory listings, and the owner's
 * buttons for each. Every model call runs in convex/actions/answerGrowthKit.ts with spend held first; nothing is posted,
 * uploaded or submitted without the owner. */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
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

/** P405: a video's look (the business's background, text, accent and font). */
const themeValue = v.object({ mode: v.string(), background: v.string(), text: v.string(), muted: v.string(), surface: v.string(), line: v.string(),
  accent: v.string(), accentInk: v.string(), emphasis: v.string(), font: v.string() });

/** The rivals the answers recommend whose own site they cite, most-named first. */
function rivalsFrom(site: Doc<"sites">, checks: readonly Doc<"answer_checks">[]) {
  const answered = checks.filter((c) => c.status === "answered");
  return rivalPairs(recommendedInstead(answered, businessOf(site), 25), sourceMap(checks, [], 200).map((s) => s.domain), site.domain, 6);
}
const recentChecks = (ctx: QueryCtx, siteId: Id<"sites">) =>
  ctx.db.query("answer_checks").withIndex("by_site_asked", (q) => q.eq("siteId", siteId).gte("askedAt", Date.now() - WINDOW_MS)).take(800);

/** A comparison page started for one rival (shared by the owner's button and the daily work). */
async function startComparison(ctx: MutationCtx, site: Doc<"sites">, name: string, domain: string) {
  const rivalDomain = hostOf(domain);
  const rivalName = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!rivalName || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rivalDomain) || rivalDomain === hostOf(site.domain)) throw new ConvexError("That competitor's name or address doesn't look right.");
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id)).take(1000);
  if (pages.some((p) => p.comparisonWith && hostOf(p.comparisonWith.domain) === rivalDomain && LIVE_PAGE.has(p.status))) throw new ConvexError("That comparison page already exists.");
  const thisMonth = pages.filter((p) => p.createdAt >= monthStart()).length;
  if (thisMonth >= ANSWER_PAGES_PER_MONTH + 5) throw new ConvexError(`This month's ${ANSWER_PAGES_PER_MONTH} pages are written. More next month.`);
  const business = businessOf(site);
  const question = `${business.name} vs ${rivalName}`;
  const now = Date.now();
  // The page's question is never asked: a question naming the business would count it as named in every answer.
  const questionId = await ctx.db.insert("answer_questions", { siteId: site._id, question, key: `${questionKey(question)} comparison`, intent: "comparison",
    source: "comparison", status: "removed", createdAt: now });
  const pageId = await ctx.db.insert("answer_pages", { siteId: site._id, questionId, question, status: "writing", title: question,
    slug: uniqueSlug(question, new Set(pages.map((p) => p.slug))), metaDescription: "", markdown: "", facts: [], sources: [], issues: [], version: 1, contentHash: "",
    writerModel: "", costMicroUsd: 0, createdAt: now, updatedAt: now, citations: 0, comparisonWith: { name: rivalName, domain: rivalDomain } });
  await ctx.db.patch(questionId, { pageId });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.writeComparison, { pageId });
  return pageId;
}

/** An answer video started for one question (shared by the owner's button and the daily work). */
async function startVideo(ctx: MutationCtx, siteId: Id<"sites">, question: string) {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 8) throw new ConvexError("Pick a question for the video.");
  const videos = await ctx.db.query("answer_videos").withIndex("by_site", (x) => x.eq("siteId", siteId)).take(400);
  if (videos.filter((x) => x.status === "writing" || x.status === "rendering").length >= 3) throw new ConvexError("Three videos are being made. Start another when one is ready.");
  if (videos.filter((x) => x.createdAt >= monthStart()).length >= VIDEOS_PER_MONTH) throw new ConvexError(`This month's ${VIDEOS_PER_MONTH} videos are made. More next month.`);
  const now = Date.now();
  const videoId = await ctx.db.insert("answer_videos", { siteId, question: q, status: "writing", version: 2, createdAt: now, updatedAt: now, costMicroUsd: 0 });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.makeVideoKit, { videoId });
  return videoId;
}

/** The directory listing written (shared by the owner's button and the daily work). */
async function startListingKit(ctx: MutationCtx, siteId: Id<"sites">) {
  const kitId = await ctx.db.insert("answer_listing_kits", { siteId, status: "writing", createdAt: Date.now(), costMicroUsd: 0 });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.makeListingKit, { kitId });
  return kitId;
}

/** P403, done for the owner every day (from the hourly dispatcher, after the day's preparation): the listing written once,
 * one new comparison page a day until the three most-recommended rivals have one, and one video a week for the question
 * whose answers lean most on video. Anything that can't start today is simply tried tomorrow. */
export const autoWork = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !answersEnabled(site)) return { started: [] as string[] };
  const started: string[] = [];
  const now = Date.now();
  const kit = await ctx.db.query("answer_listing_kits").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").first();
  if (!kit || (kit.status === "failed" && now - kit.createdAt > 86_400_000)) { await startListingKit(ctx, siteId); started.push("listing"); }
  const checks = await recentChecks(ctx, siteId);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(1000);
  const compared = pages.filter((p) => p.comparisonWith && p.status !== "not_written");
  if (compared.length < 3) {
    const next = rivalsFrom(site, checks).find((r) => !pages.some((p) => p.comparisonWith && hostOf(p.comparisonWith.domain) === r.domain));
    if (next) { try { await startComparison(ctx, site, next.name, next.domain); started.push(`comparison:${next.domain}`); } catch { /* tomorrow */ } }
  }
  const videos = await ctx.db.query("answer_videos").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(400);
  const lastVideo = Math.max(0, ...videos.filter((x) => x.status !== "failed").map((x) => x.createdAt));
  if (now - lastVideo >= 7 * 86_400_000) {
    const made = new Set(videos.map((x) => x.question));
    const next = videoQuestions(checks.filter((c) => c.status === "answered"), 20).find((q) => !made.has(q.question));
    if (next) { try { await startVideo(ctx, siteId, next.question); started.push("video"); } catch { /* tomorrow */ } }
  }
  return { started };
} });

export const extras = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedSite(ctx, siteId);
  if (!site) return null;
  const checks = await recentChecks(ctx, siteId);
  const answered = checks.filter((c) => c.status === "answered");
  const business = businessOf(site);
  const sources = sourceMap(checks, [], 200);
  const rivals = rivalsFrom(site, checks);
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
    videos: await Promise.all(videos.map(async (x) => {
      const renders = x.version === 2 ? await ctx.db.query("answer_video_renders").withIndex("by_video", (q) => q.eq("videoId", x._id)).order("desc").take(6) : [];
      const vertical = renders.find((r) => r.format === "vertical");
      return { videoId: x._id, question: x.question, status: x.status, version: x.version ?? 1, title: x.title ?? null, description: x.description ?? null,
        tags: x.tags ?? [], youtubeUrl: x.youtubeUrl ?? null, error: x.error ?? null, createdAt: x.createdAt,
        durationMs: x.scenes ? x.scenes.reduce((n, sc) => n + sc.audioMs, 0) : x.durationMs ?? null,
        landscapeUrl: x.landscapeId ? await ctx.storage.getUrl(x.landscapeId) : null, verticalUrl: x.verticalId ? await ctx.storage.getUrl(x.verticalId) : null,
        verticalState: x.verticalId ? "done" : vertical?.status ?? null, verticalError: vertical?.status === "failed" ? vertical.error ?? null : null };
    })),
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
  return { pageId: await startComparison(ctx, site, name, domain) };
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
  return { videoId: await startVideo(ctx, siteId, question) };
} });

export const setVideo = mutation({ args: { videoId: v.id("answer_videos"), status: v.union(v.literal("ready"), v.literal("uploaded"), v.literal("skipped")),
  youtubeUrl: v.optional(v.string()) }, handler: async (ctx, { videoId, status, youtubeUrl }) => {
  const video = await ctx.db.get(videoId);
  if (!video || !(await ownedSite(ctx, video.siteId))) throw new ConvexError("This video isn't yours.");
  if (video.status === "writing" || video.status === "rendering" || video.status === "failed") throw new ConvexError("This video isn't made yet.");
  const url = youtubeUrl?.trim();
  if (url && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/.test(url)) throw new ConvexError("Paste the video's YouTube address.");
  await ctx.db.patch(videoId, { status, updatedAt: Date.now(), ...(status === "uploaded" && url ? { youtubeUrl: url.slice(0, 300) } : {}) });
} });

/** The vertical cut for Shorts and Reels, rendered on request (each render uses Pentra's render allowance). */
export const makeVertical = mutation({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  if (!video || !(await ownedSite(ctx, video.siteId))) throw new ConvexError("This video isn't yours.");
  if (video.version !== 2 || !video.landscapeId) throw new ConvexError("Make the video first.");
  if (video.verticalId) return { ok: true };
  const recent = await ctx.db.query("answer_video_renders").withIndex("by_video", (q) => q.eq("videoId", videoId)).order("desc").first();
  if (recent && recent.format === "vertical" && (recent.status === "queued" || recent.status === "rendering")) throw new ConvexError("The Shorts version is rendering.");
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.renderFormat, { videoId, format: "vertical" });
  return { ok: true };
} });

/** A video that failed: rendered again from its scenes, or made again from the start when it has none. */
export const retryVideo = mutation({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  if (!video || !(await ownedSite(ctx, video.siteId))) throw new ConvexError("This video isn't yours.");
  if (video.status !== "failed" && video.version === 2) throw new ConvexError("This video isn't failed.");
  const now = Date.now();
  if (video.version === 2 && video.scenes?.length) {
    await ctx.db.patch(videoId, { status: "rendering", error: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.renderFormat, { videoId, format: "landscape" });
  } else {
    await ctx.db.patch(videoId, { status: "writing", version: 2, error: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.makeVideoKit, { videoId });
  }
  return { ok: true };
} });

export const saveVideoScenes = internalMutation({ args: { videoId: v.id("answer_videos"), title: v.string(), description: v.string(), tags: v.array(v.string()),
  scenes: v.array(v.object({ kind: v.string(), heading: v.string(), items: v.array(v.string()), emphasis: v.array(v.string()), narration: v.string(),
    audioId: v.id("_storage"), audioMs: v.number() })), screenshotId: v.optional(v.id("_storage")), accent: v.optional(v.string()), theme: v.optional(themeValue),
  costMicroUsd: v.number() },
  handler: async (ctx, { videoId, ...kit }) => {
    const video = await ctx.db.get(videoId);
    if (!video || video.status !== "writing") return;
    await ctx.db.patch(videoId, { ...kit, version: 2, status: "rendering", updatedAt: Date.now() });
  } });

export const videoLookState = internalQuery({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  const site = video ? await ctx.db.get(video.siteId) : null;
  if (!video || !site) return null;
  return { domain: hostOf(site.domain), screenshotId: video.screenshotId ?? null, hasTheme: Boolean(video.theme) };
} });

export const saveVideoLook = internalMutation({ args: { videoId: v.id("answer_videos"), theme: themeValue }, handler: async (ctx, { videoId, theme }) => {
  const video = await ctx.db.get(videoId);
  if (video) await ctx.db.patch(videoId, { theme, accent: theme.accent, updatedAt: Date.now() });
} });

/** P405: a made video rendered again in the business's look as its site shows it now (both formats it has). */
export const rerenderVideo = mutation({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const video = await ctx.db.get(videoId);
  if (!video || !(await ownedSite(ctx, video.siteId))) throw new ConvexError("This video isn't yours.");
  if (video.version !== 2 || !video.scenes?.length || !["ready", "uploaded", "skipped"].includes(video.status)) throw new ConvexError("This video can't be rendered again yet.");
  await ctx.db.patch(videoId, { status: "rendering", updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowthKit.rerender, { videoId, vertical: Boolean(video.verticalId) });
  return { ok: true };
} });

export const renderFailed = internalMutation({ args: { videoId: v.id("answer_videos"), format: v.string(), error: v.string() }, handler: async (ctx, { videoId, format, error }) => {
  const video = await ctx.db.get(videoId);
  if (!video || format !== "landscape" || video.status !== "rendering") return;
  await ctx.db.patch(videoId, { status: "failed", error: error.slice(0, 300), updatedAt: Date.now() });
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

export const failVideo = internalMutation({ args: { videoId: v.id("answer_videos"), error: v.string(), costMicroUsd: v.number() }, handler: async (ctx, { videoId, error, costMicroUsd }) => {
  const video = await ctx.db.get(videoId);
  if (!video || (video.status !== "writing" && video.status !== "rendering")) return;
  await ctx.db.patch(videoId, { status: "failed", error: error.slice(0, 300), costMicroUsd, updatedAt: Date.now() });
} });

// ── Directory listings ──

export const makeListingKit = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  await requireSite(ctx, siteId);
  const last = await ctx.db.query("answer_listing_kits").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").first();
  if (last && Date.now() - last.createdAt < 3_600_000 && last.status !== "failed") throw new ConvexError("The listing was written less than an hour ago.");
  return { kitId: await startListingKit(ctx, siteId) };
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
