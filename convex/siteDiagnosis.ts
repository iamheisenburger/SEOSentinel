/** Site diagnosis (Nov 2026): what the weekly run reads, where it records, its spend hold, and the weekly schedule. The
 * scoring is the pure convex/lib/siteDiagnosis.ts; the run (crawl, Search Console, page one, readers) is
 * convex/actions/siteDiagnosis.ts. */
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { addSearchConsoleDays, publishedArticlePageUrl } from "./lib/searchPerformance";
import { siteExecutionActive } from "./lib/planSiteAllowance";
import { takeCurrentGscQueryRows } from "./lib/currentGscRows";
import { releaseSharedProviderReservation, reserveSharedProviderBudget, settleSharedProviderReservation } from "./lib/providerSpendReservation";
import { siteDiagnosisRecord } from "./lib/siteDiagnosisSchema";
import { retiredArticle, servedOnItsOwnUrl } from "./lib/pentraConsolidation";
import { mergedSlugs } from "./siteRedirects";
import { PROVEN_POSITION, searchConsolePosition } from "./lib/topicVerdict";
import { linkCompetitors } from "./lib/linkOpportunities";

/** A site is diagnosed at most once in this long, unless forced. */
export const DIAGNOSIS_INTERVAL_MS = 6 * 24 * 3600 * 1000;
/** The hold for one run's paid checks (page one's strength, the readers' intent, Lighthouse speed, the AI-answer questions
 * with one retry each); a real run costs about $0.08-0.12, and every check at its price bound fits. */
export const DIAGNOSIS_RESERVATION_MICRO_USD = 500_000;
/** Search Console rows read per run (28 days); a bigger site is read up to this many and says so. */
export const DIAGNOSIS_GSC_ROWS = 12_000;
/** The sites the weekly run covers until its cost for every customer (about $0.05-0.10 a site a week) has the owner's
 * yes (money rule, Nov 2026): Pentra's own two sites. The engine is the same for every site; widening this list is the
 * rollout. */
export const DIAGNOSIS_ROLLOUT_DOMAINS: readonly string[] = ["pentra.dev", "leadpilot.chat"];
/** Phase 2 (P359) began choosing only winnable searches on Nov 5 2026. */
const PHASE_TWO_SINCE = Date.UTC(2026, 10, 5);
const bareDomain = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

const pageUrl = (site: Doc<"sites">, slug: string) => { try { return publishedArticlePageUrl(site.domain, site.urlStructure, slug); } catch { return null; } };

export const context = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !siteExecutionActive(site) || !site.userId || site.deletionStatus) return null;
  const latest = await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").first();
  const merged = await mergedSlugs(ctx, siteId);
  const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published"))
    .order("desc").take(300)).filter((row) => row.publishedAt && articleMatchesCurrentDomain(site, row));
  // P367: which articles Pentra wrote for a search Phase 2 found winnable (a fold target for a never-shown sibling). Only
  // articles published since Phase 2 began can be such, so only their topics are read.
  const winnableTopic = new Map<string, boolean>();
  if (DIAGNOSIS_ROLLOUT_DOMAINS.includes(bareDomain(site.domain))) {
    for (const row of summaries) {
      if (!row.topicId || (row.publishedAt ?? 0) < PHASE_TWO_SINCE || winnableTopic.has(row.topicId)) continue;
      const topic = await ctx.db.get(row.topicId), position = topic ? searchConsolePosition(topic) : null;
      winnableTopic.set(row.topicId, Boolean(topic && (topic.pageOne?.rankable === true || (position !== null && position <= PROVEN_POSITION))));
    }
  }
  const addressed = summaries.flatMap((row) => {
    const url = row.publicUrl?.startsWith("https://") ? row.publicUrl : pageUrl(site, row.slug);
    return url ? [{ url, slug: row.slug, title: row.title, publishedAt: row.publishedAt ?? null, indexVerdict: row.gscIndexVerdict ?? null,
      coverageState: row.gscCoverageState ?? null, retired: retiredArticle(site.domain, row.slug), moved: !servedOnItsOwnUrl(site.domain, row.slug, merged),
      winnable: row.topicId ? winnableTopic.get(row.topicId) === true : false }] : [];
  });
  // An article taken down on purpose (retired) is not a live article: its address answering "not found" is intended.
  const published = addressed.filter((row) => !row.retired);
  const removed = addressed.filter((row) => row.retired).map((row) => row.url);
  return {
    siteId, userId: site.userId, domain: site.domain, targetCountry: site.targetCountry ?? null,
    urlStructure: site.urlStructure ?? "/blog/[slug]", publishMethod: site.publishMethod ?? "github",
    repository: Boolean(site.repoOwner && site.repoName), ownerReview: Boolean(site.approvalRequired),
    // Phase 4: whether the owner turned link finding on (off unless they did).
    linkOutreach: site.linkOutreach ?? null,
    business: { name: site.siteName ?? site.domain, domain: site.domain, summary: site.siteSummary ?? site.niche, audience: site.targetAudienceSummary,
      features: site.keyFeatures, problems: site.painPoints, usage: site.productUsage },
    authority: typeof site.seoAuthorityDomainRank === "number"
      ? { domainRank: site.seoAuthorityDomainRank, referringDomains: site.seoAuthorityReferringDomains, measuredAt: site.seoAuthorityMeasuredAt ?? null } : null,
    searchConsole: Boolean(site.gscProperty && site.gscDateEpochs?.length),
    published, removed, lastRunAt: latest?.createdAt ?? null, aiQuestions: latest?.aiAnswers?.questions ?? [],
    // Phase 5 (P369): the rivals to look for in the AI answers: the confirmed profile's competitors and last week's page one.
    rivals: [...(site.competitors ?? []), ...linkCompetitors(latest?.pageOne ?? [], site.domain, 5)],
  };
} });

