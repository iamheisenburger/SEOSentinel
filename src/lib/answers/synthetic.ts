/**
 * The dev-only harness's store: SYNTHETIC data shaped exactly like ops/design/answers-api.md. Answers are generated as
 * text and judged by Pentra's real engine (convex/lib/answerEngine.ts: judgeAnswer, runTotals, questionOpportunity), so
 * every count on screen is computed from the answers it opens, the way the backend computes it. Mutations follow the
 * backend's rules and messages. Never used outside /e2e-acceptance (which returns 404 in production).
 */
import { ConvexError } from "convex/values";
import { answerSlug, cleanQuestion, judgeAnswer, questionKey, questionOpportunity, rankOpportunities, runTotals } from "../../../convex/lib/answerEngine.ts";
import { ASSISTANTS } from "../product-facts.ts";
import type { AnswersActions, ConnectionInput, QueryMap, QueryName } from "./backend.tsx";
import {
  DAY, HOUR, SYN_ADVICE, SYN_BUSINESS, SYN_COMPETITORS, SYN_LEGACY_SITE_ID, SYN_OPENERS, SYN_PAGE_FACTS, SYN_PAGE_SOURCES, SYN_QUESTIONS,
  SYN_SITE_ID, SYN_SOURCE_POOL, SYNTHETIC_NOW, synPageMarkdown,
} from "./synthetic-data.ts";
import type {
  AnswerPage, AnswersAccess, Check, Competitor, OverviewCitation, OverviewQuestion, Publishing, Run, RunKind, SiteConnection,
} from "./types.ts";

export const HARNESS_SCENARIOS = [
  "reading", "understood", "read-error", "first-hour", "setup-error", "run-failed", "results", "drafts", "dashboard", "new-plan",
] as const;
export type HarnessScenario = (typeof HARNESS_SCENARIOS)[number];
export type HarnessState = "ready" | "loading" | "error";
export type HarnessOptions = { scenario: HarnessScenario; access: AnswersAccess; state: HarnessState; live: boolean };

const ASSISTANT_IDS = ASSISTANTS.map((assistant) => assistant.id as string);
const MIN = 60_000;

/** Deterministic noise: the same scenario renders the same answers every time. */
function rand(...parts: number[]): number {
  let h = 2166136261;
  for (const part of parts) { h ^= part; h = Math.imul(h, 16777619); }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[], ...parts: number[]): T => list[Math.floor(rand(...parts) * list.length) % list.length]!;

type SiteRow = {
  siteId: string; domain: string; name: string | null; sells: string; buyers: string; offerings: string[]; country: string | null;
  local: boolean; location: string | null; competitors: Competitor[]; readAt: number | null; readError: string | null; confirmedAt: number | null;
  setupError: string | null; publishing: Publishing | null; autopublish: boolean; weeklyEmail: boolean; answers: boolean;
  lastSnapshotRunId: string | null; access: AnswersAccess; createdAt: number;
};
type QuestionRow = OverviewQuestion & { siteId: string; key: string; index: number };
type RunRow = { siteId: string; run: Run; jobs: { questionId: string; assistant: string }[]; checks: Check[]; texts: Map<string, string> };
type PageRow = Omit<AnswerPage, "history" | "citationList"> & { siteId: string };

type Db = {
  sites: SiteRow[];
  connection: SiteConnection;
  questions: QuestionRow[];
  runs: RunRow[];
  pages: PageRow[];
  citations: (OverviewCitation & { siteId: string })[];
};

/* ─── Answer text, judged by the real engine ───────────────────────────── */

const GENERIC: Record<string, string> = {
  recommendation: "Look for builders with recent local reviews, a written labor warranty and proof of insurance.",
  local: "Austin's Development Services Department reviews deck permits; plan on one to three weeks for review.",
  cost: "Labor is usually 40 to 60 percent of the total. Stairs, railings and a raised frame add the most.",
  comparison: "Composite resists rot and fading but gets hot in full sun; hardwood stays cooler and needs oil every year.",
  how_to: "Plan the layout, get the permit if the deck is over 30 inches high or attached to the house, then schedule the build.",
  problem: "Check for soft spots with a screwdriver, look at the ledger board where the deck meets the house, and replace boards that flex.",
};

function traitOf(name: string): string {
  if (name === SYN_BUSINESS.name) return SYN_BUSINESS.trait;
  return SYN_COMPETITORS.find((c) => c.name === name)?.trait ?? "is mentioned in local reviews";
}

function writeAnswer(q: QuestionRow, ai: number, brands: string[], perplexity: boolean): string {
  const opener = pick(SYN_OPENERS[q.intent] ?? SYN_OPENERS.how_to!, q.index, ai, 1);
  const lines = [opener, ""];
  if (brands.length) {
    brands.forEach((name, i) => lines.push(`${i + 1}. **${name}** ${traitOf(name)}.${perplexity ? ` [${i + 1}]` : ""}`));
    lines.push("");
  }
  lines.push(GENERIC[q.intent] ?? GENERIC.how_to!);
  lines.push("");
  lines.push(pick(SYN_ADVICE, q.index, ai, 2));
  return lines.join("\n");
}

const NAMED_PRIORITY: [number, string][] = [
  [0, "perplexity"], [0, "chatgpt"], [19, "perplexity"], [1, "chatgpt"], [2, "google_ai_mode"], [19, "chatgpt"], [13, "perplexity"],
  [2, "perplexity"], [0, "google_ai_mode"], [23, "chatgpt"], [1, "perplexity"], [13, "gemini"], [19, "google_ai_overview"], [5, "perplexity"],
  [14, "chatgpt"], [22, "perplexity"],
];

type RunPlan = {
  site: SiteRow; runId: string; kind: RunKind; createdAt: number; minutes: number; questions: QuestionRow[]; namedTarget: number;
  cites?: [number, string][]; errors?: [number, string][]; pagesByQuestion?: Map<string, PageRow>; status?: Run["status"]; done?: number; error?: string;
};

