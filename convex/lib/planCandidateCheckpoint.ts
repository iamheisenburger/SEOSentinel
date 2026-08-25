import { sha256Hex } from "./publicationArtifact.ts";

export const PLAN_CANDIDATE_CHECKPOINT_VERSION = 1;
export const PLAN_CANDIDATE_CHECKPOINT_STATUS = "plan_checkpoint";
export const PLAN_CANDIDATE_CHECKPOINT_LIMIT = 10;

/**
 * Reconcile a terminal close without losing exclusions already sealed by the
 * inline evaluator. The writer supplies the rows it just proved terminal; the
 * returned list is always the immutable candidate order and therefore cannot
 * turn a partial/corrupt close into a plausible count receipt.
 */
export function terminalCheckpointClosePartition<T extends string>(args: {
  candidateIds: readonly T[];
  priorTerminallyExcludedIds?: readonly T[];
  provenTerminallyExcludedIds: readonly T[];
}): T[] | null {
  const candidates = new Set<T>(args.candidateIds);
  if (
    args.candidateIds.length === 0 ||
    args.candidateIds.length > PLAN_CANDIDATE_CHECKPOINT_LIMIT ||
    candidates.size !== args.candidateIds.length
  ) return null;

  const prior = args.priorTerminallyExcludedIds ?? [];
  const proven = args.provenTerminallyExcludedIds;
  const priorSet = new Set<T>(prior);
  const provenSet = new Set<T>(proven);
  if (
    priorSet.size !== prior.length ||
    provenSet.size !== proven.length ||
    prior.some((id) => !candidates.has(id)) ||
    proven.some((id) => !candidates.has(id))
  ) return null;

  const terminal = new Set<T>([...prior, ...proven]);
  if (
    terminal.size !== args.candidateIds.length ||
    args.candidateIds.some((id) => !terminal.has(id))
  ) return null;
  return [...args.candidateIds];
}

/** Validate the only two nonterminal checkpoint shapes a terminal close may
 * consume. In particular, an inline seal must already contain the exact
 * disjoint partition written by completeInline; terminal cleanup may not
 * manufacture missing receipt metadata from topic tombstones. */
export function terminalCheckpointPreclosePartition<T extends string>(args: {
  status: string;
  candidateIds: readonly T[];
  inlineCompletedIds?: readonly T[];
  terminallyExcludedIds?: readonly T[];
  activatedIds?: readonly T[];
}): {
  priorTerminallyExcludedIds: T[];
  candidateIdsToExclude: T[];
} | null {
  const candidates = new Set<T>(args.candidateIds);
  if (
    args.candidateIds.length === 0 ||
    args.candidateIds.length > PLAN_CANDIDATE_CHECKPOINT_LIMIT ||
    candidates.size !== args.candidateIds.length
  ) return null;
  if (args.status === "active") {
    if (
      args.inlineCompletedIds !== undefined ||
      args.terminallyExcludedIds !== undefined ||
      args.activatedIds !== undefined
    ) return null;
    return {
      priorTerminallyExcludedIds: [],
      candidateIdsToExclude: [...args.candidateIds],
    };
  }
  if (
    args.status !== "inline_sealed" ||
    args.inlineCompletedIds === undefined ||
    args.terminallyExcludedIds === undefined ||
    args.activatedIds !== undefined
  ) return null;
  const completed = new Set<T>(args.inlineCompletedIds);
  const excluded = new Set<T>(args.terminallyExcludedIds);
  if (
    completed.size !== args.inlineCompletedIds.length ||
    excluded.size !== args.terminallyExcludedIds.length ||
    args.inlineCompletedIds.some((id) => !candidates.has(id)) ||
    args.terminallyExcludedIds.some((id) => !candidates.has(id)) ||
    args.inlineCompletedIds.some((id) => excluded.has(id)) ||
    completed.size + excluded.size !== args.candidateIds.length ||
    args.candidateIds.some((id) => !completed.has(id) && !excluded.has(id))
  ) return null;
  return {
    priorTerminallyExcludedIds: [...args.terminallyExcludedIds],
    candidateIdsToExclude: args.candidateIds.filter((id) => completed.has(id)),
  };
}

