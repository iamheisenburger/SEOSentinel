"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { matchPastedArticle } from "../lib/pastedPublication";

/** Read the owner's public page once and record whether the article is there. */
export const verify = internalAction({ args: { checkId: v.id("pasted_publications") },
  handler: async (ctx, { checkId }): Promise<{ live: boolean }> => {
    const check = await ctx.runQuery(internal.pastedPublication.forCheck, { checkId });
    if (!check) return { live: false };
    const page = await fetchPage(check.url);
    const match = page.status === 200 ? matchPastedArticle(page.html, check) : { titleFound: false, matched: 0, total: 0, live: false };
    await ctx.runMutation(internal.pastedPublication.record, { checkId, live: match.live, titleFound: match.titleFound,
      matched: match.matched, total: match.total, httpStatus: page.status });
    return { live: match.live };
  } });
