/** Pentra Answers (Nov 2026): the hourly dispatcher. Pentra's own sites move to Answers by code; every Answers site gets its
 * first hour, then (on the plan) a weekly run, daily rechecks of newly published pages, hosted-address checks, and the
 * weekly email. A stalled run is picked up again. Nothing here calls a provider. */
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ANSWERS_OWNER_DOMAINS, answersAllows, competitorFromDomain } from "./lib/answersAccess";
import { countryCode } from "./lib/aiAnswers";
import { siteAnswersAccess } from "./answers";

const WEEK_MS = 7 * 86_400_000, RECHECK_GAP_MS = 22 * 3_600_000, SETUP_RETRY_MS = 6 * 3_600_000;

/** Pentra's own sites carry code-made settings; each version applies once.
 * 2 (Nov 8 2026): competitor names re-derived ("copy.ai" is Copy.ai, never the word "Copy"); dawnlist and LeadPilot publish
 * automatically now that their first drafts were read; pentra.dev restarts its first hour for the new product (its
 * questions and drafts were written from the old article product's profile): set aside, re-read, asked again. */
export const OWNER_SETTINGS_VERSION = 2;
const OWNER_AUTOPUBLISH = new Set(["dawnlist.io", "leadpilot.chat"]);
const OWNER_RESTART = new Set(["pentra.dev"]);

export const dispatch = internalMutation({ args: {}, handler: async (ctx) => {
  const now = Date.now();
  await ctx.scheduler.runAfter(0, internal.answers.resumeStalledRuns, {});
  // Pentra's own sites (Arshad, Nov 8 2026): Answers by code, confirmed from their profiles, publishing on.
  for (const domain of ANSWERS_OWNER_DOMAINS) {
    for (const site of await ctx.db.query("sites").withIndex("by_domain", (q) => q.eq("domain", domain)).take(5)) {
      if (site.deletionStatus || site.answers) continue;
      // Drafts first: their first pages are read before anything publishes to Pentra's own sites.
      await ctx.db.patch(site._id, { answers: { enabled: true, enabledAt: now, source: "owner", confirmedAt: now, autopublish: false, weeklyEmail: true,
        country: countryCode(site.targetCountry),
        competitors: (site.competitors ?? []).map(competitorFromDomain).filter((c): c is { name: string; domain: string } => c !== null).slice(0, 8) } });
    }
  }
  for (const domain of ANSWERS_OWNER_DOMAINS) {
    for (const site of await ctx.db.query("sites").withIndex("by_domain", (q) => q.eq("domain", domain)).take(5)) {
      if (site.deletionStatus || !site.answers || (site.answers.ownerVersion ?? 1) >= OWNER_SETTINGS_VERSION) continue;
      await applyOwnerVersion(ctx, site, domain, now);
    }
  }
  const sites = await ctx.db.query("sites").withIndex("by_answers_enabled", (q) => q.eq("answers.enabled", true)).take(1000);
  let scheduled = 0;
  for (const site of sites) {
    if (site.deletionStatus || !site.answers?.confirmedAt) continue;
    scheduled += await dispatchSite(ctx, site, now);
  }
  return { sites: sites.length, scheduled };
} });

async function applyOwnerVersion(ctx: MutationCtx, site: Doc<"sites">, domain: string, now: number) {
  const competitors = (site.competitors ?? []).map(competitorFromDomain).filter((c): c is { name: string; domain: string } => c !== null).slice(0, 8);
  const autopublish = OWNER_AUTOPUBLISH.has(domain);
  if (OWNER_RESTART.has(domain)) {
    // Set aside, never deleted: the old questions are removed from tracking and the drafts retired; runs stay as history.
    for (const q of await ctx.db.query("answer_questions").withIndex("by_site", (x) => x.eq("siteId", site._id)).take(200)) {
      if (q.status !== "removed") await ctx.db.patch(q._id, { status: "removed", pageId: undefined });
    }
    for (const p of await ctx.db.query("answer_pages").withIndex("by_site_status", (x) => x.eq("siteId", site._id).eq("status", "draft")).take(100)) {
      await ctx.db.patch(p._id, { status: "retired", rewriteReason: "Written for the old product; replaced after the relaunch", updatedAt: now });
    }
    const settings = { ...site.answers! };
    delete settings.lastSnapshotRunId;
    await ctx.db.patch(site._id, { answers: { ...settings, competitors, autopublish, ownerVersion: OWNER_SETTINGS_VERSION, snapshotRequestedAt: now + 3_600_000 } });
    // The relaunched homepage is read once it has deployed, then the first hour runs again from it.
    await ctx.scheduler.runAfter(30 * 60_000, internal.actions.answersSetup.readSite, { siteId: site._id, force: true, then: "snapshot" });
    return;
  }
  await ctx.db.patch(site._id, { answers: { ...site.answers!, competitors, autopublish, ownerVersion: OWNER_SETTINGS_VERSION } });
  if (autopublish) {
    let delay = 0;
    for (const p of await ctx.db.query("answer_pages").withIndex("by_site_status", (x) => x.eq("siteId", site._id).eq("status", "draft")).take(20)) {
      await ctx.scheduler.runAfter(delay, internal.actions.answerPublish.publishPage, { pageId: p._id });
      delay += 20_000;
    }
  }
}

