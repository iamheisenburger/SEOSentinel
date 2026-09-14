import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { contentIntentConflicts, evaluateTopicBusinessFit, tenantDiscoveryAnchors, tenantTopicBusinessSignals, isSealedReady } from "./lib/autopilotBuffer";
import { publicationAdapterConfigHash, publicationArtifactHash, sha256Hex } from "./lib/publicationArtifact";
import { siteCanonicalDomain, siteCanonicalDomainRevision, takeCurrentDomainTopics, contentAnalysisMatchesCurrentDomain, pageMatchesCurrentDomain, articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "./lib/providerSpendReservation";
import { planCheckpointTopicExecutionLocked } from "./lib/planCandidateCheckpoint";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import type { CadenceScheduleResult } from "./lib/autopilotRunOutcome";
import { liveAutopilotReadiness } from "./lib/autopilotReadiness";

export const CONTENT_DELIVERY_WINDOW_MS = 5 * 60_000;
const LIMIT = 1000;
function contentConnectionHash(site: Doc<"sites">): string {
  return sha256Hex(JSON.stringify([publicationAdapterConfigHash(site), site.publisherConnectionGeneration ?? 0]));
}
export function confirmedContentProfileHash(site: Doc<"sites">): string {
  return sha256Hex(JSON.stringify([siteCanonicalDomain(site), siteCanonicalDomainRevision(site),
    site.siteSummary, site.targetAudienceSummary, site.anchorKeywords, site.keyFeatures, site.painPoints, site.productUsage]));
}
function pricingConfiguration() {
  // Deployment-owned pricing is deliberately absent by default. Selection is
  // consent, not activation of an operator's finite validation allowance.
  try {
    const p = JSON.parse(process.env.PENTRA_CONTENT_WORK_PRICING ?? "null");
    if (!p || typeof p.model !== "string" || !p.model ||
      ![p.inputMicroUsdPerToken, p.outputMicroUsdPerToken, p.budgetMicroUsd].every(n => Number.isSafeInteger(n) && n > 0)) return null;
    return { model: p.model as string, inputMicroUsdPerToken: p.inputMicroUsdPerToken as number,
      outputMicroUsdPerToken: p.outputMicroUsdPerToken as number, budgetMicroUsd: p.budgetMicroUsd as number };
  } catch { return null; }
}
async function contentEntitlementAuthorized(ctx: MutationCtx, site: Doc<"sites">) {
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

/** Stage 1 interface. No customer can opt in implicitly or rewrite an existing
 * deadline by toggling mode. Migration and rollback drain unresolved work. */
export const selectServiceMode = mutation({
  args: { siteId: v.id("sites"), mode: v.union(v.literal("legacy_articles"), v.literal("growth_first")),
    confirmBusinessProfile: v.boolean(), firstDeadlineAt: v.optional(v.number()), intervalMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId);
    if ((site.serviceMode ?? "legacy_articles") === args.mode) return { changed: false };
    const jobs = await jobsForSite(ctx, site._id);
    if (site.publicationLeaseOwner || jobs.some(j => ["pending", "running"].includes(j.status) ||
      (j.contentWork && !["verified", "failed"].includes(j.contentWork.stage)))) throw new Error("Reconcile in-flight content work before switching engines");
    for (const table of ["cadence_micro_seed_jobs", "expected_click_evidence_jobs", "expected_click_demand_jobs", "seo_growth_actions"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_site_status", q => q.eq("siteId", site._id)).take(LIMIT + 1);
      if (rows.length > LIMIT || rows.some(r => !["completed", "failed", "cancelled", "expired", "skipped", "done", "published"].includes(r.status))) {
        throw new Error("Reconcile legacy growth work before switching engines");
      }
    }
    if (args.mode === "legacy_articles") {
      await ctx.db.patch(site._id, { serviceMode: args.mode, updatedAt: Date.now() });
      return { changed: true };
    }
    if (!args.confirmBusinessProfile || !site.siteSummary?.trim() || !site.targetAudienceSummary?.trim() ||
      !contentAnalysisMatchesCurrentDomain(site)) throw new Error("Confirm the current business and audience first");
    if (site.publishMethod !== "github" || !site.repoOwner || !site.repoName || !site.githubToken || !site.repoDefaultBranch) {
      throw new Error("Stage 1 supports a connected GitHub Markdown/MDX destination only");
    }
    if (!Number.isSafeInteger(args.intervalMs) || args.intervalMs! < CONTENT_DELIVERY_WINDOW_MS ||
      !Number.isSafeInteger(args.firstDeadlineAt) || args.firstDeadlineAt! < Date.now() + CONTENT_DELIVERY_WINDOW_MS) throw new Error("Choose a future fixed delivery window and interval");
    if (!(await contentEntitlementAuthorized(ctx, site))) throw new Error("Current plan entitlement is required");
    await ctx.db.patch(site._id, { serviceMode: "growth_first", contentSchedule: {
      selectedAt: Date.now(), profileHash: confirmedContentProfileHash(site), connectionHash: contentConnectionHash(site),
      intervalMs: site.contentSchedule?.intervalMs ?? args.intervalMs!, nextDeadlineAt: site.contentSchedule?.nextDeadlineAt ?? args.firstDeadlineAt!, active: false, paused: false,
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
    return { serviceMode: site.serviceMode ?? "legacy_articles", schedule: site.contentSchedule,
      funding: pricingConfiguration() ? "priced_admission_required" : "pricing_not_configured",
      complete: jobs.length <= LIMIT, ready: jobs.filter(j => j.contentWork?.stage === "ready").length,
      work: jobs.filter(j => j.contentWork).map(j => ({ jobId: j._id, articleId: j.articleId,
        stage: j.contentWork!.stage, deadlineAt: j.contentWork!.deadlineAt, windowStartAt: j.contentWork!.windowStartAt,
        publishedAt: j.contentWork!.publishedAt, verifiedAt: j.contentWork!.verifiedAt, failure: j.contentWork!.failure })) };
  },
});

async function chooseTopic(ctx: MutationCtx, site: Doc<"sites">) {
  const topics = await takeCurrentDomainTopics(ctx, site, LIMIT + 1);
  if (topics.length > LIMIT) throw new Error("Topic inventory is incomplete");
  const signals = tenantTopicBusinessSignals(site);
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(LIMIT + 1);
  if (pages.length > LIMIT) throw new Error("Existing page inventory is incomplete");
  const pageCoverage = pages.filter(p => pageMatchesCurrentDomain(site, p) && !["", "/", "/index"].includes(p.slug))
    .flatMap(p => [...(p.keywords ?? []), ...(p.title ? [p.title] : [])].map(primaryKeyword => ({ primaryKeyword })));
  for (const status of ["ready", "published"]) {
    const summaries = await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", site._id).eq("status", status)).take(LIMIT + 1);
    if (summaries.length > LIMIT) throw new Error("Published intent inventory is incomplete");
    for (const row of summaries.filter(row => articleMatchesCurrentDomain(site, row))) {
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
    if (!site.autopilotEnabled || schedule.paused || !["warm", "live"].includes(site.autopilotRolloutMode ?? "") ||
      !(await contentEntitlementAuthorized(ctx, site))) return { scheduled: 0, mode: "content_paused" };
    if (site.publishMethod !== "github" || !site.githubToken || schedule.profileHash !== confirmedContentProfileHash(site) ||
      schedule.connectionHash !== contentConnectionHash(site)) return { scheduled: 0, mode: "content_binding_changed" };
    if (site.approvalRequired) return { scheduled: 0, mode: "approval_waiting" };
    const all = await jobsForSite(ctx, siteId, schedule.nextDeadlineAt), work = all.filter(j => j.contentWork);
    for (const j of work) if (j.status === "failed" && !["verified", "failed"].includes(j.contentWork!.stage)) {
      await settleFailedContentWork(ctx, j._id);
      return { scheduled: 0, mode: "content_failed_slot" };
    }
    if (all.some(j => !j.contentWork && ["pending", "running"].includes(j.status))) return { scheduled: 0, mode: "content_migration_pending" };
    const activeJob = work.find(j => ["pending", "running"].includes(j.status));
    if (activeJob) return { scheduled: 0, mode: "work_in_progress", activeJobId: activeJob._id };
    const waiting = work.filter(j => !["verified", "failed"].includes(j.contentWork!.stage)).sort((a,b) => a.contentWork!.deadlineAt - b.contentWork!.deadlineAt);
    const unverified = waiting.find(j => j.contentWork!.stage === "verify");
    if (unverified) {
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
          contentWork: { ...cw, stage: "prepare", replacements: 1, discardedArticleIds: [...cw.discardedArticleIds, failed.articleId] }, updatedAt: Date.now() });
        await ctx.db.patch(replacement._id, { status: "queued", updatedAt: Date.now() });
        return { scheduled: 1, mode: "buffer_fill" };
      }
      await ctx.db.patch(failed._id, { status: "failed", contentWork: { ...cw, stage: "failed", failure: "bounded_content_quality_exhausted" }, updatedAt: Date.now() });
      await settleFailedContentWork(ctx, failed._id);
      return { scheduled: 0, mode: "content_quality_exhausted" };
    }
    // A failed delivery slot cannot silently mint unlimited replacement jobs.
    if (work.some(j => j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === schedule.nextDeadlineAt)) return { scheduled: 0, mode: "content_failed_slot" };
    const ready = waiting.filter(j => j.contentWork!.stage === "ready");
    let active = schedule.active;
    if (!active && ready.length >= 2 && liveAutopilotReadiness(site, true).ready) {
      for (const item of ready.slice(0, 2)) {
        const artifact = item.articleId ? await ctx.db.get(item.articleId) : null;
        if (!artifact || !isSealedReady(artifact) || publicationArtifactHash(artifact) !== item.contentWork!.approvedArtifactHash) return { scheduled: 0, mode: "content_artifact_changed" };
      }
      active = true;
      await ctx.db.patch(siteId, { contentSchedule: { ...schedule, active: true }, autopilotRolloutMode: "live", updatedAt: Date.now() });
    }
    const first = ready[0];
    if (active && first && first.contentWork!.deadlineAt === schedule.nextDeadlineAt && Date.now() >= first.contentWork!.windowStartAt) {
      const article = first.articleId ? await ctx.db.get(first.articleId) : null;
      if (!article || !isSealedReady(article) || article.auditedContentHash !== first.contentWork!.approvedArtifactHash ||
        publicationArtifactHash(article) !== first.contentWork!.approvedArtifactHash) return { scheduled: 0, mode: "content_artifact_changed" };
      await ctx.db.patch(first._id, { status: "pending", payload: { ...first.payload, articleId: article._id, publishOnly: true, bufferDelivery: true },
        contentWork: { ...first.contentWork!, stage: "publish" }, updatedAt: Date.now() });
      return { scheduled: 1, mode: "buffer_delivery" };
    }
    if (active && first && first.contentWork!.windowStartAt > Date.now() && !first.contentWork!.windowWakeId) {
      const windowWakeId = await ctx.scheduler.runAt(first.contentWork!.windowStartAt, internal.autopilot.dispatchSiteFollowup,
        { siteId, trigger: "content_window", reason: `fixed_deadline_${first.contentWork!.deadlineAt}` });
      await ctx.db.patch(first._id, { contentWork: { ...first.contentWork!, windowWakeId } });
    }
    if (waiting.length >= 2) return { scheduled: 0, mode: "buffer_full" };
    const pricing = pricingConfiguration();
    if (!pricing) return { scheduled: 0, mode: "content_pricing_unavailable" };
    const topic = await chooseTopic(ctx, site);
    if (!topic) return { scheduled: 0, mode: "content_inputs_exhausted" };
    const deadlineAt = schedule.nextDeadlineAt + waiting.length * schedule.intervalMs;
    if (work.some(j => j.contentWork!.deadlineAt === deadlineAt)) return { scheduled: 0, mode: "content_failed_slot" };
    const budget = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId!, purpose: "content_work",
      trigger: `content_slot:${deadlineAt}`, reservedMicroUsd: pricing.budgetMicroUsd, timestamp: Date.now() });
    if (!budget.ok) return { scheduled: 0, mode: "content_budget_exhausted", blockers: [budget.reason] };
    const { budgetMicroUsd, ...price } = pricing;
    const jobId = await ctx.db.insert("jobs", { siteId, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
      providerSpendReservationId: budget.reservationId,
      payload: { topicId: topic._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { intent: "create", stage: "prepare", deadlineAt, windowStartAt: deadlineAt - CONTENT_DELIVERY_WINDOW_MS,
        profileHash: schedule.profileHash, connectionHash: schedule.connectionHash, revisions: 0, replacements: 0,
        discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] }, createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(topic._id, { status: "queued", updatedAt: Date.now() });
    return { scheduled: 1, mode: "buffer_fill", activeJobId: jobId };
  },
});

export async function contentWorkCompleted(ctx: MutationCtx, job: Doc<"jobs">) {
  if (!job.contentWork) return;
  if (!job.articleId) {
    await ctx.db.patch(job._id, { status: "failed", contentWork: { ...job.contentWork, stage: "failed", failure: "candidate_rejected_before_draft" } });
    await wake(ctx, job.siteId!);
    return;
  }
  const article = await ctx.db.get(job.articleId), cw = job.contentWork;
  if (!article || article.siteId !== job.siteId) throw new Error("Content work artifact crossed tenant boundary");
  const stage = article.status === "published" ? (article.publicUrlStatus === "verified" ? "verified" : "verify")
    : isSealedReady(article) ? "ready" : "review_failed";
  if (stage === "ready" && job.providerSpendReservationId && cw.providerCalls.length > 0 && cw.providerCalls.every(c => c.state === "completed" && c.actualMicroUsd !== undefined)) {
    await settleSharedProviderReservation(ctx, { reservationId: job.providerSpendReservationId, siteId: job.siteId!, purpose: "content_work",
      actualMicroUsd: cw.providerCalls.reduce((sum, c) => sum + c.actualMicroUsd!, 0), reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
  }
  await ctx.db.patch(job._id, { contentWork: { ...cw, stage,
    approvedArtifactHash: stage === "ready" ? article.auditedContentHash : cw.approvedArtifactHash,
    publishedAt: article.publishedAt, verifiedAt: article.publicUrlVerifiedAt } });
  await wake(ctx, job.siteId!);
}

export async function contentWorkVerified(ctx: MutationCtx, site: Doc<"sites">, article: Doc<"articles">, checkedAt: number) {
  if (site.serviceMode !== "growth_first" || !site.contentSchedule) return;
  const jobs = await ctx.db.query("jobs").withIndex("by_site_article", q => q.eq("siteId", site._id).eq("articleId", article._id)).take(20);
  const job = jobs.find(j => j.contentWork?.approvedArtifactHash === article.publishedContentHash);
  if (!job?.contentWork || job.contentWork.stage === "verified") return;
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
  if (receipt.settledAt === undefined && receipt.releasedAt === undefined) {
    if (cw.providerCalls.length === 0) {
      await releaseSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
        reason: "content_work_closed_before_provider_execution", timestamp: Date.now() });
    } else if (cw.providerCalls.every(c => c.state === "completed" && c.actualMicroUsd !== undefined)) {
      await settleSharedProviderReservation(ctx, { reservationId: receipt._id, siteId: job.siteId, purpose: "content_work",
        actualMicroUsd: cw.providerCalls.reduce((sum, c) => sum + c.actualMicroUsd!, 0),
        reason: "verified_provider_receipt_actual_cost", timestamp: Date.now() });
    }
  }
  await ctx.db.patch(job._id, { contentWork: { ...cw, stage: "failed", failure: cw.failure ?? "worker_failed_review_required" } });
}

export const beginProviderCall = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), ceilingMicroUsd: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), cw = job?.contentWork, site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    if (!job || !cw || !site || job.workerToken !== args.workerToken || job.status !== "running" ||
      (job.leaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) ||
      !(await contentEntitlementAuthorized(ctx, site)) || !site.githubToken || confirmedContentProfileHash(site) !== cw.profileHash ||
      contentConnectionHash(site) !== cw.connectionHash) throw new Error("Content provider authority changed");
    const receipt = job.providerSpendReservationId ? await ctx.db.get(job.providerSpendReservationId) : null;
    if (!receipt || receipt.siteId !== site._id || receipt.userId !== site.userId || receipt.purpose !== "content_work" ||
      receipt.releasedAt !== undefined || receipt.settledAt !== undefined || receipt.reservedMicroUsd !== cw.budgetMicroUsd) throw new Error("Content provider reservation unavailable");
    if (new Date(receipt.createdAt).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) throw new Error("Content reservation accounting day expired; no cross-window provider replay");
    if (cw.providerCalls.some(c => c.key === args.key)) throw new Error("Content provider response already attempted; reconcile before replay");
    const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
    if (!Number.isSafeInteger(args.ceilingMicroUsd) || args.ceilingMicroUsd <= 0 || used + args.ceilingMicroUsd > cw.budgetMicroUsd || cw.providerCalls.length >= 20) throw new Error("Content work budget exhausted");
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls: [...cw.providerCalls, { key: args.key, ceilingMicroUsd: args.ceilingMicroUsd, state: "started" }] } });
  },
});
export const completeProviderCall = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), actualMicroUsd: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), cw = job?.contentWork;
    const call = cw?.providerCalls.find(c => c.key === args.key);
    if (!job || !cw || !call || job.workerToken !== args.workerToken || (job.leaseExpiresAt ?? 0) <= Date.now() ||
      !Number.isSafeInteger(args.actualMicroUsd) || args.actualMicroUsd < 0 || args.actualMicroUsd > call.ceilingMicroUsd) throw new Error("Content provider receipt invalid; reserved ceiling retained");
    if (call.state === "completed" && call.actualMicroUsd !== args.actualMicroUsd) throw new Error("Content provider settlement conflict");
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls: cw.providerCalls.map(c => c.key === args.key ? { ...c, state: "completed" as const, actualMicroUsd: args.actualMicroUsd } : c) } });
  },
});
