import { isApiCmsMethod } from "./lib/cmsDestinations";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { contentIntentConflicts, evaluateTopicBusinessFit, tenantDiscoveryAnchors, tenantTopicBusinessSignals, isSealedReady, topicFitSettled } from "./lib/autopilotBuffer";
import { normalizeResearchKeyword, researchSeedsForRound, searchLikePhrase, searchSeedLength, TOPIC_RESEARCH_METHOD } from "./lib/researchSeeds";
import { relatedRepairAllowed } from "./lib/contentCorrection";
import { publicationArtifactHash, publicationDeliveryConfig, sha256Hex } from "./lib/publicationArtifact";
import { isProviderRequestRefusal, legacyCreditRefusal, validProviderRequestId } from "./lib/contentProviderRefusal";
import { siteCanonicalDomain, siteCanonicalDomainRevision, takeCurrentDomainTopics, contentAnalysisMatchesCurrentDomain, pageMatchesCurrentDomain, articleMatchesCurrentDomain, gscConnectionMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { takeCurrentGscQueryRows } from "./lib/currentGscRows";
import { preSerpReachCeiling } from "./lib/winnableDiscovery";
import { compareTopics, searchedWithin } from "./lib/topicOrder";
import { measuredAuthorityIsFresh, tenantAuthorityFromStoredEvidence } from "./lib/expectedClickPortfolio";
import { addSearchConsoleDays, isBrandedSearchQuery, publishedArticlePageUrl } from "./lib/searchPerformance";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { resolvePlanFromFeatures, cadenceFitsOperationalLimit, targetCadenceOptions } from "./planLimits";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { inspectSharedProviderBudget, reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "./lib/providerSpendReservation";
import { contentValidationBinding } from "./lib/providerBudgetAuthorization";
import { planCheckpointTopicDeletionLocked, planCheckpointTopicExecutionLocked } from "./lib/planCandidateCheckpoint";
import { CONTENT_FEASIBILITY_VERSION, terminalContentFeasibility } from "./lib/topicLifecycle";
import { reconcileTopicLifecycle } from "./lib/topicLifecycleDb";
import type { CadenceScheduleResult } from "./lib/autopilotRunOutcome";
import { liveAutopilotReadiness, publicationDestinationBlockers } from "./lib/autopilotReadiness";
import { PUBLISHED_REVISION_LEASE_MS } from "./lib/publishedRevision";
import { PUBLICATION_LEASE_MS } from "./lib/publicationLease";
import { contentConnectionHash, confirmedContentProfileHash, contentConnectionComplete, contentConsentToken, pasteDestination } from "./lib/contentSelection";
import { contentFunding, contentIssue } from "./lib/contentCustomer";
import { assertSafeImprovement } from "./lib/contentSelection";
import { authorizedWorkPage, chooseImprovement, contentWorkConnection, enrollVerifiedCreation, renewManagedEnrollments } from "./selectedPages";
import { noteDraftReady, noteFirstArticleLive } from "./customerEmails";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { archiveRetiredContentArtifact, quarantineUnpublishedArticle, createOwnerEditedCheckpoint, sealAcceptedReviewNotes } from "./articles";
import { AUTOPILOT_ACCEPTANCE, CONTENT_CHECKS_VERSION, ownerWaivableIssue, readerVisibleIssues } from "./lib/articleQuality";
import { closeRetiredContentAccounting, closeVerifiedContentWake } from "./jobs";
import { auditResultHash, clarifiableContentAudit, inconsistentAuditFeedback, internalContentProcessingError, retainedContradictoryContentAudit, semanticAuditCeiling, SEMANTIC_AUDIT_SUFFIX } from "./lib/contentAudit";
import { contentJobUsesAllowance } from "./lib/contentUsage";
import { BUYER_FIT_MAX_KEYWORDS, BUYER_FIT_RESERVATION_MICRO_USD, BUYER_FIT_VERSION, type BuyerFitBusiness } from "./lib/topicFit";
import { PLAN_AUDIT_VERSION } from "./lib/researchGrouping";
import { servedOnItsOwnUrl } from "./lib/pentraConsolidation";
import { searchAsksForProducts } from "./lib/sourceQuality";
import { OWNER_SEARCH_MAX_WAITING, OWNER_SEARCH_MEASURE_MICRO_USD, OWNER_SEARCH_NOTES, OWNER_SEARCH_PRIORITY,
  ownerSearchArticleType, ownerSearchKeyword } from "./lib/ownerSearch";
export { confirmedContentProfileHash } from "./lib/contentSelection";

export const CONTENT_DELIVERY_WINDOW_MS = 5 * 60_000;
export const MAX_CONTENT_RECOVERIES = 3;
/** Public plan allowance of NEW owner-requested drafts per UTC month (edits and
 * re-reviews of a draft are free). Matches the published pricing table. */
export const OWNER_DRAFTS_PER_MONTH = { free: 3, starter: 10, pro: 25, scale: 60, enterprise: 150 } as const;
/** Autopilot publishing rhythm derived from the plan's monthly articles:
 * spread evenly over 30 days, never more often than every 12 hours. */
export function autopilotIntervalMs(articlesPerMonth: number) {
  return Math.max(12 * 3_600_000, Math.floor((30 * 86_400_000) / Math.max(1, articlesPerMonth)));
}
/** Autopilot follows the publishing cadence the customer chose for the site
 * (articles per week, set in site settings; new sites default to a pace their
 * plan sustains). The plan's monthly allowance still caps the total. */
export function siteAutopilotIntervalMs(site: { cadencePerWeek?: number }, articlesPerMonth: number) {
  const cadence = site.cadencePerWeek;
  return cadence !== undefined && cadenceFitsOperationalLimit(cadence)
    ? Math.floor((7 * 86_400_000) / cadence) : autopilotIntervalMs(articlesPerMonth);
}
/** With nothing prepared, the next Autopilot article starts now and lands in about this long. */
export const FIRST_ARTICLE_LEAD_MS = 2 * 3_600_000;
async function accountPlan(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  const entitlement = site.userId ? await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique() : null;
  const tier = resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier;
  const articlesPerMonth = OWNER_DRAFTS_PER_MONTH[tier] as number;
  return { tier, articlesPerMonth, cadencePerWeek: site.cadencePerWeek !== undefined && cadenceFitsOperationalLimit(site.cadencePerWeek) ? site.cadencePerWeek : null,
    autopilotIntervalMs: siteAutopilotIntervalMs(site, articlesPerMonth) };
}
/** New owner drafts used this UTC month across the account's sites, against
 * the plan allowance. Null for the scoped owner validation grant. */
async function ownerDraftAllowance(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, validationScoped: boolean, displayedUsed?: number) {
  if (validationScoped || !site.userId) return null;
  const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
  const tier = resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier;
  // One monthly allowance per plan: Autopilot articles and new owner drafts
  // count against the same number the pricing page promises (and the
  // dashboard shows), so the two can never add up past the plan.
  // The dashboard passes the stored count; a new draft is checked against the
  // stored count, which every admission updates before the next one can run.
  const used = displayedUsed ?? (await accountArticlesThisMonth(ctx, site)).used;
  return { tier, used, limit: OWNER_DRAFTS_PER_MONTH[tier] as number };
}
const LIMIT = 1000;
/** Terminal outcomes an Autopilot site moves past without the owner: nothing was
 * published and no external write is uncertain. The failed job keeps its missed
 * deadline, attempts and spending; the schedule continues with the next slot. */
const AUTOPILOT_SKIPPABLE_FAILURES = new Set(["bounded_content_quality_exhausted", "content_model_response_invalid", "candidate_rejected_before_draft",
  // The writing service stayed busy (rate limited or overloaded) through every retry: nothing was written or charged for it.
  "content_provider_unavailable",
  // The article repeats a page the site already has (P140): it is held back and the slot gets a new topic.
  "duplicate_intent",
  // A waiting article fails a reader-visible check added after it was sealed (P152): held back, the slot gets a new article.
  "reader_visible_defect",
  // The provider refused for lack of credit (a verified refusal receipt, nothing published). Oct 5-14 2026 one such
  // slot froze both owner sites for nine days after the credit was restored; the refused job keeps its receipt and
  // hold exactly as recorded, and the schedule moves on.
  "content_provider_credit_unavailable",
  // The API refused the request before any model ran (e.g. a model that does not accept the request shape): nothing
  // was written or charged. The operator is alerted by content health; the schedule moves on meanwhile.
  "content_provider_request_rejected",
  // A writing call whose answer was lost (a transport error or timeout). Its spend ceiling stays held and the call is
  // never replayed, but nothing was published, so the slot is recorded as missed and the schedule continues instead of
  // freezing until someone reconciles it (Oct 15 2026: one froze pentra.dev's schedule).
  "content_provider_result_ambiguous_reconciliation_required"]);
/** An Autopilot site moves past a failed automatic article when nothing was
 * published and no external write is uncertain: a skippable failure, or an
 * internal processing failure (a reviewer that answered inconsistently, a
 * worker that failed every bounded recovery) on work that never attempted
 * publication. Phase 4 (P115, Oct 20 2026): such failures paused the whole
 * site until an operator repaired them, and nothing told the customer; under
 * rule 2a the reviewer is a note, so the slot is recorded as missed (or
 * replaced) and content health reports it. */
function autopilotSkippableFailure(job: Doc<"jobs">) {
  const failure = job.contentWork?.failure ?? "";
  return AUTOPILOT_SKIPPABLE_FAILURES.has(failure) || (internalContentProcessingError(failure) && !(job.publicationAttempts ?? 0));
}
/** After repeated failed automatic articles, the next attempt waits (2h, then
 * 4h; never longer than one cadence interval) instead of retrying at once: a failure
 * that persists (a reviewer regression, a provider outage) must not burn
 * topics and spend in a loop. The cadence resumes on the first success. */
async function autopilotFailureBackoffUntil(ctx: MutationCtx, siteId: Id<"sites">, intervalMs: number) {
  const automatic = (j: Doc<"jobs">) => Boolean(j.contentWork && j.contentWork.intent === "create" && !j.contentWork.ownerRequest);
  // A quality failure judged by checks since corrected says nothing about the next attempt (P181), and an
  // article Pentra held back (a copy of a live page, a reader check added since) is not a writing failure (P203:
  // pentra.dev's first plan-audit hold-back put its slot's new article two hours into a backoff).
  const failed = (await ctx.db.query("jobs").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "failed")).order("desc").take(20))
    .filter(j => automatic(j) && j.contentWork!.stage === "failed" && !outdatedQualityVerdict(j) && !HELD_BACK_FAILURES.has(j.contentWork!.failure ?? ""));
  if (failed.length < 2) return 0;
  const done = (await ctx.db.query("jobs").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "done")).order("desc").take(10))
    .filter(automatic);
  const lastSuccess = done.reduce((max, j) => Math.max(max, j.updatedAt), 0);
  const streak = failed.filter(j => j.updatedAt > lastSuccess).sort((a, b) => b.updatedAt - a.updatedAt);
  if (streak.length < 2) return 0;
  return streak[0].updatedAt + Math.min(intervalMs, 4 * 3_600_000, 2 * 3_600_000 * 2 ** (streak.length - 2));
}
/** Autopilot keeps the cadence: a failed slot gets one fresh article (a new
 * topic, a new job and its own reservation) when there is still this much time
 * before the slot. The failed job stays on record; nothing is reset. */
const AUTOPILOT_REPLACEMENT_LEAD_MS = 60 * 60_000;
/** The failure backoff spaces retries; it never takes a slot's first attempt.
 * A slot due within this lead that no work has tried yet is prepared at once. */
export const SLOT_PREP_LEAD_MS = 6 * 3_600_000;
function autopilotReplaceable(job: Doc<"jobs">) {
  const cw = job.contentWork;
  // P204: a replacement that Pentra itself held back (a copy of a live page, a reader check added since) is replaceable
  // once more; any other failed replacement is not. SLOT_MAX_JOBS bounds a slot's jobs either way.
  return Boolean(cw && cw.stage === "failed" && !cw.ownerRequest && cw.retiredAt === undefined &&
    (!cw.replacesJobId || HELD_BACK_FAILURES.has(cw.failure ?? "")) &&
    (cw.intent === "create" ? autopilotSkippableFailure(job) : automaticImprovement(cw)));
}
/** P204 (Oct 26 2026): the first plan audit (P194) held back pentra.dev's Oct 27 article, the replacement for that
 * slot's failed first draft, and a replacement could not be replaced: after the Oct 26 publication the slot would have
 * been parked (missed). A slot's next article replaces its latest failed job, when that job is replaceable and not
 * already replaced, and the slot has had fewer than SLOT_MAX_JOBS jobs. */
const SLOT_MAX_JOBS = 3;
function latestFailedAt(work: Doc<"jobs">[], deadlineAt: number) {
  return work.filter(j => j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === deadlineAt)
    .sort((a, b) => b._creationTime - a._creationTime)[0];
}
function slotReplacementCandidate(work: Doc<"jobs">[], deadlineAt: number) {
  if (work.filter(j => j.contentWork!.deadlineAt === deadlineAt).length >= SLOT_MAX_JOBS) return null;
  const failed = latestFailedAt(work, deadlineAt);
  return failed && autopilotReplaceable(failed) && !work.some(j => j.contentWork!.replacesJobId === failed._id) ? failed : null;
}
/** Autopilot chose this page improvement or refresh itself. Its failure never
 * holds the slot: nothing was published for it, so the slot gets a new
 * article (or moves on), exactly like a skippable failed article. */
function automaticImprovement(cw: NonNullable<Doc<"jobs">["contentWork"]>) {
  return cw.intent === "improve" && !cw.ownerRequest;
}
/** A content job's reservation is bound to its slot; a slot replacement has its own. */
function contentSlotTriggerMatches(trigger: string, cw: { deadlineAt: number; replacesJobId?: Id<"jobs"> }) {
  return trigger === `content_slot:${cw.deadlineAt}${cw.replacesJobId ? ":replacement" : ""}` ||
    trigger.startsWith(`content_slot:${cw.deadlineAt}:remaining_window:`);
}
/** Two failures among the last three finished Autopilot articles means
 * something systematic is wrong: stop spending on replacements (slots still
 * park) so the owner and support see it instead of paying for repeats. */
function replacementsHealthy(work: Doc<"jobs">[]) {
  const finished = work.filter(j => j.contentWork!.intent === "create" && ["verified", "failed"].includes(j.contentWork!.stage) &&
    !HELD_BACK_FAILURES.has(j.contentWork!.failure ?? "") && !outdatedQualityVerdict(j))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  return finished.filter(j => j.contentWork!.stage === "failed").length < 2;
}
/** P181 (Oct 25 2026): a pentra.dev slot's drafts failed on a check that read
 * a linked citation marker as a number, and its replacement draft got no edit
 * pass; with that failure and one before it read as a streak, the slot got no
 * replacement and would have been missed. Quality failures judged by an older
 * version of the blocking checks (CONTENT_CHECKS_VERSION) are not a streak. */
function outdatedQualityVerdict(job: Doc<"jobs">) {
  return job.contentWork!.failure === "bounded_content_quality_exhausted" && (job.contentWork!.checksVersion ?? 0) < CONTENT_CHECKS_VERSION;
}
/** Articles the nightly sweep held back after they were sealed (a repeat of a
 * live page, or a reader check added later): the write itself succeeded, so
 * they never count as a failing streak (P173, Oct 24 2026: LeadPilot's held
 * Oct 25 article plus an earlier rejected draft read as one, so the held slot
 * got no replacement and the scheduler returned "content_failed_slot" on
 * every pass until the slot would have been parked). */
const HELD_BACK_FAILURES = new Set(["duplicate_intent", "reader_visible_defect"]);
const TOPIC_REPLENISH_INTERVAL_MS = 3 * 86_400_000, TOPIC_REPLENISH_BUDGET_MICRO_USD = 1_000_000;
/** A keyword naming one of the site's listed competitors can't be written: the writer
 * must never name them, so the draft is blocked. Such topics are never chosen. */
function competitorNamesFor(site: Pick<Doc<"sites">, "competitors">): string[] {
  return (site.competitors ?? []).map(c => {
    const host = c.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
    const base = host.replace(/\.(com|io|co|org|net|ai|app|dev|so|us|uk|co\.uk)$/, "").trim();
    // A short one-word brand is often an everyday word ("seo.ai", "copy.ai"):
    // match its full name so ordinary keywords like "ad copy" stay available.
    return base !== host && !/\s/.test(base) && base.length < 5 ? host : base;
  }).filter(name => name.length >= 3);
}
function namesCompetitor(text: string, names: string[]) {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return names.some(name => normalized.includes(` ${name.replace(/[^a-z0-9]+/g, " ").trim()} `) ||
    normalized.replace(/ /g, "").includes(name.replace(/[^a-z0-9]+/g, "")) && name.replace(/[^a-z0-9]+/g, "").length >= 5);
}
/** Keywords above this difficulty are out of reach for most small sites; research asks for this bound too. */
const WINNABLE_KEYWORD_DIFFICULTY = 45;
/** The hardest keyword Autopilot writes for this site. A measured weak domain
 * gets its reach ceiling (the winnability model's own bound: past it a keyword
 * scores zero): leadpilot.chat (authority 4) and pentra.dev (0) reach KD 32,
 * yet KD 33-45 searches were still written once easier ones ran out. An
 * unmeasured or established site keeps the general bound. */
export function siteDifficultyCeiling(site: Doc<"sites">): number {
  const authority = storedTenantAuthority(site);
  return authority === undefined ? WINNABLE_KEYWORD_DIFFICULTY : Math.min(WINNABLE_KEYWORD_DIFFICULTY, preSerpReachCeiling(authority));
}
/** Research that found no new keyword is not repeated for a week. */
const TOPIC_REPLENISH_EMPTY_BACKOFF_MS = 7 * 86_400_000;
/** Research never runs more than once a day for a site. */
const TOPIC_REPLENISH_MIN_GAP_MS = 86_400_000;
/** Spacing between two keyword researches for a site. It scales with the
 * cadence: a site publishing three times a day uses up a research batch in a
 * day or two, so it cannot wait three days (or a week after an empty run). */
export function topicResearchGapMs(schedule: { intervalMs: number; topicsReplenishAdded?: number }) {
  const scaled = Math.max(TOPIC_REPLENISH_MIN_GAP_MS, 3 * schedule.intervalMs);
  const added = schedule.topicsReplenishAdded;
  if (added === 0) return Math.min(TOPIC_REPLENISH_EMPTY_BACKOFF_MS, scaled);
  const gap = Math.min(TOPIC_REPLENISH_INTERVAL_MS, scaled);
  // A thin run (fewer new topics than the slots before the next run) is
  // followed up after one slot with the next seeds, instead of leaving slots
  // without a topic. A weekly site never has a slot inside the gap.
  if (added !== undefined && added < Math.floor(gap / schedule.intervalMs)) return Math.max(schedule.intervalMs, 8 * 3_600_000);
  return gap;
}
/** Research starts before the searched keywords run out: when fewer are left
 * than about four days of slots (at least 3, at most 12). */
export function topicRunwayTarget(intervalMs: number) {
  return Math.max(3, Math.min(12, Math.ceil(4 * 86_400_000 / Math.max(intervalMs, 3_600_000))));
}
export function topicResearchDueAt(schedule: { intervalMs: number; topicsReplenishAdded?: number; topicsReplenishedAt?: number;
  topicsResearchReceipt?: { seedSource?: string; method?: number } }) {
  // A site whose last research used an earlier method researches again an hour after it, without waiting for its topics to run low.
  if (researchMethodOutdated(schedule)) return (schedule.topicsReplenishedAt ?? 0) + TOPIC_RESEARCH_METHOD_CHANGE_GAP_MS;
  return (schedule.topicsReplenishedAt ?? 0) + topicResearchGapMs(schedule);
}
/** A research run with an earlier method than TOPIC_RESEARCH_METHOD (convex/lib/researchSeeds.ts) is redone, once. */
const TOPIC_RESEARCH_METHOD_CHANGE_GAP_MS = 60 * 60_000;
export function researchMethodOutdated(schedule: { topicsResearchReceipt?: { seedSource?: string; method?: number } }) {
  const receipt = schedule.topicsResearchReceipt;
  // Receipts before P172 carry no method: P171's carry a seed source (method 1), older ones neither (0).
  return Boolean(receipt) && (receipt!.method ?? (receipt!.seedSource ? 1 : 0)) < TOPIC_RESEARCH_METHOD;
}
/** P172: the newest searches the buyer-fit model dropped that research reads back (about seven runs' worth). */
const TOPIC_RESEARCH_DROPS_READ = 600;
/** An Autopilot article waits for fresh keyword research only while its slot is at least this far away. */
const TOPIC_RESEARCH_WAIT_MARGIN_MS = 90 * 60_000;
/** Autopilot writes for searched keywords: when none is left, research new
 * ones for the confirmed business (bounded spend, at most every few days). */
async function startTopicResearchIfDue(ctx: MutationCtx, site: Doc<"sites">, articleBudgetMicroUsd: number) {
  const schedule = site.contentSchedule;
  if (!schedule?.autopilotSelectedAt || !site.userId) return false;
  if (Date.now() < topicResearchDueAt(schedule)) return false;
  const request = { siteId: site._id, userId: site.userId, purpose: "topic_plan" as const, trigger: `autopilot_topics:${Math.floor(Date.now() / TOPIC_REPLENISH_MIN_GAP_MS)}`,
    reservedMicroUsd: TOPIC_REPLENISH_BUDGET_MICRO_USD, timestamp: Date.now() };
  // Research only when the account can still afford the article after it: the cadence comes first.
  const room = await inspectSharedProviderBudget(ctx, { ...request, reservedMicroUsd: TOPIC_REPLENISH_BUDGET_MICRO_USD + articleBudgetMicroUsd });
  if (!room.ok) return false;
  const reserved = await reserveSharedProviderBudget(ctx, request);
  // A refused reservation spends nothing; try again on the next check.
  if (!reserved.ok) return false;
  const next = { ...schedule, topicsReplenishedAt: Date.now(), topicsResearchRound: (schedule.topicsResearchRound ?? 0) + 1 };
  delete next.topicsReplenishAdded;
  await ctx.db.patch(site._id, { contentSchedule: next, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.growthTopics.replenish, { siteId: site._id, reservationId: reserved.reservationId });
  return true;
}
function usageMonthBounds(now = new Date()) {
  return { monthStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    nextMonthStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) };
}
/** One article job's share of the monthly allowance (a replaced slot is
 * excluded by the caller): automatic creations plus new owner drafts; edits of
 * an existing draft, retired automatic work and work that ended without
 * delivering anything (contentJobUsesAllowance) do not count. */
function countsTowardMonthlyUsage(j: Doc<"jobs">, monthStart: number) {
  return Boolean(j.contentWork && j.contentWork.intent === "create" && j.createdAt >= monthStart &&
    (j.contentWork.ownerRequest ? !j.contentWork.ownerRequest.sourceArticleId : j.contentWork.retiredAt === undefined) &&
    contentJobUsesAllowance(j));
}
/** New articles started this UTC month, counted live from every article job of
 * the month on every site of the account. Each job document carries its
 * provider checkpoints, so this read grows all month: on Oct 18 2026 it passed
 * Convex's 16 MB per-execution read limit for the owner account and every
 * Autopilot run on both sites failed inside admission. It now runs only when
 * no stored count exists for the month (early in a month, when it is small);
 * the exact recount runs in bounded pages (recountAccountUsageStep). */
async function liveAccountArticlesThisMonth(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  const { monthStart, nextMonthStart } = usageMonthBounds();
  let used = 0;
  for (const owned of await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", site.userId!)).take(LIMIT)) {
    const siteJobs = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q =>
      q.eq("siteId", owned._id).gte("contentWork.deadlineAt", monthStart)).take(LIMIT);
    // A failed Autopilot slot that got a replacement counts once (the replacement).
    const replaced = new Set(siteJobs.map(j => j.contentWork?.replacesJobId).filter(Boolean));
    used += siteJobs.filter(j => !replaced.has(j._id) && countsTowardMonthlyUsage(j, monthStart)).length;
  }
  return { used, monthStart, nextMonthStart };
}
/** The account's new articles this UTC month: the stored count, kept exact by
 * the mutations that start or convert article work (they add their article at
 * once) and reconciled by a paged recount after every change. */
async function accountArticlesThisMonth(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  const { monthStart, nextMonthStart } = usageMonthBounds();
  if (site.userId) {
    const row = await ctx.db.query("account_content_usage").withIndex("by_user_month", q => q.eq("userId", site.userId!).eq("monthStart", monthStart)).first();
    if (row) return { used: row.used, monthStart, nextMonthStart };
  }
  return liveAccountArticlesThisMonth(ctx, site);
}
async function storeAccountUsage(ctx: MutationCtx, userId: string, monthStart: number, used: number) {
  const row = await ctx.db.query("account_content_usage").withIndex("by_user_month", q => q.eq("userId", userId).eq("monthStart", monthStart)).first();
  // Only a changed count is written, so open dashboards do not re-run for nothing.
  if (!row) await ctx.db.insert("account_content_usage", { userId, monthStart, used, updatedAt: Date.now() });
  else if (row.used !== used) await ctx.db.patch(row._id, { used, updatedAt: Date.now() });
}
/** Work that starts, converts or retires an article updates the stored count:
 * `added` articles at once (negative for retired work; so the next admission in
 * the same breath sees them),
 * then an exact paged recount reconciles everything else (retirements,
 * replacements, owner edits). Never reads the month's jobs in one execution. */
async function refreshAccountUsage(ctx: MutationCtx, site: Doc<"sites">, added = 0) {
  if (!site.userId) return;
  const { monthStart } = usageMonthBounds();
  if (added) {
    const row = await ctx.db.query("account_content_usage").withIndex("by_user_month", q => q.eq("userId", site.userId!).eq("monthStart", monthStart)).first();
    if (row) await ctx.db.patch(row._id, { used: Math.max(0, row.used + added), updatedAt: Date.now() });
    else await storeAccountUsage(ctx, site.userId, monthStart, (await liveAccountArticlesThisMonth(ctx, site)).used);
  }
  // One trailing recount per burst (B, Oct 20 2026): a publication, its refill
  // and a replacement within minutes each scheduled a full recount, and each
  // reads every content job of the month (42 steps, ~20 MB, in five minutes on
  // the owner account). A recount already due reconciles this change too;
  // `added` above keeps starts exact at once.
  const pending = await ctx.db.query("account_usage_recounts").withIndex("by_user", q => q.eq("userId", site.userId!)).first();
  if (pending && pending.dueAt > Date.now()) return;
  const dueAt = Date.now() + USAGE_RECOUNT_DEBOUNCE_MS;
  if (pending) await ctx.db.patch(pending._id, { dueAt });
  else await ctx.db.insert("account_usage_recounts", { userId: site.userId, dueAt });
  const siteIds = (await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", site.userId!)).take(LIMIT)).map(owned => owned._id);
  await ctx.scheduler.runAt(dueAt, internal.contentWork.recountAccountUsageStep, { userId: site.userId, monthStart, siteIds,
    siteIndex: 0, cursor: null, used: 0, candidates: [], replaced: [] });
}
const USAGE_RECOUNT_DEBOUNCE_MS = 5 * 60_000;
/** Job documents per recount page: each is at most 1 MB, so a page stays far
 * below the 16 MB per-execution read limit. */
const USAGE_RECOUNT_PAGE = 8;
export const recountAccountUsageStep = internalMutation({
  args: { userId: v.string(), monthStart: v.number(), siteIds: v.array(v.id("sites")), siteIndex: v.number(),
    cursor: v.union(v.string(), v.null()), used: v.number(), candidates: v.array(v.id("jobs")), replaced: v.array(v.id("jobs")) },
  handler: async (ctx, args) => {
    // A new month gets its own count; never write an old month's total over it.
    if (usageMonthBounds().monthStart !== args.monthStart) return;
    let { used, siteIndex, candidates, replaced } = args;
    const siteId = args.siteIds[siteIndex];
    if (siteId) {
      const page = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q =>
        q.eq("siteId", siteId).gte("contentWork.deadlineAt", args.monthStart)).paginate({ numItems: USAGE_RECOUNT_PAGE, cursor: args.cursor });
      for (const j of page.page) {
        if (j.contentWork?.replacesJobId) replaced = [...replaced, j.contentWork.replacesJobId];
        if (countsTowardMonthlyUsage(j, args.monthStart)) candidates = [...candidates, j._id];
      }
      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.contentWork.recountAccountUsageStep, { ...args, cursor: page.continueCursor, candidates, replaced });
        return;
      }
      const replacedIds = new Set(replaced.map(String));
      used += candidates.filter(id => !replacedIds.has(String(id))).length;
      siteIndex += 1;
      if (siteIndex < args.siteIds.length) {
        await ctx.scheduler.runAfter(0, internal.contentWork.recountAccountUsageStep, { ...args, siteIndex, cursor: null, used, candidates: [], replaced: [] });
        return;
      }
    }
    await storeAccountUsage(ctx, args.userId, args.monthStart, used);
  },
});
/** The month's usage as the dashboard shows it: the stored count, or the live
 * count when none is stored for this month yet. */
