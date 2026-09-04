import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  publicationArtifactHash,
  publicationArtifactHashForAuditVersion,
  assertSupportedPublicationAdapterVersion,
  assertSupportedPublicationRendererVersion,
  publicationAdapterConfigHashForVersion,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryDestinationHash,
  publicationDeliveryKey,
  PUBLICATION_AUDIT_VERSION,
  sha256Hex,
  type PublicationArtifact,
} from "./lib/publicationArtifact";
import {
  publishedArticlePublicUrl,
  selectVerifiedAuthorityTargets,
  verifiedAuthorityTarget,
} from "./lib/publicationLive";
import {
  acquirePublishedRevisionLease,
  deterministicInternalLinkRevision,
  deterministicSnippetRevision,
  legacyGitHubReceiptAdoptionKey,
  LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
  MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS,
  MAX_PUBLISHED_REVISIONS_PER_TENANT_24H,
  PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
  PUBLISHED_REVISION_LEASE_MS,
  publishedRevisionKey,
  rollbackRevisionArtifact,
  validateDeterministicRevision,
  validatePublishedRevisionReceipt,
  type PublishedRevisionArtifact,
  type PublishedRevisionReceipt,
} from "./lib/publishedRevision";
import { publishedArticleInternalHref } from "./lib/internalLinks";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./lib/publicationReceipts";
import {
  executionLeasePredatesPlanTransition,
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import { reviewedAmbiguityDispositionAllowed } from "./lib/publicationLease";
import {
  articleMatchesCurrentDomain,
  collectCurrentDomainArticles,
  gscConnectionMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";
import {
  cadenceIntervalMs,
  effectivePublishedAt,
  isSealedReady,
} from "./lib/autopilotBuffer";
import { CADENCE_MICRO_SEED_VERSION } from "./lib/cadenceMicroSeed";
import {
  primaryFallbackReceiptFingerprint,
  semanticCandidateExhaustionVerified,
} from "./cadenceMicroSeed";
import {
  CADENCE_REVISION_RECOVERY_VERSION,
  cadenceRevisionRecoveryReceiptValid,
  effectiveCadencePublicationAt,
  type CadenceRevisionExhaustionAttempt,
} from "./lib/cadenceRevision";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_VERIFICATION_LEASE_MS = 2 * 60 * 1000;
const MAX_LIVE_VERIFICATION_RECOVERIES = 20;
const LEGACY_ADOPTION_LEASE_MS = 10 * 60 * 1000;
const MAX_LEGACY_ADOPTIONS_PER_TENANT_24H = 1;
const REVIEWED_AMBIGUITY_CONFIRMATION =
  "ABANDON UNVERIFIED DELIVERY AND RETAIN AUDIT";

function sealedRevisionDeliveryConfig(article: Doc<"articles">) {
  if (!article.publicationConfigSnapshot || !article.publicationConfigHash) {
    throw new Error("Published revision lost its initial destination seal");
  }
  const config = publicationDeliveryConfig(article.publicationConfigSnapshot);
  if (publicationDeliveryConfigHash(config) !== article.publicationConfigHash) {
    throw new Error("Published revision destination seal is inconsistent");
  }
  return config;
}

function attemptedRevisionAdapterContract(
  site: Doc<"sites">,
  article: Doc<"articles">,
  revision: Doc<"published_article_revisions">,
): {
  adapterVersion?: string;
  adapterConfigHash?: string;
  rendererVersion?: string;
} | null {
  const sealed = sealedRevisionDeliveryConfig(article);
  if (sealed.method !== "wordpress" && sealed.method !== "webhook") return {};
  const adapterVersion = revision.adapterVersionAtAttempt ??
    site.publicationAdapterVersion;
  const adapterConfigHash = revision.adapterConfigHashAtAttempt ??
    site.publicationAdapterConfigHash;
  const rendererVersion = revision.rendererVersionAtAttempt ??
    sealed.rendererVersion;
  if (!adapterVersion || !adapterConfigHash || !rendererVersion) return null;
  try {
    assertSupportedPublicationAdapterVersion(adapterVersion);
    assertSupportedPublicationRendererVersion(rendererVersion);
  } catch {
    return null;
  }
  return Boolean(
    rendererVersion === sealed.rendererVersion &&
    site.publicationAdapterVersion === adapterVersion &&
    site.publicationAdapterConfigHash === adapterConfigHash &&
    (site.publicationAdapterVerifiedAt ?? 0) > 0 &&
    publicationAdapterConfigHashForVersion(site, adapterVersion) ===
      adapterConfigHash
  )
    ? { adapterVersion, adapterConfigHash, rendererVersion }
    : null;
}

async function growthRevisionMeasurementCurrent(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  revision: Doc<"published_article_revisions">,
): Promise<boolean> {
  if (!revision.growthActionId) return true;
  const action = await ctx.db.get(revision.growthActionId);
  return Boolean(
    action &&
    action.siteId === site._id &&
    action.status === "open" &&
    action.fingerprint === revision.actionFingerprint &&
    action.measurementKey === revision.growthMeasurementKey &&
    gscConnectionMatchesCurrentDomain(site) &&
    action.measurementCanonicalDomain === siteCanonicalDomain(site) &&
    action.measurementDomainRevision === siteCanonicalDomainRevision(site) &&
    action.measurementGscConnectionRevision ===
      siteGscConnectionRevision(site) &&
    action.measurementGscProperty === site.gscProperty &&
    action.measurementGscSyncEpoch === site.gscSyncEpoch &&
    action.measurementGscDataThrough === site.gscDataThrough
  );
}

async function revisionTargetStillCurrent(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  revision: Doc<"published_article_revisions">,
): Promise<boolean> {
  if (revision.kind !== "strengthen_cluster") return true;
  if (!revision.targetArticleId || !revision.targetUrl) return false;
  const target = await ctx.db.get(revision.targetArticleId);
  if (!target || target.siteId !== site._id) return false;
  const verified = verifiedAuthorityTarget({
    site,
    article: target,
    now: Date.now(),
  });
  if (!verified || verified.articleId !== revision.targetArticleId) return false;
  try {
    return new URL(verified.targetUrl).pathname === revision.targetUrl;
  } catch {
    return false;
  }
}

async function assertNoOtherUnresolvedPublication(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  revisionId: Id<"published_article_revisions">,
) {
  for (const status of ["leased", "attempted"] as const) {
    const rows = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", status)
      )
      .take(2);
    if (rows.some((row) => row._id !== revisionId)) {
      throw new Error("Another published revision delivery is unresolved");
    }
  }
  const ambiguous = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", siteId).eq("status", "unverified")
    )
    .filter((q) => q.eq(q.field("receipt"), undefined))
    .take(2);
  if (ambiguous.some((row) => row._id !== revisionId)) {
    throw new Error("Another published revision delivery is unverified");
  }
}

const revisionReceiptValidator = v.object({
  method: v.union(v.literal("github"), v.literal("wordpress"), v.literal("webhook")),
  revisionKey: v.string(),
  deliveryKey: v.string(),
  baseContentHash: v.string(),
  baseExternalId: v.string(),
  contentHash: v.string(),
  externalId: v.string(),
  url: v.string(),
  status: v.string(),
  receivedAt: v.number(),
});

const legacyAdoptionReceiptValidator = v.object({
  method: v.literal("github"),
  deliveryKey: v.string(),
  contentHash: v.string(),
  externalId: v.string(),
  url: v.string(),
  status: v.string(),
  receivedAt: v.number(),
});

function artifactSnapshot(
  article: PublicationArtifact & { title: string; slug: string; markdown: string },
): PublishedRevisionArtifact {
  return {
    title: article.title,
    slug: article.slug,
    markdown: article.markdown,
    articleType: article.articleType,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    metaKeywords: "metaKeywords" in article
      ? (article as { metaKeywords?: string[] }).metaKeywords
      : undefined,
    language: article.language,
    featuredImage: article.featuredImage,
    reviewedMediaUrls: article.reviewedMediaUrls,
    readingTime: article.readingTime,
    wordCount: article.wordCount,
    factCheckScore: article.factCheckScore,
    contentScore: article.contentScore,
    editorialQualityScore: article.editorialQualityScore,
    mediaQualityStatus: article.mediaQualityStatus,
    productEvidenceStatus: article.productEvidenceStatus,
    claimEvidenceStatus: article.claimEvidenceStatus,
    claimEvidence: article.claimEvidence,
    researchEvidenceSummary: article.researchEvidenceSummary,
    productEvidenceHash: article.productEvidenceHash,
    publicationConfigHash: article.publicationConfigHash,
    sources: article.sources,
    internalLinks: article.internalLinks,
  };
}

function isFinalRevision(
  revision: Doc<"published_article_revisions">,
): boolean {
  return revision.status === "verified" || revision.status === "rolled_back";
}

function revisionBaseAuditVersion(
  revision: Doc<"published_article_revisions">,
): number {
  return revision.baseAuditVersion ?? PUBLICATION_AUDIT_VERSION;
}

function revisionNextAuditVersion(
  revision: Doc<"published_article_revisions">,
): number {
  return revision.nextAuditVersion ?? PUBLICATION_AUDIT_VERSION;
}

async function latestFinalRevision(
  ctx: MutationCtx | QueryCtx,
  articleId: Id<"articles">,
) {
  const [verified, rolledBack] = await Promise.all([
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_article_status_created", (q) =>
        q.eq("articleId", articleId).eq("status", "verified"),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_article_status_created", (q) =>
        q.eq("articleId", articleId).eq("status", "rolled_back"),
      )
      .order("desc")
      .first(),
  ]);
  if (!verified) return rolledBack;
  if (!rolledBack) return verified;
  return verified.createdAt >= rolledBack.createdAt ? verified : rolledBack;
}

