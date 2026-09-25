import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { contentIntentConflicts, evaluateTopicBusinessFit, tenantDiscoveryAnchors, tenantTopicBusinessSignals, isSealedReady } from "./lib/autopilotBuffer";
import { publicationArtifactHash, publicationDeliveryConfig, sha256Hex } from "./lib/publicationArtifact";
import { legacyCreditRefusal, validProviderRequestId } from "./lib/contentProviderRefusal";
import { siteCanonicalDomain, siteCanonicalDomainRevision, takeCurrentDomainTopics, contentAnalysisMatchesCurrentDomain, pageMatchesCurrentDomain, articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { resolvePlanFromFeatures, cadenceFitsOperationalLimit, targetCadenceOptions } from "./planLimits";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { inspectSharedProviderBudget, reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "./lib/providerSpendReservation";
import { contentValidationBinding } from "./lib/providerBudgetAuthorization";
import { planCheckpointTopicExecutionLocked } from "./lib/planCandidateCheckpoint";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import type { CadenceScheduleResult } from "./lib/autopilotRunOutcome";
import { liveAutopilotReadiness, publicationDestinationBlockers } from "./lib/autopilotReadiness";
import { PUBLISHED_REVISION_LEASE_MS } from "./lib/publishedRevision";
import { PUBLICATION_LEASE_MS } from "./lib/publicationLease";
import { contentConnectionHash, confirmedContentProfileHash, contentConnectionComplete, contentConsentToken, pasteDestination } from "./lib/contentSelection";
import { contentFunding, contentIssue } from "./lib/contentCustomer";
import { assertSafeImprovement } from "./lib/contentSelection";
import { authorizedWorkPage, chooseImprovement, enrollVerifiedCreation, selectionConnection } from "./selectedPages";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { archiveRetiredContentArtifact, quarantineUnpublishedArticle, createOwnerEditedCheckpoint, sealAcceptedReviewNotes } from "./articles";
import { AUTOPILOT_ACCEPTANCE } from "./lib/articleQuality";
import { closeRetiredContentAccounting, closeVerifiedContentWake } from "./jobs";
import { auditResultHash, contradictoryContentAudit, inconsistentAuditFeedback, internalContentProcessingError, semanticAuditCeiling, SEMANTIC_AUDIT_SUFFIX } from "./lib/contentAudit";
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
async function ownerDraftAllowance(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, validationScoped: boolean) {
  if (validationScoped || !site.userId) return null;
  const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
  const tier = resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier;
  const now = new Date(), monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let used = 0;
  for (const owned of await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", site.userId!)).take(LIMIT)) {
    const siteJobs = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q =>
      q.eq("siteId", owned._id).gte("contentWork.deadlineAt", monthStart)).take(LIMIT);
    used += siteJobs.filter(j => j.contentWork?.ownerRequest && !j.contentWork.ownerRequest.sourceArticleId &&
      j.contentWork.ownerRequest.requestedAt >= monthStart).length;
  }
  return { tier, used, limit: OWNER_DRAFTS_PER_MONTH[tier] as number };
}
const LIMIT = 1000;
/** Terminal outcomes an Autopilot site moves past without the owner: nothing was
 * published and no external write is uncertain. The failed job keeps its missed
 * deadline, attempts and spending; the schedule continues with the next slot. */
const AUTOPILOT_SKIPPABLE_FAILURES = new Set(["bounded_content_quality_exhausted", "content_model_response_invalid", "candidate_rejected_before_draft"]);
/** Autopilot keeps the cadence: a failed slot gets one fresh article (a new
 * topic, a new job and its own reservation) when there is still this much time
 * before the slot. The failed job stays on record; nothing is reset. */
const AUTOPILOT_REPLACEMENT_LEAD_MS = 60 * 60_000;
function autopilotReplaceable(job: Doc<"jobs">) {
  const cw = job.contentWork;
  return Boolean(cw && cw.stage === "failed" && cw.intent === "create" && !cw.ownerRequest && cw.retiredAt === undefined &&
    !cw.replacesJobId && AUTOPILOT_SKIPPABLE_FAILURES.has(cw.failure ?? ""));
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
  const finished = work.filter(j => j.contentWork!.intent === "create" && ["verified", "failed"].includes(j.contentWork!.stage))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  return finished.filter(j => j.contentWork!.stage === "failed").length < 2;
}
const TOPIC_REPLENISH_INTERVAL_MS = 3 * 86_400_000, TOPIC_REPLENISH_BUDGET_MICRO_USD = 1_000_000;
/** Research that found no new keyword is not repeated for a week. */
const TOPIC_REPLENISH_EMPTY_BACKOFF_MS = 7 * 86_400_000;
/** An Autopilot article waits for fresh keyword research only while its slot is at least this far away. */
const TOPIC_RESEARCH_WAIT_MARGIN_MS = 90 * 60_000;
/** Autopilot writes for searched keywords: when none is left, research new
 * ones for the confirmed business (bounded spend, at most every few days). */
async function startTopicResearchIfDue(ctx: MutationCtx, site: Doc<"sites">, articleBudgetMicroUsd: number) {
  const schedule = site.contentSchedule;
  if (!schedule?.autopilotSelectedAt || !site.userId) return false;
  const interval = schedule.topicsReplenishAdded === 0 ? TOPIC_REPLENISH_EMPTY_BACKOFF_MS : TOPIC_REPLENISH_INTERVAL_MS;
  if (Date.now() - (schedule.topicsReplenishedAt ?? 0) < interval) return false;
  const request = { siteId: site._id, userId: site.userId, purpose: "topic_plan" as const, trigger: `autopilot_topics:${Math.floor(Date.now() / TOPIC_REPLENISH_INTERVAL_MS)}`,
    reservedMicroUsd: TOPIC_REPLENISH_BUDGET_MICRO_USD, timestamp: Date.now() };
  // Research only when the account can still afford the article after it: the cadence comes first.
  const room = await inspectSharedProviderBudget(ctx, { ...request, reservedMicroUsd: TOPIC_REPLENISH_BUDGET_MICRO_USD + articleBudgetMicroUsd });
  if (!room.ok) return false;
  const reserved = await reserveSharedProviderBudget(ctx, request);
  // A refused reservation spends nothing; try again on the next check.
  if (!reserved.ok) return false;
  const next = { ...schedule, topicsReplenishedAt: Date.now() };
  delete next.topicsReplenishAdded;
  await ctx.db.patch(site._id, { contentSchedule: next, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.growthTopics.replenish, { siteId: site._id, reservationId: reserved.reservationId });
  return true;
}
/** New articles started this UTC month across the account's sites: automatic
 * creations plus new owner drafts (edits of an existing draft do not count). */
async function accountArticlesThisMonth(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  const now = new Date(), monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let used = 0;
  for (const owned of await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", site.userId!)).take(LIMIT)) {
    const siteJobs = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q =>
      q.eq("siteId", owned._id).gte("contentWork.deadlineAt", monthStart)).take(LIMIT);
    // A failed Autopilot slot that got a replacement counts once (the replacement).
    const replaced = new Set(siteJobs.map(j => j.contentWork?.replacesJobId).filter(Boolean));
    used += siteJobs.filter(j => j.contentWork && j.contentWork.intent === "create" && j.createdAt >= monthStart && !replaced.has(j._id) &&
      (j.contentWork.ownerRequest ? !j.contentWork.ownerRequest.sourceArticleId : j.contentWork.retiredAt === undefined)).length;
  }
  return { used, nextMonthStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) };
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
    [pub.inputMicroUsdPerToken, pub.outputMicroUsdPerToken, pub.budgetMicroUsd].every(n => Number.isSafeInteger(n) && n > 0)
    ? { model: pub.model as string, inputMicroUsdPerToken: pub.inputMicroUsdPerToken as number,
        outputMicroUsdPerToken: pub.outputMicroUsdPerToken as number, budgetMicroUsd: pub.budgetMicroUsd as number,
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
    ![p.inputMicroUsdPerToken, p.outputMicroUsdPerToken, p.budgetMicroUsd].every(n => Number.isSafeInteger(n) && n > 0)) return null;
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
      outputMicroUsdPerToken: p.outputMicroUsdPerToken as number }),
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
  if (!pasteDestination(site)) selectionConnection(site);
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
      cw.providerCalls.some(c => c !== call && c.state === "started") || call.actualMicroUsd !== undefined || call.result !== undefined ||
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
    if (!call || call.key !== args.callKey || (call.logicalKey ?? call.key) !== baseKey ||
      call.requestHash !== args.requestHash || !/^[a-f0-9]{64}$/.test(args.requestHash) ||
      call.state !== "completed" || !contradictoryContentAudit(call.result) || auditResultHash(call.result) !== args.resultHash ||
      cw.providerCalls.some(c => c.semanticClarificationOf || c.key.includes(SEMANTIC_AUDIT_SUFFIX) || c.state === "started" ||
        (c.state === "completed" && (!Number.isSafeInteger(c.actualMicroUsd) || c.actualMicroUsd! < 0 || c.result === undefined)) ||
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
    const updated = (await ctx.db.get(site._id))!, token = contentConsentToken(updated);
    const result = await confirmChangedSetup(ctx, updated, token);
    await followUpEditedFacts(ctx, updated, token, result, 1);
    return result;
  } });

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
    if (review.pristineLease) {
      await closePristineSetupLease(ctx, site);
    }
    await ctx.db.patch(site._id, { contentSchedule: { ...schedule, profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      active: false, paused: Boolean(schedule.ownerReviewedOnly), autopublishConsentAt: schedule.ownerReviewedOnly ? undefined : Date.now() }, autopilotEnabled: !schedule.ownerReviewedOnly, autopilotRolloutMode: "warm", approvalRequired: Boolean(schedule.ownerReviewedOnly),
      ...(review.pristineLease ? { publicationLeaseOwner: undefined, publicationLeaseExpiresAt: undefined } : {}), updatedAt: Date.now() });
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
      !site.contentSetupRequestedAt || site.contentSchedule || !["github", "wordpress", "manual"].includes(site.publishMethod ?? ""))) {
      throw new Error("Owner-reviewed setup is for a new GitHub or WordPress connection; existing contracts remain unchanged");
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
      throw new Error("Connect a supported GitHub or conditional WordPress destination first");
    }
    // Other platforms (paste your own) are Review first only: Pentra never publishes there.
    if (pasteDestination(site) && !args.ownerReviewedOnly) throw new Error("Autopilot needs a WordPress or GitHub connection. Choose Review first.");
    if (!pasteDestination(site)) selectionConnection(site);
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
    if (!args.ownerReviewedOnly) await wake(ctx, site._id);
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
      if (pasteDestination(site)) throw new ConvexError("Autopilot needs a WordPress or GitHub connection. Connect one in website settings first.");
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
    if (site.cadencePerWeek === args.cadencePerWeek) return { changed: false };
    await ctx.db.patch(site._id, { cadencePerWeek: args.cadencePerWeek, updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { changed: true };
  } });