async function displayedAccountUsage(ctx: QueryCtx, site: Doc<"sites">) {
  if (!site.userId) return 0;
  return (await accountArticlesThisMonth(ctx, site)).used;
}
/** Optional writer pricing inside a deployment pricing JSON: the model that
 * writes and rewrites articles ("writer": {model, inputMicroUsdPerToken,
 * outputMicroUsdPerToken}); every check keeps the main model. Invalid or
 * absent means the main model does everything. */
/** A per-token price in micro-dollars. Fractions are allowed (A3, Oct 19 2026):
 * Claude Haiku 5.5 lists at $0.10/$0.50 per million tokens (0.1/0.5 µUSD a
 * token), which whole micro-dollars priced 10x and 6x too high, so caps bound
 * early. Every call's cost and ceiling is rounded up to whole micro-dollars. */
export function validTokenPrice(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0.001 && n <= 1_000;
}
export function writerPricing(raw: unknown): { model: string; inputMicroUsdPerToken: number; outputMicroUsdPerToken: number } | undefined {
  const w = raw && typeof raw === "object" ? (raw as { writer?: unknown }).writer : undefined;
  if (!w || typeof w !== "object") return undefined;
  const { model, inputMicroUsdPerToken, outputMicroUsdPerToken } = w as Record<string, unknown>;
  if (typeof model !== "string" || !model.startsWith("claude-") ||
    ![inputMicroUsdPerToken, outputMicroUsdPerToken].every(validTokenPrice)) return undefined;
  return { model, inputMicroUsdPerToken: inputMicroUsdPerToken as number, outputMicroUsdPerToken: outputMicroUsdPerToken as number };
}
async function pricingConfiguration(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, job?: Doc<"jobs">) {
  // Deployment-owned pricing is deliberately absent by default. Selection is
  // consent, not activation. An optional selector enables only the immutable
  // saved run; it is never a caller flag or a tenant-name allowlist.
  let p, pub;
  try { p = JSON.parse(process.env.PENTRA_CONTENT_WORK_PRICING ?? "null"); } catch { p = null; }
  // Public customer pricing may run beside a scoped owner validation grant.
  // It never applies to a site bound to that grant, and never rebinds a job.
  try { pub = JSON.parse(process.env.PENTRA_PUBLIC_CONTENT_PRICING ?? "null"); } catch { pub = null; }
  const publicPricing = pub && typeof pub === "object" && typeof pub.model === "string" && pub.model && !("validationAuthorizationId" in pub) &&
    [pub.inputMicroUsdPerToken, pub.outputMicroUsdPerToken].every(validTokenPrice) && Number.isSafeInteger(pub.budgetMicroUsd) && pub.budgetMicroUsd > 0
    ? { model: pub.model as string, inputMicroUsdPerToken: pub.inputMicroUsdPerToken as number,
        outputMicroUsdPerToken: pub.outputMicroUsdPerToken as number, budgetMicroUsd: pub.budgetMicroUsd as number,
        ...(writerPricing(pub) ? { writer: writerPricing(pub)! } : {}),
        validationAuthorizationId: undefined as Id<"provider_budget_authorizations"> | undefined } : null;
  const scoped = Boolean(p && typeof p === "object" && "validationAuthorizationId" in p);
  const cw = job?.contentWork;
  // Ordinary existing jobs keep their original execution/pricing semantics.
  // A scoped job can never become ordinary by removing deployment pricing.
  if (cw && !scoped && cw.pricing.validationAuthorizationId === undefined) return { ...cw.pricing, budgetMicroUsd: cw.budgetMicroUsd };
  if (cw && scoped && publicPricing && cw.pricing.validationAuthorizationId === undefined && cw.validationAuthorizationId === undefined) {
    return { ...cw.pricing, budgetMicroUsd: cw.budgetMicroUsd };
  }
  if (!cw && scoped && publicPricing && !site.contentSchedule?.validationAuthorizationId) return publicPricing;
  if (!p || typeof p.model !== "string" || !p.model ||
    ![p.inputMicroUsdPerToken, p.outputMicroUsdPerToken].every(validTokenPrice) || !Number.isSafeInteger(p.budgetMicroUsd) || p.budgetMicroUsd <= 0) return null;
  let validationAuthorizationId: Id<"provider_budget_authorizations"> | undefined;
  try {
    if (scoped) {
      if (typeof p.validationAuthorizationId !== "string" ||
        !ctx.db.normalizeId("provider_budget_authorizations", p.validationAuthorizationId)) return null;
      const binding = await contentValidationBinding(ctx, site, Date.now(), job);
      if (!binding || binding.id !== p.validationAuthorizationId || binding.state !== "active" ||
        (job && cw?.pricing.validationAuthorizationId !== binding.id)) return null;
      validationAuthorizationId = binding.id;
    } else if (cw?.pricing.validationAuthorizationId !== undefined) return null;
    return { ...(cw ? cw.pricing : { model: p.model as string, inputMicroUsdPerToken: p.inputMicroUsdPerToken as number,
      outputMicroUsdPerToken: p.outputMicroUsdPerToken as number, ...(writerPricing(p) ? { writer: writerPricing(p)! } : {}) }),
      ...(validationAuthorizationId ? { validationAuthorizationId } : {}), budgetMicroUsd: cw?.budgetMicroUsd ?? p.budgetMicroUsd as number };
  } catch { return null; }
}
async function contentEntitlementAuthorized(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  if (!site.userId) return false;
  const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
  return entitlement?.status === "completed" && await siteExecutionAuthorized(ctx, site);
}

/** SLC uses a reserved, per-call monetary envelope instead of the legacy
 * worker-count proxy for provider cost. This does not replace article usage,
 * concurrency, quality limits, or the checks performed before EACH paid call. */
export async function hasContentWorkProviderBudget(ctx: MutationCtx, site: Doc<"sites">, job: Doc<"jobs">) {
  const cw = job.contentWork;
  if (!cw || cw.retiredAt !== undefined || cw.operation || job.siteId !== site._id ||
    !["prepare", "review"].includes(cw.stage) || cw.revisions > 2 || cw.replacements > 1 ||
    cw.providerCalls.length > 20 || cw.providerCalls.some(c => c.state !== "completed" &&
      !(c.state === "rejected" && c.rejectionCode === "provider_credit_unavailable" && c.creditRecovery?.requestedAt !== undefined)) ||
    !Number.isSafeInteger(cw.budgetMicroUsd) || cw.budgetMicroUsd <= 0 ||
    cw.profileHash !== confirmedContentProfileHash(site) || cw.connectionHash !== contentConnectionHash(site) ||
    !await pricingConfiguration(ctx, site, job)) return false;
  const receipt = job.providerSpendReservationId ? await ctx.db.get(job.providerSpendReservationId) : null;
  if (!receipt || receipt.siteId !== site._id || receipt.userId !== site.userId || receipt.purpose !== "content_work" ||
    receipt.releasedAt !== undefined || receipt.settledAt !== undefined || receipt.reservedMicroUsd <= 0 ||
    !contentSlotTriggerMatches(receipt.trigger, cw)) return false;
  try { for (const call of cw.providerCalls) if (call.creditRecovery?.requestedAt !== undefined) await retainedCreditEvidence(ctx, job, call); }
  catch { return false; }
  const costs = cw.providerCalls.map(c => c.actualMicroUsd ?? c.ceilingMicroUsd);
  if (costs.some(c => c === undefined || !Number.isSafeInteger(c) || c < 0)) return false;
  const used = costs.reduce<number>((sum, c) => sum + c!, 0);
  const prior = cw.providerCalls.filter(c => c.reservationId && c.reservationId !== receipt._id)
    .reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  return used <= cw.budgetMicroUsd && receipt.reservedMicroUsd === cw.budgetMicroUsd - prior;
}
async function jobsForSite(ctx: MutationCtx, siteId: Id<"sites">, fromDeadline?: number) {
  const jobs = fromDeadline === undefined
    ? await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", siteId)).take(LIMIT + 1)
    : await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", fromDeadline)).take(LIMIT + 1);
  if (jobs.length > LIMIT) throw new Error("Content work inventory is incomplete");
  if (fromDeadline !== undefined) for (const status of ["pending", "running"]) {
    const active = await ctx.db.query("jobs").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", status)).take(LIMIT + 1);
    if (active.length > LIMIT) throw new Error("Active work inventory is incomplete");
    for (const job of active) if (!jobs.some(j => j._id === job._id)) jobs.push(job);
  }
  if (fromDeadline !== undefined) {
    // Restoration is not a cadence slot; it can precede the next fixed deadline.
    const verifying = await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", "verify")).take(LIMIT + 1);
    if (verifying.length > LIMIT) throw new Error("Verification inventory is incomplete");
    for (const job of verifying) if (!jobs.some(j => j._id === job._id)) jobs.push(job);
  }
  return jobs;
}
async function wake(ctx: MutationCtx, siteId: Id<"sites">) {
  await ctx.scheduler.runAfter(0, internal.autopilot.dispatchSiteFollowup, {
    siteId, trigger: "content_work", reason: "content_work_stage_changed",
  });
}
async function requireOwner(ctx: MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || identity?.subject !== site.userId) throw new Error("Not authorized");
  return site;
}

type ContentCall = NonNullable<Doc<"jobs">["contentWork"]>["providerCalls"][number];
/** A provider call's stored result: inline on calls before P118, otherwise in
 * content_call_results. The row must belong to this job and call and match
 * the recorded hash; anything else reads as no result (never as a replay). */
export async function providerCallResult(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">, call: ContentCall | undefined): Promise<unknown> {
  if (!call) return undefined;
  if (call.result !== undefined) return call.result;
  if (!call.resultRef || !call.resultHash) return undefined;
  const row = await ctx.db.get(call.resultRef);
  return row && row.jobId === jobId && row.key === call.key && row.resultHash === call.resultHash &&
    sha256Hex(JSON.stringify(row.result ?? null)) === call.resultHash ? row.result : undefined;
}
const hasProviderResult = (call: ContentCall) => call.result !== undefined || call.resultRef !== undefined;
/** The action-side read of one retained result (semantic audit clarification). */
export const providerCallResultInternal = internalQuery({ args: { jobId: v.id("jobs"), key: v.string() }, handler: async (ctx, { jobId, key }) => {
  const job = await ctx.db.get(jobId);
  return { result: await providerCallResult(ctx, jobId, job?.contentWork?.providerCalls.find(c => c.key === key)) };
} });
const interruptedCreditCall = (c: ContentCall) => c.state === "rejected" && c.rejectionCode === "provider_credit_unavailable" && c.creditRecovery?.requestedAt === undefined;
function creditRetryToken(job: Doc<"jobs">, call: ContentCall) {
  return sha256Hex(JSON.stringify([job._id, job.siteId, job.contentWork?.profileHash, job.contentWork?.connectionHash,
    call.key, call.requestHash, call.rejectionRequestId, call.creditRecovery?.confirmedAt, call.creditRecovery?.fundingReference]));
}
function creditRunHash(run: Doc<"autopilot_runs">) {
  return sha256Hex(JSON.stringify([run._id, run.siteId, run.jobId, run.articleId, run.status, run.outcome,
    run.scheduledAt, run.startedAt, run.completedAt, run.detail]));
}
async function retainedCreditEvidence(ctx: QueryCtx | MutationCtx, job: Doc<"jobs">, call: ContentCall) {
  const saved = call.creditRecovery;
  if (!saved?.sourceRunId) return;
  const run = await ctx.db.get(saved.sourceRunId);
  if (!run || run.siteId !== job.siteId || run.jobId !== job._id || run.status !== "completed" ||
    legacyCreditRefusal(run.detail)?.requestId !== call.rejectionRequestId || creditRunHash(run) !== saved.sourceEvidenceHash) {
    throw new Error("Retained provider refusal evidence changed; no replay authorized");
  }
}
async function creditRecoveryAuthority(ctx: MutationCtx, site: Doc<"sites">, job: Doc<"jobs">) {
  const cw = job.contentWork;
  if (job.siteId !== site._id || !cw || cw.operation || cw.retiredAt !== undefined || !jobAuthorizedForExecution(site, job) ||
    !(await contentEntitlementAuthorized(ctx, site)) || site.approvalRequired || !contentConnectionComplete(site) ||
    cw.profileHash !== confirmedContentProfileHash(site) || cw.connectionHash !== contentConnectionHash(site)) {
    throw new Error("Interrupted content authority changed");
  }
  if (!pasteDestination(site)) contentWorkConnection(site);
  await authorizedWorkPage(ctx, site, job);
  if (!(await pricingConfiguration(ctx, site, job))) throw new Error("Interrupted content pricing unavailable");
  const binding = await contentValidationBinding(ctx, site, Date.now(), job);
  if (binding && binding.state !== "active") throw new Error("Interrupted content validation is not active");
  const receipt = job.providerSpendReservationId ? await ctx.db.get(job.providerSpendReservationId) : null;
  const prior = cw.providerCalls.filter(c => c.reservationId && c.reservationId !== receipt?._id)
    .reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  if (!receipt || receipt.siteId !== site._id || receipt.userId !== site.userId || receipt.purpose !== "content_work" ||
    receipt.releasedAt !== undefined || receipt.settledAt !== undefined || receipt.reservedMicroUsd !== cw.budgetMicroUsd - prior ||
    !contentSlotTriggerMatches(receipt.trigger, cw)) {
    throw new Error("Interrupted content reservation changed");
  }
  // Separately funded runs account for the original hold across all dates.
  // Ordinary dated holds cannot be borrowed in a later day/month.
  if (!binding?.run.independentFunding && new Date(receipt.createdAt).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    throw new Error("Interrupted ordinary reservation crossed its funding day; retained hold requires review");
  }
}

/** INTERNAL platform-operator attestation after real funding restoration. No
 * provider probe, grant, settlement, worker wake or customer billing mutation.
 * Its immutable reference authorizes at most one owner retry of this refusal. */
export const confirmCreditRestoration = internalMutation({
  args: { siteId: v.id("sites"), jobId: v.id("jobs"), callKey: v.string(), requestHash: v.string(),
    requestId: v.string(), fundingReference: v.string(), evidenceRunId: v.optional(v.id("autopilot_runs")) },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId), job = await ctx.db.get(args.jobId), cw = job?.contentWork;
    const call = cw?.providerCalls.find(c => c.key === args.callKey);
    if (!site || !job || !cw || !call || call.requestHash !== args.requestHash || !/^[a-f0-9]{64}$/.test(args.requestHash) ||
      !validProviderRequestId(args.requestId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(args.fundingReference)) throw new Error("Exact provider restoration reference required");
    await creditRecoveryAuthority(ctx, site, job);
    if (call.creditRecovery) {
      await retainedCreditEvidence(ctx, job, call);
      if (call.rejectionRequestId !== args.requestId || call.creditRecovery.fundingReference !== args.fundingReference ||
        call.creditRecovery.sourceRunId !== args.evidenceRunId) throw new Error("Provider restoration confirmation is immutable");
      return { confirmed: false, confirmedAt: call.creditRecovery.confirmedAt };
    }
    if (job.status !== "failed" || cw.stage !== "failed" || job.workerToken || job.leaseExpiresAt || call !== cw.providerCalls.at(-1) ||
      cw.providerCalls.some(c => c !== call && c.state === "started") || call.actualMicroUsd !== undefined || hasProviderResult(call) ||
      (cw.recoveryAttempts ?? 0) >= MAX_CONTENT_RECOVERIES || cw.providerCalls.length >= 20 ||
      cw.providerCalls.some(c => c.creditRecovery?.fundingReference === args.fundingReference)) throw new Error("Interrupted provider attempt is not eligible for restoration");
    const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (used + call.ceilingMicroUsd > cw.budgetMicroUsd) throw new Error("Interrupted content budget cannot fund the next priced attempt");
    let sourceEvidenceHash: string | undefined, rejectionStage = call.rejectionStage, rejectionRecordedAt = call.rejectionRecordedAt;
    if (args.evidenceRunId) {
      // The old deployment saved no per-call response metadata. Only its first
      // ever draft refusal has a unique call/run relationship: one attempt,
      // one unresolved call, no article or possible successful checkpoint.
      const run = await ctx.db.get(args.evidenceRunId), proof = legacyCreditRefusal(run?.detail);
      if (!run || run.siteId !== site._id || run.jobId !== job._id || run.status !== "completed" || run.outcome !== "job_failed" ||
        run.articleId || proof?.requestId !== args.requestId || !Number.isSafeInteger(run.startedAt) || !Number.isSafeInteger(run.completedAt) ||
        run.scheduledAt > job.createdAt || run.scheduledAt < job.createdAt - 300_000 || run.startedAt! < run.scheduledAt || run.startedAt! > job.createdAt ||
        run.completedAt! < job.updatedAt || run.completedAt! > job.updatedAt + 60_000 || run.completedAt! > Date.now() ||
        job.articleId || job.payload?.articleId || job.publicationAttempts || job.workerAttempts !== 1 || cw.providerCalls.length !== 1 ||
        cw.revisions !== 0 || cw.replacements !== 0 || (cw.recoveryAttempts ?? 0) !== 0 || call.rejectionRequestId || call.rejectionTrackingVersion !== undefined ||
        !["content_provider_result_ambiguous_reconciliation_required", "content_provider_credit_unavailable"].includes(cw.failure ?? "") ||
        !["started", "rejected"].includes(call.state) || (call.state === "rejected" && call.rejectionCode !== "provider_credit_unavailable") ||
        call.logicalKey !== "0:0:draft:submit_article" || call.key !== `${call.logicalKey}:0`) throw new Error("Historical refusal lacks unique first-call evidence; no replay authorized");
      const runs = await ctx.db.query("autopilot_runs").withIndex("by_site_scheduled", q => q.eq("siteId", site._id)
        .gte("scheduledAt", job.createdAt - 300_000).lte("scheduledAt", job.updatedAt + 60_000)).take(101);
      if (runs.length > 100 || runs.filter(r => r.jobId === job._id).length !== 1) throw new Error("Historical provider run evidence is incomplete or conflicting");
      sourceEvidenceHash = creditRunHash(run); rejectionStage = "prepare"; rejectionRecordedAt = run.completedAt;
    } else if (!interruptedCreditCall(call) || call.rejectionStatus !== 400 || call.rejectionRequestId !== args.requestId ||
      !Number.isSafeInteger(call.rejectionRecordedAt) || call.rejectionRecordedAt! > job.updatedAt ||
      !["prepare", "review"].includes(rejectionStage ?? "") || cw.failure !== "content_provider_credit_unavailable") {
      throw new Error("Verified provider refusal receipt required; unknown completion cannot be retried");
    }
    const confirmedAt = Date.now();
    await ctx.db.patch(job._id, { contentWork: { ...cw, failure: "content_provider_credit_unavailable",
      providerCalls: cw.providerCalls.map(c => c.key !== call.key ? c : { ...c, state: "rejected" as const,
        rejectionCode: "provider_credit_unavailable", rejectionStatus: 400, rejectionRequestId: args.requestId,
        rejectionRecordedAt, rejectionStage,
        creditRecovery: { confirmedAt, fundingReference: args.fundingReference,
          ...(args.evidenceRunId ? { sourceRunId: args.evidenceRunId, sourceEvidenceHash } : {}) } }) } });
    return { confirmed: true, confirmedAt };
  },
});

/** Reviewed operator repair for one provably completed, contradictory legacy
 * audit. It performs no I/O and stays paused until ordinary owner Resume.
 * This is not a general failed-job retry or a reset of either attempt limit. */
export const reconcileSemanticAuditFailure = internalMutation({
  args: { siteId: v.id("sites"), jobId: v.id("jobs"), expectedUpdatedAt: v.number(),
    articleHash: v.string(), callKey: v.string(), requestHash: v.string(), resultHash: v.string(), reference: v.string() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId), job = await ctx.db.get(args.jobId), cw = job?.contentWork;
    if (!site?.contentSchedule?.paused || !job || job.siteId !== site._id || !cw || !job.articleId ||
      cw.operation || cw.retiredAt !== undefined || cw.semanticAuditRepair ||
      job.updatedAt !== args.expectedUpdatedAt || job.workerToken || job.leaseExpiresAt || job.publicationAttempts ||
      cw.publishedAt || cw.verifiedAt || cw.approvedArtifactHash ||
      cw.deadlineAt !== site.contentSchedule.nextDeadlineAt || (cw.recoveryAttempts ?? 0) !== MAX_CONTENT_RECOVERIES ||
      !Number.isSafeInteger(job.workerAttempts) || job.workerAttempts! < MAX_CONTENT_RECOVERIES ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.reference)) throw new Error("Semantic audit repair is not eligible or already consumed");
    const terminal = job.status === "failed" && cw.stage === "failed" && cw.failure === "content_recovery_attempts_exhausted";
    const pending = job.status === "pending" && cw.stage === "review" &&
      Boolean(job.error?.includes("materialDefects") && job.error.includes("score below 85"));
    if (!terminal && !pending) throw new Error("Only the legacy semantic-audit parsing failure is repairable");
    const call = cw.providerCalls.at(-1), baseKey = `${cw.replacements}:${cw.revisions}:review:audit_final_article`;
    const callResult = await providerCallResult(ctx, job._id, call);
    if (!call || call.key !== args.callKey || (call.logicalKey ?? call.key) !== baseKey ||
      call.requestHash !== args.requestHash || !/^[a-f0-9]{64}$/.test(args.requestHash) ||
      call.state !== "completed" || !retainedContradictoryContentAudit(callResult) || auditResultHash(callResult) !== args.resultHash ||
      cw.providerCalls.some(c => c.semanticClarificationOf || c.key.includes(SEMANTIC_AUDIT_SUFFIX) || c.state === "started" ||
        (c.state === "completed" && (!Number.isSafeInteger(c.actualMicroUsd) || c.actualMicroUsd! < 0 || !hasProviderResult(c))) ||
        (c.state === "rejected" && !(c.rejectionStatus === 400 && c.rejectionCode === "provider_credit_unavailable" &&
          c.creditRecovery?.requestedAt !== undefined && validProviderRequestId(c.rejectionRequestId))))) {
      throw new Error("Exact completed legacy audit evidence required; uncertain calls cannot be replayed");
    }
    const article = await ctx.db.get(job.articleId);
    if (!article || article.siteId !== site._id || article.updatedAt > job.updatedAt ||
      article.status === "published" || article.publicationReceipt || article.publicationAttemptedAt || article.publicationLeaseOwner ||
      article.publicationOutcomeUnverifiedAt || article.publishedContentHash ||
      publicationArtifactHash(article) !== args.articleHash) throw new Error("Retained article changed or publication is uncertain");
    // Validate the future owner-resumed binding without changing paused state.
    await creditRecoveryAuthority(ctx, { ...site, contentSchedule: { ...site.contentSchedule, paused: false } }, job);
    for (const c of cw.providerCalls) if (c.creditRecovery) await retainedCreditEvidence(ctx, job, c);
    const used = cw.providerCalls.reduce((n, c) => n + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (used + semanticAuditCeiling(cw.pricing) > cw.budgetMicroUsd || cw.providerCalls.length >= 20) throw new Error("Retained audit budget cannot fund one bounded clarification");
    const appliedAt = Date.now();
    await ctx.db.patch(job._id, { status: "pending", nextAttemptAt: undefined, error: undefined,
      contentWork: { ...cw, stage: "review", failure: undefined, semanticAuditRepair: { version: 1, appliedAt, reference: args.reference,
        callKey: call.key, requestHash: args.requestHash, resultHash: args.resultHash, articleHash: args.articleHash,
        previousStatus: job.status, previousStage: cw.stage, ...(cw.failure ? { previousFailure: cw.failure } : {}),
        ...(job.error ? { previousError: job.error } : {}), ...(job.nextAttemptAt !== undefined ? { previousNextAttemptAt: job.nextAttemptAt } : {}),
        workerAttempts: job.workerAttempts!, recoveryAttempts: cw.recoveryAttempts! } }, updatedAt: appliedAt });
    return { reconciled: true, jobId: job._id, appliedAt };
  },
});

type SetupIssue = { code: string; action: string; jobId?: Id<"jobs">; articleId?: Id<"articles">; until?: number };
async function reviewChangedSetup(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, jobs: Doc<"jobs">[], retireAll = false) {
  let connection: string | undefined;
  try { connection = contentConnectionHash(site); } catch { /* An incomplete destination cannot be confirmed. */ }
  const profile = confirmedContentProfileHash(site), schedule = site.contentSchedule;
  const needed = retireAll || Boolean(schedule && (schedule.profileHash !== profile || schedule.connectionHash !== connection));
  const stale = jobs.filter(j => j.contentWork && j.contentWork.retiredAt === undefined && j.contentWork.stage !== "verified" &&
    (retireAll || j.contentWork.profileHash !== profile || j.contentWork.connectionHash !== connection));
  const issues: SetupIssue[] = [];
  const verifying: Doc<"jobs">[] = [], recoveryArticles: Doc<"articles">[] = [];
  if (!needed) return { needed, stale, issues, verifying, recoveryArticles, pristineLease: false };
  if (jobs.length > LIMIT) issues.push({ code: "incomplete", action: "Ask support to complete this site's bounded work-inventory review before confirming changes. New work stays stopped." });
  for (const job of jobs) {
    if (!job.contentWork && ["pending", "running"].includes(job.status)) issues.push({ code: "legacy_work", jobId: job._id,
      action: "Finish or cancel the original legacy job from its job details before confirming the changed content service." });
    if (retireAll && ((job.status === "running" && (!job.workerToken || !Number.isFinite(job.leaseExpiresAt))) ||
      (job.status !== "running" && (job.workerToken || job.leaseExpiresAt !== undefined)))) issues.push({ code: "worker_ownership", jobId: job._id,
      action: "Ask support to reconcile the retained worker ownership before switching. Do not clear its lease or reset its attempt." });
    else if (job.status === "running") issues.push({ code: "worker", jobId: job._id, until: job.leaseExpiresAt,
      action: "Wait for the current worker or its existing lease recovery, then check again. No additional work starts while paused." });
    if (job.contentWork?.retiredAt !== undefined) continue;
    if (!job.articleId) continue;
    const article = await ctx.db.get(job.articleId);
    if (!article || article.siteId !== site._id) { issues.push({ code: "artifact", jobId: job._id, action: "Ask support to recover the exact missing work artifact. Do not reset the job or its spending." }); continue; }
    if (job.contentWork?.intent === "improve") continue;
    if (article.publicationReceipt && article.publicUrlStatus !== "verified") issues.push({ code: "verification", jobId: job._id, articleId: article._id,
      action: "Open this delivered article and fix its live URL, canonical, title or body to match the retained reviewed artifact. Check the existing delivery again; do not publish another copy." });
    if (article.publicationAttemptedAt && !article.publicationReceipt && !article.publicationAmbiguityDispositionAt) issues.push({ code: "uncertain_delivery", jobId: job._id, articleId: article._id,
      action: "Check the original destination for this article. If its exact receipt cannot be recovered, use the article's existing owner-reviewed unverified-delivery disposition after the lease expires. This never asserts publication." });
    if (article.publicationLeaseOwner && article.publicationLeaseHash) recoveryArticles.push(article);
  }
  const revisions = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
  if (revisions.length > LIMIT) issues.push({ code: "incomplete", action: "Ask support to complete this site's retained-delivery inventory review. No old delivery may be discarded to make room." });
  for (const r of revisions) {
    if (r.attemptedAt && !r.liveVerifiedAt && !r.ambiguityDispositionAt) {
      const job = jobs.find(j => j._id === r.contentWorkJobId);
      if (job?.contentWork && ((job.contentWork.stage === "verify" && r.receipt) || (!r.receipt && r.selectedSource?.kind === "wordpress"))) verifying.push(job);
      issues.push({ code: r.receipt ? "verification" : "uncertain_delivery", jobId: job?._id, articleId: r.articleId,
        action: r.receipt ? "Check the already-delivered page against its retained reviewed version. Live verification must finish before the setup can change; no extra write is authorized."
          : "Inspect the original page for this attempted change. If the exact delivery cannot be recovered, open its article's owner-reviewed unverified-revision disposition after lease expiry; resolve any external copy before continuing." });
    }
  }
  const leasedRevisions = revisions.filter(r => site.publicationLeaseOwner && r.leaseOwner === site.publicationLeaseOwner);
  const pristineLease = leasedRevisions.length === 1 && (site.publicationLeaseExpiresAt ?? Infinity) <= Date.now() &&
    (leasedRevisions[0].leaseStartedAt ?? Infinity) + PUBLISHED_REVISION_LEASE_MS <= Date.now() &&
    !leasedRevisions[0].attemptedAt && !leasedRevisions[0].receipt;
  if (site.publicationLeaseOwner && !pristineLease) issues.push({ code: "destination_lease", until: site.publicationLeaseExpiresAt,
    action: "Wait for the existing destination lease to close, then check again. If its exact retained delivery cannot be recovered, use the linked article's owner-reviewed disposition; never clear the lock manually." });
  return { needed, stale, issues, verifying, recoveryArticles, pristineLease };
}

