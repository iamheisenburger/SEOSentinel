import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";

/** Action-safe bridge to the database-aware canonical plan fence. */
export const isSiteExecutionAuthorized = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    return await siteExecutionAuthorized(ctx, site);
  },
});