function makeRun(plan: RunPlan): RunRow {
  const { site, questions } = plan;
  const jobs = questions.flatMap((q) => ASSISTANT_IDS.map((assistant) => ({ questionId: q.questionId, assistant })));
  const answeredKey = (q: QuestionRow, a: string) => `${q.index}:${a}`;
  const isError = (q: QuestionRow, a: string) => (plan.errors ?? []).some(([qi, aa]) => qi === q.index && aa === a);
  const isNoAnswer = (q: QuestionRow, a: string) => a === "google_ai_overview" && rand(q.index, 77) < 0.17;
  const inRun = new Set(questions.map((q) => q.index));
  const named = new Set<string>();
  for (const [qi, a] of NAMED_PRIORITY) {
    if (named.size >= plan.namedTarget) break;
    const q = questions.find((row) => row.index === qi);
    if (!q || !inRun.has(qi) || isError(q, a) || isNoAnswer(q, a)) continue;
    named.add(answeredKey(q, a));
  }
  const cites = new Set((plan.cites ?? []).map(([qi, a]) => `${qi}:${a}`));
  const business = { name: site.name ?? SYN_BUSINESS.name, domain: site.domain, extraHosts: site.publishing?.hostedDomain ? [site.publishing.hostedDomain] : [] };
  const competitors = site.competitors;
  const limit = plan.done ?? jobs.length;
  const checks: Check[] = [];
  const texts = new Map<string, string>();
  jobs.slice(0, limit).forEach((job, jobIndex) => {
    const q = questions.find((row) => row.questionId === job.questionId)!;
    const ai = ASSISTANT_IDS.indexOf(job.assistant);
    const askedAt = Math.round(plan.createdAt + ((jobIndex + 1) / jobs.length) * plan.minutes * MIN + rand(q.index, ai, 3) * 20_000);
    const checkId = `${plan.runId}_c${jobIndex}`;
    const base = { checkId, questionId: q.questionId, question: q.question, assistant: job.assistant, askedAt, country: site.country ?? "US" };
    if (isError(q, job.assistant)) {
      checks.push({ ...base, status: "error", error: "The assistant didn't answer within 90 seconds.", excerpt: "", textChars: 0, named: false, cited: false,
        position: null, brandsNamed: 0, competitorsNamed: [], sources: [], citedPageUrls: [] });
      return;
    }
    if (isNoAnswer(q, job.assistant)) {
      checks.push({ ...base, status: "no_answer", error: null, excerpt: "", textChars: 0, named: false, cited: false, position: null, brandsNamed: 0,
        competitorsNamed: [], sources: [], citedPageUrls: [] });
      return;
    }
    const key = answeredKey(q, job.assistant);
    const factor = q.intent === "recommendation" || q.intent === "local" ? 1.7 : q.intent === "cost" || q.intent === "comparison" ? 0.9 : 0.45;
    const rivals = competitors.filter((c, ci) => rand(q.index, ai, ci, 5) < (SYN_COMPETITORS[ci]?.p ?? 0.1) * factor).map((c) => c.name);
    const page = plan.pagesByQuestion?.get(q.questionId);
    const cited = cites.has(key) && page?.publishedUrl;
    const withBusiness = named.has(key) || Boolean(cited);
    const brands = [...(withBusiness ? [business.name] : []), ...rivals]
      .map((name, i) => ({ name, order: rand(q.index, ai, i, 9) + (name === business.name ? 0.15 : 0) }))
      .sort((a, b) => a.order - b.order).map((b) => b.name);
    const text = writeAnswer(q, ai, brands, job.assistant === "perplexity");
    const pool = [...SYN_SOURCE_POOL].sort((a, b) => rand(q.index, ai, a.domain.length, 11) - rand(q.index, ai, b.domain.length, 11));
    const count = job.assistant === "google_ai_overview" ? 3 : 3 + Math.floor(rand(q.index, ai, 12) * 3);
    const sources = pool.slice(0, count).map((s) => ({ url: `https://www.${s.domain}${s.path}`, title: s.title }));
    if (cited && page?.publishedUrl) sources.unshift({ url: page.publishedUrl, title: page.title });
    const judged = judgeAnswer({ text, sources }, business, competitors);
    texts.set(checkId, text);
    checks.push({ ...base, status: "answered", error: null, excerpt: judged.excerpt, textChars: text.length, named: judged.named, cited: judged.cited,
      position: judged.position, brandsNamed: judged.brandsNamed, competitorsNamed: judged.competitorsNamed, sources: judged.sources,
      citedPageUrls: judged.citedPageUrls });
  });
  const status = plan.status ?? "done";
  const totals = runTotals(checks);
  const run: Run = {
    runId: plan.runId, kind: plan.kind, status, createdAt: plan.createdAt,
    finishedAt: status === "asking" ? null : plan.createdAt + plan.minutes * MIN + 4 * MIN,
    country: site.country ?? "US", total: jobs.length, done: checks.length, answered: totals.answered, named: totals.named, cited: totals.cited,
    failed: totals.failed, noAnswer: totals.noAnswer,
    byAssistant: status === "done" ? totals.byAssistant : null,
    competitors: status === "done" ? totals.competitors : null,
    topSources: status === "done" ? totals.topSources : null,
    error: plan.error ?? null,
  };
  return { siteId: site.siteId, run, jobs, checks, texts };
}