async function dispatchSite(ctx: MutationCtx, site: Doc<"sites">, now: number): Promise<number> {
  const settings = site.answers!;
  const access = await siteAnswersAccess(ctx, site);
  const allows = answersAllows(access);
  const latest = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).order("desc").first();
  const asking = latest?.status === "asking";
  // The first hour: the owner's confirmation starts it; here it starts for Pentra's own and paid sites, and is retried
  // six hours after a setup error. Never twice at once.
  if (!settings.lastSnapshotRunId) {
    if (asking || (settings.snapshotRequestedAt && now - settings.snapshotRequestedAt < 30 * 60_000)) return 0;
    if (settings.setupErrorAt && now - settings.setupErrorAt < SETUP_RETRY_MS) return 0;
    if (access === "free" && !settings.setupErrorAt) return 0;
    await ctx.db.patch(site._id, { answers: { ...settings, snapshotRequestedAt: now } });
    await ctx.scheduler.runAfter(0, internal.actions.answers.prepareSnapshot, { siteId: site._id });
    return 1;
  }
  if (settings.publishing?.target === "hosted" && settings.publishing.hostedStatus === "pending_dns" &&
    now - (settings.publishing.hostedCheckedAt ?? 0) >= 50 * 60_000) {
    await ctx.scheduler.runAfter(0, internal.actions.answerPublish.checkHostedDomain, { siteId: site._id });
  }
  if (!allows.weekly || asking) return 0;
  const lastFull = settings.lastFullRunAt ?? 0;
  if (lastFull && now - lastFull >= WEEK_MS) {
    await ctx.scheduler.runAfter(0, internal.answers.startRunInternal, { siteId: site._id, kind: "weekly" });
    return 1;
  }
  // Pages published in the last week are re-asked daily, so a first citation shows up within a day of happening.
  if (now - (settings.lastRecheckAt ?? 0) >= RECHECK_GAP_MS) {
    const recent = (await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "published")).take(200))
      .filter((p) => p.publishedAt && now - p.publishedAt <= WEEK_MS);
    if (recent.length) {
      const questionIds: Id<"answer_questions">[] = [...new Set(recent.map((p) => p.questionId))];
      await ctx.scheduler.runAfter(0, internal.answers.startRunInternal, { siteId: site._id, kind: "recheck", questionIds });
      return 1;
    }
  }
  return 0;
}

/** What the weekly email reports: this week's full run against the one before, the week's citations, pages published and
 * rewritten, and questions added; with the owner's address when they get service emails. */
