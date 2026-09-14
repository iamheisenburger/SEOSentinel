import { internalMutation, internalQuery, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { authorizedWorkPage } from "./selectedPages";
import { assertSafeImprovement, contentConnectionHash, confirmedContentProfileHash } from "./lib/contentSelection";
import { isSealedReady } from "./lib/autopilotBuffer";
import { artifactSnapshot } from "./lib/revisionArtifact";
import { publicationArtifactHash, publicationDeliveryConfig, publicationDeliveryConfigHash, sha256Hex } from "./lib/publicationArtifact";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import { PUBLICATION_LEASE_MS } from "./lib/publicationLease";
import { archiveConsumedImprovementArtifact } from "./articles";
import type { Doc, Id } from "./_generated/dataModel";
import { siteCanonicalDomain, siteCanonicalDomainRevision } from "./lib/siteDomainBinding";
import { verifyCorrectivePatch } from "./lib/contentCorrection";

async function correctionOwner(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || identity?.subject !== site.userId || site.serviceMode !== "growth_first" ||
    !await siteExecutionAuthorized(ctx, site) || !site.autopilotEnabled || site.autopilotRolloutMode !== "live" || site.approvalRequired ||
    site.contentSchedule?.paused) throw new Error("Active owner-authorized corrective work required");
  return site;
}
async function verifiedDestination(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, id?: Id<"pages">) {
  const page = id ? await ctx.db.get(id) : null;
  if (!page || page.siteId !== site._id || !page.editable?.active) throw new Error("Correction destination is not an authorized exact-site page");
  const revision = page.editable.latestRevisionId ? await ctx.db.get(page.editable.latestRevisionId) : null;
  const article = page.editable.managedArticleId ? await ctx.db.get(page.editable.managedArticleId) : null;
  if (!(revision?.siteId === site._id && revision.liveVerifiedAt && revision.deliveredSource?.revision === page.editable.sourceRevision) &&
    !(article?.siteId === site._id && article.publicUrlStatus === "verified" && article.publicUrl === page.url &&
      article.contentWorkCreationSource?.sourceRevision === page.editable.sourceRevision)) throw new Error("Correction destination has no matching verified live artifact");
  return page;
}
export const correctionContext = internalQuery({ args: { siteId: v.id("sites"), pageId: v.id("pages"), targetPageId: v.optional(v.id("pages")) },
  handler: async (ctx, args) => {
    const site = await correctionOwner(ctx, args.siteId), page = await ctx.db.get(args.pageId);
    if (!page?.editable?.active || page.siteId !== site._id || page.editable.profileHash !== confirmedContentProfileHash(site) ||
      page.editable.connectionHash !== contentConnectionHash(site)) throw new Error("Corrective source permission or business profile changed");
    return { site, page, target: args.targetPageId ? await verifiedDestination(ctx, site, args.targetPageId) : null };
  } });
export const priorCorrection = internalQuery({ args: { siteId: v.id("sites"), pageId: v.id("pages"), baseRevision: v.string(),
  kind: v.union(v.literal("factual_correction"), v.literal("technical_repair")), before: v.string(), reason: v.string(),
  field: v.optional(v.union(v.literal("siteSummary"), v.literal("productUsage"))), targetPageId: v.optional(v.id("pages")) },
  handler: async (ctx, args) => {
    await correctionOwner(ctx, args.siteId);
    const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", args.siteId)).take(501);
    if (jobs.length > 500) throw new Error("Corrective work inventory incomplete");
    return jobs.find(j => { const cw = j.contentWork, c = cw?.correction; return cw?.targetPageId === args.pageId &&
      cw.baseRevision === args.baseRevision && c?.kind === args.kind && c.before === args.before && c.reason === args.reason &&
      c.field === args.field && c.targetPageId === args.targetPageId; })?._id ?? null;
  } });