export const readiness = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || identity?.subject !== site.userId) throw new Error("Not authorized");
    const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", siteId)).take(LIMIT + 1);
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
    const publishedRows = (await ctx.db.query("articles").withIndex("by_site_status_created", q => q.eq("siteId", siteId).eq("status", "published"))
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
        const article = await ctx.db.get(row.articleId);
        if (article?.siteId === siteId) pastedLive.set(row.articleId, { articleId: row.articleId, title: article.title ?? article.slug ?? "Article",
          publishedAt: row.checkedAt ?? row.requestedAt, url: row.url });
      }
    }
    // On sites set up with Autopilot, a draft the reviewer would not pass is
    // skipped (the schedule continues); it needs no action from the owner.
    const parkedByAutopilot = (j: Doc<"jobs">) => Boolean(s?.autopilotSelectedAt && !j.contentWork?.ownerRequest && j.contentWork?.intent === "create" &&
      j.contentWork.stage === "failed" && AUTOPILOT_SKIPPABLE_FAILURES.has(j.contentWork.failure ?? ""));
    // A parked draft whose topic the owner has since published (usually as an
    // edited version) is resolved for the owner; the miss itself stays recorded.
    const supersededJobs = new Set<string>();
    for (const j of jobs.filter(j => j.contentWork?.stage === "failed" && j.articleId && !j.contentWork.ownerRequest).slice(0, 20)) {
      const draft = await ctx.db.get(j.articleId!);
      if (draft && draft.status !== "published" && draft.topicId && publishedTopics.has(draft.topicId)) supersededJobs.add(j._id);
    }
    // Titles for work still on its way, so the owner sees what is coming, not "New article".
    const upcomingTitles = new Map<string, string>();
    for (const j of jobs.filter(j => j.contentWork && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined &&
      !["verified", "failed"].includes(j.contentWork.stage)).slice(0, 10)) {
      const article = j.articleId ? await ctx.db.get(j.articleId) : null;
      const topicId = (j.payload as { topicId?: Id<"topic_clusters"> } | undefined)?.topicId;
      const topic = !article?.title && topicId ? await ctx.db.get(topicId) : null;
      const title = article?.siteId === siteId ? article.title : topic?.siteId === siteId ? topic.label : undefined;
      if (title) upcomingTitles.set(j._id, title);
    }
    return { siteId, setupPending: Boolean(site.contentSetupRequestedAt && !site.serviceMode), serviceMode: site.serviceMode ?? "legacy_articles", reviewToken: contentConsentToken(site),
      profile: { name: site.siteName ?? site.domain, summary: site.siteSummary ?? "", audience: site.targetAudienceSummary ?? "", productUsage: site.productUsage ?? "", offerings: site.keyFeatures ?? [], questions: site.painPoints ?? [] },
      destination: { kind: site.publishMethod ?? "manual", domain: site.domain, repository: site.publishMethod === "github" ? `${site.repoOwner ?? ""}/${site.repoName ?? ""}` : null,
        branch: site.repoDefaultBranch ?? null, contentDirectory: directory, verified },
      entitlement: await contentEntitlementAuthorized(ctx, site), enabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
      bindingCurrent,
      reconciliation: { needed: reconciliation.needed, staleItems: reconciliation.stale.length, issues: reconciliation.issues },
      schedule: s ? { ownerReviewedOnly: Boolean(s.ownerReviewedOnly), autopilotSelected: Boolean(s.autopilotSelectedAt), active: s.active, paused: s.paused, nextDeadlineAt: s.nextDeadlineAt, intervalMs: s.intervalMs, timezone: s.timezone ?? "UTC" } : null,
      funding: { ...await contentFunding(ctx, site, pricing?.budgetMicroUsd),
        pricingScope: !pricing ? "unavailable" as const : pricing.validationAuthorizationId ? "validation_run" as const : "ordinary" as const },
      plan: await accountPlan(ctx, site),
      autopilot: { selectable: Boolean(site.contentSetupRequestedAt), on: Boolean(s && !s.ownerReviewedOnly && site.autopilotEnabled && !site.approvalRequired),
        reviewAvailable: ["github", "wordpress"].includes(site.publishMethod ?? "") || pasteDestination(site),
        autopilotAvailable: !pasteDestination(site),
        adoptable: Boolean(site.serviceMode === "growth_first" && s && !s.autopilotSelectedAt && !s.ownerReviewedOnly) },
      ownerDraft: { maximumMicroUsd: pricing?.budgetMicroUsd ?? null,
        allowance: pricing ? await ownerDraftAllowance(ctx, site, Boolean(pricing.validationAuthorizationId)) : null,
        latest: jobs.filter(j => j.contentWork?.ownerRequest).sort((a, b) => b.createdAt - a.createdAt).slice(0, 1).map(j => ({
          jobId: j._id, articleId: j.articleId, stage: j.contentWork!.stage, issue: contentIssue(j.contentWork!.failure),
        }))[0] ?? null },
      results: { live: liveSummaries.length + pastedLive.size, planUsedThisMonth: site.userId ? (await accountArticlesThisMonth(ctx, site)).used : 0,
        liveThisMonth: liveSummaries.filter(row => (row.publishedAt ?? 0) >= monthStart).length + [...pastedLive.values()].filter(p => p.publishedAt >= monthStart).length },
      published: [...publishedRows.map(a => ({ articleId: a._id, title: a.title ?? a.slug ?? "Article", publishedAt: a.publishedAt ?? null,
          verified: a.publicUrlStatus === "verified", url: a.publicUrlStatus === "verified" && a.publicUrl?.startsWith("https://") ? a.publicUrl : null })),
        ...[...pastedLive.values()].map(p => ({ ...p, verified: true }))]
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 5),
      complete: jobs.length <= LIMIT, ready: jobs.filter(j => j.contentWork?.stage === "ready" && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined &&
        j.contentWork.profileHash === confirmedContentProfileHash(site) && j.contentWork.connectionHash === s?.connectionHash && bindingCurrent).length,
      work: jobs.filter(j => j.contentWork && !j.contentWork.ownerRequest).map(j => {
        const lastReview = j.contentWork!.providerCalls.at(-1);
        // This repaired failure can be rechecked through ordinary owner Resume.
        // The mutation still verifies lineage, unchanged source and no writes;
        // exposing the control grants no execution or spending authority.
        const rejectedReview = j.status === "failed" && j.contentWork!.failure === "content_audit_clarification_inconsistent" &&
          lastReview?.state === "completed" && contradictoryContentAudit(lastReview.result);
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
        failure: supersededJobs.has(j._id) ? "Replaced by your edited version of this article, which is now live. The missed slot stays on record."
          : parkedByAutopilot(j) ? j.contentWork!.failure === "content_model_response_invalid"
            ? "Pentra's writing service returned an incomplete response for this article, so nothing was published. Your schedule continued with the next article."
            : "Pentra held this draft back because its fact check wasn't confident enough. It won't be published; your schedule continued with the next article."
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
  // Reclassify only a completed review, never retry its provider call. The
  // ordinary revision/replacement limits and all financial receipts survive.
  if (job.status !== "failed" || cw.stage !== "failed" || cw.operation || cw.retiredAt !== undefined ||
    job.siteId !== site._id || cw.profileHash !== confirmedContentProfileHash(site) || cw.connectionHash !== contentConnectionHash(site) ||
    job.workerToken || job.leaseExpiresAt || job.publicationAttempts || cw.approvedArtifactHash || cw.publishedAt || cw.verifiedAt ||
    !call || !lineage || !original || original.state !== "completed" || call.state !== "completed" ||
    (original.logicalKey ?? original.key) !== `${cw.replacements}:${cw.revisions}:review:audit_final_article` ||
    (call.logicalKey ?? call.key) !== `${original.logicalKey ?? original.key}${SEMANTIC_AUDIT_SUFFIX}` ||
    original.requestHash !== lineage.requestHash || auditResultHash(original.result) !== lineage.resultHash ||
    !contradictoryContentAudit(original.result) || !contradictoryContentAudit(call.result) ||
    cw.providerCalls.some(c => c.state === "started" || (c.state === "completed" && (!Number.isSafeInteger(c.actualMicroUsd) || c.actualMicroUsd! < 0))) ||
    !article || article.siteId !== site._id || article.updatedAt > job.updatedAt || article.status === "published" ||
    article.publicationAttemptedAt || article.publicationReceipt || article.publicationLeaseOwner || article.publicationOutcomeUnverifiedAt || article.publishedContentHash) {
    throw new Error("Retained review evidence changed; reconciliation requires inspection");
  }
  await ctx.db.patch(job._id, { status: "done", error: undefined, nextAttemptAt: undefined,
    result: { qualityQuarantined: true, previousFailure: cw.failure, previousUpdatedAt: job.updatedAt,
      rejectedReviewKey: call.key, rejectedReviewHash: auditResultHash(call.result) }, updatedAt: Date.now() });
  await contentWorkCompleted(ctx, job, inconsistentAuditFeedback(call.result));
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

async function chooseTopic(ctx: MutationCtx, site: Doc<"sites">, preferredId?: Id<"topic_clusters">,
  excludedIntents: { primaryKeyword: string; label?: string }[] = [], options: { demandOnly?: boolean } = {}) {
  const topics = await takeCurrentDomainTopics(ctx, site, LIMIT + 1);
  if (topics.length > LIMIT) throw new Error("Topic inventory is incomplete");
  const signals = tenantTopicBusinessSignals(site);
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT + 1);
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
  const planned = topics.filter(t => ["planned", "pending"].includes(t.status ?? "planned") && fit(t) &&
    !planCheckpointTopicExecutionLocked(t) && !terminalContentFeasibility(t.contentFeasibilityStatus) &&
    ![...covered, ...pageCoverage, ...excludedIntents].some(c => contentIntentConflicts(t, c)));
  // Keywords people measurably search for come first; within each group the
  // stored priority orders the work. Absence remains absent in storage.
  const searched = (t: Doc<"topic_clusters">) => (t.searchVolume ?? 0) > 0;
  planned.sort((a, b) => Number(searched(b)) - Number(searched(a)) || (b.priority ?? 0) - (a.priority ?? 0));
  if (preferredId) return planned.find(t => t._id === preferredId) ?? null;
  if (options.demandOnly) return planned.find(searched) ?? null;
  if (planned[0]) return planned[0];
  const anchors = tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? []),
    ...(site.painPoints ?? []), site.productUsage], 40);
  for (const primaryKeyword of anchors) {
    const proposal = { primaryKeyword, label: `A practical guide to ${primaryKeyword}` };
    if (!fit(proposal) || [...topics, ...pageCoverage, ...excludedIntents].some(t => contentIntentConflicts(proposal, t))) continue;
    const id = await ctx.db.insert("topic_clusters", { siteId: site._id, ...proposal,
      planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
      secondaryKeywords: [], intent: "informational", priority: 1, status: "planned",
      notes: "Confirmed first-party reader question. Search forecasts are unknown. Use supported business facts and conditional guidance; never invent experience or external claims.",
      createdAt: Date.now(), updatedAt: Date.now() });
    return (await ctx.db.get(id))!;
  }
  return null;
}

