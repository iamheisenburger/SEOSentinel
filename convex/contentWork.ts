import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { contentIntentConflicts, evaluateTopicBusinessFit, tenantDiscoveryAnchors, tenantTopicBusinessSignals, isSealedReady } from "./lib/autopilotBuffer";
import { publicationArtifactHash, publicationDeliveryConfig } from "./lib/publicationArtifact";
import { siteCanonicalDomain, siteCanonicalDomainRevision, takeCurrentDomainTopics, contentAnalysisMatchesCurrentDomain, pageMatchesCurrentDomain, articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "./lib/providerSpendReservation";
import { planCheckpointTopicExecutionLocked } from "./lib/planCandidateCheckpoint";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import type { CadenceScheduleResult } from "./lib/autopilotRunOutcome";
import { liveAutopilotReadiness } from "./lib/autopilotReadiness";
import { contentConnectionHash, confirmedContentProfileHash, contentConnectionComplete, contentConsentToken } from "./lib/contentSelection";
import { contentFunding, contentIssue } from "./lib/contentCustomer";
import { assertSafeImprovement } from "./lib/contentSelection";
import { authorizedWorkPage, chooseImprovement, enrollVerifiedCreation, selectionConnection } from "./selectedPages";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
export { confirmedContentProfileHash } from "./lib/contentSelection";

export const CONTENT_DELIVERY_WINDOW_MS = 5 * 60_000;
export const MAX_CONTENT_RECOVERIES = 3;
const LIMIT = 1000;
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
      (j.contentWork && !["verified", "failed"].includes(j.contentWork.stage)))) throw new Error("Reconcile in-flight content work before switching engines");
    const revisions = await ctx.db.query("published_article_revisions").withIndex("by_site_created", q => q.eq("siteId", site._id)).take(LIMIT + 1);
    if (revisions.length > LIMIT || revisions.some(r => r.contentWorkJobId && r.attemptedAt && !r.liveVerifiedAt && !r.ambiguityDispositionAt)) {
      throw new Error("Reconcile the uncertain selected-page delivery before switching engines");
    }
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
      verified = contentConnectionComplete(site) && publisherDestinationReceiptVerified({ site });
      bindingCurrent = !s || (s.profileHash === confirmedContentProfileHash(site) && s.connectionHash === contentConnectionHash(site));
    } catch { /* Incomplete destination is actionable readiness, not a query crash. */ }
    return { siteId, setupPending: Boolean(site.contentSetupRequestedAt && !site.serviceMode), serviceMode: site.serviceMode ?? "legacy_articles", reviewToken: contentConsentToken(site),
      profile: { name: site.siteName ?? site.domain, summary: site.siteSummary ?? "", audience: site.targetAudienceSummary ?? "", productUsage: site.productUsage ?? "", offerings: site.keyFeatures ?? [] },
      destination: { kind: site.publishMethod ?? "manual", domain: site.domain, repository: site.publishMethod === "github" ? `${site.repoOwner ?? ""}/${site.repoName ?? ""}` : null,
        branch: site.repoDefaultBranch ?? null, contentDirectory: directory, verified },
      entitlement: await contentEntitlementAuthorized(ctx, site), enabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
      bindingCurrent,
      schedule: s ? { active: s.active, paused: s.paused, nextDeadlineAt: s.nextDeadlineAt, intervalMs: s.intervalMs, timezone: s.timezone ?? "UTC" } : null,
      funding: await contentFunding(ctx, site, pricingConfiguration()?.budgetMicroUsd),
      complete: jobs.length <= LIMIT, ready: jobs.filter(j => j.contentWork?.stage === "ready").length,
      work: jobs.filter(j => j.contentWork).map(j => ({ jobId: j._id, articleId: j.articleId,
        intent: j.contentWork!.intent, operation: j.contentWork!.operation,
        stage: j.contentWork!.stage, deadlineAt: j.contentWork!.deadlineAt, windowStartAt: j.contentWork!.windowStartAt,
        publishedAt: j.contentWork!.publishedAt, verifiedAt: j.contentWork!.verifiedAt, failure: contentIssue(j.contentWork!.failure ?? j.error) })) };
  },
});

/** Pause is not cancellation: retain ready work, leases, attempts and costs.
 * Resume can only wake the same binding; changed facts require reconciliation. */
