/** Get named (P397, Nov 2026): the owner's screen for being recommended. From the stored answers of the last two weeks:
 * who the assistants recommend instead, the pages they read (mapped by what can be done about each), the community
 * replies Pentra drafted for a person to post, and (through convex/linkOpportunities.ts) the pitches to editors. One
 * button prepares the work; nothing is ever posted or sent without the owner. */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { answersEnabled } from "./lib/answersAccess";
import { recommendedInstead } from "./lib/answerEngine";
import { rivalDomainsFromAnswers } from "./lib/linkOpportunities";
import { kindTotals, platformOf, postCandidates, REDRAFTS_PER_PREPARATION, SOURCE_KINDS, sourceMap } from "./lib/answerGrowth";
import { businessOf } from "./answers";

const WINDOW_MS = 14 * 86_400_000;
/** One preparation an hour at most: it re-reads answers, looks for pages and drafts replies (a few cents). */
export const PREPARE_EVERY_MS = 3_600_000;

async function ownedSite(ctx: QueryCtx, siteId: Id<"sites">): Promise<Doc<"sites"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const site = await ctx.db.get(siteId);
  return site && site.userId === identity.subject && answersEnabled(site) ? site : null;
}

async function recentChecks(ctx: QueryCtx, siteId: Id<"sites">) {
  return await ctx.db.query("answer_checks").withIndex("by_site_asked", (q) => q.eq("siteId", siteId).gte("askedAt", Date.now() - WINDOW_MS)).take(800);
}

function rivalsOf(site: Doc<"sites">, checks: Doc<"answer_checks">[]) {
  const confirmed = businessOf(site).competitors.flatMap((c) => (c.domain ? [c.domain] : []));
  return [...new Set([...confirmed, ...rivalDomainsFromAnswers(checks, site.domain, 12)])];
}

export const plan = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedSite(ctx, siteId);
  if (!site) return null;
  const checks = await recentChecks(ctx, siteId);
  const answered = checks.filter((c) => c.status === "answered");
  const business = businessOf(site);
  const rivals = rivalsOf(site, checks);
  // Every page counted first, then up to 25 of each kind kept (P398: a forum's threads are cited once each, so a single
  // top-60 cut by page left Reddit out of the map though it was the most-cited site).
  const all = sourceMap(checks, rivals, 2000);
  const sources = SOURCE_KINDS.flatMap((k) => all.filter((s) => s.kind === k).slice(0, 25)).sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url));
  const posts = await ctx.db.query("answer_posts").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").take(60);
  const listed = answered.filter((c) => c.businessesNamed !== undefined).length;
  return {
    windowDays: WINDOW_MS / 86_400_000,
    you: { name: business.name, answered: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length,
      questionsNamed: new Set(answered.filter((c) => c.named).map((c) => c.questionId)).size, questions: new Set(answered.map((c) => c.questionId)).size },
    /** Answers whose businesses are on record (older answers were listed only when they named the business). */
    listed,
    recommended: recommendedInstead(answered, business, 20),
    rivals,
    sources,
    kinds: kindTotals(all),
    posts: posts.map((p) => ({ postId: p._id, url: p.url, platform: p.platform, title: p.title ?? null, questions: p.questions, answers: p.answers,
      draft: p.draft, fits: p.fits, threadRead: p.threadRead, status: p.status, postedUrl: p.postedUrl ?? null, createdAt: p.createdAt, found: p.found ?? "cited" })),
    linkMode: site.linkOutreach ?? "off",
    preparedAt: site.answers?.growthPreparedAt ?? null,
    nextPrepareAt: site.answers?.growthPreparedAt ? site.answers.growthPreparedAt + PREPARE_EVERY_MS : null,
  };
} });

/** Prepare the work now: list who every recent answer names, look for pages to pitch, draft replies for cited threads. */
export const prepare = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedSite(ctx, siteId);
  if (!site || !site.answers) throw new ConvexError("This site isn't yours, or it doesn't run Pentra Answers.");
  const last = site.answers.growthPreparedAt ?? 0;
  if (Date.now() - last < PREPARE_EVERY_MS) throw new ConvexError("Pentra prepared this less than an hour ago. New work appears as it's ready.");
  await ctx.db.patch(siteId, { answers: { ...site.answers, growthPreparedAt: Date.now() } });
  await ctx.scheduler.runAfter(0, internal.actions.answerGrowth.prepare, { siteId });
  return { ok: true };
} });