/** An explicit owner order uses the same priced worker, not the automatic
 * schedule's failed slot. Its approval is for drafting only, never publishing. */
export const requestDraft = mutation({
  args: { siteId: v.id("sites"), reviewToken: v.string(), requestKey: v.string(),
    maximumMicroUsd: v.number(), topicId: v.optional(v.id("topic_clusters")),
    edit: v.optional(v.object({ articleId: v.id("articles"), artifactHash: v.string(), markdown: v.string(),
      metadata: v.optional(v.object({ title: v.string(), metaTitle: v.string(), metaDescription: v.string() })) })) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), schedule = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !schedule || !(["github", "wordpress"].includes(site.publishMethod ?? "") || pasteDestination(site)) ||
      !contentConnectionComplete(site) || (!pasteDestination(site) && !publisherDestinationReceiptVerified({ site })) ||
      !await contentEntitlementAuthorized(ctx, site)) throw new ConvexError("Confirm your business, website connection and billing in Settings first");
    if (args.reviewToken !== contentConsentToken(site) || schedule.profileHash !== confirmedContentProfileHash(site) ||
      schedule.connectionHash !== contentConnectionHash(site)) throw new ConvexError("Business or destination changed; review Settings first");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestKey)) throw new ConvexError("Invalid draft request reference");
    const jobs = await jobsForSite(ctx, site._id);
    const same = jobs.find(j => j.contentWork?.ownerRequest?.userId === site.userId && j.contentWork?.ownerRequest?.key === args.requestKey);
    if (same) return { jobId: same._id, created: false };
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
    await ctx.db.patch(failed._id, { status: "pending", articleId: undefined, reservationId: undefined,
      workerAttempts: (failed.workerAttempts ?? 0) + 1,
      payload: { ...(cw.ownerRequest ? { manual: true } : {}), topicId: replacement._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { ...cw, intent: "create", targetPageId: undefined, baseRevision: undefined, permissionVersion: undefined,
        opportunity: undefined, revisionId: undefined, editTarget: undefined, stage: "prepare", replacements: 1,
        discardedArticleIds: [...cw.discardedArticleIds, failed.articleId] }, updatedAt: Date.now() });
    await ctx.db.patch(replacement._id, { status: "queued", updatedAt: Date.now() });
    return { scheduled: 1, mode: "buffer_fill", activeJobId: failed._id };
  }
  await ctx.db.patch(failed._id, { status: "failed", contentWork: { ...cw, stage: "failed", failure: "bounded_content_quality_exhausted" }, updatedAt: Date.now() });
  await settleFailedContentWork(ctx, failed._id);
  return { scheduled: 0, mode: "content_quality_exhausted" };
}

