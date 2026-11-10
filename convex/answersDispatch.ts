/** Pentra Answers (Nov 2026): the hourly dispatcher. Pentra's own sites move to Answers by code; every Answers site gets its
 * first hour, then (on the plan) a weekly run, daily rechecks of newly published pages, hosted-address checks, and the
 * weekly email. A stalled run is picked up again. Nothing here calls a provider. */
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ANSWERS_OWNER_DOMAINS, ANSWERS_PLAN, answersAllows, competitorFromDomain } from "./lib/answersAccess";
import { countryCode } from "./lib/aiAnswers";
import { ANSWERS_WEEK_MS, siteAnswersAccess } from "./answers";

const WEEK_MS = ANSWERS_WEEK_MS, RECHECK_GAP_MS = 22 * 3_600_000, SETUP_RETRY_MS = 6 * 3_600_000, GROWTH_EVERY_MS = 23 * 3_600_000;

/** Pentra's own sites carry code-made settings; each version applies once.
 * 2 (Nov 8 2026): competitor names re-derived ("copy.ai" is Copy.ai, never the word "Copy"); dawnlist and LeadPilot publish
 * automatically now that their first drafts were read; pentra.dev restarts its first hour for the new product (its
 * questions and drafts were written from the old article product's profile): set aside, re-read, asked again. */
export const OWNER_SETTINGS_VERSION = 5;
const OWNER_AUTOPUBLISH = new Set(["dawnlist.io", "leadpilot.chat"]);
const OWNER_RESTART = new Set(["pentra.dev"]);
/** 3 (Nov 8 2026): LeadPilot's published answer files are written again with qualityGateVersion (its blog hides a post
 * without it: all five were 404); dawnlist gets suggested competitors from a fresh read of its homepage (it had none, so
 * no answer could count who was named instead). Its confirmed facts are untouched. */
const OWNER_REFRESH_FILES = new Set(["leadpilot.chat"]);
const OWNER_FILL_COMPETITORS = new Set(["dawnlist.io"]);
/** 4 (Nov 8 2026): pentra.dev's competitors are the AI-visibility tools buyers are shown instead of it, and the profile
 * fields its relaunch read never replaces (pain points, how it's used, pricing) describe the Answers product: the read kept
 * the article product's Jasper, Copy.ai, "3 articles/month free" and SEO-article pains, so 3 of 5 first drafts were about
 * the old product. Its questions are set aside, its drafts retired, and the first hour runs again (Opus questions and
 * pages); never while a run is asking. */
const OWNER_COMPETITORS: Record<string, ReadonlyArray<{ name: string; domain: string }>> = {
  "pentra.dev": [{ name: "Profound", domain: "tryprofound.com" }, { name: "Otterly.AI", domain: "otterly.ai" }, { name: "Peec AI", domain: "peec.ai" },
    { name: "AthenaHQ", domain: "athenahq.ai" }, { name: "Semrush", domain: "semrush.com" }, { name: "Ahrefs", domain: "ahrefs.com" }],
};
/** 5 (Nov 8 2026): pentra.dev publishes automatically (its five Opus drafts were read: right price, right features, every
 * outside claim sourced), its pages invite readers to /start (the domain step first), and its hosted address is attached
 * and checked at once. */
