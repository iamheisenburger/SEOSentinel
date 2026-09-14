import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { contentIntentConflicts, evaluateTopicBusinessFit, tenantDiscoveryAnchors, tenantTopicBusinessSignals, isSealedReady } from "./lib/autopilotBuffer";
import { publicationArtifactHash, publicationDeliveryConfig, sha256Hex } from "./lib/publicationArtifact";
import { legacyCreditRefusal, validProviderRequestId } from "./lib/contentProviderRefusal";
import { siteCanonicalDomain, siteCanonicalDomainRevision, takeCurrentDomainTopics, contentAnalysisMatchesCurrentDomain, pageMatchesCurrentDomain, articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { inspectSharedProviderBudget, reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "./lib/providerSpendReservation";
import { contentValidationBinding } from "./lib/providerBudgetAuthorization";
import { planCheckpointTopicExecutionLocked } from "./lib/planCandidateCheckpoint";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import type { CadenceScheduleResult } from "./lib/autopilotRunOutcome";
import { liveAutopilotReadiness, publicationDestinationBlockers } from "./lib/autopilotReadiness";
import { PUBLISHED_REVISION_LEASE_MS } from "./lib/publishedRevision";
import { contentConnectionHash, confirmedContentProfileHash, contentConnectionComplete, contentConsentToken } from "./lib/contentSelection";
import { contentFunding, contentIssue } from "./lib/contentCustomer";
import { assertSafeImprovement } from "./lib/contentSelection";
import { authorizedWorkPage, chooseImprovement, enrollVerifiedCreation, selectionConnection } from "./selectedPages";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { archiveRetiredContentArtifact } from "./articles";
import { closeRetiredContentAccounting } from "./jobs";
export { confirmedContentProfileHash } from "./lib/contentSelection";

export const CONTENT_DELIVERY_WINDOW_MS = 5 * 60_000;
export const MAX_CONTENT_RECOVERIES = 3;
const LIMIT = 1000;
async function pricingConfiguration(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, job?: Doc<"jobs">) {
  // Deployment-owned pricing is deliberately absent by default. Selection is
  // consent, not activation. An optional selector enables only the immutable
  // saved run; it is never a caller flag or a tenant-name allowlist.
  let p;
  try { p = JSON.parse(process.env.PENTRA_CONTENT_WORK_PRICING ?? "null"); } catch { p = null; }
  const scoped = Boolean(p && typeof p === "object" && "validationAuthorizationId" in p);
  const cw = job?.contentWork;
  // Ordinary existing jobs keep their original execution/pricing semantics.
  // A scoped job can never become ordinary by removing deployment pricing.
  if (cw && !scoped && cw.pricing.validationAuthorizationId === undefined) return { ...cw.pricing, budgetMicroUsd: cw.budgetMicroUsd };
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
  selectionConnection(site);
  await authorizedWorkPage(ctx, site, job);
  if (!(await pricingConfiguration(ctx, site, job))) throw new Error("Interrupted content pricing unavailable");
  const binding = await contentValidationBinding(ctx, site, Date.now(), job);
  if (binding && binding.state !== "active") throw new Error("Interrupted content validation is not active");
  const receipt = job.providerSpendReservationId ? await ctx.db.get(job.providerSpendReservationId) : null;
  const prior = cw.providerCalls.filter(c => c.reservationId && c.reservationId !== receipt?._id)
    .reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  if (!receipt || receipt.siteId !== site._id || receipt.userId !== site.userId || receipt.purpose !== "content_work" ||
    receipt.releasedAt !== undefined || receipt.settledAt !== undefined || receipt.reservedMicroUsd !== cw.budgetMicroUsd - prior ||
    !(receipt.trigger === `content_slot:${cw.deadlineAt}` || receipt.trigger.startsWith(`content_slot:${cw.deadlineAt}:remaining_window:`))) {
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

type SetupIssue = { code: string; action: string; jobId?: Id<"jobs">; articleId?: Id<"articles">; until?: number };
async function reviewChangedSetup(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, jobs: Doc<"jobs">[]) {
  let connection: string | undefined;
  try { connection = contentConnectionHash(site); } catch { /* An incomplete destination cannot be confirmed. */ }
  const profile = confirmedContentProfileHash(site), schedule = site.contentSchedule;
  const needed = Boolean(schedule && (schedule.profileHash !== profile || schedule.connectionHash !== connection));
  const stale = jobs.filter(j => j.contentWork && j.contentWork.retiredAt === undefined && j.contentWork.stage !== "verified" &&
    (j.contentWork.profileHash !== profile || j.contentWork.connectionHash !== connection));
  const issues: SetupIssue[] = [];
  const verifying: Doc<"jobs">[] = [], recoveryArticles: Doc<"articles">[] = [];
  if (!needed) return { needed, stale, issues, verifying, recoveryArticles, pristineLease: false };
  if (jobs.length > LIMIT) issues.push({ code: "incomplete", action: "Ask support to complete this site's bounded work-inventory review before confirming changes. New work stays stopped." });
  for (const job of jobs) {
    if (!job.contentWork && ["pending", "running"].includes(job.status)) issues.push({ code: "legacy_work", jobId: job._id,
      action: "Finish or cancel the original legacy job from its job details before confirming the changed content service." });
    if (job.contentWork?.retiredAt !== undefined) continue;
    if (job.status === "running") issues.push({ code: "worker", jobId: job._id, until: job.leaseExpiresAt,
      action: "Wait for the current worker or its existing lease recovery, then check the changed setup again. No additional work starts while paused." });
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
      if (job?.contentWork?.stage === "verify" && r.receipt) verifying.push(job);
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

/** Explicit owner review retires stale unstarted work, never rebinds its seal.
 * It reuses normal terminal accounting and new-work admission, not new credit. */
export const reconfirm = mutation({ args: { siteId: v.id("sites"), reviewToken: v.string(), confirm: v.boolean() },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), schedule = site.contentSchedule;
    if (!args.confirm || args.reviewToken !== contentConsentToken(site)) throw new Error("Review and explicitly confirm the current saved setup first");
    if (site.serviceMode !== "growth_first" || !schedule) throw new Error("Choose the content service first");
    const jobs = await jobsForSite(ctx, site._id), review = await reviewChangedSetup(ctx, site, jobs);
    if (!review.needed) return { status: "unchanged" as const, retired: 0, issues: [] as SetupIssue[] };
    await ctx.db.patch(site._id, { contentSchedule: { ...schedule, paused: true }, updatedAt: Date.now() });
    for (const job of review.verifying) await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId: site._id, jobId: job._id });
    for (const article of review.recoveryArticles) await ctx.scheduler.runAfter(0, internal.publisher.recoverInitialPublicationLeaseInternal, {
      siteId: site._id, articleId: article._id, expectedContentHash: article.publicationLeaseHash!, expectedLeaseOwner: article.publicationLeaseOwner! });
    for (const job of jobs.filter(j => j.status === "running" && j.workerToken && j.leaseExpiresAt)) await ctx.scheduler.runAt(Math.max(Date.now(), job.leaseExpiresAt!),
      internal.jobs.resetStuckJobs, { siteId: site._id, jobId: job._id, expectedWorkerToken: job.workerToken! });
    if (!contentConnectionComplete(site) || !publisherDestinationReceiptVerified({ site }) || publicationDestinationBlockers(site).length) review.issues.push({ code: "connection", action: "Reconnect and verify the exact current GitHub or WordPress destination in website settings, then review these changes again." });
    if (!await contentEntitlementAuthorized(ctx, site)) review.issues.push({ code: "billing", action: "Verify the existing plan in Billing, then check these changes again. No plan or credit is purchased by confirming setup." });
    if (!site.siteSummary?.trim() || !site.targetAudienceSummary?.trim()) review.issues.push({ code: "profile", action: "Complete the confirmed business facts and audience in website settings, then review the saved setup again." });
    if (review.issues.length) return { status: "waiting" as const, retired: 0, issues: review.issues };
    for (const job of review.stale) {
      await ctx.db.patch(job._id, { status: "failed", nextAttemptAt: undefined, workerToken: undefined, heartbeatAt: undefined, leaseExpiresAt: undefined,
        contentWork: { ...job.contentWork!, retiredAt: Date.now(), retiredForReviewToken: args.reviewToken }, updatedAt: Date.now() });
      const retired = (await ctx.db.get(job._id))!;
      await archiveRetiredContentArtifact(ctx, retired);
      await closeRetiredContentAccounting(ctx, retired);
    }
    if (review.pristineLease) {
      const revisions = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
      const pristine = revisions.find(r => r.leaseOwner === site.publicationLeaseOwner)!;
      // Same proven-before-I/O terminal disposition as expired revision recovery.
      // Preserve its attempts, exact source and all accounting history.
      await ctx.db.patch(pristine._id, { status: "failed", leaseOwner: undefined, leaseStartedAt: undefined,
        failureCode: "pristine_revision_lease_retired", failureDetail: "Owner confirmed changed setup after the lease expired before any external attempt.", updatedAt: Date.now() });
    }
    await ctx.db.patch(site._id, { contentSchedule: { ...schedule, profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      active: false, paused: false, autopublishConsentAt: Date.now() }, autopilotEnabled: true, autopilotRolloutMode: "warm", approvalRequired: false,
      ...(review.pristineLease ? { publicationLeaseOwner: undefined, publicationLeaseExpiresAt: undefined } : {}), updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { status: "preparing" as const, retired: review.stale.length, issues: [] as SetupIssue[] };
  } });

/** Stage 1 interface. No customer can opt in implicitly or rewrite an existing
 * deadline by toggling mode. Migration and rollback drain unresolved work. */
export const selectServiceMode = mutation({
  args: { siteId: v.id("sites"), mode: v.union(v.literal("legacy_articles"), v.literal("growth_first")),
    confirmBusinessProfile: v.boolean(), authorizeAutomaticPublication: v.optional(v.boolean()), reviewToken: v.optional(v.string()), timezone: v.optional(v.string()), firstDeadlineAt: v.optional(v.number()), intervalMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId);
    if ((site.serviceMode ?? "legacy_articles") === args.mode) return { changed: false };
    const jobs = await jobsForSite(ctx, site._id);
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
    if (args.mode === "legacy_articles") {
      await ctx.db.patch(site._id, { serviceMode: args.mode, updatedAt: Date.now() });
      return { changed: true };
    }
    if (!args.confirmBusinessProfile || !site.siteSummary?.trim() || !site.targetAudienceSummary?.trim() ||
      (!site.contentSetupRequestedAt && !contentAnalysisMatchesCurrentDomain(site))) throw new Error("Confirm the current business and audience first");
    if (args.reviewToken !== contentConsentToken(site)) throw new Error("Saved business or destination changed. Review the current values before confirming.");
    const timezone = args.timezone ?? "UTC";
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid timezone"); }
    if (!contentConnectionComplete(site)) {
      throw new Error("Connect a supported GitHub or conditional WordPress destination first");
    }
    selectionConnection(site);
    if (!Number.isSafeInteger(args.intervalMs) || args.intervalMs! < CONTENT_DELIVERY_WINDOW_MS ||
      !Number.isSafeInteger(args.firstDeadlineAt) || args.firstDeadlineAt! < Date.now() + CONTENT_DELIVERY_WINDOW_MS) throw new Error("Choose a future fixed delivery window and interval");
    if (!(await contentEntitlementAuthorized(ctx, site))) throw new Error("Current plan entitlement is required");
    await ctx.db.patch(site._id, { serviceMode: "growth_first", ...(args.authorizeAutomaticPublication === true ? {
      approvalRequired: false, autopilotEnabled: true, autopilotRolloutMode: "warm",
    } : {}), contentSchedule: {
      validationAuthorizationId: site.contentSchedule?.validationAuthorizationId,
      selectedAt: Date.now(), profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      ...(args.authorizeAutomaticPublication === true ? { autopublishConsentAt: Date.now() } : {}),
      intervalMs: site.contentSchedule?.intervalMs ?? args.intervalMs!, nextDeadlineAt: site.contentSchedule?.nextDeadlineAt ?? args.firstDeadlineAt!, timezone: site.contentSchedule?.timezone ?? timezone, active: false, paused: false,
    }, updatedAt: Date.now() });
    await wake(ctx, site._id);
    return { changed: true };
  },
});

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
      verified = contentConnectionComplete(site) && publisherDestinationReceiptVerified({ site }) && publicationDestinationBlockers(site).length === 0;
      bindingCurrent = !s || (s.profileHash === confirmedContentProfileHash(site) && s.connectionHash === contentConnectionHash(site));
    } catch { /* Incomplete destination is actionable readiness, not a query crash. */ }
    const reconciliation = await reviewChangedSetup(ctx, site, jobs);
    const pricing = await pricingConfiguration(ctx, site);
    return { siteId, setupPending: Boolean(site.contentSetupRequestedAt && !site.serviceMode), serviceMode: site.serviceMode ?? "legacy_articles", reviewToken: contentConsentToken(site),
      profile: { name: site.siteName ?? site.domain, summary: site.siteSummary ?? "", audience: site.targetAudienceSummary ?? "", productUsage: site.productUsage ?? "", offerings: site.keyFeatures ?? [] },
      destination: { kind: site.publishMethod ?? "manual", domain: site.domain, repository: site.publishMethod === "github" ? `${site.repoOwner ?? ""}/${site.repoName ?? ""}` : null,
        branch: site.repoDefaultBranch ?? null, contentDirectory: directory, verified },
      entitlement: await contentEntitlementAuthorized(ctx, site), enabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
      bindingCurrent,
      reconciliation: { needed: reconciliation.needed, staleItems: reconciliation.stale.length, issues: reconciliation.issues },
      schedule: s ? { active: s.active, paused: s.paused, nextDeadlineAt: s.nextDeadlineAt, intervalMs: s.intervalMs, timezone: s.timezone ?? "UTC" } : null,
      funding: { ...await contentFunding(ctx, site, pricing?.budgetMicroUsd),
        pricingScope: !pricing ? "unavailable" as const : pricing.validationAuthorizationId ? "validation_run" as const : "ordinary" as const },
      complete: jobs.length <= LIMIT, ready: jobs.filter(j => j.contentWork?.stage === "ready" && j.contentWork.retiredAt === undefined &&
        j.contentWork.profileHash === confirmedContentProfileHash(site) && j.contentWork.connectionHash === s?.connectionHash && bindingCurrent).length,
      work: jobs.filter(j => j.contentWork).map(j => {
        const call = j.contentWork!.providerCalls.find(c => interruptedCreditCall(c) && c.creditRecovery);
        const creditRetry = j.status === "failed" && j.contentWork!.stage === "failed" && call && j.contentWork!.retiredAt === undefined
          ? { jobId: j._id, callKey: call.key, token: creditRetryToken(j, call) } : null;
        return { jobId: j._id, articleId: j.articleId,
        intent: j.contentWork!.intent, operation: j.contentWork!.operation,
        stage: j.contentWork!.stage, deadlineAt: j.contentWork!.deadlineAt, windowStartAt: j.contentWork!.windowStartAt,
        retiredAt: j.contentWork!.retiredAt,
        publishedAt: j.contentWork!.publishedAt, verifiedAt: j.contentWork!.verifiedAt, creditRetry,
        failure: creditRetry ? "Pentra has restored generation for this interrupted work. You can retry it once; the original deadline and earlier attempt remain recorded."
          : contentIssue(j.contentWork!.failure ?? j.error) }; }) };
  },
});

