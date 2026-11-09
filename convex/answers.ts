/** Pentra Answers (Nov 2026): the database side. Questions, runs, every answer as proof, spend, and the owner's views.
 * The provider calls live in actions/answers.ts; the judging rules in lib/answerEngine.ts. */
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { plausibleEmail } from "./lib/customerEmail";
import { accountDeletionKey } from "./lib/accountDeletion";
import {
  ANSWER_ASSISTANTS, ANSWER_QUESTION_INTENTS, cleanQuestion, isAnswerAssistant, questionKey, questionOpportunity, rankOpportunities, runTotals, spendMonth, hostOf,
} from "./lib/answerEngine";
import {
  answersAccess, answersAllows, answersEnabled, answersFleetDailyCap, competitorFromDomain, isAnswersOwnerDomain, nameFromDomainOnly, properCompetitorName,
  spendCounted, spendFits, type AnswersAccess,
} from "./lib/answersAccess";
import { normalizeNewDomain } from "./lib/answersSetup";
import { countryCode } from "./lib/aiAnswers";

/** Questions kept active per site: about 30 from the first hour, a few added weekly. */
export const ANSWERS_MAX_ACTIVE_QUESTIONS = 40;
/** Jobs (one question to one assistant) a worker claims at a time; its lease covers the slowest assistant twice. */
export const ANSWERS_BATCH_JOBS = 30;
export const ANSWERS_BATCH_LEASE_MS = 9 * 60_000;
export const ANSWERS_WEEK_MS = 7 * 86_400_000;
/** The ready email goes out when the last first draft is saved (answerPages.readyEmailWhenDraftsDone); this is the fallback. */
export const ANSWERS_READY_EMAIL_DELAY_MS = 30 * 60_000;

// ── Access ──

async function planFeaturesOf(ctx: QueryCtx | MutationCtx, site: Doc<"sites">): Promise<string[]> {
  if (!site.userId) return site.planFeatures ?? [];
  const row = await ctx.db.query("account_plan_entitlements").withIndex("by_user", (q) => q.eq("userId", site.userId!)).unique();
  return [...new Set([...(row?.planFeatures ?? []), ...(site.planFeatures ?? [])])];
}
export async function siteAnswersAccess(ctx: QueryCtx | MutationCtx, site: Doc<"sites">): Promise<AnswersAccess> {
  return answersAccess(site, await planFeaturesOf(ctx, site));
}
/** The signed-in owner's site, running Answers. */
async function ownedAnswersSite(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">): Promise<Doc<"sites"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const site = await ctx.db.get(siteId);
  return site && site.userId === identity.subject && answersEnabled(site) ? site : null;
}
async function requireOwnedAnswersSite(ctx: MutationCtx, siteId: Id<"sites">): Promise<Doc<"sites">> {
  const site = await ownedAnswersSite(ctx, siteId);
  if (!site) throw new ConvexError("This site isn't yours, or it doesn't run Pentra Answers.");
  return site;
}

/** The business as the engine judges answers: its name, address and confirmed competitors. */
export function businessOf(site: Doc<"sites">) {
  const competitors = site.answers?.competitors?.length
    ? site.answers.competitors
    : (site.competitors ?? []).map(competitorFromDomain).filter((c): c is { name: string; domain: string } => c !== null);
  const hosted = site.answers?.publishing?.hostedDomain ? [site.answers.publishing.hostedDomain] : [];
  return { name: site.siteName?.trim() || hostOf(site.domain), domain: hostOf(site.domain), extraHosts: hosted, competitors: competitors.slice(0, 12),
    country: site.answers?.country ?? countryCode(site.targetCountry) };
}

// ── Spend ──

/** Holds spend for one paid step, or says why it can't: one free snapshot per account, a monthly cap per paid site, and a
 * daily cap across the service. */
export const holdSpend = internalMutation({
  args: { siteId: v.id("sites"), runId: v.optional(v.id("answer_runs")), pageId: v.optional(v.id("answer_pages")), purpose: v.string(), microUsd: v.number() },
  handler: async (ctx, args): Promise<{ ok: true; spendId: Id<"answer_spend"> } | { ok: false; reason: string }> => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !answersEnabled(site)) return { ok: false, reason: "site_unavailable" };
    const access = await siteAnswersAccess(ctx, site), now = Date.now(), month = spendMonth(now);
    const hold = Math.ceil(args.microUsd);
    const siteRows = await ctx.db.query("answer_spend").withIndex("by_site_month", (q) => q.eq("siteId", args.siteId).eq("month", month)).take(5000);
    const freeRows = access === "free" && site.userId
      ? await ctx.db.query("answer_spend").withIndex("by_user_month", (q) => q.eq("userId", site.userId)).take(5000) : [];
    const dayRow = await ctx.db.query("answer_spend_days").withIndex("by_day", (q) => q.eq("day", spendDay(now))).unique();
    const fits = spendFits({
      access, holdMicroUsd: hold,
      accountFreeSpent: freeRows.filter((r) => r.free).reduce((sum, r) => sum + spendCounted(r), 0),
      siteMonthSpent: siteRows.reduce((sum, r) => sum + spendCounted(r), 0),
      fleetDaySpent: dayRow?.microUsd ?? 0,
      fleetDailyCap: answersFleetDailyCap(process.env.ANSWERS_FLEET_DAILY_MICRO_USD),
    });
    if (!fits.ok) return fits;
    await addToSpendDay(ctx, now, hold);
    const spendId = await ctx.db.insert("answer_spend", { siteId: args.siteId, ...(site.userId ? { userId: site.userId } : {}),
      ...(args.runId ? { runId: args.runId } : {}), ...(args.pageId ? { pageId: args.pageId } : {}), purpose: args.purpose,
      free: access === "free", month, reservedMicroUsd: hold, state: "held", createdAt: now });
    return { ok: true, spendId };
  },
});
/** Settled at the providers' reported cost (which may exceed the hold: the provider charged it), or released when nothing
 * was sent. */
