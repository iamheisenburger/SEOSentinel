import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "./planLimits";

const now = () => Date.now();

export const listPending = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

export const listAll = query({
  handler: async (ctx) => {
    return await ctx.db.query("jobs").order("desc").take(50);
  },
});

export const listByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, { status }) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
  },
});

// Reset jobs that have been "running" for more than 10 minutes (likely timed out)
// Also retry failed jobs (up to 3 attempts)
export const resetStuckJobs = mutation({
  handler: async (ctx) => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    let reset = 0;

    // Reset stuck "running" jobs
    const runningJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    
    for (const job of runningJobs) {
      if (job.updatedAt < tenMinutesAgo) {
        const retries = (job.retries ?? 0) + 1;
        if (retries <= 3) {
          await ctx.db.patch(job._id, { 
            status: "pending", 
            updatedAt: Date.now(),
            retries,
            error: `Reset from stuck running state (attempt ${retries})`
          });
          reset++;
        }
      }
    }

    // Retry recently failed jobs (up to 3 attempts, only if failed < 30min ago)
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    const failedJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();

    // Permanent errors that should NOT be retried
    const permanentErrors = ["Topic not found", "Site not found", "Article limit reached", "Permanently killed", "Cleaned up"];

    for (const job of failedJobs) {
      const retries = (job.retries ?? 0) + 1;
      const isPermanent = permanentErrors.some(e => (job.error ?? "").includes(e));
      const isRecent = job.updatedAt > thirtyMinutesAgo;
      if (retries <= 3 && !isPermanent && isRecent) {
        await ctx.db.patch(job._id, {
          status: "pending",
          updatedAt: Date.now(),
          retries,
          error: `Retrying after failure (attempt ${retries})`
        });
        reset++;
      }
    }

    return { reset };
  },
});

export const create = mutation({
  args: {
    siteId: v.optional(v.id("sites")),
    type: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, type, payload }) => {
    return await ctx.db.insert("jobs", {
      siteId,
      type,
      status: "pending",
      payload,
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

export const markRunning = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ctx.db.patch(jobId, { status: "running", updatedAt: now() });
  },
});

export const markDone = mutation({
  args: { jobId: v.id("jobs"), result: v.optional(v.any()) },
  handler: async (ctx, { jobId, result }) => {
    await ctx.db.patch(jobId, {
      status: "done",
      result,
      updatedAt: now(),
    });
  },
});

export const markFailed = mutation({
  args: { jobId: v.id("jobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    await ctx.db.patch(jobId, {
      status: "failed",
      error,
      updatedAt: now(),
    });
  },
});

export const updateProgress = mutation({
  args: {
    jobId: v.id("jobs"),
    current: v.number(),
    total: v.number(),
    stepLabel: v.string(),
    topicLabel: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, current, total, stepLabel, topicLabel }) => {
    await ctx.db.patch(jobId, {
      stepProgress: { current, total, stepLabel, topicLabel },
      updatedAt: now(),
    });
  },
});

export const getRunningBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    return (
      jobs.find((j) => j.status === "running" && j.type === "article") ?? null
    );
  },
});

/**
 * Create an article job and immediately schedule autopilotTick to process it.
 * Clients call this instead of invoking generateArticle directly — avoids
 * WebSocket timeout errors on long-running actions.
 */
export const queueArticleNow = mutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
  },
  handler: async (ctx, { siteId, topicId }) => {
    // ── Article quota check (uses immutable usage_log — survives deletions) ──
    const site = await ctx.db.get(siteId);
    if (site?.userId) {
      const features = (site as any).planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);

      // Count from usage_log (immutable — deletions cannot reduce count)
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartMs = monthStart.getTime();

      const logs = await ctx.db
        .query("usage_log")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", site.userId!).eq("type", "article_generated"),
        )
        .collect();
      const articlesThisMonth = logs.filter(
        (l) => l.createdAt >= monthStartMs,
      ).length;

      if (articlesThisMonth >= limits.maxArticles) {
        throw new Error(
          `Article limit reached (${limits.maxArticles}/month). Upgrade your plan for more articles.`,
        );
      }

      // ── Site over-limit check (downgrade protection) ──
      const userSites = await ctx.db
        .query("sites")
        .withIndex("by_user", (q) => q.eq("userId", site.userId!))
        .collect();
      if (userSites.length > limits.maxSites) {
        throw new Error(
          `You have ${userSites.length} sites but your plan allows ${limits.maxSites}. Remove excess sites or upgrade to continue.`,
        );
      }
    }

    // Create the pending job
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId: topicId ?? undefined, manual: true },
      createdAt: now(),
      updatedAt: now(),
    });

    // Mark topic as queued if provided
    if (topicId) {
      await ctx.db.patch(topicId, { status: "queued" });
    }

    // Schedule autopilotTick to run immediately in the background
    // The action runs server-side regardless of client connection
    await ctx.scheduler.runAfter(0, api.actions.pipeline.autopilotTick, { siteId });

    return jobId;
  },
});

