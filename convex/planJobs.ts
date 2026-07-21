import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const now = () => Date.now();

export const queuePlanGeneration = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to generate a plan for this site");
    }
    // Check if there's already a running plan job for this site
    const existing = (
      await Promise.all(
        ["pending", "running"].map((status) =>
          ctx.db
            .query("jobs")
            .withIndex("by_site_status", (q) =>
              q.eq("siteId", siteId).eq("status", status),
            )
            .collect(),
        ),
      )
    ).flat();
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
      payload: { manual: true, reason: "owner_requested_plan" },
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    // Schedule immediate processing via generatePlan with jobId for progress tracking
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.generatePlanInternal, { siteId, jobId });

    return jobId;
  },
});