export const settleSpend = internalMutation({
  args: { spendId: v.id("answer_spend"), actualMicroUsd: v.number(), sent: v.boolean() },
  handler: async (ctx, { spendId, actualMicroUsd, sent }) => {
    const row = await ctx.db.get(spendId);
    if (!row || row.state !== "held") return;
    if (!sent) {
      await ctx.db.patch(spendId, { state: "released", settledAt: Date.now() });
      await addToSpendDay(ctx, row.createdAt, -row.reservedMicroUsd);
      return;
    }
    const actual = Math.max(0, Math.ceil(actualMicroUsd));
    await ctx.db.patch(spendId, { state: "settled", actualMicroUsd: actual, settledAt: Date.now() });
    await addToSpendDay(ctx, row.createdAt, actual - row.reservedMicroUsd);
  },
});

const spendDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
/** The day's running total moves with every hold, settlement and release (a settlement replaces its hold's amount). */
async function addToSpendDay(ctx: MutationCtx, timestamp: number, deltaMicroUsd: number) {
  if (!deltaMicroUsd) return;
  const day = spendDay(timestamp);
  const row = await ctx.db.query("answer_spend_days").withIndex("by_day", (q) => q.eq("day", day)).unique();
  if (row) await ctx.db.patch(row._id, { microUsd: Math.max(0, row.microUsd + deltaMicroUsd), updatedAt: Date.now() });
  else await ctx.db.insert("answer_spend_days", { day, microUsd: Math.max(0, deltaMicroUsd), updatedAt: Date.now() });
}

// ── Questions ──

/** Adds questions once each (by their words), keeping at most ANSWERS_MAX_ACTIVE_QUESTIONS active. */
export const addQuestionsInternal = internalMutation({
  args: { siteId: v.id("sites"), source: v.string(), questions: v.array(v.object({ question: v.string(), intent: v.string() })) },
  handler: async (ctx, { siteId, source, questions }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !answersEnabled(site)) return { added: 0 };
    const business = businessOf(site);
    const active = await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "active")).take(200);
    let room = ANSWERS_MAX_ACTIVE_QUESTIONS - active.length, added = 0;
    for (const item of questions) {
      if (room <= 0) break;
      // Generated questions never name a competitor; the owner's own questions may.
      const question = cleanQuestion(item.question, business, source === "owner" ? [] : business.competitors);
      if (!question) continue;
      const key = questionKey(question);
      if (await ctx.db.query("answer_questions").withIndex("by_site_key", (q) => q.eq("siteId", siteId).eq("key", key)).first()) continue;
      const intent = (ANSWER_QUESTION_INTENTS as readonly string[]).includes(item.intent) ? item.intent : "problem";
      await ctx.db.insert("answer_questions", { siteId, question, key, intent, source, status: "active", createdAt: Date.now() });
      room--; added++;
    }
    return { added };
  },
});

export const questionContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !answersEnabled(site)) return null;
  const business = businessOf(site);
  const existing = await ctx.db.query("answer_questions").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(200);
  return {
    business: { ...business, summary: site.siteSummary ?? site.niche ?? "", audience: site.targetAudienceSummary ?? "",
      features: site.keyFeatures ?? [], problems: site.painPoints ?? [], usage: site.productUsage ?? "", pricing: site.pricingInfo ?? "",
      market: site.targetCountry ?? "", siteType: site.siteType ?? "", language: site.language ?? "en" },
    existing: existing.map((q) => q.question),
    active: existing.filter((q) => q.status === "active").length,
  };
} });

// ── Runs ──

/** A run asks every active question (or the given ones) of every assistant. One run at a time per site. */
async function createRun(ctx: MutationCtx, site: Doc<"sites">, kind: "snapshot" | "weekly" | "recheck", questionIds?: Id<"answer_questions">[]) {
  const running = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).order("desc").first();
  if (running && running.status === "asking") return { runId: running._id, created: false };
  const questions = questionIds
    ? (await Promise.all(questionIds.map((id) => ctx.db.get(id)))).filter((q): q is Doc<"answer_questions"> => !!q && q.siteId === site._id && q.status === "active")
    : await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "active")).take(ANSWERS_MAX_ACTIVE_QUESTIONS);
  if (!questions.length) throw new ConvexError("No questions to ask yet.");
  const assistants = [...ANSWER_ASSISTANTS];
  const jobs = questions.flatMap((q) => assistants.map((assistant) => ({ questionId: q._id, assistant })));
  const now = Date.now();
  const runId = await ctx.db.insert("answer_runs", { siteId: site._id, kind, status: "asking", createdAt: now, startedAt: now,
    country: businessOf(site).country, assistants, jobs, nextJob: 0, done: 0, answered: 0, named: 0, cited: 0, failed: 0, noAnswer: 0,
    costMicroUsd: 0, progress: assistants.map((assistant) => ({ assistant, done: 0, answered: 0, named: 0 })),
    ...(kind === "snapshot" ? { followUp: "draft_first_pages" } : kind === "weekly" ? { followUp: "weekly_loop" } : {}) });
  await ctx.scheduler.runAfter(0, internal.actions.answers.askBatch, { runId });
  return { runId, created: true };
}

