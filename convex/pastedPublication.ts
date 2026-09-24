import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { pastedUrlForSite } from "./lib/pastedPublication";
import { pasteDestination } from "./lib/contentSelection";

const CHECKS_PER_ARTICLE_PER_DAY = 20;

/** Owner: "I published this article on my site at <url>". Pentra checks the page. */
export const confirm = mutation({ args: { articleId: v.id("articles"), url: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity(), article = await ctx.db.get(args.articleId);
    const site = article ? await ctx.db.get(article.siteId) : null;
    if (!identity || !article || !site?.userId || site.userId !== identity.subject) throw new ConvexError("Not authorized");
    if (!pasteDestination(site)) throw new ConvexError("This site publishes through its connection; Pentra checks those articles itself.");
    if (article.status !== "ready") throw new ConvexError("Approve the article first, then paste it into your site.");
    const url = pastedUrlForSite(args.url, site.domain);
    if (!url) throw new ConvexError(`Enter the article's full https:// address on ${site.domain}.`);
    const now = Date.now();
    const recent = await ctx.db.query("pasted_publications").withIndex("by_article_requested", q => q.eq("articleId", article._id).gte("requestedAt", now - 86_400_000)).take(CHECKS_PER_ARTICLE_PER_DAY + 1);
    if (recent.length >= CHECKS_PER_ARTICLE_PER_DAY) throw new ConvexError("Too many checks today. Try again tomorrow.");
    if (recent.some(r => r.status === "checking" && now - r.requestedAt < 120_000)) throw new ConvexError("Pentra is already checking this page.");
    const id = await ctx.db.insert("pasted_publications", { siteId: site._id, articleId: article._id, url, requestedAt: now, status: "checking" });
    await ctx.scheduler.runAfter(0, internal.actions.pastedPublication.verify, { checkId: id });
    return { checkId: id };
  } });

/** Latest check for an article, owner only. */
export const forArticle = query({ args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const identity = await ctx.auth.getUserIdentity(), article = await ctx.db.get(articleId);
    const site = article ? await ctx.db.get(article.siteId) : null;
    if (!identity || !site?.userId || site.userId !== identity.subject) return null;
    const latest = await ctx.db.query("pasted_publications").withIndex("by_article_requested", q => q.eq("articleId", articleId)).order("desc").first();
    const live = await ctx.db.query("pasted_publications").withIndex("by_article_requested", q => q.eq("articleId", articleId)).order("desc")
      .filter(q => q.eq(q.field("status"), "live")).first();
    return { latest: latest && { status: latest.status, url: latest.url, checkedAt: latest.checkedAt ?? null, matched: latest.matched ?? null,
      total: latest.total ?? null, titleFound: latest.titleFound ?? null }, liveSince: live?.checkedAt ?? null, liveUrl: live?.url ?? null };
  } });

export const forCheck = internalQuery({ args: { checkId: v.id("pasted_publications") },
  handler: async (ctx, { checkId }) => {
    const row = await ctx.db.get(checkId), article = row ? await ctx.db.get(row.articleId) : null;
    if (!row || row.status !== "checking" || !article || article.siteId !== row.siteId) return null;
    return { url: row.url, title: article.title ?? "", markdown: article.markdown ?? "" };
  } });

export const record = internalMutation({ args: { checkId: v.id("pasted_publications"), live: v.boolean(), titleFound: v.boolean(),
  matched: v.number(), total: v.number(), httpStatus: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.checkId);
    if (!row || row.status !== "checking") return;
    await ctx.db.patch(row._id, { status: args.live ? "live" : "not_found", checkedAt: Date.now(), titleFound: args.titleFound,
      matched: args.matched, total: args.total, httpStatus: args.httpStatus });
  } });
