"use node";

import { api } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { getLimitsFromFeatures, ALL_FEATURE_KEYS } from "../planLimits";

export const scheduleCadence = action({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<{ scheduled: number }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    // ── Article quota check ──
    // If the site has an owner, enforce monthly article limit
    if (site.userId) {
      // We don't have Clerk session in cron context, so we check plan
      // limits based on features stored on the user. For now, use the
      // simple approach: count articles this month vs plan limit.
      const articlesThisMonth = await ctx.runQuery(api.articles.countThisMonth, {
        userId: site.userId,
      });
      // Determine plan limits from the site's planFeatures (set during onboarding/sync)
      const features = (site as any).planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);
      if (articlesThisMonth >= limits.maxArticles) {
        console.log(
          `Article quota reached: ${articlesThisMonth}/${limits.maxArticles} this month. Skipping.`,
        );
        return { scheduled: 0 };
      }

      // ── Site over-limit check (downgrade protection) ──
      const allUserSites = await ctx.runQuery(api.sites.listAllForAutopilot);
      const userSiteCount = allUserSites.filter((s) => s.userId === site.userId).length;
      if (userSiteCount > limits.maxSites) {
        console.log(
          `Site limit exceeded: ${userSiteCount}/${limits.maxSites} sites. Skipping.`,
        );
        return { scheduled: 0 };
      }
    }

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

    // Build a set of all keywords from existing articles to prevent cannibalization
    // Use metaKeywords if available, fall back to slug words
    const publishedKeywords = new Set<string>();
    const stopWords = new Set(["the", "and", "for", "with", "how", "what", "why", "are", "can", "your", "that", "this", "from", "have", "will"]);
    for (const art of allArticles) {
      // Prefer metaKeywords (more accurate than slug-derived words)
      if (art.metaKeywords && art.metaKeywords.length > 0) {
        for (const kw of art.metaKeywords) {
          for (const w of kw.toLowerCase().split(/\s+/)) {
            if (w.length > 3 && !stopWords.has(w)) publishedKeywords.add(w);
          }
        }
      } else {
        // Fall back to slug words
        for (const w of art.slug.replace(/^\//, "").split("-")) {
          if (w.length > 3 && !stopWords.has(w)) publishedKeywords.add(w);
        }
      }
    }

    // Pick the highest-priority topic that doesn't cannibalize existing content
    let selectedTopic = available[0]; // fallback to highest priority
    for (const topic of available) {
      const kwWords = topic.primaryKeyword.toLowerCase().split(/\s+/).filter((w: string) => !stopWords.has(w));
      const overlapCount = kwWords.filter((w: string) => w.length > 3 && publishedKeywords.has(w)).length;
      const overlapRatio = kwWords.length > 0 ? overlapCount / kwWords.length : 0;

      if (overlapRatio < 0.35) {
        selectedTopic = topic;
        if (overlapCount > 0) {
          console.log(`Topic "${topic.primaryKeyword}" has ${overlapCount}/${kwWords.length} overlapping words — acceptable.`);
        }
        break;
      }
      console.log(`Skipping "${topic.primaryKeyword}": ${Math.round(overlapRatio * 100)}% overlap with existing articles (cannibalization risk).`);
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