export const startRunInternal = internalMutation({
  args: { siteId: v.id("sites"), kind: v.union(v.literal("snapshot"), v.literal("weekly"), v.literal("recheck")), questionIds: v.optional(v.array(v.id("answer_questions"))) },
  handler: async (ctx, { siteId, kind, questionIds }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !answersEnabled(site)) return null;
    const access = await siteAnswersAccess(ctx, site);
    if (kind !== "snapshot" && !answersAllows(access).recheck) return null;
    if (kind === "snapshot" && access === "free" && site.answers?.lastSnapshotRunId) {
      // The free hour runs once; one that failed before any answer came back (a provider outage) may run again.
      const last = await ctx.db.get(site.answers.lastSnapshotRunId);
      if (!last || !(last.status === "failed" && last.answered === 0)) return null;
    }
    const created = await createRun(ctx, site, kind, questionIds);
    if (created.created && kind === "snapshot") {
      const settings = { ...site.answers! };
      delete settings.setupError;
      delete settings.setupErrorAt;
      await ctx.db.patch(siteId, { answers: { ...settings, lastSnapshotRunId: created.runId, ...(access === "free" ? { freeSnapshotAt: Date.now() } : {}) } });
    }
    return created.runId;
  },
});

/** A worker's slice of a run: the next jobs, under a lease so two workers never ask the same question twice. */
export const claimBatch = internalMutation({ args: { runId: v.id("answer_runs") }, handler: async (ctx, { runId }) => {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "asking") return null;
  const now = Date.now();
  if (run.leaseUntil && run.leaseUntil > now) return null;
  const site = await ctx.db.get(run.siteId);
  if (!site) return null;
  if (run.nextJob >= run.jobs.length) return { jobs: [], run: { siteId: run.siteId, country: run.country }, business: businessOf(site) };
  const slice = run.jobs.slice(run.nextJob, run.nextJob + ANSWERS_BATCH_JOBS).map((job, i) => ({ ...job, index: run.nextJob + i }));
  await ctx.db.patch(runId, { nextJob: run.nextJob + slice.length, leaseUntil: now + ANSWERS_BATCH_LEASE_MS });
  const questions = new Map<string, string>();
  for (const job of slice) if (!questions.has(job.questionId)) {
    const q = await ctx.db.get(job.questionId);
    if (q) questions.set(job.questionId, q.question);
  }
  return {
    run: { siteId: run.siteId, country: run.country },
    business: businessOf(site),
    jobs: slice.flatMap((job) => questions.has(job.questionId) ? [{ ...job, question: questions.get(job.questionId)! }] : []),
  };
} });

const checkInput = v.object({
  questionId: v.id("answer_questions"), question: v.string(), assistant: v.string(), status: v.string(), error: v.optional(v.string()),
  excerpt: v.string(), textChars: v.number(), named: v.boolean(), cited: v.boolean(), position: v.optional(v.number()), brandsNamed: v.number(),
  competitorsNamed: v.array(v.string()),
  sources: v.array(v.object({ url: v.string(), title: v.optional(v.string()), domain: v.string(), own: v.boolean() })),
  citedPageUrls: v.array(v.string()), endpoint: v.string(), costMicroUsd: v.number(),
});

/** One answer, stored the moment it arrives (the live first hour streams these), with its full text kept apart. */
export const recordCheck = internalMutation({ args: { runId: v.id("answer_runs"), check: checkInput, text: v.optional(v.string()) },
  handler: async (ctx, { runId, check, text }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "asking" || !isAnswerAssistant(check.assistant)) return null;
    const checkId = await ctx.db.insert("answer_checks", { siteId: run.siteId, runId, askedAt: Date.now(), country: run.country, ...check,
      excerpt: check.excerpt.slice(0, 900), competitorsNamed: check.competitorsNamed.slice(0, 12), sources: check.sources.slice(0, 20),
      citedPageUrls: check.citedPageUrls.slice(0, 10) });
    if (text && check.status === "answered") await ctx.db.insert("answer_texts", { siteId: run.siteId, checkId, text: text.slice(0, 40_000) });
    const answered = check.status === "answered";
    const progress = (run.progress ?? run.assistants.map((assistant) => ({ assistant, done: 0, answered: 0, named: 0 })))
      .map((p) => p.assistant === check.assistant ? { assistant: p.assistant, done: p.done + 1, answered: p.answered + (answered ? 1 : 0),
        named: p.named + (answered && check.named ? 1 : 0) } : p);
    await ctx.db.patch(runId, { progress, done: run.done + 1, answered: run.answered + (answered ? 1 : 0), named: run.named + (answered && check.named ? 1 : 0),
      cited: run.cited + (answered && check.cited ? 1 : 0), failed: run.failed + (check.status === "error" ? 1 : 0),
      noAnswer: run.noAnswer + (check.status === "no_answer" ? 1 : 0), costMicroUsd: run.costMicroUsd + Math.max(0, check.costMicroUsd) });
    return checkId;
  } });

/** A worker finished its slice: the lease is released so the next slice can start at once. */
export const releaseBatch = internalMutation({ args: { runId: v.id("answer_runs") }, handler: async (ctx, { runId }) => {
  const run = await ctx.db.get(runId);
  if (run && run.status === "asking") await ctx.db.patch(runId, { leaseUntil: 0 });
  return run ? { remaining: run.jobs.length - run.nextJob, done: run.done, total: run.jobs.length } : null;
} });

/** A run that can't go on (its spend was refused, the provider isn't configured): stopped with the reason the owner sees. */
export const failRun = internalMutation({ args: { runId: v.id("answer_runs"), error: v.string() }, handler: async (ctx, { runId, error }) => {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "asking") return;
  await ctx.db.patch(runId, { status: "failed", error: error.slice(0, 300), finishedAt: Date.now(), leaseUntil: 0 });
} });