/** Pause is not cancellation: retain ready work, leases, attempts and costs.
 * Resume can only wake the same binding; changed facts require reconciliation. */
export const control = mutation({ args: { siteId: v.id("sites"), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("retry")), reviewToken: v.string(),
    creditRetry: v.optional(v.object({ jobId: v.id("jobs"), callKey: v.string(), token: v.string() })) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s) throw new Error("Choose growth-first service first");
    if (args.action === "pause") {
      await ctx.db.patch(site._id, { contentSchedule: { ...s, paused: true }, updatedAt: Date.now() });
      await wake(ctx, site._id); return;
    }
    if (args.reviewToken !== contentConsentToken(site) || s.profileHash !== confirmedContentProfileHash(site) || s.connectionHash !== contentConnectionHash(site)) throw new Error("Business or destination changed. Use Review changed setup to confirm current facts and safely replace stale unstarted work.");
    if (!await contentEntitlementAuthorized(ctx, site) || !contentConnectionComplete(site) || site.approvalRequired) throw new Error("Verify billing, publishing and automatic-publication consent before resuming");
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

async function chooseTopic(ctx: MutationCtx, site: Doc<"sites">) {
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
    ![...covered, ...pageCoverage].some(c => contentIntentConflicts(t, c)));
  // Optional forecasts order work only. Absence remains absent in storage.
  planned.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (planned[0]) return planned[0];
  const anchors = tenantDiscoveryAnchors([...(site.anchorKeywords ?? []), ...(site.keyFeatures ?? []),
    ...(site.painPoints ?? []), site.productUsage], 40);
  for (const primaryKeyword of anchors) {
    const proposal = { primaryKeyword, label: `A practical guide to ${primaryKeyword}` };
    if (!fit(proposal) || [...topics, ...pageCoverage].some(t => contentIntentConflicts(proposal, t))) continue;
    const id = await ctx.db.insert("topic_clusters", { siteId: site._id, ...proposal,
      planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
      secondaryKeywords: [], intent: "informational", priority: 1, status: "planned",
      notes: "Confirmed first-party reader question. Search forecasts are unknown. Use supported business facts and conditional guidance; never invent experience or external claims.",
      createdAt: Date.now(), updatedAt: Date.now() });
    return (await ctx.db.get(id))!;
  }
  return null;
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
    if (!site.autopilotEnabled || schedule.paused || !["warm", "live"].includes(site.autopilotRolloutMode ?? "") ||
      !(await contentEntitlementAuthorized(ctx, site))) return { scheduled: 0, mode: "content_paused" };
    if (!contentConnectionComplete(site) || schedule.profileHash !== confirmedContentProfileHash(site) ||
      schedule.connectionHash !== contentConnectionHash(site)) return { scheduled: 0, mode: "content_binding_changed" };
    if (site.approvalRequired) return { scheduled: 0, mode: "approval_waiting" };
    const all = await jobsForSite(ctx, siteId, schedule.nextDeadlineAt), work = all.filter(j => j.contentWork && j.contentWork.retiredAt === undefined);
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
    if (!active && ready.length >= 2 && liveAutopilotReadiness(site, true).ready) {
      const funding = await contentFunding(ctx, site, (await pricingConfiguration(ctx, site))?.budgetMicroUsd);
      // Exhausting/stopping/removing scoped model execution cannot strand two
      // already-reviewed deliveries, even before the first window activates.
      // Validate their retained run/receipt lineage, but require no new money.
      const preparedRun = (await Promise.all(ready.slice(0, 2).map(async job => {
        try { return Boolean(job.contentWork!.pricing.validationAuthorizationId &&
          job.contentWork!.pricing.validationAuthorizationId === (await contentValidationBinding(ctx, site, Date.now(), job))?.id); }
        catch { return false; }
      }))).every(Boolean);
      if (funding.status !== "available" && !preparedRun) return { scheduled: 0, mode: "content_budget_exhausted" };
      if (new Set(ready.slice(0, 2).map(j => j.articleId)).size !== 2) return { scheduled: 0, mode: "content_artifact_changed" };
      for (const item of ready.slice(0, 2)) {
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
    if (failed) {
      const cw = failed.contentWork!;
      if (cw.revisions < 2) {
        await ctx.db.patch(failed._id, { status: "pending", workerAttempts: (failed.workerAttempts ?? 0) + 1,
          payload: { ...failed.payload, qualityRetry: true, articleId: failed.articleId, bufferFill: true },
          contentWork: { ...cw, stage: "review", revisions: cw.revisions + 1 }, updatedAt: Date.now() });
        return { scheduled: 1, mode: "quality_revision" };
      }
      const replacement = cw.replacements === 0 ? await chooseTopic(ctx, site) : null;
      if (replacement && failed.articleId) {
        await ctx.db.patch(failed._id, { status: "pending", articleId: undefined, reservationId: undefined,
          workerAttempts: (failed.workerAttempts ?? 0) + 1,
          payload: { topicId: replacement._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
          contentWork: { ...cw, intent: "create", targetPageId: undefined, baseRevision: undefined, permissionVersion: undefined,
            opportunity: undefined, revisionId: undefined, editTarget: undefined, stage: "prepare", replacements: 1, discardedArticleIds: [...cw.discardedArticleIds, failed.articleId] }, updatedAt: Date.now() });
        await ctx.db.patch(replacement._id, { status: "queued", updatedAt: Date.now() });
        return { scheduled: 1, mode: "buffer_fill" };
      }
      await ctx.db.patch(failed._id, { status: "failed", contentWork: { ...cw, stage: "failed", failure: "bounded_content_quality_exhausted" }, updatedAt: Date.now() });
      await settleFailedContentWork(ctx, failed._id);
      return { scheduled: 0, mode: "content_quality_exhausted" };
    }
    // A failed delivery slot cannot silently mint unlimited replacement jobs.
    const failedSlot = work.find(j => j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === schedule.nextDeadlineAt);
    if (failedSlot) return { scheduled: 0, mode: "content_failed_slot", blockers: [failedSlot.contentWork!.failure ?? "content_work_failed"] };
    if (waiting.length >= 2) return { scheduled: 0, mode: "buffer_full" };
    const pricing = await pricingConfiguration(ctx, site);
    if (!pricing) return { scheduled: 0, mode: "content_pricing_unavailable" };
    const improvement = await chooseImprovement(ctx, site, work);
    const topic = improvement ? await ctx.db.get(await ctx.db.insert("topic_clusters", {
      siteId, planningCanonicalDomain: siteCanonicalDomain(site)!, planningDomainRevision: siteCanonicalDomainRevision(site),
      primaryKeyword: improvement.question, label: improvement.page.editable!.title, secondaryKeywords: [], intent: "informational",
      priority: 1, status: "planned", notes: improvement.reason, createdAt: Date.now(), updatedAt: Date.now(),
    })) : await chooseTopic(ctx, site);
    if (!topic) return { scheduled: 0, mode: "content_inputs_exhausted" };
    const deadlineAt = schedule.nextDeadlineAt + waiting.length * schedule.intervalMs;
    if (work.some(j => j.contentWork!.deadlineAt === deadlineAt)) return { scheduled: 0, mode: "content_failed_slot" };
    const budgetRequest = { siteId, userId: site.userId!, purpose: "content_work" as const,
      trigger: `content_slot:${deadlineAt}`, reservedMicroUsd: pricing.budgetMicroUsd, timestamp: Date.now() };
    const budget = await inspectSharedProviderBudget(ctx, budgetRequest);
    if (!budget.ok) return { scheduled: 0, mode: "content_budget_exhausted", blockers: [budget.reason], budgetBlocker: budget };
    const { budgetMicroUsd, ...price } = pricing;
    const jobId = await ctx.db.insert("jobs", { siteId, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
      payload: { topicId: topic._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { validationAuthorizationId: schedule.validationAuthorizationId, intent: improvement ? "improve" : "create", ...(improvement ? { targetPageId: improvement.page._id,
          baseRevision: improvement.page.editable!.sourceRevision, permissionVersion: improvement.page.editable!.version, opportunity: improvement.reason,
          editTarget: improvement.editTarget } : {}),
        stage: "prepare", deadlineAt, windowStartAt: deadlineAt - CONTENT_DELIVERY_WINDOW_MS,
        profileHash: schedule.profileHash, connectionHash: schedule.connectionHash, revisions: 0, replacements: 0,
        discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] }, createdAt: Date.now(), updatedAt: Date.now() });
    // The provisional job and its receipt commit together. The preceding read
    // uses the same transaction; an unexpected denial rolls back both.
    const reserved = await reserveSharedProviderBudget(ctx, { ...budgetRequest, contentWorkJobId: jobId });
    if (!reserved.ok) throw new Error("Content reservation changed inside admission");
    await ctx.db.patch(jobId, { providerSpendReservationId: reserved.reservationId });
    await ctx.db.patch(topic._id, { status: "queued", updatedAt: Date.now() });
    if (improvement) await ctx.db.patch(improvement.page._id, { editable: { ...improvement.page.editable!, lastWorkJobId: jobId } });
    return { scheduled: 1, mode: "buffer_fill", activeJobId: jobId };
  },
});

export async function contentWorkCompleted(ctx: MutationCtx, job: Doc<"jobs">) {
  if (!job.contentWork) return;
  if (job.contentWork.intent === "improve" && ["verify", "verified"].includes(job.contentWork.stage)) return;
  if (!job.articleId) {
    await ctx.db.patch(job._id, { status: "failed", contentWork: { ...job.contentWork, stage: "failed", failure: "candidate_rejected_before_draft" } });
    await wake(ctx, job.siteId!);
    return;
  }
  const article = await ctx.db.get(job.articleId), cw = job.contentWork;
  if (!article || article.siteId !== job.siteId) throw new Error("Content work artifact crossed tenant boundary");
  let stage: NonNullable<Doc<"jobs">["contentWork"]>["stage"] = article.status === "published" ? (article.publicUrlStatus === "verified" ? "verified" : "verify")
    : isSealedReady(article) ? "ready" : "review_failed";
  let selectedFailure: string | undefined;
  if (stage === "ready" && cw.intent === "improve") {
    const site = await ctx.db.get(job.siteId!);
    try {
      const page = site ? await authorizedWorkPage(ctx, site, job) : null;
      if (!page?.editable) throw new Error("Selected page unavailable");
      assertSafeImprovement(page.editable, article, cw.editTarget);
    } catch (error) { stage = "review_failed"; selectedFailure = error instanceof Error ? error.message : "Selected-page review failed"; }
  }
  const currentCalls = cw.providerCalls.filter(c => !c.reservationId || c.reservationId === job.providerSpendReservationId);
  if (stage === "ready" && job.providerSpendReservationId && currentCalls.length > 0 && currentCalls.every(c => c.state === "completed" && c.actualMicroUsd !== undefined)) {
    await settleSharedProviderReservation(ctx, { reservationId: job.providerSpendReservationId, siteId: job.siteId!, purpose: "content_work",
      actualMicroUsd: currentCalls.reduce((sum, c) => sum + c.actualMicroUsd!, 0), reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  }
  await ctx.db.patch(job._id, { contentWork: { ...cw, stage, failure: selectedFailure ?? (stage === "ready" ? undefined : cw.failure),
    approvedArtifactHash: stage === "ready" ? article.auditedContentHash : cw.approvedArtifactHash,
    publishedAt: article.publishedAt, verifiedAt: article.publicUrlVerifiedAt } });
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
  if (job.contentWork.deadlineAt === site.contentSchedule.nextDeadlineAt) await ctx.db.patch(site._id, {
    contentSchedule: { ...site.contentSchedule, nextDeadlineAt: site.contentSchedule.nextDeadlineAt + site.contentSchedule.intervalMs }, updatedAt: checkedAt });
  await wake(ctx, site._id);
}

/** Close only a durably terminal job. Every possible paid call first appends a
 * started receipt in the same serializable job record. No receipt proves no
 * paid I/O; an incomplete receipt proves uncertainty, never free headroom. */
export async function settleFailedContentWork(ctx: MutationCtx, jobId: Id<"jobs">) {
  const job = await ctx.db.get(jobId), cw = job?.contentWork;
  if (!job || job.status !== "failed" || !cw || !job.siteId || !job.providerSpendReservationId) return;
  const receipt = await ctx.db.get(job.providerSpendReservationId);
  if (!receipt || receipt.siteId !== job.siteId || receipt.purpose !== "content_work") throw new Error("Content work settlement binding changed");
  const currentCalls = cw.providerCalls.filter(c => !c.reservationId || c.reservationId === receipt._id);
  if (receipt.settledAt === undefined && receipt.releasedAt === undefined) {
    if (currentCalls.length === 0) {
      await releaseSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
        reason: "content_work_closed_before_provider_execution", timestamp: Date.now() });
    } else if (currentCalls.every(c => c.state === "completed" && c.actualMicroUsd !== undefined)) {
      await settleSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
        actualMicroUsd: currentCalls.reduce((sum, c) => sum + c.actualMicroUsd!, 0),
        reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
    }
  }
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
  if (willRetry) await ctx.scheduler.runAt(nextAttemptAt!, internal.autopilot.dispatchSiteFollowup,
    { siteId: job.siteId!, trigger: "job_retry", reason: `content_recovery_${recoveries + 1}` });
  else await settleFailedContentWork(ctx, job._id);
  return { updated: true, willRetry, nextAttemptAt };
}

export const beginProviderCall = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), requestHash: v.optional(v.string()), ceilingMicroUsd: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    let cw = job?.contentWork;
    if (cw?.operation) throw new Error("Owner correction/restoration is provider-free; no paid work is authorized");
    if (!job || !cw || !site || job.workerToken !== args.workerToken || job.status !== "running" ||
      (job.leaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) ||
      !(await contentEntitlementAuthorized(ctx, site)) || !contentConnectionComplete(site) || confirmedContentProfileHash(site) !== cw.profileHash ||
      contentConnectionHash(site) !== cw.connectionHash) throw new Error("Content provider authority changed");
    await authorizedWorkPage(ctx, site, job);
    const previousCalls = cw.providerCalls.filter(c => (c.logicalKey ?? c.key) === args.key);
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
      !(receipt.trigger === `content_slot:${cw.deadlineAt}` || receipt.trigger.startsWith(`content_slot:${cw.deadlineAt}:remaining_window:`))) {
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
      (args.status === 429 && args.code === "rate_limit_error") || ([503, 529].includes(args.status) && args.code === "overloaded_error");
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
