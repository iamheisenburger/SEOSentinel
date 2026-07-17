"use node";

import { api, internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { getLimitsFromFeatures, ALL_FEATURE_KEYS } from "../planLimits";
import { normalizeSiteOrigin } from "../lib/articleQuality";
import { evaluateCadenceWindow } from "../lib/autopilotCadence";

export const scheduleCadence = action({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<{ scheduled: number }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
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
      const allUserSites = await ctx.runQuery(internal.sites.listAllForAutopilot);
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

    // Count generation attempts inside the current cadence window. LeadPilot's
    // dogfood site gets one fallback when the first draft fails quality; other
    // customer sites keep their existing one-attempt behavior.
    const allArticles = await ctx.runQuery(api.articles.listBySite, { siteId });
    const now = Date.now();
    const isLeadPilot =
      new URL(normalizeSiteOrigin(site.domain)).hostname === "leadpilot.chat";
    const cadenceWindow = evaluateCadenceWindow({
      articles: allArticles,
      now,
      hoursPerArticle,
      maxAttempts: isLeadPilot ? 2 : 1,
    });

    // Never stack article jobs, and stop once this cadence window has either a
    // successful publication or its allowed generation attempts are exhausted.
    if (existingArticles.length > 0) {
      console.log(`Jobs already queued: ${existingArticles.length} pending/running.`);
      return { scheduled: 0 };
    }

    if (!cadenceWindow.canGenerate) {
      const reason = cadenceWindow.hasRecentPublication
        ? "a published article already satisfies this cadence window"
        : `${cadenceWindow.recentAttempts} generation attempt(s) already used`;
      console.log(`Cadence window closed: ${reason}.`);
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

    // Final recheck: enforce article limit before creating job
    if (site.userId) {
      const finalCount = await ctx.runQuery(api.articles.countThisMonth, {
        userId: site.userId,
      });
      const finalFeatures = (site as any).planFeatures ?? [];
      const finalLimits = getLimitsFromFeatures(finalFeatures);
      if (finalCount >= finalLimits.maxArticles) {
        console.log(`Article limit reached at scheduling time (${finalCount}/${finalLimits.maxArticles}). Aborting.`);
        return { scheduled: 0 };
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