/** The service's daily limit was reached: this run's next slice waits, then continues by itself. */
export const deferBatch = internalMutation({ args: { runId: v.id("answer_runs"), untilMs: v.number() }, handler: async (ctx, { runId, untilMs }) => {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "asking") return;
  const resumeAt = Date.now() + Math.max(60_000, Math.min(12 * 3_600_000, untilMs));
  // Nothing of the claimed slice was sent (its hold was refused): it goes back, so the next job is the first unanswered one.
  await ctx.db.patch(runId, { leaseUntil: resumeAt, nextJob: run.done });
  await ctx.scheduler.runAt(resumeAt, internal.actions.answers.askBatch, { runId });
} });

/** Setting up the first hour failed before any asking (the questions couldn't be written): the owner sees why. */
export const noteSetupError = internalMutation({ args: { siteId: v.id("sites"), error: v.string() }, handler: async (ctx, { siteId, error }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.answers) return;
  await ctx.db.patch(siteId, { answers: { ...site.answers, setupError: error.slice(0, 300), setupErrorAt: Date.now() } });
} });

/** All answers in: the run's totals, each question's latest result and opportunity, and every citation of the site's own
 * pages recorded as a win. Then what follows (the first pages after a snapshot). */
export const finishRun = internalMutation({ args: { runId: v.id("answer_runs") }, handler: async (ctx, { runId }) => {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "asking") return null;
  const checks = await ctx.db.query("answer_checks").withIndex("by_run", (q) => q.eq("runId", runId)).take(2000);
  const totals = runTotals(checks);
  const now = Date.now();
  await ctx.db.patch(runId, { status: "done", finishedAt: now, leaseUntil: 0, byAssistant: totals.byAssistant, competitors: totals.competitors,
    topSources: totals.topSources, done: checks.length, answered: totals.answered, named: totals.named, cited: totals.cited, failed: totals.failed,
    noAnswer: totals.noAnswer });
  const byQuestion = new Map<string, Doc<"answer_checks">[]>();
  for (const c of checks) byQuestion.set(c.questionId, [...(byQuestion.get(c.questionId) ?? []), c]);
  const judged: Array<{ question: Doc<"answer_questions">; list: Doc<"answer_checks">[]; opportunity: ReturnType<typeof questionOpportunity> }> = [];
  for (const [questionId, list] of byQuestion) {
    const question = await ctx.db.get(questionId as Id<"answer_questions">);
    if (question) judged.push({ question, list, opportunity: questionOpportunity(question.question, list) });
  }
  // "Winnable" is the short list of the strongest openings (a third of the questions at most), not every unnamed question.
  for (const { question, list, opportunity } of rankOpportunities(judged)) {
    const answered = list.filter((c) => c.status === "answered");
    const rivalCounts = new Map<string, number>();
    for (const c of answered) for (const name of new Set(c.competitorsNamed)) rivalCounts.set(name, (rivalCounts.get(name) ?? 0) + 1);
    await ctx.db.patch(question._id, {
      latest: { runId, at: now, answered: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length,
        assistantsNamed: [...new Set(answered.filter((c) => c.named).map((c) => c.assistant))],
        competitorsNamed: [...rivalCounts].map(([name, answers]) => ({ name, answers })).sort((a, b) => b.answers - a.answers).slice(0, 6) },
      opportunity: { ...opportunity, at: now },
    });
  }
  // Wins: an answer citing one of the site's pages; a Pentra page by its published address.
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", run.siteId).eq("status", "published")).take(500);
  const pageByUrl = new Map(pages.filter((p) => p.publishedUrl).map((p) => [normalizeUrl(p.publishedUrl!), p]));
  for (const c of checks) for (const url of c.citedPageUrls) {
    const page = pageByUrl.get(normalizeUrl(url));
    const earlier = page ? await ctx.db.query("answer_citations").withIndex("by_page", (q) => q.eq("pageId", page._id)).first() : null;
    await ctx.db.insert("answer_citations", { siteId: run.siteId, questionId: c.questionId, ...(page ? { pageId: page._id } : {}), checkId: c._id,
      assistant: c.assistant, kind: page ? "page_cited" : "site_cited", url, at: c.askedAt, first: page ? !earlier : false });
    if (page) await ctx.db.patch(page._id, { citations: page.citations + 1, lastCitedAt: c.askedAt });
  }
  const site = await ctx.db.get(run.siteId);
  if (site?.answers) {
    await ctx.db.patch(site._id, { answers: { ...site.answers, ...(run.kind === "recheck" ? { lastRecheckAt: now } : { lastFullRunAt: now }) } });
  }
  if (run.followUp === "draft_first_pages") {
    await ctx.scheduler.runAfter(0, internal.actions.answerPages.draftTop, { siteId: run.siteId, count: 5 });
    // "Your first hour is ready", for an owner who closed the tab: sent once the first drafts have had time to be written.
    await ctx.scheduler.runAfter(ANSWERS_READY_EMAIL_DELAY_MS, internal.actions.answerEmail.sendSnapshotReady, { siteId: run.siteId, runId });
  }
  if (run.followUp === "weekly_loop") await ctx.scheduler.runAfter(0, internal.actions.answerPages.weeklyLoop, { siteId: run.siteId, runId });
  return totals;
} });
const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/$/, "");

/** A run whose worker died (its lease ran out with jobs left) is picked up again; one with every job asked is finished. */
export const resumeStalledRuns = internalMutation({ args: {}, handler: async (ctx) => {
  const asking = await ctx.db.query("answer_runs").withIndex("by_status", (q) => q.eq("status", "asking")).take(200);
  const now = Date.now();
  let resumed = 0;
  for (const run of asking) {
    if (run.leaseUntil && run.leaseUntil > now) continue;
    if (now - (run.startedAt ?? run.createdAt) > 6 * 3_600_000) {
      await ctx.db.patch(run._id, { status: "failed", error: "The run didn't finish within six hours.", finishedAt: now });
      continue;
    }
    if (run.nextJob < run.jobs.length) await ctx.scheduler.runAfter(0, internal.actions.answers.askBatch, { runId: run._id });
    else await ctx.scheduler.runAfter(0, internal.answers.finishRun, { runId: run._id });
    resumed++;
  }
  return { resumed };
} });