/** What finishRun records: each question's latest result and opportunity, and the citations of published pages. */
function finish(db: Db, row: RunRow) {
  const byQuestion = new Map<string, Check[]>();
  for (const c of row.checks) byQuestion.set(c.questionId, [...(byQuestion.get(c.questionId) ?? []), c]);
  const at = row.run.finishedAt ?? row.run.createdAt;
  const judged: Array<{ q: QuestionRow; list: Check[]; opportunity: ReturnType<typeof questionOpportunity> }> = [];
  for (const [questionId, list] of byQuestion) {
    const q = db.questions.find((x) => x.questionId === questionId);
    if (q) judged.push({ q, list, opportunity: questionOpportunity(q.question, list) });
  }
  for (const { q, list, opportunity } of rankOpportunities(judged)) {
    const answered = list.filter((c) => c.status === "answered");
    const rivalCounts = new Map<string, number>();
    for (const c of answered) for (const name of new Set(c.competitorsNamed)) rivalCounts.set(name, (rivalCounts.get(name) ?? 0) + 1);
    q.latest = { runId: row.run.runId, at, answered: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length,
      assistantsNamed: [...new Set(answered.filter((c) => c.named).map((c) => c.assistant))],
      competitorsNamed: [...rivalCounts].map(([name, answers]) => ({ name, answers })).sort((a, b) => b.answers - a.answers).slice(0, 6) };
    q.opportunity = { ...opportunity, at };
  }
  const norm = (url: string) => url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const published = db.pages.filter((p) => p.siteId === row.siteId && p.status === "published" && p.publishedUrl && (p.publishedAt ?? 0) <= at);
  for (const c of row.checks) for (const url of c.citedPageUrls) {
    const page = published.find((p) => norm(p.publishedUrl!) === norm(url));
    const earlier = page ? db.citations.some((x) => x.pageId === page.pageId) : false;
    db.citations.push({ siteId: row.siteId, citationId: `cit_${c.checkId}`, checkId: c.checkId, questionId: c.questionId, pageId: page?.pageId ?? null,
      assistant: c.assistant, kind: page ? "page_cited" : "site_cited", url, at: c.askedAt, first: page ? !earlier : false });
    if (page) { page.citations += 1; page.lastCitedAt = c.askedAt; }
  }
}

/* ─── Scenarios ────────────────────────────────────────────────────────── */

function makeQuestions(site: SiteRow, createdAt: number): QuestionRow[] {
  return SYN_QUESTIONS.map((q, index) => ({ siteId: site.siteId, questionId: `q_${index}`, question: q.question, intent: q.intent, source: "generated",
    status: "active", createdAt: createdAt + index * 1000, latest: null, opportunity: null, pageId: null, key: questionKey(q.question), index }));
}

function makePage(site: SiteRow, q: QuestionRow, args: { title: string; status: string; createdAt: number; updatedAt?: number; version?: number;
  publishedAt?: number | null; indexNow?: { at: number; status: string } | null; publishError?: string | null; notWrittenReason?: string | null;
  rewriteReason?: string | null; issues?: string[]; markdown?: string; googleSitemapAt?: number | null; pageId?: string; liveAt?: number | null }): PageRow {
  const slug = answerSlug(q.question);
  const publishedAt = args.publishedAt ?? null;
  const writing = args.status === "writing" || args.status === "not_written";
  return {
    siteId: site.siteId, pageId: args.pageId ?? `p_${q.index}_v${args.version ?? 1}`, questionId: q.questionId, question: q.question, status: args.status,
    title: writing ? q.question : args.title, slug, metaDescription: writing ? "" : `${args.title}: what it costs, what Austin requires and what to ask, from the sources assistants cite.`.slice(0, 170),
    markdown: writing ? "" : args.markdown ?? synPageMarkdown(q.question, args.title),
    facts: writing ? [] : SYN_PAGE_FACTS.map((f) => ({ ...f })),
    sources: writing ? [] : SYN_PAGE_SOURCES.map((s, i) => ({ n: i + 1, ...s, retrievedAt: args.createdAt - 20 * MIN })),
    issues: args.issues ?? [], version: args.version ?? 1, updatedAt: args.updatedAt ?? Math.max(args.createdAt, publishedAt ?? 0), createdAt: args.createdAt,
    publishedUrl: publishedAt || args.status === "retired" ? `https://${site.domain}/blog/${slug}` : null, publishedAt,
    publishError: args.publishError ?? null, indexNow: args.indexNow ?? null, googleSitemapAt: args.googleSitemapAt ?? null, citations: 0, lastCitedAt: null,
    notWrittenReason: args.notWrittenReason ?? null, rewriteReason: args.rewriteReason ?? null,
    // Seen live a few minutes after publishing, unless the scenario says the site hasn't shown it yet.
    liveAt: args.liveAt !== undefined ? args.liveAt : publishedAt ? publishedAt + 6 * MIN : null,
  };
}

function baseSite(access: AnswersAccess): SiteRow {
  return {
    siteId: SYN_SITE_ID, domain: SYN_BUSINESS.domain, name: SYN_BUSINESS.name, sells: SYN_BUSINESS.sells, buyers: SYN_BUSINESS.buyers,
    offerings: [...SYN_BUSINESS.offerings], country: SYN_BUSINESS.country, local: true, location: SYN_BUSINESS.location,
    competitors: SYN_COMPETITORS.map((c) => ({ name: c.name, domain: c.domain })), readAt: null, readError: null, confirmedAt: null, setupError: null,
    publishing: null, autopublish: true, weeklyEmail: true, answers: true, lastSnapshotRunId: null, access, createdAt: SYNTHETIC_NOW - 2 * MIN,
  };
}

const NO_DESTINATION = "Choose where your pages publish in Settings: connect your site (WordPress, GitHub, Webflow, Shopify, Ghost, webhook) or use answers.yourdomain.com.";

