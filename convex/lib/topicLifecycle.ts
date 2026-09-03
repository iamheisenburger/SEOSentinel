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
  contentFeasibilityStatus?: string;
  checkpointExecutionLocked?: boolean;
  hasLinkedArticles: boolean;
  hasReservingArticle: boolean;
  hasActiveArticleJob: boolean;
};

export type ExistingTopicIntent = {
  id: string;
  primaryKeyword: string;
  updatedAt?: number;
  contentFeasibilityStatus?: string;
};

export const CONTENT_FEASIBILITY_VERSION = 1;

export function terminalContentFeasibility(status?: string): boolean {
  return status === "too_thin" || status === "quality_exhausted";
}

export function terminalTopicQualitySettlement(args: {
  gateStatus: string;
  issues: string[];
  qualityRevisionCount: number;
  maximumRevisions: number;
  article: {
    siteId: string;
    status?: string;
    topicId?: string | null;
  };
  topic: {
    _id: string;
    siteId: string;
    status?: string;
    contentFeasibilityStatus?: string;
    planCheckpointTerminalFailureCode?: string;
  } | null | undefined;
  checkedAt: number;
}): {
  topicId: string;
  topicPatch: {
    status: "disqualified";
    contentFeasibilityStatus: "too_thin" | "quality_exhausted";
    contentFeasibilityVersion: number;
    contentFeasibilityIssues: string[];
    contentFeasibilityCheckedAt: number;
    disqualifiedReason: string;
    updatedAt: number;
  };
} | null {
  if (args.gateStatus !== "blocked") return null;
  if (args.qualityRevisionCount < args.maximumRevisions) return null;
  if (args.issues.length === 0) return null;
  const topic = args.topic;
  if (!topic || !args.article.topicId) return null;
  if (String(args.article.topicId) !== String(topic._id)) return null;
  if (args.article.siteId !== topic.siteId) return null;
  if (args.article.status === "published") return null;
  if (
    topic.status === "plan_checkpoint" ||
    Boolean(topic.planCheckpointTerminalFailureCode)
  ) return null;
  if (terminalContentFeasibility(topic.contentFeasibilityStatus)) return null;

  const status = args.issues.some((issue) => /article is too thin/i.test(issue))
    ? "too_thin" as const
    : "quality_exhausted" as const;
  const issues = args.issues.slice(0, 20);
  return {
    topicId: String(topic._id),
    topicPatch: {
      status: "disqualified",
      contentFeasibilityStatus: status,
      contentFeasibilityVersion: CONTENT_FEASIBILITY_VERSION,
      contentFeasibilityIssues: issues,
      contentFeasibilityCheckedAt: args.checkedAt,
      disqualifiedReason: `content_feasibility:${status}: ${issues.join("; ")}`,
      updatedAt: args.checkedAt,
    },
  };
}

/**
 * Reverse a quality-only topic quarantine once the exact linked artifact has
 * subsequently passed the current strict publication audit. Quality recovery
 * is allowed to improve prose; retaining the earlier terminal marker after a
 * successful seal makes a proven artifact and its topic contradict each
 * other, and can block every later cadence pass.
 *
 * This deliberately does not revive business-fit or plan-checkpoint
 * rejections. The content-feasibility receipt must be current, internally
 * consistent, and attached to the exact same tenant/topic/artifact.
 */
export function recoveredTopicQualitySettlement(args: {
  article: {
    siteId: string;
    topicId?: string | null;
    publicationGateStatus?: string;
    publicationAuditVersion?: number;
    auditedContentHash?: string;
  };
  topic: {
    _id: string;
    siteId: string;
    status?: string;
    businessFitEligible?: boolean;
    contentFeasibilityStatus?: string;
    contentFeasibilityVersion?: number;
    disqualifiedReason?: string;
    planCheckpointTerminalFailureCode?: string;
  } | null | undefined;
  recoveredAt: number;
}): {
  topicId: string;
  topicPatch: {
    contentFeasibilityStatus: undefined;
    contentFeasibilityVersion: undefined;
    contentFeasibilityIssues: undefined;
    contentFeasibilityCheckedAt: undefined;
    disqualifiedReason: undefined;
    updatedAt: number;
  };
} | null {
  const topic = args.topic;
  if (!topic || !args.article.topicId) return null;
  if (String(args.article.topicId) !== String(topic._id)) return null;
  if (args.article.siteId !== topic.siteId) return null;
  if (
    args.article.publicationGateStatus !== "passed" ||
    args.article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
    !args.article.auditedContentHash?.trim()
  ) return null;
  if (
    topic.status === "plan_checkpoint" ||
    Boolean(topic.planCheckpointTerminalFailureCode) ||
    topic.businessFitEligible === false
  ) return null;
  if (
    !terminalContentFeasibility(topic.contentFeasibilityStatus) ||
    topic.contentFeasibilityVersion !== CONTENT_FEASIBILITY_VERSION ||
    !topic.disqualifiedReason?.startsWith(
      `content_feasibility:${topic.contentFeasibilityStatus}:`,
    )
  ) return null;

  return {
    topicId: String(topic._id),
    topicPatch: {
      contentFeasibilityStatus: undefined,
      contentFeasibilityVersion: undefined,
      contentFeasibilityIssues: undefined,
      contentFeasibilityCheckedAt: undefined,
      disqualifiedReason: undefined,
      updatedAt: args.recoveredAt,
    },
  };
}