const OWNER_PUBLISH_NOW: Record<string, { ctaUrl: string }> = { "pentra.dev": { ctaUrl: "https://pentra.dev/start" } };
const OWNER_PROFILE: Record<string, { painPoints: string[]; productUsage: string; pricingInfo: string }> = {
  "pentra.dev": {
    painPoints: ["How do I get my business recommended by ChatGPT?", "Why do AI assistants recommend my competitors instead of my business?",
      "How can I see what ChatGPT, Perplexity and Gemini say about my business?", "How do I get my website cited in Google's AI Overviews?",
      "Which pages do AI assistants cite when buyers ask who to hire?", "How do I track whether AI assistants mention my brand?"],
    productUsage: "The owner enters their website; Pentra reads it and the owner confirms what it sells and who it competes with. Pentra writes " +
      "about 30 questions buyers ask AI assistants, asks ChatGPT, Perplexity, Gemini, Google AI Mode and Google AI Overviews each one, keeps every " +
      "answer as proof, shows who gets named, and drafts answer pages for the questions the business can win. On the plan, Pentra publishes the " +
      "pages to the owner's site (WordPress, Webflow, Shopify, Ghost, GitHub or a webhook) or hosts them at answers.<their domain>, tells search " +
      "engines, asks the assistants again every week and records every citation.",
    pricingInfo: `One plan: $${ANSWERS_PLAN.monthlyUsd} a month or $${ANSWERS_PLAN.annualUsd.toLocaleString("en-US")} a year. The first hour is ` +
      "free with no card: how 5 AI assistants answer about 30 buyer questions, and 5 draft answer pages.",
  },
};

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
  const from = site.answers?.ownerVersion ?? 1;
  const competitors = from < 4 ? OWNER_COMPETITORS[domain] : undefined;
  if (competitors) {
    const latest = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).order("desc").first();
    if (latest?.status === "asking") return; // the next hourly pass applies it, once this run has finished
  }
  if (from < 2) await applyOwnerVersion2(ctx, site, domain, now);
  const current = await ctx.db.get(site._id);
  if (!current?.answers) return;
  if (from < 3) await applyOwnerVersion3(ctx, current, domain);
  if (competitors) {
    // Set aside, never deleted: questions written from the old profile stop being asked, and their drafts are retired.
    for (const q of await ctx.db.query("answer_questions").withIndex("by_site", (x) => x.eq("siteId", site._id)).take(200)) {
      if (q.status !== "removed") await ctx.db.patch(q._id, { status: "removed", pageId: undefined });
    }
    for (const p of await ctx.db.query("answer_pages").withIndex("by_site_status", (x) => x.eq("siteId", site._id).eq("status", "draft")).take(100)) {
      await ctx.db.patch(p._id, { status: "retired", rewriteReason: "Written from the old product's profile; replaced", updatedAt: now });
    }
    const fresh = (await ctx.db.get(site._id))!;
    // snapshotRequestedAt: the hourly rule below must not start the same first hour a second time.
    const settings = { ...fresh.answers!, competitors: [...competitors], ...(from >= 2 ? { snapshotRequestedAt: now } : {}) };
    delete settings.lastSnapshotRunId;
    await ctx.db.patch(site._id, { ...(OWNER_PROFILE[domain] ?? {}), answers: settings, updatedAt: now });
    // Version 2's re-read runs the first hour itself; otherwise it runs again now, from the corrected profile.
    if (from >= 2) await ctx.scheduler.runAfter(0, internal.actions.answers.prepareSnapshot, { siteId: site._id });
  }
  const publishNow = from < 5 ? OWNER_PUBLISH_NOW[domain] : undefined;
  if (publishNow) {
    const fresh = (await ctx.db.get(site._id))!;
    await ctx.db.patch(site._id, { ctaUrl: publishNow.ctaUrl, answers: { ...fresh.answers!, autopublish: true }, updatedAt: now });
    if (fresh.answers?.publishing?.target === "hosted") await ctx.scheduler.runAfter(0, internal.actions.answerPublish.attachHostedDomain, { siteId: site._id });
  }
  const latest = (await ctx.db.get(site._id))!;
  await ctx.db.patch(site._id, { answers: { ...latest.answers!, ownerVersion: OWNER_SETTINGS_VERSION } });
}

async function applyOwnerVersion3(ctx: MutationCtx, current: Doc<"sites">, domain: string) {
  const site = current;
  if (OWNER_REFRESH_FILES.has(domain)) {
    const published = (await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "published")).take(50))
      .filter((p) => p.publishTarget === "github");
    let delay = 0;
    for (const page of published) { await ctx.scheduler.runAfter(delay, internal.actions.answerPublish.refreshPublishedFile, { pageId: page._id }); delay += 20_000; }
  }
  if (OWNER_FILL_COMPETITORS.has(domain) && !current.answers?.competitors?.length) {
    await ctx.scheduler.runAfter(0, internal.actions.answersSetup.readSite, { siteId: site._id, force: true, competitorsOnly: true });
  }
}