// ── The owner's views ──

const publicRun = (run: Doc<"answer_runs">) => ({
  runId: run._id, kind: run.kind, status: run.status, createdAt: run.createdAt, finishedAt: run.finishedAt ?? null, country: run.country,
  total: run.jobs.length, done: run.done, answered: run.answered, named: run.named, cited: run.cited, failed: run.failed, noAnswer: run.noAnswer,
  byAssistant: run.byAssistant ?? null, competitors: run.competitors ?? null, topSources: run.topSources ?? null, error: run.error ?? null,
});

/** Everything the dashboard's overview needs, bounded: the latest runs, the questions with their latest result, the pages,
 * the latest citations, and what the plan allows. */
export const overview = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedAnswersSite(ctx, siteId);
  if (!site) return null;
  const access = await siteAnswersAccess(ctx, site);
  const runs = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").take(13);
  const questions = await ctx.db.query("answer_questions").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(120);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(200);
  const citations = await ctx.db.query("answer_citations").withIndex("by_site_at", (q) => q.eq("siteId", siteId)).order("desc").take(20);
  const business = businessOf(site);
  const allows = answersAllows(access);
  // The weekly run: due a week after the last full run, started by the hourly dispatcher (so "within the hour" once due).
  const nextRunAt = allows.weekly && site.answers?.lastFullRunAt && runs[0]?.status !== "asking"
    ? Math.max(site.answers.lastFullRunAt + ANSWERS_WEEK_MS, Date.now()) : null;
  return {
    site: { siteId, domain: site.domain, name: business.name, country: business.country, competitors: business.competitors, nextRunAt,
      confirmedAt: site.answers?.confirmedAt ?? null, setupError: site.answers?.setupError ?? null, publishing: site.answers?.publishing ?? null, autopublish: site.answers?.autopublish !== false,
      weeklyEmail: site.answers?.weeklyEmail !== false },
    access, allows,
    runs: runs.map(publicRun),
    trend: runs.filter((r) => r.status === "done" && r.kind !== "recheck").reverse().map((r) => ({ at: r.finishedAt ?? r.createdAt, answered: r.answered, named: r.named,
      cited: r.cited, competitors: r.competitors ?? [] })),
    questions: questions.filter((q) => q.status !== "removed").map((q) => ({ questionId: q._id, question: q.question, intent: q.intent, source: q.source,
      status: q.status, createdAt: q.createdAt, latest: q.latest ?? null, opportunity: q.opportunity ?? null, pageId: q.pageId ?? null })),
    pages: pages.map((p) => ({ pageId: p._id, questionId: p.questionId, question: p.question, status: p.status, title: p.title, slug: p.slug,
      publishedUrl: p.publishedUrl ?? null, publishedAt: p.publishedAt ?? null, liveAt: p.liveAt ?? null, indexNow: p.indexNow ?? null, citations: p.citations,
      lastCitedAt: p.lastCitedAt ?? null, updatedAt: p.updatedAt, issues: p.issues, publishError: p.publishError ?? null,
      words: p.markdown.split(/\s+/).filter(Boolean).length, sources: p.sources.length, facts: p.facts.length })),
    citations: citations.map((c) => ({ citationId: c._id, checkId: c.checkId, questionId: c.questionId, pageId: c.pageId ?? null, assistant: c.assistant,
      kind: c.kind, url: c.url, at: c.at, first: c.first })),
  };
} });

/** A run while it asks: progress, per assistant, and the newest answers for the live feed. */
export const runProgress = query({ args: { runId: v.id("answer_runs") }, handler: async (ctx, { runId }) => {
  const run = await ctx.db.get(runId);
  if (!run || !(await ownedAnswersSite(ctx, run.siteId))) return null;
  const latest = await ctx.db.query("answer_checks").withIndex("by_run", (q) => q.eq("runId", runId)).order("desc").take(12);
  const perAssistant = run.assistants.map((assistant) => {
    const live = run.progress?.find((p) => p.assistant === assistant);
    const final = run.byAssistant?.find((b) => b.assistant === assistant);
    return { assistant, total: run.jobs.filter((j) => j.assistant === assistant).length,
      done: live?.done ?? final?.asked ?? 0, answered: live?.answered ?? final?.answered ?? 0, named: live?.named ?? final?.named ?? 0 };
  });
  return { ...publicRun(run), perAssistant, feed: latest.map(publicCheck) };
} });

const publicCheck = (c: Doc<"answer_checks">) => ({
  checkId: c._id, questionId: c.questionId, question: c.question, assistant: c.assistant, askedAt: c.askedAt, country: c.country, status: c.status,
  error: c.error ?? null, excerpt: c.excerpt, textChars: c.textChars, named: c.named, cited: c.cited, position: c.position ?? null,
  brandsNamed: c.brandsNamed, competitorsNamed: c.competitorsNamed, sources: c.sources, citedPageUrls: c.citedPageUrls,
});

/** Every answer one question got (newest first, across runs): the evidence behind its counts. */
export const questionEvidence = query({ args: { questionId: v.id("answer_questions"), limit: v.optional(v.number()) }, handler: async (ctx, { questionId, limit }) => {
  const question = await ctx.db.get(questionId);
  if (!question || !(await ownedAnswersSite(ctx, question.siteId))) return null;
  const checks = await ctx.db.query("answer_checks").withIndex("by_question_asked", (q) => q.eq("questionId", questionId)).order("desc")
    .take(Math.max(1, Math.min(60, Math.floor(limit ?? 25))));
  return { question: question.question, opportunity: question.opportunity ?? null, latest: question.latest ?? null, checks: checks.map(publicCheck) };
} });

