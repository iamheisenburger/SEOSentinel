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

    // Schedule exactly 1 article at a time, using strategic topic selection
    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const available = topics.filter(
      (t: { status?: string }) => t.status !== "used" && t.status !== "queued",
    );

    if (available.length === 0) {
      console.log("No available topics to schedule.");
      return { scheduled: 0 };
    }

    // Sort by priority (highest first)
    available.sort(
      (a: { priority?: number }, b: { priority?: number }) =>
        (b.priority ?? 1) - (a.priority ?? 1),
    );

    // Get last 5 published articles to avoid keyword overlap (reuse allArticles from above)
    const recentSlugs = allArticles.slice(0, 5);
    const recentKeywords = new Set<string>();
    for (const art of recentSlugs) {
      // Extract keywords from slug (e.g. "/subscription-budget-tracker" → ["subscription", "budget", "tracker"])
      const words = art.slug.replace(/^\//, "").split("-");
      for (const w of words) {
        if (w.length > 3) recentKeywords.add(w.toLowerCase());
      }
    }

    // Pick the highest-priority topic that doesn't overlap with recent articles
    let selectedTopic = available[0]; // fallback to highest priority
    for (const topic of available) {
      const kwWords = topic.primaryKeyword.toLowerCase().split(/\s+/);
      const overlapCount = kwWords.filter((w: string) => w.length > 3 && recentKeywords.has(w)).length;
      const overlapRatio = kwWords.length > 0 ? overlapCount / kwWords.length : 0;

      // Accept if less than 50% of keyword words overlap with recent articles
      if (overlapRatio < 0.5) {
        selectedTopic = topic;
        break;
      }
    }

    await ctx.runMutation(api.jobs.create, {
      siteId,
      type: "article",
      payload: { topicId: selectedTopic._id },
    });
    await ctx.runMutation(api.topics.updateStatus, {
      topicId: selectedTopic._id,
      status: "queued",
    });

    console.log(`Scheduled topic: "${selectedTopic.primaryKeyword}" (priority ${selectedTopic.priority ?? "?"}). Next in ${hoursPerArticle}h.`);
    return { scheduled: 1 };
  },
});

