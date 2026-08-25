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
  businessFitEligible: boolean;
  serpBusinessIntentAligned: boolean;
  expectedClickStatus?: string;
  serpAttainable: boolean;
}): boolean {
  const { topic } = args;
  return SCHEDULABLE_TOPIC_STATUSES.has(topic.status ?? "planned") &&
    !planCheckpointTopicExecutionLocked(topic) &&
    args.businessFitEligible &&
    args.serpBusinessIntentAligned &&
    Number.isFinite(topic.searchVolume) &&
    Number.isFinite(topic.keywordDifficulty) &&
    topic.keywordDifficultyMeasured === true &&
    Boolean(topic.serpIntent?.trim()) &&
    (topic.serpTopUrls?.length ?? 0) >= 5 &&
    args.expectedClickStatus === "eligible" &&
    args.serpAttainable;
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
} {
  const portfolioTopics = args.topics.filter((topic) =>
    !["cannibalizing", "disqualified", "plan_checkpoint"].includes(
      topic.status ?? "planned",
    ) && !topic.planCheckpointTerminalFailureCode
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
  const schedulerReadyTopicIds = args.topics.flatMap((topic) => {
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
    return schedulerReadyTopic({
      topic,
      businessFitEligible: fit.eligible,
      serpBusinessIntentAligned: serpIntent.aligned,
      expectedClickStatus:
        expectedClickByTopic.get(String(topic._id))?.status,
      serpAttainable: evaluateSerpAttainability({
        serpTopUrls: topic.serpTopUrls,
        siteHost,
      }).attainable,
    })
      ? [String(topic._id)]
      : [];
  });
  return { portfolio, schedulerReadyTopicIds };
}
