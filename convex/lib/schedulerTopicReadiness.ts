import {
  evaluateTopicBusinessFit,
  tenantTopicBusinessSignals,
  type TenantTopicSignalSource,
} from "./autopilotBuffer.ts";
import {
  evaluateStoredExpectedClickPortfolio,
  type ExpectedClickPortfolioEvaluation,
} from "./expectedClickPortfolio.ts";
import { planCheckpointTopicExecutionLocked } from
  "./planCandidateCheckpoint.ts";
import {
  evaluateSerpAttainability,
  evaluateSerpBusinessIntent,
} from "./serpAttainability.ts";
import {
  decideOpportunity,
  type OpportunityDecision,
} from "./growthLoopContracts.ts";
import { sha256Hex } from "./publicationArtifact.ts";
import { terminalContentFeasibility } from "./topicLifecycle.ts";

export const SCHEDULER_TOPIC_INVENTORY_READ_LIMIT = 2_000;

export type SchedulerReadyTopic = {
  _id: unknown;
  status?: string;
  label?: string;
  primaryKeyword: string;
  searchVolume?: number;
  keywordDifficulty?: number;
  keywordDifficultyMeasured?: boolean;
  searchDemandSource?: string;
  searchDemandMeasuredAt?: number;
  searchDemandLocationCode?: number;
  searchDemandLanguageCode?: string;
  serpIntent?: string;
  serpTopUrls?: string[];
  serpObservedAt?: number;
  serpLocationCode?: number;
  serpLanguageCode?: string;
  serpAuthorityCompetitors?: Array<{
    position: number;
    url: string;
    domain: string;
    domainRank: number;
    referringDomains?: number;
    source: string;
    measuredAt: number;
  }>;
  planCheckpointId?: unknown;
  planCheckpointTerminalFailureCode?: string;
  contentFeasibilityStatus?: string;
};

export type SchedulerReadySite = TenantTopicSignalSource & {
  domain?: string | null;
  targetCountry?: string | null;
  language?: string | null;
  seoAuthorityDomainRank?: number;
  seoAuthorityReferringDomains?: number;
  seoAuthorityDomain?: string;
  seoAuthoritySource?: string;
  seoAuthorityMeasuredAt?: number;
};

const SCHEDULABLE_TOPIC_STATUSES = new Set(["planned", "pending"]);

/**
 * Bind the numeric receipt version to the complete deterministic evidence
 * fingerprint. Policy versions alone are not evidence identities: a topic can
 * move from planned to used (or receive new demand/SERP measurements) while
 * the OpportunityDecision policy remains v1. Reusing that policy number made
 * the immutable receipt writer treat the truthful new decision as a conflict
 * and crash every later cadence run.
 *
 * Thirteen hexadecimal digits fit exactly inside JavaScript's safe-integer
 * range. The full hash remains stored beside the version and is compared by
 * the writer, so a conflicting fingerprint still fails closed.
 */
export function opportunityEvidenceVersionFromInputHash(
  inputHash: string,
): number {
  if (!/^[0-9a-f]{64}$/i.test(inputHash)) {
    throw new Error("Opportunity evidence input hash is invalid");
  }
  const version = Number.parseInt(inputHash.slice(0, 13), 16);
  return version === 0 ? 1 : version;
}

/**
 * An immutable opportunity receipt identifies both the measured inputs and
 * the deterministic decision produced from them. A policy repair can
 * legitimately classify the same stored evidence differently; omitting the
 * output from the fingerprint made that repair collide with the older
 * receipt and crash every later cadence run.
 *
 * `nextEligibleAt` is intentionally excluded. It is a wall-clock wake time,
 * not part of the decision semantics, and including it would manufacture a
 * new receipt on every evaluation.
 */
export function opportunityDecisionInputHash(
  evidence: Record<string, unknown>,
  decision: Pick<
    OpportunityDecision,
    "classification" | "admitted" | "score" | "reasons" | "version"
  >,
): string {
  return sha256Hex(JSON.stringify({
    ...evidence,
    decision: {
      classification: decision.classification,
      admitted: decision.admitted,
      score: decision.score,
      reasons: decision.reasons,
      version: decision.version,
    },
  }));
}

/**
 * One fail-closed topic decision shared by setup readiness and every automatic
 * cadence inventory projection. Callers supply only deterministic, freshly
 * recomputed decisions; stored display fields can never manufacture readiness.
 */
