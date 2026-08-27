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
    topicId: string;
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
  const opportunityDecisions = args.topics.map((topic) => {
    const fit = evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: topic.label,
      ...businessSignals,
    });
    const serpIntent = (topic.serpTopUrls?.length ?? 0) >= 5
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
      businessFitEligible: fit.eligible && serpIntent.aligned,
      monthlyDemand: topic.searchVolume,
      expectedClicksMonthly: estimate?.expectedClicksMonthly,
      serpAttainable: attainable,
      commercialRelevance: fit.score / 100,
      // A broad, measured page-one source set is the current deterministic
      // pre-generation depth evidence. Publication still enforces full source,
      // factual, media, metadata and rendering gates before sealing.
      contentDepthScore: Math.min(1, (topic.serpTopUrls?.length ?? 0) / 8),
      evidenceFresh: estimate?.status === "eligible" &&
        Number.isFinite(topic.keywordDifficulty) &&
        topic.keywordDifficultyMeasured === true &&
        Boolean(topic.serpIntent?.trim()),
      coverageConflict: !SCHEDULABLE_TOPIC_STATUSES.has(status),
      remainingCandidateCount: forwardCandidateCount,
    }, Date.now());
    const topicId = String(topic._id);
    return {
      ...decision,
      topicId,
      opportunityKey: topicId,
      evidenceVersion: estimate?.version ?? decision.version,
      inputHash: sha256Hex(JSON.stringify({
        topicId,
        status,
        fitScore: fit.score,
        serpIntentAligned: serpIntent.aligned,
        attainable,
        expectedClickStatus: estimate?.status,
        expectedClicksMonthly: estimate?.expectedClicksMonthly,
        searchVolume: topic.searchVolume,
        serpResultCount: topic.serpTopUrls?.length ?? 0,
      })),
    };
  });
  const decisionByTopicId = new Map(
    opportunityDecisions.map((decision) => [decision.topicId, decision]),
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