async function scheduleSetupReconciliation(ctx: MutationCtx, site: Doc<"sites">, jobs: Doc<"jobs">[], review: Awaited<ReturnType<typeof reviewChangedSetup>>) {
  for (const job of review.verifying) await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId: site._id, jobId: job._id });
  for (const article of review.recoveryArticles) await ctx.scheduler.runAt(Math.max(Date.now(), site.publicationLeaseExpiresAt ?? 0,
    (article.publicationLeaseStartedAt ?? 0) + PUBLICATION_LEASE_MS), internal.publisher.recoverInitialPublicationLeaseInternal, {
    siteId: site._id, articleId: article._id, expectedContentHash: article.publicationLeaseHash!, expectedLeaseOwner: article.publicationLeaseOwner! });
  for (const job of jobs.filter(j => j.status === "running" && j.workerToken && j.leaseExpiresAt)) await ctx.scheduler.runAt(Math.max(Date.now(), job.leaseExpiresAt!),
    internal.jobs.resetStuckJobs, { siteId: site._id, jobId: job._id, expectedWorkerToken: job.workerToken! });
}

async function closePristineSetupLease(ctx: MutationCtx, site: Doc<"sites">) {
  const revisions = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
  const pristine = revisions.find(r => r.leaseOwner === site.publicationLeaseOwner)!;
  // Only called after the existing exact expiry/no-I/O review has passed.
  await ctx.db.patch(pristine._id, { status: "failed", leaseOwner: undefined, leaseStartedAt: undefined,
    failureCode: "pristine_revision_lease_retired", failureDetail: "Owner requested retirement after the lease expired before any external attempt.", updatedAt: Date.now() });
}

/** Explicit owner review retires stale unstarted work, never rebinds its seal.
 * It reuses normal terminal accounting and new-work admission, not new credit. */
export const reconfirm = mutation({ args: { siteId: v.id("sites"), reviewToken: v.string(), confirm: v.boolean() },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId);
    if (!args.confirm || args.reviewToken !== contentConsentToken(site)) throw new Error("Review and explicitly confirm the current saved setup first");
    return confirmChangedSetup(ctx, site, args.reviewToken);
  } });

/** The owner edits the business facts Pentra writes from and confirms them in
 * one step. The edit is the owner's explicit re-confirmation, so it runs the
 * same changed-setup review as `reconfirm`: work prepared from the old facts is
 * retired (kept on record, never published), spending history and missed
 * deadlines stay as they are, and the schedule continues from the new facts. */
export const updateBusinessFacts = mutation({
  args: { siteId: v.id("sites"), reviewToken: v.string(), confirm: v.boolean(), summary: v.string(), audience: v.string(),
    productUsage: v.string(), offerings: v.array(v.string()), questions: v.array(v.string()) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId);
    if (!args.confirm) throw new ConvexError("Confirm that these facts are accurate before saving.");
    if (args.reviewToken !== contentConsentToken(site)) throw new ConvexError("Your saved setup changed. Refresh and try again.");
    if (site.serviceMode !== "growth_first" || !site.contentSchedule) throw new ConvexError("Finish setting up Pentra for this website first.");
    const text = (value: string, max: number) => value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
    const list = (values: string[], max: number) => [...new Set(values.map(value => text(value, 200)).filter(Boolean))].slice(0, max);
    const summary = text(args.summary, 2000), audience = text(args.audience, 1000), productUsage = text(args.productUsage, 2000);
    if (!summary || !audience || !productUsage) throw new ConvexError("Business facts, who you serve and what you sell are all required.");
    await ctx.db.patch(site._id, { siteSummary: summary, targetAudienceSummary: audience, productUsage,
      keyFeatures: list(args.offerings, 12), painPoints: list(args.questions, 12), updatedAt: Date.now() });
    await removeTopicsFromOldFacts(ctx, (await ctx.db.get(site._id))!);
    const updated = (await ctx.db.get(site._id))!, token = contentConsentToken(updated);
    const result = await confirmChangedSetup(ctx, updated, token);
    await followUpEditedFacts(ctx, updated, token, result, 1);
    return result;
  } });

/** Topics Pentra copied from the owner's facts (a feature or question, not a
 * researched search) are only valid while those facts are. When the owner
 * edits their facts, planned ones built from removed facts are dropped so
 * Autopilot never writes about something the business no longer says it does.
 * Researched keywords, queued/used topics and paid-plan checkpoints stay. */
async function removeTopicsFromOldFacts(ctx: MutationCtx, site: Doc<"sites">) {
  if (site.publicationLeaseOwner) return; // topics are locked while a publication outcome is unresolved
  const anchors = new Set(tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? []),
    ...(site.painPoints ?? []), site.productUsage], 40));
  const questions = new Set((site.painPoints ?? []).map(q => q.trim().replace(/\s+/g, " ")));
  const signals = tenantTopicBusinessSignals(site);
  const fits = (t: Doc<"topic_clusters">) => evaluateTopicBusinessFit({ keyword: t.primaryKeyword, label: t.label, ...signals }).eligible;
  const topics = await ctx.db.query("topic_clusters").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT);
  for (const topic of topics) {
    if (!["planned", "pending"].includes(topic.status ?? "planned") || planCheckpointTopicDeletionLocked(topic)) continue;
    const fromFeature = topic.notes?.startsWith("Confirmed first-party reader question") && (!anchors.has(topic.primaryKeyword) || !fits(topic));
    const fromQuestion = topic.notes?.startsWith("A customer question the owner confirmed") && !questions.has(topic.label);
    if (fromFeature || fromQuestion) await ctx.db.delete(topic._id);
  }
}

/** A worker that is mid-article when the owner saves new facts only delays the
 * confirmation. Retry the owner's confirmation of these exact facts (same token)
 * once that worker's lease has ended, a bounded number of times; anything that
 * needs the owner (connection, billing, deliveries) still waits for them. */
async function followUpEditedFacts(ctx: MutationCtx, site: Doc<"sites">, reviewToken: string,
  result: { status: string; issues: SetupIssue[] }, attempt: number) {
  if (result.status !== "waiting" || attempt > 6 || !result.issues.length || !result.issues.every(issue => issue.code === "worker")) return;
  const until = Math.max(Date.now(), ...result.issues.map(issue => issue.until ?? 0));
  await ctx.scheduler.runAt(until + 60_000, internal.contentWork.confirmEditedFacts, { siteId: site._id, reviewToken, attempt: attempt + 1 });
}

export const confirmEditedFacts = internalMutation({ args: { siteId: v.id("sites"), reviewToken: v.string(), attempt: v.number() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    // Facts or destination changed again since the owner confirmed: their confirmation no longer applies.
    if (!site || contentConsentToken(site) !== args.reviewToken || site.serviceMode !== "growth_first" || !site.contentSchedule) return;
    const result = await confirmChangedSetup(ctx, site, args.reviewToken);
    await followUpEditedFacts(ctx, site, args.reviewToken, result, args.attempt);
  } });

async function confirmChangedSetup(ctx: MutationCtx, site: Doc<"sites">, reviewToken: string) {
    const schedule = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !schedule) throw new Error("Choose the content service first");
    const jobs = await jobsForSite(ctx, site._id), review = await reviewChangedSetup(ctx, site, jobs);
    if (!review.needed) return { status: "unchanged" as const, retired: 0, issues: [] as SetupIssue[] };
    await ctx.db.patch(site._id, { contentSchedule: { ...schedule, paused: true }, updatedAt: Date.now() });
    await scheduleSetupReconciliation(ctx, site, jobs, review);
    if (!contentConnectionComplete(site) || (!pasteDestination(site) && (!publisherDestinationReceiptVerified({ site }) || publicationDestinationBlockers(site).length))) review.issues.push({ code: "connection", action: "Reconnect and verify the exact current GitHub or WordPress destination in website settings, then review these changes again." });
    if (!await contentEntitlementAuthorized(ctx, site)) review.issues.push({ code: "billing", action: "Verify the existing plan in Billing, then check these changes again. No plan or credit is purchased by confirming setup." });
    if (!site.siteSummary?.trim() || !site.targetAudienceSummary?.trim()) review.issues.push({ code: "profile", action: "Complete the confirmed business facts and audience in website settings, then review the saved setup again." });
    if (review.issues.length) return { status: "waiting" as const, retired: 0, issues: review.issues };
    for (const job of review.stale) {
      await ctx.db.patch(job._id, { status: "failed", nextAttemptAt: undefined, workerToken: undefined, heartbeatAt: undefined, leaseExpiresAt: undefined,
        contentWork: { ...job.contentWork!, retiredAt: Date.now(), retiredForReviewToken: reviewToken }, updatedAt: Date.now() });
      const retired = (await ctx.db.get(job._id))!;
      await archiveRetiredContentArtifact(ctx, retired);
      await closeRetiredContentAccounting(ctx, retired);
    }
    if (review.stale.length) await refreshAccountUsage(ctx, site, -review.stale.filter(job => countsTowardMonthlyUsage(job, usageMonthBounds().monthStart)).length);
    if (review.pristineLease) {
      await closePristineSetupLease(ctx, site);
    }
    await ctx.db.patch(site._id, { contentSchedule: { ...schedule, profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      active: false, paused: Boolean(schedule.ownerReviewedOnly), autopublishConsentAt: schedule.ownerReviewedOnly ? undefined : Date.now() }, autopilotEnabled: !schedule.ownerReviewedOnly, autopilotRolloutMode: "warm", approvalRequired: Boolean(schedule.ownerReviewedOnly),
      ...(review.pristineLease ? { publicationLeaseOwner: undefined, publicationLeaseExpiresAt: undefined } : {}), updatedAt: Date.now() });
    // P209: Pentra's own articles follow the business details the owner just confirmed.
    await renewManagedEnrollments(ctx, site);
    if (!schedule.ownerReviewedOnly) await wake(ctx, site._id);
    return { status: "preparing" as const, retired: review.stale.length, issues: [] as SetupIssue[] };
}

/** Stage 1 interface. No customer can opt in implicitly or rewrite an existing
 * deadline by toggling mode. Migration and rollback drain unresolved work. */
export const selectServiceMode = mutation({
  args: { siteId: v.id("sites"), mode: v.union(v.literal("legacy_articles"), v.literal("growth_first")),
    confirmBusinessProfile: v.boolean(), ownerReviewedOnly: v.optional(v.boolean()), authorizeAutomaticPublication: v.optional(v.boolean()), reviewToken: v.optional(v.string()), timezone: v.optional(v.string()), firstDeadlineAt: v.optional(v.number()), intervalMs: v.optional(v.number()),
    autopilot: v.optional(v.boolean()) },
  handler: async (ctx, rawArgs) => {
    let site = await requireOwner(ctx, rawArgs.siteId);
    // New-customer Autopilot: consent to automatic publication with a rhythm
    // derived from the plan; the customer never chooses windows or intervals.
    if (rawArgs.autopilot && (rawArgs.mode !== "growth_first" || rawArgs.ownerReviewedOnly || !site.contentSetupRequestedAt || site.contentSchedule)) {
      throw new Error("Autopilot setup is for a new website connection; existing contracts remain unchanged");
    }
    const plan = rawArgs.autopilot ? await accountPlan(ctx, site) : null;
    const args = plan ? { ...rawArgs, authorizeAutomaticPublication: true, intervalMs: plan.autopilotIntervalMs,
      firstDeadlineAt: Date.now() + FIRST_ARTICLE_LEAD_MS } : rawArgs;
    if ((site.serviceMode ?? "legacy_articles") === args.mode) return { changed: false, status: "completed" as const };
    if (args.ownerReviewedOnly && (args.mode !== "growth_first" || args.authorizeAutomaticPublication ||
      !site.contentSetupRequestedAt || site.contentSchedule || !(["github", "wordpress", "manual"].includes(site.publishMethod ?? "") || isApiCmsMethod(site.publishMethod)))) {
      throw new Error("Owner-reviewed setup is for a new website connection; existing contracts remain unchanged");
    }
    const rollback = args.mode === "legacy_articles";
    if (rollback && args.reviewToken !== undefined && args.reviewToken !== contentConsentToken(site)) throw new Error("Review the current saved setup before switching service");
    // The explicit owner switch is retirement consent, unlike ordinary Pause.
    // Persist the existing pause first. A pending switch requires another owner
    // check after reconciliation; no background mode flip or new work is queued.
    if (rollback) {
      if (!site.contentSchedule) return { changed: false, status: "needs_action" as const, issues: [{ code: "schedule", action: "Ask support to recover the retained service schedule before switching." }] };
      await ctx.db.patch(site._id, { contentSchedule: { ...site.contentSchedule, paused: true }, updatedAt: Date.now() });
      site = (await ctx.db.get(site._id))!;
    }
    let jobs: Doc<"jobs">[];
    try { jobs = await jobsForSite(ctx, site._id); }
    catch (error) {
      if (!rollback) throw error;
      return { changed: false, status: "needs_action" as const, issues: [{ code: "incomplete", action: "New work is paused. Ask support to complete the retained work inventory, then check the switch again." }] };
    }
    if (rollback) {
      const review = await reviewChangedSetup(ctx, site, jobs, true);
      await scheduleSetupReconciliation(ctx, site, jobs, review);
      if (review.issues.length) return { changed: false, status: review.issues.some(i => !["worker", "verification", "destination_lease"].includes(i.code)) ? "needs_action" as const : "pending" as const, issues: review.issues };
      if (review.pristineLease) {
        await closePristineSetupLease(ctx, site);
        await ctx.db.patch(site._id, { publicationLeaseOwner: undefined, publicationLeaseExpiresAt: undefined });
        site = (await ctx.db.get(site._id))!;
      }
      for (const job of review.stale) {
        await ctx.db.patch(job._id, { status: "failed", nextAttemptAt: undefined,
          contentWork: { ...job.contentWork!, retiredAt: Date.now(), retiredForReviewToken: contentConsentToken(site),
            failure: job.contentWork!.failure ?? "content_service_rollback" }, updatedAt: Date.now() });
        const retired = (await ctx.db.get(job._id))!;
        await archiveRetiredContentArtifact(ctx, retired);
        await closeRetiredContentAccounting(ctx, retired);
      }
      if (review.stale.length) await refreshAccountUsage(ctx, site, -review.stale.filter(job => countsTowardMonthlyUsage(job, usageMonthBounds().monthStart)).length);
      for (const job of jobs) if (job.contentWork?.stage === "verified" && job.status === "pending") await closeVerifiedContentWake(ctx, job);
      jobs = await jobsForSite(ctx, site._id);
      // A provider-free correction may have a prepared revision before its
      // worker claims it. Close only its retired, never-leased/no-I/O receipt.
      const prepared = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
      for (const r of prepared) if (r.status === "prepared" && !r.leaseOwner && r.leaseStartedAt === undefined && !r.attemptedAt && !r.receipt &&
        jobs.some(j => j._id === r.contentWorkJobId && j.articleId === r.articleId && j.contentWork?.retiredAt !== undefined)) await ctx.db.patch(r._id, {
          status: "failed", failureCode: "content_service_rollback", failureDetail: "Owner retired unstarted work before switching service; source and audit retained.", updatedAt: Date.now() });
    }
    try {
    if (site.publicationLeaseOwner || jobs.some(j => ["pending", "running"].includes(j.status) ||
      (j.contentWork && j.contentWork.retiredAt === undefined && !["verified", "failed"].includes(j.contentWork.stage)))) throw new Error("Reconcile in-flight content work before switching engines");
    const revisions = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
    if (revisions.length > LIMIT || revisions.some(r =>
      ["prepared", "leased", "attempted", "verification_pending"].includes(r.status) ||
      ((r.status === "unverified" || r.attemptedAt) && !r.liveVerifiedAt && !r.ambiguityDispositionAt))) {
      throw new Error("Reconcile the unfinished or uncertain revision delivery before switching engines");
    }
    for (const table of ["cadence_micro_seed_jobs", "expected_click_evidence_jobs", "expected_click_demand_jobs"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_site_status", q => q.eq("siteId", site._id)).take(LIMIT + 1);
      // These are closed execution states in the legacy watchdogs. A missing
      // provider response retains its monetary hold, not an eternal worker.
      const closed = ["completed", "failed", "cancelled", "expired", "skipped", "done", "published",
        "provider_balance_unavailable", ...(table === "cadence_micro_seed_jobs" ? ["missed", "provider_response_unverified"] : [])];
      if (rows.length > LIMIT || rows.some(r => !closed.includes(r.status) || (r.leaseExpiresAt ?? 0) > Date.now())) {
        throw new Error("Reconcile legacy growth work before switching engines");
      }
    }
    // Growth actions are measured classifications, not worker jobs. Preserve
    // open/monitoring/history unchanged; existing actuation/queue gates exclude
    // growth-first sites. Their actual jobs and ALL revision deliveries above
    // must drain first, including legacy (non-contentWork) revisions.
    const actions = await ctx.db.query("seo_growth_actions").withIndex("by_site_status", q => q.eq("siteId", site._id)).take(LIMIT + 1);
    if (actions.length > LIMIT || actions.some(a => {
      if (!["open", "monitoring", "resolved", "dismissed"].includes(a.status)) return true;
      if (!a.publishedRevisionId) return false;
      const r = revisions.find(r => r._id === a.publishedRevisionId);
      return !r || r.siteId !== site._id || r.articleId !== a.articleId || r.growthActionId !== a._id;
    })) throw new Error("Reconcile legacy growth history before switching engines");
    } catch (error) {
      if (!rollback) throw error;
      return { changed: false, status: "needs_action" as const, issues: [{ code: "retained_history", action: "New work remains paused. Reconcile the retained legacy jobs and revision history, then check the switch again. No delivery or spending history was removed." }] };
    }
    if (rollback) {
      await ctx.db.patch(site._id, { serviceMode: "legacy_articles", contentSchedule: { ...site.contentSchedule!, active: false, paused: true }, updatedAt: Date.now() });
      return { changed: true, status: "completed" as const, issues: [] as SetupIssue[] };
    }
    if (!args.confirmBusinessProfile || !site.siteSummary?.trim() || !site.targetAudienceSummary?.trim() ||
      (!site.contentSetupRequestedAt && !contentAnalysisMatchesCurrentDomain(site))) throw new Error("Confirm the current business and audience first");
    if (args.reviewToken !== contentConsentToken(site)) throw new Error("Saved business or destination changed. Review the current values before confirming.");
    const timezone = args.timezone ?? "UTC";
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid timezone"); }
    if (!contentConnectionComplete(site)) {
      throw new Error("Connect a supported website destination first");
    }
    // Other platforms (paste your own) are Review first only: Pentra never publishes there.
    if (pasteDestination(site) && !args.ownerReviewedOnly) throw new Error("Autopilot needs a connected website (WordPress, Shopify, Webflow, Ghost or GitHub). Choose Review first.");
    if (!pasteDestination(site)) contentWorkConnection(site);
    if (args.ownerReviewedOnly && !pasteDestination(site) && !publisherDestinationReceiptVerified({ site })) throw new Error("Verify the exact website connection first");
    if (!args.ownerReviewedOnly && (!Number.isSafeInteger(args.intervalMs) || args.intervalMs! < CONTENT_DELIVERY_WINDOW_MS ||
      !Number.isSafeInteger(args.firstDeadlineAt) || args.firstDeadlineAt! < Date.now() + CONTENT_DELIVERY_WINDOW_MS)) throw new Error("Choose a future fixed delivery window and interval");
    if (!(await contentEntitlementAuthorized(ctx, site))) throw new Error("Current plan entitlement is required");
    await ctx.db.patch(site._id, { serviceMode: "growth_first", ...(args.ownerReviewedOnly ? { approvalRequired: true, autopilotEnabled: false } : args.authorizeAutomaticPublication === true ? {
      approvalRequired: false, autopilotEnabled: true, autopilotRolloutMode: "warm",
    } : {}), contentSchedule: {
      validationAuthorizationId: site.contentSchedule?.validationAuthorizationId,
      ...(args.ownerReviewedOnly ? { ownerReviewedOnly: true } : {}),
      ...(plan ? { autopilotSelectedAt: Date.now() } : {}),
      selectedAt: Date.now(), profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      ...(args.authorizeAutomaticPublication === true ? { autopublishConsentAt: Date.now() } : {}),
      // Owner-reviewed work has no promised slot; these inert schedule fields
      // retain the existing job contract and are never exposed as a deadline.
      intervalMs: site.contentSchedule?.intervalMs ?? args.intervalMs ?? 86_400_000, nextDeadlineAt: site.contentSchedule?.nextDeadlineAt ?? args.firstDeadlineAt ?? Date.now(), timezone: site.contentSchedule?.timezone ?? timezone, active: false, paused: Boolean(args.ownerReviewedOnly),
    }, updatedAt: Date.now() });
    // P128: start from the missed searches a free check found for this site,
    // before the first article picks its topic; then one buyer-fit call judges
    // them against the confirmed profile.
    if (args.mode === "growth_first") {
      const selected = await ctx.db.get(site._id);
      const imported = selected ? await importFreeCheckTopics(ctx, selected) : 0;
      if (imported > 0 && selected?.contentSchedule?.autopilotSelectedAt) {
        await ctx.scheduler.runAfter(0, internal.actions.growthTopics.sweepBuyerFit, { siteId: site._id });
      }
    }
    if (!args.ownerReviewedOnly) await wake(ctx, site._id);
    // P229: Review first writes the first article at once; the owner reads it before anything goes live.
    else await ctx.scheduler.runAfter(0, internal.contentWork.startFirstDraft, { siteId: site._id });
    return { changed: true };
  },
});

/** Switch a new-customer site between "Review first" and Autopilot. Existing
 * contracts that were not created through the new setup are never changed. */
/** Move an existing growth-first contract (set up before Autopilot existed)
 * onto Autopilot, at the owner's explicit request. Past slots, failures,
 * costs and receipts stay exactly as recorded; only the forward schedule is
 * replaced by the plan-paced one, starting 24 hours from now. */
export const adoptAutopilot = mutation({ args: { siteId: v.id("sites"), reviewToken: v.string(), confirm: v.literal(true) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s || s.autopilotSelectedAt || s.ownerReviewedOnly) {
      throw new ConvexError("This site can't be moved to Autopilot here.");
    }
    if (args.reviewToken !== contentConsentToken(site)) throw new ConvexError("Your saved setup changed. Refresh and try again.");
    if (s.profileHash !== confirmedContentProfileHash(site) || s.connectionHash !== contentConnectionHash(site)) {
      throw new ConvexError("Your business details or website changed. Review and confirm them in Service settings first.");
    }
    if (!contentConnectionComplete(site) || !publisherDestinationReceiptVerified({ site })) throw new ConvexError("Connect and verify your website first.");
    if (!(await contentEntitlementAuthorized(ctx, site))) throw new ConvexError("Your plan needs to be active in Billing first.");
    const jobs = await jobsForSite(ctx, site._id);
    if (jobs.some(j => j.contentWork && ["pending", "running"].includes(j.status))) {
      throw new ConvexError("Pentra is still working on an article for this site. Try again when it finishes.");
    }
    const plan = await accountPlan(ctx, site);
    const { validationAuthorizationId: _grant, ...forward } = s; void _grant;
    await ctx.db.patch(site._id, { approvalRequired: false, autopilotEnabled: true, autopilotRolloutMode: "warm",
      contentSetupRequestedAt: site.contentSetupRequestedAt ?? Date.now(),
      contentSchedule: { ...forward, autopilotSelectedAt: Date.now(), autopublishConsentAt: Date.now(), active: false, paused: false,
        intervalMs: plan.autopilotIntervalMs, nextDeadlineAt: Date.now() + FIRST_ARTICLE_LEAD_MS,
        profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site) }, updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { changed: true };
  } });

export const setAutopilot = mutation({ args: { siteId: v.id("sites"), enabled: v.boolean(), reviewToken: v.string() },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s || !site.contentSetupRequestedAt || (!s.ownerReviewedOnly && !s.autopilotSelectedAt)) {
      throw new ConvexError("This site's service can't be switched here.");
    }
    if (args.reviewToken !== contentConsentToken(site)) throw new ConvexError("Your saved setup changed. Refresh and try again.");
    if (args.enabled) {
      if (!s.ownerReviewedOnly) return { changed: false };
      if (pasteDestination(site)) throw new ConvexError("Autopilot needs a connected website (WordPress, Shopify, Webflow, Ghost or GitHub). Connect one in website settings first.");
      if (!contentConnectionComplete(site) || !publisherDestinationReceiptVerified({ site })) throw new ConvexError("Connect and verify your website first.");
      if (!(await contentEntitlementAuthorized(ctx, site))) throw new ConvexError("Your plan needs to be active in Billing first.");
      const plan = await accountPlan(ctx, site);
      const { ownerReviewedOnly: _omit, ...rest } = s; void _omit;
      // Automatic work prepared before a switch keeps its slots: resume the
      // schedule at the earliest unfinished one instead of orphaning it.
      const unfinished = (await jobsForSite(ctx, site._id)).filter(j => j.contentWork && !j.contentWork.ownerRequest &&
        j.contentWork.retiredAt === undefined && !["verified", "failed"].includes(j.contentWork.stage))
        .map(j => j.contentWork!.deadlineAt).sort((a, b) => a - b);
      await ctx.db.patch(site._id, { approvalRequired: false, autopilotEnabled: true, autopilotRolloutMode: "warm",
        contentSchedule: { ...rest, autopilotSelectedAt: Date.now(), autopublishConsentAt: Date.now(), active: false, paused: false,
          intervalMs: unfinished.length ? s.intervalMs : plan.autopilotIntervalMs,
          nextDeadlineAt: unfinished.length ? unfinished[0] : Date.now() + FIRST_ARTICLE_LEAD_MS,
          profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site) }, updatedAt: Date.now() });
      await wake(ctx, site._id);
      return { changed: true };
    }
    if (s.ownerReviewedOnly) return { changed: false };
    const { autopublishConsentAt: _consent, ...keep } = s; void _consent;
    await ctx.db.patch(site._id, { approvalRequired: true, autopilotEnabled: false,
      contentSchedule: { ...keep, ownerReviewedOnly: true, active: false, paused: true }, updatedAt: Date.now() });
    return { changed: true };
  } });

/** The customer's Autopilot pace (articles per week) for this site. */
export const setAutopilotCadence = mutation({ args: { siteId: v.id("sites"), reviewToken: v.string(), cadencePerWeek: v.number() },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s?.autopilotSelectedAt || s.ownerReviewedOnly) throw new ConvexError("Turn on Autopilot first.");
    if (args.reviewToken !== contentConsentToken(site)) throw new ConvexError("Your saved setup changed. Refresh and try again.");
    if (!targetCadenceOptions().some(option => option.value === args.cadencePerWeek)) throw new ConvexError("Choose one of the listed paces.");
    if (site.cadencePerWeek === args.cadencePerWeek && site.cadenceRequestedPerWeek === args.cadencePerWeek) return { changed: false };
    // The requested pace is what plan reconciliation keeps; without it an
    // owner's chosen pace silently reverted at the next plan sync.
    await ctx.db.patch(site._id, { cadencePerWeek: args.cadencePerWeek, cadenceRequestedPerWeek: args.cadencePerWeek, updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { changed: true };
  } });
/** The same pace change made by the operator on the owner's instruction
 * (deploy key only): the owner's rules apply, without the dashboard token. */
export const setAutopilotCadenceAsOperator = internalMutation({ args: { siteId: v.id("sites"), cadencePerWeek: v.number() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId), s = site?.contentSchedule;
    if (!site || site.serviceMode !== "growth_first" || !s?.autopilotSelectedAt || s.ownerReviewedOnly) throw new ConvexError("Autopilot is not on for this site.");
    if (!targetCadenceOptions().some(option => option.value === args.cadencePerWeek)) throw new ConvexError("Choose one of the listed paces.");
    if (site.cadencePerWeek === args.cadencePerWeek && site.cadenceRequestedPerWeek === args.cadencePerWeek) return { changed: false };
    await ctx.db.patch(site._id, { cadencePerWeek: args.cadencePerWeek, cadenceRequestedPerWeek: args.cadencePerWeek, updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { changed: true };
  } });

/** The dashboard's live readiness view re-runs every time something it read
 * changes, and job records carry full model outputs (drafts, reviews,
 * audits). So it reads open content work exactly (by stage) plus the most
 * recent finished work, never a site's whole job history, and article
 * summaries rather than full articles. A changed setup still gets the full
 * inventory it needs for review. */
const OPEN_CONTENT_STAGES = ["prepare", "review", "review_failed", "ready", "publish", "verify"] as const;
const READINESS_RECENT_FINISHED = 20;
const READINESS_OPEN_PER_STAGE = 50;
function setupChangeNeeded(site: Doc<"sites">): boolean {
  let connection: string | undefined;
  try { connection = contentConnectionHash(site); } catch { /* An incomplete destination cannot be confirmed. */ }
  const schedule = site.contentSchedule;
  return Boolean(schedule && (schedule.profileHash !== confirmedContentProfileHash(site) || schedule.connectionHash !== connection));
}
async function readinessJobs(ctx: QueryCtx, site: Doc<"sites">): Promise<{ jobs: Doc<"jobs">[]; full: boolean }> {
  if (setupChangeNeeded(site)) {
    return { jobs: await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT + 1), full: true };
  }
  const open = (await Promise.all(OPEN_CONTENT_STAGES.map(stage => ctx.db.query("jobs")
    .withIndex("by_site_content_stage", q => q.eq("siteId", site._id).eq("contentWork.stage", stage)).take(READINESS_OPEN_PER_STAGE + 1)))).flat();
  // An implausibly large open inventory is reviewed in full, never truncated.
  if (open.length > READINESS_OPEN_PER_STAGE) {
    return { jobs: await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT + 1), full: true };
  }
  const seen = new Set(open.map(j => j._id));
  const finished = (await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", site._id).gt("contentWork.deadlineAt", 0))
    .order("desc").take(READINESS_RECENT_FINISHED + open.length)).filter(j => !seen.has(j._id)).slice(0, READINESS_RECENT_FINISHED);
  return { jobs: [...open, ...finished].sort((a, b) => b._creationTime - a._creationTime), full: false };
}
async function articleSummary(ctx: QueryCtx, articleId: Id<"articles">) {
  return ctx.db.query("article_summaries").withIndex("by_article", q => q.eq("articleId", articleId)).first();
}