export const advanceOwnerDraft = internalMutation({ args: { jobId: v.id("jobs") }, handler: async (ctx, { jobId }) => {
  const job = await ctx.db.get(jobId), site = job?.siteId ? await ctx.db.get(job.siteId) : null;
  if (!job?.contentWork?.ownerRequest || !site || !jobAuthorizedForExecution(site, job) || job.status !== "done" ||
    job.contentWork.stage !== "review_failed") return;
  const result = await reviseFailedWork(ctx, site, job);
  if (result.scheduled) await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, { siteId: site._id, jobId });
} });

/** Seeds and locale for Autopilot keyword research (no secrets). */
export const growthTopicContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return null;
  const seeds = tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? []), ...(site.painPoints ?? []),
    site.productUsage, site.niche, site.blogTheme], 12);
  return { domain: site.domain, language: site.language ?? "en", targetCountry: site.targetCountry ?? null, seeds };
} });

/** Add researched keywords as planned topics: business-fit only, never a
 * duplicate of an existing topic, page or article intent. */
export const addResearchedTopics = internalMutation({ args: { siteId: v.id("sites"),
  keywords: v.array(v.object({ keyword: v.string(), searchVolume: v.number(), difficulty: v.number(), difficultyMeasured: v.boolean() })) },
  handler: async (ctx, { siteId, keywords }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.serviceMode !== "growth_first" || !site.contentSchedule?.autopilotSelectedAt) return { added: 0 };
    const topics = await takeCurrentDomainTopics(ctx, site, LIMIT + 1);
    if (topics.length > LIMIT) return { added: 0 };
    const signals = tenantTopicBusinessSignals(site);
    const taken: { primaryKeyword: string }[] = [...topics];
    let added = 0;
    for (const k of [...keywords].sort((a, b) => b.searchVolume - a.searchVolume)) {
      if (added >= 15) break;
      const keyword = k.keyword.trim().toLowerCase().replace(/\s+/g, " ");
      if (keyword.split(" ").length < 2 || keyword.length > 80) continue;
      const proposal = { primaryKeyword: keyword, label: keyword.replace(/^./, c => c.toUpperCase()) };
      if (!evaluateTopicBusinessFit({ keyword, label: proposal.label, ...signals }).eligible) continue;
      if (taken.some(t => contentIntentConflicts(proposal, t))) continue;
      await ctx.db.insert("topic_clusters", { siteId, ...proposal, planningCanonicalDomain: siteCanonicalDomain(site)!,
        planningDomainRevision: siteCanonicalDomainRevision(site), secondaryKeywords: [], intent: "informational",
        priority: Math.max(1, Math.min(90, Math.round(Math.log10(1 + k.searchVolume) * 20 - k.difficulty / 5))), status: "planned",
        searchVolume: k.searchVolume, keywordDifficulty: k.difficulty, keywordDifficultyMeasured: k.difficultyMeasured,
        notes: "Researched keyword (search demand from DataForSEO) for the confirmed business. Use only supported business facts.",
        createdAt: Date.now(), updatedAt: Date.now() });
      taken.push(proposal); added++;
    }
    // Record the outcome (an empty result backs off) and let a waiting slot continue either way.
    if (site.contentSchedule) await ctx.db.patch(siteId, { contentSchedule: { ...site.contentSchedule, topicsReplenishAdded: added }, updatedAt: Date.now() });
    await wake(ctx, siteId);
    return { added };
  } });

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
    const failedSlot = work.find(j => j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === schedule.nextDeadlineAt);
    // Only sites that chose Autopilot in the new setup continue past a parked
    // draft; older contracts keep their failed slot exactly as recorded.
    const failure = failedSlot?.contentWork!.failure ?? "";
    const replaceNextSlot = Boolean(failedSlot && schedule.autopilotSelectedAt && autopilotReplaceable(failedSlot) && waiting.length === 0 &&
      !work.some(j => j.contentWork!.replacesJobId === failedSlot._id) && replacementsHealthy(work) &&
      failedSlot.contentWork!.deadlineAt - Date.now() >= AUTOPILOT_REPLACEMENT_LEAD_MS);
    if (failedSlot && !replaceNextSlot && schedule.autopilotSelectedAt && !failedSlot.contentWork!.ownerRequest && AUTOPILOT_SKIPPABLE_FAILURES.has(failure) &&
      (failedSlot.articleId || failure !== "bounded_content_quality_exhausted") && failedSlot.contentWork!.intent === "create") {
      // Autopilot never stalls on a draft the reviewer would not pass, or on a
      // provider response that was incomplete (nothing was published): any
      // retained draft waits for the owner, the missed slot stays recorded on
      // that job, and the schedule continues with the next slot.
      await ctx.db.patch(siteId, { contentSchedule: { ...schedule, nextDeadlineAt: schedule.nextDeadlineAt + schedule.intervalMs },
        updatedAt: Date.now() });
      await wake(ctx, siteId);
      return { scheduled: 0, mode: "content_slot_parked", blockers: ["owner_review_needed"] };
    }
    if (failedSlot && !replaceNextSlot) return { scheduled: 0, mode: "content_failed_slot", blockers: [failedSlot.contentWork!.failure ?? "content_work_failed"] };
    if (waiting.length >= 2) return { scheduled: 0, mode: "buffer_full" };
    const pricing = await pricingConfiguration(ctx, site);
    if (!pricing) return { scheduled: 0, mode: "content_pricing_unavailable" };
    const improvement = await chooseImprovement(ctx, site, work);
    let topic = improvement ? await ctx.db.get(await ctx.db.insert("topic_clusters", {
      siteId, planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
      primaryKeyword: improvement.question, label: improvement.page.editable!.title, secondaryKeywords: [], intent: "informational",
      priority: 1, status: "planned", notes: improvement.reason, createdAt: Date.now(), updatedAt: Date.now(),
    })) : await chooseTopic(ctx, site, undefined, [], { demandOnly: Boolean(schedule.autopilotSelectedAt) });
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
      topic = await chooseTopic(ctx, site);
    }
    if (!topic) return { scheduled: 0, mode: "content_inputs_exhausted" };
    // Autopilot honours the plan's monthly article allowance across the whole
    // account. When it is used up, the next article waits for the new month.
    if (schedule.autopilotSelectedAt && !improvement && site.userId) {
      const plan = await accountPlan(ctx, site), month = await accountArticlesThisMonth(ctx, site);
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
      const nextDeadlineAt = waiting.length === 0 && schedule.nextDeadlineAt > now + rhythm
        ? now + Math.min(rhythm, FIRST_ARTICLE_LEAD_MS) : schedule.nextDeadlineAt;
      if (rhythm !== schedule.intervalMs || nextDeadlineAt !== schedule.nextDeadlineAt) slot = { ...schedule, intervalMs: rhythm, nextDeadlineAt };
    }
    const deadlineAt = slot.nextDeadlineAt + waiting.length * slot.intervalMs;
    const atDeadline = work.filter(j => j.contentWork!.deadlineAt === deadlineAt);
    const replacing = schedule.autopilotSelectedAt && !improvement && atDeadline.length === 1 && autopilotReplaceable(atDeadline[0]) &&
      replacementsHealthy(work) && deadlineAt - Date.now() >= AUTOPILOT_REPLACEMENT_LEAD_MS ? atDeadline[0] : null;
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
    if (improvement) await ctx.db.patch(improvement.page._id, { editable: { ...improvement.page.editable!, lastWorkJobId: jobId } });
    return { scheduled: 1, mode: replacing ? "buffer_replacement" : "buffer_fill", activeJobId: jobId };
  },
});