async function effectiveBase(
  ctx: MutationCtx | QueryCtx,
  site: Doc<"sites">,
  article: Doc<"articles">,
): Promise<{
  artifact: PublishedRevisionArtifact;
  artifactHash: string;
  receipt: PublicationReceipt;
  publicationDate: number;
  auditVersion: number;
}> {
  const latest = await latestFinalRevision(ctx, article._id);
  if (latest) {
    const artifact = artifactSnapshot(
      latest.nextArtifact as PublishedRevisionArtifact,
    );
    if (
      !latest.receipt ||
      publicationArtifactHashForAuditVersion(
        artifact,
        revisionNextAuditVersion(latest),
      ) !== latest.nextArtifactHash
    ) {
      throw new Error("Latest published revision is missing its exact receipt or artifact");
    }
    validatePublishedRevisionReceipt({
      receipt: latest.receipt as PublishedRevisionReceipt,
      method: latest.baseReceipt.method,
      revisionKey: latest.revisionKey,
      baseArtifactHash: latest.baseArtifactHash,
      nextArtifactHash: latest.nextArtifactHash,
      baseExternalId: latest.baseReceipt.externalId,
    });
    return {
      artifact,
      artifactHash: latest.nextArtifactHash,
      receipt: {
        method: latest.receipt.method,
        deliveryKey: latest.receipt.deliveryKey,
        contentHash: latest.receipt.contentHash,
        externalId: latest.receipt.externalId,
        url: latest.receipt.url,
        status: latest.receipt.status,
        receivedAt: latest.receipt.receivedAt,
      },
      publicationDate: latest.publicationDate,
      auditVersion: revisionNextAuditVersion(latest),
    };
  }

  if (
    article.status !== "published" ||
    !article.publicationReceipt ||
    !article.publishedContentHash ||
    !article.publicationDate
  ) {
    throw new Error("Published article has no exact external publication receipt");
  }
  const receipt = validatePublicationReceipt(article.publicationReceipt);
  const artifact = artifactSnapshot(article);
  const auditVersion = article.publicationAuditVersion ?? PUBLICATION_AUDIT_VERSION;
  if (
    publicationArtifactHashForAuditVersion(artifact, auditVersion) !==
      article.publishedContentHash ||
    receipt.contentHash !== article.publishedContentHash ||
    receipt.method !== (site.publishMethod ?? "github")
  ) {
    throw new Error("Published article receipt does not match its immutable artifact");
  }
  return {
    artifact,
    artifactHash: article.publishedContentHash,
    receipt,
    publicationDate: article.publicationDate,
    auditVersion,
  };
}

function rolloutAllowsRevision(site: Doc<"sites">): boolean {
  return Boolean(
    siteExecutionActive(site) &&
    site.autopilotEnabled &&
    (site.autopilotRolloutMode === "warm" || site.autopilotRolloutMode === "live") &&
    !site.deletionStatus,
  );
}

async function currentRevisionArticle(
  ctx: QueryCtx | MutationCtx,
  revision: Doc<"published_article_revisions">,
): Promise<{ site: Doc<"sites">; article: Doc<"articles"> } | null> {
  const [site, article] = await Promise.all([
    ctx.db.get(revision.siteId),
    ctx.db.get(revision.articleId),
  ]);
  if (
    !site ||
    !article ||
    article.siteId !== revision.siteId ||
    !articleMatchesCurrentDomain(site, article)
  ) return null;
  return { site, article };
}

function legacyGitHubAdoptionEligibility(
  site: Doc<"sites">,
  article: Doc<"articles">,
): null | {
  artifactHash: string;
  deliveryHash: string;
  deliveryKey: string;
  publicationConfigHash: string;
  publicationDate: number;
  expectedPublicUrl: string;
  adoptionKey: string;
} {
  try {
    if (
      !rolloutAllowsRevision(site) ||
      !articleMatchesCurrentDomain(site, article) ||
      (site.publishMethod ?? "github") !== "github" ||
      article.siteId !== site._id ||
      article.status !== "published" ||
      article.publicationReceipt ||
      article.publicationAuditVersion !== LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION ||
      !article.publishedContentHash ||
      article.auditedContentHash !== article.publishedContentHash ||
      !article.publicationDeliveryHash ||
      !article.publicationConfigHash ||
      !article.publicationConfigSnapshot ||
      !article.publicationDate ||
      !site.githubToken ||
      !site.repoOwner ||
      !site.repoName ||
      !site.repoDefaultBranch
    ) {
      return null;
    }
    const currentConfigHash = publicationDeliveryConfigHash(
      publicationDeliveryConfig(site),
    );
    const sealedConfigHash = publicationDeliveryConfigHash(
      publicationDeliveryConfig(article.publicationConfigSnapshot),
    );
    if (
      currentConfigHash !== article.publicationConfigHash ||
      sealedConfigHash !== article.publicationConfigHash
    ) {
      return null;
    }
    const artifactHash = publicationArtifactHashForAuditVersion(
      artifactSnapshot(article),
      LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
    );
    if (artifactHash !== article.publishedContentHash) return null;
    const deliveryKey = publicationDeliveryKey(article.publicationDeliveryHash);
    const expectedPublicUrl = publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    return {
      artifactHash,
      deliveryHash: article.publicationDeliveryHash,
      deliveryKey,
      publicationConfigHash: currentConfigHash,
      publicationDate: article.publicationDate,
      expectedPublicUrl,
      adoptionKey: legacyGitHubReceiptAdoptionKey({
        siteId: String(site._id),
        articleId: String(article._id),
        artifactHash,
        deliveryHash: article.publicationDeliveryHash,
        publicationConfigHash: currentConfigHash,
      }),
    };
  } catch {
    return null;
  }
}

async function requireOwner(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to access this site's published revisions");
  }
  return site;
}

async function recentTenantRevisionCount(
  ctx: MutationCtx | QueryCtx,
  siteId: Id<"sites">,
  now: number,
): Promise<number> {
  const recent = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_created", (q) =>
      q.eq("siteId", siteId).gte("createdAt", now - DAY_MS),
    )
    .take(MAX_PUBLISHED_REVISIONS_PER_TENANT_24H + 1);
  return recent.length;
}

function cadenceExhaustionAttempt(
  job: Doc<"cadence_micro_seed_jobs">,
): CadenceRevisionExhaustionAttempt {
  return {
    id: String(job._id),
    siteId: String(job.siteId),
    sourcePlanId: String(job.sourcePlanId),
    attemptKind: job.attemptKind,
    policyVersion: job.policyVersion,
    rolloutEpoch: job.rolloutEpoch,
    status: job.status,
    errorCode: job.errorCode,
    providerCallAttempted: job.providerCallAttempted,
    providerCallCompleted: job.providerCallCompleted,
    providerAttemptedAt: job.providerAttemptedAt,
    providerCompletedAt: job.providerCompletedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    candidateReceiptCount: job.candidateReceipts.length,
    candidateAudit: job.candidateAudit,
    candidateShortlistCount: job.candidateShortlist?.length ?? 0,
    candidateAttemptCount: job.candidateAttemptCount,
    priorCandidateAttemptCount: job.priorCandidateAttempts?.length ?? 0,
    hasSelectedOrTopicReceipt: Boolean(
      job.selectedCandidate ||
        job.topicId ||
        job.topicFingerprint ||
        job.plannedEvidenceFingerprint,
    ),
    hasEvidenceReceipt: Boolean(
      job.evidenceJobId ||
        job.evidenceQueueReason ||
        job.evidenceFinalizerScheduledAt,
    ),
    cadenceScheduleAttempts: job.cadenceScheduleAttempts ?? 0,
    hasCadenceScheduleReceipt: Boolean(
      job.cadenceScheduleRequestedAt ||
        job.cadenceScheduleMode ||
        job.cadenceScheduleScheduled !== undefined ||
        job.cadenceScheduleReceiptAt,
    ),
    finalizeAttempts: job.finalizeAttempts,
    workerToken: job.workerToken,
    leaseExpiresAt: job.leaseExpiresAt,
    parentMicroSeedJobId: job.parentMicroSeedJobId
      ? String(job.parentMicroSeedJobId)
      : undefined,
    parentMicroSeedReceiptFingerprint:
      job.parentMicroSeedReceiptFingerprint,
  };
}

async function latestVerifiedRevisionAt(
  ctx: MutationCtx | QueryCtx,
  site: Doc<"sites">,
): Promise<number | undefined> {
  const revisions = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", site._id).eq("status", "verified")
    )
    .order("desc")
    .take(50);
  let latest: number | undefined;
  for (const revision of revisions) {
    if (!Number.isSafeInteger(revision.liveVerifiedAt)) continue;
    const current = await currentRevisionArticle(ctx, revision);
    if (!current || current.site._id !== site._id) continue;
    latest = Math.max(latest ?? 0, revision.liveVerifiedAt!);
  }
  return latest;
}

export const getLatestVerifiedRevisionAtInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    const verifiedAt = await latestVerifiedRevisionAt(ctx, site);
    return verifiedAt === undefined ? null : { verifiedAt };
  },
});

/**
 * A mature tenant can exhaust safe new-page space while still benefiting from
 * crawl-path maintenance. At an exact due boundary, prepare one immutable,
 * strict-quality revision only after both current micro-seed attempts proved
 * that no non-cannibalizing page exists. A sealed new article always wins.
 */