export const weeklyContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.answers || site.answers.weeklyEmail === false || !site.userId) return null;
  const access = await siteAnswersAccess(ctx, site);
  if (!answersAllows(access).weekly) return null;
  const contact = await ctx.db.query("account_contacts").withIndex("by_user", (q) => q.eq("userId", site.userId!)).first();
  if (!contact?.emailUpdates) return null;
  const now = Date.now(), weekAgo = now - WEEK_MS;
  if (site.answers.lastWeeklyEmailAt && now - site.answers.lastWeeklyEmailAt < 6 * 86_400_000) return null;
  const runs = (await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").take(12))
    .filter((r) => r.status === "done" && r.kind !== "recheck");
  const citations = await ctx.db.query("answer_citations").withIndex("by_site_at", (q) => q.eq("siteId", siteId).gte("at", weekAgo)).take(50);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(500);
  const questions = await ctx.db.query("answer_questions").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(200);
  const titleOf = new Map(pages.map((p) => [p._id, p.title]));
  const questionOf = new Map(questions.map((q) => [q._id, q.question]));
  const [thisRun, lastRun] = runs;
  return {
    to: contact.email,
    input: {
      name: site.siteName?.trim() || site.domain, domain: site.domain,
      thisWeek: thisRun ? { answered: thisRun.answered, named: thisRun.named, byAssistant: thisRun.byAssistant ?? [], competitors: thisRun.competitors ?? [] } : null,
      lastWeek: lastRun ? { answered: lastRun.answered, named: lastRun.named } : null,
      citations: citations.filter((c) => c.kind === "page_cited").map((c) => ({ assistant: c.assistant, question: questionOf.get(c.questionId) ?? "",
        title: c.pageId ? titleOf.get(c.pageId) ?? null : null, at: c.at })),
      published: pages.filter((p) => p.status === "published" && (p.publishedAt ?? 0) >= weekAgo && !p.rewriteOf).map((p) => ({ title: p.title, url: p.publishedUrl ?? null })),
      rewritten: pages.filter((p) => p.status === "published" && (p.publishedAt ?? 0) >= weekAgo && p.rewriteOf).map((p) => ({ title: p.title })),
      // The first week's questions are the first hour's, not additions.
      questionsAdded: runs.length > 1 ? questions.filter((q) => q.createdAt >= weekAgo).length : 0,
      dashboardUrl: "https://pentra.dev/dashboard",
    },
  };
} });

export const markWeeklySent = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (site?.answers) await ctx.db.patch(siteId, { answers: { ...site.answers, lastWeeklyEmailAt: Date.now() } });
} });

/** Operator read (Pentra's own sites only, never a customer's): the latest runs, questions, and pages with their text, so the
 * first pages can be read before Pentra's own sites publish automatically. */
export const ownerView = internalQuery({ args: { domain: v.string() }, handler: async (ctx, { domain }) => {
  if (!ANSWERS_OWNER_DOMAINS.includes(domain)) return null;
  const site = (await ctx.db.query("sites").withIndex("by_domain", (q) => q.eq("domain", domain)).take(5)).find((s) => !s.deletionStatus);
  if (!site?.answers) return { domain, answers: null };
  const runs = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).order("desc").take(3);
  const questions = await ctx.db.query("answer_questions").withIndex("by_site", (q) => q.eq("siteId", site._id)).take(60);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id)).take(20);
  const spend = await ctx.db.query("answer_spend").withIndex("by_site_month", (q) => q.eq("siteId", site._id)).take(500);
  return {
    domain, siteId: site._id, settings: { ...site.answers },
    publishing: { method: site.publishMethod ?? null, repo: site.repoOwner && site.repoName ? `${site.repoOwner}/${site.repoName}` : null,
      hasGithubToken: Boolean(site.githubToken), layout: site.githubLayout ? (site.githubLayout as { postsDir?: string; urlStructure?: string }) : null,
      urlStructure: site.urlStructure ?? null },
    runs: runs.map((r) => ({ kind: r.kind, status: r.status, total: r.jobs.length, done: r.done, answered: r.answered, named: r.named, cited: r.cited,
      failed: r.failed, noAnswer: r.noAnswer, byAssistant: r.byAssistant ?? null, competitors: r.competitors ?? null, topSources: r.topSources ?? null,
      costMicroUsd: r.costMicroUsd, error: r.error ?? null, createdAt: r.createdAt, finishedAt: r.finishedAt ?? null })),
    questions: questions.map((q) => ({ question: q.question, intent: q.intent, latest: q.latest ?? null, opportunity: q.opportunity ?? null })),
    pages: pages.map((p) => ({ status: p.status, title: p.title, question: p.question, issues: p.issues, notWrittenReason: p.notWrittenReason ?? null,
      words: p.markdown.split(/\s+/).filter(Boolean).length, markdown: p.markdown, facts: p.facts, sources: p.sources.map((s) => ({ n: s.n, url: s.url, title: s.title })),
      publishedUrl: p.publishedUrl ?? null, costMicroUsd: p.costMicroUsd })),
    spendMicroUsd: spend.reduce((sum, r) => sum + (r.state === "settled" ? r.actualMicroUsd ?? 0 : r.state === "held" ? r.reservedMicroUsd : 0), 0),
  };
} });
