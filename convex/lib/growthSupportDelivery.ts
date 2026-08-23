import { publicationDeliveryKey } from "./publicationArtifact.ts";
import { PUBLICATION_LEASE_MS } from "./publicationLease.ts";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./publicationReceipts.ts";
import { verifiedAuthorityTarget } from "./publicationLive.ts";

export const SUPPORT_DELIVERY_VERIFIED_STATUS =
  "support_delivery_verified" as const;

// Growth replenishment is capped at three topics. Legacy adoption reads one
// sentinel beyond each bound and fails closed instead of scanning an
// unbounded tenant history.
export const MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION = 3;
export const MAX_LEGACY_SUPPORT_ARTICLES_PER_TOPIC = 10;
export const MAX_LEGACY_SUPPORT_DELIVERY_CANDIDATES =
  MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION *
  MAX_LEGACY_SUPPORT_ARTICLES_PER_TOPIC;

const TERMINAL_PUBLISHED_REVISION_STATUSES = new Set([
  "failed",
  "verified",
  "rolled_back",
]);

export type GrowthSupportDeliveryReceipt<TArticleId extends string = string> = {
  articleId: TArticleId;
  method: PublicationReceipt["method"];
  deliveryKey: string;
  contentHash: string;
  externalId: string;
  status: string;
  receivedAt: number;
};

type SupportAction = {
  _id: string;
  siteId: string;
  articleId: string;
  fingerprint: string;
  stage: string;
  actionKind: string;
  status: string;
  automationStatus?: string;
  publishedRevisionId?: string;
};

type SupportTopic = {
  _id: string;
  siteId: string;
  growthParentArticleId?: string;
  growthActionFingerprint?: string;
};

type SupportArticle<TArticleId extends string = string> = {
  _id: TArticleId;
  siteId: string;
  topicId?: string;
  status: string;
  publicationReceipt?: PublicationReceipt;
  publishedContentHash?: string;
  publicationDeliveryHash?: string;
  publishedAt?: number;
};

type LiveSupportArticle<TArticleId extends string = string> =
  SupportArticle<TArticleId> & {
    title: string;
    slug: string;
    metaKeywords?: string[];
    publicUrl?: string;
    publicUrlStatus?: "pending" | "verified" | "failed";
    publicUrlLastCheckedAt?: number;
    publicUrlVerifiedAt?: number;
    publicUrlCheckAttempts?: number;
  };

type SupportSite = {
  _id: string;
  publishMethod?: string;
};

type LiveSupportSite = SupportSite & {
  domain: string;
  urlStructure?: string;
};

export type GrowthSupportDeliveryCandidate<
  TArticleId extends string = string,
> = {
  actionId: string;
  siteId: string;
  sourceArticleId: string;
  actionFingerprint: string;
  stage: string;
  actionKind: string;
  topicId: string;
  receipt: GrowthSupportDeliveryReceipt<TArticleId>;
  publishedAt: number;
};

export type GrowthSupportDeliveryEvidence<
  TArticleId extends string = string,
> = GrowthSupportDeliveryCandidate<TArticleId> & {
  targetUrl: string;
  publicUrlVerifiedAt: number;
};

export type GrowthSupportDeliveryAdoptionRecord<
  TArticleId extends string = string,
> = {
  articleId: TArticleId;
  status: string;
  publishedAt?: number;
  candidate: GrowthSupportDeliveryCandidate<TArticleId> | null;
};

export function verifiedGrowthSupportDelivery<
  TArticleId extends string = string,