/** The answers of one run (the snapshot's full log), filterable by assistant and outcome, paged by the caller's limit. */
export const runAnswers = query({ args: { runId: v.id("answer_runs"), limit: v.optional(v.number()) }, handler: async (ctx, { runId, limit }) => {
  const run = await ctx.db.get(runId);
  if (!run || !(await ownedAnswersSite(ctx, run.siteId))) return null;
  const checks = await ctx.db.query("answer_checks").withIndex("by_run", (q) => q.eq("runId", runId)).take(Math.max(1, Math.min(400, Math.floor(limit ?? 400))));
  return checks.map(publicCheck);
} });

/** One answer in full, exactly as the assistant gave it. */
export const answerText = query({ args: { checkId: v.id("answer_checks") }, handler: async (ctx, { checkId }) => {
  const check = await ctx.db.get(checkId);
  if (!check || !(await ownedAnswersSite(ctx, check.siteId))) return null;
  const text = await ctx.db.query("answer_texts").withIndex("by_check", (q) => q.eq("checkId", checkId)).first();
  return { ...publicCheck(check), text: text?.text ?? null };
} });

// ── The owner's actions ──

/** "Looks right": the owner confirms the business and its competitors, and Pentra starts the first hour. */
export const confirmSetup = mutation({
  args: { siteId: v.id("sites"), name: v.optional(v.string()), competitors: v.array(v.object({ name: v.string(), domain: v.optional(v.string()) })),
    country: v.optional(v.string()) },
  handler: async (ctx, { siteId, name, competitors, country }) => {
    const site = await requireOwnedAnswersSite(ctx, siteId);
    const cleaned = competitors.map((c) => ({ name: c.name.trim().slice(0, 60), ...(c.domain ? { domain: hostOf(c.domain) } : {}) }))
      .filter((c) => c.name.length >= 2).slice(0, 8);
    const now = Date.now();
    await ctx.db.patch(siteId, { ...(name?.trim() ? { siteName: name.trim().slice(0, 80) } : {}),
      answers: { ...site.answers!, competitors: cleaned, ...(country ? { country: countryCode(country) } : {}), confirmedAt: site.answers?.confirmedAt ?? now },
      updatedAt: now });
    if (cleaned.some((c) => c.domain && nameFromDomainOnly(c.name, c.domain))) await ctx.scheduler.runAfter(0, internal.actions.answersSetup.nameCompetitors, { siteId });
    // After a setup error ("Try again"), the first hour starts again at once; otherwise never twice within 30 minutes.
    const failedSetup = Boolean(site.answers?.setupError);
    if (!site.answers?.lastSnapshotRunId && (failedSetup || !(site.answers?.snapshotRequestedAt && now - site.answers.snapshotRequestedAt < 30 * 60_000))) {
      const fresh = { ...(await ctx.db.get(siteId))!.answers! };
      delete fresh.setupError;
      delete fresh.setupErrorAt;
      await ctx.db.patch(siteId, { answers: { ...fresh, snapshotRequestedAt: now } });
      await ctx.scheduler.runAfter(0, internal.actions.answers.prepareSnapshot, { siteId });
    }
    return { ok: true };
  },
});

/** A competitor's proper name, found on its own site; never replaces a name the owner typed. */
export const renameCompetitor = internalMutation({ args: { siteId: v.id("sites"), domain: v.string(), name: v.string() },
  handler: async (ctx, { siteId, domain, name }) => {
    const site = await ctx.db.get(siteId);
    if (!site?.answers?.competitors) return;
    const proper = properCompetitorName(name, domain);
    if (!proper) return;
    const competitors = site.answers.competitors.map((c) => c.domain && hostOf(c.domain) === hostOf(domain) && nameFromDomainOnly(c.name, c.domain)
      ? { ...c, name: proper } : c);
    await ctx.db.patch(siteId, { answers: { ...site.answers, competitors } });
  } });

export const addQuestion = mutation({ args: { siteId: v.id("sites"), question: v.string() }, handler: async (ctx, { siteId, question }) => {
  const site = await requireOwnedAnswersSite(ctx, siteId);
  const cleaned = cleanQuestion(question.endsWith("?") ? question : `${question.trim()}?`, businessOf(site));
  if (!cleaned) throw new ConvexError("Write it as one question your buyers would ask, without your business's name.");
  const key = questionKey(cleaned);
  const existing = await ctx.db.query("answer_questions").withIndex("by_site_key", (q) => q.eq("siteId", siteId).eq("key", key)).first();
  if (existing) {
    if (existing.status !== "active") await ctx.db.patch(existing._id, { status: "active" });
    return { questionId: existing._id };
  }
  const active = await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "active")).take(200);
  if (active.length >= ANSWERS_MAX_ACTIVE_QUESTIONS) throw new ConvexError(`You're tracking ${ANSWERS_MAX_ACTIVE_QUESTIONS} questions, the most at once. Pause one first.`);
  const questionId = await ctx.db.insert("answer_questions", { siteId, question: cleaned, key, intent: "problem", source: "owner", status: "active", createdAt: Date.now() });
  return { questionId };
} });

export const setQuestionStatus = mutation({ args: { questionId: v.id("answer_questions"), status: v.union(v.literal("active"), v.literal("paused"), v.literal("removed")) },
  handler: async (ctx, { questionId, status }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new ConvexError("Question not found.");
    await requireOwnedAnswersSite(ctx, question.siteId);
    await ctx.db.patch(questionId, { status });
    return { ok: true };
  } });