export const prepareForCadenceRecovery = internalMutation({
  args: {
    siteId: v.id("sites"),
    dueAt: v.number(),
  },
  handler: async (ctx, args): Promise<{
    status: "prepared" | "existing" | "no_safe_candidate" | "bounded_wait";
    detail: string;
    revisionId?: Id<"published_article_revisions">;
  }> => {
    const site = await ctx.db.get(args.siteId);
    const timestamp = Date.now();
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !rolloutAllowsRevision(site) ||
      site.autopilotRolloutMode !== "live" ||
      site.approvalRequired ||
      (site.publishMethod ?? "github") === "manual"
    ) {
      return {
        status: "no_safe_candidate",
        detail: "Cadence revision recovery requires an executing autonomous tenant.",
      };
    }
    if ((site.publishMethod ?? "github") === "wordpress") {
      return {
        status: "no_safe_candidate",
        detail:
          "Automatic WordPress revisions require an atomic conditional-write adapter.",
      };
    }

    const tenantArticles = await collectCurrentDomainArticles(ctx, site);
    const sealedReady = tenantArticles.some((article) =>
      article.status === "ready" && isSealedReady(article)
    );
    if (sealedReady) {
      return {
        status: "no_safe_candidate",
        detail: "A sealed new article has priority over cadence revision recovery.",
      };
    }
    const articlePublishedAt = tenantArticles
      .filter((article) => article.status === "published")
      .reduce<number | undefined>((latest, article) => {
        const publishedAt = effectivePublishedAt({
          createdAt: article.createdAt,
          publishedAt: article.publishedAt,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        });
        return Math.max(latest ?? 0, publishedAt);
      }, undefined);
    const lastPublicationAt = effectiveCadencePublicationAt({
      articlePublishedAt,
      verifiedRevisionAt: await latestVerifiedRevisionAt(ctx, site),
    });
    const expectedDueAt = (lastPublicationAt ?? site.createdAt) +
      cadenceIntervalMs(site.cadencePerWeek ?? 4);
    if (
      !Number.isSafeInteger(args.dueAt) ||
      args.dueAt !== expectedDueAt ||
      timestamp < expectedDueAt
    ) {
      return {
        status: "no_safe_candidate",
        detail: "Cadence revision recovery is not at the exact current due boundary.",
      };
    }
    for (const status of [
      "prepared",
      "leased",
      "attempted",
      "verification_pending",
      "unverified",
    ] as const) {
      const unresolved = await ctx.db
        .query("published_article_revisions")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site._id).eq("status", status)
        )
        .first();
      if (unresolved) {
        return {
          status: "bounded_wait",
          detail:
            "An earlier immutable revision must settle before another cadence revision can be prepared.",
        };
      }
    }

    const recentJobs = await ctx.db
      .query("cadence_micro_seed_jobs")
      .withIndex("by_site_created", (q) => q.eq("siteId", site._id))
      .order("desc")
      .take(40);
    let exhaustion:
      | {
          child: Doc<"cadence_micro_seed_jobs">;
          parent: Doc<"cadence_micro_seed_jobs">;
        }
      | undefined;
    for (const child of recentJobs) {
      if (
        child.attemptKind !== "fallback" ||
        !child.parentMicroSeedJobId ||
        child.status !== "missed"
      ) continue;
      const parent = await ctx.db.get(child.parentMicroSeedJobId);
      const parentReservation = parent
        ? await ctx.db.get(parent.providerSpendReservationId)
        : null;
      if (
        parent &&
        parentReservation &&
        (parent.errorCode !== "semantic_failure" ||
          await semanticCandidateExhaustionVerified(ctx, site, parent)) &&
        (child.errorCode !== "semantic_failure" ||
          await semanticCandidateExhaustionVerified(ctx, site, child)) &&
        cadenceRevisionRecoveryReceiptValid({
          siteId: String(site._id),
          rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
          policyVersion: CADENCE_MICRO_SEED_VERSION,
          expectedParentReceiptFingerprint: primaryFallbackReceiptFingerprint(
            parent,
            parentReservation,
          ),
          parent: cadenceExhaustionAttempt(parent),
          child: cadenceExhaustionAttempt(child),
          now: timestamp,
        })
      ) {
        exhaustion = { child, parent };
        break;
      }
    }
    if (!exhaustion) {
      return {
        status: "no_safe_candidate",
        detail:
          "No current immutable primary-plus-fallback opportunity-exhaustion receipt exists.",
      };
    }

    let currentConfigHash: string;
    try {
      currentConfigHash = publicationDeliveryConfigHash(
        publicationDeliveryConfig(site),
      );
    } catch {
      return {
        status: "no_safe_candidate",
        detail: PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
      };
    }
    const verifiedTargets = selectVerifiedAuthorityTargets({
      site,
      articles: tenantArticles,
      now: timestamp,
    });
    const verifiedIds = new Set(
      verifiedTargets.map((target) => String(target.articleId)),
    );
    const sourceCandidates = tenantArticles
      .filter((article) =>
        article.status === "published" && verifiedIds.has(String(article._id))
      )
      .sort((a, b) =>
        (a.internalLinks?.length ?? 0) - (b.internalLinks?.length ?? 0) ||
        (a.publishedAt ?? a.createdAt) - (b.publishedAt ?? b.createdAt) ||
        String(a._id).localeCompare(String(b._id))
      );

    for (const article of sourceCandidates.slice(0, 25)) {
      let base: Awaited<ReturnType<typeof effectiveBase>>;
      try {
        base = await effectiveBase(ctx, site, article);
      } catch {
        continue;
      }
      if (
        !base.artifact.publicationConfigHash ||
        base.artifact.publicationConfigHash !== currentConfigHash
      ) continue;
      const liveDestinations = verifiedTargets
        .filter((target) => target.articleId !== article._id)
        .map((target) => ({
          href: publishedArticleInternalHref(site.urlStructure, target.slug),
          title: target.title,
          keywords: target.metaKeywords,
        }));
      let next: PublishedRevisionArtifact | null = null;
      try {
        next = deterministicInternalLinkRevision({
          artifact: base.artifact,
          urlStructure: site.urlStructure,
          liveDestinations,
        });
      } catch {
        next = null;
      }
      if (!next) continue;
      const baseHrefs = new Set(
        (base.artifact.internalLinks ?? []).map((link) => link.href),
      );
      const targetUrl = (next.internalLinks ?? []).find(
        (link) => !baseHrefs.has(link.href),
      )?.href;
      const target = verifiedTargets.find((candidate) =>
        publishedArticleInternalHref(site.urlStructure, candidate.slug) ===
          targetUrl
      );
      if (!targetUrl || !target) continue;

      const actionFingerprint = sha256Hex(JSON.stringify({
        version: CADENCE_REVISION_RECOVERY_VERSION,
        siteId: String(site._id),
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        dueAt: args.dueAt,
        microSeedJobId: String(exhaustion.child._id),
        parentMicroSeedJobId: String(exhaustion.parent._id),
      }));
      const nextArtifactHash = publicationArtifactHash(next);
      const revisionKey = publishedRevisionKey({
        siteId: String(site._id),
        articleId: String(article._id),
        actionFingerprint,
        kind: "strengthen_cluster",
        baseArtifactHash: base.artifactHash,
        nextArtifactHash,
        baseReceipt: base.receipt,
      });
      const duplicate = await ctx.db
        .query("published_article_revisions")
        .withIndex("by_key", (q) => q.eq("revisionKey", revisionKey))
        .unique();
      if (duplicate) {
        return {
          status: "existing",
          detail: `The exact cadence revision already exists in ${duplicate.status} state.`,
          revisionId: duplicate._id,
        };
      }
      const revisionId = await ctx.db.insert("published_article_revisions", {
        siteId: site._id,
        articleId: article._id,
        actionFingerprint,
        kind: "strengthen_cluster",
        revisionKey,
        status: "prepared",
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        cadenceMicroSeedJobId: exhaustion.child._id,
        cadenceDueAt: args.dueAt,
        publicationConfigHash: currentConfigHash,
        publicationDate: base.publicationDate,
        expectedPublicUrl: publishedArticlePublicUrl({
          domain: site.domain,
          urlStructure: site.urlStructure,
          slug: article.slug,
        }),
        baseAuditVersion: base.auditVersion,
        baseArtifactHash: base.artifactHash,
        baseArtifact: base.artifact,
        baseReceipt: base.receipt,
        nextArtifactHash,
        nextAuditVersion: PUBLICATION_AUDIT_VERSION,
        nextArtifact: next,
        targetArticleId: target.articleId,
        targetUrl,
        targetLiveVerifiedAt: target.publicUrlVerifiedAt,
        attempts: 0,
        liveVerificationAttempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        status: "prepared",
        detail:
          "Prepared one strict-quality crawl-path revision from exact cadence and live-target receipts.",
        revisionId,
      };
    }
    return {
      status: "no_safe_candidate",
      detail:
        "No exact relevant link between two recently verified tenant articles passed the strict revision gate.",
    };
  },
});

