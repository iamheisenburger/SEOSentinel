/** P400: rendering an answer video. Pentra's render route on Vercel (src/app/api/video-render) claims one render with its
 * ticket (random, single use, minutes old at most): it gets what to draw and a one-time upload address, renders the MP4 in
 * a Vercel Sandbox, uploads it here and reports back. Nothing else is reachable with a ticket. */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { businessOf } from "./answers";

const TICKET_TTL_MS = 15 * 60_000;
export const RENDER_COMPOSITIONS: Record<string, string> = { landscape: "AnswerVideo", vertical: "AnswerVideoVertical" };
const FALLBACK_ACCENT = "#3DA5F5";

export const createRender = internalMutation({ args: { videoId: v.id("answer_videos"), ticket: v.string(), format: v.union(v.literal("landscape"), v.literal("vertical")) },
  handler: async (ctx, { videoId, ticket, format }) => {
    const video = await ctx.db.get(videoId);
    if (!video?.scenes?.length) return null;
    return await ctx.db.insert("answer_video_renders", { siteId: video.siteId, videoId, ticket, format, status: "queued", createdAt: Date.now() });
  } });

export const renderState = internalQuery({ args: { ticket: v.string() }, handler: async (ctx, { ticket }) => {
  const row = await ctx.db.query("answer_video_renders").withIndex("by_ticket", (q) => q.eq("ticket", ticket)).first();
  return row ? { status: row.status, error: row.error ?? null, storageId: row.storageId ?? null } : null;
} });

/** The render route's first call: what to draw, with readable addresses for the voices and screenshot, and where to upload. */
export const claim = mutation({ args: { ticket: v.string() }, handler: async (ctx, { ticket }) => {
  const row = await ctx.db.query("answer_video_renders").withIndex("by_ticket", (q) => q.eq("ticket", ticket)).first();
  if (!row || row.status !== "queued" || Date.now() - row.createdAt > TICKET_TTL_MS) throw new ConvexError("This render ticket isn't valid.");
  const video = await ctx.db.get(row.videoId);
  const site = video ? await ctx.db.get(video.siteId) : null;
  if (!video?.scenes?.length || !site) throw new ConvexError("This video can't be rendered.");
  const business = businessOf(site);
  const scenes = await Promise.all(video.scenes.map(async (s) => ({ kind: s.kind, heading: s.heading, items: s.items, emphasis: s.emphasis, narration: s.narration,
    audioSrc: await ctx.storage.getUrl(s.audioId), audioMs: s.audioMs })));
  await ctx.db.patch(row._id, { status: "rendering", claimedAt: Date.now() });
  return {
    compositionId: RENDER_COMPOSITIONS[row.format] ?? "AnswerVideo",
    inputProps: { brand: { name: business.name, domain: business.domain, accent: video.theme?.accent ?? video.accent ?? FALLBACK_ACCENT,
      ...(video.theme ? { theme: video.theme } : {}) },
      screenshotSrc: video.screenshotId ? await ctx.storage.getUrl(video.screenshotId) : null, scenes },
    uploadUrl: await ctx.storage.generateUploadUrl(),
  };
} });

/** The render route's last call: the uploaded MP4 (or why it failed), recorded on the video. */
export const finish = mutation({ args: { ticket: v.string(), storageId: v.optional(v.id("_storage")), error: v.optional(v.string()) },
  handler: async (ctx, { ticket, storageId, error }) => {
    const row = await ctx.db.query("answer_video_renders").withIndex("by_ticket", (q) => q.eq("ticket", ticket)).first();
    if (!row || row.status !== "rendering") throw new ConvexError("This render ticket isn't valid.");
    const now = Date.now();
    if (!storageId) {
      await ctx.db.patch(row._id, { status: "failed", error: (error ?? "The render failed.").slice(0, 300), finishedAt: now });
      return;
    }
    const meta = await ctx.db.system.get(storageId);
    if (!meta || !/^video\//.test(meta.contentType ?? "")) {
      await ctx.db.patch(row._id, { status: "failed", error: "The rendered file isn't a video.", finishedAt: now });
      return;
    }
    await ctx.db.patch(row._id, { status: "done", storageId, finishedAt: now });
    const video = await ctx.db.get(row.videoId);
    if (!video) return;
    await ctx.db.patch(video._id, row.format === "vertical" ? { verticalId: storageId, updatedAt: now }
      : { landscapeId: storageId, status: video.status === "rendering" ? "ready" : video.status, error: undefined, updatedAt: now });
  } });