export const setPreferences = mutation({ args: { siteId: v.id("sites"), autopublish: v.optional(v.boolean()), weeklyEmail: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, autopublish, weeklyEmail }) => {
    const site = await requireOwnedAnswersSite(ctx, siteId);
    await ctx.db.patch(siteId, { answers: { ...site.answers!, ...(autopublish !== undefined ? { autopublish } : {}),
      ...(weeklyEmail !== undefined ? { weeklyEmail } : {}) }, updatedAt: Date.now() });
    return { ok: true };
  } });

/** The owner asks for a fresh run now (the plan only): every active question to every assistant. */
export const runNow = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await requireOwnedAnswersSite(ctx, siteId);
  const access = await siteAnswersAccess(ctx, site);
  if (!answersAllows(access).recheck) throw new ConvexError("Re-asking the assistants is part of the Pentra plan.");
  const last = await ctx.db.query("answer_runs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").first();
  if (last && last.status === "asking") return { runId: last._id };
  if (last && Date.now() - last.createdAt < 6 * 3_600_000) throw new ConvexError("The assistants were asked less than six hours ago. Try again later.");
  return await createRun(ctx, site, "weekly");
} });

// ── New accounts ──

/** One website per account on Pentra Answers (Pentra's own sites aside). */
export const ANSWERS_SITES_PER_ACCOUNT = 1;

/** A new account's website: created on Pentra Answers, then read so the owner can confirm what Pentra understood. */
export const createSite = mutation({ args: { domain: v.string(), email: v.optional(v.string()) }, handler: async (ctx, { domain, email }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first.");
  await recordFirstContact(ctx, identity, email);
  const host = normalizeNewDomain(domain);
  if (!host) throw new ConvexError("Enter your website's address, like yourbusiness.com.");
  const mine = await ctx.db.query("sites").withIndex("by_user", (q) => q.eq("userId", identity.subject)).take(200);
  const existing = mine.find((s) => !s.deletionStatus && hostOf(s.domain) === host);
  if (existing) {
    if (!answersEnabled(existing)) await ctx.db.patch(existing._id, { answers: { enabled: true, enabledAt: Date.now(), source: "switch" }, updatedAt: Date.now() });
    return { siteId: existing._id, created: false };
  }
  const answersSites = mine.filter((s) => !s.deletionStatus && answersEnabled(s) && !isAnswersOwnerDomain(s.domain));
  if (!isAnswersOwnerDomain(host) && answersSites.length >= ANSWERS_SITES_PER_ACCOUNT) {
    throw new ConvexError(`Your account already tracks ${answersSites[0].domain}. One website per account for now; contact us to add another.`);
  }
  const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", (q) => q.eq("userId", identity.subject)).unique();
  const now = Date.now();
  const siteId = await ctx.db.insert("sites", { domain: host, canonicalDomain: host, canonicalDomainRevision: 0, userId: identity.subject,
    planFeatures: entitlement?.planFeatures ?? [], language: "en", autopilotEnabled: false, approvalRequired: false, cadencePerWeek: 0,
    publishMethod: "manual", urlStructure: "/blog/[slug]", autopilotRolloutMode: "observe", autopilotRolloutEpoch: 0, publisherConnectionGeneration: 0,
    answers: { enabled: true, enabledAt: now, source: "signup", autopublish: true, weeklyEmail: true }, createdAt: now, updatedAt: now });
  await ctx.db.insert("usage_log", { userId: identity.subject, siteId, type: "site_added", createdAt: now });
  await ctx.scheduler.runAfter(0, internal.actions.answersSetup.readSite, { siteId });
  return { siteId, created: true };
} });

/** Where the first-hour email goes: the sign-in's verified address when the token carries one, else the address the
 * signed-in page passed (Clerk's primary address). Only a first address is recorded here; billing's sync, which reads the
 * verified address from Clerk on the server, stays the authority and corrects it. A deleted account never gets one again. */
async function recordFirstContact(ctx: MutationCtx, identity: UserIdentity, passed: string | undefined) {
  const claimed = typeof identity.email === "string" && identity.emailVerified !== false ? identity.email : null;
  const email = plausibleEmail(claimed ?? passed ?? "");
  if (!email) return;
  if (await ctx.db.query("account_deletion_receipts").withIndex("by_account_key", (q) => q.eq("accountKey", accountDeletionKey(identity.subject))).first()) return;
  if (await ctx.db.query("account_contacts").withIndex("by_user", (q) => q.eq("userId", identity.subject)).first()) return;
  await ctx.db.insert("account_contacts", { userId: identity.subject, email, emailUpdates: true, updatedAt: Date.now() });
}

export const competitorsToName = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  return (site?.answers?.competitors ?? []).flatMap((c) => c.domain && nameFromDomainOnly(c.name, c.domain) ? [{ domain: hostOf(c.domain) }] : []).slice(0, 8);
} });

export const setupSite = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  return site && answersEnabled(site) ? { domain: hostOf(site.domain) } : null;
} });