>(args: {
  site: SupportSite;
  action: SupportAction;
  topic: SupportTopic;
  article: SupportArticle<TArticleId>;
}): GrowthSupportDeliveryReceipt<TArticleId> | null {
  const { action, article, site, topic } = args;
  if (
    action.siteId !== site._id ||
    topic.siteId !== site._id ||
    article.siteId !== site._id ||
    action.status !== "open" ||
    topic.growthParentArticleId !== action.articleId ||
    topic.growthActionFingerprint !== action.fingerprint ||
    article.topicId !== topic._id ||
    article.status !== "published" ||
    !article.publicationReceipt ||
    !article.publishedContentHash ||
    !article.publicationDeliveryHash ||
    !Number.isFinite(article.publishedAt)
  ) {
    return null;
  }

  try {
    const receipt = validatePublicationReceipt(article.publicationReceipt);
    const publishedAt = article.publishedAt!;
    const expectedStatus = {
      github: "committed",
      wordpress: "published",
      webhook: "accepted",
    } as const;
    if (
      receipt.method !== (site.publishMethod ?? "github") ||
      receipt.deliveryKey !==
        publicationDeliveryKey(article.publicationDeliveryHash) ||
      receipt.contentHash !== article.publishedContentHash ||
      receipt.status !== expectedStatus[receipt.method] ||
      receipt.receivedAt < publishedAt - PUBLICATION_LEASE_MS ||
      receipt.receivedAt > publishedAt + 60_000
    ) {
      return null;
    }
    return {
      articleId: article._id,
      method: receipt.method,
      deliveryKey: receipt.deliveryKey,
      contentHash: receipt.contentHash,
      externalId: receipt.externalId,
      status: receipt.status,
      receivedAt: receipt.receivedAt,
    };
  } catch {
    return null;
  }
}

export function growthSupportDeliveryReceiptsMatch<TArticleId extends string>(
  left: GrowthSupportDeliveryReceipt<TArticleId> | undefined,
  right: GrowthSupportDeliveryReceipt<TArticleId> | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.articleId === right.articleId &&
    left.method === right.method &&
    left.deliveryKey === right.deliveryKey &&
    left.contentHash === right.contentHash &&
    left.externalId === right.externalId &&
    left.status === right.status &&
    left.receivedAt === right.receivedAt,
  );
}

/**
 * A legacy support receipt is adoptable only when the exact delivered article
 * still resolves to the current tenant URL. This combines the immutable
 * external publication receipt with the recent public-page receipt used by
 * authority discovery; workflow text and article status alone are never
 * evidence.
 */
export function verifiedGrowthSupportDeliveryEvidence<
  TArticleId extends string = string,
>(args: {
  site: LiveSupportSite;
  action: SupportAction;
  topic: SupportTopic;
  article: LiveSupportArticle<TArticleId>;
  now: number;
}): GrowthSupportDeliveryEvidence<TArticleId> | null {
  const candidate = verifiedGrowthSupportDeliveryCandidate(args);
  const liveTarget = verifiedAuthorityTarget({
    site: args.site,
    article: args.article,
    now: args.now,
  });
  if (
    !candidate ||
    !liveTarget ||
    liveTarget.articleId !== candidate.receipt.articleId
  ) {
    return null;
  }
  return {
    ...candidate,
    targetUrl: liveTarget.targetUrl,
    publicUrlVerifiedAt: liveTarget.publicUrlVerifiedAt,
  };
}

/** Build immutable delivery proof before considering mutable live-page state. */
export function verifiedGrowthSupportDeliveryCandidate<
  TArticleId extends string = string,
>(args: {
  site: SupportSite;
  action: SupportAction;
  topic: SupportTopic;
  article: SupportArticle<TArticleId>;
}): GrowthSupportDeliveryCandidate<TArticleId> | null {
  const receipt = verifiedGrowthSupportDelivery(args);
  if (!receipt) return null;
  return {
    actionId: args.action._id,
    siteId: args.action.siteId,
    sourceArticleId: args.action.articleId,
    actionFingerprint: args.action.fingerprint,
    stage: args.action.stage,
    actionKind: args.action.actionKind,
    topicId: args.topic._id,
    receipt,
    publishedAt: args.article.publishedAt!,
  };
}

