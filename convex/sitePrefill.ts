import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const WINDOW_MS = 60 * 60_000, MAX_PER_WINDOW = 12;

/** Throttle onboarding prefill: at most 12 website reads per user per hour. */
export const claim = internalMutation({ args: { userId: v.string() }, handler: async (ctx, { userId }) => {
  const since = Date.now() - WINDOW_MS;
  const recent = await ctx.db.query("site_prefill_requests")
    .withIndex("by_user_requested", q => q.eq("userId", userId).gt("requestedAt", since)).take(MAX_PER_WINDOW);
  if (recent.length >= MAX_PER_WINDOW) return false;
  await ctx.db.insert("site_prefill_requests", { userId, requestedAt: Date.now() });
  // Keep the table small: drop this user's rows older than the window.
  for (const old of await ctx.db.query("site_prefill_requests")
    .withIndex("by_user_requested", q => q.eq("userId", userId).lt("requestedAt", since)).take(50)) await ctx.db.delete(old._id);
  return true;
} });