export const control = mutation({ args: { siteId: v.id("sites"), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("retry")), reviewToken: v.string() },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId), s = site.contentSchedule;
    if (site.serviceMode !== "growth_first" || !s) throw new Error("Choose growth-first service first");
    if (args.action === "pause") {
      await ctx.db.patch(site._id, { contentSchedule: { ...s, paused: true }, updatedAt: Date.now() });
      await wake(ctx, site._id); return;
    }
    if (args.reviewToken !== contentConsentToken(site) || s.profileHash !== confirmedContentProfileHash(site) || s.connectionHash !== contentConnectionHash(site)) throw new Error("Business or destination changed. Reconcile existing work before reviewing a new service selection.");
    if (!await contentEntitlementAuthorized(ctx, site) || !contentConnectionComplete(site) || site.approvalRequired) throw new Error("Verify billing, publishing and automatic-publication consent before resuming");
    if (args.action === "resume") await ctx.db.patch(site._id, { contentSchedule: { ...s, paused: false }, autopilotEnabled: true,
      autopilotRolloutMode: s.active ? "live" : "warm", updatedAt: Date.now() });
    if (args.action === "retry" && s.paused) throw new Error("Resume the paused service before retrying");
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
    const all = await jobsForSite(ctx, siteId, schedule.nextDeadlineAt), work = all.filter(j => j.contentWork);
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
      const funding = await contentFunding(ctx, site, pricingConfiguration()?.budgetMicroUsd);
      if (funding.status !== "available") return { scheduled: 0, mode: "content_budget_exhausted" };
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
    const pricing = pricingConfiguration();
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
    const budget = await reserveSharedProviderBudget(ctx, { siteId, userId: site.userId!, purpose: "content_work",
      trigger: `content_slot:${deadlineAt}`, reservedMicroUsd: pricing.budgetMicroUsd, timestamp: Date.now() });
    if (!budget.ok) return { scheduled: 0, mode: "content_budget_exhausted", blockers: [budget.reason] };
    const { budgetMicroUsd, ...price } = pricing;
    const jobId = await ctx.db.insert("jobs", { siteId, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", workerAttempts: 0, publicationAttempts: 0,
      providerSpendReservationId: budget.reservationId,
      payload: { topicId: topic._id, bufferFill: true, options: { includeImages: false, includeYouTube: false } },
      contentWork: { intent: improvement ? "improve" : "create", ...(improvement ? { targetPageId: improvement.page._id,
          baseRevision: improvement.page.editable!.sourceRevision, permissionVersion: improvement.page.editable!.version, opportunity: improvement.reason,
          editTarget: improvement.editTarget } : {}),
        stage: "prepare", deadlineAt, windowStartAt: deadlineAt - CONTENT_DELIVERY_WINDOW_MS,
        profileHash: schedule.profileHash, connectionHash: schedule.connectionHash, revisions: 0, replacements: 0,
        discardedArticleIds: [], budgetMicroUsd, pricing: price, providerCalls: [] }, createdAt: Date.now(), updatedAt: Date.now() });
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
  if (!job?.contentWork || job.contentWork.stage === "verified") return;
  if (job.contentWork.intent === "create") await enrollVerifiedCreation(ctx, site, article, job);
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
  const used = cw.providerCalls.reduce((sum, c) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0);
  const failure = uncertain ? "content_provider_result_ambiguous_reconciliation_required"
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
    if (previousCalls.some(c => c.state === "started")) throw new Error("Content provider response already attempted; reconcile before replay");
    if (previousCalls.length > MAX_CONTENT_RECOVERIES) throw new Error("Content checkpoint retry limit exhausted");
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
    if (new Date(receipt.createdAt).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
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
      reservationId: receipt._id, ceilingMicroUsd: args.ceilingMicroUsd, state: "started" }] } });
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
    if (call.state === "rejected" || (call.state === "completed" && (call.actualMicroUsd !== args.actualMicroUsd || JSON.stringify(call.result) !== JSON.stringify(args.result)))) throw new Error("Content provider settlement conflict");
    const providerCalls = cw.providerCalls.map(c => c.key === args.key ? { ...c, state: "completed" as const, actualMicroUsd: args.actualMicroUsd, result: args.result } : c);
    if (new TextEncoder().encode(JSON.stringify(providerCalls)).length > 700_000) throw new Error("Content checkpoint storage bound exceeded; reserved ceiling retained");
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls } });
  },
});

export const recordProviderRejection = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string(), key: v.string(), status: v.number(), code: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId), cw = job?.contentWork, call = cw?.providerCalls.find(c => c.key === args.key);
    const known = (args.status === 429 && args.code === "rate_limit_error") || ([503, 529].includes(args.status) && args.code === "overloaded_error");
    if (!known || !job || job.status !== "running" || job.workerToken !== args.workerToken || (job.leaseExpiresAt ?? 0) <= Date.now() ||
      !cw || !call || call.state === "completed") throw new Error("Content rejection receipt invalid; original ceiling retained");
    if (call.state === "rejected" && (call.rejectionStatus !== args.status || call.rejectionCode !== args.code)) throw new Error("Content rejection receipt changed");
    await ctx.db.patch(job._id, { contentWork: { ...cw, providerCalls: cw.providerCalls.map(c => c.key === args.key
      ? { ...c, state: "rejected" as const, rejectionStatus: args.status, rejectionCode: args.code } : c) } });
  },
});