export const readiness = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || identity?.subject !== site.userId) throw new Error("Not authorized");
    const { jobs, full: fullInventory } = await readinessJobs(ctx, site);
    const s = site.contentSchedule;
    let verified = false, directory: string | null = null, bindingCurrent = !s;
    try {
      directory = publicationDeliveryConfig(site).contentDir ?? null;
      verified = pasteDestination(site) || (contentConnectionComplete(site) && publisherDestinationReceiptVerified({ site }) && publicationDestinationBlockers(site).length === 0);
      bindingCurrent = !s || (s.profileHash === confirmedContentProfileHash(site) && s.connectionHash === contentConnectionHash(site));
    } catch { /* Incomplete destination is actionable readiness, not a query crash. */ }
    const reconciliation = await reviewChangedSetup(ctx, site, jobs);
    const pricing = await pricingConfiguration(ctx, site);
    // Every live article on the current domain, however it was approved.
    const publishedRows = (await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", "published"))
      .order("desc").take(20)).filter(a => articleMatchesCurrentDomain(site, a));
    const publishedTopics = new Set(publishedRows.map(a => a.topicId).filter(Boolean));
    // Results at a glance: live articles on the current domain (lightweight projection rows).
    const liveSummaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "published"))
      .take(LIMIT)).filter(row => articleMatchesCurrentDomain(site, row));
    const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    // Other platforms: articles the owner pasted count once Pentra found them on the public page.
    const pastedLive = new Map<string, { articleId: Id<"articles">; title: string; publishedAt: number; url: string }>();
    if (pasteDestination(site)) {
      for (const row of await ctx.db.query("pasted_publications").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "live")).take(LIMIT)) {
        const seen = pastedLive.get(row.articleId);
        if (seen && seen.publishedAt <= (row.checkedAt ?? row.requestedAt)) continue;
        const article = await articleSummary(ctx, row.articleId);
        if (article?.siteId === siteId) pastedLive.set(row.articleId, { articleId: row.articleId, title: article.title || article.slug || "Article",
          publishedAt: row.checkedAt ?? row.requestedAt, url: row.url });
      }
    }
    // On sites set up with Autopilot, a draft the reviewer would not pass is
    // skipped (the schedule continues); it needs no action from the owner.
    const parkedByAutopilot = (j: Doc<"jobs">) => Boolean(s?.autopilotSelectedAt && !j.contentWork?.ownerRequest && j.contentWork?.intent === "create" &&
      j.contentWork.stage === "failed" && autopilotSkippableFailure(j));
    // A parked draft whose topic the owner has since published (usually as an
    // edited version) is resolved for the owner; the miss itself stays recorded.
    const supersededJobs = new Set<string>();
    for (const j of jobs.filter(j => j.contentWork?.stage === "failed" && j.articleId && !j.contentWork.ownerRequest).slice(0, 20)) {
      const draft = await articleSummary(ctx, j.articleId!);
      if (draft && draft.siteId === siteId && draft.status !== "published" && draft.topicId && publishedTopics.has(draft.topicId)) supersededJobs.add(j._id);
    }
    // Titles for work still on its way, so the owner sees what is coming, not "New article".
    const upcomingTitles = new Map<string, string>();
    for (const j of jobs.filter(j => j.contentWork && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined &&
      !["verified", "failed"].includes(j.contentWork.stage)).slice(0, 10)) {
      const article = j.articleId ? await articleSummary(ctx, j.articleId) : null;
      const topicId = (j.payload as { topicId?: Id<"topic_clusters"> } | undefined)?.topicId;
      const topic = !article?.title && topicId ? await ctx.db.get(topicId) : null;
      const title = article?.siteId === siteId ? article.title : topic?.siteId === siteId ? topic.label : undefined;
      if (title) upcomingTitles.set(j._id, title);
    }
    const usedThisMonth = await displayedAccountUsage(ctx, site);
    return { siteId, setupPending: Boolean(site.contentSetupRequestedAt && !site.serviceMode), serviceMode: site.serviceMode ?? "legacy_articles", reviewToken: contentConsentToken(site),
      profile: { name: site.siteName ?? site.domain, summary: site.siteSummary ?? "", audience: site.targetAudienceSummary ?? "", productUsage: site.productUsage ?? "", offerings: site.keyFeatures ?? [], questions: site.painPoints ?? [] },
      destination: { kind: site.publishMethod ?? "manual", domain: site.domain, repository: site.publishMethod === "github" ? `${site.repoOwner ?? ""}/${site.repoName ?? ""}` : null,
        branch: site.repoDefaultBranch ?? null, contentDirectory: directory, verified },
      // The dashboard asks owners to connect it: improvements and results need it.
      searchConsole: { connected: gscConnectionMatchesCurrentDomain(site) },
      entitlement: await contentEntitlementAuthorized(ctx, site), enabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
      bindingCurrent,
      reconciliation: { needed: reconciliation.needed, staleItems: reconciliation.stale.length, issues: reconciliation.issues },
      schedule: s ? { ownerReviewedOnly: Boolean(s.ownerReviewedOnly), autopilotSelected: Boolean(s.autopilotSelectedAt), active: s.active, paused: s.paused, nextDeadlineAt: s.nextDeadlineAt, intervalMs: s.intervalMs, timezone: s.timezone ?? "UTC" } : null,
      funding: { ...await contentFunding(ctx, site, pricing?.budgetMicroUsd),
        pricingScope: !pricing ? "unavailable" as const : pricing.validationAuthorizationId ? "validation_run" as const : "ordinary" as const },
      plan: await accountPlan(ctx, site),
      // P212: the inputs of the order Autopilot writes topics in, for the dashboard's "Coming up next".
      topicOrder: { difficultyCeiling: siteDifficultyCeiling(site), authority: storedTenantAuthority(site) ?? null },
      autopilot: { selectable: Boolean(site.contentSetupRequestedAt), on: Boolean(s && !s.ownerReviewedOnly && site.autopilotEnabled && !site.approvalRequired),
        reviewAvailable: ["github", "wordpress"].includes(site.publishMethod ?? "") || isApiCmsMethod(site.publishMethod) || pasteDestination(site),
        autopilotAvailable: !pasteDestination(site),
        adoptable: Boolean(site.serviceMode === "growth_first" && s && !s.autopilotSelectedAt && !s.ownerReviewedOnly) },
      ownerDraft: { maximumMicroUsd: pricing?.budgetMicroUsd ?? null,
        allowance: pricing ? await ownerDraftAllowance(ctx, site, Boolean(pricing.validationAuthorizationId), usedThisMonth) : null,
        latest: jobs.filter(j => j.contentWork?.ownerRequest).sort((a, b) => b.createdAt - a.createdAt).slice(0, 1).map(j => ({
          jobId: j._id, articleId: j.articleId, stage: j.contentWork!.stage, issue: contentIssue(j.contentWork!.failure),
        }))[0] ?? null },
      results: { live: liveSummaries.length + pastedLive.size, planUsedThisMonth: usedThisMonth,
        liveThisMonth: liveSummaries.filter(row => (row.publishedAt ?? 0) >= monthStart).length + [...pastedLive.values()].filter(p => p.publishedAt >= monthStart).length },
      published: [...publishedRows.map(a => ({ articleId: a.articleId, title: a.title || a.slug || "Article", publishedAt: a.publishedAt ?? null,
          verified: a.publicUrlStatus === "verified", url: a.publicUrlStatus === "verified" && a.publicUrl?.startsWith("https://") ? a.publicUrl : null })),
        ...[...pastedLive.values()].map(p => ({ ...p, verified: true }))]
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 5),
      // The bounded view holds every open item exactly, so counts are complete.
      complete: fullInventory ? jobs.length <= LIMIT : true, ready: jobs.filter(j => j.contentWork?.stage === "ready" && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined &&
        j.contentWork.profileHash === confirmedContentProfileHash(site) && j.contentWork.connectionHash === s?.connectionHash && bindingCurrent).length,
      work: (await Promise.all(jobs.filter(j => j.contentWork && !j.contentWork.ownerRequest).map(async j => {
        const lastReview = j.contentWork!.providerCalls.at(-1);
        // This repaired failure can be rechecked through ordinary owner Resume.
        // The mutation still verifies lineage, unchanged source and no writes;
        // exposing the control grants no execution or spending authority.
        const rejectedReview = j.status === "failed" && j.contentWork!.failure === "content_audit_clarification_inconsistent" &&
          lastReview?.state === "completed" && retainedContradictoryContentAudit(await providerCallResult(ctx, j._id, lastReview));
        return { j, lastReview, rejectedReview };
      }))).map(({ j, rejectedReview }) => {
        const call = j.contentWork!.providerCalls.find(c => interruptedCreditCall(c) && c.creditRecovery);
        const creditRetry = j.status === "failed" && j.contentWork!.stage === "failed" && call && j.contentWork!.retiredAt === undefined
          ? { jobId: j._id, callKey: call.key, token: creditRetryToken(j, call) } : null;
        return { jobId: j._id, articleId: j.articleId, title: upcomingTitles.get(j._id) ?? null,
        intent: j.contentWork!.intent, operation: j.contentWork!.operation,
        stage: j.contentWork!.stage, deadlineAt: j.contentWork!.deadlineAt, windowStartAt: j.contentWork!.windowStartAt,
        systemFailure: !rejectedReview && internalContentProcessingError(j.contentWork!.failure ?? j.error),
        technicalReason: internalContentProcessingError(j.contentWork!.failure ?? j.error) ? j.contentWork!.failure ?? "legacy_semantic_audit_processing_error" : null,
        retiredAt: j.contentWork!.retiredAt,
        publishedAt: j.contentWork!.publishedAt, verifiedAt: j.contentWork!.verifiedAt, creditRetry,
        superseded: supersededJobs.has(j._id),
        parked: parkedByAutopilot(j),
        // A failed automatic slot the schedule has already moved past (its
        // replacement or the next article covered it) needs nothing from the
        // owner; it stays in Activity as history instead of "Needs attention".
        pastSlot: Boolean(s && j.status === "failed" && j.contentWork!.stage === "failed" && !creditRetry &&
          j.contentWork!.deadlineAt < s.nextDeadlineAt),
        failure: supersededJobs.has(j._id) ? "Replaced by your edited version of this article, which is now live. The missed slot stays on record."
          : parkedByAutopilot(j) ? j.contentWork!.failure === "content_model_response_invalid"
            ? "Pentra's writing service returned an incomplete response for this article, so nothing was published. Your schedule continued with the next article."
            : ["bounded_content_quality_exhausted", "candidate_rejected_before_draft"].includes(j.contentWork!.failure ?? "")
              ? "Pentra held this draft back because it didn't pass Pentra's quality review (facts, sources and editing). It won't be published; your schedule continued with the next article."
              : "Pentra's writing service could not complete this article, so nothing was published. Your schedule continued with the next article."
          : rejectedReview ? "Review handling has been repaired. Resume to recheck this retained work within its existing revision and spending limits. The article has not been approved."
          : creditRetry ? "Pentra has restored generation for this interrupted work. You can retry it once; the original deadline and earlier attempt remain recorded."
          : contentIssue(j.contentWork!.failure ?? j.error) }; }) };
  },
});

/** Pause is not cancellation: retain ready work, leases, attempts and costs.
 * Resume can only wake the same binding; changed facts require reconciliation. */
async function reconcileCompletedReviewRejection(ctx: MutationCtx, site: Doc<"sites">, job: Doc<"jobs">) {
  const cw = job.contentWork;
  if (cw?.failure !== "content_audit_clarification_inconsistent") return;
  const call = cw.providerCalls.at(-1), lineage = call?.semanticClarificationOf;
  const original = cw.providerCalls.find(c => c.key === lineage?.key);
  const article = job.articleId ? await ctx.db.get(job.articleId) : null;
  const originalResult = await providerCallResult(ctx, job._id, original), callResult = await providerCallResult(ctx, job._id, call);
  // Reclassify only a completed review, never retry its provider call. The
  // ordinary revision/replacement limits and all financial receipts survive.
  if (job.status !== "failed" || cw.stage !== "failed" || cw.operation || cw.retiredAt !== undefined ||
    job.siteId !== site._id || cw.profileHash !== confirmedContentProfileHash(site) || cw.connectionHash !== contentConnectionHash(site) ||
    job.workerToken || job.leaseExpiresAt || job.publicationAttempts || cw.approvedArtifactHash || cw.publishedAt || cw.verifiedAt ||
    !call || !lineage || !original || original.state !== "completed" || call.state !== "completed" ||
    (original.logicalKey ?? original.key) !== `${cw.replacements}:${cw.revisions}:review:audit_final_article` ||
    (call.logicalKey ?? call.key) !== `${original.logicalKey ?? original.key}${SEMANTIC_AUDIT_SUFFIX}` ||
    original.requestHash !== lineage.requestHash || auditResultHash(originalResult) !== lineage.resultHash ||
    !retainedContradictoryContentAudit(originalResult) || !retainedContradictoryContentAudit(callResult) ||
    cw.providerCalls.some(c => c.state === "started" || (c.state === "completed" && (!Number.isSafeInteger(c.actualMicroUsd) || c.actualMicroUsd! < 0))) ||
    !article || article.siteId !== site._id || article.updatedAt > job.updatedAt || article.status === "published" ||
    article.publicationAttemptedAt || article.publicationReceipt || article.publicationLeaseOwner || article.publicationOutcomeUnverifiedAt || article.publishedContentHash) {
    throw new Error("Retained review evidence changed; reconciliation requires inspection");
  }
  await ctx.db.patch(job._id, { status: "done", error: undefined, nextAttemptAt: undefined,
    result: { qualityQuarantined: true, previousFailure: cw.failure, previousUpdatedAt: job.updatedAt,
      rejectedReviewKey: call.key, rejectedReviewHash: auditResultHash(callResult) }, updatedAt: Date.now() });
  await contentWorkCompleted(ctx, job, inconsistentAuditFeedback(callResult));
  return true;
}

export const control = mutation({ args: { siteId: v.id("sites"), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("retry")), reviewToken: v.string(),
    creditRetry: v.optional(v.object({ jobId: v.id("jobs"), callKey: v.string(), token: v.string() })) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s) throw new Error("Choose growth-first service first");
    if (s.ownerReviewedOnly) throw new Error("Owner-reviewed drafts have no automatic schedule to activate");
    if (args.action === "pause") {
      await ctx.db.patch(site._id, { contentSchedule: { ...s, paused: true }, updatedAt: Date.now() });
      await wake(ctx, site._id); return;
    }
    if (args.reviewToken !== contentConsentToken(site) || s.profileHash !== confirmedContentProfileHash(site) || s.connectionHash !== contentConnectionHash(site)) throw new Error("Business or destination changed. Use Review changed setup to confirm current facts and safely replace stale unstarted work.");
    if (!await contentEntitlementAuthorized(ctx, site) || !contentConnectionComplete(site) || site.approvalRequired) throw new Error("Verify billing, publishing and automatic-publication consent before resuming");
    const jobs = await jobsForSite(ctx, site._id), reconciled = new Set<Id<"jobs">>();
    if (args.action === "resume") for (const job of jobs) {
      if (job.contentWork?.retiredAt === undefined && await reconcileCompletedReviewRejection(ctx, site, job)) reconciled.add(job._id);
    }
    const unresolved = jobs.some(j => !reconciled.has(j._id) && j.contentWork && j.contentWork.retiredAt === undefined &&
      internalContentProcessingError(j.contentWork.failure ?? j.error));
    if (unresolved) throw new Error("Pentra must repair the retained internal processing error before delivery resumes");
    if (args.action === "resume") await ctx.db.patch(site._id, { contentSchedule: { ...s, paused: false }, autopilotEnabled: true,
      autopilotRolloutMode: s.active ? "live" : "warm", updatedAt: Date.now() });
    if (args.action === "retry" && s.paused) throw new Error("Resume the paused service before retrying");
    if (args.creditRetry) {
      if (args.action !== "retry") throw new Error("Interrupted work requires its exact retry request");
      const job = await ctx.db.get(args.creditRetry.jobId), cw = job?.contentWork;
      const call = cw?.providerCalls.find(c => c.key === args.creditRetry!.callKey);
      if (!job || !cw || !call || !call.creditRecovery || args.creditRetry.token !== creditRetryToken(job, call)) throw new Error("Interrupted work confirmation changed");
      await creditRecoveryAuthority(ctx, site, job);
      await retainedCreditEvidence(ctx, job, call);
      if (call.creditRecovery.requestedAt !== undefined) return { recovered: false, reason: "already_requested" };
      if (job.status !== "failed" || cw.stage !== "failed" || cw.failure !== "content_provider_credit_unavailable" ||
        !interruptedCreditCall(call) || !["prepare", "review"].includes(call.rejectionStage ?? "") ||
        cw.providerCalls.some(c => c.state === "started" || (c !== call && interruptedCreditCall(c))) ||
        job.workerToken || job.leaseExpiresAt || (cw.recoveryAttempts ?? 0) >= MAX_CONTENT_RECOVERIES ||
        cw.providerCalls.length >= 20) throw new Error("Interrupted work cannot safely retry");
      const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
      if (used + call.ceilingMicroUsd > cw.budgetMicroUsd) throw new Error("Interrupted content budget exhausted");
      const requestedAt = Date.now();
      await ctx.db.patch(job._id, { status: "pending", nextAttemptAt: undefined, error: undefined,
        contentWork: { ...cw, stage: call.rejectionStage!, failure: undefined, recoveryAttempts: (cw.recoveryAttempts ?? 0) + 1,
          providerCalls: cw.providerCalls.map(c => c.key === call.key ? { ...c, creditRecovery: { ...c.creditRecovery!, requestedAt } } : c) }, updatedAt: requestedAt });
      await wake(ctx, site._id);
      return { recovered: true, jobId: job._id };
    }
    await wake(ctx, site._id);
  } });

/** The site's measured authority (domain rank), when Pentra holds fresh
 * evidence for its current domain; undefined otherwise. No provider call. */
export function storedTenantAuthority(site: Doc<"sites">): number | undefined {
  const authority = tenantAuthorityFromStoredEvidence({ domain: site.seoAuthorityDomain, currentDomain: site.domain,
    domainRank: site.seoAuthorityDomainRank, referringDomains: site.seoAuthorityReferringDomains,
    source: site.seoAuthoritySource, measuredAt: site.seoAuthorityMeasuredAt });
  return measuredAuthorityIsFresh(authority) ? authority.domainRank : undefined;
}

/** A search the owner added to the plan (C4, P158). */
const ownerChosen = (t: Doc<"topic_clusters">) => t.ownerChosenAt !== undefined;
const keptByBuyerFit = (t: Doc<"topic_clusters">) => t.buyerFit?.eligible === true;
/** The planned topics Autopilot may still write, best first (read-only). The
 * health check uses the same list to report how many are left. */
export async function eligiblePlannedTopics(ctx: QueryCtx | MutationCtx, site: Doc<"sites">,
  excludedIntents: { primaryKeyword: string; label?: string }[] = [],
  // P177: the caller's own read of the same topics (takeCurrentDomainTopics with LIMIT + 1), not read twice.
  preloadedTopics?: Doc<"topic_clusters">[],
  // P190: the caller's own read of the site's pages (by_site, LIMIT + 1).
  preloadedPages?: Doc<"pages">[]) {
  const topics = preloadedTopics ?? await takeCurrentDomainTopics(ctx, site, LIMIT + 1);
  if (topics.length > LIMIT) throw new Error("Topic inventory is incomplete");
  const signals = tenantTopicBusinessSignals(site);
  const pages = preloadedPages ?? await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT + 1);
  if (pages.length > LIMIT) throw new Error("Existing page inventory is incomplete");
  const pageCoverage = pages.filter(p => pageMatchesCurrentDomain(site, p) && !["", "/", "/index"].includes(p.slug))
    .flatMap(p => [...(p.keywords ?? []), ...(p.title ? [p.title] : [])].map(primaryKeyword => ({ primaryKeyword })));
  for (const status of ["ready", "published", "rejected"]) {
    const summaries = await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", site._id).eq("status", status)).take(LIMIT + 1);
    if (summaries.length > LIMIT) throw new Error("Published intent inventory is incomplete");
    for (const row of summaries.filter(row => articleMatchesCurrentDomain(site, row))) {
      // An owner-reviewed unknown write remains possible external coverage.
      // Never replay that intent as a "fresh" replacement after reconfirmation.
      if (status === "rejected" && !row.publicationAttemptedAt) continue;
      pageCoverage.push(...[...(row.metaKeywords ?? []), row.title].map(primaryKeyword => ({ primaryKeyword })));
    }
  }
  const fit = (t: { primaryKeyword: string; label: string }) => evaluateTopicBusinessFit({ keyword: t.primaryKeyword, label: t.label, ...signals }).eligible;
  const covered = topics.filter(t => !["planned", "pending"].includes(t.status ?? "planned"));
  const competitors = competitorNamesFor(site);
  // A buyer-fit verdict of "unfit" (P105) is final for Autopilot: the lexical
  // fit above admitted searches from other markets that share the business's words.
  // A search past the site's reach is never written either: the winnability
  // model scores it zero, so its page cannot rank (P113). Search Console
  // searches carry no difficulty: the site is already shown for them.
  const difficultyCeiling = siteDifficultyCeiling(site);
  const reachable = (t: Doc<"topic_clusters">) => !((t.searchVolume ?? 0) > 0 && (t.keywordDifficulty ?? 0) > difficultyCeiling);
  // A search the owner added (C4, P158) is written whatever Pentra's demand,
  // reach and fit checks say (they are notes for the owner); a listed
  // competitor and a page the site already has still exclude it.
  // A search the buyer-fit model kept for this business (P171) is not judged
  // again by word match; a changed profile has it judged again by the daily sweep.
  const planned = topics.filter(t => ["planned", "pending"].includes(t.status ?? "planned") &&
    (ownerChosen(t) || (fit(t) || keptByBuyerFit(t)) && t.buyerFit?.eligible !== false && reachable(t)) &&
    !namesCompetitor(`${t.primaryKeyword} ${t.label}`, competitors) &&
    !planCheckpointTopicExecutionLocked(t) && !terminalContentFeasibility(t.contentFeasibilityStatus) &&
    ![...covered, ...pageCoverage, ...excludedIntents].some(c => contentIntentConflicts(t, c)));
  // Keywords people measurably search for come first; within each group the
  // stored priority orders the work. Absence remains absent in storage.
  const searched = (t: Doc<"topic_clusters">) => searchedWithin(t, difficultyCeiling);
  // The order Autopilot writes in (convex/lib/topicOrder.ts), shown on the dashboard too (P212).
  planned.sort(compareTopics({ difficultyCeiling, authority: storedTenantAuthority(site) ?? null }));
  return { topics, pageCoverage, fit, competitors, planned, searched };
}
/** P211 (Oct 26 2026): the business's own pages by title (its service and product pages, posts it wrote) for the copy
 * checks, so Pentra never writes an article that competes with one. Word matching above reads their words; the
 * grouping call reads them by what a searcher wants. Pentra's own articles are listed apart, and the home page and
 * pages no one searches for are left out. */
const OWN_PAGES_FOR_COPY_CHECK = 60;
const UTILITY_PAGE_SEGMENTS = new Set(["index", "home", "about", "about-us", "contact", "contact-us", "privacy", "privacy-policy", "terms",
  "terms-of-service", "terms-of-use", "legal", "cookies", "cookie-policy", "login", "log-in", "signin", "sign-in", "signup", "sign-up",
  "register", "account", "my-account", "cart", "checkout", "search", "thank-you", "thanks", "404", "sitemap", "tag", "tags", "category",
  "categories", "author", "page"]);
export function ownPageTitles(site: Doc<"sites">, pages: Doc<"pages">[]): string[] {
  const titles = new Set<string>();
  for (const page of pages) {
    if (titles.size >= OWN_PAGES_FOR_COPY_CHECK) break;
    if (!pageMatchesCurrentDomain(site, page) || page.editable?.managedArticleId) continue;
    const first = page.slug.replace(/^\/+/, "").split("/")[0].toLowerCase();
    const title = (page.editable?.title ?? page.title ?? "").replace(/\s+/g, " ").trim();
    if (first && !UTILITY_PAGE_SEGMENTS.has(first) && title.length >= 3) titles.add(title);
  }
  return [...titles];
}
const PAIN_POINT_TOPIC_NOTES = "A customer question the owner confirmed. Search forecasts are unknown. Answer it from supported business facts with conditional guidance; never invent experience or external claims.";
const ANCHOR_TOPIC_NOTES = "Confirmed first-party reader question. Search forecasts are unknown. Use supported business facts and conditional guidance; never invent experience or external claims.";
/** When no researched keyword is left: the owner's confirmed customer
 * questions first, then guides for their confirmed features (read-only). */