export const prepareForGrowthAction = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    fingerprint: v.string(),
    measurementKey: v.string(),
    actionKind: v.union(
      v.literal("improve_snippet"),
      v.literal("strengthen_cluster"),
    ),
  },
  handler: async (ctx, args): Promise<{
    status: "prepared" | "existing" | "no_safe_candidate" | "bounded_wait";
    detail: string;
    revisionId?: Id<"published_article_revisions">;
    repair?: "legacy_github_receipt_adoption";
  }> => {
    const [site, article, action] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.articleId),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
        .unique(),
    ]);
    if (
      !site ||
      !article ||
      article.siteId !== args.siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      !action ||
      action.siteId !== args.siteId ||
      action.articleId !== args.articleId ||
      action.actionKind !== args.actionKind ||
      action.status !== "open" ||
      action.measurementKey !== args.measurementKey
    ) {
      throw new Error("Published revision crossed a tenant, article, or action boundary");
    }
    if (!rolloutAllowsRevision(site)) {
      return {
        status: "no_safe_candidate",
        detail: "Published revisions are measurement-only unless this tenant is warm or live.",
      };
    }
    if ((site.publishMethod ?? "github") === "wordpress") {
      return {
        status: "no_safe_candidate",
        detail:
          "Automatic WordPress revisions require an atomic conditional-write adapter; WordPress core GET then POST cannot protect a concurrent customer edit.",
      };
    }

    const existing = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_action", (q) => q.eq("growthActionId", action._id))
      .first();
    if (existing) {
      if (
        existing.siteId !== args.siteId ||
        existing.articleId !== args.articleId ||
        existing.growthActionId !== action._id ||
        existing.actionFingerprint !== args.fingerprint
      ) {
        throw new Error("Existing published revision crossed a tenant boundary");
      }
      if (existing.status === "failed") {
        return {
          status: "no_safe_candidate",
          detail:
            "The action's deterministic revision reached a terminal failed state; Pentra skipped it so later safe candidates can continue.",
        };
      }
      // A newer measurement for the same semantic action must not strand a
      // deterministic revision that has never acquired a delivery lease or
      // produced any provider receipt. Rebind only this pristine state. Once
      // execution begins, the immutable measurement remains part of the
      // ambiguity/no-replay boundary and can never be rewritten.
      if (
        existing.status === "prepared" &&
        existing.attempts === 0 &&
        existing.leaseOwner === undefined &&
        existing.leaseStartedAt === undefined &&
        existing.attemptedAt === undefined &&
        existing.receipt === undefined &&
        existing.deliveryVerifiedAt === undefined &&
        existing.liveVerificationAttempts === 0 &&
        existing.liveVerificationLeaseOwner === undefined &&
        existing.liveVerificationLeaseExpiresAt === undefined &&
        existing.growthMeasurementKey !== args.measurementKey
      ) {
        await ctx.db.patch(existing._id, {
          growthMeasurementKey: args.measurementKey,
          updatedAt: Date.now(),
        });
      }
      return {
        status: "existing",
        detail: `The action already owns revision ${existing._id} in ${existing.status} state.`,
        revisionId: existing._id,
      };
    }
    const timestamp = Date.now();
    if (
      await recentTenantRevisionCount(ctx, args.siteId, timestamp) >=
        MAX_PUBLISHED_REVISIONS_PER_TENANT_24H
    ) {
      return {
        status: "bounded_wait",
        detail: "This tenant has already prepared its bounded published revision for the last 24 hours.",
      };
    }

    let currentConfigHash: string;
    let base: Awaited<ReturnType<typeof effectiveBase>>;
    let expectedPublicUrl: string;
    try {
      currentConfigHash = publicationDeliveryConfigHash(
        publicationDeliveryConfig(site),
      );
      base = await effectiveBase(ctx, site, article);
      expectedPublicUrl = publishedArticlePublicUrl({
        domain: site.domain,
        urlStructure: site.urlStructure,
        slug: article.slug,
      });
    } catch {
      const repair = legacyGitHubAdoptionEligibility(site, article)
        ? "legacy_github_receipt_adoption" as const
        : undefined;
      return {
        status: "no_safe_candidate",
        detail: repair
          ? "This legacy GitHub article needs bounded read-only receipt adoption before a revision can be prepared."
          : PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
        repair,
      };
    }
    if (
      !base.artifact.publicationConfigHash ||
      base.artifact.publicationConfigHash !== currentConfigHash
    ) {
      return {
        status: "no_safe_candidate",
        detail: "The current publishing destination no longer matches the immutable article seal.",
      };
    }

    let next: PublishedRevisionArtifact | null = null;
    let targetArticleId: Id<"articles"> | undefined;
    let targetUrl: string | undefined;
    let targetLiveVerifiedAt: number | undefined;

    if (args.actionKind === "improve_snippet") {
      const topic = article.topicId ? await ctx.db.get(article.topicId) : null;
      if (
        topic &&
        topic.siteId === args.siteId &&
        topicMatchesCurrentDomain(site, topic)
      ) {
        try {
          next = deterministicSnippetRevision({
            artifact: base.artifact,
            measuredKeyword: topic.primaryKeyword,
          });
          // WordPress core has no portable SEO-title field. Preserve the
          // visible post title and only revise the exact excerpt/description;
          // plugin-specific fields would not be a tenant-generic guarantee.
          if (next && site.publishMethod === "wordpress") {
            const wordpressCandidate = {
              ...next,
              metaTitle: base.artifact.metaTitle,
            };
            next = publicationArtifactHash(wordpressCandidate) === base.artifactHash
              ? null
              : validateDeterministicRevision({
                  base: base.artifact,
                  next: wordpressCandidate,
                  kind: "improve_snippet",
                });
          }
        } catch {
          next = null;
        }
      }
    } else {
      const tenantArticles = await collectCurrentDomainArticles(ctx, site);
      const verifiedTargets = selectVerifiedAuthorityTargets({
        site,
        articles: tenantArticles.filter((candidate) => candidate._id !== article._id),
        now: timestamp,
      });
      const liveDestinations = verifiedTargets.map((target) => ({
        href: publishedArticleInternalHref(site.urlStructure, target.slug),
        title: target.title,
        keywords: target.metaKeywords,
      }));
      try {
        next = deterministicInternalLinkRevision({
          artifact: base.artifact,
          urlStructure: site.urlStructure,
          liveDestinations,
        });
      } catch {
        next = null;
      }
      if (next) {
        const baseHrefs = new Set((base.artifact.internalLinks ?? []).map((link) => link.href));
        targetUrl = (next.internalLinks ?? []).find((link) => !baseHrefs.has(link.href))?.href;
        const target = verifiedTargets.find(
          (candidate) =>
            publishedArticleInternalHref(site.urlStructure, candidate.slug) === targetUrl,
        );
        targetArticleId = target?.articleId;
        targetLiveVerifiedAt = target?.publicUrlVerifiedAt;
        if (!targetArticleId || !targetUrl || !targetLiveVerifiedAt) next = null;
      }
    }

    if (!next) {
      return {
        status: "no_safe_candidate",
        detail: args.actionKind === "improve_snippet"
          ? "No deterministic metadata change could improve the measured snippet without inventing copy."
          : "No exact, relevant, recently verified same-tenant destination passed the internal-link gate.",
      };
    }
    const nextArtifactHash = publicationArtifactHash(next);
    const revisionKey = publishedRevisionKey({
      siteId: String(args.siteId),
      articleId: String(args.articleId),
      actionFingerprint: args.fingerprint,
      kind: args.actionKind,
      baseArtifactHash: base.artifactHash,
      nextArtifactHash,
      baseReceipt: base.receipt,
    });
    const duplicate = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_key", (q) => q.eq("revisionKey", revisionKey))
      .unique();
    if (duplicate) {
      return {
        status: "existing",
        detail: `The exact deterministic revision already exists in ${duplicate.status} state.`,
        revisionId: duplicate._id,
      };
    }
    const revisionId = await ctx.db.insert("published_article_revisions", {
      siteId: args.siteId,
      articleId: args.articleId,
      growthActionId: action._id,
      growthMeasurementKey: args.measurementKey,
      actionFingerprint: args.fingerprint,
      kind: args.actionKind,
      revisionKey,
      status: "prepared",
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      publicationConfigHash: currentConfigHash,
      publicationDate: base.publicationDate,
      expectedPublicUrl,
      baseAuditVersion: base.auditVersion,
      baseArtifactHash: base.artifactHash,
      baseArtifact: base.artifact,
      baseReceipt: base.receipt,
      nextArtifactHash,
      nextAuditVersion: PUBLICATION_AUDIT_VERSION,
      nextArtifact: next,
      targetArticleId,
      targetUrl,
      targetLiveVerifiedAt,
      attempts: 0,
      liveVerificationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(action._id, {
      publishedRevisionId: revisionId,
      automationStatus: "revision_prepared",
      automationDetail:
        "Prepared one deterministic immutable revision; external CAS and live receipt verification remain required.",
      updatedAt: timestamp,
    });
    return {
      status: "prepared",
      detail: "Prepared a deterministic revision against the exact immutable publication receipt.",
      revisionId,
    };
  },
});

export const claimLegacyGitHubReceiptAdoption = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    leaseOwner: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, article] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.articleId),
    ]);
    if (!site || !article || article.siteId !== site._id) {
      return { status: "not_eligible" as const };
    }
    const eligible = legacyGitHubAdoptionEligibility(site, article);
    if (!eligible) return { status: "not_eligible" as const };

    const timestamp = Date.now();
    const existing = await ctx.db
      .query("legacy_publication_receipt_adoptions")
      .withIndex("by_key", (q) => q.eq("adoptionKey", eligible.adoptionKey))
      .unique();
    if (existing) {
      if (existing.siteId !== site._id || existing.articleId !== article._id) {
        throw new Error("Legacy receipt adoption key crossed a tenant boundary");
      }
      if (existing.status === "verified") {
        return { status: "verified" as const, adoptionId: existing._id };
      }
      if (
        existing.status === "leased" &&
        existing.leaseStartedAt &&
        timestamp - existing.leaseStartedAt < LEGACY_ADOPTION_LEASE_MS
      ) {
        return { status: "bounded_wait" as const, adoptionId: existing._id };
      }
    }

    const recent = await ctx.db
      .query("legacy_publication_receipt_adoptions")
      .withIndex("by_site_updated", (q) =>
        q.eq("siteId", site._id).gte("lastAttemptAt", timestamp - DAY_MS),
      )
      .take(MAX_LEGACY_ADOPTIONS_PER_TENANT_24H);
    if (recent.length >= MAX_LEGACY_ADOPTIONS_PER_TENANT_24H) {
      return { status: "bounded_wait" as const, adoptionId: existing?._id };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "leased",
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        publicationConfigHash: eligible.publicationConfigHash,
        publicationDate: eligible.publicationDate,
        auditVersion: LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
        artifactHash: eligible.artifactHash,
        deliveryHash: eligible.deliveryHash,
        deliveryKey: eligible.deliveryKey,
        expectedPublicUrl: eligible.expectedPublicUrl,
        leaseOwner: args.leaseOwner,
        leaseStartedAt: timestamp,
        attempts: existing.attempts + 1,
        lastAttemptAt: timestamp,
        expectedExternalContentHash: undefined,
        failureCode: undefined,
        failureDetail: undefined,
        updatedAt: timestamp,
      });
      return { status: "claimed" as const, adoptionId: existing._id };
    }

    const adoptionId = await ctx.db.insert(
      "legacy_publication_receipt_adoptions",
      {
        siteId: site._id,
        articleId: article._id,
        adoptionKey: eligible.adoptionKey,
        status: "leased",
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        publicationConfigHash: eligible.publicationConfigHash,
        publicationDate: eligible.publicationDate,
        auditVersion: LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
        artifactHash: eligible.artifactHash,
        deliveryHash: eligible.deliveryHash,
        deliveryKey: eligible.deliveryKey,
        expectedPublicUrl: eligible.expectedPublicUrl,
        leaseOwner: args.leaseOwner,
        leaseStartedAt: timestamp,
        attempts: 1,
        lastAttemptAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    );
    return { status: "claimed" as const, adoptionId };
  },
});

