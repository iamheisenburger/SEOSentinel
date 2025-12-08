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