/** The last 28 days of Search Console rows for one site (query × page × day), read from the current receipts only. */
export const gscRows = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || !siteExecutionActive(site) || !site.gscDateEpochs?.length) return { rows: [], capped: false };
  const latest = [...site.gscDateEpochs].map((r) => r.date).sort().at(-1)!;
  const { rows, exhausted } = await takeCurrentGscQueryRows(ctx, site, DIAGNOSIS_GSC_ROWS, { startDate: addSearchConsoleDays(latest, -27), endDate: latest });
  return { rows: rows.map((r) => ({ date: r.date, query: r.query, ...(r.page ? { page: r.page } : {}), clicks: r.clicks, impressions: r.impressions, position: r.position })),
    capped: exhausted };
} });

/** `reservedMicroUsd`: a smaller hold for a part of the weekly work run on its own (Phase 4's email writing), never more
 * than a diagnosis's. */
export const reserve = internalMutation({ args: { siteId: v.id("sites"), trigger: v.string(), reservedMicroUsd: v.optional(v.number()) },
  handler: async (ctx, { siteId, trigger, reservedMicroUsd }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.userId) return { ok: false as const, reason: "no_owner" };
  const amount = Math.min(DIAGNOSIS_RESERVATION_MICRO_USD, Math.max(1, Math.round(reservedMicroUsd ?? DIAGNOSIS_RESERVATION_MICRO_USD)));
  const reserved = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId, purpose: "site_diagnosis", trigger,
    reservedMicroUsd: amount, timestamp: Date.now() });
  return reserved.ok ? { ok: true as const, reservationId: reserved.reservationId } : { ok: false as const, reason: String(reserved.reason) };
} });

/** Settled at the providers' reported cost, or released when nothing was sent; a cost above the hold keeps the hold. */
export const close = internalMutation({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations"), sent: v.boolean(), actualMicroUsd: v.number() },
  handler: async (ctx, { siteId, reservationId, sent, actualMicroUsd }) => {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.siteId !== siteId || reservation.purpose !== "site_diagnosis" ||
      reservation.settledAt !== undefined || reservation.releasedAt !== undefined) return;
    if (!sent) {
      await releaseSharedProviderReservation(ctx, { reservationId, siteId, purpose: "site_diagnosis", reason: "plan_cancelled_before_execution", timestamp: Date.now() });
      return;
    }
    const actual = Math.max(0, Math.round(actualMicroUsd));
    if (!Number.isSafeInteger(actual) || actual > reservation.reservedMicroUsd) return;
    await settleSharedProviderReservation(ctx, { reservationId, siteId, purpose: "site_diagnosis", actualMicroUsd: actual,
      reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  } });

export const record = internalMutation({ args: { siteId: v.id("sites"), diagnosis: v.object(siteDiagnosisRecord) }, handler: async (ctx, { siteId, diagnosis }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus) return null;
  const id = await ctx.db.insert("site_diagnoses", { siteId, createdAt: Date.now(), ...diagnosis });
  // Phase 6 (Nov 2026): the owner's weekly results email follows the week's diagnosis (rollout sites first), once a week,
  // after the redirects it delivered have had time to be checked live.
  if (DIAGNOSIS_ROLLOUT_DOMAINS.includes(bareDomain(site.domain))) await noteWeeklyReport(ctx, site);
  return id;
} });

