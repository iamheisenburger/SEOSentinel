import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

    // Retry failed jobs (up to 3 attempts)
    const failedJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();
    
    for (const job of failedJobs) {
      const retries = (job.retries ?? 0) + 1;
      if (retries <= 3) {
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

