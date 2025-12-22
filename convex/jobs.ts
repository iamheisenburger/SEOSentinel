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
export const resetStuckJobs = mutation({
  handler: async (ctx) => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const runningJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    
    let reset = 0;
    for (const job of runningJobs) {
      if (job.updatedAt < tenMinutesAgo) {
        await ctx.db.patch(job._id, { 
          status: "pending", 
          updatedAt: Date.now(),
          error: "Reset from stuck running state"
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

