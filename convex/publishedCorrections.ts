import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { artifactSnapshot, effectiveBase, rolloutAllowsRevision, recentTenantRevisionCount } from "./publishedRevisions";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { publicationArtifactHash, publicationDeliveryConfig, publicationDeliveryConfigHash, sha256Hex, PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import { publishedArticlePublicUrl } from "./lib/publicationLive";
import { publishedRevisionKey, MAX_PUBLISHED_REVISIONS_PER_TENANT_24H, type PublishedRevisionArtifact } from "./lib/publishedRevision";
import { correctionInputHash, validatePublishedCorrection, validateCorrectionDestinations, PUBLISHED_CORRECTION_VERSION,
  MAX_CORRECTION_AUDITS_PER_SITE_DAY, CORRECTION_AUDIT_TIMEOUT_MS } from "./lib/publishedCorrection";

const proposalValidator = v.object({ title: v.string(), metaTitle: v.string(), metaDescription: v.string(), markdown: v.string() });
const auditValidator = v.object({ editorialScore: v.number(), factCheckScore: v.number(),
  materialDefects: v.array(v.string()), notes: v.array(v.string()),
  claimEvidence: v.array(v.object({ claim: v.string(), citationNumbers: v.array(v.number()), supported: v.boolean(), reason: v.string() })),
});

async function context(ctx: MutationCtx | QueryCtx, siteId: Id<"sites">, articleId: Id<"articles">) {
  const [site, article] = await Promise.all([ctx.db.get(siteId), ctx.db.get(articleId)]);
  if (!site || !article || article.siteId !== siteId || !articleMatchesCurrentDomain(site, article) ||
    !rolloutAllowsRevision(site) || !(await siteExecutionAuthorized(ctx, site)) ||
    (site.publishMethod ?? "github") !== "github") {
    throw new Error("Editorial correction requires an authorized current GitHub publication");
  }
  const base = await effectiveBase(ctx, site, article);
  const configHash = publicationDeliveryConfigHash(publicationDeliveryConfig(site));
  const productEvidence = article.productEvidenceSnapshot ?? "";
  if (configHash !== base.artifact.publicationConfigHash ||
    sha256Hex(productEvidence) !== base.artifact.productEvidenceHash) {
    throw new Error("Editorial correction lost its sealed destination or evidence snapshot");
  }
  return { site, article, base, configHash, productEvidence };
}

async function boundContext(ctx: MutationCtx | QueryCtx, audit: Doc<"published_correction_audits">) {
  const c = await context(ctx, audit.siteId, audit.articleId);
  if (audit.version !== PUBLISHED_CORRECTION_VERSION || c.base.artifactHash !== audit.baseArtifactHash ||
    c.configHash !== audit.publicationConfigHash || (c.site.autopilotRolloutEpoch ?? 0) !== audit.rolloutEpoch ||
    c.base.artifact.productEvidenceHash !== audit.productEvidenceHash ||
    correctionInputHash({ siteId: String(audit.siteId), articleId: String(audit.articleId),
      baseArtifactHash: audit.baseArtifactHash, productEvidenceHash: audit.productEvidenceHash,
      reason: audit.reason, proposal: audit.proposal }) !== audit.inputHash) {
    throw new Error("Editorial correction input or current publication changed after authorization");
  }
  return c;
}

/** Internal operator/actuator entry point. No arbitrary score or receipt is
 * accepted: the scheduled independent reviewer owns the result. */
export const requestAuditInternal = internalMutation({
  args: { siteId: v.id("sites"), articleId: v.id("articles"), expectedBaseArtifactHash: v.string(),
    reason: v.string(), proposal: proposalValidator },
  handler: async (ctx, args) => {
    if (!args.reason.trim() || args.reason.length > 2000 || args.proposal.markdown.length > 60_000 ||
      !args.proposal.title.trim() || args.proposal.title.length > 200 ||
      args.proposal.metaTitle.length > 200 || args.proposal.metaDescription.length > 500) {
      throw new Error("Invalid bounded correction proposal");
    }
    const c = await context(ctx, args.siteId, args.articleId);
    if (c.base.artifactHash !== args.expectedBaseArtifactHash) throw new Error("Correction proposal has a stale publication base");
    validateCorrectionDestinations(c.base.artifact.markdown, args.proposal.markdown);
    const inputHash = correctionInputHash({ siteId: String(args.siteId), articleId: String(args.articleId),
      baseArtifactHash: c.base.artifactHash, productEvidenceHash: c.base.artifact.productEvidenceHash!,
      reason: args.reason, proposal: args.proposal });
    const existing = await ctx.db.query("published_correction_audits")
      .withIndex("by_input", q => q.eq("inputHash", inputHash)).unique();
    if (existing) return { auditId: existing._id, status: existing.status, existing: true };
    const now = Date.now();
    const recent = await ctx.db.query("published_correction_audits")
      .withIndex("by_site_created", q => q.eq("siteId", args.siteId).gte("createdAt", now - 86_400_000))
      .take(MAX_CORRECTION_AUDITS_PER_SITE_DAY);
    if (recent.length >= MAX_CORRECTION_AUDITS_PER_SITE_DAY || recent.some(row => ["prepared", "attempted"].includes(row.status))) {
      throw new Error("Correction audit is already active or its bounded daily allowance is exhausted");
    }
    if (await recentTenantRevisionCount(ctx, args.siteId, now) >= MAX_PUBLISHED_REVISIONS_PER_TENANT_24H) {
      throw new Error("Published revision daily allowance is exhausted");
    }
    const auditId = await ctx.db.insert("published_correction_audits", {
      siteId: args.siteId, articleId: args.articleId, inputHash, version: PUBLISHED_CORRECTION_VERSION,
      baseArtifactHash: c.base.artifactHash, publicationConfigHash: c.configHash,
      rolloutEpoch: c.site.autopilotRolloutEpoch ?? 0, productEvidenceHash: c.base.artifact.productEvidenceHash!,
      reason: args.reason, proposal: args.proposal, status: "prepared", createdAt: now, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.auditPublishedCorrectionInternal, { auditId });
    await ctx.scheduler.runAfter(CORRECTION_AUDIT_TIMEOUT_MS, internal.publishedCorrections.expireAuditInternal, { auditId });
    return { auditId, status: "prepared" as const, existing: false };
  },
});

export const claimAuditInternal = internalMutation({
  args: { auditId: v.id("published_correction_audits"), workerToken: v.string() },
  handler: async (ctx, { auditId, workerToken }) => {
    const audit = await ctx.db.get(auditId);
    if (!audit || audit.status !== "prepared") return { claimed: false };
    try {
      if (Date.now() >= audit.createdAt + CORRECTION_AUDIT_TIMEOUT_MS) throw new Error("Audit start expired");
      await boundContext(ctx, audit);
    } catch {
      await ctx.db.patch(auditId, { status: "failed", completedAt: Date.now(), updatedAt: Date.now(),
        failureDetail: "The publication, tenant authorization, or sealed evidence changed before the audit. No provider request was made." });
      return { claimed: false };
    }
    const now = Date.now();
    await ctx.db.patch(auditId, { status: "attempted", workerToken, attemptedAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(CORRECTION_AUDIT_TIMEOUT_MS, internal.publishedCorrections.expireAuditInternal, { auditId });
    return { claimed: true };
  },
});

export const getAuditContextInternal = internalQuery({
  args: { auditId: v.id("published_correction_audits"), workerToken: v.string() },
  handler: async (ctx, { auditId, workerToken }) => {
    const audit = await ctx.db.get(auditId);
    if (!audit || audit.status !== "attempted" || audit.workerToken !== workerToken) throw new Error("Correction audit lost its worker");
    const c = await boundContext(ctx, audit);
    return { audit, base: c.base.artifact, productEvidence: c.productEvidence,
      productName: c.site.siteName ?? c.site.domain };
  },
});

export const completeAuditInternal = internalMutation({
  args: { auditId: v.id("published_correction_audits"), workerToken: v.string(), nextArtifact: v.any(), audit: auditValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.auditId);
    if (!row || row.status !== "attempted" || row.workerToken !== args.workerToken) throw new Error("Correction audit lost its worker");
    if (!row.attemptedAt || Date.now() >= row.attemptedAt + CORRECTION_AUDIT_TIMEOUT_MS) throw new Error("Correction audit exceeded its bounded execution window");
    const c = await boundContext(ctx, row);
    const next = artifactSnapshot(args.nextArtifact as PublishedRevisionArtifact);
    if (next.title !== row.proposal.title || next.metaTitle !== row.proposal.metaTitle ||
      next.metaDescription !== row.proposal.metaDescription ||
      args.audit.materialDefects.length || args.audit.editorialScore !== next.editorialQualityScore ||
      args.audit.factCheckScore !== next.factCheckScore ||
      JSON.stringify(args.audit.claimEvidence) !== JSON.stringify(next.claimEvidence)) {
      throw new Error("Correction audit does not match the proposed publication");
    }
    validatePublishedCorrection({ base: c.base.artifact, next, productEvidence: c.productEvidence });
    const now = Date.now();
    if (await recentTenantRevisionCount(ctx, row.siteId, now) >= MAX_PUBLISHED_REVISIONS_PER_TENANT_24H) throw new Error("Another revision consumed the daily allowance");
    const nextArtifactHash = publicationArtifactHash(next);
    const revisionKey = publishedRevisionKey({ siteId: String(row.siteId), articleId: String(row.articleId),
      actionFingerprint: row.inputHash, kind: "editorial_correction", baseArtifactHash: c.base.artifactHash,
      nextArtifactHash, baseReceipt: c.base.receipt });
    const revisionId = await ctx.db.insert("published_article_revisions", {
      siteId: row.siteId, articleId: row.articleId, correctionAuditId: row._id,
      actionFingerprint: row.inputHash, kind: "editorial_correction", revisionKey, status: "prepared",
      rolloutEpoch: row.rolloutEpoch, publicationConfigHash: row.publicationConfigHash,
      publicationDate: c.base.publicationDate,
      expectedPublicUrl: publishedArticlePublicUrl({ domain: c.site.domain, urlStructure: c.site.urlStructure, slug: next.slug }),
      baseAuditVersion: c.base.auditVersion, baseArtifactHash: c.base.artifactHash,
      baseArtifact: c.base.artifact, baseReceipt: c.base.receipt,
      nextArtifactHash, nextAuditVersion: PUBLICATION_AUDIT_VERSION, nextArtifact: next,
      attempts: 0, liveVerificationAttempts: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(row._id, { status: "passed", completedAt: now, updatedAt: now,
      nextArtifactHash, revisionId, audit: args.audit });
    await ctx.scheduler.runAfter(0, internal.publisher.executePublishedRevisionInternal, { revisionId });
    return { status: "prepared" as const, revisionId, nextArtifactHash };
  },
});

export const failAuditInternal = internalMutation({
  args: { auditId: v.id("published_correction_audits"), workerToken: v.string(), detail: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.auditId);
    if (!row || row.status !== "attempted" || row.workerToken !== args.workerToken) return { recorded: false, status: row?.status ?? "unavailable" };
    await ctx.db.patch(row._id, { status: "failed", completedAt: Date.now(), updatedAt: Date.now(), failureDetail: args.detail.slice(0, 1500) });
    return { recorded: true, status: "failed" as const };
  },
});

export const expireAuditInternal = internalMutation({
  args: { auditId: v.id("published_correction_audits") },
  handler: async (ctx, { auditId }) => {
    const row = await ctx.db.get(auditId);
    if (!row || !["prepared", "attempted"].includes(row.status) ||
      Date.now() < (row.attemptedAt ?? row.createdAt) + CORRECTION_AUDIT_TIMEOUT_MS) return;
    await ctx.db.patch(auditId, { status: row.status === "prepared" ? "failed" : "ambiguous", updatedAt: Date.now(), completedAt: Date.now(),
      failureDetail: row.status === "prepared" ? "The bounded audit never started; no provider request was made." :
        "The bounded audit did not settle. No provider replay or external publication was authorized." });
  },
});

export const getStatusInternal = internalQuery({
  args: { siteId: v.id("sites"), auditId: v.id("published_correction_audits") },
  handler: async (ctx, { siteId, auditId }) => {
    const row = await ctx.db.get(auditId);
    if (!row || row.siteId !== siteId) return null;
    return { auditId, articleId: row.articleId, status: row.status, inputHash: row.inputHash,
      baseArtifactHash: row.baseArtifactHash, nextArtifactHash: row.nextArtifactHash,
      revisionId: row.revisionId, attemptedAt: row.attemptedAt, completedAt: row.completedAt,
      failureDetail: row.failureDetail };
  },
});