const correctivePatch = v.object({ kind: v.union(v.literal("factual_correction"), v.literal("technical_repair")),
  before: v.string(), after: v.string(), sourceBefore: v.string(), sourceAfter: v.string(), reason: v.string(),
  field: v.optional(v.union(v.literal("siteSummary"), v.literal("productUsage"))),
  targetUrl: v.optional(v.string()), brokenUrl: v.optional(v.string()) });
export const requestCorrection = internalMutation({ args: { siteId: v.id("sites"), pageId: v.id("pages"), baseRevision: v.string(),
  permissionVersion: v.number(), patch: correctivePatch, targetPageId: v.optional(v.id("pages")), observedAt: v.number() },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const site = await correctionOwner(ctx, args.siteId);
    const key = sha256Hex(JSON.stringify([site._id, args.pageId, args.baseRevision, args.permissionVersion, args.patch, args.targetPageId]));
    const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
    if (jobs.length > 500) throw new Error("Corrective work inventory is incomplete");
    const prior = jobs.find(j => j.contentWork?.correction?.key === key);
    if (prior) return prior._id;
    const page = await ctx.db.get(args.pageId), e = page?.editable;
    if (!page || !e?.active || page.siteId !== site._id || e.sourceRevision !== args.baseRevision || e.version !== args.permissionVersion ||
      e.profileHash !== confirmedContentProfileHash(site) || e.connectionHash !== contentConnectionHash(site) ||
      site.contentSchedule?.profileHash !== e.profileHash || site.contentSchedule?.connectionHash !== e.connectionHash ||
      site.publicationLeaseOwner || jobs.some(j => ["pending", "running"].includes(j.status))) throw new Error("Reconcile active work or changed source before correction");
    if (args.observedAt > Date.now() || Date.now() - args.observedAt > 60_000) throw new Error("Correction evidence must be current");
    if (args.patch.kind === "technical_repair") {
      const target = await verifiedDestination(ctx, site, args.targetPageId);
      if (target.url !== args.patch.targetUrl) throw new Error("Broken-link destination changed");
    } else if (args.targetPageId) throw new Error("Factual corrections cannot add destinations");
    const markdown = verifyCorrectivePatch(site, page, args.patch);
    const artifact = { title: e.title, slug: page.slug, markdown, metaTitle: e.metaTitle, metaDescription: e.description,
      publicationConfigHash: publicationDeliveryConfigHash(publicationDeliveryConfig(site)) };
    const approvedArtifactHash = publicationArtifactHash(artifact);
    const articleId = await ctx.db.insert("articles", { ...artifact, siteId: site._id, status: "revision",
      canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      publicationConfigHash: publicationDeliveryConfigHash(publicationDeliveryConfig(site)), createdAt: Date.now(), updatedAt: Date.now() });
    const jobId = await ctx.db.insert("jobs", { siteId: site._id, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", articleId, workerAttempts: 0, publicationAttempts: 0,
      payload: { articleId, publishOnly: true, bufferDelivery: true },
      contentWork: { intent: "improve", operation: args.patch.kind, correction: { ...args.patch, key, observedAt: args.observedAt,
        ...(args.targetPageId ? { targetPageId: args.targetPageId } : {}) }, stage: "publish", targetPageId: page._id,
        baseRevision: e.sourceRevision, permissionVersion: e.version, approvedArtifactHash,
        profileHash: e.profileHash, connectionHash: e.connectionHash, deadlineAt: Date.now(), windowStartAt: Date.now(),
        revisions: 0, replacements: 0, discardedArticleIds: [], budgetMicroUsd: 0, providerCalls: [],
        pricing: { model: "provider-free-owner-correction", inputMicroUsdPerToken: 0, outputMicroUsdPerToken: 0 },
        opportunity: "Owner-confirmed exact correction; not scheduled SEO delivery or growth" }, createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(articleId, { contentWorkSourceJobId: jobId, contentWorkConsumedByJobId: jobId });
    await ctx.db.patch(page._id, { editable: { ...e, lastWorkJobId: jobId } });
    await ctx.scheduler.runAfter(0, internal.autopilot.dispatchSiteFollowup, { siteId: site._id, trigger: "content_work", reason: "owner_confirmed_correction" });
    return jobId;
  } });

async function assertCorrection(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, page: Doc<"pages">, job: Doc<"jobs">, article: Doc<"articles">) {
  const cw = job.contentWork!, correction = cw.correction;
  if (!correction || cw.operation !== correction.kind || cw.budgetMicroUsd !== 0 || cw.providerCalls.length || job.providerSpendReservationId ||
    article.markdown !== verifyCorrectivePatch(site, page, correction) || publicationArtifactHash(article) !== cw.approvedArtifactHash ||
    article.contentWorkSourceJobId !== job._id || article.publicationConfigHash !== publicationDeliveryConfigHash(publicationDeliveryConfig(site))) throw new Error("Correction lost exact source, evidence or provider-free authority");
  if (correction.kind === "technical_repair" && (await verifiedDestination(ctx, site, correction.targetPageId)).url !== correction.targetUrl) throw new Error("Correction target changed before write");
}

export const requestRollback = mutation({ args: { siteId: v.id("sites"), revisionId: v.id("published_article_revisions"), confirm: v.boolean() },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const site = await ctx.db.get(args.siteId), identity = await ctx.auth.getUserIdentity();
    if (!args.confirm || !site?.userId || identity?.subject !== site.userId || site.serviceMode !== "growth_first" ||
      !await siteExecutionAuthorized(ctx, site)) throw new Error("Owner-authorized rollback required");
    const r = await ctx.db.get(args.revisionId), original = r?.contentWorkJobId ? await ctx.db.get(r.contentWorkJobId) : null;
    if (!r || r.siteId !== site._id || !original?.contentWork || !r.selectedPageId || !r.deliveredSource || !r.liveVerifiedAt) throw new Error("Only a verified exact-site content revision can be rolled back");
    const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
    if (jobs.length > 500) throw new Error("Rollback work inventory is incomplete");
    const existing = jobs.find(j => j.contentWork?.rollbackOfRevisionId === r._id);
    if (existing) return existing._id;
    const page = await ctx.db.get(r.selectedPageId), e = page?.editable;
    if (!page || !e?.active || page.siteId !== site._id || e.latestRevisionId !== r._id ||
      e.sourceRevision !== r.deliveredSource.revision || e.profileHash !== confirmedContentProfileHash(site) ||
      e.connectionHash !== contentConnectionHash(site) || site.publicationLeaseOwner ||
      jobs.some(j => ["pending","running"].includes(j.status))) throw new Error("Reconcile active work or changed page permissions before rollback");
    const jobId = await ctx.db.insert("jobs", { siteId: site._id, canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, type: "article", status: "pending", articleId: r.articleId, workerAttempts: 0, publicationAttempts: 0,
      payload: { articleId: r.articleId, publishOnly: true, bufferDelivery: true },
      contentWork: { intent: "improve", operation: "rollback", rollbackOfRevisionId: r._id, stage: "publish",
        targetPageId: page._id, baseRevision: e.sourceRevision, permissionVersion: e.version,
        approvedArtifactHash: r.baseArtifactHash, profileHash: e.profileHash, connectionHash: e.connectionHash,
        deadlineAt: Date.now(), windowStartAt: Date.now(), revisions: 0, replacements: 0, discardedArticleIds: [],
        budgetMicroUsd: 0, pricing: original.contentWork.pricing, providerCalls: [], opportunity: "Owner-requested restoration; not SEO delivery or growth" },
      createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(page._id, { editable: { ...e, lastWorkJobId: jobId } });
    await ctx.scheduler.runAfter(0, internal.autopilot.dispatchSiteFollowup, { siteId: site._id, trigger: "content_work", reason: "owner_requested_conditional_rollback" });
    return jobId;
  } });

const claimArgs = { siteId: v.id("sites"), jobId: v.id("jobs"), workerToken: v.string() };
export const claim = internalMutation({ args: claimArgs, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId), site = await ctx.db.get(args.siteId), cw = job?.contentWork;
  if (!job || !cw || cw.intent !== "improve" || !site || job.siteId !== site._id || job.status !== "running" ||
    job.workerToken !== args.workerToken || (job.leaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) ||
    !await siteExecutionAuthorized(ctx, site) || site.approvalRequired || site.contentSchedule?.paused ||
    cw.profileHash !== confirmedContentProfileHash(site) || cw.connectionHash !== contentConnectionHash(site) ||
    site.autopilotRolloutMode !== "live" || !site.autopilotEnabled) throw new Error("Improvement delivery authority changed");
  const page = await authorizedWorkPage(ctx, site, job);
  let article = job.articleId ? await ctx.db.get(job.articleId) : null;
  const rollback = cw.operation === "rollback" && cw.rollbackOfRevisionId ? await ctx.db.get(cw.rollbackOfRevisionId) : null;
  const correction = cw.correction;
  if (cw.operation && cw.operation !== "rollback" && !correction) throw new Error("Missing exact corrective evidence");
  if (correction && page && article) await assertCorrection(ctx, site, page, job, article);
  if (cw.operation === "rollback") {
    if (!article || !rollback?.liveVerifiedAt || rollback.siteId !== site._id || rollback.selectedPageId !== page?._id ||
      rollback.baseArtifactHash !== cw.approvedArtifactHash || rollback.deliveredSource?.revision !== cw.baseRevision) throw new Error("Rollback no longer matches the exact retained version");
    article = { ...article, ...rollback.baseArtifact, auditedContentHash: rollback.baseArtifactHash } as Doc<"articles">;
  }
  if (!page?.editable || !article || article.siteId !== site._id || (!rollback && !correction && (!isSealedReady(article) ||
    article.auditedContentHash !== cw.approvedArtifactHash || publicationArtifactHash(article) !== cw.approvedArtifactHash ||
    article.publicationConfigHash !== publicationDeliveryConfigHash(publicationDeliveryConfig(site)))) ||
    !["publish","verify","verified"].includes(cw.stage)) throw new Error("Improvement lost its reviewed artifact");
  if (!rollback && !correction) assertSafeImprovement(page.editable, article, cw.editTarget);
  let revision = cw.revisionId ? await ctx.db.get(cw.revisionId) : null;
  if (revision?.receipt) return { revision, page, article, site, rollback, correction, editTarget: cw.editTarget, deferredUntil: null };
  if (Date.now() < cw.windowStartAt) throw new Error("Improvement is outside its fixed delivery window");
  if (site.publicationLeaseOwner && site.publicationLeaseOwner !== revision?.leaseOwner &&
    (site.publicationLeaseExpiresAt ?? 0) > Date.now()) return { revision: null, page, article, site, rollback, correction, editTarget: cw.editTarget, deferredUntil: site.publicationLeaseExpiresAt! };
  // A vanished lease does not erase an uncertain write on another record.
  for (const status of ["leased","attempted","unverified"] as const) {
    const others = await ctx.db.query("published_article_revisions").withIndex("by_site_status", q => q.eq("siteId", site._id).eq("status", status)).take(101);
    if (others.length > 100 || others.some(r => r._id !== revision?._id && !r.receipt)) throw new Error("Reconcile the previous destination write before improving another page");
  }
  if (!revision) {
    const base = { title: page.editable.title, slug: article.slug, markdown: page.editable.markdown,
      metaTitle: page.editable.metaTitle, metaDescription: page.editable.description };
    const baseHash = publicationArtifactHash(base), revisionKey = sha256Hex(JSON.stringify([job._id, cw.baseRevision, cw.approvedArtifactHash]));
    const id = await ctx.db.insert("published_article_revisions", {
      siteId: site._id, articleId: article._id, contentWorkJobId: job._id, selectedPageId: page._id,
      selectedSource: page.editable, actionFingerprint: cw.opportunity ?? "selected_page_improvement", kind: rollback ? "rollback" : correction?.kind === "factual_correction" ? "editorial_correction" : correction ? "renderer_repair" : "content_improvement",
      ...(rollback ? { rollbackOfRevisionId: rollback._id } : {}),
      revisionKey, status: "prepared", rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      publicationConfigHash: article.publicationConfigHash!, publicationDate: 0, expectedPublicUrl: page.url,
      baseArtifactHash: baseHash, baseArtifact: base,
      // Imported source observation, NOT an assertion that Pentra published it.
      baseReceipt: { method: page.editable.kind, deliveryKey: `selected:${sha256Hex(page.editable.sourceContent)}`,
        contentHash: baseHash, externalId: page.editable.sourceRevision, url: page.url, status: "selected_source", receivedAt: page.editable.selectedAt },
      nextArtifactHash: cw.approvedArtifactHash!, nextArtifact: rollback ? rollback.baseArtifact : artifactSnapshot(article),
      attempts: 0, liveVerificationAttempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
    });
    revision = (await ctx.db.get(id))!;
    await ctx.db.patch(job._id, { contentWork: { ...cw, revisionId: id } });
  }
  if (revision.attempts >= 3) throw new Error("Improvement publication retry bound reached; reconciliation required");
  await ctx.db.patch(revision._id, { status: "leased", leaseOwner: args.workerToken, leaseStartedAt: Date.now(), updatedAt: Date.now() });
  await ctx.db.patch(site._id, { publicationLeaseOwner: args.workerToken, publicationLeaseExpiresAt: Date.now() + PUBLICATION_LEASE_MS });
  return { revision: (await ctx.db.get(revision._id))!, page, article, site, rollback, correction, editTarget: cw.editTarget, deferredUntil: null };
} });
export const attempted = internalMutation({ args: { ...claimArgs, revisionId: v.id("published_article_revisions") }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId), site = await ctx.db.get(args.siteId), revision = await ctx.db.get(args.revisionId);
  if (!job || !site || job.workerToken !== args.workerToken || job.status !== "running" || (job.leaseExpiresAt ?? 0) <= Date.now() ||
    revision?.contentWorkJobId !== job._id || revision.leaseOwner !== args.workerToken || site.publicationLeaseOwner !== args.workerToken ||
    (site.publicationLeaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) || !await siteExecutionAuthorized(ctx, site) ||
    site.approvalRequired || site.contentSchedule?.paused || !site.autopilotEnabled || site.autopilotRolloutMode !== "live") throw new Error("Improvement mutation authority changed");
  const page = await authorizedWorkPage(ctx, site, job);
  const article = job.articleId ? await ctx.db.get(job.articleId) : null;
  if (job.contentWork?.correction && page && article) await assertCorrection(ctx, site, page, job, article);
  if (job.contentWork?.correction && revision.nextArtifactHash !== job.contentWork.approvedArtifactHash) throw new Error("Corrective revision changed before the write");
  if (!job.contentWork?.operation && (!article || !isSealedReady(article) ||
    publicationArtifactHash(article) !== revision.nextArtifactHash || article.auditedContentHash !== revision.nextArtifactHash ||
    article.publicationConfigHash !== publicationDeliveryConfigHash(publicationDeliveryConfig(site)))) throw new Error("Reviewed improvement changed before the write");
  if (revision.receipt) return;
  await ctx.db.patch(revision._id, { status: "attempted", attemptedAt: revision.attemptedAt ?? Date.now(),
    attempts: revision.attempts + 1, updatedAt: Date.now() });
} });
const receipt = v.object({ method: v.union(v.literal("github"), v.literal("wordpress")), deliveryKey: v.string(), contentHash: v.string(),
  externalId: v.string(), url: v.string(), status: v.string(), receivedAt: v.number() });