export const saveSetupRead = internalMutation({
  args: { siteId: v.id("sites"), error: v.optional(v.string()), force: v.optional(v.boolean()), then: v.optional(v.literal("snapshot")),
    competitorsOnly: v.optional(v.boolean()),
    read: v.optional(v.object({ name: v.string(), sells: v.string(), buyers: v.string(), offerings: v.array(v.string()), country: v.string(), local: v.boolean(),
      location: v.string(), competitors: v.array(v.object({ name: v.string(), domain: v.string() })) })) },
  handler: async (ctx, { siteId, read, error, force, then, competitorsOnly }) => {
    const site = await ctx.db.get(siteId);
    if (!site?.answers) return;
    const now = Date.now();
    // Only the suggested competitors, for a site that has none (Pentra's own sites); its confirmed facts stay as they are.
    if (competitorsOnly) {
      if (read?.competitors.length && !site.answers.competitors?.length) await ctx.db.patch(siteId, { answers: { ...site.answers, competitors: read.competitors } });
      return;
    }
    if (!read) {
      await ctx.db.patch(siteId, { answers: { ...site.answers, readAt: now, readError: (error ?? "Pentra couldn't read the site.").slice(0, 300) } });
      if (then === "snapshot") await ctx.scheduler.runAfter(0, internal.actions.answers.prepareSnapshot, { siteId });
      return;
    }
    // The owner's own edits are never overwritten by a later read; a forced read (Pentra's own sites, re-read by code
    // after their relaunch) replaces the profile it made itself.
    const confirmed = Boolean(site.answers.confirmedAt) && !(force && isAnswersOwnerDomain(site.domain));
    await ctx.db.patch(siteId, {
      ...(!site.siteName && read.name ? { siteName: read.name } : {}),
      ...(!confirmed && read.sells ? { siteSummary: read.sells } : {}),
      ...(!confirmed && read.buyers ? { targetAudienceSummary: read.buyers } : {}),
      ...(!confirmed && read.offerings.length ? { keyFeatures: read.offerings } : {}),
      ...(!confirmed && read.country ? { targetCountry: read.country } : {}),
      answers: { ...site.answers, readAt: now, readError: undefined, local: read.local, ...(read.location ? { location: read.location } : {}),
        ...(read.country && !site.answers.country ? { country: read.country } : {}),
        ...(!confirmed && !site.answers.competitors?.length ? { competitors: read.competitors } : {}) },
      updatedAt: now,
    });
    if (then === "snapshot") await ctx.scheduler.runAfter(0, internal.actions.answers.prepareSnapshot, { siteId });
  } });

/** The setup screen's state: what Pentra read (or why it couldn't), the suggested competitors, and the first run once it
 * starts. */
export const setupState = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedAnswersSite(ctx, siteId);
  if (!site) return null;
  const run = site.answers?.lastSnapshotRunId ? await ctx.db.get(site.answers.lastSnapshotRunId) : null;
  const questions = await ctx.db.query("answer_questions").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "active")).take(60);
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(20);
  return {
    siteId, domain: site.domain, name: site.siteName ?? null, sells: site.siteSummary ?? "", buyers: site.targetAudienceSummary ?? "",
    offerings: site.keyFeatures ?? [], country: site.answers?.country ?? (site.targetCountry ? countryCode(site.targetCountry) : null),
    local: site.answers?.local ?? false, location: site.answers?.location ?? null,
    competitors: site.answers?.competitors ?? [], readAt: site.answers?.readAt ?? null, readError: site.answers?.readError ?? null,
    confirmedAt: site.answers?.confirmedAt ?? null, setupError: site.answers?.setupError ?? null,
    questions: questions.map((q) => ({ questionId: q._id, question: q.question, intent: q.intent })),
    run: run ? publicRun(run) : null,
    pages: pages.map((p) => ({ pageId: p._id, question: p.question, title: p.title, status: p.status, words: p.markdown.split(/\s+/).filter(Boolean).length,
      sources: p.sources.length, facts: p.facts.length })),
    access: await siteAnswersAccess(ctx, site),
  };
} });

/** The owner corrects what Pentra read before confirming (or later, in Settings). */
export const updateBusiness = mutation({
  args: { siteId: v.id("sites"), name: v.string(), sells: v.string(), buyers: v.string(), offerings: v.array(v.string()),
    location: v.optional(v.string()), local: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, name, sells, buyers, offerings, location, local }) => {
    const site = await requireOwnedAnswersSite(ctx, siteId);
    if (!name.trim() || sells.trim().length < 10) throw new ConvexError("Say what the business sells in a sentence.");
    // The city or area a local business serves: the questions and pages are asked and written for it.
    const area = location?.replace(/\s+/g, " ").trim().slice(0, 80);
    await ctx.db.patch(siteId, { siteName: name.trim().slice(0, 80), siteSummary: sells.trim().slice(0, 600), targetAudienceSummary: buyers.trim().slice(0, 300),
      keyFeatures: offerings.map((o) => o.trim()).filter((o) => o.length > 1).slice(0, 10).map((o) => o.slice(0, 120)),
      ...(location !== undefined || local !== undefined ? { answers: { ...site.answers!, ...(local !== undefined ? { local } : {}),
        ...(location !== undefined ? (area ? { location: area, local: local ?? true } : { location: undefined }) : {}) } } : {}),
      updatedAt: Date.now() });
    return { ok: true };
  } });

/** The signed-in owner's websites, for the site switcher (Answers sites first). */
export const mySites = query({ args: {}, handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return [];
  const sites = await ctx.db.query("sites").withIndex("by_user", (q) => q.eq("userId", identity.subject)).take(50);
  return sites.filter((s) => !s.deletionStatus).map((s) => ({ siteId: s._id, domain: s.domain, name: s.siteName ?? null, answers: answersEnabled(s),
    confirmed: Boolean(s.answers?.confirmedAt) })).sort((a, b) => Number(b.answers) - Number(a.answers));
} });

/** An existing article customer moves this website to Pentra Answers (their articles stay where they are). */
export const switchToAnswers = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject || site.deletionStatus) throw new ConvexError("Site not found.");
  if (answersEnabled(site)) return { ok: true };
  await ctx.db.patch(siteId, { answers: { enabled: true, enabledAt: Date.now(), source: "switch", autopublish: true, weeklyEmail: true }, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.answersSetup.readSite, { siteId });
  return { ok: true };
} });