export function seed(options: HarnessOptions): Db {
  const { scenario } = options;
  const onboarding = !["dashboard", "new-plan"].includes(scenario);
  const access: AnswersAccess = scenario === "new-plan" ? (options.access === "free" ? "paid" : options.access) : onboarding ? options.access : options.access;
  const site = baseSite(access);
  const db: Db = {
    sites: [site, { ...baseSite("free"), siteId: SYN_LEGACY_SITE_ID, domain: "oakhollowirrigation.com", name: "Oak Hollow Irrigation", answers: false,
      sells: "", buyers: "", offerings: [], competitors: [], readAt: null }],
    connection: { _id: SYN_SITE_ID, domain: site.domain, publishMethod: "manual" },
    questions: [], runs: [], pages: [], citations: [],
  };
  const now = SYNTHETIC_NOW;

  if (scenario === "reading") return db;
  site.readAt = now - MIN;
  if (scenario === "read-error") {
    Object.assign(site, { name: null, sells: "", buyers: "", offerings: [], competitors: [], location: null, local: false,
      readError: "Pentra couldn't reach kettlewooddecks.com: it didn't answer within 20 seconds." });
    return db;
  }
  if (scenario === "understood") return db;

  if (scenario === "setup-error") {
    site.confirmedAt = now - 20 * MIN;
    site.setupError = "Pentra couldn't write your questions: the writing service didn't answer in time.";
    return db;
  }

  if (onboarding) {
    const start = scenario === "first-hour" ? now - 15 * MIN : scenario === "run-failed" ? now - 7 * HOUR : now - 90 * MIN;
    site.confirmedAt = start - 5 * MIN;
    site.createdAt = start - 9 * MIN;
    site.readAt = start - 8 * MIN;
    db.questions = makeQuestions(site, start - 3 * MIN);
    const run = makeRun({ site, runId: "run_snapshot", kind: "snapshot", createdAt: start, minutes: scenario === "first-hour" ? 36 : 52,
      questions: db.questions, namedTarget: 3, errors: [[11, "gemini"], [26, "chatgpt"]],
      ...(scenario === "first-hour" ? { status: "asking" as const, done: 62 } : {}),
      ...(scenario === "run-failed" ? { status: "failed" as const, done: 96, error: "The run didn't finish within six hours." } : {}) });
    if (scenario === "first-hour") run.run.finishedAt = null;
    db.runs.push(run);
    site.lastSnapshotRunId = run.run.runId;
    if (run.run.status === "done") finish(db, run);
    const finished = run.run.finishedAt ?? now;
    if (scenario === "results" || scenario === "drafts") {
      const targets = [19, 1, 2, 13, 23].map((i) => db.questions[i]!);
      db.pages = targets.map((q, i) => {
        if (scenario === "results") return makePage(site, q, { title: q.question, status: "writing", createdAt: finished + MIN });
        if (i === 4) return makePage(site, q, { title: q.question, status: "not_written", createdAt: finished + MIN, updatedAt: finished + 9 * MIN,
          notWrittenReason: "A price in the draft wasn't in its cited source, so Pentra didn't keep it. The next run writes it again." });
        return makePage(site, q, { title: PAGE_TITLES[q.index] ?? q.question, status: "draft", createdAt: finished + MIN, updatedAt: finished + (6 + i) * MIN });
      });
      for (const page of db.pages) if (page.status !== "not_written") db.questions.find((q) => q.questionId === page.questionId)!.pageId = page.pageId;
    }
    return db;
  }

  /* The plan: a month of weekly runs (dashboard), or the day after upgrading (new-plan). */
  site.confirmedAt = scenario === "dashboard" ? Date.UTC(2026, 9, 10, 13, 50) : Date.UTC(2026, 10, 6, 15, 10);
  site.createdAt = site.confirmedAt - 6 * MIN;
  site.readAt = site.confirmedAt - 3 * MIN;
  db.questions = makeQuestions(site, site.confirmedAt + 3 * MIN);

  if (scenario === "new-plan") {
    const run = makeRun({ site, runId: "run_snapshot", kind: "snapshot", createdAt: site.confirmedAt + 5 * MIN, minutes: 52, questions: db.questions,
      namedTarget: 3, errors: [[11, "gemini"]] });
    db.runs.push(run);
    site.lastSnapshotRunId = run.run.runId;
    finish(db, run);
    const finished = run.run.finishedAt!;
    db.pages = [19, 1, 2, 13, 23].map((i) => {
      const q = db.questions[i]!;
      return makePage(site, q, { title: PAGE_TITLES[i] ?? q.question, status: "publish_failed", createdAt: finished + MIN, updatedAt: now - 40 * MIN,
        publishError: NO_DESTINATION });
    });
    for (const page of db.pages) db.questions.find((q) => q.questionId === page.questionId)!.pageId = page.pageId;
    return db;
  }

  site.autopublish = false;
  site.publishing = { target: "site" };
  db.connection = { _id: SYN_SITE_ID, domain: site.domain, publishMethod: "github", repoOwner: "kettlewood", repoName: "kettlewooddecks.com",
    repoDefaultBranch: "main", githubConnected: true, githubAuthorized: true, gscConnected: true };
  const q = (i: number) => db.questions[i]!;
  const day = (m: number, d: number, h = 12) => Date.UTC(2026, m, d, h, 0);
  const pages: PageRow[] = [
    makePage(site, q(0), { title: PAGE_TITLES[0]!, status: "published", createdAt: day(9, 10, 15), publishedAt: day(9, 18, 10), indexNow: { at: day(9, 18, 10) + 9 * MIN, status: "submitted" }, googleSitemapAt: day(9, 18, 11) }),
    makePage(site, q(1), { title: PAGE_TITLES[1]!, status: "published", createdAt: day(9, 10, 15), publishedAt: day(9, 18, 10), indexNow: { at: day(9, 18, 10) + 9 * MIN, status: "submitted" }, googleSitemapAt: day(9, 18, 11) }),
    makePage(site, q(2), { title: PAGE_TITLES[2]!, status: "retired", createdAt: day(9, 10, 15), updatedAt: day(10, 2, 9), publishedAt: day(9, 19, 10), indexNow: { at: day(9, 19, 10), status: "key_committed" } }),
    makePage(site, q(2), { pageId: "p_2_v2", title: PAGE_TITLES[2]!, status: "published", version: 2, createdAt: day(10, 2, 8), publishedAt: day(10, 2, 9), indexNow: { at: day(10, 2, 9) + 8 * MIN, status: "submitted" }, googleSitemapAt: day(10, 2, 10), rewriteReason: "Not cited by any assistant yet" }),
    makePage(site, q(19), { title: PAGE_TITLES[19]!, status: "published", createdAt: day(9, 24, 15), publishedAt: day(9, 25, 10), indexNow: { at: day(9, 25, 10) + 7 * MIN, status: "submitted" }, googleSitemapAt: day(9, 25, 11) }),
    makePage(site, q(13), { title: PAGE_TITLES[13]!, status: "published", createdAt: day(9, 31, 15), publishedAt: day(10, 1, 10), indexNow: { at: day(10, 1, 10) + 7 * MIN, status: "submitted" }, googleSitemapAt: day(10, 1, 11) }),
    makePage(site, q(23), { title: PAGE_TITLES[23]!, status: "published", createdAt: day(10, 3, 15), publishedAt: day(10, 4, 10), issues: [], liveAt: null }),
    makePage(site, q(3), { title: PAGE_TITLES[3]!, status: "draft", createdAt: day(10, 7, 12), updatedAt: day(10, 7, 12) + 6 * MIN }),
    makePage(site, q(9), { title: PAGE_TITLES[9]!, status: "draft", createdAt: day(10, 7, 12), updatedAt: day(10, 7, 12) + 8 * MIN, issues: ["Edited by you"] }),
    makePage(site, q(5), { title: PAGE_TITLES[5]!, status: "publish_failed", createdAt: day(10, 6, 12), updatedAt: day(10, 6, 13),
      publishError: "GitHub refused the commit (403): Resource not accessible by integration. Reconnect GitHub in Settings, then retry." }),
    makePage(site, q(14), { title: q(14).question, status: "writing", createdAt: now - 6 * MIN }),
    makePage(site, q(15), { title: q(15).question, status: "not_written", createdAt: day(10, 6, 12), updatedAt: day(10, 6, 12) + 9 * MIN,
      notWrittenReason: "A price in the draft wasn't in its cited source, so Pentra didn't keep it. The next run writes it again." }),
  ];
  db.pages = pages;
  for (const page of pages) if (page.status !== "not_written" && page.status !== "retired") db.questions.find((x) => x.questionId === page.questionId)!.pageId = page.pageId;

  const byQuestion = (at: number) => new Map(db.pages.filter((p) => p.status === "published" || (p.status === "retired" && p.updatedAt > at))
    .filter((p) => (p.publishedAt ?? Infinity) <= at).map((p) => [p.questionId, p]));
  const runs: { id: string; kind: RunKind; at: number; named: number; cites?: [number, string][]; only?: number[]; errors?: [number, string][] }[] = [
    { id: "run_w0", kind: "snapshot", at: day(9, 10, 13) + 55 * MIN, named: 3, errors: [[11, "gemini"]] },
    { id: "run_w1", kind: "weekly", at: day(9, 17, 11), named: 4, errors: [[26, "chatgpt"]] },
    { id: "run_w2", kind: "weekly", at: day(9, 24, 11), named: 6 },
    { id: "run_w3", kind: "weekly", at: day(9, 31, 11), named: 9, cites: [[0, "perplexity"]], errors: [[7, "gemini"], [17, "google_ai_mode"]] },
    { id: "run_r1", kind: "recheck", at: day(10, 5, 9), named: 2, only: [13, 19, 23], cites: [[19, "chatgpt"]] },
    { id: "run_w4", kind: "weekly", at: day(10, 7, 11), named: 13, cites: [[0, "perplexity"], [0, "chatgpt"], [19, "perplexity"], [2, "google_ai_mode"], [13, "perplexity"]] },
  ];
  for (const plan of runs) {
    const questions = plan.only ? plan.only.map((i) => q(i)) : db.questions.filter((x) => x.createdAt < plan.at);
    const row = makeRun({ site, runId: plan.id, kind: plan.kind, createdAt: plan.at, minutes: plan.only ? 9 : 38, questions, namedTarget: plan.named,
      cites: plan.cites, errors: plan.errors, pagesByQuestion: byQuestion(plan.at) });
    db.runs.push(row);
    finish(db, row);
  }
  site.lastSnapshotRunId = "run_w0";
  // Questions Pentra added since (asked from the next run), one the owner added, and one paused.
  db.questions.push(
    { siteId: site.siteId, questionId: "q_30", question: "What decking stays coolest for bare feet in Texas summers?", intent: "problem", source: "followup",
      status: "active", createdAt: day(10, 7, 12), latest: null, opportunity: null, pageId: null, key: "q30", index: 30 },
    { siteId: site.siteId, questionId: "q_31", question: "Do Austin deck builders offer financing?", intent: "cost", source: "followup", status: "active",
      createdAt: day(10, 7, 12) + MIN, latest: null, opportunity: null, pageId: null, key: "q31", index: 31 },
    { siteId: site.siteId, questionId: "q_32", question: "How do I get a deck ready for an HOA inspection in Austin?", intent: "local", source: "owner", status: "active",
      createdAt: day(10, 6, 18), latest: null, opportunity: null, pageId: null, key: "q32", index: 32 },
  );
  db.questions.find((x) => x.index === 28)!.status = "paused";
  return db;
}

