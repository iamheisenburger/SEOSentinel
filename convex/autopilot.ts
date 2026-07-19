import { api } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const SITE_STAGGER_MS = 5_000;

export const dispatchActiveSites = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const sites = await ctx.db.query("sites").collect();
    const activeSites = sites.filter((site) => site.autopilotEnabled);

    for (const [index, site] of activeSites.entries()) {
      await ctx.scheduler.runAfter(
        index * SITE_STAGGER_MS,
        api.actions.pipeline.autopilotTick,
        { siteId: site._id },
      );
    }

    return { scheduled: activeSites.length };
  },
});
