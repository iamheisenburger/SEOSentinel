import { publicationDeliveryKey } from "./publicationArtifact.ts";
import { PUBLICATION_LEASE_MS } from "./publicationLease.ts";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./publicationReceipts.ts";

export const SUPPORT_DELIVERY_VERIFIED_STATUS =
  "support_delivery_verified" as const;

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

type SupportSite = {
  _id: string;
  publishMethod?: string;
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