const PAGE_TITLES: Record<number, string> = {
  0: "The best deck builders in Austin, TX, and how to choose one",
  1: "What a composite deck costs in Austin in 2026",
  2: "Do you need a permit for a deck in Austin? What the city requires",
  3: "Composite or wood decking in Texas heat: which lasts longer",
  5: "Composite decking brands that handle Texas heat",
  9: "Deck materials that stay cool in direct sun",
  13: "Decks with covered patios in Austin: who builds both",
  19: "Austin deck builders with fixed-price quotes",
  23: "What a deck permit costs in Travis County",
};

/** The dispatcher starts the next full run seven days after the last one finished. */
function nextRunOf(runs: RunRow[]): number | null {
  const last = runs.filter((r) => r.run.status === "done" && r.run.kind !== "recheck").sort((a, b) => (b.run.finishedAt ?? 0) - (a.run.finishedAt ?? 0))[0];
  return last?.run.finishedAt ? last.run.finishedAt + 7 * DAY : null;
}

/* ─── The store ────────────────────────────────────────────────────────── */

const publicPage = (p: PageRow) => {
  const rest: Partial<PageRow> = { ...p };
  delete rest.siteId;
  return rest as Omit<PageRow, "siteId">;
};

export type SyntheticStore = {
  subscribe(listener: () => void): () => void;
  get<K extends QueryName>(name: K, args: QueryMap[K][0] | "skip"): QueryMap[K][1] | undefined;
  actions: AnswersActions;
  options: HarnessOptions;
  dispose(): void;
};

