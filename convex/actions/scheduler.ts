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
    const hoursPerArticle = Math.floor((7 * 24) / cadence); // 42 hours for 4/week, 24 hours for 7/week

    // Check how many articles are already in progress or scheduled
    const pendingJobs = await ctx.runQuery(api.jobs.listByStatus, { status: "pending" });
    const runningJobs = await ctx.runQuery(api.jobs.listByStatus, { status: "running" });
    const existingArticles = [...pendingJobs, ...runningJobs].filter(j => j.siteId === siteId && j.type === "article");

    // Get the most recent published article to check timing
    const allArticles = await ctx.runQuery(api.articles.listBySite, { siteId });
    const lastPublished = allArticles.length > 0 ? allArticles[0] : null;
    const now = Date.now();
    const hoursSinceLastPublish = lastPublished
      ? (now - lastPublished.createdAt) / (1000 * 60 * 60)
      : 999;

    // If there are pending/running jobs OR we published recently, don't schedule more
    if (existingArticles.length > 0) {
      console.log(`Jobs already queued: ${existingArticles.length} pending/running.`);
      return { scheduled: 0 };
    }

    if (hoursSinceLastPublish < hoursPerArticle) {
      console.log(`Too soon since last publish (${Math.floor(hoursSinceLastPublish)}h ago, need ${hoursPerArticle}h).`);
      return { scheduled: 0 };
    }

    // Schedule exactly 1 article at a time
    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const available = topics
      .filter(
        (t: { status?: string }) => t.status !== "used" && t.status !== "queued",
      )
      .slice(0, 1); // Only schedule 1 at a time

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

    console.log(`Scheduled ${available.length} article(s). Next will schedule in ${hoursPerArticle}h.`);
    return { scheduled: available.length };
  },
});