export function fallbackTopicProposals(site: Doc<"sites">, inventory: Awaited<ReturnType<typeof eligiblePlannedTopics>>,
  excludedIntents: { primaryKeyword: string; label?: string }[] = []) {
  const { topics, pageCoverage, fit, competitors } = inventory;
  const proposals: { primaryKeyword: string; label: string; notes: string }[] = [];
  // A real question the owner confirmed their customers ask is a better
  // article than a guide named after a feature.
  for (const question of site.painPoints ?? []) {
    const label = question.trim().replace(/\s+/g, " ");
    if (label.length < 15 || label.length > 110 || !label.endsWith("?") || label.split(" ").length < 4) continue;
    const proposal = { primaryKeyword: label.toLowerCase().replace(/[?!.\s]+$/, ""), label };
    if (!fit(proposal) || namesCompetitor(label, competitors) ||
      [...topics, ...pageCoverage, ...excludedIntents].some(t => contentIntentConflicts(proposal, t))) continue;
    proposals.push({ ...proposal, notes: PAIN_POINT_TOPIC_NOTES });
  }
  const anchors = tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? []),
    ...(site.painPoints ?? []), site.productUsage], 40);
  for (const primaryKeyword of anchors) {
    const proposal = { primaryKeyword, label: `A practical guide to ${primaryKeyword}` };
    if (!fit(proposal) || [...topics, ...pageCoverage, ...excludedIntents].some(t => contentIntentConflicts(proposal, t))) continue;
    proposals.push({ ...proposal, notes: ANCHOR_TOPIC_NOTES });
  }
  return proposals;
}
async function chooseTopic(ctx: MutationCtx, site: Doc<"sites">, preferredId?: Id<"topic_clusters">,
  excludedIntents: { primaryKeyword: string; label?: string }[] = [],
  options: { demandOnly?: boolean; runway?: { planned: number; searched: number };
    preloaded?: { pages: Doc<"pages">[]; topics: Doc<"topic_clusters">[] } } = {}) {
  const inventory = await eligiblePlannedTopics(ctx, site, excludedIntents, options.preloaded?.topics, options.preloaded?.pages);
  const { planned, searched } = inventory;
  if (options.runway) Object.assign(options.runway, { planned: planned.length, searched: planned.filter(searched).length });
  if (preferredId) return planned.find(t => t._id === preferredId) ?? null;
  if (options.demandOnly) return planned.find(t => ownerChosen(t) || searched(t)) ?? null;
  if (planned[0]) return planned[0];
  const [proposal] = fallbackTopicProposals(site, inventory, excludedIntents);
  if (!proposal) return null;
  const id = await ctx.db.insert("topic_clusters", { siteId: site._id, primaryKeyword: proposal.primaryKeyword, label: proposal.label,
    planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
    secondaryKeywords: [], intent: "informational", priority: 1, status: "planned", notes: proposal.notes,
    createdAt: Date.now(), updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** One new owner-requested draft (not an edit of an existing one): the plan's monthly allowance, a topic, a funded
 * hold, then the priced worker. A draft the owner already has in progress is returned instead of a second one. */
async function admitFreshOwnerDraft(ctx: MutationCtx, site: Doc<"sites">, schedule: NonNullable<Doc<"sites">["contentSchedule"]>,
  jobs: Doc<"jobs">[], args: { requestKey: string; maximumMicroUsd?: number; topicId?: Id<"topic_clusters"> }) {
  const outstanding = jobs.find(j => j.contentWork?.ownerRequest && j.contentWork.retiredAt === undefined &&
    !["verified", "failed"].includes(j.contentWork.stage));
  if (outstanding) return { jobId: outstanding._id, created: false };
  const pricing = await pricingConfiguration(ctx, site);
  // The owner's screen names the price it asks for; Start in Review first asks for the current one.
  if (!pricing || (args.maximumMicroUsd !== undefined && args.maximumMicroUsd !== pricing.budgetMicroUsd)) {
    throw new ConvexError("Draft pricing changed; refresh before requesting work");
  }
  // Fresh drafts count against the plan's monthly article allowance across the account's sites. The owner validation
  // grant keeps its separate cumulative allowance.
  const allowance = await ownerDraftAllowance(ctx, site, Boolean(pricing.validationAuthorizationId));
  if (allowance && allowance.used >= allowance.limit) {
    throw new ConvexError(allowance.tier === "free"
      ? `Your ${allowance.limit} free articles for this month are used. Choose a plan in Billing to keep publishing, or wait until the 1st.`
      : `You've used all ${allowance.limit} articles in your plan this month. Upgrade in Billing or wait until the 1st.`);
  }
  const topic = await chooseTopic(ctx, site, args.topicId);
  if (!topic) throw new ConvexError("No distinct supported topic is available. Review your business offerings or select another planned topic.");
  const requestedAt = Date.now(), { budgetMicroUsd, ...price } = pricing;
  const request = { siteId: site._id, userId: site.userId!, purpose: "content_work" as const,
    trigger: `content_slot:${requestedAt}`, reservedMicroUsd: budgetMicroUsd, timestamp: requestedAt };
  let funding = await inspectSharedProviderBudget(ctx, request);
  if (!funding.ok && await closeFinishedContentHolds(ctx, site) > 0) funding = await inspectSharedProviderBudget(ctx, request);
  if (!funding.ok) throw new ConvexError(contentIssue(funding.reason) ?? "Draft funding is unavailable");
  const jobId = await ctx.db.insert("jobs", { siteId: site._id, canonicalDomain: siteCanonicalDomain(site)!,
    domainRevision: siteCanonicalDomainRevision(site), rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
    payload: { manual: true, topicId: topic._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
    contentWork: { ownerRequest: { userId: site.userId!, key: args.requestKey, requestedAt },
      validationAuthorizationId: schedule.validationAuthorizationId, intent: "create", stage: "prepare",
      deadlineAt: requestedAt, windowStartAt: requestedAt, profileHash: schedule.profileHash, connectionHash: schedule.connectionHash,
      revisions: 0, replacements: 0, discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] },
    createdAt: requestedAt, updatedAt: requestedAt });
  const reserved = await reserveSharedProviderBudget(ctx, { ...request, contentWorkJobId: jobId });
  if (!reserved.ok) throw new ConvexError("Draft reservation changed; no work was admitted");
  await ctx.db.patch(jobId, { providerSpendReservationId: reserved.reservationId });
  await ctx.db.patch(topic._id, { status: "queued", updatedAt: requestedAt });
  await refreshAccountUsage(ctx, site, 1);
  await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, { siteId: site._id, jobId });
  return { jobId, created: true };
}

/** Whether a site can take an owner-requested draft now: content service on, a destination Pentra publishes to (or
 * the owner pastes), verified unless pasted, and a plan that allows it. */
async function ownerDraftsOpen(ctx: MutationCtx, site: Doc<"sites">) {
  const schedule = site.contentSchedule;
  return Boolean(site.serviceMode === "growth_first" && schedule &&
    (["github", "wordpress"].includes(site.publishMethod ?? "") || isApiCmsMethod(site.publishMethod) || pasteDestination(site)) &&
    contentConnectionComplete(site) && (pasteDestination(site) || publisherDestinationReceiptVerified({ site })) &&
    await contentEntitlementAuthorized(ctx, site));
}

/** P229 (Oct 27 2026): none of the 3 accounts that signed up since Oct 24 reached an article. Start in Review first
 * wrote nothing until the owner also asked for an article, so an owner who started saw an empty dashboard. Start now
 * writes the first article at once (the draft-ready email follows when it is ready). Only ever the site's first owner
 * draft: an owner who already asked for one gets nothing extra. Runs after Start, so Start never fails on it. */
export const startFirstDraft = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId), schedule = site?.contentSchedule;
  if (!site?.userId || !schedule?.ownerReviewedOnly || !site.contentSetupRequestedAt || site.deletionStatus ||
    site.accountDeletionRequestedAt || site.planParkedAt || !await ownerDraftsOpen(ctx, site) ||
    schedule.profileHash !== confirmedContentProfileHash(site) || schedule.connectionHash !== contentConnectionHash(site)) return { started: false };
  const jobs = await jobsForSite(ctx, site._id);
  if (jobs.some(j => j.contentWork?.ownerRequest)) return { started: false };
  const { jobId } = await admitFreshOwnerDraft(ctx, site, schedule, jobs, { requestKey: `first-draft-${site._id}` });
  return { started: true, jobId };
} });

/** An explicit owner order uses the same priced worker, not the automatic
 * schedule's failed slot. Its approval is for drafting only, never publishing. */
export const requestDraft = mutation({
  args: { siteId: v.id("sites"), reviewToken: v.string(), requestKey: v.string(),
    maximumMicroUsd: v.number(), topicId: v.optional(v.id("topic_clusters")),
    edit: v.optional(v.object({ articleId: v.id("articles"), artifactHash: v.string(), markdown: v.string(),
      metadata: v.optional(v.object({ title: v.string(), metaTitle: v.string(), metaDescription: v.string() })) })) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), schedule = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !schedule || !(["github", "wordpress"].includes(site.publishMethod ?? "") || isApiCmsMethod(site.publishMethod) || pasteDestination(site)) ||
      !contentConnectionComplete(site) || (!pasteDestination(site) && !publisherDestinationReceiptVerified({ site })) ||
      !await contentEntitlementAuthorized(ctx, site)) throw new ConvexError("Confirm your business, website connection and billing in Settings first");
    if (args.reviewToken !== contentConsentToken(site) || schedule.profileHash !== confirmedContentProfileHash(site) ||
      schedule.connectionHash !== contentConnectionHash(site)) throw new ConvexError("Business or destination changed; review Settings first");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestKey)) throw new ConvexError("Invalid draft request reference");
    const jobs = await jobsForSite(ctx, site._id);
    const same = jobs.find(j => j.contentWork?.ownerRequest?.userId === site.userId && j.contentWork?.ownerRequest?.key === args.requestKey);
    if (same) return { jobId: same._id, created: false };
    // P229: a fresh draft is admitted exactly as the first draft that Start in Review first writes.
    if (!args.edit) return await admitFreshOwnerDraft(ctx, site, schedule, jobs, args);
    const source = args.edit ? await ctx.db.get(args.edit.articleId) : null;
    const sourceJobs = source ? jobs.filter(j => j.articleId === source._id && j.contentWork?.ownerRequest &&
      j.contentWork.retiredAt === undefined) : [];
    const sourceJob = sourceJobs[0];
    const rawMetadata = args.edit?.metadata;
    const metadata = rawMetadata && { title: rawMetadata.title.trim(), metaTitle: rawMetadata.metaTitle.trim(),
      metaDescription: rawMetadata.metaDescription.trim() };
    if (metadata && (!metadata.title || metadata.title.length > 200 || !metadata.metaTitle ||
      metadata.metaTitle.length > 60 || metadata.metaDescription.length < 100 || metadata.metaDescription.length > 155 ||
      /[\r\n]/.test(metadata.title + metadata.metaTitle + metadata.metaDescription))) {
      throw new ConvexError("Provide a title, a search title up to 60 characters and a search description of 100–155 characters.");
    }
    if (args.edit && (!source || source.siteId !== site._id || !articleMatchesCurrentDomain(site, source) ||
      !source.topicId || sourceJobs.length !== 1 || !sourceJob || !["done", "failed"].includes(sourceJob.status) ||
      sourceJob.contentWork?.ownerRequest?.userId !== site.userId ||
      !["ready", "failed"].includes(sourceJob.contentWork!.stage) || (sourceJob.leaseExpiresAt ?? 0) > Date.now() ||
      sourceJob.contentWork!.profileHash !== schedule.profileHash || sourceJob.contentWork!.connectionHash !== schedule.connectionHash ||
      source.status === "published" || source.publicationAttemptedAt || source.publicationReceipt || source.publicationLeaseOwner ||
      publicationArtifactHash(source) !== args.edit.artifactHash || args.topicId ||
      !args.edit.markdown.trim() || args.edit.markdown.length > 100_000 || (args.edit.markdown === source.markdown &&
        (!metadata || (metadata.title === source.title && metadata.metaTitle === source.metaTitle && metadata.metaDescription === source.metaDescription))))) {
      throw new ConvexError("This draft changed, is still processing, or cannot be edited safely. Refresh before saving.");
    }
    const outstanding = jobs.find(j => j.contentWork?.ownerRequest && j.contentWork.retiredAt === undefined &&
      j._id !== (args.edit ? sourceJob?._id : undefined) && !["verified", "failed"].includes(j.contentWork.stage));
    if (args.edit && outstanding) throw new ConvexError("Finish the other draft request before submitting edits");
    if (outstanding) return { jobId: outstanding._id, created: false };
    const pricing = await pricingConfiguration(ctx, site);
    if (!pricing || args.maximumMicroUsd !== pricing.budgetMicroUsd) throw new ConvexError("Draft pricing changed; refresh before requesting work");
    // Ordinary (public) drafting is a paid-plan feature; free accounts can set up
    // but cannot spend provider money. The owner validation grant is unaffected.
    // Fresh drafts count against the plan's monthly article allowance across
    // the account's sites. Owner edits of an existing draft are not new drafts.
    // The owner validation grant keeps its separate cumulative allowance.
    const allowance = args.edit ? null : await ownerDraftAllowance(ctx, site, Boolean(pricing.validationAuthorizationId));
    if (allowance && allowance.used >= allowance.limit) {
      throw new ConvexError(allowance.tier === "free"
        ? `Your ${allowance.limit} free articles for this month are used. Choose a plan in Billing to keep publishing, or wait until the 1st.`
        : `You've used all ${allowance.limit} articles in your plan this month. Upgrade in Billing or wait until the 1st.`);
    }
    const topic = source?.topicId ? await ctx.db.get(source.topicId) : await chooseTopic(ctx, site, args.topicId);
    if (source && (!topic || topic.siteId !== site._id)) throw new ConvexError("The original draft topic is unavailable");
    if (!topic) throw new ConvexError("No distinct supported topic is available. Review your business offerings or select another planned topic.");
    const requestedAt = Date.now(), { budgetMicroUsd, ...price } = pricing;
    const request = { siteId: site._id, userId: site.userId!, purpose: "content_work" as const,
      trigger: `content_slot:${requestedAt}`, reservedMicroUsd: budgetMicroUsd, timestamp: requestedAt };
    let funding = await inspectSharedProviderBudget(ctx, request);
    if (!funding.ok && await closeFinishedContentHolds(ctx, site) > 0) funding = await inspectSharedProviderBudget(ctx, request);
    if (!funding.ok) throw new ConvexError(contentIssue(funding.reason) ?? "Draft funding is unavailable");
    const editedId = source && args.edit ? await createOwnerEditedCheckpoint(ctx, source, args.edit.markdown, metadata) : undefined;
    const jobId = await ctx.db.insert("jobs", { siteId: site._id, canonicalDomain: siteCanonicalDomain(site)!,
      domainRevision: siteCanonicalDomainRevision(site), rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
      ...(editedId ? { articleId: editedId } : {}),
      payload: { manual: true, topicId: topic._id, ...(editedId ? { articleId: editedId } : {}), bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { ownerRequest: { userId: site.userId!, key: args.requestKey, requestedAt,
        ...(source && args.edit ? { sourceArticleId: source._id, sourceArtifactHash: args.edit.artifactHash } : {}) },
        validationAuthorizationId: schedule.validationAuthorizationId, intent: "create", stage: editedId ? "review" : "prepare",
        deadlineAt: requestedAt, windowStartAt: requestedAt, profileHash: schedule.profileHash, connectionHash: schedule.connectionHash,
        revisions: 0, replacements: 0, discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] },
      createdAt: requestedAt, updatedAt: requestedAt });
    const reserved = await reserveSharedProviderBudget(ctx, { ...request, contentWorkJobId: jobId });
    if (!reserved.ok) throw new ConvexError("Draft reservation changed; no work was admitted");
    await ctx.db.patch(jobId, { providerSpendReservationId: reserved.reservationId });
    if (args.edit && sourceJob) {
      const retired = { ...sourceJob, status: "failed", contentWork: { ...sourceJob.contentWork!, stage: "failed" as const,
        failure: "owner_edited_draft", retiredAt: requestedAt, approvedArtifactHash: undefined } };
      await ctx.db.patch(sourceJob._id, { status: retired.status, contentWork: retired.contentWork, updatedAt: requestedAt });
      await archiveRetiredContentArtifact(ctx, retired);
    }
    await ctx.db.patch(topic._id, { status: "queued", updatedAt: requestedAt });
    // A new owner draft is one more article; an edit of an existing draft is not.
    await refreshAccountUsage(ctx, site, editedId ? 0 : 1);
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, { siteId: site._id, jobId });
    return { jobId, created: true };
  },
});

async function reviseFailedWork(ctx: MutationCtx, site: Doc<"sites">, failed: Doc<"jobs">): Promise<CadenceScheduleResult> {
  const cw = failed.contentWork!;
  if (cw.revisions < 2) {
    await ctx.db.patch(failed._id, { status: "pending", workerAttempts: (failed.workerAttempts ?? 0) + 1,
      payload: { ...failed.payload, qualityRetry: true, articleId: failed.articleId, bufferFill: true },
      contentWork: { ...cw, stage: "review", revisions: cw.revisions + 1 }, updatedAt: Date.now() });
    return { scheduled: 1, mode: "quality_revision", activeJobId: failed._id };
  }
  // Review settlement may return the original topic to "planned". Its mutable
  // status must not let a supposedly distinct replacement buy the same intent.
  const discardedIntents: { primaryKeyword: string; label?: string }[] = [];
  for (const articleId of [...cw.discardedArticleIds, ...(failed.articleId ? [failed.articleId] : [])]) {
    const article = await ctx.db.get(articleId);
    if (!article || article.siteId !== site._id) throw new Error("Replacement article binding changed");
    discardedIntents.push({ primaryKeyword: article.title });
    const topic = article.topicId ? await ctx.db.get(article.topicId) : null;
    if (topic && topic.siteId === site._id) discardedIntents.push({ primaryKeyword: topic.primaryKeyword, label: topic.label });
  }
  // An owner asked for this draft: hand back the best version with the
  // reviewer's notes instead of silently spending on a different topic.
  const replacement = cw.replacements === 0 && !cw.ownerRequest
    ? await chooseTopic(ctx, site, undefined, discardedIntents) : null;
  if (replacement && failed.articleId) {
    // P181 (Oct 25 2026): the replacement is a new draft and gets the one
    // bounded rewrite a first review sends a draft through (the Autopilot edit
    // pass). It inherited the first draft's spent revisions, so a replacement
    // whose first review had a checkable finding failed without its rewrite.
    await ctx.db.patch(failed._id, { status: "pending", articleId: undefined, reservationId: undefined,
      workerAttempts: (failed.workerAttempts ?? 0) + 1,
      payload: { ...(cw.ownerRequest ? { manual: true } : {}), topicId: replacement._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { ...cw, intent: "create", targetPageId: undefined, baseRevision: undefined, permissionVersion: undefined,
        opportunity: undefined, revisionId: undefined, editTarget: undefined, stage: "prepare", replacements: 1, revisions: Math.min(cw.revisions, 1),
        discardedArticleIds: [...cw.discardedArticleIds, failed.articleId] }, updatedAt: Date.now() });
    // A page improvement that becomes a new article now counts toward the month.
    if (cw.intent !== "create") await refreshAccountUsage(ctx, site, 1);
    await ctx.db.patch(replacement._id, { status: "queued", updatedAt: Date.now() });
    return { scheduled: 1, mode: "buffer_fill", activeJobId: failed._id };
  }
  await ctx.db.patch(failed._id, { status: "failed", contentWork: { ...cw, stage: "failed", failure: "bounded_content_quality_exhausted",
    checksVersion: CONTENT_CHECKS_VERSION }, updatedAt: Date.now() });
  await settleFailedContentWork(ctx, failed._id);
  // The owner's draft is handed back with the checks' notes: they hear it's waiting.
  if (cw.ownerRequest && failed.articleId) await noteDraftReady(ctx, (await ctx.db.get(failed._id))!, Date.now());
  if (!cw.ownerRequest && cw.intent === "create") {
    await retireQualityExhaustedTopics(ctx, site, [...cw.discardedArticleIds, ...(failed.articleId ? [failed.articleId] : [])]);
  }
  return { scheduled: 0, mode: "content_quality_exhausted" };
}

/** A topic whose Autopilot drafts failed review on every pass (first draft and
 * both revisions) is not picked again automatically. Review settlement used to
 * hand it back as "planned", so the next slot bought the same failing topic:
 * LeadPilot's "saas lead scoring framework" was drafted and rejected five
 * times between Oct 14 15:03Z and Oct 15 11:17Z. The topic stays on record
 * with the reviewer's last issues; an owner can still request it. */
async function retireQualityExhaustedTopics(ctx: MutationCtx, site: Doc<"sites">, articleIds: Id<"articles">[]) {
  const now = Date.now();
  for (const articleId of articleIds) {
    const article = await ctx.db.get(articleId);
    if (!article || article.siteId !== site._id || !article.topicId) continue;
    const topic = await ctx.db.get(article.topicId);
    if (!topic || topic.siteId !== site._id || terminalContentFeasibility(topic.contentFeasibilityStatus) ||
      !["planned", "pending", "queued"].includes(topic.status ?? "planned")) continue;
    await ctx.db.patch(topic._id, { status: "disqualified", contentFeasibilityStatus: "quality_exhausted",
      contentFeasibilityVersion: CONTENT_FEASIBILITY_VERSION, contentFeasibilityIssues: (article.publicationGateIssues ?? []).slice(0, 8),
      contentFeasibilityCheckedAt: now,
      disqualifiedReason: "Autopilot drafts of this topic failed review on every pass; it is not retried automatically.", updatedAt: now });
  }
}

export const advanceOwnerDraft = internalMutation({ args: { jobId: v.id("jobs") }, handler: async (ctx, { jobId }) => {
  const job = await ctx.db.get(jobId), site = job?.siteId ? await ctx.db.get(job.siteId) : null;
  if (!job?.contentWork?.ownerRequest || !site || !jobAuthorizedForExecution(site, job) || job.status !== "done" ||
    job.contentWork.stage !== "review_failed") return;
  const result = await reviseFailedWork(ctx, site, job);
  if (result.scheduled) await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, { siteId: site._id, jobId });
} });

export { normalizeResearchKeyword } from "./lib/researchSeeds";

/** Seeds and locale for Autopilot keyword research (no secrets), plus the
 * keywords the site already has so research looks past them. */
export const growthTopicContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return null;
  const topics = await takeCurrentDomainTopics(ctx, site, LIMIT + 1);
  const signals = tenantTopicBusinessSignals(site);
  const onBusiness = (keyword: string) => evaluateTopicBusinessFit({ keyword, label: keyword.replace(/^./, c => c.toUpperCase()), ...signals }).eligible;
  const searches = await searchConsoleSearches(ctx, site);
  // Seeds that are real searches: keywords this site wrote that people search
  // for, then the Search Console searches it is shown for (on its business).
  const written = topics.filter(t => ["used", "queued"].includes(t.status ?? "") && (t.searchVolume ?? 0) > 0 &&
    (t.keywordDifficulty ?? 0) <= WINNABLE_KEYWORD_DIFFICULTY)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0)).map(t => t.primaryKeyword);
  const shown = searches.filter(q => q.impressions >= 5 && !isBrandedSearchQuery(q.keyword, site.domain))
    .sort((a, b) => b.impressions - a.impressions).map(q => q.keyword);
  const demand = [...written, ...shown].filter(k => searchSeedLength(k) && onBusiness(k)).slice(0, 160);
  const seeds = researchSeedsForRound({ demand,
    owner: tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? [])], 40).filter(k => searchLikePhrase(k)),
    profile: tenantDiscoveryAnchors([...(site.painPoints ?? []), site.productUsage, site.niche, site.blogTheme], 40).filter(k => searchLikePhrase(k)),
    round: site.contentSchedule.topicsResearchRound ?? 1 });
  const known = [...new Set(topics.slice(0, LIMIT).map(t => normalizeResearchKeyword(t.primaryKeyword)))];
  // Everything a new article must not repeat: topics plus published articles and pages.
  let coverage = known;
  // P211: the site's pages are read once, for word matching and for the grouping call's list of its own pages.
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(LIMIT + 1);
  try {
    // The topics read above are passed on (P177): LeadPilot's 392 topic rows are 741 KB a read.
    const inventory = await eligiblePlannedTopics(ctx, site, [], topics, pages);
    coverage = [...new Set([...known, ...inventory.pageCoverage.map(c => normalizeResearchKeyword(c.primaryKeyword ?? ""))].filter(Boolean))];
  } catch { /* an incomplete inventory keeps the topic list only */ }
  // P179: what research must not repeat, as the grouping call reads it: articles
  // waiting or live (newest first), then the topics planned or being written.
  const existing: string[] = [];
  for (const [status, take] of [["ready", 10], ["published", 120]] as const) {
    const rows = await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", status))
      .order("desc").take(take);
    // P225: an article consolidated away answers nothing itself; the article it redirects to is listed.
    existing.push(...rows.filter(row => articleMatchesCurrentDomain(site, row) && servedOnItsOwnUrl(site.domain, row.slug)).map(row => row.title));
  }
  existing.push(...topics.filter(t => ["planned", "pending", "queued"].includes(t.status ?? "planned")).map(t => t.primaryKeyword));
  // P172: searches the buyer-fit model already dropped for this profile are not judged again.
  const profileHash = confirmedContentProfileHash(site);
  const dropped = [...new Set((await ctx.db.query("topic_research_drops").withIndex("by_site_dropped", q => q.eq("siteId", siteId)).order("desc")
    .take(TOPIC_RESEARCH_DROPS_READ)).filter(d => d.profileHash === profileHash).map(d => d.keyword))];
  return { domain: site.domain, language: site.language ?? "en", targetCountry: site.targetCountry ?? null, seeds, known, coverage, dropped,
    existing: existing.slice(0, 150), ownPages: ownPageTitles(site, pages.slice(0, LIMIT)),
    signals, searchConsole: searchConsoleTopicCandidatesFrom(site, searches),
    tenantAuthority: storedTenantAuthority(site) ?? null,
    canonicalDomain: siteCanonicalDomain(site) ?? site.domain, domainRevision: siteCanonicalDomainRevision(site),
    business: buyerFitBusiness(site), maximumDifficulty: siteDifficultyCeiling(site) };
} });

/** Operator read (P172): the newest searches keyword research's buyer-fit call dropped for a site, and why. */
export const researchDropsInternal = internalQuery({ args: { siteId: v.id("sites"), limit: v.optional(v.number()) }, handler: async (ctx, { siteId, limit }) =>
  (await ctx.db.query("topic_research_drops").withIndex("by_site_dropped", q => q.eq("siteId", siteId)).order("desc")
    .take(Math.max(1, Math.min(200, Math.floor(limit ?? 50))))).map(d => ({ keyword: d.keyword, reason: d.reason, droppedAt: d.droppedAt })) });

/** P105: the business as the buyer-fit check sees it (the owner's confirmed profile). */
function buyerFitBusiness(site: Doc<"sites">): BuyerFitBusiness {
  return { name: site.siteName ?? siteCanonicalDomain(site) ?? site.domain, domain: siteCanonicalDomain(site) ?? site.domain,
    summary: site.siteSummary ?? site.niche, audience: site.targetAudienceSummary, features: site.keyFeatures,
    problems: site.painPoints, usage: site.productUsage };
}
/** The planned topics Autopilot could write that have no buyer-fit verdict
 * for the current profile, in the order it would write them. */
export const buyerFitSweepContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return null;
  let planned: Doc<"topic_clusters">[];
  try { planned = (await eligiblePlannedTopics(ctx, site)).planned; } catch { return null; }
  const profileHash = confirmedContentProfileHash(site);
  const topics = planned.filter(t => !t.buyerFit || t.buyerFit.version < BUYER_FIT_VERSION || t.buyerFit.profileHash !== profileHash)
    .slice(0, BUYER_FIT_MAX_KEYWORDS).map(t => ({ topicId: t._id, keyword: t.primaryKeyword }));
  return { business: buyerFitBusiness(site), topics };
} });
/** The sweep's spend is held before its one call, like keyword research. */
export const reserveBuyerFitSweep = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.userId || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return null;
  const reserved = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId, purpose: "topic_plan",
    trigger: `buyer_fit:${Math.floor(Date.now() / 86_400_000)}`, reservedMicroUsd: BUYER_FIT_RESERVATION_MICRO_USD, timestamp: Date.now() });
  return reserved.ok ? reserved.reservationId : null;
} });
/** Settle the sweep's call at its cost and store each verdict on its topic. */
export const recordBuyerFit = internalMutation({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations"),
  actualMicroUsd: v.number(), verdicts: v.array(v.object({ topicId: v.id("topic_clusters"), eligible: v.boolean(), reason: v.string() })) },
  handler: async (ctx, { siteId, reservationId, actualMicroUsd, verdicts }) => {
    const reservation = await ctx.db.get(reservationId);
    const actual = Math.max(0, Math.ceil(actualMicroUsd));
    if (reservation && reservation.siteId === siteId && reservation.purpose === "topic_plan" && reservation.settledAt === undefined &&
      reservation.releasedAt === undefined && Number.isSafeInteger(actual) && actual <= reservation.reservedMicroUsd) {
      await settleSharedProviderReservation(ctx, { reservationId, siteId, purpose: "topic_plan",
        actualMicroUsd: actual, reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
    }
    const site = await ctx.db.get(siteId);
    if (!site) return { recorded: 0 };
    const profileHash = confirmedContentProfileHash(site), checkedAt = Date.now();
    let recorded = 0;
    for (const verdict of verdicts) {
      const topic = await ctx.db.get(verdict.topicId);
      if (!topic || topic.siteId !== siteId || !["planned", "pending"].includes(topic.status ?? "planned")) continue;
      await ctx.db.patch(topic._id, { buyerFit: { eligible: verdict.eligible, reason: verdict.reason.slice(0, 160),
        version: BUYER_FIT_VERSION, checkedAt, profileHash }, updatedAt: checkedAt });
      recorded++;
    }
    return { recorded };
  } });

/** C4 (P158, Oct 22 2026): the owner adds a search they want a page for
 * (convex/lib/ownerSearch.ts). It goes to the front of the plan, so Autopilot
 * writes it next, and its demand, difficulty and buyer fit are measured as
 * notes. A listed competitor (articles never name one) and a search that one
 * of the site's pages or ready articles already answers are refused. */
export const addOwnerSearch = mutation({ args: { siteId: v.id("sites"), search: v.string() },
  handler: async (ctx, { siteId, search }) => {
    const site = await requireOwner(ctx, siteId);
    if (site.serviceMode !== "growth_first" || !site.contentSchedule || !siteCanonicalDomain(site)) {
      throw new ConvexError("Set up Pentra's content service in Settings first.");
    }
    const keyword = ownerSearchKeyword(search);
    if (!keyword) throw new ConvexError("Enter the search as people type it into Google: two to eight words, no links.");
    if (namesCompetitor(keyword, competitorNamesFor(site))) {
      throw new ConvexError("That search names a company on your competitor list, which Pentra's articles never mention. Remove it from the list in Settings first if you want this page.");
    }
    const { topics, pageCoverage } = await eligiblePlannedTopics(ctx, site);
    const proposal = { primaryKeyword: keyword, label: keyword.replace(/^./, c => c.toUpperCase()) };
    const page = pageCoverage.find(c => c.primaryKeyword && contentIntentConflicts(proposal, c));
    if (page) throw new ConvexError(`Your site already has a page for “${page.primaryKeyword}”, published or ready to publish, and a second page would compete with it.`);
    const same = topics.find(t => t.primaryKeyword === keyword) ?? topics.find(t => contentIntentConflicts(proposal, t));
    if (same?.status === "used") throw new ConvexError("Pentra has already written an article for this search.");
    if (same && (same.status === "queued" || planCheckpointTopicExecutionLocked(same))) throw new ConvexError("Pentra is already working on this search.");
    const alreadyOwners = Boolean(same && ownerChosen(same));
    if (!alreadyOwners && topics.filter(t => ownerChosen(t) && ["planned", "pending"].includes(t.status ?? "planned")).length >= OWNER_SEARCH_MAX_WAITING) {
      throw new ConvexError(`You have ${OWNER_SEARCH_MAX_WAITING} searches waiting. Pentra writes them first; add more once some are written.`);
    }
    const now = Date.now(), shape = ownerSearchArticleType(keyword);
    let topicId: Id<"topic_clusters">;
    if (same) {
      // A topic already in the plan for this search becomes the owner's.
      topicId = same._id;
      await ctx.db.patch(same._id, { status: "planned", ownerChosenAt: same.ownerChosenAt ?? now, priority: OWNER_SEARCH_PRIORITY,
        ...(!same.articleType && shape.articleType ? { articleType: shape.articleType } : {}), updatedAt: now });
    } else {
      topicId = await ctx.db.insert("topic_clusters", { siteId, ...proposal, planningCanonicalDomain: siteCanonicalDomain(site)!,
        planningDomainRevision: siteCanonicalDomainRevision(site), secondaryKeywords: [], intent: shape.intent,
        ...(shape.articleType ? { articleType: shape.articleType } : {}), priority: OWNER_SEARCH_PRIORITY, status: "planned",
        notes: OWNER_SEARCH_NOTES, ownerChosenAt: now, createdAt: now, updatedAt: now });
    }
    // Measured once, when the search becomes the owner's (a measured topic keeps its numbers).
    if (site.userId && !alreadyOwners && same?.searchDemandMeasuredAt === undefined) {
      const reserved = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId, purpose: "topic_plan",
        trigger: `owner_search:${topicId}`, reservedMicroUsd: OWNER_SEARCH_MEASURE_MICRO_USD, timestamp: now });
      // A refused reservation spends nothing: the search is still written, unmeasured.
      if (reserved.ok) await ctx.scheduler.runAfter(0, internal.actions.growthTopics.measureOwnerSearch,
        { siteId, topicId, reservationId: reserved.reservationId });
    }
    return { topicId, existing: Boolean(same), keyword: same?.primaryKeyword ?? keyword,
      articleType: same?.articleType ?? shape.articleType ?? "standard" };
  } });
