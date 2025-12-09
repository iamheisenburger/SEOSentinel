import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Daily autopilot tick to keep onboarding/plan/drafts flowing.
// Runs twice a day to spread the load; cadence remains 4/week via scheduler.
crons.daily(
  "autopilot-morning",
  { hourUTC: 5, minuteUTC: 0 },
  async (ctx) => {
    const sites = await ctx.runQuery(api.sites.list, {});
    if (!sites?.length) return;
    // Kick off autopilot for each site (usually just one)
    for (const site of sites) {
      await ctx.scheduler.runAfter(0, api.actions.pipeline.autopilotTick, {
        siteId: site._id,
      });
    }
  },
);

crons.daily(
  "autopilot-evening",
  { hourUTC: 17, minuteUTC: 0 },
  async (ctx) => {
    const sites = await ctx.runQuery(api.sites.list, {});
    if (!sites?.length) return;
    for (const site of sites) {
      await ctx.scheduler.runAfter(0, api.actions.pipeline.autopilotTick, {
        siteId: site._id,
      });
    }
  },
);

export default crons;