/** Phase 6 (P369), onboarding: a site in the rollout gets its first diagnosis a minute after it chooses Autopilot (or
 * review-first with automatic publishing), not at the next Tuesday run, so the owner sees what Pentra found and what it
 * does next from the first day. Once only: a site with a diagnosis waits for the weekly run. */
export async function scheduleFirstDiagnosis(ctx: MutationCtx, site: Doc<"sites">) {
  if (!DIAGNOSIS_ROLLOUT_DOMAINS.includes(bareDomain(site.domain))) return;
  if (await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).first()) return;
  await ctx.scheduler.runAfter(60_000, internal.actions.siteDiagnosis.runInternal, { siteId: site._id });
}

const WEEKLY_REPORT_DELAY_MS = 20 * 60_000;
async function noteWeeklyReport(ctx: MutationCtx, site: Doc<"sites">) {
  const now = Date.now(), week = new Date(now - ((new Date(now).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  const logged = await ctx.db.query("customer_emails").withIndex("by_site_kind_key", (q) => q.eq("siteId", site._id).eq("kind", "weekly_report").eq("key", week)).first();
  if (logged) return;
  const logId = await ctx.db.insert("customer_emails", { siteId: site._id, kind: "weekly_report", key: week, status: "pending", attempts: 0, createdAt: now, updatedAt: now });
  await ctx.scheduler.runAfter(WEEKLY_REPORT_DELAY_MS, internal.customerEmails.send, { logId });
}

/** The owner's latest diagnosis for the dashboard: where the site stands, the five factors, the biggest problems and the
 * AI-answer check, without the page-by-page list (the weekly email and the per-page view read latestInternal). */
export const latest = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject) return null;
  const d = await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").first();
  if (!d) return null;
  const answered = (d.aiAnswers?.checks ?? []).filter((c) => c.answered);
  return { createdAt: d.createdAt, siteType: d.siteType, window: d.window ?? null, factors: d.factors, summary: d.summary,
    findings: d.findings.filter((f) => f.severity !== "low").slice(0, 6).map((f) => ({ factor: f.factor, severity: f.severity, problem: f.problem, evidence: f.evidence })),
    ai: answered.length ? { asked: answered.length, named: answered.filter((c) => c.named).length, questions: d.aiAnswers!.questions } : null };
} });

export const latestInternal = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) =>
  await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").first() });

/** One run now, through the scheduler (an operator's run after a deploy: the CLI gives up on an action after five minutes,
 * while the run itself has an action's ten). */
export const runSoon = internalMutation({ args: { siteId: v.id("sites"), force: v.optional(v.boolean()) }, handler: async (ctx, { siteId, force }) => {
  await ctx.scheduler.runAfter(0, internal.actions.siteDiagnosis.runInternal, { siteId, ...(force ? { force: true } : {}) });
  return { scheduled: true };
} });

/** Weekly: every site in the rollout on the new Pentra setup that chose Autopilot or was diagnosed before, spaced 30
 * seconds apart. */
export const scheduleWeekly = internalMutation({ args: {}, handler: async (ctx) => {
  const sites = await ctx.db.query("sites").order("desc").take(500);
  let scheduled = 0;
  for (const site of sites) {
    if (!siteExecutionActive(site) || !site.userId || site.deletionStatus || site.serviceMode !== "growth_first" || !site.contentSchedule) continue;
    if (!DIAGNOSIS_ROLLOUT_DOMAINS.includes(bareDomain(site.domain))) continue;
    if (!site.contentSchedule.autopilotSelectedAt && !(await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", site._id)).first())) continue;
    await ctx.scheduler.runAfter(scheduled * 30_000, internal.actions.siteDiagnosis.runInternal, { siteId: site._id });
    scheduled++;
  }
  return { scheduled };
} });