export const getLegacyGitHubReceiptAdoptionContext = internalQuery({
  args: { adoptionId: v.id("legacy_publication_receipt_adoptions") },
  handler: async (ctx, { adoptionId }) => {
    const adoption = await ctx.db.get(adoptionId);
    if (!adoption) return null;
    const [site, article] = await Promise.all([
      ctx.db.get(adoption.siteId),
      ctx.db.get(adoption.articleId),
    ]);
    if (
      !siteExecutionActive(site) ||
      !article ||
      article.siteId !== site._id ||
      !articleMatchesCurrentDomain(site, article)
    ) {
      return null;
    }
    return { adoption, site, article };
  },
});

export const sealLegacyGitHubExpectedContent = internalMutation({
  args: {
    adoptionId: v.id("legacy_publication_receipt_adoptions"),
    leaseOwner: v.string(),
    expectedExternalContentHash: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.expectedExternalContentHash)) {
      throw new Error("Legacy receipt adoption expected bytes have an invalid hash");
    }
    const adoption = await ctx.db.get(args.adoptionId);
    if (
      !adoption ||
      adoption.status !== "leased" ||
      adoption.leaseOwner !== args.leaseOwner
    ) {
      throw new Error("Legacy receipt adoption lost its exact lease");
    }
    const [site, article] = await Promise.all([
      ctx.db.get(adoption.siteId),
      ctx.db.get(adoption.articleId),
    ]);
    const eligible = site && article
      ? legacyGitHubAdoptionEligibility(site, article)
      : null;
    if (
      !eligible ||
      eligible.adoptionKey !== adoption.adoptionKey ||
      eligible.artifactHash !== adoption.artifactHash ||
      (site!.autopilotRolloutEpoch ?? 0) !== adoption.rolloutEpoch
    ) {
      throw new Error("Legacy receipt adoption lost its immutable tenant seal");
    }
    await ctx.db.patch(adoption._id, {
      expectedExternalContentHash: args.expectedExternalContentHash,
      updatedAt: Date.now(),
    });
    return { sealed: true };
  },
});

export const completeLegacyGitHubReceiptAdoption = internalMutation({
  args: {
    adoptionId: v.id("legacy_publication_receipt_adoptions"),
    leaseOwner: v.string(),
    externalBranchHead: v.string(),
    externalFileSha: v.string(),
    externalContentHash: v.string(),
    receipt: legacyAdoptionReceiptValidator,
    publicUrlVerifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (
      !adoption ||
      adoption.status !== "leased" ||
      adoption.leaseOwner !== args.leaseOwner ||
      !adoption.expectedExternalContentHash ||
      adoption.expectedExternalContentHash !== args.externalContentHash ||
      !/^[a-f0-9]{40,64}$/i.test(args.externalBranchHead) ||
      !/^[a-f0-9]{40,64}$/i.test(args.externalFileSha)
    ) {
      throw new Error("Legacy receipt adoption proof lost its exact lease or bytes");
    }
    const [site, article] = await Promise.all([
      ctx.db.get(adoption.siteId),
      ctx.db.get(adoption.articleId),
    ]);
    const eligible = site && article
      ? legacyGitHubAdoptionEligibility(site, article)
      : null;
    if (
      !eligible ||
      eligible.adoptionKey !== adoption.adoptionKey ||
      eligible.artifactHash !== adoption.artifactHash ||
      eligible.deliveryKey !== adoption.deliveryKey ||
      eligible.expectedPublicUrl !== adoption.expectedPublicUrl ||
      (site!.autopilotRolloutEpoch ?? 0) !== adoption.rolloutEpoch
    ) {
      throw new Error("Legacy receipt adoption lost its rollout or destination seal");
    }
    const validatedReceipt = validatePublicationReceipt(args.receipt);
    const timestamp = Date.now();
    if (
      validatedReceipt.method !== "github" ||
      validatedReceipt.deliveryKey !== adoption.deliveryKey ||
      validatedReceipt.contentHash !== adoption.artifactHash ||
      validatedReceipt.externalId !== args.externalFileSha ||
      validatedReceipt.status !== "adopted_verified" ||
      validatedReceipt.receivedAt !== args.publicUrlVerifiedAt ||
      !Number.isFinite(args.publicUrlVerifiedAt) ||
      Math.abs(timestamp - args.publicUrlVerifiedAt) > 60_000
    ) {
      throw new Error("Legacy GitHub receipt does not match the exact proof ledger");
    }
    const receipt = { ...validatedReceipt, method: "github" as const };
    await ctx.db.patch(adoption._id, {
      status: "verified",
      leaseOwner: undefined,
      leaseStartedAt: undefined,
      externalBranchHead: args.externalBranchHead,
      externalFileSha: args.externalFileSha,
      externalContentHash: args.externalContentHash,
      receipt,
      publicUrlVerifiedAt: args.publicUrlVerifiedAt,
      failureCode: undefined,
      failureDetail: undefined,
      updatedAt: timestamp,
    });
    await ctx.db.patch(article!._id, {
      publicationReceipt: receipt,
      publicUrl: adoption.expectedPublicUrl,
      publicUrlStatus: "verified",
      publicUrlLastCheckedAt: args.publicUrlVerifiedAt,
      publicUrlVerifiedAt: args.publicUrlVerifiedAt,
      publicUrlCheckAttempts: Math.max(1, article!.publicUrlCheckAttempts ?? 0),
      publicUrlCheckError: undefined,
      updatedAt: timestamp,
    });
    const summary = await ctx.db
      .query("article_summaries")
      .withIndex("by_article", (q) => q.eq("articleId", article!._id))
      .first();
    if (summary) {
      if (summary.siteId !== site!._id) {
        throw new Error("Legacy receipt adoption summary crossed a tenant boundary");
      }
      await ctx.db.patch(summary._id, {
        publicUrl: adoption.expectedPublicUrl,
        publicUrlStatus: "verified",
        publicUrlLastCheckedAt: args.publicUrlVerifiedAt,
        publicUrlVerifiedAt: args.publicUrlVerifiedAt,
        publicUrlCheckAttempts: Math.max(1, article!.publicUrlCheckAttempts ?? 0),
        publicUrlCheckError: undefined,
        articleUpdatedAt: timestamp,
      });
    }
    return { status: "verified" as const };
  },
});

export const failLegacyGitHubReceiptAdoption = internalMutation({
  args: {
    adoptionId: v.id("legacy_publication_receipt_adoptions"),
    leaseOwner: v.string(),
    code: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (
      !adoption ||
      adoption.status !== "leased" ||
      adoption.leaseOwner !== args.leaseOwner
    ) {
      return { recorded: false };
    }
    await ctx.db.patch(adoption._id, {
      status: "failed",
      leaseOwner: undefined,
      leaseStartedAt: undefined,
      failureCode: args.code.slice(0, 100),
      failureDetail: args.detail.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

export const getExecutionContext = internalQuery({
  args: { revisionId: v.id("published_article_revisions") },
  handler: async (ctx, { revisionId }) => {
    const revision = await ctx.db.get(revisionId);
    if (!revision) return null;
    const current = await currentRevisionArticle(ctx, revision);
    const site = current?.site;
    const article = current?.article;
    if (
      !site ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt ||
      !article ||
      article.siteId !== revision.siteId
    ) {
      return null;
    }
    return { revision, site, article };
  },
});

export const listDueLiveVerifications = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const candidates = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_status_next_verification", (q) =>
        q
          .eq("status", "verification_pending")
          .lte("liveVerificationNextAt", now),
      )
      .take(MAX_LIVE_VERIFICATION_RECOVERIES * 10);
    const due: Array<{
      revisionId: Id<"published_article_revisions">;
      expectedNextArtifactHash: string;
      attempt: number;
    }> = [];
    for (const revision of candidates) {
      if (
        due.length >= MAX_LIVE_VERIFICATION_RECOVERIES ||
        !revision.receipt ||
        revision.liveVerificationNextAt === undefined ||
        revision.liveVerificationNextAt > now ||
        (revision.liveVerificationLeaseExpiresAt ?? 0) > now
      ) {
        continue;
      }
      const current = await currentRevisionArticle(ctx, revision);
      if (
        !current ||
        !siteExecutionActive(current.site) ||
        !rolloutAllowsRevision(current.site) ||
        (current.site.autopilotRolloutEpoch ?? 0) !== revision.rolloutEpoch
      ) {
        const retiredAt = Date.now();
        await ctx.db.patch(revision._id, {
          status: "unverified",
          liveVerificationNextAt: undefined,
          liveVerificationLeaseOwner: undefined,
          liveVerificationLeaseExpiresAt: undefined,
          failureCode: "live_verification_epoch_retired",
          failureDetail:
            "The exact external receipt remains historical, but this live verification belongs to a retired tenant rollout or domain epoch.",
          updatedAt: retiredAt,
        });
        continue;
      }
      due.push({
        revisionId: revision._id,
        expectedNextArtifactHash: revision.nextArtifactHash,
        attempt: revision.liveVerificationAttempts,
      });
    }
    return due;
  },
});

export const claimLiveVerification = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    expectedNextArtifactHash: v.string(),
    leaseOwner: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (
      !revision ||
      revision.status !== "verification_pending" ||
      !revision.receipt ||
      revision.nextArtifactHash !== args.expectedNextArtifactHash ||
      (revision.liveVerificationNextAt ?? Number.POSITIVE_INFINITY) > args.now ||
      (revision.liveVerificationLeaseExpiresAt ?? 0) > args.now
    ) {
      return { claimed: false };
    }
    const current = await currentRevisionArticle(ctx, revision);
    const site = current?.site;
    if (
      !siteExecutionActive(site) ||
      !rolloutAllowsRevision(site) ||
      (site.autopilotRolloutEpoch ?? 0) !== revision.rolloutEpoch
    ) {
      return { claimed: false };
    }
    await ctx.db.patch(revision._id, {
      liveVerificationLeaseOwner: args.leaseOwner,
      liveVerificationLeaseExpiresAt: args.now + LIVE_VERIFICATION_LEASE_MS,
      liveVerificationNextAt: args.now + LIVE_VERIFICATION_LEASE_MS,
    });
    return { claimed: true };
  },
});

