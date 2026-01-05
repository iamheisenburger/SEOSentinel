"use node";

import { api } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";

export const scheduleCadence = action({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<{ scheduled: number }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const cadence = site.cadencePerWeek ?? 4;
    
    // Check how many articles are already in progress or scheduled
    const pendingJobs = await ctx.runQuery(api.jobs.listByStatus, { status: "pending" });
    const runningJobs = await ctx.runQuery(api.jobs.listByStatus, { status: "running" });
    const existingArticles = [...pendingJobs, ...runningJobs].filter(j => j.siteId === siteId && j.type === "article");
    
    if (existingArticles.length >= cadence) {
      console.log(`Cadence reached: ${existingArticles.length} articles already in progress/pending.`);
      return { scheduled: 0 };
    }

    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const available = topics
      .filter(
        (t: { status?: string }) => t.status !== "used" && t.status !== "queued",
      )
      .slice(0, cadence - existingArticles.length);

    for (const topic of available) {
      await ctx.runMutation(api.jobs.create, {
        siteId,
        type: "article",
        payload: { topicId: topic._id },
      });
      await ctx.runMutation(api.topics.updateStatus, {
        topicId: topic._id,
        status: "queued",
      });
    }

    return { scheduled: available.length };
  },
});

