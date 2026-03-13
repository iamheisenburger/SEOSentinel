import { mutation } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

const now = () => Date.now();

export const queuePlanGeneration = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    // Check if there's already a running plan job for this site
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const alreadyRunning = existing.find(
      (j) => j.type === "plan" && (j.status === "pending" || j.status === "running"),
    );
    if (alreadyRunning) {
      throw new Error("Topic generation is already in progress for this site.");
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "plan",
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    });

    // Schedule immediate processing via generatePlan with jobId for progress tracking
    await ctx.scheduler.runAfter(0, api.actions.pipeline.generatePlan, { siteId, jobId });

    return jobId;
  },
});