export type PlanCheckpointTopicFence = {
  status?: string;
  planCheckpointId?: unknown;
  planCheckpointTerminalFailureCode?: string;
};

/** In-flight and terminal checkpoint rows are never article inventory. A
 * successfully activated checkpoint keeps its lineage but becomes ordinary
 * `planned` inventory, so lineage alone is not an execution lock. */
export function planCheckpointTopicExecutionLocked(
  topic: PlanCheckpointTopicFence,
): boolean {
  return topic.status === PLAN_CANDIDATE_CHECKPOINT_STATUS ||
    Boolean(topic.planCheckpointTerminalFailureCode);
}

/** Checkpoint lineage is a durable paid-attempt tombstone. Owner cleanup must
 * not delete it; only the site/account deletion workflow may purge the row
 * after execution has been fenced. */
export function planCheckpointTopicDeletionLocked(
  topic: PlanCheckpointTopicFence,
): boolean {
  return topic.planCheckpointId !== undefined ||
    planCheckpointTopicExecutionLocked(topic);
}

export type PlanSeedBatchManifest = {
  siteId: string;
  planJobId: string;
  workerExecution: number;
  replenishmentSequence: number;
  locationCode: number;
  languageCode: string;
  candidateCapacity: number;
  seedBatches: string[][];
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedSeedBatches(seedBatches: string[][]): string[][] {
  return seedBatches.map((batch) =>
    batch.map(normalizeText).filter(Boolean)
  ).filter((batch) => batch.length > 0);
}

export function planSeedBatchManifestHash(
  manifest: PlanSeedBatchManifest,
): string {
  return sha256Hex(JSON.stringify({
    contract: "plan-candidate-seed-manifest-v1",
    version: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    siteId: manifest.siteId,
    planJobId: manifest.planJobId,
    workerExecution: manifest.workerExecution,
    replenishmentSequence: manifest.replenishmentSequence,
    locationCode: manifest.locationCode,
    languageCode: normalizeText(manifest.languageCode),
    candidateCapacity: manifest.candidateCapacity,
    seedBatches: normalizedSeedBatches(manifest.seedBatches),
  }));
}

export type PlanCheckpointCandidate = {
  label: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent?: string;
  priority?: number;
  articleType?: string;
  notes?: string;
  searchVolume: number;
  keywordDifficulty: number;
  keywordDifficultyMeasured: true;
  cpc?: number;
  serpIntent?: string;
  volumeTrend?: number[];
  searchDemandSource: string;
  searchDemandMeasuredAt: number;
  searchDemandLocationCode: number;
  searchDemandLanguageCode: string;
  businessFitEligible: true;
  businessFitScore: number;
  businessFitVersion: number;
  businessFitReasons: string[];
};

export function planCheckpointCandidateFingerprint(args: {
  siteId: string;
  planJobId: string;
  workerExecution: number;
  seedManifestHash: string;
  ordinal: number;
  candidate: PlanCheckpointCandidate;
}): string {
  const candidate = args.candidate;
  return sha256Hex(JSON.stringify({
    contract: "plan-candidate-checkpoint-v1",
    version: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    siteId: args.siteId,
    planJobId: args.planJobId,
    workerExecution: args.workerExecution,
    seedManifestHash: args.seedManifestHash,
    ordinal: args.ordinal,
    candidate: {
      label: candidate.label.trim().replace(/\s+/g, " "),
      primaryKeyword: normalizeText(candidate.primaryKeyword),
      secondaryKeywords: candidate.secondaryKeywords.map(normalizeText),
      intent: candidate.intent && normalizeText(candidate.intent),
      priority: candidate.priority,
      articleType: candidate.articleType && normalizeText(candidate.articleType),
      notes: candidate.notes?.trim(),
      searchVolume: candidate.searchVolume,
      keywordDifficulty: candidate.keywordDifficulty,
      keywordDifficultyMeasured: candidate.keywordDifficultyMeasured,
      cpc: candidate.cpc,
      serpIntent: candidate.serpIntent && normalizeText(candidate.serpIntent),
      volumeTrend: candidate.volumeTrend ?? [],
      searchDemandSource: candidate.searchDemandSource,
      searchDemandMeasuredAt: candidate.searchDemandMeasuredAt,
      searchDemandLocationCode: candidate.searchDemandLocationCode,
      searchDemandLanguageCode: normalizeText(
        candidate.searchDemandLanguageCode,
      ),
      businessFitEligible: candidate.businessFitEligible,
      businessFitScore: candidate.businessFitScore,
      businessFitVersion: candidate.businessFitVersion,
      businessFitReasons: candidate.businessFitReasons,
    },
  }));
}

export type InlinePlanSerpReceipt = {
  version: number;
  candidateFingerprint: string;
  seedManifestHash: string;
  workerExecution: number;
  normalizedUrlFingerprint: string;
  observedAt: number;
  locationCode: number;
  languageCode: string;
  results: Array<{ position: number; url: string }>;
  businessIntentAligned: true;
  attainable: true;
  cannibalizationClear: true;
};

function normalizedEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${
      url.pathname.replace(/\/+$/, "") || "/"
    }`;
  } catch {
    return null;
  }
}

/** Exact position-aware fingerprint of the normalized organic result set. */
export function planSerpResultFingerprint(
  results: Array<{ position: number; url: string }>,
): string | null {
  const normalizedResults = results
    .map((result) => ({
      position: result.position,
      url: normalizedEvidenceUrl(result.url),
    }))
    .sort((left, right) => left.position - right.position);
  if (
    normalizedResults.length < 5 ||
    normalizedResults.some((result) =>
      !Number.isInteger(result.position) ||
      result.position < 1 ||
      result.position > 10 ||
      !result.url) ||
    new Set(normalizedResults.map((result) => result.position)).size !==
      normalizedResults.length ||
    new Set(normalizedResults.map((result) => result.url)).size !==
      normalizedResults.length
  ) return null;
  return sha256Hex(JSON.stringify({
    contract: "plan-serp-normalized-url-set-v1",
    results: normalizedResults,
  }));
}

export function inlinePlanSerpReceiptValid(args: {
  receipt?: InlinePlanSerpReceipt;
  candidateFingerprint?: string;
  seedManifestHash?: string;
  workerExecution?: number;
  locationCode: number;
  languageCode: string;
  attemptedAt?: number;
  now: number;
}): boolean {
  const receipt = args.receipt;
  if (!receipt) return false;
  const normalizedUrlFingerprint = planSerpResultFingerprint(receipt.results);
  return (
    receipt.version === PLAN_CANDIDATE_CHECKPOINT_VERSION &&
    receipt.candidateFingerprint === args.candidateFingerprint &&
    receipt.seedManifestHash === args.seedManifestHash &&
    receipt.workerExecution === args.workerExecution &&
    Boolean(normalizedUrlFingerprint) &&
    receipt.normalizedUrlFingerprint === normalizedUrlFingerprint &&
    receipt.locationCode === args.locationCode &&
    normalizeText(receipt.languageCode) === normalizeText(args.languageCode) &&
    receipt.businessIntentAligned === true &&
    receipt.attainable === true &&
    receipt.cannibalizationClear === true &&
    Number.isFinite(args.attemptedAt) &&
    Number.isFinite(receipt.observedAt) &&
    receipt.observedAt >= (args.attemptedAt ?? Infinity) &&
    receipt.observedAt <= args.now + 5 * 60 * 1000
  );
}

export type TerminalCheckpointCandidateDecision =
  | "activate_unattempted"
  | "disqualify_attempted"
  | "terminally_excluded"
  | "ignore";

/** Operational failures may activate only still-eligible candidates. A paid
 * ambiguous attempt is terminal and a semantic rejection never re-enters the
 * planned-topic fleet. */
export function terminalCheckpointCandidateDecision(args: {
  status?: string;
  attemptedAt?: number;
  receiptValid: boolean;
  terminalFailureCode?: string;
}): TerminalCheckpointCandidateDecision {
  if (args.status === "disqualified" || args.terminalFailureCode) {
    return "terminally_excluded";
  }
  if (args.status !== PLAN_CANDIDATE_CHECKPOINT_STATUS) return "ignore";
  // The narrowed rollout never adopts a begun provider call. An exact receipt
  // remains useful audit evidence, but only never-attempted rows may activate.
  if (args.receiptValid || Number.isFinite(args.attemptedAt)) {
    return "disqualify_attempted";
  }
  return "activate_unattempted";
}