export const claimExecution = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    leaseOwner: v.string(),
  },
  handler: async (ctx, { revisionId, leaseOwner }) => {
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("Published revision not found");
    const current = await currentRevisionArticle(ctx, revision);
    const site = current?.site;
    const article = current?.article;
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const measurementCurrent = site && revision
      ? await growthRevisionMeasurementCurrent(ctx, site, revision)
      : false;
    const recoveringAttemptedDelivery = Boolean(
      revision.attemptedAt &&
      ["leased", "attempted", "unverified"].includes(revision.status),
    );
    const receiptOnlyPlanTransition = recoveringAttemptedDelivery &&
      await executionLeasePredatesPlanTransition(
        ctx,
        site,
        revision.attemptedAt,
      );
    let currentConfigHash: string | undefined;
    let recoveryDestinationMatches = false;
    let recoveryAdapter: ReturnType<typeof attemptedRevisionAdapterContract> = {};
    if (site && article) {
      try {
        const currentConfig = publicationDeliveryConfig(site);
        currentConfigHash = publicationDeliveryConfigHash(currentConfig);
        if (recoveringAttemptedDelivery) {
          recoveryDestinationMatches =
            publicationDeliveryDestinationHash(currentConfig) ===
              publicationDeliveryDestinationHash(
                sealedRevisionDeliveryConfig(article),
              );
          recoveryAdapter = attemptedRevisionAdapterContract(
            site,
            article,
            revision,
          );
        }
      } catch {
        currentConfigHash = undefined;
        recoveryDestinationMatches = false;
        recoveryAdapter = null;
      }
    }
    const rolloutCurrent = Boolean(
      site &&
      rolloutAllowsRevision(site) &&
      (site.autopilotRolloutEpoch ?? 0) === revision.rolloutEpoch,
    );
    const expiredWorkerLease = Boolean(
      ["leased", "attempted"].includes(revision.status) &&
      revision.leaseStartedAt &&
      revision.leaseStartedAt + PUBLISHED_REVISION_LEASE_MS <= Date.now(),
    );
    const expiredPristineLease = expiredWorkerLease && !revision.attemptedAt;
    if (
      expiredPristineLease &&
      (revision.attempts >=
          MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS ||
        !executionAuthorized ||
        !measurementCurrent ||
        !rolloutCurrent ||
        currentConfigHash !== revision.publicationConfigHash)
    ) {
      const retiredAt = Date.now();
      await ctx.db.patch(revision._id, {
        status: "failed",
        leaseOwner: undefined,
        leaseStartedAt: undefined,
        failureCode: "pristine_revision_lease_retired",
        failureDetail:
          "The worker lease expired before the provider mutation boundary; no external revision was attempted.",
        updatedAt: retiredAt,
      });
      if (site && site.publicationLeaseOwner === revision.leaseOwner) {
        await ctx.db.patch(site._id, {
          publicationLeaseOwner: undefined,
          publicationLeaseExpiresAt: undefined,
          updatedAt: retiredAt,
        });
      }
      return { idempotent: false, retiredPristine: true, attempts: revision.attempts };
    }
    if (
      expiredWorkerLease &&
      recoveringAttemptedDelivery &&
      revision.attempts >=
        MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS
    ) {
      const exhaustedAt = Date.now();
      await ctx.db.patch(revision._id, {
        status: "unverified",
        leaseOwner: undefined,
        leaseStartedAt: undefined,
        failureCode: "revision_reconciliation_exhausted",
        failureDetail:
          "Bounded read-only reconciliation could not prove the external outcome; explicit owner review is required and no provider replay is authorized.",
        updatedAt: exhaustedAt,
      });
      if (site && site.publicationLeaseOwner === revision.leaseOwner) {
        await ctx.db.patch(site._id, {
          publicationLeaseOwner: undefined,
          publicationLeaseExpiresAt: undefined,
          updatedAt: exhaustedAt,
        });
      }
      return {
        idempotent: false,
        retiredPristine: false,
        reconciliationExhausted: true,
        attempts: revision.attempts,
      };
    }
    if (
      !site ||
      (!executionAuthorized && !receiptOnlyPlanTransition) ||
      !article ||
      (!measurementCurrent && !recoveringAttemptedDelivery) ||
      article.siteId !== site._id ||
      (!rolloutCurrent && !receiptOnlyPlanTransition) ||
      (currentConfigHash !== revision.publicationConfigHash &&
        !(recoveringAttemptedDelivery && recoveryDestinationMatches)) ||
      (recoveringAttemptedDelivery && !recoveryAdapter) ||
      publishedArticlePublicUrl({
        domain: site.domain,
        urlStructure: site.urlStructure,
        slug: article.slug,
      }) !== revision.expectedPublicUrl
    ) {
      throw new Error("Published revision lost its tenant, rollout, or destination boundary");
    }
    await assertNoOtherUnresolvedPublication(ctx, site._id, revision._id);
    if (site.publicationLeaseOwner) {
      const sameRecoverableRevision =
        revision.leaseOwner === site.publicationLeaseOwner;
      if (
        (site.publicationLeaseExpiresAt ?? 0) > Date.now() ||
        !sameRecoverableRevision
      ) {
        throw new Error("Another publication is already in progress for this site");
      }
    }
    if (
      publicationArtifactHashForAuditVersion(
        artifactSnapshot(revision.baseArtifact as PublishedRevisionArtifact),
        revisionBaseAuditVersion(revision),
      ) !== revision.baseArtifactHash ||
      publicationArtifactHashForAuditVersion(
        artifactSnapshot(revision.nextArtifact as PublishedRevisionArtifact),
        revisionNextAuditVersion(revision),
      ) !== revision.nextArtifactHash
    ) {
      throw new Error("Published revision artifact snapshot changed after preparation");
    }
    const currentBase = await effectiveBase(ctx, site, article);
    if (
      currentBase.artifactHash !== revision.baseArtifactHash ||
      currentBase.auditVersion !== revisionBaseAuditVersion(revision) ||
      currentBase.publicationDate !== revision.publicationDate ||
      currentBase.receipt.deliveryKey !== revision.baseReceipt.deliveryKey ||
      currentBase.receipt.externalId !== revision.baseReceipt.externalId
    ) {
      throw new Error("Published revision no longer starts from the exact current receipt");
    }
    const baseArtifact = artifactSnapshot(
      revision.baseArtifact as PublishedRevisionArtifact,
    );
    const nextArtifact = artifactSnapshot(
      revision.nextArtifact as PublishedRevisionArtifact,
    );
    if (revision.kind === "rollback") {
      rollbackRevisionArtifact({
        current: baseArtifact,
        preservedBase: nextArtifact,
      });
    } else {
      validateDeterministicRevision({
        base: baseArtifact,
        next: nextArtifact,
        kind: revision.kind,
        allowedNewHrefs: revision.targetUrl ? [revision.targetUrl] : undefined,
      });
    }
    const latest = await latestFinalRevision(ctx, article._id);
    if (latest && latest.createdAt > revision.createdAt) {
      throw new Error("A newer verified revision superseded this revision base");
    }
    const lease = acquirePublishedRevisionLease(revision, {
      leaseOwner,
      now: Date.now(),
    });
    if (lease.idempotent) return { idempotent: true };
    await ctx.db.patch(revisionId, {
      ...lease.patch,
      ...(recoveringAttemptedDelivery && recoveryAdapter
        ? {
            adapterVersionAtAttempt: recoveryAdapter.adapterVersion,
            adapterConfigHashAtAttempt: recoveryAdapter.adapterConfigHash,
            rendererVersionAtAttempt: recoveryAdapter.rendererVersion,
          }
        : {}),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: leaseOwner,
      publicationLeaseExpiresAt: Date.now() + 15 * 60 * 1000,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      PUBLISHED_REVISION_LEASE_MS + 1_000,
      internal.publisher.executePublishedRevisionInternal,
      { revisionId },
    );
    return {
      idempotent: false,
      retiredPristine: false,
      attempts: lease.patch!.attempts,
      receiptOnlyPlanTransition,
    };
  },
});

