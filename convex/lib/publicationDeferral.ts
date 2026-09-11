import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { jobAuthorizedForExecution } from "./jobRollout.ts";
import { accountDeletionKey } from "./accountDeletion.ts";
import {
  publicationArtifactHashForAuditVersion,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryDestinationHash,
} from "./publicationArtifact.ts";
import { articleMatchesCurrentDomain } from "./siteDomainBinding.ts";
import { PUBLICATION_LEASE_MS } from "./publicationLease.ts";

// Waiting is independent of failed external deliveries, but is not unlimited.
export const MAX_PUBLICATION_DEFERRALS = 4;
export const MAX_PUBLICATION_DEFERRAL_MS = 4 * PUBLICATION_LEASE_MS;
export const publicationJobClaimValidator = v.object({ jobId: v.id("jobs"), workerToken: v.string() });
export type PublicationJobClaim = Infer<typeof publicationJobClaimValidator>;
export const publicationDeferralBoundaryValidator = v.object({
  articleId: v.id("articles"),
  ownerKey: v.string(),
  contentHash: v.string(),
  configHash: v.string(),
  destinationHash: v.string(),
  rolloutEpoch: v.number(),
});
export type PublicationDeferralBoundary = Infer<typeof publicationDeferralBoundaryValidator>;
export type PublicationContentionResult = {
  method: "deferred";
  outcome: "publication_lease_contention";
  retryAt: number;
  boundary: PublicationDeferralBoundary;
};

export function publicationDeferralBoundary(
  site: Doc<"sites">,
  article: Doc<"articles">,
): PublicationDeferralBoundary {
  if (!site.userId || !article.auditedContentHash || !article.publicationConfigHash ||
    !article.publicationConfigSnapshot) throw new Error("Publication deferral requires an owned sealed artifact");
  return {
    articleId: article._id,
    ownerKey: accountDeletionKey(site.userId),
    contentHash: article.auditedContentHash,
    configHash: article.publicationConfigHash,
    destinationHash: publicationDeliveryDestinationHash(publicationDeliveryConfig(article.publicationConfigSnapshot)),
    rolloutEpoch: article.publicationRolloutEpoch ?? site.autopilotRolloutEpoch ?? 0,
  };
}

export function publicationDeferralBoundaryMatches(
  site: Doc<"sites"> | null,
  article: Doc<"articles"> | null,
  boundary: PublicationDeferralBoundary,
): boolean {
  if (!site?.userId || !article || article._id !== boundary.articleId ||
    article.siteId !== site._id || !articleMatchesCurrentDomain(site, article) ||
    accountDeletionKey(site.userId) !== boundary.ownerKey ||
    (site.autopilotRolloutEpoch ?? 0) !== boundary.rolloutEpoch ||
    article.publicationAmbiguityDispositionAt ||
    article.auditedContentHash !== boundary.contentHash ||
    article.publicationConfigHash !== boundary.configHash ||
    !article.publicationConfigSnapshot || !Number.isInteger(article.publicationAuditVersion)) return false;
  try {
    const sealed = publicationDeliveryConfig(article.publicationConfigSnapshot);
    return publicationArtifactHashForAuditVersion(article, article.publicationAuditVersion!) === boundary.contentHash &&
      publicationDeliveryConfigHash(sealed) === boundary.configHash &&
      publicationDeliveryDestinationHash(sealed) === boundary.destinationHash &&
      publicationDeliveryDestinationHash(publicationDeliveryConfig(site)) === boundary.destinationHash;
  } catch { return false; }
}

/** Null means this exact article may enter normal lease admission now. An
 * expired foreign/unresolved fence is NEVER cleared here; give its owner one
 * ordinary lease period to reconcile, within the separate finite wait budget. */
export function publicationContentionUntil(
  site: Doc<"sites">,
  article: Doc<"articles">,
  now: number,
): number | null {
  if ((site.publicationLeaseOwner && (!Number.isSafeInteger(site.publicationLeaseExpiresAt) ||
      (site.publicationLeaseExpiresAt ?? 0) <= 0)) ||
    (article.publicationLeaseOwner && (!Number.isSafeInteger(article.publicationLeaseStartedAt) ||
      (article.publicationLeaseStartedAt ?? 0) <= 0))) return now + PUBLICATION_LEASE_MS;
  const articleExpiry = article.publicationLeaseOwner && article.publicationLeaseStartedAt
    ? article.publicationLeaseStartedAt + PUBLICATION_LEASE_MS : 0;
  if (site.publicationLeaseOwner) {
    const expiry = Math.max(site.publicationLeaseExpiresAt ?? 0, articleExpiry);
    if (Number.isSafeInteger(expiry) && expiry > now) return expiry;
    if (site.publicationLeaseOwner !== article.publicationLeaseOwner ||
      article.publicationLeaseHash !== article.auditedContentHash) return now + PUBLICATION_LEASE_MS;
  }
  return articleExpiry > now ? articleExpiry : null;
}

/** Optional for direct owner actions and existing exact-envelope recovery.
 * Scheduled job workers carry their
 * actual claim through BOTH lease admission and the final pre-write mutation. */
export async function assertPublicationJobClaim(
  ctx: MutationCtx, site: Doc<"sites">, article: Doc<"articles">,
  claim?: PublicationJobClaim,
): Promise<void> {
  if (!claim) return;
  const job = await ctx.db.get(claim.jobId);
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  if (!job || job.siteId !== site._id || job.type !== "article" ||
    job.status !== "running" || job.workerToken !== claim.workerToken ||
    (job.leaseExpiresAt ?? 0) <= Date.now() || !jobAuthorizedForExecution(site, job) ||
    (job.articleId !== undefined && job.articleId !== article._id) ||
    (payload.articleId !== undefined && payload.articleId !== article._id) ||
    (job.articleId !== article._id && payload.articleId !== article._id) ||
    (job.publicationDeferral && (job.publicationDeferral.state === "terminal" ||
      !publicationDeferralBoundaryMatches(site, article, job.publicationDeferral.boundary)))) {
    throw new Error("Publication worker lost its exact job/artifact claim");
  }
}