export async function contentWorkCompleted(ctx: MutationCtx, job: Doc<"jobs">, rejectionIssues?: string[]) {
  if (!job.contentWork) return;
  if (job.contentWork.intent === "improve" && ["verify", "verified"].includes(job.contentWork.stage)) return;
  if (!job.articleId) {
    await ctx.db.patch(job._id, { status: "failed", contentWork: { ...job.contentWork, stage: "failed", failure: "candidate_rejected_before_draft" } });
    await closeContentWorkHold(ctx, (await ctx.db.get(job._id))!);
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
  if (stage === "review_failed" && !cw.ownerRequest && cw.intent === "create" && !rejectionIssues?.length) {
    const site = await ctx.db.get(job.siteId!);
    if (site && site.serviceMode === "growth_first" && site.autopilotEnabled && !site.approvalRequired &&
      site.contentSchedule && !site.contentSchedule.ownerReviewedOnly && site.contentSchedule.autopilotSelectedAt &&
      site.contentSchedule.autopublishConsentAt && article.status !== "published" && !article.publicationAttemptedAt) {
      const accepted = await sealAcceptedReviewNotes(ctx, site, article, AUTOPILOT_ACCEPTANCE);
      if (accepted.sealed) {
        article = (await ctx.db.get(job.articleId))!;
        if (isSealedReady(article)) stage = "ready";
      }
    }
  }
  let selectedFailure: string | undefined = rejectionIssues?.length ? "content_review_rejected" : undefined;
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
  if (job.contentWork.intent === "create" && currentBinding) await enrollVerifiedCreation(ctx, site, article, job);
  await ctx.db.patch(job._id, { contentWork: { ...job.contentWork, stage: "verified", publishedAt: article.publishedAt, verifiedAt: checkedAt } });
  await closeVerifiedContentWake(ctx, (await ctx.db.get(job._id))!);
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
  const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  const failure = uncertain ? "content_provider_result_ambiguous_reconciliation_required"
    : creditUnavailable ? "content_provider_credit_unavailable"
    : error === "content_model_response_invalid" ? error
    : /^content_audit_/.test(error) ? error
    : /Content work (budget exhausted|rollover blocked)/.test(error) ? error
    : /Content provider (authority changed|reservation unavailable)|Content checkpoint/.test(error) ? error
    : recoveries >= MAX_CONTENT_RECOVERIES ? "content_recovery_attempts_exhausted"
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
  if (!cw.ownerRequest && internalContentProcessingError(failure ?? error) && job.siteId) {
    const site = await ctx.db.get(job.siteId);
    if (site?.serviceMode === "growth_first" && site.contentSchedule) await ctx.db.patch(site._id,
      { contentSchedule: { ...site.contentSchedule, active: false, paused: true }, updatedAt: Date.now() });
  }
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
      const expectedBase = `${cw.replacements}:${cw.revisions}:review:audit_final_article`;
      if (!lineage || !original || (original.logicalKey ?? original.key) !== expectedBase || args.key !== expectedBase + SEMANTIC_AUDIT_SUFFIX ||
        original.state !== "completed" || !Number.isSafeInteger(original.actualMicroUsd) || !original.requestHash ||
        original.requestHash !== lineage.requestHash || auditResultHash(original.result) !== lineage.resultHash ||
        !contradictoryContentAudit(original.result)) throw new Error("content_audit_original_checkpoint_changed");
      if (previousCalls.some(c => JSON.stringify(c.semanticClarificationOf) !== JSON.stringify(lineage))) throw new Error("content_audit_clarification_lineage_changed");
      if (previousCalls.some(c => c.state !== "completed")) throw new Error("content_audit_clarification_already_attempted");
    }
    if (previousCalls.some(c => c.requestHash !== args.requestHash)) throw new Error("Content checkpoint request changed; reconcile the persisted result");
    const completed = previousCalls.find(c => c.state === "completed");
    if (completed) {
      if (completed.result === undefined) throw new Error("Content checkpoint response unavailable; no paid replay");
      return { kind: "cached" as const, result: completed.result };
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
    if (call.state === "rejected" || (call.state === "completed" && (call.actualMicroUsd !== args.actualMicroUsd || JSON.stringify(call.result) !== JSON.stringify(args.result)))) throw new Error("Content provider settlement conflict");
    const providerCalls = cw.providerCalls.map(c => c.key === args.key ? { ...c, state: "completed" as const, actualMicroUsd: args.actualMicroUsd, result: args.result } : c);
    if (new TextEncoder().encode(JSON.stringify(providerCalls)).length > 700_000) throw new Error("Content checkpoint storage bound exceeded; reserved ceiling retained");
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
      ([400, 403].includes(args.status) && ["invalid_request_error", "permission_error"].includes(args.code) && args.key.includes(":web_research:"));
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
          rejectionStage: cw.stage as "prepare" | "review" } : {}) } : c) } });
  },
});
