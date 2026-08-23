import { PUBLICATION_AUDIT_VERSION } from "./publicationArtifact.ts";

export type TopicReservationArticle = {
  status: string;
  publicationGateStatus?: string;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
};

export type TopicLifecycleInput = {
  currentStatus?: string;
  businessFitEligible?: boolean;
  hasLinkedArticles: boolean;
  hasReservingArticle: boolean;
  hasActiveArticleJob: boolean;
};

export type ExistingTopicIntent = {
  id: string;
  primaryKeyword: string;
  updatedAt?: number;
};

export type TopicUpsertDecision =
  | { kind: "blocked"; blockingKeyword: string }
  | { kind: "revive"; topicId: string }
  | { kind: "insert" };

export function normalizeTopicIntentKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function topicKeywordsConflict(left: string, right: string): boolean {
  const normalizedLeft = normalizeTopicIntentKeyword(left);
  const normalizedRight = normalizeTopicIntentKeyword(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft);
}

/**
 * Decide whether one enriched candidate is durable coverage, a dormant row
 * that should be revived, or genuinely new inventory.
 *
 * Historical rows are not coverage by themselves. Only rows connected to a
 * published/current sealed-ready article may block an exact or similar
 * candidate. `acceptedBatchKeywords` is a transaction-local uniqueness guard,
 * not durable coverage: it prevents one provider response from inserting the
 * same intent twice while leaving unrelated dormant rows out of dedupe.
 */
export function decideTopicUpsert(input: {
  candidateKeyword: string;
  existingTopics: ExistingTopicIntent[];
  reservingTopicIds: ReadonlySet<string>;
  additionalReservingKeywords?: string[];
  acceptedBatchKeywords?: string[];
}): TopicUpsertDecision {
  const candidateKeyword = normalizeTopicIntentKeyword(
    input.candidateKeyword,
  );
  const durableCoverage = [
    ...input.existingTopics
      .filter((topic) => input.reservingTopicIds.has(topic.id))
      .map((topic) => topic.primaryKeyword),
    ...(input.additionalReservingKeywords ?? []),
  ];
  const blockingKeyword = [
    ...durableCoverage,
    ...(input.acceptedBatchKeywords ?? []),
  ].find((keyword) => topicKeywordsConflict(candidateKeyword, keyword));
  if (blockingKeyword) {
    return { kind: "blocked", blockingKeyword };
  }

  const exactDormant = input.existingTopics
    .filter((topic) =>
      !input.reservingTopicIds.has(topic.id) &&
      normalizeTopicIntentKeyword(topic.primaryKeyword) === candidateKeyword
    )
    .sort((left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      left.id.localeCompare(right.id)
    )[0];
  return exactDormant
    ? { kind: "revive", topicId: exactDormant.id }
    : { kind: "insert" };
}

function topicFieldEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length &&
      left.every((value, index) => topicFieldEqual(value, right[index]));
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ]);
    return [...keys].every((key) =>
      topicFieldEqual(leftRecord[key], rightRecord[key])
    );
  }
  return false;
}

/**
 * Build an idempotent patch for an exact dormant row. Supplied evidence wins,
 * but an identical replay does not touch `updatedAt`. A newly eligible audit
 * also clears a stale disqualification reason left by the failed lifecycle.
 */
export function dormantTopicRevivalPatch(
  current: Record<string, unknown>,
  supplied: Record<string, unknown>,
  refreshedAt: number,
): { changed: boolean; fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {
    ...supplied,
    status: typeof supplied.status === "string" && supplied.status
      ? supplied.status
      : "planned",
    ...(supplied.businessFitEligible === true
      ? { disqualifiedReason: undefined }
      : {}),
  };
  const changed = Object.entries(fields).some(([key, value]) =>
    !topicFieldEqual(current[key], value)
  );
  return {
    changed,
    fields: changed
      ? {
          ...fields,
          ...(supplied.businessFitEligible !== undefined
            ? { businessFitCheckedAt: refreshedAt }
            : {}),
          updatedAt: refreshedAt,
        }
      : fields,
  };
}

/**
 * Durable search-intent coverage begins only when an artifact is either
 * externally published or is the exact current, sealed ready artifact.
 * Merely creating, reviewing, quarantining, or rejecting a draft must never
 * consume a topic forever.
 *
 * `published` is authoritative here because that workflow state can only be
 * written after the destination adapter returns a validated external receipt.
 */
export function articleReservesTopicIntent(
  article: TopicReservationArticle,
): boolean {
  if (article.status === "published") return true;
  return (
    article.status === "ready" &&
    article.publicationGateStatus === "passed" &&
    article.publicationAuditVersion === PUBLICATION_AUDIT_VERSION &&
    typeof article.auditedContentHash === "string" &&
    article.auditedContentHash.length > 0
  );
}

/**
 * Compute the canonical topic state without tenant- or database-specific
 * assumptions. `queued` is a temporary generation lock, while `used` is
 * durable intent coverage. A failed linked draft returns to `planned`, where
 * the normal tenant business-fit, SERP, and cannibalization gates revalidate it.
 */
export function reconciledTopicStatus(
  input: TopicLifecycleInput,
): string {
  if (input.hasReservingArticle) return "used";
  if (input.hasActiveArticleJob) return "queued";
  if (
    input.currentStatus === "disqualified" ||
    input.businessFitEligible === false
  ) {
    return "disqualified";
  }

  if (input.hasLinkedArticles) return "planned";

  // Orphaned stale locks have no artifact or active work to justify them.
  if (["used", "queued"].includes(input.currentStatus ?? "")) {
    return "planned";
  }

  // A topic marked cannibalizing by the independent SERP-overlap planner has
  // no article lifecycle evidence to overturn. Linked failed drafts, handled
  // above, do enter revalidation instead of remaining poisoned forever.
  return input.currentStatus ?? "planned";
}