/** What measuring an owner's search needs: the search, the market and the business. */
export const ownerSearchContext = internalQuery({ args: { siteId: v.id("sites"), topicId: v.id("topic_clusters") },
  handler: async (ctx, { siteId, topicId }) => {
    const [site, topic] = await Promise.all([ctx.db.get(siteId), ctx.db.get(topicId)]);
    if (!site || site.serviceMode !== "growth_first" || !topic || topic.siteId !== siteId || !ownerChosen(topic) ||
      !["planned", "pending"].includes(topic.status ?? "planned")) return null;
    return { keyword: topic.primaryKeyword, language: site.language ?? "en", targetCountry: site.targetCountry ?? null,
      business: buyerFitBusiness(site) };
  } });
/** Store an owner search's measurement as notes and close its reservation at
 * the reported cost (an uncertain DataForSEO total keeps the hold). */
export const recordOwnerSearchMeasurement = internalMutation({ args: { siteId: v.id("sites"), topicId: v.id("topic_clusters"),
  reservationId: v.id("provider_spend_reservations"), sent: v.boolean(), settle: v.boolean(), actualMicroUsd: v.number(),
  measured: v.boolean(), searchVolume: v.optional(v.number()), keywordDifficulty: v.optional(v.number()),
  fit: v.optional(v.object({ keep: v.boolean(), reason: v.string() })) },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (reservation && reservation.siteId === args.siteId && reservation.purpose === "topic_plan" && reservation.trigger === `owner_search:${args.topicId}` &&
      reservation.settledAt === undefined && reservation.releasedAt === undefined) {
      const actual = Math.max(0, Math.ceil(args.actualMicroUsd));
      if (!args.sent) await releaseSharedProviderReservation(ctx, { reservationId: args.reservationId, siteId: args.siteId, purpose: "topic_plan",
        reason: "plan_cancelled_before_execution", timestamp: Date.now() });
      else if (args.settle && Number.isSafeInteger(actual) && actual <= reservation.reservedMicroUsd) {
        await settleSharedProviderReservation(ctx, { reservationId: args.reservationId, siteId: args.siteId, purpose: "topic_plan",
          actualMicroUsd: actual, reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
      }
    }
    const [site, topic] = await Promise.all([ctx.db.get(args.siteId), ctx.db.get(args.topicId)]);
    if (!site || !topic || topic.siteId !== args.siteId || !ownerChosen(topic)) return { recorded: false };
    const now = Date.now();
    await ctx.db.patch(topic._id, {
      ...(args.measured ? { searchVolume: Math.max(0, Math.round(args.searchVolume ?? 0)), searchDemandSource: "dataforseo:owner_search",
        searchDemandMeasuredAt: now } : {}),
      ...(args.keywordDifficulty !== undefined ? { keywordDifficulty: Math.max(0, Math.min(100, Math.round(args.keywordDifficulty))),
        keywordDifficultyMeasured: true } : {}),
      ...(args.fit ? { buyerFit: { eligible: args.fit.keep, reason: args.fit.reason.slice(0, 160), version: BUYER_FIT_VERSION,
        checkedAt: now, profileHash: confirmedContentProfileHash(site) } } : {}),
      updatedAt: now });
    return { recorded: true };
  } });
/** A topic stays "queued" only while work holds it. Code before the lifecycle
 * settlement left researched keywords queued after their job ended, so they
 * were never written or judged again: LeadPilot held six from Sep 25-Oct 6,
 * among them "online chat widget" (480 searches a month). The daily buyer-fit
 * sweep first hands each stale lock to the lifecycle rule (planned, used or
 * disqualified on its own evidence), then judges what came back. Per-attempt
 * improvement rows (no measured demand) and topics a live content job holds
 * stay as they are. */
const STALE_TOPIC_LOCK_MS = 86_400_000;
const LIVE_CONTENT_STAGES = ["prepare", "review", "review_failed", "ready", "publish", "verify"] as const;
export const releaseStaleTopicLocks = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || site.deletionStatus || site.accountDeletionRequestedAt) return { released: 0 };
  const cutoff = Date.now() - STALE_TOPIC_LOCK_MS;
  const stale = (await ctx.db.query("topic_clusters").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "queued")).take(100))
    .filter(t => (t.searchVolume ?? 0) > 0 && t.updatedAt < cutoff).slice(0, 20);
  if (stale.length === 0) return { released: 0 };
  const held = new Set<string>();
  for (const stage of LIVE_CONTENT_STAGES) {
    const jobs = await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", stage)).take(50);
    for (const job of jobs) {
      const topicId = (job.payload as { topicId?: unknown } | undefined)?.topicId;
      if (job.contentWork?.retiredAt === undefined && typeof topicId === "string") held.add(topicId);
    }
  }
  let released = 0;
  for (const topic of stale) {
    if (held.has(topic._id)) continue;
    if ((await reconcileTopicLifecycle(ctx, { siteId, topicId: topic._id, apply: true })).changed) released++;
  }
  return { released };
} });
/** A waiting article that repeats a page the site already has is never
 * published: two pages on one search compete with each other. pentra.dev's
 * ready /how-often-small-business-publish-blog-capacity-method repeated its
 * live /how-often-should-small-business-publish-blog-posts (Oct 21 2026; the
 * duplicate check missed "should" and "posts"). The daily sweep holds such an
 * article back for the owner (review, with the reason), marks its slot failed
 * with "duplicate_intent" (a skippable failure, so the slot gets a new topic
 * the way a draft that failed review does; the replacement is counted once)
 * and its topic as covered, and wakes the scheduler. */
export const retireDuplicateReadyWork = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule || site.deletionStatus || site.accountDeletionRequestedAt) return { retired: 0 };
  const ready = await waitingCreateWork(ctx, siteId);
  if (ready.length === 0) return { retired: 0 };
  const live = await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", "published")).take(500);
  const liveIntents = live.flatMap(page => [page.title, ...(page.metaKeywords ?? []).slice(0, 1)]).filter(Boolean).map(primaryKeyword => ({ primaryKeyword }));
  let retired = 0;
  for (const job of ready) {
    const topicId = (job.payload as { topicId?: Id<"topic_clusters"> } | undefined)?.topicId;
    const topic = topicId ? await ctx.db.get(topicId) : null;
    const article = job.articleId ? await ctx.db.get(job.articleId) : null;
    const duplicate = Boolean(topic && topic.siteId === siteId && liveIntents.some(page => contentIntentConflicts({ primaryKeyword: topic.primaryKeyword }, page)));
    // P152 (Oct 21 2026): a waiting article was sealed under the checks of its
    // day; one that fails a reader-visible check added since (P149's source
    // talk, found on the Compost Notes test site) is held back before its slot.
    const defects = !duplicate && article && article.siteId === siteId ? readerVisibleIssues(article) : [];
    // P232: written in the week before P231 for a search that asks for a kind of product, it names none of the products;
    // it is held back and its topic goes back to the plan, to be written again naming them.
    const unnamedProducts = !duplicate && defects.length === 0 && Boolean(topic && searchAsksForProducts(topic.primaryKeyword)) &&
      writtenJustBeforeProductNames(article);
    if (!duplicate && defects.length === 0 && !unnamedProducts) continue;
    if (await holdBackReadyWork(ctx, site, job, topic, article, duplicate,
      duplicate ? ["Repeats a page this site already has, so it was held back and the slot got a new topic."]
        : unnamedProducts ? ["Written before Pentra named the products a search for a kind of product asks for, so it was held back and its topic will be written again."]
        : ["It fails a reader check added after it was written, so it was held back and the slot got a new article.", ...defects.slice(0, 3)])) retired++;
  }
  if (retired > 0) await wake(ctx, siteId);
  return { retired };
} });
/** P232: P231 (shipped 20:09Z Oct 27 2026) names the products a search for a kind of product asks for. A waiting
 * article is at most a few days old, so the ones written under the old rule were written in the week before it. */
const PRODUCT_NAMES_RULE_AT = Date.UTC(2026, 9, 27, 20, 9);
function writtenJustBeforeProductNames(article: Doc<"articles"> | null) {
  const at = article?.createdAt ?? article?._creationTime ?? 0;
  return at >= PRODUCT_NAMES_RULE_AT - 7 * 86_400_000 && at < PRODUCT_NAMES_RULE_AT;
}
/** Autopilot's waiting articles (sealed, before their slot): its own new
 * articles only, never an owner's request or an operation. */
async function waitingCreateWork(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) {
  return (await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", "ready")).take(20))
    .filter(waitingCreateJob);
}
const waitingCreateJob = (job: Doc<"jobs">) => job.status === "done" && job.contentWork?.stage === "ready" && job.contentWork.intent === "create" &&
  !job.contentWork.ownerRequest && job.contentWork.retiredAt === undefined && !job.contentWork.operation;
/** Hold one waiting article back (P140/P152/P194): it is never published, its
 * slot fails with a skippable failure (so the slot gets a new article), it uses
 * none of the month's allowance, and a repeated search is marked covered while
 * a sound topic returns to the plan. False when the article is past holding
 * back (published, or a publication was attempted). */
async function holdBackReadyWork(ctx: MutationCtx, site: Doc<"sites">, job: Doc<"jobs">, topic: Doc<"topic_clusters"> | null,
  article: Doc<"articles"> | null, duplicate: boolean, notes: string[], duplicateReason = "Repeats a page the site already has.") {
  if (article && article.status !== "published" && !article.publicationLeaseOwner && !article.publicationAttemptedAt) {
    await quarantineUnpublishedArticle(ctx, article._id, notes);
  } else if (article) return false;
  await ctx.db.patch(job._id, { status: "failed", nextAttemptAt: undefined, workerToken: undefined, heartbeatAt: undefined, leaseExpiresAt: undefined,
    contentWork: { ...job.contentWork!, stage: "failed", failure: duplicate ? "duplicate_intent" : "reader_visible_defect" }, updatedAt: Date.now() });
  // Never published, so it uses none of the month's allowance (an exact recount follows).
  if (countsTowardMonthlyUsage(job, usageMonthBounds().monthStart)) await refreshAccountUsage(ctx, site, -1);
  if (topic && topic.siteId === site._id && !planCheckpointTopicExecutionLocked(topic)) {
    // A repeated search is covered; a sound topic goes back to the plan to be written again.
    await ctx.db.patch(topic._id, duplicate ? { status: "disqualified", disqualifiedReason: duplicateReason, updatedAt: Date.now() }
      : { status: "planned", updatedAt: Date.now() });
  }
  return true;
}

/** P194 (convex/lib/researchGrouping.ts auditPlannedWork): what the daily plan
 * audit reads. The waiting articles and the planned topics Autopilot would
 * write (owner-chosen searches never), against the live articles. Due only when
 * one of them has no current audit or an article went live after its audit, so
 * an unchanged plan costs nothing. */
const PLAN_AUDIT_SEARCHES = 80, PLAN_AUDIT_LIVE = 150;
export const planAuditContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt || site.deletionStatus || site.accountDeletionRequestedAt) return null;
  let planned: Doc<"topic_clusters">[];
  // P211: the site's pages are read once, for the plan and for the call's list of the business's own pages.
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(LIMIT + 1);
  try { planned = (await eligiblePlannedTopics(ctx, site, [], undefined, pages)).planned.filter(t => !ownerChosen(t)); } catch { return null; }
  const live = (await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", "published"))
    .order("desc").take(PLAN_AUDIT_LIVE)).filter(row => articleMatchesCurrentDomain(site, row) && servedOnItsOwnUrl(site.domain, row.slug));
  const waiting: { job: Doc<"jobs">; topic: Doc<"topic_clusters"> }[] = [];
  for (const job of await waitingCreateWork(ctx, siteId)) {
    const topicId = (job.payload as { topicId?: Id<"topic_clusters"> } | undefined)?.topicId;
    const topic = topicId ? await ctx.db.get(topicId) : null;
    if (topic && topic.siteId === siteId && !ownerChosen(topic)) waiting.push({ job, topic });
  }
  const audited = [...waiting.map(w => w.topic), ...planned].slice(0, PLAN_AUDIT_SEARCHES);
  const items = audited.map((topic, index) => index < waiting.length
    ? { id: `job:${waiting[index].job._id}`, keyword: topic.primaryKeyword, searchVolume: topic.searchVolume ?? 0, waiting: true }
    : { id: `topic:${topic._id}`, keyword: topic.primaryKeyword, searchVolume: topic.searchVolume ?? 0, waiting: false });
  const newestLiveAt = live.reduce((newest, row) => Math.max(newest, row.publishedAt ?? row.articleCreatedAt ?? 0), 0);
  const due = audited.some(topic => topic.planAudit?.version !== PLAN_AUDIT_VERSION || topic.planAudit.checkedAt < newestLiveAt);
  return { business: buyerFitBusiness(site), items, existing: live.map(row => row.title), ownPages: ownPageTitles(site, pages), due };
} });
/** The audit's one call is held before it is sent, like the buyer-fit sweep's. */
export const reservePlanAudit = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site?.userId || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return null;
  const reserved = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId, purpose: "topic_plan",
    trigger: `plan_audit:${Math.floor(Date.now() / 86_400_000)}`, reservedMicroUsd: BUYER_FIT_RESERVATION_MICRO_USD, timestamp: Date.now() });
  return reserved.ok ? reserved.reservationId : null;
} });
/** At most one waiting article a day is held back by the audit, and only with
 * 6 hours left before its slot for the new article to be written. */
const PLAN_AUDIT_MAX_HELD_BACK = 1, PLAN_AUDIT_REPLACEMENT_LEAD_MS = 6 * 3_600_000;
const clipQuote = (value: string | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** Settle the audit's call and apply its verdicts to work that is still unpublished and Autopilot's own. */
export const recordPlanAudit = internalMutation({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations"),
  actualMicroUsd: v.number(), answered: v.boolean(), auditedIds: v.array(v.string()),
  decisions: v.array(v.object({ id: v.string(), action: v.union(v.literal("keep"), v.literal("covered"), v.literal("merged")),
    by: v.optional(v.string()), into: v.optional(v.string()), secondary: v.optional(v.array(v.string())), waitingKeeper: v.optional(v.literal(true)) })) },
  handler: async (ctx, { siteId, reservationId, actualMicroUsd, answered, auditedIds, decisions }) => {
    const reservation = await ctx.db.get(reservationId);
    const actual = Math.max(0, Math.ceil(actualMicroUsd));
    if (reservation && reservation.siteId === siteId && reservation.purpose === "topic_plan" && reservation.settledAt === undefined &&
      reservation.releasedAt === undefined && Number.isSafeInteger(actual) && actual <= reservation.reservedMicroUsd) {
      await settleSharedProviderReservation(ctx, { reservationId, siteId, purpose: "topic_plan",
        actualMicroUsd: actual, reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
    }
    const site = await ctx.db.get(siteId);
    const outcome = { dropped: 0, merged: 0, heldBack: 0 };
    // A lost answer changes nothing: the plan is audited again on the next sweep.
    if (!site || !answered) return outcome;
    const now = Date.now(), stamp = { version: PLAN_AUDIT_VERSION, checkedAt: now };
    const verdicts = new Map(decisions.map(decision => [decision.id, decision]));
    for (const id of auditedIds) {
      const decision = verdicts.get(id);
      if (id.startsWith("topic:")) {
        const topicId = ctx.db.normalizeId("topic_clusters", id.slice("topic:".length));
        const topic = topicId ? await ctx.db.get(topicId) : null;
        if (!topic || topic.siteId !== siteId || !["planned", "pending"].includes(topic.status ?? "planned") || ownerChosen(topic) ||
          planCheckpointTopicExecutionLocked(topic)) continue;
        if (decision?.action === "covered" || decision?.action === "merged") {
          await ctx.db.patch(topic._id, { status: "disqualified", planAudit: stamp, updatedAt: now,
            disqualifiedReason: decision.action === "covered" ? `Repeats a page the site already has: “${clipQuote(decision.by, 120)}”.`
              : decision.waitingKeeper ? `Same article as “${clipQuote(decision.into, 100)}”, already written and waiting to publish.`
              : `Same article as the planned topic “${clipQuote(decision.into, 100)}”.` });
          outcome[decision.action === "covered" ? "dropped" : "merged"]++;
        } else {
          // Its other wordings are written into the same article.
          const secondary = decision?.action === "keep" ? decision.secondary ?? [] : [];
          await ctx.db.patch(topic._id, { planAudit: stamp, updatedAt: now, ...(secondary.length > 0
            ? { secondaryKeywords: [...new Set([...(topic.secondaryKeywords ?? []), ...secondary])].slice(0, 10) } : {}) });
        }
      } else if (id.startsWith("job:")) {
        const jobId = ctx.db.normalizeId("jobs", id.slice("job:".length));
        const job = jobId ? await ctx.db.get(jobId) : null;
        if (!job || job.siteId !== siteId) continue;
        const topicId = (job.payload as { topicId?: Id<"topic_clusters"> } | undefined)?.topicId;
        const topic = topicId ? await ctx.db.get(topicId) : null;
        const article = job.articleId ? await ctx.db.get(job.articleId) : null;
        if (decision?.action === "covered" && outcome.heldBack < PLAN_AUDIT_MAX_HELD_BACK && waitingCreateJob(job) &&
          job.contentWork!.deadlineAt - now >= PLAN_AUDIT_REPLACEMENT_LEAD_MS && (!topic || !ownerChosen(topic)) &&
          await holdBackReadyWork(ctx, site, job, topic, article, true, decision.waitingKeeper
            // P215: two waiting articles on one search: the other one is not live yet.
            ? [`Same article as another one already written and waiting to publish (“${clipQuote(decision.by, 120)}”), so it was held back and the slot got a new topic.`]
            : [`Repeats a page this site already has (“${clipQuote(decision.by, 120)}”), so it was held back and the slot got a new topic.`],
            decision.waitingKeeper ? "Same article as another one already written and waiting to publish." : undefined)) {
          outcome.heldBack++;
        } else if (topic && topic.siteId === siteId) await ctx.db.patch(topic._id, { planAudit: stamp });
      }
    }
    if (outcome.heldBack > 0) await wake(ctx, siteId);
    return outcome;
  } });
/** Autopilot sites for the daily buyer-fit sweep, a page at a time. */
export const buyerFitSweepSites = internalQuery({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { cursor }) => {
  const page = await ctx.db.query("sites").paginate({ cursor, numItems: 20 });
  return { siteIds: page.page.filter(s => s.serviceMode === "growth_first" && s.autopilotEnabled && s.contentSchedule?.autopilotSelectedAt &&
    !s.contentSchedule.paused && !s.deletionStatus && !s.accountDeletionRequestedAt).map(s => s._id),
    isDone: page.isDone, continueCursor: page.continueCursor };
} });

const urlKey = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
/** Searches the site already appears for in Google (last 28 days of Search
 * Console) that no article of its own answers: real demand Google already
 * connects to this business, and the nearest ranking wins. Branded searches,
 * searches it already ranks top-3 for, and searches answered by a published
 * article are left out. Free: the rows are already synced. */
export async function searchConsoleTopicCandidates(ctx: QueryCtx, site: Doc<"sites">) {
  return searchConsoleTopicCandidatesFrom(site, await searchConsoleSearches(ctx, site));
}
/** The last 28 days of Search Console searches the site was shown for, one row
 * per search (impressions, average position, and whether one of its own
 * published articles was the page shown). Empty without current data. */
async function searchConsoleSearches(ctx: QueryCtx, site: Doc<"sites">) {
  try {
    const through = site.gscDataThrough;
    if (!through || !gscConnectionMatchesCurrentDomain(site)) return [];
    const { rows } = await takeCurrentGscQueryRows(ctx, site, 6000, { startDate: addSearchConsoleDays(through, -27), endDate: through });
    const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", site._id).eq("status", "published")).take(2001))
      .filter(row => articleMatchesCurrentDomain(site, row));
    const articleUrls = new Set(summaries.map(row => urlKey(publishedArticlePageUrl(site.domain, site.urlStructure, row.slug))));
    const byQuery = new Map<string, { impressions: number; weighted: number; article: boolean }>();
    for (const row of rows) {
      const query = normalizeResearchKeyword(row.query);
      const entry = byQuery.get(query) ?? { impressions: 0, weighted: 0, article: false };
      entry.impressions += row.impressions; entry.weighted += row.position * row.impressions;
      if (row.page && articleUrls.has(urlKey(row.page))) entry.article = true;
      byQuery.set(query, entry);
    }
    return [...byQuery.entries()].map(([keyword, q]) => ({ keyword, impressions: q.impressions,
      position: q.impressions ? Math.round(q.weighted / q.impressions * 10) / 10 : 0, article: q.article }));
  } catch { return []; }
}
function searchConsoleTopicCandidatesFrom(site: Doc<"sites">, searches: Awaited<ReturnType<typeof searchConsoleSearches>>) {
  return searches.filter(q => !q.article && q.impressions >= 5 && q.position > 3 && q.keyword.length <= 80 &&
      q.keyword.split(" ").length >= 2 && q.keyword.split(" ").length <= 8 && !isBrandedSearchQuery(q.keyword, site.domain))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 40)
    .map(({ keyword, impressions, position }) => ({ keyword, impressions, position }));
}

/** Close Autopilot's keyword-research reservation: settled at the provider's
 * reported cost, or released when nothing was sent. Before this, every run held its full $1 of daily/monthly room forever. */