export const setPostStatus = mutation({ args: { postId: v.id("answer_posts"), status: v.union(v.literal("todo"), v.literal("posted"), v.literal("skipped")),
  postedUrl: v.optional(v.string()) }, handler: async (ctx, { postId, status, postedUrl }) => {
  const post = await ctx.db.get(postId);
  if (!post || !(await ownedSite(ctx, post.siteId))) throw new ConvexError("This reply isn't yours.");
  const clean = postedUrl?.trim();
  if (clean && !/^https:\/\/\S+$/.test(clean)) throw new ConvexError("Paste the reply's address, starting with https://");
  await ctx.db.patch(postId, { status, updatedAt: Date.now(), ...(status === "posted" && clean ? { postedUrl: clean.slice(0, 500) } : {}) });
} });

// ── For the preparing action ──

export const prepareContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !answersEnabled(site)) return null;
  const checks = await recentChecks(ctx, siteId);
  const business = businessOf(site);
  const unlisted = checks.filter((c) => c.status === "answered" && c.businessesNamed === undefined).slice(0, 300).map((c) => ({ checkId: c._id, question: c.question }));
  const posts = await ctx.db.query("answer_posts").withIndex("by_site", (q) => q.eq("siteId", siteId)).order("desc").take(1000);
  const drafted = [...new Set(posts.map((p) => p.url))];
  const threads = postCandidates(sourceMap(checks, rivalsOf(site, checks), 200), new Set(drafted), 8);
  // P406: replies still waiting to be posted that were written from the title alone, newest first (the next ones posted).
  const redraft = posts.filter((p) => p.status === "todo" && !p.threadRead).slice(0, REDRAFTS_PER_PREPARATION)
    .map((p) => ({ postId: p._id, url: p.url, title: p.title ?? null, questions: p.questions, answers: p.answers }));
  // P398: the questions to search threads for: those asking which product or provider to use first (where a reply can
  // name the business), then the rest, newest-answered first.
  const questions = (await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "active")).take(60))
    .sort((a, b) => Number(b.intent === "recommendation") - Number(a.intent === "recommendation") || (b.latest?.at ?? 0) - (a.latest?.at ?? 0))
    .map((q) => q.question);
  return { business: { name: business.name, domain: business.domain, summary: site.siteSummary, features: site.keyFeatures, pricing: site.pricingInfo,
    audience: site.targetAudienceSummary }, unlisted, threads, drafted, redraft, questions, country: business.country ?? "US", linkOn: Boolean(site.linkOutreach) };
} });

/** P406: a waiting reply written from the title alone, written again from the thread once it could be read. A reply
 * already posted or skipped, or already written from its thread, is left as it is. */
export const saveRedraft = internalMutation({ args: { postId: v.id("answer_posts"), draft: v.string(), fits: v.boolean(), costMicroUsd: v.number() },
  handler: async (ctx, { postId, draft, fits, costMicroUsd }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.status !== "todo" || post.threadRead) return;
    await ctx.db.patch(postId, { draft, fits, threadRead: true, costMicroUsd: post.costMicroUsd + costMicroUsd, updatedAt: Date.now() });
  } });

export const checkText = internalQuery({ args: { checkId: v.id("answer_checks") }, handler: async (ctx, { checkId }) =>
  (await ctx.db.query("answer_texts").withIndex("by_check", (q) => q.eq("checkId", checkId)).first())?.text ?? null });

export const saveBusinesses = internalMutation({ args: { checkId: v.id("answer_checks"), names: v.array(v.string()) }, handler: async (ctx, { checkId, names }) => {
  const check = await ctx.db.get(checkId);
  if (!check || check.businessesNamed !== undefined) return;
  await ctx.db.patch(checkId, { businessesNamed: names.slice(0, 31).map((n) => n.slice(0, 80)) });
} });

export const savePost = internalMutation({ args: { siteId: v.id("sites"), url: v.string(), title: v.optional(v.string()), questions: v.array(v.string()),
  answers: v.number(), draft: v.string(), fits: v.boolean(), threadRead: v.boolean(), costMicroUsd: v.number(), found: v.optional(v.string()) }, handler: async (ctx, args) => {
  const existing = await ctx.db.query("answer_posts").withIndex("by_site_url", (q) => q.eq("siteId", args.siteId).eq("url", args.url)).first();
  if (existing) return;
  const now = Date.now();
  await ctx.db.insert("answer_posts", { ...args, platform: platformOf(args.url), questions: args.questions.slice(0, 8), status: "todo", createdAt: now, updatedAt: now });
} });
