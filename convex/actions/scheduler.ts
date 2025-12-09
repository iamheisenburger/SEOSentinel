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
    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const available = topics
      .filter((t: { status?: string }) => t.status !== "used")
      .slice(0, cadence);

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