export const closeTopicResearchReservation = internalMutation({ args: { siteId: v.id("sites"),
  reservationId: v.id("provider_spend_reservations"), sent: v.boolean(), actualMicroUsd: v.number() },
  handler: async (ctx, { siteId, reservationId, sent, actualMicroUsd }) => {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.siteId !== siteId || reservation.purpose !== "topic_plan" ||
      reservation.settledAt !== undefined || reservation.releasedAt !== undefined) return;
    if (!sent) {
      await releaseSharedProviderReservation(ctx, { reservationId, siteId, purpose: "topic_plan",
        reason: "plan_cancelled_before_execution", timestamp: Date.now() });
      return;
    }
    const actual = Math.max(0, Math.round(actualMicroUsd));
    // A reported cost above the reservation is never rounded down into a receipt: the hold stays.
    if (!Number.isSafeInteger(actual) || actual > reservation.reservedMicroUsd) return;
    await settleSharedProviderReservation(ctx, { reservationId, siteId, purpose: "topic_plan",
      actualMicroUsd: actual, reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  } });

/** Add researched keywords as planned topics: business-fit only, never a
 * duplicate of an existing topic, page or article intent. */
type CandidateKeyword = { keyword: string; searchVolume: number; difficulty: number; difficultyMeasured: boolean;
  source?: "search_console"; position?: number; fit?: { keep: boolean; reason: string }; secondary?: string[] };
/** Add measured keywords as planned topics through Autopilot's topic gates:
 * search shape, the site's reach ceiling, no competitor names, a buyer-fit
 * drop, business fit and no repeat of an existing topic, article or page.
 * A search the buyer-fit model kept for this business is not judged again by
 * word match (P171): that check rejected most searches research found.
 * At most 15 per call; Search Console searches first, then by demand. */
async function insertCandidateTopics(ctx: MutationCtx, site: Doc<"sites">, keywords: CandidateKeyword[], noteFor: (k: CandidateKeyword) => string) {
  let inventory;
  try { inventory = await eligiblePlannedTopics(ctx, site); } catch { return null; }
  const siteId = site._id, signals = tenantTopicBusinessSignals(site);
  // A keyword that repeats a published article or page could never be
  // written, so it is not added (it would only take a research slot).
  const taken: { primaryKeyword: string }[] = [...inventory.topics, ...inventory.pageCoverage];
  let added = 0;
  const skipped = { shape: 0, difficulty: 0, competitor: 0, fit: 0, buyerFit: 0, intent: 0 };
  const profileHash = confirmedContentProfileHash(site);
  // Searches the site already appears for come first: they are the nearest wins.
  const fromSearchConsole = (k: { source?: string }) => Number(k.source === "search_console");
  for (const k of [...keywords].sort((a, b) => fromSearchConsole(b) - fromSearchConsole(a) || b.searchVolume - a.searchVolume)) {
    if (added >= 15) break;
    const keyword = k.keyword.trim().toLowerCase().replace(/\s+/g, " ");
    if (keyword.split(" ").length < 2 || keyword.length > 80) { skipped.shape++; continue; }
    if (k.difficulty > siteDifficultyCeiling(site)) { skipped.difficulty++; continue; }
    if (namesCompetitor(keyword, competitorNamesFor(site))) { skipped.competitor++; continue; }
    const proposal = { primaryKeyword: keyword, label: keyword.replace(/^./, c => c.toUpperCase()) };
    if (k.fit && !k.fit.keep) { skipped.buyerFit++; continue; }
    if (!k.fit?.keep && !evaluateTopicBusinessFit({ keyword, label: proposal.label, ...signals }).eligible) { skipped.fit++; continue; }
    if (taken.some(t => contentIntentConflicts(proposal, t))) { skipped.intent++; continue; }
    await ctx.db.insert("topic_clusters", { siteId, ...proposal, planningCanonicalDomain: siteCanonicalDomain(site)!,
      ...(k.fit ? { buyerFit: { eligible: true, reason: k.fit.reason.slice(0, 160), version: BUYER_FIT_VERSION, checkedAt: Date.now(), profileHash } } : {}),
      planningDomainRevision: siteCanonicalDomainRevision(site), secondaryKeywords: (k.secondary ?? []).slice(0, 5), intent: "informational",
      priority: Math.max(1, Math.min(90, Math.round(Math.log10(1 + k.searchVolume) * 20 - k.difficulty / 5))), status: "planned",
      searchVolume: k.searchVolume, keywordDifficulty: k.difficulty, keywordDifficultyMeasured: k.difficultyMeasured,
      notes: noteFor(k), createdAt: Date.now(), updatedAt: Date.now() });
    taken.push(proposal); added++;
  }
  return { added, skipped };
}

/** P128: a site set up after a free check (convex/freeCheck.ts) starts from the
 * missed searches the check found for its domain: real demand, a difficulty a
 * small site can win, no page for it at the time. They pass the same topic
 * gates as research; only a current-logic result (version 3+) from the last
 * 30 days is used. Returns how many topics were added. */
const FREE_CHECK_IMPORT_MAX_AGE_MS = 30 * 86_400_000, FREE_CHECK_IMPORT_MIN_VERSION = 3;
async function importFreeCheckTopics(ctx: MutationCtx, site: Doc<"sites">): Promise<number> {
  const domain = (siteCanonicalDomain(site) ?? site.domain).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const check = await ctx.db.query("free_checks").withIndex("by_domain", q => q.eq("domain", domain)).first();
  if (!check || check.status !== "done" || (check.version ?? 1) < FREE_CHECK_IMPORT_MIN_VERSION || !check.missed?.length ||
    Date.now() - (check.completedAt ?? 0) > FREE_CHECK_IMPORT_MAX_AGE_MS) return 0;
  const checked = new Date(check.completedAt!).toISOString().slice(0, 10);
  const result = await insertCandidateTopics(ctx, site, check.missed.map(k => ({ keyword: k.keyword, searchVolume: k.searchVolume,
    difficulty: k.difficulty, difficultyMeasured: true })), k =>
    `From the free SEO check of ${domain} on ${checked}: about ${k.searchVolume} searches a month at difficulty ${k.difficulty}, and the site had no page for it. Use only supported business facts.`);
  return result?.added ?? 0;
}

export const addResearchedTopics = internalMutation({ args: { siteId: v.id("sites"),
  keywords: v.array(v.object({ keyword: v.string(), searchVolume: v.number(), difficulty: v.number(), difficultyMeasured: v.boolean(),
    // Search Console: the site already appears for this search (volume = impressions in 28 days).
    source: v.optional(v.literal("search_console")), position: v.optional(v.number()),
    // P105: the buyer-fit verdict for this business, when the batch call gave one.
    fit: v.optional(v.object({ keep: v.boolean(), reason: v.string() })),
    // P179: the other wordings of the same search, written into the same article.
    secondary: v.optional(v.array(v.string())) })),
    // What the research run saw (seeds and discovery counts), kept with its outcome.
    research: v.optional(v.object({ seeds: v.array(v.string()), searchConsole: v.number(), discovered: v.optional(v.number()),
      excludedKnown: v.optional(v.number()), excludedFit: v.optional(v.number()), excludedIntent: v.optional(v.number()),
      // P171: where the seeds came from ("model": read from the confirmed profile) and the buyer-fit call's verdicts.
      seedSource: v.optional(v.union(v.literal("model"), v.literal("site"))), judged: v.optional(v.number()), kept: v.optional(v.number()),
      method: v.optional(v.number()), grouped: v.optional(v.number()), coveredByExisting: v.optional(v.number()) })) },
  handler: async (ctx, { siteId, keywords, research }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return { added: 0 };
    // P172: what the buyer-fit model dropped is remembered for this profile, so the next run reaches new searches.
    const profileHash = confirmedContentProfileHash(site), droppedAt = Date.now();
    for (const k of keywords) if (k.fit && !k.fit.keep) await ctx.db.insert("topic_research_drops", { siteId,
      keyword: normalizeResearchKeyword(k.keyword), profileHash, reason: k.fit.reason.slice(0, 160), droppedAt });
    const result = await insertCandidateTopics(ctx, site, keywords, k => k.source === "search_console"
      ? `Search Console: this site was shown ${k.searchVolume} times in 28 days for this search${typeof k.position === "number" ? ` at average position ${k.position}` : ""}, with no article of its own. Use only supported business facts.`
      : "Researched keyword (search demand from DataForSEO) for the confirmed business. Use only supported business facts.");
    if (!result) return { added: 0 };
    const { added, skipped } = result;
    // Record the outcome (an empty result backs off) and let a waiting slot continue either way.
    const receipt = { at: Date.now(), seeds: research?.seeds ?? [], searchConsole: research?.searchConsole ?? 0,
      ...(research?.discovered !== undefined ? { discovered: research.discovered, excludedKnown: research.excludedKnown ?? 0,
        excludedFit: research.excludedFit ?? 0, excludedIntent: research.excludedIntent ?? 0 } : {}),
      ...(research?.seedSource ? { seedSource: research.seedSource } : {}),
      ...(research?.judged !== undefined ? { judged: research.judged, kept: research.kept ?? 0 } : {}),
      ...(research?.method !== undefined ? { method: research.method } : {}),
      ...(research?.grouped !== undefined ? { grouped: research.grouped, coveredByExisting: research.coveredByExisting ?? 0 } : {}),
      offered: keywords.length, added, skippedShape: skipped.shape, skippedDifficulty: skipped.difficulty,
      skippedCompetitor: skipped.competitor, skippedFit: skipped.fit, skippedIntent: skipped.intent, skippedBuyerFit: skipped.buyerFit };
    if (site.contentSchedule) await ctx.db.patch(siteId, { contentSchedule: { ...site.contentSchedule, topicsReplenishAdded: added,
      topicsResearchReceipt: receipt }, updatedAt: Date.now() });
    await wake(ctx, siteId);
    return { added };
  } });

/** Minimum spacing between two automatic publications: half the cadence
 * interval, at most four hours. On time a slot is a whole interval after the
 * previous one, so this only ever slows a catch-up after missed slots. */
export const CATCH_UP_MAX_GAP_MS = 4 * 3_600_000;
async function catchUpPaceAt(ctx: MutationCtx, siteId: Id<"sites">, intervalMs: number) {
  // Article summaries carry publishedAt (synced in the same mutation that
  // publishes) at a few KB each; five full articles (markdown, sources, claim
  // ledger, ~30 KB each) were read on every scheduler wake (B, Oct 19 2026).
  const latest = await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", "published"))
    .order("desc").take(5);
  const last = latest.reduce((max, a) => typeof a.publishedAt === "number" && a.publishedAt > max ? a.publishedAt : max, 0);
  return last > 0 ? last + Math.min(Math.floor(intervalMs / 2), CATCH_UP_MAX_GAP_MS) : 0;
}

/** A reviewed article must never be stranded behind the schedule.
 *
 * Several legitimate paths move `nextDeadlineAt` without touching prepared
 * jobs: a parked failed slot, Autopilot re-selection or re-enable, a paused
 * contract resumed later. A ready job whose deadline no longer matches the
 * cadence grid is then invisible to delivery (it sits below `nextDeadlineAt`)
 * or blocks it forever (off-grid above it, with the buffer full). Instead of
 * paying for a new article while an approved one waits, bind the earliest
 * ready article to the first free slot of the two-article buffer. The artifact,
 * its approval hash and every receipt are unchanged; only its slot moves, and
 * the original deadline is kept in `slotRebinds` so the miss stays on record. */
export async function rebindStrandedReadyWork(ctx: MutationCtx, site: Doc<"sites">,
  schedule: NonNullable<Doc<"sites">["contentSchedule"]>, waiting: Doc<"jobs">[], now = Date.now()) {
  const next = schedule.nextDeadlineAt, interval = schedule.intervalMs;
  if (!Number.isSafeInteger(next) || !Number.isSafeInteger(interval) || interval <= 0) return null;
  const eligible = async (j: Doc<"jobs">) => {
    const cw = j.contentWork;
    if (!cw || j.siteId !== site._id || j.status !== "done" || cw.stage !== "ready" || cw.ownerRequest || cw.operation ||
      cw.retiredAt !== undefined || !cw.approvedArtifactHash || !j.articleId || j.workerToken || j.leaseExpiresAt ||
      cw.profileHash !== schedule.profileHash || cw.connectionHash !== schedule.connectionHash) return false;
    const article = await ctx.db.get(j.articleId);
    return Boolean(article && article.siteId === site._id && isSealedReady(article) &&
      article.auditedContentHash === cw.approvedArtifactHash && publicationArtifactHash(article) === cw.approvedArtifactHash);
  };
  const occupied = new Set(waiting.map(j => j.contentWork!.deadlineAt));
  // Stranded below the schedule: never visible to `waiting` (jobsForSite reads
  // deadlines >= nextDeadlineAt), so they are looked up explicitly, newest first.
  // Only a ready job can be rebound, so they are found through the stage index:
  // reading the site's 200 latest past jobs, each carrying its provider
  // checkpoints, cost ~7 MB per scheduler run (K2, Oct 19 2026: half of all
  // database reads). Every eligibility check below is unchanged.
  const below = (await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", site._id)
    .eq("contentWork.stage", "ready")).take(200))
    .filter(j => j.contentWork!.deadlineAt < next).sort((a, b) => b.contentWork!.deadlineAt - a.contentWork!.deadlineAt);
  const stranded: Doc<"jobs">[] = [];
  for (const j of below) if (await eligible(j)) stranded.push(j);
  const offGrid: Doc<"jobs">[] = [], behind: Doc<"jobs">[] = [];
  for (const j of waiting) {
    const d = j.contentWork!.deadlineAt;
    if (d !== next && d !== next + interval && await eligible(j)) offGrid.push(j);
    // P173: an empty due slot with the next slot's article waiting means the due
    // article failed or was held back (slots are prepared in order). That article
    // moves up instead of the due slot being parked as missed; its own slot is
    // then prepared like any open slot.
    else if (d === next + interval && !occupied.has(next) && await eligible(j)) behind.push(j);
  }
  let target: number | null = null, candidate: Doc<"jobs"> | undefined;
  if (!occupied.has(next)) {
    // The due slot is empty: the oldest approved article takes it.
    candidate = [...stranded, ...offGrid, ...behind].sort((a, b) => a.contentWork!.deadlineAt - b.contentWork!.deadlineAt)[0];
    target = next;
  } else if (!occupied.has(next + interval) && waiting.length < 2) {
    // The due slot is covered: a stranded article fills the second slot
    // instead of a new paid draft.
    candidate = stranded.sort((a, b) => a.contentWork!.deadlineAt - b.contentWork!.deadlineAt)[0];
    target = next + interval;
  }
  if (!candidate || target === null) return null;
  const cw = candidate.contentWork!;
  await ctx.db.patch(candidate._id, { contentWork: { ...cw, deadlineAt: target, windowStartAt: target - CONTENT_DELIVERY_WINDOW_MS,
    windowWakeId: undefined, slotRebinds: [...(cw.slotRebinds ?? []), { fromDeadlineAt: cw.deadlineAt, toDeadlineAt: target, at: now,
      reason: cw.deadlineAt < next ? "stranded_behind_schedule" : cw.deadlineAt === next + interval ? "moved_up_into_empty_slot" : "off_cadence_grid" }].slice(-10) },
    updatedAt: now });
  return { jobId: candidate._id, fromDeadlineAt: cw.deadlineAt, toDeadlineAt: target };
}

/** One scheduler, same jobs and workers. A done/ready job is a checkpoint, not
 * another queue. Delivery reclaims that identical execution record. */
export const advance = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<CadenceScheduleResult> => {
    const site = await ctx.db.get(siteId), schedule = site?.contentSchedule;
    if (!site || site.serviceMode !== "growth_first" || !schedule) return { scheduled: 0, mode: "content_mode_required" };
    // Pause/entitlement loss stop admissions and unstarted writes, not read-only
    // reconciliation of a write already acknowledged by the destination.
    const verifying = await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", "verify")).take(LIMIT + 1);
    if (verifying.length > LIMIT) return { scheduled: 0, mode: "content_failed_slot", blockers: ["content_inventory_incomplete"] };
    for (const job of verifying) if (job.contentWork?.intent === "improve" && (job.contentWork.verificationNextAt ?? 0) <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId, jobId: job._id });
    }
    if (schedule.ownerReviewedOnly || !site.autopilotEnabled || schedule.paused || !["warm", "live"].includes(site.autopilotRolloutMode ?? "") ||
      !(await contentEntitlementAuthorized(ctx, site))) return { scheduled: 0, mode: "content_paused" };
    if (!contentConnectionComplete(site) || schedule.profileHash !== confirmedContentProfileHash(site) ||
      schedule.connectionHash !== contentConnectionHash(site)) return { scheduled: 0, mode: "content_binding_changed" };
    if (site.approvalRequired) return { scheduled: 0, mode: "approval_waiting" };
    const all = await jobsForSite(ctx, siteId, schedule.nextDeadlineAt), work = all.filter(j => j.contentWork && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined);
    if (all.some(j => !j.contentWork && ["pending", "running"].includes(j.status))) return { scheduled: 0, mode: "content_migration_pending" };
    const waiting = work.filter(j => !["verified", "failed"].includes(j.contentWork!.stage)).sort((a,b) => a.contentWork!.deadlineAt - b.contentWork!.deadlineAt);
    const restoration = waiting.find(j => j.contentWork!.operation);
    if (restoration?.contentWork?.stage === "verify") {
      if ((restoration.contentWork.verificationNextAt ?? 0) <= Date.now()) await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId, jobId: restoration._id });
      return { scheduled: 0, mode: "public_url_pending" };
    }
    if (restoration && ["pending", "running"].includes(restoration.status)) return { scheduled: 0, mode: "work_in_progress", activeJobId: restoration._id };
    // A prepared article is never left behind the schedule or off its grid.
    const rebound = await rebindStrandedReadyWork(ctx, site, schedule, waiting);
    if (rebound) {
      await wake(ctx, siteId);
      return { scheduled: 0, mode: "content_slot_rebound", activeJobId: rebound.jobId };
    }
    // Delivery and its persisted window wake precede all unrelated preparation,
    // review and funding failures. Claiming still uses the existing disjoint
    // provider-free worker lane and the publisher's destination lease.
    const ready = waiting.filter(j => j.status === "done" && j.contentWork!.stage === "ready");
    let active = schedule.active;
    // Autopilot-setup sites go live with their first reviewed article (a Free
    // plan may only ever have one a month); the next is prepared ahead of its
    // own slot. Publishing prepared work spends nothing, so it never waits for
    // new funding. Older contracts keep the funded two-article buffer.
    const activationSize = schedule.autopilotSelectedAt ? 1 : 2;
    if (!active && ready.length >= activationSize && liveAutopilotReadiness(site, true).ready) {
      const batch = ready.slice(0, activationSize);
      if (!schedule.autopilotSelectedAt) {
        const funding = await contentFunding(ctx, site, (await pricingConfiguration(ctx, site))?.budgetMicroUsd);
        // Exhausting/stopping/removing scoped model execution cannot strand two
        // already-reviewed deliveries, even before the first window activates.
        // Validate their retained run/receipt lineage, but require no new money.
        const preparedRun = (await Promise.all(batch.map(async job => {
          try { return Boolean(job.contentWork!.pricing.validationAuthorizationId &&
            job.contentWork!.pricing.validationAuthorizationId === (await contentValidationBinding(ctx, site, Date.now(), job))?.id); }
          catch { return false; }
        }))).every(Boolean);
        if (funding.status !== "available" && !preparedRun) return { scheduled: 0, mode: "content_budget_exhausted" };
      }
      if (new Set(batch.map(j => j.articleId)).size !== batch.length) return { scheduled: 0, mode: "content_artifact_changed" };
      for (const item of batch) {
        const artifact = item.articleId ? await ctx.db.get(item.articleId) : null;
        if (!artifact || !isSealedReady(artifact) || publicationArtifactHash(artifact) !== item.contentWork!.approvedArtifactHash) return { scheduled: 0, mode: "content_artifact_changed" };
      }
      active = true;
      await ctx.db.patch(siteId, { contentSchedule: { ...schedule, active: true }, autopilotRolloutMode: "live", updatedAt: Date.now() });
    }
    const first = ready.find(j => j.contentWork!.deadlineAt === schedule.nextDeadlineAt);
    if (active && first && Date.now() >= first.contentWork!.windowStartAt) {
      // Catching up after missed slots (an outage, or Autopilot resumed after a
      // review-first period) is paced, never a burst: deadlines and misses stay
      // exactly as recorded, only back-to-back deliveries are spaced out.
      const paceAt = await catchUpPaceAt(ctx, siteId, schedule.intervalMs);
      if (paceAt > Date.now()) {
        await ctx.scheduler.runAt(paceAt, internal.autopilot.dispatchSiteFollowup,
          { siteId, trigger: "content_window", reason: `catch_up_pace_${first.contentWork!.deadlineAt}` });
        return { scheduled: 0, mode: "cadence_not_due", eligibleAt: paceAt };
      }
      const article = first.articleId ? await ctx.db.get(first.articleId) : null;
      if (!article || !isSealedReady(article) || article.auditedContentHash !== first.contentWork!.approvedArtifactHash ||
        publicationArtifactHash(article) !== first.contentWork!.approvedArtifactHash) return { scheduled: 0, mode: "content_artifact_changed" };
      await authorizedWorkPage(ctx, site, first);
      await ctx.db.patch(first._id, { status: "pending", nextAttemptAt: undefined,
        payload: { ...first.payload, articleId: article._id, publishOnly: true, bufferDelivery: true, qualityRetry: false, bufferFill: false },
        contentWork: { ...first.contentWork!, stage: "publish" }, updatedAt: Date.now() });
      return { scheduled: 1, mode: "buffer_delivery", activeJobId: first._id };
    }
    const publishing = waiting.find(j => ["pending", "running"].includes(j.status) &&
      j.contentWork!.deadlineAt === schedule.nextDeadlineAt && j.contentWork!.stage === "publish");
    if (publishing) return { scheduled: 0, mode: "buffer_delivery_pending", activeJobId: publishing._id };
    if (active && first && first.contentWork!.windowStartAt > Date.now() && !first.contentWork!.windowWakeId) {
      const windowWakeId = await ctx.scheduler.runAt(first.contentWork!.windowStartAt, internal.autopilot.dispatchSiteFollowup,
        { siteId, trigger: "content_window", reason: `fixed_deadline_${first.contentWork!.deadlineAt}` });
      await ctx.db.patch(first._id, { contentWork: { ...first.contentWork!, windowWakeId } });
    }
    for (const j of work) if (j.status === "failed" && !["verified", "failed"].includes(j.contentWork!.stage)) {
      await settleFailedContentWork(ctx, j._id);
      return { scheduled: 0, mode: "content_failed_slot" };
    }
    const activeJob = work.find(j => ["pending", "running"].includes(j.status));
    if (activeJob?.status === "pending" && !activeJob.workerToken && !activeJob.leaseExpiresAt &&
      activeJob.cadenceFailure?.code === "article_provider_monthly_attempt_limit" &&
      await hasContentWorkProviderBudget(ctx, site, activeJob)) {
      // Reconcile only the obsolete cost proxy, never a true cash-budget or
      // article-entitlement rejection. Keep deadlines, attempts and receipts.
      await ctx.db.patch(activeJob._id, { nextAttemptAt: undefined, error: undefined, cadenceFailure: undefined,
        result: { ...activeJob.result, reconciledLegacyProviderDeferral: activeJob.cadenceFailure }, updatedAt: Date.now() });
      return { scheduled: 1, mode: "work_in_progress", activeJobId: activeJob._id };
    }
    if (activeJob) return { scheduled: 0, mode: "work_in_progress", activeJobId: activeJob._id };
    const unverified = waiting.find(j => j.contentWork!.stage === "verify");
    if (unverified) {
      if (unverified.contentWork!.intent === "improve" && (unverified.contentWork!.verificationNextAt ?? 0) <= Date.now()) {
        await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId, jobId: unverified._id });
      }
      const article = unverified.articleId ? await ctx.db.get(unverified.articleId) : null;
      return { scheduled: 0, mode: article?.publicUrlStatus === "failed" ? "public_url_failed" : "public_url_pending" };
    }
    const failed = waiting.find(j => j.contentWork!.stage === "review_failed");
    if (failed) return reviseFailedWork(ctx, site, failed);
    // A failed delivery slot cannot silently mint unlimited replacement jobs.
    // A replacement (or rebound article) already holding this deadline covers
    // the slot: the failed job stays on record, but it must not park the
    // schedule past the article that will be delivered for it.
    const slotCovered = waiting.some(j => j.contentWork!.deadlineAt === schedule.nextDeadlineAt);
    const failedSlot = slotCovered ? undefined : latestFailedAt(work, schedule.nextDeadlineAt);
    // Only sites that chose Autopilot in the new setup continue past a parked
    // draft; older contracts keep their failed slot exactly as recorded.
    const failure = failedSlot?.contentWork!.failure ?? "";
    // Autopilot's own page improvements never hold a slot, whatever the
    // site's contract: nothing was published for them.
    const improvementFailed = Boolean(failedSlot && automaticImprovement(failedSlot.contentWork!));
    const replaceNextSlot = Boolean(failedSlot && (schedule.autopilotSelectedAt || improvementFailed) && waiting.length === 0 &&
      slotReplacementCandidate(work, schedule.nextDeadlineAt)?._id === failedSlot._id && replacementsHealthy(work) &&
      failedSlot.contentWork!.deadlineAt - Date.now() >= AUTOPILOT_REPLACEMENT_LEAD_MS);
    if (failedSlot && !replaceNextSlot && !failedSlot.contentWork!.ownerRequest && (improvementFailed ||
      (schedule.autopilotSelectedAt && autopilotSkippableFailure(failedSlot) &&
        (failedSlot.articleId || failure !== "bounded_content_quality_exhausted") && failedSlot.contentWork!.intent === "create"))) {
      // Autopilot never stalls on a draft the reviewer would not pass, or on a
      // provider response that was incomplete (nothing was published): any
      // retained draft waits for the owner, the missed slot stays recorded on
      // that job, and the schedule continues with the next slot.
      await ctx.db.patch(siteId, { contentSchedule: { ...schedule, nextDeadlineAt: schedule.nextDeadlineAt + schedule.intervalMs },
        updatedAt: Date.now() });
      await wake(ctx, siteId);
      return { scheduled: 0, mode: "content_slot_parked", blockers: [improvementFailed ? "automatic_improvement_failed" : "owner_review_needed"] };
    }
    if (failedSlot && !replaceNextSlot) return { scheduled: 0, mode: "content_failed_slot", blockers: [failedSlot.contentWork!.failure ?? "content_work_failed"] };
    if (waiting.length >= 2) {
      // P171: a site whose topics came from the old research method researches
      // once with the new one now, instead of when its topics run low.
      if (schedule.autopilotSelectedAt && researchMethodOutdated(schedule) && Date.now() >= topicResearchDueAt(schedule)) {
        const [fresh, pricing] = [await ctx.db.get(siteId), await pricingConfiguration(ctx, site)];
        if (fresh && pricing) await startTopicResearchIfDue(ctx, fresh, pricing.budgetMicroUsd);
      }
      // P176: Autopilot completes Related reading titles it once cut, one page at a time, only while the next slot is far.
      if (relatedRepairAllowed(site, Date.now())) await ctx.scheduler.runAfter(0, internal.contentImprovements.requestRelatedReadingRepair, { siteId });
      return { scheduled: 0, mode: "buffer_full" };
    }
    if (schedule.autopilotSelectedAt) {
      const backoffUntil = await autopilotFailureBackoffUntil(ctx, siteId, schedule.intervalMs);
      // Deadline first: the next open slot gets its first attempt once it is
      // SLOT_PREP_LEAD_MS away, backoff or not. A persistent failure still costs
      // one attempt per slot, as normal operation does (Oct 18-19 2026: both
      // owner sites sat in this backoff while their slots came due).
      const nextSlot = schedule.nextDeadlineAt + waiting.length * schedule.intervalMs;
      const untried = !work.some(j => j.contentWork!.deadlineAt === nextSlot), prepAt = nextSlot - SLOT_PREP_LEAD_MS;
      if (backoffUntil > Date.now() && !(untried && Date.now() >= prepAt)) {
        const wakeAt = untried ? Math.min(backoffUntil, prepAt) : backoffUntil;
        await ctx.scheduler.runAt(wakeAt, internal.autopilot.dispatchSiteFollowup, {
          siteId, trigger: "content_work", reason: "content_failure_backoff" });
        return { scheduled: 0, mode: "content_failure_backoff", eligibleAt: wakeAt };
      }
    }
    const pricing = await pricingConfiguration(ctx, site);
    if (!pricing) return { scheduled: 0, mode: "content_pricing_unavailable" };
    // A replacement slot is always a new article, never another improvement.
    // That includes a failed slot further ahead: choosing an improvement for it
    // returned "content_failed_slot" on every pass, so the slot sat unprepared
    // while each pass marked refresh candidates reviewed and left an unused
    // topic (P163, Oct 22 2026: LeadPilot's Oct 24 slot after its refresh failed).
    const nextOpenSlot = schedule.nextDeadlineAt + waiting.length * schedule.intervalMs;
    const replacementDue = Boolean(schedule.autopilotSelectedAt) && Boolean(slotReplacementCandidate(work, nextOpenSlot));
    // P190 (Oct 25 2026): the site's pages and topics are read once for this pass.
    // The improvement choice and each topic choice read them again: on LeadPilot
    // a preparation pass read its 64 pages (1.5 MB, with their full text) three
    // times and its 393 topics twice, about 8 MB a pass.
    const preloaded = { pages: await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(LIMIT + 1),
      topics: await takeCurrentDomainTopics(ctx, site, LIMIT + 1) };
    const improvement = replaceNextSlot || replacementDue ? null : await chooseImprovement(ctx, site, work, preloaded.pages);
    const runway = { planned: 0, searched: 0 };
    let topic = improvement ? null : await chooseTopic(ctx, site, undefined, [], { demandOnly: Boolean(schedule.autopilotSelectedAt), runway, preloaded });
    if (!improvement && !topic && schedule.autopilotSelectedAt) {
      // No searched keyword is left: research new ones for the confirmed
      // business (within the ordinary spend limits). When the slot allows, the
      // article waits for that research; the cadence never does.
      const researching = await startTopicResearchIfDue(ctx, site, pricing.budgetMicroUsd);
      if (researching && !replaceNextSlot && schedule.nextDeadlineAt - Date.now() >= TOPIC_RESEARCH_WAIT_MARGIN_MS) {
        await ctx.scheduler.runAfter(10 * 60_000, internal.autopilot.dispatchSiteFollowup, {
          siteId, trigger: "content_work", reason: "content_work_stage_changed" });
        return { scheduled: 0, mode: "topics_researching" };
      }
      topic = await chooseTopic(ctx, site, undefined, [], { preloaded });
    }
    if (!topic && !improvement) {
      // Wake exactly when keyword research may run again, instead of waiting
      // up to three hours for the next scheduled check.
      const researchAt = schedule.autopilotSelectedAt ? topicResearchDueAt(schedule) : 0;
      if (researchAt > Date.now() && researchAt - Date.now() <= 86_400_000) {
        await ctx.scheduler.runAt(researchAt, internal.autopilot.dispatchSiteFollowup, {
          siteId, trigger: "content_work", reason: "topic_research_due" });
      }
      return { scheduled: 0, mode: "content_inputs_exhausted", ...(researchAt > Date.now() ? { eligibleAt: researchAt } : {}) };
    }
    // Autopilot honours the plan's monthly article allowance across the whole
    // account. When it is used up, the next article waits for the new month.
    if (schedule.autopilotSelectedAt && !improvement && site.userId) {
      const plan = await accountPlan(ctx, site), month = await accountArticlesThisMonth(ctx, site);
      await storeAccountUsage(ctx, site.userId, month.monthStart, month.used);
      if (month.used >= plan.articlesPerMonth) {
        if (waiting.length === 0 && schedule.nextDeadlineAt < month.nextMonthStart + 12 * 3_600_000) {
          await ctx.db.patch(siteId, { contentSchedule: { ...schedule, nextDeadlineAt: month.nextMonthStart + 12 * 3_600_000 }, updatedAt: Date.now() });
        }
        return { scheduled: 0, mode: "quota_reached", blockers: ["plan_monthly_articles_reached"] };
      }
    }
    // Autopilot keeps the customer's cadence. With nothing prepared, the next
    // article is never more than one cadence interval away: it starts now and
    // lands in about two hours. Only a future slot moves, and only earlier;
    // an overdue slot stays exactly as recorded.
    // A cadence change applies to the next slot not yet prepared; slots already
    // prepared keep their deadlines.
    let slot = schedule;
    if (schedule.autopilotSelectedAt && !schedule.ownerReviewedOnly && !schedule.paused &&
      (waiting.length === 0 || (waiting.length === 1 && waiting[0].contentWork!.deadlineAt === schedule.nextDeadlineAt))) {
      const rhythm = (await accountPlan(ctx, site)).autopilotIntervalMs, now = Date.now();
      let nextDeadlineAt = schedule.nextDeadlineAt;
      if (waiting.length === 0 && schedule.nextDeadlineAt > now + rhythm) {
        // Deliveries are spaced (catchUpPaceAt), so a slot pulled in right
        // after one would be missed by design: it lands no earlier than the
        // spacing allows, with its delivery window opening exactly then.
        const paceAt = await catchUpPaceAt(ctx, siteId, rhythm);
        nextDeadlineAt = Math.min(schedule.nextDeadlineAt,
          Math.max(now + Math.min(rhythm, FIRST_ARTICLE_LEAD_MS), paceAt > 0 ? paceAt + CONTENT_DELIVERY_WINDOW_MS : 0));
      }
      if (rhythm !== schedule.intervalMs || nextDeadlineAt !== schedule.nextDeadlineAt) slot = { ...schedule, intervalMs: rhythm, nextDeadlineAt };
    }
    const deadlineAt = slot.nextDeadlineAt + waiting.length * slot.intervalMs;
    const atDeadline = work.filter(j => j.contentWork!.deadlineAt === deadlineAt);
    const candidate = slotReplacementCandidate(work, deadlineAt);
    const replacing = schedule.autopilotSelectedAt && !improvement && candidate &&
      replacementsHealthy(work) && deadlineAt - Date.now() >= AUTOPILOT_REPLACEMENT_LEAD_MS ? candidate : null;
    if (atDeadline.length && !replacing) return { scheduled: 0, mode: "content_failed_slot" };
    const budgetRequest = { siteId, userId: site.userId!, purpose: "content_work" as const,
      trigger: `content_slot:${deadlineAt}${replacing ? ":replacement" : ""}`, reservedMicroUsd: pricing.budgetMicroUsd, timestamp: Date.now() };
    let budget = await inspectSharedProviderBudget(ctx, budgetRequest);
    if (!budget.ok && await closeFinishedContentHolds(ctx, site) > 0) budget = await inspectSharedProviderBudget(ctx, budgetRequest);
    if (!budget.ok) return { scheduled: 0, mode: "content_budget_exhausted", blockers: [budget.reason], budgetBlocker: budget };
    // Move the slot only once the work is actually admitted, so an unfunded
    // pull-forward can never create a missed deadline.
    if (slot !== schedule) await ctx.db.patch(siteId, { contentSchedule: slot, updatedAt: Date.now() });
    const { budgetMicroUsd, ...price } = pricing;
    // An improvement's topic is written only now that its job is admitted:
    // written before the slot and budget checks, every pass that stopped at
    // them left an unused topic in the plan (P166, Oct 23 2026).
    if (improvement) topic = await ctx.db.get(await ctx.db.insert("topic_clusters", {
      siteId, planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
      primaryKeyword: improvement.question, label: improvement.page.editable!.title, secondaryKeywords: [], intent: "informational",
      priority: 1, status: "planned", notes: improvement.reason, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    if (!topic) throw new Error("Content work topic unavailable");
    const jobId = await ctx.db.insert("jobs", { siteId, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
      payload: { topicId: topic._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { validationAuthorizationId: schedule.validationAuthorizationId, intent: improvement ? "improve" : "create", ...(improvement ? { targetPageId: improvement.page._id,
          baseRevision: improvement.page.editable!.sourceRevision, permissionVersion: improvement.page.editable!.version, opportunity: improvement.reason,
          editTarget: improvement.editTarget } : {}),
        stage: "prepare", deadlineAt, windowStartAt: deadlineAt - CONTENT_DELIVERY_WINDOW_MS,
        profileHash: schedule.profileHash, connectionHash: schedule.connectionHash, revisions: 0, replacements: 0,
        ...(replacing ? { replacesJobId: replacing._id } : {}),
        discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] }, createdAt: Date.now(), updatedAt: Date.now() });
    // The provisional job and its receipt commit together. The preceding read
    // uses the same transaction; an unexpected denial rolls back both.
    const reserved = await reserveSharedProviderBudget(ctx, { ...budgetRequest, contentWorkJobId: jobId });
    if (!reserved.ok) throw new Error("Content reservation changed inside admission");
    await ctx.db.patch(jobId, { providerSpendReservationId: reserved.reservationId });
    await ctx.db.patch(topic._id, { status: "queued", updatedAt: Date.now() });
    if (!improvement) await refreshAccountUsage(ctx, site, replacing ? 0 : 1);
    if (improvement) await ctx.db.patch(improvement.page._id, { editable: { ...improvement.page.editable!, lastWorkJobId: jobId } });
    // Research the next keywords before the searched ones run out, instead of
    // waiting for an empty inventory (which costs slots at a fast cadence).
    // It never takes the room the next article needs.
    if (schedule.autopilotSelectedAt && !improvement && (researchMethodOutdated(schedule) ||
      runway.searched - ((topic.searchVolume ?? 0) > 0 ? 1 : 0) < topicRunwayTarget(slot.intervalMs))) {
      const fresh = await ctx.db.get(siteId);
      if (fresh) await startTopicResearchIfDue(ctx, fresh, pricing.budgetMicroUsd);
    }
    return { scheduled: 1, mode: replacing ? "buffer_replacement" : "buffer_fill", activeJobId: jobId };
  },
});