export const recordAttempted = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    leaseOwner: v.string(),
  },
  handler: async (ctx, { revisionId, leaseOwner }) => {
    const revision = await ctx.db.get(revisionId);
    const current = revision
      ? await currentRevisionArticle(ctx, revision)
      : null;
    const site = current?.site;
    const article = current?.article;
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    let configAuthorized = false;
    let adapterContract: ReturnType<typeof attemptedRevisionAdapterContract> = null;
    if (revision && site && article) {
      try {
        const currentConfig = publicationDeliveryConfig(site);
        const currentConfigHash = publicationDeliveryConfigHash(currentConfig);
        const recoveringAttempt = Boolean(revision.attemptedAt);
        const destinationStillExact = recoveringAttempt &&
          publicationDeliveryDestinationHash(currentConfig) ===
            publicationDeliveryDestinationHash(
              sealedRevisionDeliveryConfig(article),
            );
        adapterContract = attemptedRevisionAdapterContract(
          site,
          article,
          revision,
        );
        configAuthorized =
          currentConfigHash === revision.publicationConfigHash ||
          Boolean(destinationStillExact && adapterContract);
      } catch {
        configAuthorized = false;
        adapterContract = null;
      }
    }
    const measurementCurrent = revision && site
      ? await growthRevisionMeasurementCurrent(ctx, site, revision)
      : false;
    const targetCurrent = revision && site
      ? await revisionTargetStillCurrent(ctx, site, revision)
      : false;
    if (
      !revision ||
      revision.status !== "leased" ||
      revision.leaseOwner !== leaseOwner ||
      !site ||
      !article ||
      !executionAuthorized ||
      site.publicationLeaseOwner !== leaseOwner ||
      !rolloutAllowsRevision(site) ||
      (site.autopilotRolloutEpoch ?? 0) !== revision.rolloutEpoch ||
      !measurementCurrent ||
      !targetCurrent ||
      !configAuthorized ||
      !adapterContract ||
      publishedArticlePublicUrl({
        domain: site.domain,
        urlStructure: site.urlStructure,
        slug: article.slug,
      }) !== revision.expectedPublicUrl
    ) {
      throw new Error(
        "Published revision attempt lost its exact lease, measurement, target, or destination authorization",
      );
    }
    const timestamp = revision.attemptedAt ?? Date.now();
    await ctx.db.patch(revisionId, {
      status: "attempted",
      attemptedAt: timestamp,
      adapterVersionAtAttempt: adapterContract.adapterVersion,
      adapterConfigHashAtAttempt: adapterContract.adapterConfigHash,
      rendererVersionAtAttempt: adapterContract.rendererVersion,
      updatedAt: timestamp,
    });
    if (revision.growthActionId) {
      const action = await ctx.db.get(revision.growthActionId);
      if (
        action?.siteId === revision.siteId &&
        action.articleId === revision.articleId &&
        action.publishedRevisionId === revision._id
      ) {
        await ctx.db.patch(action._id, {
          publishedRevisionAttemptedAt: timestamp,
          automationStatus: "revision_attempted",
          automationDetail:
            "The external revision was attempted; no SEO action is counted until exact destination and live URL receipts pass.",
          updatedAt: timestamp,
        });
      }
    }
    return { attemptedAt: timestamp };
  },
});

export const recordDelivery = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    leaseOwner: v.string(),
    receipt: revisionReceiptValidator,
  },
  handler: async (ctx, { revisionId, leaseOwner, receipt }) => {
    const revision = await ctx.db.get(revisionId);
    const current = revision
      ? await currentRevisionArticle(ctx, revision)
      : null;
    const site = current?.site;
    const article = current?.article;
    const priorAttempt = Boolean(revision?.attemptedAt);
    const receiptSettlementState = Boolean(
      revision &&
      (revision.status === "attempted" ||
        (revision.status === "leased" && priorAttempt)),
    );
    if (
      !revision ||
      !receiptSettlementState ||
      revision.leaseOwner !== leaseOwner ||
      !site ||
      !article
    ) {
      throw new Error("Published revision delivery lost its exact lease");
    }
    const normalSettlementAuthorized =
      await siteExecutionAuthorized(ctx, site) &&
      rolloutAllowsRevision(site) &&
      (site.autopilotRolloutEpoch ?? 0) === revision.rolloutEpoch;
    const receiptOnlyPlanTransition =
      await executionLeasePredatesPlanTransition(
        ctx,
        site,
        revision.attemptedAt,
      );
    let destinationStillExact = false;
    let adapterContract: ReturnType<typeof attemptedRevisionAdapterContract> = null;
    try {
      const currentConfig = publicationDeliveryConfig(site);
      destinationStillExact =
        publicationDeliveryConfigHash(currentConfig) ===
          revision.publicationConfigHash ||
        (priorAttempt &&
          publicationDeliveryDestinationHash(currentConfig) ===
            publicationDeliveryDestinationHash(
              sealedRevisionDeliveryConfig(article),
            ));
      adapterContract = attemptedRevisionAdapterContract(
        site,
        article,
        revision,
      );
    } catch {
      destinationStillExact = false;
      adapterContract = null;
    }
    if (
      (!normalSettlementAuthorized && !receiptOnlyPlanTransition) ||
      site.publicationLeaseOwner !== leaseOwner ||
      !destinationStillExact ||
      !adapterContract ||
      publishedArticlePublicUrl({
        domain: site.domain,
        urlStructure: site.urlStructure,
        slug: article.slug,
      }) !== revision.expectedPublicUrl
    ) {
      throw new Error("Published revision delivery lost its exact lease");
    }
    validatePublishedRevisionReceipt({
      receipt: receipt as PublishedRevisionReceipt,
      method: revision.baseReceipt.method,
      revisionKey: revision.revisionKey,
      baseArtifactHash: revision.baseArtifactHash,
      nextArtifactHash: revision.nextArtifactHash,
      baseExternalId: revision.baseReceipt.externalId,
    });
    const timestamp = Date.now();
    await ctx.db.patch(revisionId, {
      status: "verification_pending",
      receipt,
      deliveryVerifiedAt: timestamp,
      leaseOwner: undefined,
      leaseStartedAt: undefined,
      failureCode: undefined,
      failureDetail: undefined,
      liveVerificationNextAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: undefined,
      publicationLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    // Seal the growth action in the same transaction as the exact external
    // receipt. This prevents the zero-delay live verifier from marking the
    // action executed before a caller later writes an older pending state.
    if (revision.growthActionId) {
      const action = await ctx.db.get(revision.growthActionId);
      if (
        action?.siteId === revision.siteId &&
        action.articleId === revision.articleId &&
        action.status === "open" &&
        action.publishedRevisionId === revision._id
      ) {
        await ctx.db.patch(action._id, {
          automationStatus: "revision_verification_pending",
          automationDetail:
            "The destination acknowledged the exact external CAS; Pentra is verifying the revised live URL before counting success.",
          updatedAt: timestamp,
        });
      }
    }
    return { recorded: true };
  },
});

export const recordFailure = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    leaseOwner: v.string(),
    status: v.union(v.literal("failed"), v.literal("unverified")),
    code: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision || revision.leaseOwner !== args.leaseOwner) return { recorded: false };
    const site = await ctx.db.get(revision.siteId);
    const timestamp = Date.now();
    // Once the durable provider boundary was crossed, no later preflight or
    // worker classification may erase the ambiguity. Only an exact provider
    // receipt (or an explicit reviewed disposition) can terminalize it.
    const status = revision.attemptedAt ? "unverified" : args.status;
    await ctx.db.patch(revision._id, {
      status,
      failureCode: args.code.slice(0, 100),
      failureDetail: args.detail.slice(0, 500),
      leaseOwner: undefined,
      leaseStartedAt: undefined,
      updatedAt: timestamp,
    });
    if (site?.publicationLeaseOwner === args.leaseOwner) {
      await ctx.db.patch(site._id, {
        publicationLeaseOwner: undefined,
        publicationLeaseExpiresAt: undefined,
        updatedAt: timestamp,
      });
    }
    if (revision.growthActionId) {
      const action = await ctx.db.get(revision.growthActionId);
      if (
        action?.siteId === revision.siteId &&
        action.articleId === revision.articleId &&
        action.status === "open" &&
        action.publishedRevisionId === revision._id
      ) {
        await ctx.db.patch(action._id, {
          automationStatus: status === "unverified"
            ? "revision_unverified"
            : "revision_failed",
          automationDetail: args.detail.slice(0, 500),
          updatedAt: timestamp,
        });
      }
    }
    if (
      status === "unverified" &&
      revision.baseReceipt.method === "github" &&
      revision.attempts < MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS
    ) {
      const delays = [30_000, 2 * 60_000, 10 * 60_000] as const;
      const delay = delays[Math.max(0, revision.attempts - 1)] ??
        delays[delays.length - 1];
      await ctx.scheduler.runAfter(
        delay,
        internal.publisher.executePublishedRevisionInternal,
        { revisionId: revision._id },
      );
    }
    return { recorded: true };
  },
});

/** Explicit owner disposition for an irreconcilable revision outcome. It is
 * intentionally an abandonment, never a success receipt or replay permit.
 * Immutable artifacts, attempt metadata, and the audit reason remain stored;
 * only the workflow/site locks are terminally released. */
export const abandonUnverifiedDelivery = mutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    confirmation: v.string(),
  },
  handler: async (ctx, { revisionId, confirmation }) => {
    if (confirmation !== REVIEWED_AMBIGUITY_CONFIRMATION) {
      throw new Error(
        `Exact confirmation required: ${REVIEWED_AMBIGUITY_CONFIRMATION}`,
      );
    }
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("Published revision not found");
    const site = await requireOwner(ctx, revision.siteId);
    const current = await currentRevisionArticle(ctx, revision);
    const identity = await ctx.auth.getUserIdentity();
    const timestamp = Date.now();
    if (
      !identity ||
      !current ||
      current.site._id !== site._id ||
      site.accountDeletionRequestedAt ||
      revision.deliveryVerifiedAt ||
      !["leased", "attempted", "unverified"].includes(revision.status) ||
      !reviewedAmbiguityDispositionAllowed({
        attemptedAt: revision.attemptedAt,
        receiptPresent: Boolean(revision.receipt),
        dispositionAt: revision.ambiguityDispositionAt,
        workflowLeaseOwner: revision.leaseOwner,
        workflowLeaseStartedAt: revision.leaseStartedAt,
        siteLeaseOwner: site.publicationLeaseOwner,
        siteLeaseExpiresAt: site.publicationLeaseExpiresAt,
        now: timestamp,
        leaseMs: PUBLISHED_REVISION_LEASE_MS,
      })
    ) {
      throw new Error(
        "This revision does not have an expired, receipt-free delivery ambiguity",
      );
    }
    const detail =
      "The owner reviewed an unresolved provider outcome, abandoned this immutable revision without asserting success, and accepted responsibility for reconciling any external artifact before future destination changes.";
    const leaseOwner = revision.leaseOwner;
    await ctx.db.patch(revision._id, {
      status: "failed",
      leaseOwner: undefined,
      leaseStartedAt: undefined,
      failureCode: "owner_reviewed_delivery_ambiguity",
      failureDetail: detail,
      ambiguityDispositionAt: timestamp,
      ambiguityDispositionBy: identity.subject,
      ambiguityDispositionDetail: detail,
      liveVerificationNextAt: undefined,
      liveVerificationLeaseOwner: undefined,
      liveVerificationLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    if (leaseOwner && site.publicationLeaseOwner === leaseOwner) {
      await ctx.db.patch(site._id, {
        publicationLeaseOwner: undefined,
        publicationLeaseExpiresAt: undefined,
        updatedAt: timestamp,
      });
    }
    if (revision.growthActionId) {
      const action = await ctx.db.get(revision.growthActionId);
      if (
        action?.siteId === revision.siteId &&
        action.articleId === revision.articleId &&
        action.publishedRevisionId === revision._id
      ) {
        await ctx.db.patch(action._id, {
          automationStatus: "revision_ambiguity_owner_reviewed",
          automationDetail: detail,
          automatedAt: undefined,
          updatedAt: timestamp,
        });
      }
    }
    return {
      abandoned: true,
      disposition: "owner_reviewed_unverified_delivery",
      attemptedAt: revision.attemptedAt,
    };
  },
});

