import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getLimitsFromFeatures } from "../planLimits.ts";
import {
  TOPIC_BUSINESS_FIT_VERSION,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  reliableSerpFingerprint,
  tenantTopicBusinessSignals,
  type SerpCoverageTopic,
} from "./autopilotBuffer.ts";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./dataForSeoLocale.ts";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./planSiteAllowance.ts";

export const PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION = 2;
export const PLANNED_TOPIC_ACTIVE_JOB_READ_LIMIT = 250;
export const PLANNED_TOPIC_ARTICLE_USAGE_READ_LIMIT = 1_000;

/** Automatic planning already requires measured keyword data for every
 * enabled autopilot tenant. The legacy optional flag can only opt a paused
 * site into the same contract; an undefined value is not a tenant exclusion. */
export function verifiedKeywordPlanningActive(site: {
  autopilotEnabled?: boolean;
  verifiedKeywordDataRequired?: boolean;
}): boolean {
  return site.autopilotEnabled !== false ||
    site.verifiedKeywordDataRequired === true;
}

export type ExpectedClickTargetKind = "artifact" | "planned_topic";

export type PlannedEvidenceAttemptShape = {
  expectedClickEvidenceAttemptVersion?: number;
  expectedClickEvidenceAttemptKeyword?: string;
  primaryKeyword: string;
  updatedAt?: number;
};

function normalizeAttemptKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A paid planned-topic attempt is terminal for the exact policy/keyword.
 * Generic row maintenance timestamps are intentionally absent from this
 * predicate, so an ambiguous call cannot be repurchased after audit churn.
 */
export function hasExactPlannedEvidenceAttempt(
  topic: PlannedEvidenceAttemptShape,
  policyVersion: number,
): boolean {
  return topic.expectedClickEvidenceAttemptVersion === policyVersion &&
    normalizeAttemptKeyword(topic.expectedClickEvidenceAttemptKeyword ?? "") ===
      normalizeAttemptKeyword(topic.primaryKeyword);
}

/** Planned inventory is fleet fallback unless an operator supplies the exact
 * inspect/apply guard. A normal operator canary remains artifact-only. */
export function plannedTargetsAllowedForQueue(
  origin: string,
  hasRecoveryGuard: boolean,
): boolean {
  return origin === "autonomous_fleet" ||
    (origin === "operator_canary" && hasRecoveryGuard);
}

/** Preserve the first item from an already deterministically ordered list. */
export function uniqueExactPlannedTargets<T extends { keyword: string }>(
  targets: readonly T[],
): T[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const keyword = normalizeAttemptKeyword(target.keyword);
    if (!keyword || seen.has(keyword)) return false;
    seen.add(keyword);
    return true;
  });
}

/**
 * Planned-topic recovery has not bought a fresh SERP yet. Legacy SERP URLs
 * are bound into the phase fingerprint only as drift observations; they must
 * never weaken the conservative lexical coverage gate. Every inspector that
 * decides whether cheaper planned recovery exists uses this helper so a
 * micro-seed cannot defer to work that the demand/evidence paths will reject.
 */
export function filterPlannedTopicRecoveryCoverage<
  T extends SerpCoverageTopic,