async function applyOwnerVersion2(ctx: MutationCtx, site: Doc<"sites">, domain: string, now: number) {
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
    // pentra.dev's own blog renders from Pentra's database, not from repository files: its answer pages live at
    // answers.pentra.dev (one DNS record; Pentra attaches the address once it holds a Vercel token).
    const hostedDomain = `answers.${domain}`;
    if (!(await ctx.db.query("answer_host_index").withIndex("by_host", (x) => x.eq("host", hostedDomain)).first())) {
      await ctx.db.insert("answer_host_index", { host: hostedDomain, siteId: site._id, createdAt: now });
    }
    await ctx.db.patch(site._id, { answers: { ...settings, competitors, autopublish, ownerVersion: 2, snapshotRequestedAt: now + 3_600_000,
      publishing: { target: "hosted", hostedDomain, hostedStatus: "pending_dns" } } });
    await ctx.scheduler.runAfter(0, internal.actions.answerPublish.attachHostedDomain, { siteId: site._id });
    // The relaunched homepage is read once it has deployed, then the first hour runs again from it.
    await ctx.scheduler.runAfter(30 * 60_000, internal.actions.answersSetup.readSite, { siteId: site._id, force: true, then: "snapshot" });
    return;
  }
  // With publishing on, the hourly rule below publishes their drafts (dispatchSite).
  await ctx.db.patch(site._id, { answers: { ...site.answers!, competitors, autopublish, ownerVersion: 2 } });
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
    // Attach, then check: attaching is idempotent (409 once the address is on the project), and an address whose first
    // attach ran before Pentra held a Vercel token is only ever added here.
    await ctx.scheduler.runAfter(0, internal.actions.answerPublish.attachHostedDomain, { siteId: site._id });
  }
  // Drafts publish on the plan with automatic publishing on: the free hour's drafts go out within the hour after upgrading.
  // A page that failed to publish is tried again once a day (its destination may have been fixed elsewhere).
  if (allows.publish && settings.autopublish !== false) {
    const waiting = [
      ...await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "draft")).take(20),
      ...(await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "publish_failed")).take(20))
        .filter((p) => now - p.updatedAt >= 24 * 3_600_000),
    ];
    let delay = 0;
    for (const page of waiting) { await ctx.scheduler.runAfter(delay, internal.actions.answerPublish.publishPage, { pageId: page._id }); delay += 15_000; }
  }
  // P403: the Get named work, done for the owner once a day on the plan: threads found, replies and pitches prepared, then
  // the listing, comparison pages and the week's video started (answerGrowthKit.autoWork). Nothing is posted or sent.
  if (allows.weekly && now - (settings.growthPreparedAt ?? 0) >= GROWTH_EVERY_MS) {
    await ctx.db.patch(site._id, { answers: { ...settings, growthPreparedAt: now } });
    await ctx.scheduler.runAfter(0, internal.actions.answerGrowth.prepare, { siteId: site._id });
    await ctx.scheduler.runAfter(5 * 60_000, internal.answerGrowthKit.autoWork, { siteId: site._id });
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

/** The first hour's email: its run's counts, the drafts written so far, and the next step for this account. Once per site,
 * only to an owner who gets Pentra's emails. */
export const readyContext = internalQuery({ args: { siteId: v.id("sites"), runId: v.id("answer_runs") }, handler: async (ctx, { siteId, runId }) => {
  const site = await ctx.db.get(siteId);
  const run = await ctx.db.get(runId);
  if (!site?.answers || site.deletionStatus || site.answers.snapshotEmailAt || !site.userId || !run || run.siteId !== siteId || run.status !== "done" || !run.answered) return null;
  const contact = await ctx.db.query("account_contacts").withIndex("by_user", (q) => q.eq("userId", site.userId!)).first();
  if (!contact?.emailUpdates) return null;
  const access = await siteAnswersAccess(ctx, site);
  const allows = answersAllows(access);
  const drafts = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "draft")).take(10);
  const writing = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "writing")).take(10);
  const destination = Boolean(site.answers.publishing?.target) || Boolean(site.publishMethod && site.publishMethod !== "manual");
  return {
    to: contact.email,
    input: {
      name: site.siteName?.trim() || site.domain, domain: site.domain, questions: new Set(run.jobs.map((j) => j.questionId)).size,
      answered: run.answered, named: run.named,
      byAssistant: (run.byAssistant ?? []).map((a) => ({ assistant: a.assistant, answered: a.answered, named: a.named })),
      competitors: run.competitors ?? [],
      drafts: drafts.map((p) => ({ title: p.title })), writing: writing.length,
      next: (!allows.publish ? "free" : !destination ? "connect" : site.answers.autopublish === false ? "review" : "publishing") as "free" | "publishing" | "connect" | "review",
      dashboardUrl: "https://pentra.dev/dashboard", billingUrl: "https://pentra.dev/dashboard/billing", settingsUrl: "https://pentra.dev/dashboard/settings#publishing",
    },
  };
} });

export const markReadySent = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (site?.answers) await ctx.db.patch(siteId, { answers: { ...site.answers, snapshotEmailAt: Date.now() } });
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
