/** Pentra Answers (Nov 2026): answer pages, the database side. Which questions get a page, the page rows, drafts with
 * their facts and sources, the owner's preview and edits. The writing lives in actions/answerPages.ts. */
import { internalMutation, internalQuery, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { answersAllows, answersEnabled } from "./lib/answersAccess";
import { pageContentHash, uniqueSlug } from "./lib/answerPages";
import { namesCompetitor } from "./lib/answerEngine";
import { businessOf, siteAnswersAccess } from "./answers";

/** Pages a site may have written in a month on the plan (the free first hour writes five). */
export const ANSWER_PAGES_PER_MONTH = 30;
const LIVE_PAGE_STATUSES = new Set(["writing", "draft", "publishing", "published", "publish_failed"]);

async function ownedAnswersSite(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">): Promise<Doc<"sites"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const site = await ctx.db.get(siteId);
  return site && site.userId === identity.subject && answersEnabled(site) ? site : null;
}

/** The questions that get a page next: winnable first, highest opportunity first, none covered, none with a live page. */
export const pickDraftTargets = internalQuery({ args: { siteId: v.id("sites"), count: v.number() }, handler: async (ctx, { siteId, count }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !answersEnabled(site)) return [];
  const questions = await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "active")).take(200);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(500);
  const covered = new Set(pages.filter((p) => LIVE_PAGE_STATUSES.has(p.status)).map((p) => p.questionId));
  const skipped = new Set(pages.filter((p) => p.status === "not_written" && Date.now() - p.updatedAt < 30 * 86_400_000).map((p) => p.questionId));
  const competitors = businessOf(site).competitors;
  return questions
    .filter((q) => !covered.has(q._id) && !skipped.has(q._id) && !namesCompetitor(q.question, competitors) && q.opportunity &&
      q.opportunity.status !== "covered" && (q.latest?.answered ?? 0) > 0)
    .sort((a, b) => Number(b.opportunity!.status === "winnable") - Number(a.opportunity!.status === "winnable") || b.opportunity!.score - a.opportunity!.score)
    .slice(0, Math.max(0, Math.min(10, Math.floor(count))))
    .map((q) => ({ questionId: q._id, question: q.question }));
} });

/** A page row for a question (status "writing"), with a unique address; a rewrite keeps the address of the page it
 * replaces. `null` when the question already has a live page or the month's pages are used. */
export const startPage = internalMutation({ args: { siteId: v.id("sites"), questionId: v.id("answer_questions"), rewriteOf: v.optional(v.id("answer_pages")),
  rewriteReason: v.optional(v.string()) },
  handler: async (ctx, { siteId, questionId, rewriteOf, rewriteReason }) => {
    const site = await ctx.db.get(siteId), question = await ctx.db.get(questionId);
    if (!site || !answersEnabled(site) || !question || question.siteId !== siteId) return null;
    const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(1000);
    const access = await siteAnswersAccess(ctx, site);
    const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    const writtenThisMonth = pages.filter((p) => p.createdAt >= monthStart).length;
    const limit = access === "free" ? 5 : ANSWER_PAGES_PER_MONTH;
    const written = pages.filter((p) => p.status !== "not_written");
    const writtenThisMonthKept = written.filter((p) => p.createdAt >= monthStart).length;
    // A page skipped because the business's own pages don't support it isn't counted; attempts are still bounded.
    if ((access === "free" ? written.length : writtenThisMonthKept) >= limit) return null;
    if ((access === "free" ? pages.length : writtenThisMonth) >= limit + 5) return null;
    const previous = rewriteOf ? await ctx.db.get(rewriteOf) : null;
    if (!previous && pages.some((p) => p.questionId === questionId && LIVE_PAGE_STATUSES.has(p.status))) return null;
    const slug = previous ? previous.slug : uniqueSlug(question.question, new Set(pages.map((p) => p.slug)));
    const now = Date.now();
    const pageId = await ctx.db.insert("answer_pages", { siteId, questionId, question: question.question, status: "writing", title: question.question,
      slug, metaDescription: "", markdown: "", facts: [], sources: [], issues: [], version: (previous?.version ?? 0) + 1, contentHash: "",
      writerModel: "", costMicroUsd: 0, createdAt: now, updatedAt: now, citations: 0,
      ...(previous ? { rewriteOf: previous._id, rewriteReason: rewriteReason ?? "Not cited by any assistant yet" } : {}) });
    await ctx.db.patch(questionId, { pageId });
    return pageId;
  } });

/** The business's other answer pages (the newest of each kind): their questions, so a page keeps to its own, and their
 * text, so nothing is copied from one page to the next (Cowork's test 3: the same blocks on every page). */
