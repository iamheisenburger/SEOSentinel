"use node";
/** Pentra Answers (Nov 2026): the weekly email, sent after the week's run and its follow-up work, from hello@pentra.dev. */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { sendCustomerEmail } from "../lib/customerEmail";
import { answersWeeklyEmail } from "../lib/answersWeekly";

export const sendWeekly = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<{ status: string }> => {
  const context = await ctx.runQuery(internal.answersDispatch.weeklyContext, { siteId });
  if (!context) return { status: "skipped" };
  const message = answersWeeklyEmail(context.input);
  const sent = await sendCustomerEmail({ to: context.to, ...message });
  if (sent.sent) await ctx.runMutation(internal.answersDispatch.markWeeklySent, { siteId });
  return { status: sent.sent ? "sent" : `failed: ${sent.error ?? "unknown"}` };
} });