export const recordLiveVerification = internalMutation({
  args: {
    revisionId: v.id("published_article_revisions"),
    expectedNextArtifactHash: v.string(),
    status: v.union(
      v.literal("verification_pending"),
      v.literal("verified"),
      v.literal("unverified"),
    ),
    attempts: v.number(),
    leaseOwner: v.string(),
    nextAttemptAt: v.optional(v.number()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (
      !revision ||
      revision.nextArtifactHash !== args.expectedNextArtifactHash ||
      !revision.receipt ||
      revision.liveVerificationLeaseOwner !== args.leaseOwner ||
      !["verification_pending", "unverified"].includes(revision.status)
    ) {
      return { recorded: false, reason: "stale_revision" };
    }
    const current = await currentRevisionArticle(ctx, revision);
    const site = current?.site;
    const article = current?.article;
    if (!siteExecutionActive(site) || !article || article.siteId !== site._id) {
      return { recorded: false, reason: "tenant_unavailable" };
    }
    const timestamp = Date.now();
    let destinationStillSealed = false;
    try {
      destinationStillSealed =
        publicationDeliveryConfigHash(publicationDeliveryConfig(site)) ===
        revision.publicationConfigHash;
    } catch {
      destinationStillSealed = false;
    }
    const measurementStillCurrent = revision.growthActionId
      ? await growthRevisionMeasurementCurrent(ctx, site, revision)
      : true;
    const rolloutStillEligible =
      rolloutAllowsRevision(site) &&
      (site.autopilotRolloutEpoch ?? 0) === revision.rolloutEpoch &&
      destinationStillSealed &&
      measurementStillCurrent;
    const finalStatus = args.status === "verified" && revision.kind === "rollback"
      ? "rolled_back"
      : args.status;
    await ctx.db.patch(revision._id, {
      status: finalStatus,
      liveVerificationAttempts: Math.max(
        revision.liveVerificationAttempts,
        Math.floor(args.attempts),
      ),
      liveVerificationLastCheckedAt: timestamp,
      liveVerificationNextAt: args.status === "verification_pending"
        ? args.nextAttemptAt
        : undefined,
      liveVerificationLeaseOwner: undefined,
      liveVerificationLeaseExpiresAt: undefined,
      liveVerifiedAt: args.status === "verified" ? timestamp : undefined,
      failureCode: args.status === "unverified" ? "live_receipt_unverified" : undefined,
      failureDetail: args.status === "verified" ? undefined : args.detail?.slice(0, 500),
      updatedAt: timestamp,
    });
    if (revision.growthActionId) {
      const action = await ctx.db.get(revision.growthActionId);
      if (
        action?.siteId === revision.siteId &&
        action.articleId === revision.articleId &&
        action.publishedRevisionId === revision._id
      ) {
        await ctx.db.patch(action._id, {
          automationStatus: args.status === "verified"
            ? rolloutStillEligible
              ? "executed"
              : "revision_verified_rollout_changed"
            : args.status === "unverified"
              ? "revision_unverified"
              : "revision_verification_pending",
          automationDetail: args.status === "verified"
            ? rolloutStillEligible
              ? "The deterministic revision is live at the exact tenant URL and has a verified destination receipt."
              : "The deterministic revision is verified live, but its rollout, destination, or measurement receipt was superseded before completion, so the growth action was not counted as executed."
            : args.detail?.slice(0, 500) ?? "Waiting for exact live revision verification.",
          automatedAt: args.status === "verified" && rolloutStillEligible
            ? timestamp
            : undefined,
          publishedRevisionVerifiedAt: args.status === "verified" ? timestamp : undefined,
          updatedAt: timestamp,
        });
      }
    }
    if (
      args.status === "verified" &&
      revision.cadenceMicroSeedJobId &&
      Number.isSafeInteger(revision.cadenceDueAt)
    ) {
      const health = await ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", revision.siteId))
        .first();
      if (health) {
        await ctx.db.patch(health._id, {
          lastPublishedAt: timestamp,
          nextPublicationDueAt:
            timestamp + cadenceIntervalMs(site.cadencePerWeek ?? 4),
          detail:
            "The cadence published a strict, immutable existing-page improvement after safe new-page space was exhausted.",
          updatedAt: timestamp,
        });
      }
    }
    return { recorded: true, status: finalStatus };
  },
});

export const requestRollback = mutation({
  args: {
    siteId: v.id("sites"),
    revisionId: v.id("published_article_revisions"),
  },
  handler: async (ctx, args) => {
    const site = await requireOwner(ctx, args.siteId);
    if (!rolloutAllowsRevision(site)) {
      throw new Error("Rollback delivery requires this tenant to be warm or live");
    }
    const source = await ctx.db.get(args.revisionId);
    if (
      !source ||
      source.siteId !== args.siteId ||
      !isFinalRevision(source) ||
      !source.receipt
    ) {
      throw new Error("Only an exact verified tenant revision can be rolled back");
    }
    const sourceArticle = await ctx.db.get(source.articleId);
    if (
      !sourceArticle ||
      sourceArticle.siteId !== site._id ||
      !articleMatchesCurrentDomain(site, sourceArticle)
    ) {
      throw new Error("Published revision belongs to an earlier site domain");
    }
    const latest = await latestFinalRevision(ctx, source.articleId);
    if (!latest || latest._id !== source._id) {
      throw new Error("Only the latest verified revision can be rolled back");
    }
    const current = artifactSnapshot(source.nextArtifact as PublishedRevisionArtifact);
    const preservedBase = artifactSnapshot(source.baseArtifact as PublishedRevisionArtifact);
    const next = rollbackRevisionArtifact({ current, preservedBase });
    const sourceBaseAuditVersion = revisionBaseAuditVersion(source);
    const sourceNextAuditVersion = revisionNextAuditVersion(source);
    const nextArtifactHash = publicationArtifactHashForAuditVersion(
      next,
      sourceBaseAuditVersion,
    );
    const actionFingerprint = `rollback:${source.revisionKey}`;
    const rollbackBaseReceipt: PublicationReceipt = {
      method: source.receipt.method,
      deliveryKey: source.receipt.deliveryKey,
      contentHash: source.receipt.contentHash,
      externalId: source.receipt.externalId,
      url: source.receipt.url,
      status: source.receipt.status,
      receivedAt: source.receipt.receivedAt,
    };
    const revisionKey = publishedRevisionKey({
      siteId: String(args.siteId),
      articleId: String(source.articleId),
      actionFingerprint,
      kind: "rollback",
      baseArtifactHash: source.nextArtifactHash,
      nextArtifactHash,
      baseReceipt: rollbackBaseReceipt,
    });
    const existing = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_key", (q) => q.eq("revisionKey", revisionKey))
      .unique();
    if (existing) {
      if (existing.siteId !== args.siteId || existing.articleId !== source.articleId) {
        throw new Error("Rollback idempotency key crossed a tenant boundary");
      }
      const staleDeliveryLease =
        (existing.status === "leased" || existing.status === "attempted") &&
        (!existing.leaseStartedAt ||
          Date.now() - existing.leaseStartedAt >= PUBLISHED_REVISION_LEASE_MS);
      if (
        existing.status === "prepared" ||
        existing.status === "unverified" ||
        staleDeliveryLease
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.publisher.executePublishedRevisionInternal,
          { revisionId: existing._id },
        );
      }
      return existing._id;
    }
    const timestamp = Date.now();
    const rollbackId = await ctx.db.insert("published_article_revisions", {
      siteId: args.siteId,
      articleId: source.articleId,
      actionFingerprint,
      kind: "rollback",
      revisionKey,
      status: "prepared",
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      publicationConfigHash: source.publicationConfigHash,
      publicationDate: source.publicationDate,
      expectedPublicUrl: source.expectedPublicUrl,
      baseAuditVersion: sourceNextAuditVersion,
      baseArtifactHash: source.nextArtifactHash,
      baseArtifact: current,
      baseReceipt: rollbackBaseReceipt,
      nextArtifactHash,
      nextAuditVersion: sourceBaseAuditVersion,
      nextArtifact: next,
      rollbackOfRevisionId: source._id,
      attempts: 0,
      liveVerificationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.publisher.executePublishedRevisionInternal,
      { revisionId: rollbackId },
    );
    return rollbackId;
  },
});

export const listForSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireOwner(ctx, siteId);
    return ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
      .order("desc")
      .take(100);
  },
});

export const getReceiptInternal = internalQuery({
  args: { revisionId: v.id("published_article_revisions") },
  handler: async (ctx, { revisionId }) => ctx.db.get(revisionId),
});