async function siblingsOf(ctx: QueryCtx, page: Doc<"answer_pages">): Promise<Array<{ question: string; markdown: string }>> {
  const others: Doc<"answer_pages">[] = [];
  for (const status of ["published", "draft", "publishing", "publish_failed", "writing"]) {
    others.push(...await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", page.siteId).eq("status", status)).order("desc").take(8));
  }
  return others.filter((p) => p._id !== page._id && p._id !== page.rewriteOf && p.questionId !== page.questionId).slice(0, 16)
    .map((p) => ({ question: p.question, markdown: p.markdown.slice(0, 12_000) }));
}

/** The other pages again, as they are now (a page written side by side may have finished meanwhile). */
export const siblingPages = internalQuery({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  return page ? await siblingsOf(ctx, page) : null;
} });

/** What the writer needs for one page: the business's facts, what the assistants answer today, and the sources they cite
 * (most-cited first, the business's own pages left out). */
export const writeContext = internalQuery({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  if (!page || page.status !== "writing") return null;
  const site = await ctx.db.get(page.siteId), question = await ctx.db.get(page.questionId);
  if (!site || !question) return null;
  const checks = await ctx.db.query("answer_checks").withIndex("by_question_asked", (q) => q.eq("questionId", question._id)).order("desc").take(15);
  const answered = checks.filter((c) => c.status === "answered");
  const sourceCounts = new Map<string, { url: string; title?: string; count: number }>();
  for (const c of answered) for (const s of c.sources) {
    if (s.own) continue;
    const row = sourceCounts.get(s.url) ?? { url: s.url, ...(s.title ? { title: s.title } : {}), count: 0 };
    row.count++;
    sourceCounts.set(s.url, row);
  }
  const business = businessOf(site);
  const access = await siteAnswersAccess(ctx, site);
  const siblings = await siblingsOf(ctx, page);
  return {
    page: { pageId, siteId: site._id, questionId: question._id, question: question.question, rewriteOf: page.rewriteOf ?? null },
    siblings,
    business: { name: business.name, domain: business.domain, summary: site.siteSummary ?? "", features: site.keyFeatures ?? [], pricing: site.pricingInfo ?? "",
      ctaText: site.ctaText ?? "", ctaUrl: site.ctaUrl ?? "", language: site.language ?? "en",
      market: [site.answers?.local && site.answers.location ? site.answers.location : "", site.targetCountry ?? business.country].filter(Boolean).join(", ") },
    competitors: business.competitors.map((c) => ({ name: c.name, ...(c.domain ? { domain: c.domain } : {}) })),
    landscape: answered.slice(0, 5).map((c) => ({ assistant: c.assistant, excerpt: c.excerpt, named: c.named, competitorsNamed: c.competitorsNamed })),
    sources: [...sourceCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    autopublish: answersAllows(access).publish && site.answers?.autopublish !== false,
  };
} });

const draftArgs = {
  pageId: v.id("answer_pages"),
  title: v.string(), metaDescription: v.string(), markdown: v.string(),
  facts: v.array(v.object({ text: v.string(), source: v.string(), url: v.optional(v.string()) })),
  sources: v.array(v.object({ n: v.number(), url: v.string(), title: v.optional(v.string()), excerpt: v.optional(v.string()),
    contentHash: v.optional(v.string()), retrievedAt: v.number() })),
  issues: v.array(v.string()), writerModel: v.string(), costMicroUsd: v.number(),
};

/** The written page, checked: a draft (publishable), or "not written" with the reason when it failed the objective
 * checks twice (Pentra never publishes a page with an unsupported number). */
/** When the site's first drafts are all written (or skipped), its "first hour ready" email goes out now, not on a timer. */
async function readyEmailWhenDraftsDone(ctx: MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  const runId = site?.answers?.lastSnapshotRunId;
  if (!site?.answers || !runId || site.answers.snapshotEmailAt) return;
  const writing = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "writing")).first();
  if (!writing) await ctx.scheduler.runAfter(0, internal.actions.answerEmail.sendSnapshotReady, { siteId, runId });
}

export const saveDraft = internalMutation({ args: { ...draftArgs, blocked: v.boolean() }, handler: async (ctx, args) => {
  const page = await ctx.db.get(args.pageId);
  if (!page || page.status !== "writing") return null;
  const { pageId, blocked, ...draft } = args;
  await ctx.db.patch(pageId, { ...draft, title: draft.title.slice(0, 90), metaDescription: draft.metaDescription.slice(0, 170),
    status: blocked ? "not_written" : "draft", ...(blocked ? { notWrittenReason: draft.issues[0] ?? "The page didn't pass Pentra's checks." } : {}),
    contentHash: pageContentHash(draft), updatedAt: Date.now() });
  if (blocked) {
    const question = await ctx.db.get(page.questionId);
    if (question?.pageId === pageId) await ctx.db.patch(question._id, { pageId: undefined });
  }
  await readyEmailWhenDraftsDone(ctx, page.siteId);
  return { status: blocked ? "not_written" : "draft" };
} });