export async function contentWorkCompleted(ctx: MutationCtx, job: Doc<"jobs">, rejectionIssues?: string[]) {
  if (!job.contentWork) return;
  if (job.contentWork.intent === "improve" && ["verify", "verified"].includes(job.contentWork.stage)) return;
  if (!job.articleId) {
    await ctx.db.patch(job._id, { status: "failed", contentWork: { ...job.contentWork, stage: "failed", failure: "candidate_rejected_before_draft" } });
    await closeContentWorkHold(ctx, (await ctx.db.get(job._id))!);
    // Nothing was delivered: the article goes back to the month's allowance.
    const owner = await ctx.db.get(job.siteId!);
    if (owner) await refreshAccountUsage(ctx, owner);
    await wake(ctx, job.siteId!);
    return;
  }
  if (rejectionIssues?.length) {
    const rejected = await ctx.db.get(job.articleId);
    if (!rejected || rejected.siteId !== job.siteId) throw new Error("Content rejection crossed tenant boundary");
    await quarantineUnpublishedArticle(ctx, job.articleId, rejectionIssues);
  }
  let article = await ctx.db.get(job.articleId);
  const cw = job.contentWork;
  if (!article || article.siteId !== job.siteId) throw new Error("Content work artifact crossed tenant boundary");
  let stage: NonNullable<Doc<"jobs">["contentWork"]>["stage"] = article.status === "published" ? (article.publicUrlStatus === "verified" ? "verified" : "verify")
    : isSealedReady(article) ? "ready" : "review_failed";
  // On a site whose owner consented to automatic publication, a new article
  // whose fact check passed and whose only remaining notes are style notes is
  // accepted by autopilot instead of spending more revisions chasing a score.
  // A failed first review reports its issues here; when every one of them is a
  // note autopilot may accept, it is accepted now instead of after a paid
  // rewrite (Oct 14: 33 of 39 LeadPilot articles paid for at least one).
  // Rule 2a covers Autopilot's own page improvements too (P142, Oct 21 2026):
  // they still needed scores of 85 on the whole page, so LeadPilot's refreshes
  // failed 7 of 7 on scores (editorial 62, fact 67-83), each after three paid
  // reviews. Their objective checks still block, and the deterministic
  // improvement check below still proves only the new section changed.
  const autopilotAcceptable = !rejectionIssues?.length ||
    rejectionIssues.every(issue => ownerWaivableIssue(issue, article!, "autopilot"));
  if (stage === "review_failed" && !cw.ownerRequest && (cw.intent === "create" || automaticImprovement(cw)) && autopilotAcceptable) {
    const site = await ctx.db.get(job.siteId!);
    const topic = article.topicId ? await ctx.db.get(article.topicId) : null;
    // The review's own target check: the measured keyword must still fit the
    // business and the final title. Accepted notes never bypass it. A search
    // the owner chose or the buyer-fit model kept is not judged by word match
    // here either (P174: pentra.dev's "local seo tools" was quarantined on it).
    const aligned = !site || !topic || topicFitSettled(topic) || evaluateTopicBusinessFit({ keyword: topic.primaryKeyword, label: article.title,
      ...tenantTopicBusinessSignals(site) }).eligible;
    if (site && aligned && site.serviceMode === "growth_first" && site.autopilotEnabled && !site.approvalRequired &&
      site.contentSchedule && !site.contentSchedule.ownerReviewedOnly && site.contentSchedule.autopilotSelectedAt &&
      site.contentSchedule.autopublishConsentAt && article.status !== "published" && !article.publicationAttemptedAt) {
      const accepted = await sealAcceptedReviewNotes(ctx, site, article, AUTOPILOT_ACCEPTANCE);
      if (accepted.sealed) {
        article = (await ctx.db.get(job.articleId))!;
        if (isSealedReady(article)) stage = "ready";
      }
    }
  }
  let selectedFailure: string | undefined = rejectionIssues?.length && stage !== "ready" ? "content_review_rejected" : undefined;
  if (stage === "ready" && cw.intent === "improve") {
    const site = await ctx.db.get(job.siteId!);
    try {
      const page = site ? await authorizedWorkPage(ctx, site, job) : null;
      if (!page?.editable) throw new Error("Selected page unavailable");
      assertSafeImprovement(page.editable, article, cw.editTarget);
    } catch (error) { stage = "review_failed"; selectedFailure = error instanceof Error ? error.message : "Selected-page review failed"; }
  }
  await ctx.db.patch(job._id, { contentWork: { ...cw, stage, failure: selectedFailure ?? (stage === "ready" ? undefined : cw.failure),
    approvedArtifactHash: stage === "ready" ? article.auditedContentHash : stage === "review_failed" ? undefined : cw.approvedArtifactHash,
    publishedAt: article.publishedAt, verifiedAt: article.publicUrlVerifiedAt } });
  if (stage === "ready") await closeContentWorkHold(ctx, (await ctx.db.get(job._id))!);
  if (cw.ownerRequest) {
    if (stage === "review_failed") await ctx.scheduler.runAfter(0, internal.contentWork.advanceOwnerDraft, { jobId: job._id });
    else if (stage === "ready") await noteDraftReady(ctx, (await ctx.db.get(job._id))!, Date.now());
    return;
  }
  await wake(ctx, job.siteId!);
}

export async function contentWorkVerified(ctx: MutationCtx, site: Doc<"sites">, article: Doc<"articles">, checkedAt: number) {
  if (site.serviceMode !== "growth_first" || !site.contentSchedule) return;
  const jobs = await ctx.db.query("jobs").withIndex("by_site_article", q => q.eq("siteId", site._id).eq("articleId", article._id)).take(20);
  const job = jobs.find(j => j.contentWork?.approvedArtifactHash === article.publishedContentHash);
  if (!job?.contentWork || job.contentWork.retiredAt !== undefined || job.contentWork.stage === "verified") return;
  // Recording an old, already-delivered artifact is not permission to enroll
  // it for edits under changed facts or credentials. Preserve the receipt but
  // require a separate current page selection when its binding changed.
  let currentBinding = false;
  try { currentBinding = job.contentWork.profileHash === confirmedContentProfileHash(site) && job.contentWork.connectionHash === contentConnectionHash(site); } catch { /* Disconnected. */ }
  if (job.contentWork.intent === "create" && currentBinding) {
    // Enrolling the article for later refreshes is optional and only ever
    // grants edit permission; it must never stop a live, verified article
    // from being recorded (Oct 14: a title containing "terms" threw here on
    // every retry and held pentra.dev's whole schedule at public_url_pending).
    // Every check runs before its single write, so a refusal writes nothing.
    try { await enrollVerifiedCreation(ctx, site, article, job); }
    catch (error) { console.warn(`Verified article ${article._id} not enrolled for refreshes: ${error instanceof Error ? error.message : "unknown"}`); }
  }
  await ctx.db.patch(job._id, { contentWork: { ...job.contentWork, stage: "verified", publishedAt: article.publishedAt, verifiedAt: checkedAt } });
  await closeVerifiedContentWake(ctx, (await ctx.db.get(job._id))!);
  // D4: the owner hears when the site's first article is live (never blocks the record).
  if (job.contentWork.intent === "create") {
    try { await noteFirstArticleLive(ctx, site, article, checkedAt); }
    catch (error) { console.warn(`First-article email not scheduled for ${site._id}: ${error instanceof Error ? error.message : "unknown"}`); }
  }
  if (job.contentWork.ownerRequest) return;
  if (job.contentWork.deadlineAt === site.contentSchedule.nextDeadlineAt) await ctx.db.patch(site._id, {
    contentSchedule: { ...site.contentSchedule, nextDeadlineAt: site.contentSchedule.nextDeadlineAt + site.contentSchedule.intervalMs }, updatedAt: checkedAt });
  await wake(ctx, site._id);
}

/** A finished content job no longer needs its whole article budget set aside.
 * Close its hold only from the job's own receipts: no call started → release;
 * every call completed with a reported cost → settle at that cost. A refused
 * call is never assumed free and an uncertain call is unresolved, so either
 * keeps the entire original hold (as does a credit-retry-able failure). */
export async function closeContentWorkHold(ctx: MutationCtx, job: Doc<"jobs">) {
  const cw = job.contentWork;
  if (!cw || !job.siteId || !job.providerSpendReservationId) return "not_applicable" as const;
  const receipt = await ctx.db.get(job.providerSpendReservationId);
  if (!receipt || receipt.siteId !== job.siteId || receipt.purpose !== "content_work") throw new Error("Content work settlement binding changed");
  if (receipt.settledAt !== undefined || receipt.releasedAt !== undefined) return "closed" as const;
  const finished = job.status === "failed" ? cw.failure !== "content_provider_credit_unavailable"
    : ["ready", "publish", "verify", "verified"].includes(cw.stage);
  const calls = cw.providerCalls.filter(c => !c.reservationId || c.reservationId === receipt._id);
  if (!finished || calls.some(c => c.state !== "completed" || !Number.isSafeInteger(c.actualMicroUsd) || c.actualMicroUsd! < 0)) return "held" as const;
  if (calls.length === 0) {
    await releaseSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
      reason: "content_work_closed_before_provider_execution", timestamp: Date.now() });
    return "released" as const;
  }
  const actual = calls.reduce((sum, c) => sum + c.actualMicroUsd!, 0);
  if (actual > receipt.reservedMicroUsd) return "held" as const;
  await settleSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
    actualMicroUsd: actual, reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  return "settled" as const;
}

/** Holds left open by finished work (before closeContentWorkHold covered every
 * finish) are closed from the same job receipts. Own account only, this month. */
export async function closeFinishedContentHolds(ctx: MutationCtx, site: Doc<"sites">) {
  if (!site.userId) return 0;
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const rows = await ctx.db.query("provider_spend_reservations").withIndex("by_user_purpose_created", q =>
    q.eq("userId", site.userId!).eq("purpose", "content_work").gte("createdAt", monthStart.getTime())).take(201);
  let closed = 0;
  for (const row of rows.slice(0, 200)) {
    if (row.settledAt !== undefined || row.releasedAt !== undefined || !row.contentWorkJobId || !row.siteId) continue;
    const job = await ctx.db.get(row.contentWorkJobId);
    if (!job || job.siteId !== row.siteId || job.providerSpendReservationId !== row._id) continue;
    if (["settled", "released"].includes(await closeContentWorkHold(ctx, job))) closed++;
  }
  return closed;
}

/** Close only a durably terminal job. Every possible paid call first appends a
 * started receipt in the same serializable job record. No receipt proves no
 * paid I/O; an incomplete receipt proves uncertainty, never free headroom. */
export async function settleFailedContentWork(ctx: MutationCtx, jobId: Id<"jobs">) {
  const job = await ctx.db.get(jobId), cw = job?.contentWork;
  if (!job || job.status !== "failed" || !cw || !job.siteId || !job.providerSpendReservationId) return;
  const receipt = await ctx.db.get(job.providerSpendReservationId);
  if (!receipt || receipt.siteId !== job.siteId || receipt.purpose !== "content_work") throw new Error("Content work settlement binding changed");
  await closeContentWorkHold(ctx, job);
  await ctx.db.patch(job._id, { contentWork: { ...cw, stage: "failed", failure: cw.failure ??
    (cw.stage === "publish" ? "content_publication_failed_reconciliation_required" : "worker_failed_review_required") } });
  // Work that delivered nothing gives its article back (contentJobUsesAllowance).
  const owner = await ctx.db.get(job.siteId);
  if (owner) await refreshAccountUsage(ctx, owner);
}

/** Called only by the existing exact-worker failure/lease transitions. Recovery
 * changes neither logical candidate/revision counts nor the work envelope.
 * Rejected requests keep their priced ceilings; an unknown result never replays.
 */
export async function recoverContentWork(ctx: MutationCtx, job: Doc<"jobs">, error: string) {
  const cw = job.contentWork!;
  const recoveries = cw.recoveryAttempts ?? 0;
  const uncertain = cw.providerCalls.some(c => c.state === "started");
  const creditUnavailable = cw.providerCalls.some(interruptedCreditCall);
  // The last request was refused as rate limited or overloaded: the service
  // was busy, nothing was written, and it is not a Pentra processing error.
  const lastCall = cw.providerCalls.at(-1);
  const providerBusy = lastCall?.state === "rejected" && ["rate_limit_error", "overloaded_error"].includes(lastCall.rejectionCode ?? "");
  // The API refused the request itself (not research, which is optional and
  // handled where it runs): retrying would send the same refused request.
  const requestRefused = lastCall?.state === "rejected" && !String(lastCall.logicalKey ?? lastCall.key).includes(":web_research:") &&
    isProviderRequestRefusal(lastCall.rejectionStatus, lastCall.rejectionCode);
  const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  const failure = uncertain ? "content_provider_result_ambiguous_reconciliation_required"
    : creditUnavailable ? "content_provider_credit_unavailable"
    : requestRefused ? "content_provider_request_rejected"
    : error === "content_model_response_invalid" ? error
    : /^content_audit_/.test(error) ? error
    : /Content work (budget exhausted|rollover blocked)/.test(error) ? error
    : /Content provider (authority changed|reservation unavailable)|Content checkpoint/.test(error) ? error
    : recoveries >= MAX_CONTENT_RECOVERIES ? (providerBusy ? "content_provider_unavailable" : "content_recovery_attempts_exhausted")
    : used >= cw.budgetMicroUsd ? `Content work budget exhausted: limitMicroUsd=${cw.budgetMicroUsd}; consumedCeilingMicroUsd=${used}; availableMicroUsd=0`
    : undefined;
  const willRetry = failure === undefined;
  const nextAttemptAt = willRetry ? Date.now() + 2 ** recoveries * 60_000 : undefined;
  await ctx.db.patch(job._id, { status: willRetry ? "pending" : "failed",
    workerAttempts: (job.workerAttempts ?? 0) + 1, nextAttemptAt,
    workerToken: undefined, heartbeatAt: undefined, leaseExpiresAt: undefined,
    reservationId: job.articleId ? job.reservationId : undefined,
    contentWork: { ...cw, recoveryAttempts: recoveries + (willRetry ? 1 : 0),
      stage: willRetry ? cw.stage : "failed", failure },
    error: failure ?? `Content recovery ${recoveries + 1}/${MAX_CONTENT_RECOVERIES} scheduled: ${error}`,
    updatedAt: Date.now() });
  if (willRetry && cw.ownerRequest) await ctx.scheduler.runAt(nextAttemptAt!, internal.actions.pipeline.processNextJob, { siteId: job.siteId!, jobId: job._id });
  else if (willRetry) await ctx.scheduler.runAt(nextAttemptAt!, internal.autopilot.dispatchSiteFollowup,
    { siteId: job.siteId!, trigger: "job_retry", reason: `content_recovery_${recoveries + 1}` });
  else await settleFailedContentWork(ctx, job._id);
  // An internal processing failure no longer pauses the site (P115): the slot
  // is skipped or replaced on Autopilot, content health reports it, and the
  // owner's own pause stays the only pause.
  return { updated: true, willRetry, nextAttemptAt };
}

export const beginProviderCall = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), requestHash: v.optional(v.string()), ceilingMicroUsd: v.number(),
    semanticClarificationOf: v.optional(v.object({ key: v.string(), requestHash: v.string(), resultHash: v.string() })) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    let cw = job?.contentWork;
    if (cw?.operation) throw new Error("Owner correction/restoration is provider-free; no paid work is authorized");
    if (!job || !cw || !site || job.workerToken !== args.workerToken || job.status !== "running" ||
      (job.leaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) ||
      ((site.approvalRequired === true || site.contentSchedule?.ownerReviewedOnly) && !cw.ownerRequest) || !(await contentEntitlementAuthorized(ctx, site)) || !contentConnectionComplete(site) || confirmedContentProfileHash(site) !== cw.profileHash ||
      contentConnectionHash(site) !== cw.connectionHash) throw new Error("Content provider authority changed");
    await authorizedWorkPage(ctx, site, job);
    const previousCalls = cw.providerCalls.filter(c => (c.logicalKey ?? c.key) === args.key);
    if (args.semanticClarificationOf || args.key.includes(SEMANTIC_AUDIT_SUFFIX)) {
      const lineage = args.semanticClarificationOf, original = cw.providerCalls.find(c => c.key === lineage?.key);
      const originalResult = await providerCallResult(ctx, job._id, original);
      const expectedBase = `${cw.replacements}:${cw.revisions}:review:audit_final_article`;
      if (!lineage || !original || (original.logicalKey ?? original.key) !== expectedBase || args.key !== expectedBase + SEMANTIC_AUDIT_SUFFIX ||
        original.state !== "completed" || !Number.isSafeInteger(original.actualMicroUsd) || !original.requestHash ||
        original.requestHash !== lineage.requestHash || auditResultHash(originalResult) !== lineage.resultHash ||
        // P101: or it asserts a repetition; the worker checked the exact article repeats nothing.
        !clarifiableContentAudit(originalResult)) throw new Error("content_audit_original_checkpoint_changed");
      if (previousCalls.some(c => JSON.stringify(c.semanticClarificationOf) !== JSON.stringify(lineage))) throw new Error("content_audit_clarification_lineage_changed");
      if (previousCalls.some(c => c.state !== "completed")) throw new Error("content_audit_clarification_already_attempted");
    }
    if (previousCalls.some(c => c.requestHash !== args.requestHash)) throw new Error("Content checkpoint request changed; reconcile the persisted result");
    const completed = previousCalls.find(c => c.state === "completed");
    if (completed) {
      const cached = await providerCallResult(ctx, job._id, completed);
      if (cached === undefined) throw new Error("Content checkpoint response unavailable; no paid replay");
      return { kind: "cached" as const, result: cached };
    }
    if (cw.providerCalls.some(interruptedCreditCall)) {
      throw new Error("Content provider credit unavailable; reconcile the retained attempt before new execution");
    }
    if (previousCalls.some(c => c.state === "started")) throw new Error("Content provider response already attempted; reconcile before replay");
    if (previousCalls.length > MAX_CONTENT_RECOVERIES) throw new Error("Content checkpoint retry limit exhausted");
    if (!(await pricingConfiguration(ctx, site, job))) throw new Error("Content provider authority changed: pricing scope unavailable");
    for (const c of cw.providerCalls) if (c.creditRecovery?.requestedAt !== undefined) await retainedCreditEvidence(ctx, job, c);
    const validation = await contentValidationBinding(ctx, site, Date.now(), job);
    if (validation && validation.state !== "active") throw new Error(`Content provider authority changed: validation ${validation.state}`);
    let receipt = job.providerSpendReservationId ? await ctx.db.get(job.providerSpendReservationId) : null;
    if (!receipt || receipt.siteId !== site._id || receipt.userId !== site.userId || receipt.purpose !== "content_work" ||
      receipt.releasedAt !== undefined || receipt.settledAt !== undefined) throw new Error("Content provider reservation unavailable");
    const priorConsumed = cw.providerCalls.filter(c => c.reservationId && c.reservationId !== receipt!._id)
      .reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (receipt.reservedMicroUsd !== cw.budgetMicroUsd - priorConsumed ||
      !contentSlotTriggerMatches(receipt.trigger, cw)) {
      throw new Error("Content provider reservation unavailable: work envelope binding changed");
    }
    const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (!Number.isSafeInteger(args.ceilingMicroUsd) || args.ceilingMicroUsd <= 0 || used + args.ceilingMicroUsd > cw.budgetMicroUsd || cw.providerCalls.length >= 20) {
      throw new Error(`Content work budget exhausted: limitMicroUsd=${cw.budgetMicroUsd}; consumedCeilingMicroUsd=${used}; requestedMicroUsd=${args.ceilingMicroUsd}; availableMicroUsd=${Math.max(0, cw.budgetMicroUsd - used)}; calls=${cw.providerCalls.length}/20`);
    }
    const retainedRunCreditHold = validation?.run.independentFunding && cw.providerCalls.some(c =>
      c.state === "rejected" && c.rejectionCode === "provider_credit_unavailable" && c.creditRecovery?.requestedAt !== undefined);
    if (!retainedRunCreditHold && new Date(receipt.createdAt).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
      if (cw.providerCalls.some(c => c.state !== "completed") || (cw.priorReservationIds?.length ?? 0) >= MAX_CONTENT_RECOVERIES) {
        throw new Error("Content work rollover blocked: uncertain prior cost or renewal limit; original reservation retained");
      }
      const oldId = receipt._id;
      const oldCalls = cw.providerCalls.filter(c => !c.reservationId || c.reservationId === oldId);
      if (oldCalls.length) await settleSharedProviderReservation(ctx, { reservationId: oldId, siteId: site._id, purpose: "content_work",
        actualMicroUsd: oldCalls.reduce((sum, c) => sum + c.actualMicroUsd!, 0), reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
      else await releaseSharedProviderReservation(ctx, { reservationId: oldId, siteId: site._id, purpose: "content_work",
        reason: "content_work_closed_before_provider_execution", timestamp: Date.now() });
      const replacement = await reserveSharedProviderBudget(ctx, { siteId: site._id, userId: site.userId!, purpose: "content_work",
        contentWorkJobId: job._id,
        trigger: `content_slot:${cw.deadlineAt}:remaining_window:${Date.now()}`, reservedMicroUsd: cw.budgetMicroUsd - used, timestamp: Date.now() });
      if (!replacement.ok) throw new Error(`Content work rollover blocked: ${replacement.reason}; requestedMicroUsd=${cw.budgetMicroUsd - used}; consumedMicroUsd=${replacement.reservedMicroUsd}; ceilingMicroUsd=${replacement.ceilingMicroUsd}`);
      receipt = (await ctx.db.get(replacement.reservationId))!;
      cw = { ...cw, priorReservationIds: [...(cw.priorReservationIds ?? []), oldId],
        providerCalls: cw.providerCalls.map(c => ({ ...c, reservationId: c.reservationId ?? oldId })) };
      await ctx.db.patch(job._id, { providerSpendReservationId: receipt._id });
    }
    const currentUsed = cw.providerCalls.filter(c => !c.reservationId || c.reservationId === receipt!._id)
      .reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (currentUsed + args.ceilingMicroUsd > receipt.reservedMicroUsd) throw new Error(`Content work budget exhausted for current reservation: limitMicroUsd=${receipt.reservedMicroUsd}; consumedCeilingMicroUsd=${currentUsed}; requestedMicroUsd=${args.ceilingMicroUsd}`);
    const key = `${args.key}:${previousCalls.length}`;
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls: [...cw.providerCalls, { key, logicalKey: args.key, requestHash: args.requestHash,
      ...(args.semanticClarificationOf ? { semanticClarificationOf: args.semanticClarificationOf } : {}),
      reservationId: receipt._id, ceilingMicroUsd: args.ceilingMicroUsd, state: "started", rejectionTrackingVersion: 1 }] } });
    return { kind: "started" as const, key };
  },
});
export const completeProviderCall = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), actualMicroUsd: v.number(), result: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), cw = job?.contentWork;
    const call = cw?.providerCalls.find(c => c.key === args.key);
    if (!job || !cw || !call || job.workerToken !== args.workerToken || (job.leaseExpiresAt ?? 0) <= Date.now() ||
      !Number.isSafeInteger(args.actualMicroUsd) || args.actualMicroUsd < 0 || args.actualMicroUsd > call.ceilingMicroUsd) throw new Error("Content provider receipt invalid; reserved ceiling retained");
    const site = job.siteId ? await ctx.db.get(job.siteId) : null;
    if (!site) throw new Error("Content settlement site unavailable");
    // A stop cannot erase an in-flight cost. Validate immutable lineage, but
    // permit its original worker to record the result after expiry/stop.
    await contentValidationBinding(ctx, site, Date.now(), job);
    if (call.state === "rejected" || (call.state === "completed" && (call.actualMicroUsd !== args.actualMicroUsd ||
      JSON.stringify(await providerCallResult(ctx, job._id, call)) !== JSON.stringify(args.result)))) throw new Error("Content provider settlement conflict");
    // The same receipt again (a worker retry after its write) changes nothing.
    if (call.state === "completed") return;
    // P118: the result is stored in its own row; the job keeps its reference
    // and hash, so every reader of the job no longer loads it.
    const serialized = JSON.stringify(args.result ?? null);
    if (new TextEncoder().encode(serialized).length > 700_000) throw new Error("Content checkpoint storage bound exceeded; reserved ceiling retained");
    const resultHash = sha256Hex(serialized);
    const resultRef = args.result === undefined ? undefined
      : await ctx.db.insert("content_call_results", { siteId: site._id, jobId: job._id, key: args.key, result: args.result, resultHash, createdAt: Date.now() });
    const providerCalls = cw.providerCalls.map(c => c.key === args.key ? { ...c, state: "completed" as const, actualMicroUsd: args.actualMicroUsd,
      ...(resultRef ? { resultRef, resultHash } : {}) } : c);
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls } });
  },
});

export const recordProviderRejection = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), status: v.number(), code: v.string(), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), cw = job?.contentWork, call = cw?.providerCalls.find(c => c.key === args.key);
    const known = (args.status === 400 && args.code === "provider_credit_unavailable") ||
      (args.status === 429 && args.code === "rate_limit_error") || ([503, 529].includes(args.status) && args.code === "overloaded_error") ||
      // A web research request the API rejects outright (e.g. search not enabled for the account).
      ([400, 403].includes(args.status) && ["invalid_request_error", "permission_error"].includes(args.code) && args.key.includes(":web_research:")) ||
      // Any request the API refused before a model ran, with the provider's request id (see isProviderRequestRefusal).
      (isProviderRequestRefusal(args.status, args.code) && validProviderRequestId(args.requestId));
    if (!known || (args.code === "provider_credit_unavailable" && !validProviderRequestId(args.requestId)) ||
      !job || job.status !== "running" || job.workerToken !== args.workerToken || (job.leaseExpiresAt ?? 0) <= Date.now() ||
      !cw || !call || call.state === "completed") throw new Error("Content rejection receipt invalid; original ceiling retained");
    if (call.state === "rejected") {
      if (call.rejectionStatus !== args.status || call.rejectionCode !== args.code || call.rejectionRequestId !== args.requestId) throw new Error("Content rejection receipt changed");
      return;
    }
    if (args.code === "provider_credit_unavailable" && !["prepare", "review"].includes(cw.stage)) throw new Error("Content rejection stage invalid");
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls: cw.providerCalls.map(c => c.key === args.key
      ? { ...c, state: "rejected" as const, rejectionStatus: args.status, rejectionCode: args.code,
        ...(args.code === "provider_credit_unavailable" ? { rejectionRequestId: args.requestId, rejectionRecordedAt: Date.now(),
          rejectionStage: cw.stage as "prepare" | "review" }
          : isProviderRequestRefusal(args.status, args.code) && args.requestId ? { rejectionRequestId: args.requestId } : {}) } : c) } });
  },
});