export function createSyntheticStore(options: HarnessOptions): SyntheticStore {
  const db = seed(options);
  const listeners = new Set<() => void>();
  const memo = new Map<string, unknown>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const emit = () => { memo.clear(); for (const listener of listeners) listener(); };
  const later = (ms: number, fn: () => void) => { const id = setTimeout(() => { timers.delete(id); fn(); emit(); }, ms); timers.add(id); };
  const siteOf = (siteId: string) => db.sites.find((s) => s.siteId === siteId && s.answers) ?? null;
  const fail = (message: string): never => { throw new ConvexError(message); };
  const requireSite = (siteId: string) => siteOf(siteId) ?? fail("This site isn't yours, or it doesn't run Pentra Answers.");
  const allows = (access: AnswersAccess) => ({ snapshot: true, drafts: true, publish: access !== "free", recheck: access !== "free", weekly: access !== "free" });
  const publicRun = (row: RunRow): Run => ({ ...row.run });

  const resolvers: { [K in QueryName]: (args: QueryMap[K][0]) => QueryMap[K][1] } = {
    mySites: () => db.sites.map((s) => ({ siteId: s.siteId, domain: s.domain, name: s.name, answers: s.answers, confirmed: Boolean(s.confirmedAt) }))
      .sort((a, b) => Number(b.answers) - Number(a.answers)),
    setupState: ({ siteId }) => {
      const site = siteOf(siteId);
      if (!site) return null;
      const run = db.runs.find((r) => r.run.runId === site.lastSnapshotRunId) ?? null;
      return {
        siteId, domain: site.domain, name: site.name, sells: site.sells, buyers: site.buyers, offerings: site.offerings, country: site.country,
        local: site.local, location: site.location, competitors: site.competitors, readAt: site.readAt, readError: site.readError,
        confirmedAt: site.confirmedAt, setupError: site.setupError,
        questions: db.questions.filter((q) => q.siteId === siteId && q.status === "active").slice(0, 60).map((q) => ({ questionId: q.questionId, question: q.question, intent: q.intent })),
        run: run ? publicRun(run) : null,
        pages: db.pages.filter((p) => p.siteId === siteId).slice(0, 20).map((p) => ({ pageId: p.pageId, question: p.question, title: p.title, status: p.status,
          words: p.markdown.split(/\s+/).filter(Boolean).length, sources: p.sources.length, facts: p.facts.length })),
        access: site.access,
      };
    },
    overview: ({ siteId }) => {
      const site = siteOf(siteId);
      if (!site) return null;
      const runs = db.runs.filter((r) => r.siteId === siteId).sort((a, b) => b.run.createdAt - a.run.createdAt).slice(0, 13);
      return {
        site: { siteId, domain: site.domain, name: site.name ?? site.domain, country: site.country ?? "US", competitors: site.competitors,
          confirmedAt: site.confirmedAt, setupError: site.setupError, publishing: site.publishing, autopublish: site.autopublish, weeklyEmail: site.weeklyEmail,
          nextRunAt: allows(site.access).weekly ? nextRunOf(runs) : null },
        access: site.access, allows: allows(site.access),
        runs: runs.map(publicRun),
        trend: runs.filter((r) => r.run.status === "done" && r.run.kind !== "recheck").reverse().map((r) => ({ at: r.run.finishedAt ?? r.run.createdAt,
          answered: r.run.answered, named: r.run.named, cited: r.run.cited, competitors: r.run.competitors ?? [] })),
        questions: db.questions.filter((q) => q.siteId === siteId && q.status !== "removed").map((q) => ({ questionId: q.questionId, question: q.question,
          intent: q.intent, source: q.source, status: q.status, createdAt: q.createdAt, latest: q.latest, opportunity: q.opportunity, pageId: q.pageId })),
        pages: db.pages.filter((p) => p.siteId === siteId).map((p) => ({ pageId: p.pageId, questionId: p.questionId, question: p.question, status: p.status,
          title: p.title, slug: p.slug, publishedUrl: p.publishedUrl, publishedAt: p.publishedAt, indexNow: p.indexNow, citations: p.citations,
          lastCitedAt: p.lastCitedAt, updatedAt: p.updatedAt, issues: p.issues, publishError: p.publishError,
          words: p.markdown.split(/\s+/).filter(Boolean).length, sources: p.sources.length, facts: p.facts.length, liveAt: p.liveAt ?? null })),
        citations: db.citations.filter((c) => c.siteId === siteId).sort((a, b) => b.at - a.at).slice(0, 20).map((c) => {
          const rest: Partial<typeof c> = { ...c };
          delete rest.siteId;
          return rest as OverviewCitation;
        }),
      };
    },
    runProgress: ({ runId }) => {
      const row = db.runs.find((r) => r.run.runId === runId);
      if (!row) return null;
      return { ...publicRun(row), perAssistant: ASSISTANT_IDS.map((assistant) => {
          const mine = row.checks.filter((c) => c.assistant === assistant);
          const answered = mine.filter((c) => c.status === "answered");
          return { assistant, total: row.jobs.filter((j) => j.assistant === assistant).length, done: mine.length, answered: answered.length,
            named: answered.filter((c) => c.named).length };
        }),
        feed: [...row.checks].sort((a, b) => b.askedAt - a.askedAt).slice(0, 12) };
    },
    questionEvidence: ({ questionId, limit }) => {
      const q = db.questions.find((x) => x.questionId === questionId);
      if (!q) return null;
      const checks = db.runs.flatMap((r) => r.checks).filter((c) => c.questionId === questionId).sort((a, b) => b.askedAt - a.askedAt)
        .slice(0, Math.max(1, Math.min(60, Math.floor(limit ?? 25))));
      return { question: q.question, opportunity: q.opportunity, latest: q.latest, checks };
    },
    runAnswers: ({ runId, limit }) => {
      const row = db.runs.find((r) => r.run.runId === runId);
      return row ? row.checks.slice(0, Math.max(1, Math.min(400, Math.floor(limit ?? 400)))) : null;
    },
    answerText: ({ checkId }) => {
      for (const row of db.runs) {
        const check = row.checks.find((c) => c.checkId === checkId);
        if (check) return { ...check, text: row.texts.get(checkId) ?? null };
      }
      return null;
    },
    page: ({ pageId }) => {
      const row = db.pages.find((p) => p.pageId === pageId);
      if (!row) return null;
      return { ...publicPage(row),
        history: db.pages.filter((p) => p.questionId === row.questionId && p.pageId !== pageId).sort((a, b) => b.version - a.version)
          .map((h) => ({ pageId: h.pageId, version: h.version, status: h.status, updatedAt: h.updatedAt, rewriteReason: h.rewriteReason })),
        citationList: db.citations.filter((c) => c.pageId === pageId).sort((a, b) => b.at - a.at).map((c) => ({ checkId: c.checkId, assistant: c.assistant, at: c.at, url: c.url })) };
    },
    siteConnection: ({ siteId }) => (siteId === SYN_SITE_ID ? { ...db.connection } : null),
  };

  /** A confirmed first hour, played fast: questions, then answers streaming in, then the five drafts. */
  const playFirstHour = (site: SiteRow) => {
    const start = Date.now();
    db.questions = db.questions.filter((q) => q.siteId !== site.siteId);
    later(900, () => { db.questions.push(...makeQuestions(site, start)); });
    later(1800, () => {
      const full = makeRun({ site, runId: "run_live", kind: "snapshot", createdAt: SYNTHETIC_NOW, minutes: 40, questions: db.questions.filter((q) => q.siteId === site.siteId),
        namedTarget: 3, errors: [[11, "gemini"]] });
      const row: RunRow = { ...full, checks: [], run: { ...full.run, status: "asking", done: 0, answered: 0, named: 0, cited: 0, failed: 0, noAnswer: 0,
        finishedAt: null, byAssistant: null, competitors: null, topSources: null } };
      db.runs.push(row);
      site.lastSnapshotRunId = row.run.runId;
      const step = () => {
        const next = full.checks.slice(row.checks.length, row.checks.length + 6);
        row.checks.push(...next);
        const totals = runTotals(row.checks);
        Object.assign(row.run, { done: row.checks.length, answered: totals.answered, named: totals.named, cited: totals.cited, failed: totals.failed, noAnswer: totals.noAnswer });
        if (row.checks.length < full.checks.length) { later(350, step); return; }
        row.run = { ...full.run };
        finish(db, row);
        const targets = [19, 1, 2, 13, 23].map((i) => db.questions.find((q) => q.siteId === site.siteId && q.index === i)!);
        db.pages = targets.map((q) => makePage(site, q, { title: q.question, status: "writing", createdAt: SYNTHETIC_NOW + 41 * MIN }));
        later(2500, () => {
          db.pages = db.pages.map((p) => {
            const q = db.questions.find((x) => x.questionId === p.questionId)!;
            return makePage(site, q, { title: PAGE_TITLES[q.index] ?? q.question, status: "draft", createdAt: p.createdAt, updatedAt: p.createdAt + 7 * MIN });
          });
          for (const page of db.pages) db.questions.find((q) => q.questionId === page.questionId)!.pageId = page.pageId;
        });
      };
      later(400, step);
    });
  };

  const actions: AnswersActions = {
    async createSite({ domain }) {
      // The email (when given) is for the "ready" email; the harness has no mail to send.
      const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) fail("Enter your website's address, like yourbusiness.com.");
      const existing = db.sites.find((s) => s.domain === host);
      if (existing) { existing.answers = true; emit(); return { siteId: existing.siteId, created: false }; }
      return fail(`Your account already tracks ${SYN_BUSINESS.domain}. One website per account for now; contact us to add another.`);
    },
    async updateBusiness({ siteId, name, sells, buyers, offerings, local, location }) {
      const site = requireSite(siteId);
      if (!name.trim() || sells.trim().length < 10) fail("Say what the business sells in a sentence.");
      Object.assign(site, { name: name.trim().slice(0, 80), sells: sells.trim().slice(0, 600), buyers: buyers.trim().slice(0, 300),
        offerings: offerings.map((o) => o.trim()).filter((o) => o.length > 1).slice(0, 10).map((o) => o.slice(0, 120)) });
      if (local !== undefined) Object.assign(site, { local, location: local ? location?.trim().slice(0, 80) || site.location : null });
      emit();
      return { ok: true };
    },
    async confirmSetup({ siteId, name, competitors, country }) {
      const site = requireSite(siteId);
      site.competitors = competitors.map((c) => ({ name: c.name.trim().slice(0, 60), ...(c.domain ? { domain: c.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "") } : {}) }))
        .filter((c) => c.name.length >= 2).slice(0, 8);
      if (name?.trim()) site.name = name.trim().slice(0, 80);
      if (country) site.country = country.toUpperCase();
      const first = !site.confirmedAt;
      site.confirmedAt = site.confirmedAt ?? Date.now();
      site.setupError = null;
      emit();
      if (first || !site.lastSnapshotRunId) playFirstHour(site);
      return { ok: true };
    },
    async addQuestion({ siteId, question }) {
      const site = requireSite(siteId);
      const cleaned = cleanQuestion(question.endsWith("?") ? question : `${question.trim()}?`, { name: site.name ?? site.domain, domain: site.domain });
      if (!cleaned) return fail("Write it as one question your buyers would ask, without your business's name.");
      const key = questionKey(cleaned);
      const existing = db.questions.find((q) => q.siteId === siteId && q.key === key);
      if (existing) { existing.status = "active"; emit(); return { questionId: existing.questionId }; }
      if (db.questions.filter((q) => q.siteId === siteId && q.status === "active").length >= 40) fail("You're tracking 40 questions, the most at once. Pause one first.");
      const questionId = `q_owner_${db.questions.length}`;
      db.questions.push({ siteId, questionId, question: cleaned, key, intent: "problem", source: "owner", status: "active", createdAt: Date.now(),
        latest: null, opportunity: null, pageId: null, index: db.questions.length });
      emit();
      return { questionId };
    },
    async setQuestionStatus({ questionId, status }) {
      const q = db.questions.find((x) => x.questionId === questionId) ?? fail("Question not found.");
      q.status = status;
      emit();
      return { ok: true };
    },
    async setPreferences({ siteId, autopublish, weeklyEmail }) {
      const site = requireSite(siteId);
      if (autopublish !== undefined) site.autopublish = autopublish;
      if (weeklyEmail !== undefined) site.weeklyEmail = weeklyEmail;
      emit();
      return { ok: true };
    },
    async runNow({ siteId }) {
      const site = requireSite(siteId);
      if (!allows(site.access).recheck) fail("Re-asking the assistants is part of the Pentra plan.");
      const last = db.runs.filter((r) => r.siteId === siteId).sort((a, b) => b.run.createdAt - a.run.createdAt)[0];
      if (last && last.run.status === "asking") return { runId: last.run.runId };
      if (last && SYNTHETIC_NOW - last.run.createdAt < 6 * HOUR) fail("The assistants were asked less than six hours ago. Try again later.");
      return { runId: "run_now", created: true };
    },
    async switchToAnswers({ siteId }) {
      const site = db.sites.find((s) => s.siteId === siteId) ?? fail("Site not found.");
      site.answers = true;
      emit();
      later(2500, () => { if (!site.readAt) Object.assign(site, { readAt: Date.now(), sells: "Drip irrigation design, installation and repair for homes in Austin.",
        buyers: "Homeowners in Austin with lawns and gardens.", offerings: ["Drip irrigation", "Sprinkler repair"], competitors: [{ name: "Greenline Irrigation", domain: "greenlineirrigation.com" }] }); });
      return { ok: true };
    },
    async editDraft({ pageId, title, metaDescription, markdown }) {
      const page = db.pages.find((p) => p.pageId === pageId) ?? fail("Page not found.");
      if (page.status !== "draft" && page.status !== "publish_failed") fail("Only a draft can be edited. Published pages change through a rewrite.");
      if (!title.trim() || markdown.trim().length < 200) fail("A page needs a title and its text.");
      Object.assign(page, { title: title.trim().slice(0, 90), metaDescription: metaDescription.trim().slice(0, 170), markdown: markdown.trim(),
        issues: [...new Set([...page.issues.filter((i) => !i.startsWith("Edited")), "Edited by you"])], updatedAt: Date.now() });
      emit();
      return { ok: true };
    },
    async publishDraft({ pageId }) {
      const page = db.pages.find((p) => p.pageId === pageId) ?? fail("Page not found.");
      const site = requireSite(page.siteId);
      if (!allows(site.access).publish) fail("Publishing is part of the Pentra plan.");
      if (page.status !== "draft" && page.status !== "publish_failed") fail("This page isn't a draft.");
      page.status = "publishing";
      page.publishError = null;
      emit();
      later(1400, () => {
        const hosted = site.publishing?.target === "hosted";
        const ready = hosted ? site.publishing?.hostedStatus === "live" : db.connection.publishMethod && db.connection.publishMethod !== "manual";
        if (!ready) {
          page.status = "publish_failed";
          page.publishError = hosted ? `${site.publishing?.hostedDomain} isn't pointing at Pentra yet. Add the DNS record from Settings; Pentra publishes as soon as it's live.` : NO_DESTINATION;
          return;
        }
        page.status = "published";
        page.publishedAt = Date.now();
        page.liveAt = Date.now();
        page.publishedUrl = hosted ? `https://${site.publishing!.hostedDomain}/${page.slug}` : `https://${site.domain}/blog/${page.slug}`;
      });
      return { ok: true };
    },
    async setHostedDomain({ siteId, domain }) {
      const site = requireSite(siteId);
      const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (host !== `answers.${site.domain}`) fail(`Use a subdomain of ${site.domain}, like answers.${site.domain}.`);
      site.publishing = { target: "hosted", hostedDomain: host, hostedStatus: "pending_dns" };
      emit();
      later(1200, () => { site.publishing = { ...site.publishing!, hostedCheckedAt: Date.now(), hostedError: `Add a CNAME record for ${host} pointing to cname.vercel-dns.com.` }; });
      return { host, cname: "cname.vercel-dns.com" };
    },
    async usePublishingConnection({ siteId }) {
      const site = requireSite(siteId);
      site.publishing = { target: "site" };
      emit();
      return { ok: true };
    },
    async retryFailed({ siteId }) {
      const failed = db.pages.filter((p) => p.siteId === siteId && p.status === "publish_failed");
      for (const page of failed) await actions.publishDraft({ pageId: page.pageId });
      return { retried: failed.length };
    },
    async saveConnection(input: ConnectionInput) {
      if (input.publishMethod === "github" && (!input.repoOwner || !input.repoName)) fail("Choose the repository Pentra publishes to.");
      if (input.publishMethod === "wordpress" && (!input.wpUrl || !input.wpUsername)) fail("Enter your WordPress address and username.");
      if (input.publishMethod === "webhook" && !input.webhookUrl?.startsWith("https://")) fail("The webhook address must start with https://.");
      const { siteId: _siteId, domain: _domain, ...fields } = input;
      void _siteId; void _domain;
      db.connection = { _id: SYN_SITE_ID, domain: db.connection.domain, ...fields,
        ...(input.publishMethod === "github" ? { githubConnected: true, githubAuthorized: true, repoDefaultBranch: "main" } : {}),
        ...(input.publishMethod === "wordpress" ? { wordpressConfigured: true } : {}),
        ...(input.publishMethod === "webhook" ? { webhookSecretConfigured: Boolean(input.webhookSecret) } : {}),
        ...(["webflow", "shopify", "ghost"].includes(input.publishMethod) ? { cmsSecretConfigured: true } : {}) } as SiteConnection;
      delete (db.connection as Record<string, unknown>).wpAppPassword;
      delete (db.connection as Record<string, unknown>).webhookSecret;
      delete (db.connection as Record<string, unknown>).cmsSecret;
      emit();
      return null;
    },
    async verifyConnection() {
      if (!db.connection.publishMethod || db.connection.publishMethod === "manual") fail("Connect a publishing method first.");
      return { verified: true };
    },
    async listGithubRepositories() {
      return [
        { owner: "kettlewood", name: "kettlewooddecks.com", private: true },
        { owner: "kettlewood", name: "brand-assets", private: true },
      ];
    },
  };

  return {
    options,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(name, args) {
      if (args === "skip") return undefined;
      if (options.state === "loading") return undefined;
      if (options.state === "error" && name !== "mySites") throw new Error("Synthetic failure: the query couldn't be read.");
      const key = `${name}:${JSON.stringify(args)}`;
      if (!memo.has(key)) memo.set(key, (resolvers[name] as (a: unknown) => unknown)(args));
      return memo.get(key) as never;
    },
    actions,
    dispose() { for (const id of timers) clearTimeout(id); timers.clear(); listeners.clear(); },
  };
}

export const SYNTHETIC_SITE = { siteId: SYN_SITE_ID, legacySiteId: SYN_LEGACY_SITE_ID, now: SYNTHETIC_NOW, day: DAY };