function candidateMatchesAction<TArticleId extends string>(
  action: SupportAction,
  candidate: GrowthSupportDeliveryCandidate<TArticleId>,
): boolean {
  return (
    candidate.actionId === action._id &&
    candidate.siteId === action.siteId &&
    candidate.sourceArticleId === action.articleId &&
    candidate.actionFingerprint === action.fingerprint &&
    candidate.stage === action.stage &&
    candidate.actionKind === action.actionKind
  );
}

/**
 * Reconstruct the same first-writer-wins receipt that the current publication
 * path would have stored. Multiple exact support topics are valid: first order
 * every linked published row, then require exact receipt proof for that oldest
 * row. Receiptless or malformed rows are never filtered away before ordering.
 * An unknown/indistinguishable timestamp, mixed action, duplicate article, or
 * oversized set fails closed.
 */
export function selectLegacySupportDeliveryAdoptionCandidate<
  TArticleId extends string = string,
>(args: {
  action: SupportAction;
  records: readonly GrowthSupportDeliveryAdoptionRecord<TArticleId>[];
}): GrowthSupportDeliveryCandidate<TArticleId> | null {
  if (
    args.action.status !== "open" ||
    args.action.stage !== "striking_distance" ||
    args.action.actionKind !== "strengthen_cluster" ||
    (
      args.action.automationStatus !== "executed" &&
      args.action.automationStatus !== SUPPORT_DELIVERY_VERIFIED_STATUS
    ) ||
    args.action.publishedRevisionId ||
    args.records.length < 1 ||
    args.records.length > MAX_LEGACY_SUPPORT_DELIVERY_CANDIDATES ||
    new Set(args.records.map((record) => record.articleId)).size !==
      args.records.length ||
    !args.records.every((record) =>
      !record.candidate ||
      (
        record.candidate.receipt.articleId === record.articleId &&
        candidateMatchesAction(args.action, record.candidate)
      )
    )
  ) {
    return null;
  }

  const published = args.records.filter((record) =>
    record.status === "published"
  );
  if (
    published.length < 1 ||
    published.some((record) => !Number.isFinite(record.publishedAt))
  ) {
    return null;
  }
  const ordered = [...published].sort((left, right) =>
    left.publishedAt! - right.publishedAt!
  );
  if (ordered[0]!.publishedAt === ordered[1]?.publishedAt) return null;
  const selected = ordered[0]!;
  return selected.candidate &&
      selected.candidate.publishedAt === selected.publishedAt
    ? selected.candidate
    : null;
}

/**
 * Compatibility admission for actions completed by the older support-article
 * actuator. It is deliberately narrower than the ordinary revision retry set:
 * only one still-open striking-distance action with an exact support receipt
 * and no revision history may cross into the immutable revision lifecycle.
 */
export function legacyExecutedSupportRevisionAdmission(args: {
  action: SupportAction;
  verifiedSupportDelivery: boolean;
  terminalRevisionStatus?: string;
  anyRevisionExists: boolean;
}): { allowed: boolean; reason: string } {
  if (
    args.action.status !== "open" ||
    args.action.stage !== "striking_distance" ||
    args.action.actionKind !== "strengthen_cluster"
  ) {
    return { allowed: false, reason: "action_not_legacy_support_revision" };
  }
  if (
    args.action.automationStatus !== "executed" &&
    args.action.automationStatus !== SUPPORT_DELIVERY_VERIFIED_STATUS
  ) {
    return { allowed: false, reason: "support_phase_not_complete" };
  }
  if (args.terminalRevisionStatus) {
    return { allowed: false, reason: "terminal_revision_exists" };
  }
  if (args.action.publishedRevisionId || args.anyRevisionExists) {
    return { allowed: false, reason: "revision_already_exists" };
  }
  if (!args.verifiedSupportDelivery) {
    return { allowed: false, reason: "support_delivery_receipt_missing" };
  }
  return { allowed: true, reason: "legacy_support_delivery_verified" };
}

export function isTerminalPublishedRevisionStatus(
  status: string | undefined,
): boolean {
  return Boolean(status && TERMINAL_PUBLISHED_REVISION_STATUSES.has(status));
}