export const delivered = internalMutation({ args: { ...claimArgs, revisionId: v.id("published_article_revisions"), receipt,
  sourceContent: v.string(), sourceRevision: v.string(), permission: v.optional(v.string()) }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId), site = await ctx.db.get(args.siteId), r = await ctx.db.get(args.revisionId);
  if (!job?.contentWork || !site || job.siteId !== site._id || r?.contentWorkJobId !== job._id ||
    r.leaseOwner !== args.workerToken || !r.attemptedAt || args.receipt.deliveryKey !== `pentra:${r.revisionKey}` ||
    args.receipt.contentHash !== r.nextArtifactHash || !args.sourceRevision || !args.sourceContent ||
    args.receipt.method !== r.baseReceipt.method || args.receipt.receivedAt < r.attemptedAt) throw new Error("Improvement receipt mismatch");
  // Receipt recording survives revocation after an already-authorized write.
  // It does not authorize another external mutation or call it live-verified.
  await ctx.db.patch(r._id, { status: "verification_pending", receipt: { ...args.receipt, revisionKey: r.revisionKey,
    baseContentHash: r.baseArtifactHash, baseExternalId: r.baseReceipt.externalId },
    deliveredSource: { content: args.sourceContent, revision: args.sourceRevision, permission: args.permission },
    deliveryVerifiedAt: Date.now(), leaseOwner: undefined, leaseStartedAt: undefined, updatedAt: Date.now() });
  await ctx.db.patch(job._id, { contentWork: { ...job.contentWork, stage: "verify", verificationNextAt: Date.now(), publishedAt: args.receipt.receivedAt } });
  if (site.publicationLeaseOwner === args.workerToken) await ctx.db.patch(site._id, { publicationLeaseOwner: undefined, publicationLeaseExpiresAt: undefined });
  await ctx.scheduler.runAfter(0, internal.publisher.verifyContentImprovement, { siteId: site._id, jobId: job._id });
} });
export const claimVerification = internalMutation({ args: { siteId: v.id("sites"), jobId: v.id("jobs"), leaseOwner: v.string() }, handler: async (ctx, args) => {
  const site = await ctx.db.get(args.siteId), job = await ctx.db.get(args.jobId), cw = job?.contentWork;
  if (!site || !job || job.siteId !== site._id || !cw?.revisionId || cw.intent !== "improve" || cw.stage !== "verify") return null;
  const revision = await ctx.db.get(cw.revisionId);
  if (revision?.contentWorkJobId !== job._id || !revision.receipt || cw.connectionHash !== contentConnectionHash(site)) return null;
  if ((revision.liveVerificationLeaseExpiresAt ?? 0) > Date.now() || (cw.verificationNextAt ?? 0) > Date.now()) return null;
  if (revision.liveVerificationAttempts >= 5) {
    await ctx.db.patch(revision._id, { status: "failed", failureDetail: "Bounded verification attempts exhausted; reconcile live destination", updatedAt: Date.now() });
    await ctx.db.patch(job._id, { contentWork: { ...cw, stage: "failed", failure: "improvement_live_artifact_not_verified" } });
    return null;
  }
  const expiresAt = Date.now() + 60_000;
  await ctx.db.patch(revision._id, { liveVerificationAttempts: revision.liveVerificationAttempts + 1,
    liveVerificationLeaseOwner: args.leaseOwner, liveVerificationLeaseExpiresAt: expiresAt });
  await ctx.db.patch(job._id, { contentWork: { ...cw, verificationNextAt: expiresAt } });
  // Durable watchdog survives the action dying after its claim. Duplicate
  // wakeups cannot consume attempts while the exact verifier lease is active.
  await ctx.scheduler.runAt(expiresAt, internal.publisher.verifyContentImprovement, { siteId: site._id, jobId: job._id });
  return { site, job, revision: (await ctx.db.get(revision._id))! };
} });
export const verified = internalMutation({ args: { siteId: v.id("sites"), jobId: v.id("jobs"), leaseOwner: v.string(), nextArtifactHash: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId), job = await ctx.db.get(args.jobId), cw = job?.contentWork;
    if (!site || !job || job.siteId !== site._id || !cw?.revisionId || cw.stage !== "verify") return;
    const r = await ctx.db.get(cw.revisionId), page = cw.targetPageId ? await ctx.db.get(cw.targetPageId) : null;
    if (!r?.receipt || r.liveVerificationLeaseOwner !== args.leaseOwner || (r.liveVerificationLeaseExpiresAt ?? 0) <= Date.now()) return;
    if (r.nextArtifactHash !== args.nextArtifactHash || r.contentWorkJobId !== job._id ||
      !page?.editable || page.siteId !== site._id || cw.connectionHash !== contentConnectionHash(site)) throw new Error("Live improvement proof binding changed");
    const attempts = r.liveVerificationAttempts;
    if (args.error) {
      await ctx.db.patch(r._id, { liveVerificationLeaseOwner: undefined, liveVerificationLeaseExpiresAt: undefined, failureDetail: args.error.slice(0, 400),
        status: attempts < 5 ? "verification_pending" : "failed", updatedAt: Date.now() });
      if (attempts < 5) {
        await ctx.db.patch(job._id, { contentWork: { ...cw, verificationNextAt: Date.now() + attempts * 30_000 } });
        await ctx.scheduler.runAfter(attempts * 30_000, internal.publisher.verifyContentImprovement, { siteId: args.siteId, jobId: args.jobId });
      }
      else await ctx.db.patch(job._id, { contentWork: { ...cw, stage: "failed", failure: "improvement_live_artifact_not_verified" } });
      return;
    }
    await ctx.db.patch(r._id, { status: "verified", liveVerificationLeaseOwner: undefined, liveVerificationLeaseExpiresAt: undefined,
      failureDetail: undefined, liveVerifiedAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(job._id, { contentWork: { ...cw, stage: "verified", verificationNextAt: undefined, verifiedAt: Date.now() } });
    if (!cw.operation) await archiveConsumedImprovementArtifact(ctx, job.articleId!, job._id);
    const source = r.deliveredSource as { content: string; revision: string; permission?: string };
    const artifact = r.nextArtifact as { markdown: string; title: string; metaTitle?: string; metaDescription?: string };
    // Do not resurrect a revoked/reselected permission while recording history.
    if (page.editable.version === cw.permissionVersion && page.editable.sourceRevision === cw.baseRevision) await ctx.db.patch(page._id, {
      editable: { ...page.editable, sourceContent: source.content, sourceRevision: source.revision,
        markdown: artifact.markdown, title: artifact.title, metaTitle: artifact.metaTitle ?? artifact.title,
        description: artifact.metaDescription ?? "", permission: source.permission ?? page.editable.permission,
        header: page.editable.kind === "github" ? source.content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/)?.[1] : undefined,
        lastImprovedAt: cw.operation ? page.editable.lastImprovedAt : Date.now(), latestRevisionId: r._id, lastWorkJobId: job._id } });
    if (!cw.operation && site.contentSchedule?.nextDeadlineAt === cw.deadlineAt) await ctx.db.patch(site._id, {
      contentSchedule: { ...site.contentSchedule, nextDeadlineAt: site.contentSchedule.nextDeadlineAt + site.contentSchedule.intervalMs }, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.autopilot.dispatchSiteFollowup, { siteId: site._id, trigger: "content_work", reason: "verified_improvement_refill" });
  } });