>(
  topics: T[],
  coveredTopics: SerpCoverageTopic[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const withoutUnverifiedSerp = topics.map((topic) => ({
    ...topic,
    serpTopUrls: undefined,
  }));
  return filterNonCannibalizingIntentTopics(
    withoutUnverifiedSerp,
    coveredTopics,
    0.4,
    0.35,
    limit,
  );
}

/**
 * Separate genuinely distinct planned recovery from rows that the exact
 * recovery gate can never select. Apply the cardinality limit only after the
 * partition so valid overflow is not misclassified as cannibalizing.
 */
export function partitionPlannedTopicRecoveryCoverage<
  T extends SerpCoverageTopic,
>(
  topics: T[],
  coveredTopics: SerpCoverageTopic[],
  limit = Number.POSITIVE_INFINITY,
): { eligible: T[]; blocked: T[] } {
  const eligibleWithoutLimit = filterPlannedTopicRecoveryCoverage(
    topics,
    coveredTopics,
  );
  const eligibleKeywords = new Set(
    eligibleWithoutLimit.map((topic) => normalizeAttemptKeyword(
      topic.primaryKeyword,
    )),
  );
  return {
    eligible: eligibleWithoutLimit.slice(0, limit),
    blocked: topics.filter((topic) =>
      !eligibleKeywords.has(normalizeAttemptKeyword(topic.primaryKeyword))
    ),
  };
}

export type PlannedRecoverySelectedTopic = {
  topicId: Id<"topic_clusters">;
  keyword: string;
  fingerprint: string;
};

type PlannedRecoveryReadiness = null | {
  ready?: boolean;
  actionable?: boolean;
  reason?: string;
  continueToEvidence?: boolean;
  reservationDay?: string;
  rolloutEpoch?: number;
  candidateCounts?: { artifactEligible?: number };
  plannedSelection?: PlannedRecoverySelectedTopic[];
};

/**
 * The guarded operator bridge and micro-seed admission must agree on whether
 * ordinary planned recovery is truly executable. A raw topic predicate is
 * insufficient because unresolved receipts, daily batches, read limits, and
 * covered-artifact priority can all suppress the paid phase.
 */
export function selectPlannedRecoveryPhase(
  demand: PlannedRecoveryReadiness,
  evidence: PlannedRecoveryReadiness,
): null | {
  phase: "demand" | "evidence";
  inspectionDay: string;
  rolloutEpoch: number;
  selected: PlannedRecoverySelectedTopic[];
} {
  for (const candidate of [
    { phase: "demand" as const, value: demand },
    { phase: "evidence" as const, value: evidence },
  ]) {
    const value = candidate.value;
    if (
      value?.ready === true &&
      (value.candidateCounts?.artifactEligible ?? 0) === 0 &&
      (value.plannedSelection?.length ?? 0) > 0 &&
      typeof value.reservationDay === "string" &&
      typeof value.rolloutEpoch === "number"
    ) {
      return {
        phase: candidate.phase,
        inspectionDay: value.reservationDay,
        rolloutEpoch: value.rolloutEpoch,
        selected: value.plannedSelection!,
      };
    }
  }
  return null;
}

/** Decide whether cadence discovery may proceed after both ordinary recovery
 * phases were inspected from the same snapshot. Actionable uncertainty is a
 * hard stop. A clean demand backlog is also admissible: the micro topic is
 * materialized with current demand, and the evidence phase is allowed to
 * advance evidence-ready planned work ahead of unrelated demand-only rows. */
export function cadenceMicroSeedRecoveryBlockReason(
  demand: PlannedRecoveryReadiness,
  evidence: PlannedRecoveryReadiness,
): null | "planned_topic_recovery_available" |
  "expected_click_recovery_available" |
  "expected_click_recovery_unresolved" {
  if (selectPlannedRecoveryPhase(demand, evidence)) {
    return "planned_topic_recovery_available";
  }
  if (demand?.ready === true || evidence?.ready === true) {
    return "expected_click_recovery_available";
  }
  if (demand?.actionable === true || evidence?.actionable === true) {
    return "expected_click_recovery_unresolved";
  }
  // A micro topic must buy a new same-day evidence job immediately after
  // materialization. Both admitted states prove there is no evidence-ready
  // work now. `demand_candidates_remaining` is safe because the new micro
  // topic carries current demand and becomes the exact guarded evidence
  // selection; unresolved jobs, an existing evidence batch, and unknown
  // states still fail closed above or here.
  const cleanDemandBacklog =
    evidence?.reason === "demand_candidates_remaining" &&
    demand?.continueToEvidence === true;
  if (
    evidence?.reason !== "no_current_demand_candidates" &&
    !cleanDemandBacklog
  ) {
    return "expected_click_recovery_unresolved";
  }
  return null;
}

export type ExpectedClickSelectedTargetShape = {
  targetKind?: string;
  articleId?: unknown;
  articleStatus?: string;
  artifactHash?: string;
  plannedTopicFingerprint?: string;
};

/**
 * Missing `targetKind` is the compatibility representation for historical
 * artifact jobs. Mixed or unknown shapes fail closed instead of silently
 * becoming a planned-topic measurement.
 */
export function expectedClickTargetKind(
  selected: ExpectedClickSelectedTargetShape,
): ExpectedClickTargetKind | null {
  if (selected.targetKind === undefined || selected.targetKind === "artifact") {
    return selected.articleId !== undefined &&
        Boolean(selected.articleStatus?.trim()) &&
        Boolean(selected.artifactHash?.trim()) &&
        selected.plannedTopicFingerprint === undefined
      ? "artifact"
      : null;
  }
  if (selected.targetKind === "planned_topic") {
    return selected.articleId === undefined &&
        selected.articleStatus === undefined &&
        selected.artifactHash === undefined &&
        Boolean(selected.plannedTopicFingerprint?.trim())
      ? "planned_topic"
      : null;
  }
  return null;
}

function utcMonthStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export type PlannedTopicSiteGate =
  | {
      allowed: true;
      maxArticles: number;
      activeArticleUsage: number;
      remainingArticles: number;
    }
  | {
      allowed: false;
      reason:
        | "site_unavailable"
        | "rollout_ineligible"
        | "cadence_paused"
        | "verified_keyword_mode_required"
        | "plan_entitlement_missing"
        | "site_limit_reached"
        | "article_usage_read_limit_exhausted"
        | "article_quota_no_headroom";
    };

/** Reuse one atomic inventory snapshot when multiple readiness phases must be
 * compared in the same transaction. This avoids re-reading thousands of
 * tenant documents and guarantees both phases see identical site/coverage
 * state. */
export type PlannedRecoveryInventorySnapshot = {
  site: Doc<"sites">;
  topics: Doc<"topic_clusters">[];
  articles: Doc<"articles">[];
  activeArticleTopicIds: ReadonlySet<string>;
  activeJobsExhausted: boolean;
  plannedGate: PlannedTopicSiteGate;
  plannedAuthorityFresh: boolean;
};

/**
 * Planned evidence is useful only if the tenant is still entitled to generate
 * the eventual article. This is an inspection gate, not a quota reservation;
 * article generation retains its own atomic usage reservation later.
 */
export async function plannedTopicSiteGate(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites"> | null,
  timestamp: number,
): Promise<PlannedTopicSiteGate> {
  if (!siteExecutionActive(site) || !site.userId) {
    return { allowed: false, reason: "site_unavailable" };
  }
  if (
    !site.autopilotEnabled ||
    site.expectedClickSchedulingEnabled !== true ||
    !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
  ) {
    return { allowed: false, reason: "rollout_ineligible" };
  }
  if (!Number.isFinite(site.cadencePerWeek) || (site.cadencePerWeek ?? 0) <= 0) {
    return { allowed: false, reason: "cadence_paused" };
  }
  if (!verifiedKeywordPlanningActive(site)) {
    return { allowed: false, reason: "verified_keyword_mode_required" };
  }
  if (!(await siteExecutionAuthorized(ctx, site))) {
    return { allowed: false, reason: "plan_entitlement_missing" };
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const limits = getLimitsFromFeatures(
    entitlement?.planFeatures ?? site.planFeatures ?? [],
  );
  if (limits.maxSites < 9_999) {
    const activeSites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", site.userId!))
      .filter((q) => q.and(
        q.eq(q.field("deletionStatus"), undefined),
        q.eq(q.field("planParkedAt"), undefined),
        q.eq(q.field("domainOwnershipConflictAt"), undefined),
      ))
      .take(limits.maxSites + 1);
    if (
      activeSites.length > limits.maxSites ||
      !activeSites.some((candidate) => candidate._id === site._id)
    ) {
      return { allowed: false, reason: "site_limit_reached" };
    }
  }
  const usageRows = await ctx.db
    .query("usage_log")
    .withIndex("by_user_type_created", (q) => q
      .eq("userId", site.userId!)
      .eq("type", "article_generated")
      .gte("createdAt", utcMonthStart(timestamp)))
    .take(PLANNED_TOPIC_ARTICLE_USAGE_READ_LIMIT + 1);
  if (usageRows.length > PLANNED_TOPIC_ARTICLE_USAGE_READ_LIMIT) {
    return { allowed: false, reason: "article_usage_read_limit_exhausted" };
  }
  const activeArticleUsage = usageRows.filter((row) =>
    row.state !== "reserved" || (row.expiresAt ?? Infinity) > timestamp
  ).length;
  if (activeArticleUsage >= limits.maxArticles) {
    return { allowed: false, reason: "article_quota_no_headroom" };
  }
  return {
    allowed: true,
    maxArticles: limits.maxArticles,
    activeArticleUsage,
    remainingArticles: limits.maxArticles - activeArticleUsage,
  };
}

export type PlannedTopicAdmission = {
  eligible: boolean;
  reason?: string;
  fingerprint?: string;
};

type PlannedTopicSiteFingerprint = Pick<
  Doc<"sites">,
  | "_id"
  | "domain"
  | "niche"
  | "blogTheme"
  | "siteSummary"
  | "targetAudienceSummary"
  | "productUsage"
  | "siteType"
  | "anchorKeywords"
  | "keyFeatures"
  | "painPoints"
  | "targetCountry"
  | "language"
  | "cadencePerWeek"
  | "autopilotEnabled"
  | "autopilotRolloutMode"
  | "autopilotRolloutEpoch"
  | "expectedClickSchedulingEnabled"
  | "verifiedKeywordDataRequired"
>;

type PlannedTopicFingerprint = Pick<
  Doc<"topic_clusters">,
  | "_id"
  | "siteId"
  | "primaryKeyword"
  | "label"
  | "status"
  | "keywordDifficulty"
  | "keywordDifficultyMeasured"
  | "serpIntent"
  | "serpTopUrls"
  | "serpObservedAt"
  | "serpLocationCode"
  | "serpLanguageCode"
  | "searchVolume"
  | "searchDemandSource"
  | "searchDemandMeasuredAt"
  | "searchDemandLocationCode"
  | "searchDemandLanguageCode"
  | "businessFitEligible"
  | "businessFitScore"
  | "businessFitVersion"
  | "businessFitReasons"
  | "disqualifiedReason"
  | "planCheckpointSerpAttemptedAt"
  | "planCheckpointSerpReceipt"
  | "planCheckpointCandidateFingerprint"
  | "planCheckpointSeedManifestHash"
  | "planCheckpointWorkerExecution"
  | "planCheckpointTerminalFailureCode"
>;

/** Exact raw JSON is deliberate: no compact non-cryptographic hash collision
 * can authorize paid work for a different topic, tenant profile, or phase.
 * Legacy SERP fields are bound only as observational drift inputs; neither
 * phase treats them as verified evidence. */
export function plannedTopicRecoveryFingerprint(args: {
  phase: "demand" | "evidence";
  site: PlannedTopicSiteFingerprint;
  topic: PlannedTopicFingerprint;
}): string {
  const siteSignals = tenantTopicBusinessSignals(args.site);
  return JSON.stringify({
    version: PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION,
    phase: args.phase,
    siteId: String(args.site._id),
    domain: args.site.domain.trim().toLowerCase(),
    locationCode: dataForSeoLocationCode(args.site.targetCountry),
    languageCode: dataForSeoLanguageCode(args.site.language),
    verifiedKeywordDataRequired: verifiedKeywordPlanningActive(args.site),
    cadencePerWeek: args.site.cadencePerWeek,
    autopilotEnabled: args.site.autopilotEnabled,
    autopilotRolloutMode: args.site.autopilotRolloutMode,
    autopilotRolloutEpoch: args.site.autopilotRolloutEpoch ?? 0,
    expectedClickSchedulingEnabled: args.site.expectedClickSchedulingEnabled,
    businessSignals: siteSignals,
    topicId: String(args.topic._id),
    topicSiteId: String(args.topic.siteId),
    keyword: args.topic.primaryKeyword.trim().replace(/\s+/g, " ").toLowerCase(),
    label: args.topic.label.trim().replace(/\s+/g, " "),
    status: args.topic.status,
    keywordDifficulty: args.topic.keywordDifficulty,
    keywordDifficultyMeasured: args.topic.keywordDifficultyMeasured,
    serpIntent: args.topic.serpIntent?.trim().toLowerCase(),
    observationalSerpFingerprint:
      reliableSerpFingerprint(args.topic.serpTopUrls),
    observationalSerpObservedAt: args.topic.serpObservedAt,
    observationalSerpLocationCode: args.topic.serpLocationCode,
    observationalSerpLanguageCode:
      args.topic.serpLanguageCode?.trim().toLowerCase(),
    searchVolume: args.topic.searchVolume,
    searchDemandSource: args.topic.searchDemandSource,
    searchDemandMeasuredAt: args.topic.searchDemandMeasuredAt,
    searchDemandLocationCode: args.topic.searchDemandLocationCode,
    searchDemandLanguageCode:
      args.topic.searchDemandLanguageCode?.trim().toLowerCase(),
    businessFitEligible: args.topic.businessFitEligible,
    businessFitScore: args.topic.businessFitScore,
    businessFitVersion: args.topic.businessFitVersion,
    businessFitReasons: args.topic.businessFitReasons ?? [],
    disqualifiedReason: args.topic.disqualifiedReason,
    planCheckpointSerpAttemptedAt:
      args.topic.planCheckpointSerpAttemptedAt,
    planCheckpointSerpReceipt: args.topic.planCheckpointSerpReceipt,
    planCheckpointCandidateFingerprint:
      args.topic.planCheckpointCandidateFingerprint,
    planCheckpointSeedManifestHash:
      args.topic.planCheckpointSeedManifestHash,
    planCheckpointWorkerExecution:
      args.topic.planCheckpointWorkerExecution,
    planCheckpointTerminalFailureCode:
      args.topic.planCheckpointTerminalFailureCode,
  });
}

type PlannedTopicPhaseAdmissionArgs = {
  site: PlannedTopicSiteFingerprint;
  topic: PlannedTopicFingerprint;
  hasLinkedArticle: boolean;
  hasActiveArticleJob: boolean;
};

function plannedTopicPhaseAdmission(
  args: PlannedTopicPhaseAdmissionArgs,
  phase: "demand" | "evidence",
): PlannedTopicAdmission {
  const { site, topic } = args;
  if (topic.siteId !== site._id) return { eligible: false, reason: "wrong_tenant" };
  if (topic.status !== "planned") {
    return { eligible: false, reason: "topic_not_planned" };
  }
  if (topic.planCheckpointTerminalFailureCode) {
    return { eligible: false, reason: "plan_checkpoint_terminal" };
  }
  const checkpointSerpStarted = Number.isFinite(
    topic.planCheckpointSerpAttemptedAt,
  );
  if (
    phase === "demand" &&
    (checkpointSerpStarted || topic.planCheckpointSerpReceipt !== undefined)
  ) {
    return {
      eligible: false,
      reason: "plan_checkpoint_serp_already_attempted",
    };
  }
  if (args.hasLinkedArticle) {
    return { eligible: false, reason: "linked_article_exists" };
  }
  if (args.hasActiveArticleJob) {
    return { eligible: false, reason: "active_article_job" };
  }
  if (topic.disqualifiedReason || topic.businessFitEligible !== true) {
    return { eligible: false, reason: "business_fit_not_verified" };
  }
  const keyword = topic.primaryKeyword.trim().replace(/\s+/g, " ");
  if (!keyword) return { eligible: false, reason: "keyword_missing" };
  if (
    topic.keywordDifficultyMeasured !== true ||
    !Number.isFinite(topic.keywordDifficulty) ||
    (topic.keywordDifficulty ?? -1) < 0 ||
    (topic.keywordDifficulty ?? Infinity) > 100
  ) {
    return { eligible: false, reason: "keyword_difficulty_unverified" };
  }
  const fit = evaluateTopicBusinessFit({
    keyword: topic.primaryKeyword,
    label: topic.label,
    ...tenantTopicBusinessSignals(site),
  });
  if (
    !fit.eligible ||
    fit.version !== TOPIC_BUSINESS_FIT_VERSION ||
    topic.businessFitVersion !== fit.version ||
    topic.businessFitScore !== fit.score ||
    JSON.stringify(topic.businessFitReasons ?? []) !== JSON.stringify(fit.reasons)
  ) {
    return { eligible: false, reason: "business_fit_drifted" };
  }
  return {
    eligible: true,
    fingerprint: plannedTopicRecoveryFingerprint({ phase, site, topic }),
  };
}

/** Demand admission buys only exact keyword demand. Stored legacy SERP URLs
 * never authorize the purchase and may be absent or lack provenance. */
export function plannedTopicDemandAdmission(
  args: PlannedTopicPhaseAdmissionArgs,
): PlannedTopicAdmission {
  return plannedTopicPhaseAdmission(args, "demand");
}

/** Evidence admission authorizes one fresh SERP request only after exact,
 * positive, current-locale demand exists. The returned SERP is validated and
 * durably locale-bound before any authority request or topic persistence. */
export function plannedTopicEvidenceAdmission(
  args: PlannedTopicPhaseAdmissionArgs & {
    hasCurrentPositiveDemand: boolean;
    timestamp?: number;
  },
): PlannedTopicAdmission {
  const admission = plannedTopicPhaseAdmission(args, "evidence");
  if (!admission.eligible) return admission;
  if (!args.hasCurrentPositiveDemand) {
    return { eligible: false, reason: "current_positive_demand_required" };
  }
  if (
    Number.isFinite(args.topic.planCheckpointSerpAttemptedAt) ||
    args.topic.planCheckpointSerpReceipt !== undefined
  ) {
    return {
      eligible: false,
      reason: "plan_checkpoint_serp_already_attempted",
    };
  }
  return admission;
}

function payloadTopicId(job: Doc<"jobs">): string | undefined {
  if (!job.payload || typeof job.payload !== "object") return undefined;
  const value = (job.payload as Record<string, unknown>).topicId;
  return typeof value === "string" ? value : undefined;
}

export async function activeArticleJobTopicIds(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
): Promise<{ topicIds: Set<string>; exhausted: boolean }> {
  const groups = await Promise.all(["pending", "running"].map((status) =>
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", status))
      .take(PLANNED_TOPIC_ACTIVE_JOB_READ_LIMIT + 1)
  ));
  const exhausted = groups.some((rows) =>
    rows.length > PLANNED_TOPIC_ACTIVE_JOB_READ_LIMIT
  );
  const topicIds = new Set<string>();
  for (const job of groups.flatMap((rows) =>
    rows.slice(0, PLANNED_TOPIC_ACTIVE_JOB_READ_LIMIT)
  )) {
    if (job.type !== "article") continue;
    const topicId = payloadTopicId(job);
    if (topicId) topicIds.add(topicId);
  }
  return { topicIds, exhausted };
}