/** A page whose writing failed outright (the writer didn't answer): released so the next run can try again. */
export const abandonPage = internalMutation({ args: { pageId: v.id("answer_pages"), reason: v.string(), costMicroUsd: v.number(),
  replace: v.optional(v.boolean()) },
  handler: async (ctx, { pageId, reason, costMicroUsd, replace }) => {
    const page = await ctx.db.get(pageId);
    if (!page || page.status !== "writing") return;
    await ctx.db.patch(pageId, { status: "not_written", notWrittenReason: reason.slice(0, 300), costMicroUsd, updatedAt: Date.now() });
    const question = await ctx.db.get(page.questionId);
    if (question?.pageId === pageId) await ctx.db.patch(question._id, { pageId: undefined });
    // A question the business's pages don't support: the next winnable question is written instead (caps still apply).
    if (replace && !page.rewriteOf) await ctx.scheduler.runAfter(0, internal.actions.answerPages.draftTop, { siteId: page.siteId, count: 1 });
    else await readyEmailWhenDraftsDone(ctx, page.siteId);
  } });

/** Published pages that no assistant has cited after three weeks and at least three full runs: rewritten, two a week. */
export const uncitedPages = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const now = Date.now();
  const published = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published")).take(500);
  const runs = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").take(20);
  return published.filter((p) => p.citations === 0 && p.publishedAt && now - p.publishedAt >= 21 * 86_400_000 &&
    runs.filter((r) => r.status === "done" && r.kind !== "snapshot" && r.createdAt > p.publishedAt!).length >= 3)
    .sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0)).slice(0, 2).map((p) => ({ pageId: p._id, questionId: p.questionId }));
} });

// ── The owner's views and edits ──

/** One page in full: preview, facts with where each came from, numbered sources, and its history. */
export const page = query({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const row = await ctx.db.get(pageId);
  if (!row || !(await ownedAnswersSite(ctx, row.siteId))) return null;
  const history = await ctx.db.query("answer_pages").withIndex("by_question", (q) => q.eq("questionId", row.questionId)).take(20);
  const citations = await ctx.db.query("answer_citations").withIndex("by_page", (q) => q.eq("pageId", pageId)).take(50);
  return {
    pageId, questionId: row.questionId, question: row.question, status: row.status, title: row.title, slug: row.slug, metaDescription: row.metaDescription,
    markdown: row.markdown, facts: row.facts, sources: row.sources, issues: row.issues, version: row.version, updatedAt: row.updatedAt, createdAt: row.createdAt,
    publishedUrl: row.publishedUrl ?? null, publishedAt: row.publishedAt ?? null, publishError: row.publishError ?? null, indexNow: row.indexNow ?? null,
    googleSitemapAt: row.googleSitemapAt ?? null, citations: row.citations, lastCitedAt: row.lastCitedAt ?? null, notWrittenReason: row.notWrittenReason ?? null,
    rewriteReason: row.rewriteReason ?? null,
    history: history.filter((h) => h._id !== pageId).sort((a, b) => b.version - a.version)
      .map((h) => ({ pageId: h._id, version: h.version, status: h.status, updatedAt: h.updatedAt, rewriteReason: h.rewriteReason ?? null })),
    citationList: citations.sort((a, b) => b.at - a.at).map((c) => ({ checkId: c.checkId, assistant: c.assistant, at: c.at, url: c.url })),
  };
} });

/** The owner edits a draft's words. Their edit is theirs: kept exactly, and published as written. */
export const editDraft = mutation({ args: { pageId: v.id("answer_pages"), title: v.string(), metaDescription: v.string(), markdown: v.string() },
  handler: async (ctx, { pageId, title, metaDescription, markdown }) => {
    const row = await ctx.db.get(pageId);
    if (!row || !(await ownedAnswersSite(ctx, row.siteId))) throw new ConvexError("Page not found.");
    if (row.status !== "draft" && row.status !== "publish_failed") throw new ConvexError("Only a draft can be edited. Published pages change through a rewrite.");
    if (!title.trim() || markdown.trim().length < 200) throw new ConvexError("A page needs a title and its text.");
    const next = { title: title.trim().slice(0, 90), metaDescription: metaDescription.trim().slice(0, 170), markdown: markdown.trim() };
    await ctx.db.patch(pageId, { ...next, contentHash: pageContentHash(next), issues: [...new Set([...row.issues.filter((i) => !i.startsWith("Edited")), "Edited by you"])],
      updatedAt: Date.now() });
    return { ok: true };
  } });

/** The owner publishes a draft now (the plan only; the free first hour keeps drafts). */
export const publishDraft = mutation({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const row = await ctx.db.get(pageId);
  const site = row ? await ownedAnswersSite(ctx, row.siteId) : null;
  if (!row || !site) throw new ConvexError("Page not found.");
  if (!answersAllows(await siteAnswersAccess(ctx, site)).publish) throw new ConvexError("Publishing is part of the Pentra plan.");
  if (row.status !== "draft" && row.status !== "publish_failed") throw new ConvexError("This page isn't a draft.");
  await ctx.scheduler.runAfter(0, internal.actions.answerPublish.publishPage, { pageId });
  return { ok: true };
} });