export function schedulerReadyTopic(args: {
  topic: SchedulerReadyTopic;
  opportunityAdmitted?: boolean;
  // Compatibility inputs for pure callers while the persisted v1
  // OpportunityDecision is rolled out across existing tenants.
  businessFitEligible?: boolean;
  serpBusinessIntentAligned?: boolean;
  expectedClickStatus?: string;
  serpAttainable?: boolean;
}): boolean {
  const { topic } = args;
  const admitted = args.opportunityAdmitted ?? Boolean(
    args.businessFitEligible && args.serpBusinessIntentAligned &&
    args.expectedClickStatus === "eligible" && args.serpAttainable,
  );
  return SCHEDULABLE_TOPIC_STATUSES.has(topic.status ?? "planned") &&
    !planCheckpointTopicExecutionLocked(topic) &&
    Number.isFinite(topic.searchVolume) &&
    Number.isFinite(topic.keywordDifficulty) &&
    topic.keywordDifficultyMeasured === true &&
    Boolean(topic.serpIntent?.trim()) &&
    (topic.serpTopUrls?.length ?? 0) >= 5 &&
    admitted;
}

export function evaluateSchedulerReadyTopicInventory(args: {
  site: SchedulerReadySite;
  topics: SchedulerReadyTopic[];
  monthlyOrganicClickGoal: number;
  currentLocationCode: number;
  currentLanguageCode: string;
}): {
  portfolio: ExpectedClickPortfolioEvaluation;
  schedulerReadyTopicIds: string[];
  opportunityDecisions: Array<OpportunityDecision & {
    topicId?: string;
    opportunityKey: string;
    evidenceVersion: number;
    inputHash: string;
  }>;
} {
  // Only unconsumed inventory can support a forward click goal. Published or
  // otherwise consumed topics remain in GSC/outcome analysis, never in the
  // pool that claims another article can be produced.
  const portfolioTopics = args.topics.filter((topic) =>
    SCHEDULABLE_TOPIC_STATUSES.has(topic.status ?? "planned") &&
    !topic.planCheckpointTerminalFailureCode
  );
  const portfolio = evaluateStoredExpectedClickPortfolio({
    topics: portfolioTopics.map((topic) => ({
      topicId: String(topic._id),
      keyword: topic.primaryKeyword,
      searchVolume: topic.searchVolume,
      searchDemandSource: topic.searchDemandSource,
      searchDemandMeasuredAt: topic.searchDemandMeasuredAt,
      searchDemandLocationCode: topic.searchDemandLocationCode,
      searchDemandLanguageCode: topic.searchDemandLanguageCode,
      serpTopUrls: topic.serpTopUrls,
      serpObservedAt: topic.serpObservedAt,
      serpLocationCode: topic.serpLocationCode,
      serpLanguageCode: topic.serpLanguageCode,
      serpAuthorityCompetitors: topic.serpAuthorityCompetitors,
    })),
    tenantAuthority: {
      domain: args.site.seoAuthorityDomain,
      currentDomain: args.site.domain ?? undefined,
      domainRank: args.site.seoAuthorityDomainRank,
      referringDomains: args.site.seoAuthorityReferringDomains,
      source: args.site.seoAuthoritySource,
      measuredAt: args.site.seoAuthorityMeasuredAt,
    },
    monthlyOrganicClickGoal: args.monthlyOrganicClickGoal,
    currentLocationCode: args.currentLocationCode,
    currentLanguageCode: args.currentLanguageCode,
  });
  const expectedClickByTopic = new Map(
    portfolio.topics.map((topic) => [topic.topicId, topic]),
  );
  const businessSignals = tenantTopicBusinessSignals(args.site);
  const siteHost = String(args.site.domain ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];
  const forwardCandidateCount = portfolioTopics.length;
  const evaluatedAt = Date.now();
  const opportunityDecisions: Array<OpportunityDecision & {
    topicId?: string;
    opportunityKey: string;
    evidenceVersion: number;
    inputHash: string;
  }> = args.topics.map((topic) => {
    const fit = evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: topic.label,
      ...businessSignals,
    });
    const hasMeasuredSerp = (topic.serpTopUrls?.length ?? 0) >= 5;
    const serpIntent = hasMeasuredSerp
      ? evaluateSerpBusinessIntent({
          results: topic.serpTopUrls!.map((url) => ({ url })),
          businessModelSignals: businessSignals.businessModelSignals,
        })
      : { aligned: false };
    const attainable = evaluateSerpAttainability({
      serpTopUrls: topic.serpTopUrls,
      siteHost,
    }).attainable;
    const estimate = expectedClickByTopic.get(String(topic._id));
    const status = topic.status ?? "planned";
    const decision = decideOpportunity({
      businessFitScore: fit.score,
      // Missing SERP evidence is recoverable `needs_evidence`, not a false
      // terminal product-fit failure. A measured intent mismatch still fails
      // closed before generation.
      businessFitEligible: fit.eligible &&
        (!hasMeasuredSerp || serpIntent.aligned),
      monthlyDemand: topic.searchVolume,
      expectedClicksMonthly: estimate?.expectedClicksMonthly,
      serpAttainable: attainable,
      commercialRelevance: fit.score / 100,
      // A broad, measured page-one source set is the current deterministic
      // pre-generation depth evidence. Publication still enforces full source,
      // factual, media, metadata and rendering gates before sealing.
      contentDepthScore: Math.min(1, (topic.serpTopUrls?.length ?? 0) / 8),
      contentFeasibilityFailed: terminalContentFeasibility(
        topic.contentFeasibilityStatus,
      ),
      evidenceFresh: estimate?.status === "eligible" &&
        Number.isFinite(topic.keywordDifficulty) &&
        topic.keywordDifficultyMeasured === true &&
        Boolean(topic.serpIntent?.trim()),
      coverageConflict:
        !terminalContentFeasibility(topic.contentFeasibilityStatus) &&
        !SCHEDULABLE_TOPIC_STATUSES.has(status),
      remainingCandidateCount: forwardCandidateCount,
    }, evaluatedAt);
    const topicId = String(topic._id);
    const inputHash = opportunityDecisionInputHash({
      topicId,
      status,
      fitScore: fit.score,
      fitEligible: fit.eligible,
      serpIntentAligned: serpIntent.aligned,
      attainable,
      expectedClickEvidenceVersion: estimate?.version,
      expectedClickStatus: estimate?.status,
      expectedClicksMonthly: estimate?.expectedClicksMonthly,
      searchVolume: topic.searchVolume,
      keywordDifficulty: topic.keywordDifficulty,
      keywordDifficultyMeasured: topic.keywordDifficultyMeasured,
      serpIntent: topic.serpIntent,
      serpResultCount: topic.serpTopUrls?.length ?? 0,
      contentFeasibilityStatus: topic.contentFeasibilityStatus,
      remainingCandidateCount: forwardCandidateCount,
    }, decision);
    return {
      ...decision,
      topicId,
      opportunityKey: topicId,
      evidenceVersion: opportunityEvidenceVersionFromInputHash(inputHash),
      inputHash,
    };
  });
  const forwardTopicIds = new Set(portfolioTopics.map((topic) =>
    String(topic._id)
  ));
  const forwardDecisions = opportunityDecisions.filter((decision) =>
    decision.topicId && forwardTopicIds.has(decision.topicId)
  );
  const terminalForwardClassifications = new Set([
    "too_thin",
    "coverage_conflict",
    "business_fit_failed",
  ]);
  // A non-empty table is not usable inventory when every remaining row has
  // already received a terminal refusal. Treating those rows as perpetual
  // forward opportunity made the scheduler repeatedly report
  // `work_in_progress` even though no topic could ever be admitted. Preserve
  // needs-evidence and cooldown rows as recoverable; only a fully terminal set
  // converges to the site-level exhaustion receipt.
  const forwardOpportunitySpaceExhausted = forwardCandidateCount === 0 ||
    (forwardDecisions.length === forwardCandidateCount &&
      forwardDecisions.every((decision) =>
        terminalForwardClassifications.has(decision.classification)
      ));
  if (forwardOpportunitySpaceExhausted) {
    const decision = decideOpportunity(
      { remainingCandidateCount: 0 },
      evaluatedAt,
    );
    const inputHash = opportunityDecisionInputHash({
      opportunityKey: "__forward_opportunity_space__",
      recheckDay: Math.floor(evaluatedAt / (24 * 60 * 60 * 1000)),
      forwardCandidateCount,
      forwardDecisions: forwardDecisions.map((decision) => ({
        topicId: decision.topicId,
        classification: decision.classification,
        inputHash: decision.inputHash,
      })).sort((left, right) =>
        String(left.topicId).localeCompare(String(right.topicId))
      ),
      topicStates: args.topics.map((topic) => ({
        topicId: String(topic._id),
        status: topic.status ?? "planned",
        terminalFailure: topic.planCheckpointTerminalFailureCode,
        contentFeasibilityStatus: topic.contentFeasibilityStatus,
      })).sort((left, right) => left.topicId.localeCompare(right.topicId)),
    }, decision);
    opportunityDecisions.push({
      ...decision,
      opportunityKey: "__forward_opportunity_space__",
      evidenceVersion: opportunityEvidenceVersionFromInputHash(inputHash),
      inputHash,
    });
  }
  const decisionByTopicId = new Map(
    opportunityDecisions.flatMap((decision) =>
      decision.topicId ? [[decision.topicId, decision] as const] : []),
  );
  const schedulerReadyTopicIds = args.topics.flatMap((topic) => {
    const decision = decisionByTopicId.get(String(topic._id));
    return schedulerReadyTopic({
      topic,
      opportunityAdmitted: decision?.admitted === true,
    })
      ? [String(topic._id)]
      : [];
  });
  return { portfolio, schedulerReadyTopicIds, opportunityDecisions };
}