export type RecoverableWorkerQualityFailure = {
  actualWords: number;
  minimumWords?: number;
  maximumWords?: number;
  recoveryIssue: string;
  legacyFeasibilityStatus: "too_thin" | "quality_exhausted";
  legacyIssue: string;
};

/**
 * Recognize only an exhausted, deterministic prose-length failure. This is an
 * editing-algorithm defect, not evidence that the tenant's measured topic is
 * infeasible. The returned issue is deliberately stable so a later recovery
 * algorithm can migrate the exact article once without matching arbitrary
 * provider errors or customer prose.
 */
export function recoverableWorkerQualityFailure(args: {
  error: string;
  attempts: number;
  maximumAttempts: number;
}): RecoverableWorkerQualityFailure | null {
  if (args.attempts < args.maximumAttempts) return null;

  const exactWorkerError = args.error.replace(
    /^Worker failure exhausted after \d+ attempts:\s*/,
    "",
  );
  const lengthContract = exactWorkerError.match(
    /^(?:reviewed draft|remediation|post-remediation fact check) missed the length contract \((\d+)\/(\d+)-(\d+) words\)$/i,
  );
  const becameTooThin = exactWorkerError.match(
    /^(?:editorial rewrite|compression) became too thin \((\d+) words\)$/i,
  );
  let actualWords: number | undefined;
  let minimumWords: number | undefined;
  let maximumWords: number | undefined;
  let legacyFeasibilityStatus: "too_thin" | "quality_exhausted" | undefined;
  let legacyIssue: string | undefined;
  if (lengthContract) {
    actualWords = Number(lengthContract[1]);
    minimumWords = Number(lengthContract[2]);
    maximumWords = Number(lengthContract[3]);
    if (actualWords < minimumWords) {
      legacyFeasibilityStatus = "too_thin";
      legacyIssue =
        `Article is too thin (${actualWords} words; minimum ${minimumWords}).`;
    } else if (actualWords > maximumWords) {
      legacyFeasibilityStatus = "quality_exhausted";
      legacyIssue =
        `Article remains too long (${actualWords} words; maximum ${maximumWords}).`;
    }
  } else if (becameTooThin) {
    actualWords = Number(becameTooThin[1]);
    legacyFeasibilityStatus = "too_thin";
    legacyIssue =
      `Article is too thin (${actualWords} words; minimum required length not met).`;
  }
  if (
    actualWords === undefined || !legacyFeasibilityStatus || !legacyIssue
  ) return null;

  return {
    actualWords,
    minimumWords,
    maximumWords,
    recoveryIssue: minimumWords !== undefined && maximumWords !== undefined
      ? `Quality-review algorithm exhausted the strict length contract (${actualWords}/${minimumWords}-${maximumWords} words).`
      : `Quality-review algorithm exhausted below the strict length minimum (${actualWords} words).`,
    legacyFeasibilityStatus,
    legacyIssue,
  };
}

export function isRecoverableWorkerQualityIssue(issue: string): boolean {
  return /^Quality-review algorithm exhausted (?:the strict length contract \(\d+\/\d+-\d+ words\)|below the strict length minimum \(\d+ words\))\.$/.test(
    issue,
  );
}

/**
 * Reverse only the historical topic settlement produced by the old worker
 * classifier. Exact equality across every durable receipt prevents this
 * migration from reviving a topic disqualified by a real publication audit or
 * by an owner/business-fit decision.
 */
export function topicMatchesLegacyWorkerFailureSettlement(
  topic: {
    status?: string;
    contentFeasibilityStatus?: string;
    contentFeasibilityVersion?: number;
    contentFeasibilityIssues?: string[];
    disqualifiedReason?: string;
  },
  failure: RecoverableWorkerQualityFailure,
): boolean {
  return (
    topic.status === "disqualified" &&
    topic.contentFeasibilityStatus === failure.legacyFeasibilityStatus &&
    topic.contentFeasibilityVersion === CONTENT_FEASIBILITY_VERSION &&
    topic.contentFeasibilityIssues?.length === 1 &&
    topic.contentFeasibilityIssues[0] === failure.legacyIssue &&
    topic.disqualifiedReason ===
      `content_feasibility:${failure.legacyFeasibilityStatus}: ${failure.legacyIssue}`
  );
}

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
      .filter((topic) =>
        input.reservingTopicIds.has(topic.id) ||
        terminalContentFeasibility(topic.contentFeasibilityStatus)
      )
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
  if (input.checkpointExecutionLocked) {
    return input.currentStatus ?? "planned";
  }
  if (terminalContentFeasibility(input.contentFeasibilityStatus)) {
    return "disqualified";
  }
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
