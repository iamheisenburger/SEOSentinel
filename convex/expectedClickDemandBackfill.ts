import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v, type Infer } from "convex/values";
import { recordExpectedClickReservationOutcome } from "./lib/expectedClickSkipReceiptStore";
import { sanitizeSkipReceiptForOperator } from "./lib/expectedClickSkipReceipt";
import {
  EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS,
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT,
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT,
  EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
  EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
  EXPECTED_CLICK_DEMAND_GSC_READ_LIMIT,
  EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
  expectedClickDemandSelectionScore,
  expectedClickDemandTerminalNoMetricReceiptFingerprint,
  normalizeExactDemandKeyword,
  reconcileExactDemandMetrics,
  selectExpectedClickDemandCandidates,
  utcDemandBackfillDay,
} from "./lib/expectedClickDemandBackfill";
import {
  DATAFORSEO_DEMAND_SOURCE,
  DEFAULT_EVIDENCE_MAX_AGE_MS,
  measuredAuthorityIsFresh,
  tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  needsExpectedClickEvidenceBackfill,
} from "./lib/expectedClickEvidenceBackfill";
import {
  coveredIntentTopics,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import { articleReservesTopicIntent } from "./lib/topicLifecycle";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";
import { takeCurrentGscPageRows } from "./lib/currentGscRows";
import {
  isSameSearchConsolePage,
  publishedArticlePageUrl,
} from "./lib/searchPerformance";
import {
  releaseSharedProviderReservation,
  reserveSharedProviderBudget,
  type ProviderReservationReleaseReason,
} from "./lib/providerSpendReservation";
import {
  oldestUnresolvedFleetJob,
  planDemandPhaseReservation,
} from
  "./lib/expectedClickBackfillFleet";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  activeArticleJobTopicIds,
  cadenceInventoryNeedsPlannedRecovery,
  exactPlannedRecoverySelectionMatches,
  expectedClickTargetKind,
  partitionPlannedTopicRecoveryCoverage,
  plannedTargetsAllowedForQueue,
  plannedTopicDemandAdmission,
  plannedTopicSiteGate,
  prioritizeCadenceRecoveryCandidates,
  type PlannedRecoveryInventorySnapshot,
  type PlannedRecoveryArticle,
  uniqueExactPlannedTargets,
} from "./lib/plannedTopicEvidenceRecovery";
import {
  articleMatchesCurrentDomain,
  takeCurrentDomainArticles,
  takeCurrentDomainTopics,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";

const workerApi = internal.actions.expectedClickDemandBackfill;
const jobOriginValidator = v.union(
  v.literal("operator_canary"),
  v.literal("autonomous_fleet"),
);
const FLEET_UNRESOLVED_STATUS_READ_LIMIT = 25;
const CURRENT_DAY_BATCH_READ_LIMIT = 25;
const DEMAND_UNRESOLVED_STATUSES = [
  "pending",
  "running",
  "partial",
  "provider_response_unverified",
] as const;
const EVIDENCE_UNRESOLVED_STATUSES = [
  "pending",
  "running",
  "partial",
] as const;

async function currentDemandJobsForDay(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  reservationDay: string,
  rolloutEpoch: number,
) {
  const rows = await ctx.db.query("expected_click_demand_jobs")
    .withIndex("by_site_day_epoch_policy", (q) => q
      .eq("siteId", siteId)
      .eq("reservationDay", reservationDay)
      .eq("rolloutEpoch", rolloutEpoch)
      .eq("policyVersion", EXPECTED_CLICK_DEMAND_BACKFILL_VERSION))
    .order("desc")
    .take(CURRENT_DAY_BATCH_READ_LIMIT + 1);
  return {
    jobs: rows.slice(0, CURRENT_DAY_BATCH_READ_LIMIT),
    exhausted: rows.length > CURRENT_DAY_BATCH_READ_LIMIT,
  };
}

async function currentEvidenceJobsForDay(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  reservationDay: string,
  rolloutEpoch: number,
) {
  const rows = await ctx.db.query("expected_click_evidence_jobs")
    .withIndex("by_site_day_epoch_policy", (q) => q
      .eq("siteId", siteId)
      .eq("reservationDay", reservationDay)
      .eq("rolloutEpoch", rolloutEpoch)
      .eq("policyVersion", EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION))
    .order("desc")
    .take(CURRENT_DAY_BATCH_READ_LIMIT + 1);
  return {
    jobs: rows.slice(0, CURRENT_DAY_BATCH_READ_LIMIT),
    exhausted: rows.length > CURRENT_DAY_BATCH_READ_LIMIT,
  };
}

function demandReservationTrigger(
  origin: string | undefined,
  policyVersion: number,
): string {
  return origin === undefined
    ? `operator_canary_v${policyVersion}`
    : origin === "operator_canary" || origin === "autonomous_fleet"
      ? `expected_click_demand_${origin}_v${policyVersion}`
      : `invalid_expected_click_demand_origin_v${policyVersion}`;
}

type SelectedTopic = {
  topicId: Id<"topic_clusters">;
  targetKind?: "artifact" | "planned_topic";
  articleId?: Id<"articles">;
  articleStatus?: string;
  artifactHash?: string;
  plannedTopicFingerprint?: string;
  keyword: string;
  label: string;
  legacySearchVolume: number;
  priority?: number;
  gscClicks: number;
  gscImpressions: number;
  gscPosition?: number;
  selectionScore: number;
  topicCreatedAt: number;
  topicUpdatedAt: number;
};

type CandidateWithSerp = SelectedTopic & {
  primaryKeyword: string;
  serpTopUrls?: string[];
};

const plannedRecoveryGuardValidator = v.object({
  inspectionDay: v.string(),
  rolloutEpoch: v.number(),
  inspectionKey: v.string(),
  selected: v.array(v.object({
    topicId: v.id("topic_clusters"),
    keyword: v.string(),
    fingerprint: v.string(),
  })),
});

type KeywordAttempt = {
  topicId: Id<"topic_clusters">;
  keyword: string;
  attemptedAt: number;
  topicUpdatedAt: number;
};

type MetricReceipt = {
  topicId: Id<"topic_clusters">;
  requestedKeyword: string;
  returnedKeyword: string;
  searchVolume: number;
  cpc?: number;
  competition?: number;
  trend: number[];
  source: string;
  measuredAt: number;
  locationCode: number;
  languageCode: string;
};

function activeRollout(site: Doc<"sites">): boolean {
  return Boolean(
    siteExecutionActive(site) &&
      site.autopilotEnabled &&
      site.expectedClickSchedulingEnabled === true &&
      ["warm", "live"].includes(site.autopilotRolloutMode ?? "observe"),
  );
}

function hasFreshTenantAuthority(site: Doc<"sites">, timestamp: number): boolean {
  return measuredAuthorityIsFresh(tenantAuthorityFromStoredEvidence({
    domain: site.seoAuthorityDomain,
    currentDomain: site.domain,
    domainRank: site.seoAuthorityDomainRank,
    referringDomains: site.seoAuthorityReferringDomains,
    source: site.seoAuthoritySource,
    measuredAt: site.seoAuthorityMeasuredAt,
  }), timestamp);
}

function artifactFingerprint(article: PlannedRecoveryArticle): string | null {
  if (!articleReservesTopicIntent(article)) return null;
  if (article.status === "ready") {
    return article.auditedContentHash
      ? `ready:${article.auditedContentHash}`
      : null;
  }
  const contentHash =
    article.publishedContentHash ??
    article.publicationReceipt?.contentHash ??
    article.auditedContentHash;
  return contentHash
    ? `published:${contentHash}`
    : `published_legacy:${String(article._id)}:${article.publishedAt ?? article.createdAt}`;
}

function bestReservingArticle(
  articles: PlannedRecoveryArticle[],
): PlannedRecoveryArticle | undefined {
  return articles
    .filter((article) => articleReservesTopicIntent(article))
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "published" ? -1 : 1;
      }
      return (
        (right.publishedAt ?? right.auditedAt ?? right.createdAt) -
        (left.publishedAt ?? left.auditedAt ?? left.createdAt)
      );
    })[0];
}

function safePublicArticleUrl(
  site: Doc<"sites">,
  article: PlannedRecoveryArticle,
): string | undefined {
  if (article.status !== "published") return undefined;
  if (article.publicUrl?.trim()) return article.publicUrl.trim();
  try {
    return publishedArticlePageUrl(site.domain, site.urlStructure, article.slug);
  } catch {
    return undefined;
  }
}

function pageEvidence(
  pageRows: Array<{
    page: string;
    nonBrandedClicks: number;
    nonBrandedImpressions: number;
    nonBrandedWeightedPosition: number;
  }>,
  targetUrl: string | undefined,
): { clicks: number; impressions: number; position?: number } {
  if (!targetUrl) return { clicks: 0, impressions: 0 };
  const matching = pageRows.filter((row) =>
    isSameSearchConsolePage(row.page, targetUrl)
  );
  const clicks = matching.reduce(
    (sum, row) => sum + row.nonBrandedClicks,
    0,
  );
  const impressions = matching.reduce(
    (sum, row) => sum + row.nonBrandedImpressions,
    0,
  );
  const weightedPosition = matching.reduce(
    (sum, row) => sum + row.nonBrandedWeightedPosition,
    0,
  );
  return {
    clicks,
    impressions,
    ...(impressions > 0
      ? { position: Math.round((weightedPosition / impressions) * 10) / 10 }
      : {}),
  };
}

type PageEvidenceRow = {
  page: string;
  nonBrandedClicks: number;
  nonBrandedImpressions: number;
  nonBrandedWeightedPosition: number;
};

function demandCandidateInventory(args: {
  site: Doc<"sites">;
  topics: Doc<"topic_clusters">[];
  articles: PlannedRecoveryArticle[];
  activeArticleTopicIds: ReadonlySet<string>;
  pageRows: PageEvidenceRow[];
  timestamp: number;
  plannedSiteGateAllowed: boolean;
  plannedAuthorityFresh: boolean;
}) {
  const currentTopics = args.topics.filter((topic) =>
    topicMatchesCurrentDomain(args.site, topic)
  );
  const byTopic = new Map<string, PlannedRecoveryArticle[]>();
  for (const article of args.articles) {
    if (!article.topicId || article.siteId !== args.site._id) continue;
    const key = String(article.topicId);
    byTopic.set(key, [...(byTopic.get(key) ?? []), article]);
  }
  const coveredTopics = coveredIntentTopics(
    currentTopics.map((topic) => ({
      _id: String(topic._id),
      status: topic.status ?? "planned",
      primaryKeyword: topic.primaryKeyword,
      serpTopUrls: topic.serpTopUrls,
    })),
    args.articles.map((article) => ({
      topicId: article.topicId ? String(article.topicId) : undefined,
      slug: article.slug,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      auditedContentHash: article.auditedContentHash,
    })),
  );
  const locationCode = dataForSeoLocationCode(args.site.targetCountry);
  const languageCode = dataForSeoLanguageCode(args.site.language);
  const businessSignals = tenantTopicBusinessSignals(args.site);
  const candidateCounts = {
    covered: 0,
    currentDemand: 0,
    alreadyAttempted: 0,
    businessFitBlocked: 0,
    eligible: 0,
    artifactEligible: 0,
    plannedUnmaterialized: 0,
    plannedGateBlocked: 0,
  };
  const artifactCandidates: CandidateWithSerp[] = [];
  const rawPlannedCandidates: CandidateWithSerp[] = [];
  const cadenceCritical = cadenceInventoryNeedsPlannedRecovery(
    args.site,
    args.articles,
  );
  let artifactEvidencePending = 0;
  for (const topic of currentTopics) {
    const linkedArticles = byTopic.get(String(topic._id)) ?? [];
    const article = bestReservingArticle(linkedArticles);
    const artifactHash = article ? artifactFingerprint(article) : null;
    if (article && artifactHash) {
      candidateCounts.covered += 1;
      if (hasCurrentExactDemand(topic, locationCode, languageCode, args.timestamp)) {
        candidateCounts.currentDemand += 1;
        if (
          (topic.searchVolume ?? 0) > 0 &&
          needsExpectedClickEvidenceBackfill(topic, args.timestamp) &&
          !hasCurrentEvidenceAttempt(topic)
        ) artifactEvidencePending += 1;
        continue;
      }
      if (hasCurrentVersionAttempt(topic)) {
        candidateCounts.alreadyAttempted += 1;
        continue;
      }
      const fit = evaluateTopicBusinessFit({
        keyword: topic.primaryKeyword,
        label: topic.label,
        ...businessSignals,
      });
      if (!fit.eligible || topic.businessFitEligible === false) {
        candidateCounts.businessFitBlocked += 1;
        continue;
      }
      const gsc = pageEvidence(
        args.pageRows,
        safePublicArticleUrl(args.site, article),
      );
      const candidate: CandidateWithSerp = {
        primaryKeyword: topic.primaryKeyword,
        targetKind: "artifact",
        topicId: topic._id,
        articleId: article._id,
        articleStatus: article.status,
        artifactHash,
        keyword: topic.primaryKeyword,
        label: topic.label,
        legacySearchVolume: Number.isFinite(topic.searchVolume)
          ? Math.max(0, topic.searchVolume ?? 0)
          : 0,
        priority: topic.priority,
        gscClicks: gsc.clicks,
        gscImpressions: gsc.impressions,
        gscPosition: gsc.position,
        selectionScore: 0,
        topicCreatedAt: topic.createdAt,
        topicUpdatedAt: topic.updatedAt,
        serpTopUrls: topic.serpTopUrls,
      };
      candidate.selectionScore = expectedClickDemandSelectionScore({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      });
      artifactCandidates.push(candidate);
      continue;
    }

    if (!args.plannedSiteGateAllowed || !args.plannedAuthorityFresh) {
      candidateCounts.plannedGateBlocked += 1;
      continue;
    }
    const admission = plannedTopicDemandAdmission({
      site: args.site,
      topic,
      hasLinkedArticle: linkedArticles.length > 0,
      hasActiveArticleJob: args.activeArticleTopicIds.has(String(topic._id)),
    });
    if (!admission.eligible || !admission.fingerprint) {
      candidateCounts.plannedGateBlocked += 1;
      continue;
    }
    if (hasCurrentExactDemand(topic, locationCode, languageCode, args.timestamp)) {
      continue;
    }
    // The same exact planned keyword cannot be repurchased merely because a
    // later product-fit audit changed `updatedAt`.
    if (hasCurrentVersionAttempt(topic)) {
      candidateCounts.alreadyAttempted += 1;
      continue;
    }
    const candidate: CandidateWithSerp = {
      primaryKeyword: topic.primaryKeyword,
      targetKind: "planned_topic",
      topicId: topic._id,
      plannedTopicFingerprint: admission.fingerprint,
      keyword: topic.primaryKeyword,
      label: topic.label,
      legacySearchVolume: Number.isFinite(topic.searchVolume)
        ? Math.max(0, topic.searchVolume ?? 0)
        : 0,
      priority: topic.priority,
      gscClicks: 0,
      gscImpressions: 0,
      selectionScore: 0,
      topicCreatedAt: topic.createdAt,
      topicUpdatedAt: topic.updatedAt,
      // Legacy URLs without provenance are fingerprinted for drift only.
      // Pre-SERP dedupe therefore uses the conservative lexical fallback.
      serpTopUrls: undefined,
    };
    candidate.selectionScore = expectedClickDemandSelectionScore({
      ...candidate,
      createdAt: candidate.topicCreatedAt,
    });
    rawPlannedCandidates.push(candidate);
  }
  const orderedPlannedCandidates = uniqueExactPlannedTargets(
    rawPlannedCandidates.slice().sort((left, right) =>
      right.selectionScore - left.selectionScore ||
      right.legacySearchVolume - left.legacySearchVolume ||
      right.gscImpressions - left.gscImpressions ||
      left.topicCreatedAt - right.topicCreatedAt ||
      String(left.topicId).localeCompare(String(right.topicId))
    ),
  );
  const plannedCoverage = partitionPlannedTopicRecoveryCoverage(
    orderedPlannedCandidates,
    coveredTopics,
    EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT,
  );
  const plannedCandidates = plannedCoverage.eligible;
  candidateCounts.artifactEligible = artifactCandidates.length;
  candidateCounts.plannedUnmaterialized = plannedCandidates.length;
  // When the sealed buffer is under its cadence-specific minimum, a valid
  // planned row owns this bounded batch. Measuring historical artifacts first
  // would preserve analytics while missing the next publication deadline.
  // Outside that state, the ordinary existing-page priority is unchanged.
  const candidates = cadenceCritical
    ? prioritizeCadenceRecoveryCandidates(
        artifactCandidates,
        plannedCandidates,
        true,
      )
    : artifactEvidencePending > 0
      ? []
      : prioritizeCadenceRecoveryCandidates(
          artifactCandidates,
          plannedCandidates,
          false,
        );
  candidateCounts.eligible = candidates.length;
  return {
    candidates,
    artifactCandidates,
    plannedCandidates,
    plannedCoverageBlockedTopicIds: plannedCoverage.blocked.map(
      (candidate) => candidate.topicId,
    ),
    artifactEvidencePending,
    candidateCounts,
  };
}

function selectedWithoutTransientFields(candidate: CandidateWithSerp): SelectedTopic {
  const selected = { ...candidate };
  Reflect.deleteProperty(selected, "primaryKeyword");
  Reflect.deleteProperty(selected, "serpTopUrls");
  Reflect.deleteProperty(selected, "createdAt");
  return selected;
}

async function plannedTopicClearsCurrentCoverage(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  topic: Doc<"topic_clusters">,
  serpTopUrls = topic.serpTopUrls,
): Promise<boolean> {
  const site = await ctx.db.get(siteId);
  const [topics, articles] = await Promise.all([
    site
      ? takeCurrentDomainTopics(
        ctx,
        site,
        EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
      )
      : Promise.resolve([]),
    site
      ? takeCurrentDomainArticles(
        ctx,
        site,
        EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
      )
      : Promise.resolve([]),
  ]);
  if (
    !site ||
    !topicMatchesCurrentDomain(site, topic) ||
    topics.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT ||
    articles.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT
  ) return false;
  const coverage = coveredIntentTopics(
    topics.map((candidate) => ({
      _id: String(candidate._id),
      status: candidate.status ?? "planned",
      primaryKeyword: candidate.primaryKeyword,
      serpTopUrls: candidate.serpTopUrls,
    })),
    articles.map((article) => ({
      topicId: article.topicId ? String(article.topicId) : undefined,
      slug: article.slug,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      auditedContentHash: article.auditedContentHash,
    })),
  );
  return filterNonCannibalizingIntentTopics(
    [{ primaryKeyword: topic.primaryKeyword, serpTopUrls }],
    coverage,
    0.4,
    0.35,
    1,
  ).length === 1;
}

function hasCurrentExactDemand(
  topic: Doc<"topic_clusters">,
  locationCode: number,
  languageCode: string,
  now: number,
): boolean {
  return Boolean(
    Number.isFinite(topic.searchVolume) &&
      (topic.searchVolume ?? -1) >= 0 &&
      topic.searchDemandSource === DATAFORSEO_DEMAND_SOURCE &&
      Number.isFinite(topic.searchDemandMeasuredAt) &&
      (topic.searchDemandMeasuredAt ?? 0) > 0 &&
      (topic.searchDemandMeasuredAt ?? Infinity) <= now + 5 * 60 * 1000 &&
      now - (topic.searchDemandMeasuredAt ?? 0) <=
        DEFAULT_EVIDENCE_MAX_AGE_MS &&
      topic.searchDemandLocationCode === locationCode &&
      topic.searchDemandLanguageCode?.trim().toLowerCase() ===
        languageCode.trim().toLowerCase(),
  );
}

function hasCurrentVersionAttempt(topic: Doc<"topic_clusters">): boolean {
  return Boolean(
    topic.searchDemandBackfillAttemptVersion ===
      EXPECTED_CLICK_DEMAND_BACKFILL_VERSION &&
      normalizeExactDemandKeyword(topic.searchDemandBackfillAttemptKeyword ?? "") ===
        normalizeExactDemandKeyword(topic.primaryKeyword),
  );
}

function hasCurrentEvidenceAttempt(topic: Doc<"topic_clusters">): boolean {
  return Boolean(
    topic.expectedClickEvidenceAttemptVersion ===
      EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
      normalizeExactDemandKeyword(
        topic.expectedClickEvidenceAttemptKeyword ?? "",
      ) === normalizeExactDemandKeyword(topic.primaryKeyword),
  );
}

function selectedPlannedDescriptors(selected: SelectedTopic[]) {
  return selected.flatMap((topic) =>
    expectedClickTargetKind(topic) === "planned_topic" &&
      topic.plannedTopicFingerprint
      ? [{
          topicId: topic.topicId,
          keyword: topic.keyword,
          fingerprint: topic.plannedTopicFingerprint,
        }]
      : []
  );
}

function exactPlannedGuardMatches(
  guard: {
    inspectionDay: string;
    rolloutEpoch: number;
    selected: Array<{
      topicId: Id<"topic_clusters">;
      keyword: string;
      fingerprint: string;
    }>;
  },
  site: Doc<"sites">,
  reservationDay: string,
  selected: SelectedTopic[],
): boolean {
  return guard.inspectionDay === reservationDay &&
    guard.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
    exactPlannedRecoverySelectionMatches(
      guard.selected,
      selectedPlannedDescriptors(selected),
    );
}

function safeJobStatus(job: Doc<"expected_click_demand_jobs"> | null) {
  if (!job) return null;
  return {
    jobId: job._id,
    status: job.status,
    policyVersion: job.policyVersion,
    reservationDay: job.reservationDay,
    selectedTopics: job.selectedTopics.length,
    candidateCounts: job.candidateCounts,
    keywordAttempts: job.keywordAttempts.length,
    metricReceipts: job.metricReceipts.length,
    metricFailures: job.metricFailures.length,
    providerCallAttempted: job.providerCallAttempted === true,
    providerCallCompleted: job.providerCallCompleted === true,
    providerAttemptAmbiguous:
      job.providerCallAttempted === true &&
      job.providerCallCompleted !== true,
    providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
    persistedTopics: job.persistedTopics ?? 0,
    missingTopics: job.missingTopics ?? 0,
    skippedTopics: job.skippedTopics ?? 0,
    workerAttempts: job.workerAttempts,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

async function latestJobForSite(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("expected_click_demand_jobs")
    .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
    .order("desc")
    .first();
}

export async function terminalNoMetricDemandReceiptFingerprint(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  job: Doc<"expected_click_demand_jobs"> | null,
  timestamp: number,
): Promise<string | null> {
  if (!job) return null;
  const reservation = await ctx.db.get(job.providerSpendReservationId);
  return expectedClickDemandTerminalNoMetricReceiptFingerprint({
    jobId: String(job._id),
    siteId: String(job.siteId),
    userId: job.userId,
    status: job.status,
    origin: job.origin,
    policyVersion: job.policyVersion,
    expectedPolicyVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
    rolloutEpoch: job.rolloutEpoch,
    expectedRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    reservationDay: job.reservationDay,
    createdAt: job.createdAt,
    now: timestamp,
    providerEndpoint: job.providerEndpoint,
    providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
    providerCostReservedMicroUsd: job.providerCostReservedMicroUsd,
    providerSpendReservationId: String(job.providerSpendReservationId),
    selectionScope: job.selectionScope,
    candidateArtifactEligible: job.candidateCounts.artifactEligible ?? 0,
    selectedTopics: job.selectedTopics.map((topic) => ({
      topicId: String(topic.topicId),
      keyword: topic.keyword,
    })),
    keywordAttempts: job.keywordAttempts.map((attempt) => ({
      topicId: String(attempt.topicId),
      keyword: attempt.keyword,
      attemptedAt: attempt.attemptedAt,
    })),
    metricReceiptCount: job.metricReceipts.length,
    metricFailures: job.metricFailures.map((failure) => ({
      topicId: String(failure.topicId),
      keyword: failure.keyword,
      code: failure.code,
      recordedAt: failure.recordedAt,
    })),
    providerCallAttempted: job.providerCallAttempted,
    providerCallCompleted: job.providerCallCompleted,
    providerAttemptedAt: job.providerAttemptedAt,
    providerCallsAttempted: job.providerCallsAttempted,
    providerCallsCompleted: job.providerCallsCompleted,
    persistedTopics: job.persistedTopics ?? 0,
    missingTopics: job.missingTopics ?? 0,
    skippedTopics: job.skippedTopics ?? 0,
    workerAttempts: job.workerAttempts,
    workerToken: job.workerToken,
    leaseExpiresAt: job.leaseExpiresAt,
    errorCode: job.errorCode,
    completedAt: job.completedAt,
    reservation: reservation
      ? {
        id: String(reservation._id),
        siteId: reservation.siteId ? String(reservation.siteId) : undefined,
        userId: reservation.userId,
        purpose: reservation.purpose,
        trigger: reservation.trigger,
        reservedMicroUsd: reservation.reservedMicroUsd,
        reservationDay: reservation.reservationDay,
        createdAt: reservation.createdAt,
        releasedAt: reservation.releasedAt,
      }
      : null,
  });
}

async function unresolvedFleetDemandJobs(
  ctx: Pick<QueryCtx, "db">,
  siteId: Id<"sites">,
): Promise<{
  jobs: Doc<"expected_click_demand_jobs">[];
  exhausted: boolean;
}> {
  const groups = await Promise.all(DEMAND_UNRESOLVED_STATUSES.map((status) =>
    ctx.db
      .query("expected_click_demand_jobs")
      .withIndex("by_site_origin_status", (q) =>
        q.eq("siteId", siteId)
          .eq("origin", "autonomous_fleet")
          .eq("status", status)
      )
      .order("asc")
      .take(FLEET_UNRESOLVED_STATUS_READ_LIMIT + 1)
  ));
  return {
    exhausted: groups.some((rows) =>
      rows.length > FLEET_UNRESOLVED_STATUS_READ_LIMIT
    ),
    jobs: groups
      .flatMap((rows) => rows.slice(0, FLEET_UNRESOLVED_STATUS_READ_LIMIT))
      .sort((left, right) => left.createdAt - right.createdAt),
  };
}

async function unresolvedFleetEvidenceJobs(
  ctx: Pick<QueryCtx, "db">,
  siteId: Id<"sites">,
): Promise<{
  jobs: Doc<"expected_click_evidence_jobs">[];
  exhausted: boolean;
}> {
  const groups = await Promise.all(EVIDENCE_UNRESOLVED_STATUSES.map((status) =>
    ctx.db
      .query("expected_click_evidence_jobs")
      .withIndex("by_site_origin_status", (q) =>
        q.eq("siteId", siteId)
          .eq("origin", "autonomous_fleet")
          .eq("status", status)
      )
      .order("asc")
      .take(FLEET_UNRESOLVED_STATUS_READ_LIMIT + 1)
  ));
  return {
    exhausted: groups.some((rows) =>
      rows.length > FLEET_UNRESOLVED_STATUS_READ_LIMIT
    ),
    jobs: groups
      .flatMap((rows) => rows.slice(0, FLEET_UNRESOLVED_STATUS_READ_LIMIT))
      .sort((left, right) => left.createdAt - right.createdAt),
  };
}

function evidenceJobHasAmbiguousAttempt(
  job: Doc<"expected_click_evidence_jobs">,
): boolean {
  const recordedTopics = new Set([
    ...job.serpSnapshots.map((snapshot) => String(snapshot.topicId)),
    ...job.serpFailures.map((failure) => String(failure.topicId)),
  ]);
  return job.serpAttemptedTopicIds.some(
    (topicId) => !recordedTopics.has(String(topicId)),
  ) || (
    job.authorityDomains !== undefined &&
    job.authoritySnapshotComplete !== true
  );
}

export const getStatusInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    const latest = await latestJobForSite(ctx, siteId);
    return {
      enabled: site.expectedClickSchedulingEnabled === true,
      rolloutMode: site.autopilotRolloutMode ?? "observe",
      activeRollout: activeRollout(site),
      latest: safeJobStatus(latest),
      terminalNoMetricReceiptValid: Boolean(
        await terminalNoMetricDemandReceiptFingerprint(
          ctx,
          site,
          latest,
          Date.now(),
        ),
      ),
      // Why the last natural evaluation did or did not reserve work.
      // Without this a correct idle and a silent stall look identical.
      reservationReceipt: sanitizeSkipReceiptForOperator(
        await ctx.db
          .query("expected_click_backfill_skip_receipts")
          .withIndex("by_site_kind", (q) =>
            q.eq("siteId", siteId).eq("kind", "demand")
          )
          .unique(),
      ),
    };
  },
});

export const getJobInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !job ||
      job.siteId !== args.siteId
    ) {
      return null;
    }
    return job;
  },
});

/** Shared provider-free readiness used by the fleet, guarded operator
 * recovery, and cadence micro-seed admission. Keeping one transaction-level
 * implementation prevents a cheaper-path signal that the actual recovery
 * inspector cannot select. */
export async function expectedClickDemandFleetReadiness(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp = Date.now(),
  snapshot?: PlannedRecoveryInventorySnapshot,
) {
    const site = snapshot?.site ?? await ctx.db.get(siteId);
    if (site?._id !== siteId) return null;
    if (!siteExecutionActive(site)) return null;
    if (!activeRollout(site)) {
      return {
        ready: false as const,
        reason: "rollout_ineligible" as const,
        actionable: false,
        candidateCount: 0,
        continueToEvidence: false,
      };
    }
    const [unresolvedDemand, unresolvedEvidence] = await Promise.all([
      unresolvedFleetDemandJobs(ctx, siteId),
      unresolvedFleetEvidenceJobs(ctx, siteId),
    ]);
    if (unresolvedDemand.exhausted || unresolvedEvidence.exhausted) {
      return {
        ready: false as const,
        reason: "unresolved_job_read_limit_exhausted" as const,
        actionable: true,
        candidateCount: 0,
        continueToEvidence: false,
      };
    }
    const unresolvedJobs = [
      ...unresolvedDemand.jobs.map((job) => ({
        createdAt: job.createdAt,
        ambiguous: job.providerCallAttempted === true &&
          job.providerCallCompleted !== true,
        phase: "demand" as const,
      })),
      ...unresolvedEvidence.jobs.map((job) => ({
        createdAt: job.createdAt,
        ambiguous: evidenceJobHasAmbiguousAttempt(job),
        phase: "evidence" as const,
      })),
    ].sort((left, right) => left.createdAt - right.createdAt);
    const unresolved = unresolvedJobs.find((job) => job.ambiguous) ??
      unresolvedJobs[0];
    if (unresolved) {
      return {
        ready: false as const,
        reason: unresolved.ambiguous
          ? "provider_attempt_ambiguous" as const
          : unresolved.phase === "demand"
            ? "demand_fleet_job_incomplete" as const
            : "evidence_fleet_job_incomplete" as const,
        actionable: unresolved.ambiguous,
        candidateCount: 0,
        continueToEvidence: false,
      };
    }
    const reservationDay = utcDemandBackfillDay(timestamp);
    const todayBatch = await currentDemandJobsForDay(
      ctx,
      siteId,
      reservationDay,
      site.autopilotRolloutEpoch ?? 0,
    );
    if (todayBatch.exhausted) {
      return {
        ready: false as const,
        reason: "current_batch_read_limit_exhausted" as const,
        actionable: true,
        candidateCount: 0,
        continueToEvidence: false,
      };
    }
    const todayJob = todayBatch.jobs[0];
    if (todayJob) {
      const ambiguous = todayJob.providerCallAttempted === true &&
        todayJob.providerCallCompleted !== true;
      return {
        ready: false as const,
        reason: ambiguous
          ? "provider_attempt_ambiguous" as const
          : "daily_batch_exists" as const,
        actionable: ambiguous,
        candidateCount: 0,
        continueToEvidence:
          !ambiguous &&
          todayJob.status === "completed" &&
          todayJob.origin === "autonomous_fleet",
      };
    }

    const [topics, articles, activeJobs, plannedGate] = snapshot
      ? [
          snapshot.topics,
          snapshot.articles,
          {
            topicIds: new Set(snapshot.activeArticleTopicIds),
            exhausted: snapshot.activeJobsExhausted,
          },
          snapshot.plannedGate,
        ] as const
      : await Promise.all([
          takeCurrentDomainTopics(
            ctx,
            site,
            EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
          ),
          takeCurrentDomainArticles(
            ctx,
            site,
            EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
          ),
          activeArticleJobTopicIds(ctx, siteId),
          plannedTopicSiteGate(ctx, site, timestamp),
        ]);
    if (
      topics.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT ||
      articles.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT ||
      activeJobs.exhausted
    ) {
      return {
        ready: false as const,
        reason: "evidence_read_limit_exhausted" as const,
        actionable: true,
        candidateCount: 0,
        continueToEvidence: false,
      };
    }
    const inventory = demandCandidateInventory({
      site,
      topics,
      articles,
      activeArticleTopicIds: activeJobs.topicIds,
      pageRows: [],
      timestamp,
      plannedSiteGateAllowed: plannedGate.allowed,
      plannedAuthorityFresh: snapshot?.plannedAuthorityFresh ??
        hasFreshTenantAuthority(site, timestamp),
    });
    const selected = selectExpectedClickDemandCandidates(
      inventory.candidates.map((candidate) => ({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      })),
    ).map(selectedWithoutTransientFields);
    const candidateCount = selected.length;
    return {
      ready: candidateCount > 0,
      reason: candidateCount > 0
        ? "eligible" as const
        : inventory.artifactEvidencePending > 0
          ? "covered_evidence_precedes_planned" as const
          : !plannedGate.allowed &&
              inventory.candidateCounts.artifactEligible === 0
            ? plannedGate.reason
            : "no_eligible_legacy_topics" as const,
      actionable: !plannedGate.allowed &&
        inventory.candidateCounts.artifactEligible === 0,
      candidateCount,
      candidateCounts: inventory.candidateCounts,
      plannedSelection: selectedPlannedDescriptors(selected),
      plannedCoverageBlockedTopicIds:
        inventory.plannedCoverageBlockedTopicIds,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      reservationDay,
      continueToEvidence: candidateCount === 0 &&
        (inventory.artifactEvidencePending > 0 ||
          inventory.plannedCandidates.length === 0),
    };
}

/**
 * Cheap, provider-free fleet gate. The atomic queue mutation remains the
 * authority, but this avoids wallet preflights for completed or empty sites.
 * It never resumes a partial job or reveals tenant keywords.
 */
export const getFleetReadinessInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) =>
    expectedClickDemandFleetReadiness(ctx, siteId),
});

/**
 * Natural fleet inspection with a durable refusal receipt.
 *
 * The cheap fleet gate intentionally runs before the provider wallet
 * preflight and authoritative reservation. When it refuses work, the
 * reservation mutation is never reached, so recording only inside
 * `reserveAndQueue` makes a healthy skip indistinguishable from scheduler
 * silence. Re-evaluate and record in one transaction so a concurrent queued
 * receipt can never be overwritten by a stale query result.
 */
export const inspectAndRecordFleetReadinessInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const evaluatedAt = Date.now();
    const readiness = await expectedClickDemandFleetReadiness(
      ctx,
      siteId,
      evaluatedAt,
    );
    for (const topicId of readiness?.plannedCoverageBlockedTopicIds ?? []) {
      const topic = await ctx.db.get(topicId);
      if (topic?.siteId !== siteId || topic.status !== "planned") continue;
      await ctx.db.patch(topicId, {
        status: "cannibalizing",
        disqualifiedReason: "planned_recovery_coverage_conflict",
        updatedAt: evaluatedAt,
      });
    }
    if (readiness && !readiness.ready) {
      await recordExpectedClickReservationOutcome(ctx, {
        siteId,
        kind: "demand",
        policyVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
        evaluatedAt,
        outcome: {
          queued: false,
          reason: readiness.reason,
          candidateCounts: readiness.candidateCounts,
          selectedCandidateCount: readiness.candidateCount,
        },
      });
    }
    return readiness;
  },
});

export const getFleetRecoveryInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    staleAfterMs: v.number(),
  },
  handler: async (ctx, { siteId, staleAfterMs }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site) || !activeRollout(site)) return null;
    const unresolved = await unresolvedFleetDemandJobs(ctx, siteId);
    if (unresolved.exhausted) {
      return {
        action: "blocked" as const,
        reason: "unresolved_job_read_limit_exhausted" as const,
        actionable: true,
      };
    }
    const job = unresolved.jobs.find((candidate) =>
      candidate.providerCallAttempted === true &&
      candidate.providerCallCompleted !== true
    ) ?? oldestUnresolvedFleetJob(unresolved.jobs);
    if (!job) {
      return { action: "none" as const, reason: "no_fleet_job" as const };
    }
    if (job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0)) {
      return {
        action: "blocked" as const,
        reason: "rollout_epoch_changed" as const,
        actionable: true,
      };
    }
    if (
      ["completed", "provider_balance_unavailable"].includes(job.status)
    ) {
      return { action: "none" as const, reason: "terminal" as const };
    }
    if (
      job.status === "provider_response_unverified" ||
      (job.providerCallAttempted === true &&
        job.providerCallCompleted !== true)
    ) {
      return {
        action: "blocked" as const,
        reason: "provider_attempt_ambiguous" as const,
        actionable: true,
      };
    }
    const now = Date.now();
    const boundedStaleAfterMs = Math.max(
      60_000,
      Math.min(60 * 60 * 1000, Math.floor(staleAfterMs)),
    );
    const liveLease = job.status === "running" &&
      (job.leaseExpiresAt ?? 0) > now;
    if (liveLease || now - job.updatedAt < boundedStaleAfterMs) {
      return { action: "none" as const, reason: "worker_not_stale" as const };
    }
    const providerWorkComplete = job.providerCallCompleted === true;
    if (
      !providerWorkComplete &&
      job.reservationDay !== utcDemandBackfillDay(now)
    ) {
      return {
        action: "blocked" as const,
        reason: "reservation_day_expired" as const,
        actionable: true,
      };
    }
    if (job.status === "partial") {
      return {
        action: "resume" as const,
        jobId: job._id,
        policyVersion: job.policyVersion,
        createdAt: job.createdAt,
        actionable: false,
      };
    }
    if (job.status === "pending" || job.status === "running") {
      return {
        action: "process" as const,
        jobId: job._id,
        policyVersion: job.policyVersion,
        createdAt: job.createdAt,
        actionable: false,
      };
    }
    return { action: "none" as const, reason: "not_recoverable" as const };
  },
});

export const reserveAndQueue = internalMutation({
  args: {
    siteId: v.id("sites"),
    policyVersion: v.number(),
    origin: jobOriginValidator,
    plannedRecoveryGuard: v.optional(plannedRecoveryGuardValidator),
  },
  handler: async (ctx, args) => {
    // The receipt is written in this same transaction, so an overlapping
    // dispatcher can never observe a decision the stored evidence contradicts.
    const evaluatedAt = Date.now();
    const outcome = await reserveDemandOutcome(ctx, args);
    await recordExpectedClickReservationOutcome(ctx, {
      siteId: args.siteId,
      kind: "demand",
      policyVersion: args.policyVersion,
      evaluatedAt,
      outcome: {
        queued: outcome.queued,
        reason: "reason" in outcome ? outcome.reason : undefined,
        candidateCounts: "candidateCounts" in outcome
          ? outcome.candidateCounts as Record<string, unknown>
          : undefined,
        selectedCandidateCount: "selectedTopics" in outcome
          ? outcome.selectedTopics
          : 0,
      },
    });
    return outcome;
  },
});

async function reserveDemandOutcome(
  ctx: MutationCtx,
  {
    siteId,
    policyVersion,
    origin,
    plannedRecoveryGuard,
  }: {
    siteId: Id<"sites">;
    policyVersion: number;
    origin: Infer<typeof jobOriginValidator>;
    plannedRecoveryGuard?: Infer<typeof plannedRecoveryGuardValidator>;
  },
) {
    if (policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click demand backfill version");
    }
    if (plannedRecoveryGuard && origin !== "operator_canary") {
      return {
        queued: false as const,
        reason: "planned_recovery_origin_invalid" as const,
      };
    }
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site) || !site.userId) {
      return { queued: false as const, reason: "site_unavailable" as const };
    }
    if (!activeRollout(site)) {
      return { queued: false as const, reason: "rollout_ineligible" as const };
    }
    const timestamp = Date.now();
    const reservationDay = utcDemandBackfillDay(timestamp);
    const [
      todayBatch,
      todayEvidenceBatch,
      unresolvedDemand,
      unresolvedEvidence,
    ] = await Promise.all([
      currentDemandJobsForDay(
        ctx,
        siteId,
        reservationDay,
        site.autopilotRolloutEpoch ?? 0,
      ),
      currentEvidenceJobsForDay(
        ctx,
        siteId,
        reservationDay,
        site.autopilotRolloutEpoch ?? 0,
      ),
      unresolvedFleetDemandJobs(ctx, siteId),
      unresolvedFleetEvidenceJobs(ctx, siteId),
    ]);
    const todayJobs = todayBatch.jobs;
    const todayEvidenceJobs = todayEvidenceBatch.jobs;
    const phaseDecision = planDemandPhaseReservation({
      todayEvidenceJobs: todayEvidenceJobs.length,
      unresolvedDemandJobs: unresolvedDemand.jobs.length,
      unresolvedEvidenceJobs: unresolvedEvidence.jobs.length,
      unresolvedReadLimitExhausted:
        unresolvedDemand.exhausted || unresolvedEvidence.exhausted ||
        todayBatch.exhausted || todayEvidenceBatch.exhausted,
    });
    if (!phaseDecision.allowed) {
      return {
        queued: false as const,
        reason: phaseDecision.reason,
      };
    }
    const existing = todayJobs[0];
    if (existing) {
      return {
        queued: false as const,
        reason: existing.status === "partial"
          ? "resume_required" as const
          : "daily_batch_exists" as const,
        jobId: existing._id,
        status: existing.status,
      };
    }

    const [topics, articles, gscPageRead, activeJobs, plannedGate] =
      await Promise.all([
      takeCurrentDomainTopics(
        ctx,
        site,
        EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
      ),
      takeCurrentDomainArticles(
        ctx,
        site,
        EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT,
      ),
      takeCurrentGscPageRows(
        ctx,
        site,
        EXPECTED_CLICK_DEMAND_GSC_READ_LIMIT,
      ),
      activeArticleJobTopicIds(ctx, siteId),
      plannedTopicSiteGate(ctx, site, timestamp),
    ]);
    if (
      topics.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT ||
      articles.length >= EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT ||
      gscPageRead.exhausted ||
      activeJobs.exhausted
    ) {
      return {
        queued: false as const,
        reason: "evidence_read_limit_exhausted" as const,
      };
    }
    const pageRows = gscPageRead.rows;
    const locationCode = dataForSeoLocationCode(site.targetCountry);
    const languageCode = dataForSeoLanguageCode(site.language);
    const inventory = demandCandidateInventory({
      site,
      topics,
      articles,
      activeArticleTopicIds: activeJobs.topicIds,
      pageRows,
      timestamp,
      plannedSiteGateAllowed: plannedGate.allowed,
      plannedAuthorityFresh: hasFreshTenantAuthority(site, timestamp),
    });
    const candidates = plannedRecoveryGuard
      ? inventory.artifactCandidates.length === 0 &&
          inventory.artifactEvidencePending === 0
        ? inventory.plannedCandidates
        : []
      : plannedTargetsAllowedForQueue(origin, false)
        ? inventory.candidates
        : inventory.artifactCandidates;
    const candidateCounts = inventory.candidateCounts;
    const selectedTopics = selectExpectedClickDemandCandidates(
      candidates.map((candidate) => ({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      })),
    ).map(selectedWithoutTransientFields);
    if (selectedTopics.length === 0) {
      return {
        queued: false as const,
        reason: plannedRecoveryGuard
          ? "planned_recovery_precondition_changed" as const
          : inventory.artifactEvidencePending > 0
            ? "covered_evidence_precedes_planned" as const
            : "no_eligible_legacy_topics" as const,
        candidateCounts,
      };
    }
    if (
      plannedRecoveryGuard &&
      (!plannedGate.allowed ||
        !exactPlannedGuardMatches(
          plannedRecoveryGuard,
          site,
          reservationDay,
          selectedTopics,
        ))
    ) {
      return {
        queued: false as const,
        reason: "planned_recovery_inspection_stale" as const,
      };
    }

    const shared = await reserveSharedProviderBudget(ctx, {
      siteId,
      userId: site.userId,
      purpose: "expected_click_demand_backfill",
      trigger: demandReservationTrigger(origin, policyVersion),
      reservedMicroUsd:
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      timestamp,
    });
    if (!shared.ok) {
      return { queued: false as const, reason: shared.reason };
    }
    const jobId = await ctx.db.insert("expected_click_demand_jobs", {
      siteId,
      userId: site.userId,
      status: "pending",
      policyVersion,
      origin,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      reservationDay,
      locationCode,
      languageCode,
      providerCostCeilingMicroUsd:
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      providerSpendReservationId: shared.reservationId,
      providerEndpoint: EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
      selectionScope: plannedRecoveryGuard
        ? "planned_unmaterialized"
        : "all_eligible",
      plannedRecoveryInspectionKey: plannedRecoveryGuard?.inspectionKey,
      selectedTopics,
      candidateCounts,
      keywordAttempts: [],
      metricReceipts: [],
      metricFailures: [],
      providerCallAttempted: false,
      providerCallCompleted: false,
      providerCallsAttempted: 0,
      providerCallsCompleted: 0,
      workerAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(0, workerApi.processExpectedClickDemandBackfill, {
      siteId,
      jobId,
      policyVersion,
    });
    return {
      queued: true as const,
      jobId,
      selectedTopics: selectedTopics.length,
      candidateCounts,
      providerCostCeilingMicroUsd:
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    };
}

function validateWorkerState(
  site: Doc<"sites">,
  job: Doc<"expected_click_demand_jobs">,
): void {
  if (
    !activeRollout(site) ||
    job.policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION ||
    job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0)
  ) {
    throw new Error("Expected-click demand backfill authorization is stale");
  }
}

async function requireCurrentProviderReservation(
  ctx: MutationCtx,
  site: Doc<"sites">,
  job: Doc<"expected_click_demand_jobs">,
  timestamp: number,
): Promise<void> {
  const reservation = await ctx.db.get(job.providerSpendReservationId);
  if (
    !reservation ||
    reservation.siteId !== site._id ||
    reservation.userId !== site.userId ||
    reservation.purpose !== "expected_click_demand_backfill" ||
    reservation.trigger !==
      demandReservationTrigger(job.origin, job.policyVersion) ||
    reservation.reservedMicroUsd !==
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    reservation.reservationDay !== job.reservationDay ||
    reservation.releasedAt !== undefined ||
    job.providerCostCeilingMicroUsd !==
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    job.providerCostReservedMicroUsd !==
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    job.providerEndpoint !== EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT ||
    job.reservationDay !== utcDemandBackfillDay(timestamp)
  ) {
    throw new Error("Expected-click demand provider reservation is stale");
  }
}

export const claimWorker = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    policyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !job ||
      job.siteId !== args.siteId
    ) {
      return null;
    }
    if (args.policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click demand backfill version");
    }
    validateWorkerState(site, job);
    const timestamp = Date.now();
    if (
      job.status === "completed" ||
      job.status === "provider_balance_unavailable"
    ) return null;
    if (
      job.status === "running" &&
      (job.leaseExpiresAt ?? 0) > timestamp &&
      job.workerToken !== args.workerToken
    ) return null;
    if (!["pending", "partial", "running"].includes(job.status)) return null;
    await ctx.db.patch(args.jobId, {
      status: "running",
      workerToken: args.workerToken,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
      startedAt: job.startedAt ?? timestamp,
      errorCode: undefined,
      updatedAt: timestamp,
    });
    return {
      ...job,
      status: "running",
      workerToken: args.workerToken,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
    };
  },
});

async function requireWorker(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"expected_click_demand_jobs">;
    workerToken: string;
  },
): Promise<{
  site: Doc<"sites">;
  job: Doc<"expected_click_demand_jobs">;
}> {
  const [site, job] = await Promise.all([
    ctx.db.get(args.siteId),
    ctx.db.get(args.jobId),
  ]);
  if (
    !site ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !job ||
    job.siteId !== args.siteId ||
    job.status !== "running" ||
    job.workerToken !== args.workerToken ||
    (job.leaseExpiresAt ?? 0) <= Date.now()
  ) {
    throw new Error("Expected-click demand backfill worker lease is invalid");
  }
  validateWorkerState(site, job);
  return { site, job };
}

async function currentSelectedTopic(
  ctx: MutationCtx,
  site: Doc<"sites">,
  selected: SelectedTopic,
): Promise<{
  topic: Doc<"topic_clusters">;
  article?: Doc<"articles">;
} | null> {
  const targetKind = expectedClickTargetKind(selected);
  if (!targetKind) return null;
  const topic = await ctx.db.get(selected.topicId);
  if (
    !topic ||
    topic.siteId !== site._id ||
    !topicMatchesCurrentDomain(site, topic) ||
    topic.primaryKeyword !== selected.keyword ||
    topic.label !== selected.label ||
    topic.updatedAt !== selected.topicUpdatedAt
  ) return null;
  const fit = evaluateTopicBusinessFit({
    keyword: topic.primaryKeyword,
    label: topic.label,
    ...tenantTopicBusinessSignals(site),
  });
  if (!fit.eligible || topic.businessFitEligible === false) return null;
  if (targetKind === "planned_topic") {
    const timestamp = Date.now();
    const [siteGate, activeJobs, linkedArticle] = await Promise.all([
      plannedTopicSiteGate(ctx, site, timestamp),
      activeArticleJobTopicIds(ctx, site._id),
      ctx.db
        .query("articles")
        .withIndex("by_topic", (q) => q.eq("topicId", selected.topicId))
        .first(),
    ]);
    if (!siteGate.allowed || activeJobs.exhausted) return null;
    const tenantAuthority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    const admission = plannedTopicDemandAdmission({
      site,
      topic,
      hasLinkedArticle: Boolean(
        linkedArticle && articleMatchesCurrentDomain(site, linkedArticle),
      ),
      hasActiveArticleJob: activeJobs.topicIds.has(String(topic._id)),
    });
    if (
      !measuredAuthorityIsFresh(tenantAuthority, timestamp) ||
      !admission.eligible ||
      admission.fingerprint !== selected.plannedTopicFingerprint ||
      // Legacy SERP URLs are observational only before a fresh evidence call.
      !(await plannedTopicClearsCurrentCoverage(ctx, site._id, topic, []))
    ) return null;
    return { topic };
  }
  const article = selected.articleId
    ? await ctx.db.get(selected.articleId)
    : null;
  if (
    !article ||
    article.siteId !== site._id ||
    !articleMatchesCurrentDomain(site, article) ||
    article.topicId !== selected.topicId ||
    article.status !== selected.articleStatus ||
    artifactFingerprint(article) !== selected.artifactHash ||
    !articleReservesTopicIntent(article)
  ) return null;
  return { topic, article };
}

export const beginProviderAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    suppressEvidenceChain: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    if (
      job.providerCallAttempted === true ||
      job.providerCallsAttempted >=
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT
    ) {
      return {
        callRequired: false as const,
        reason: job.providerCallCompleted === true
          ? "receipt_recorded" as const
          : "provider_attempt_ambiguous" as const,
      };
    }
    const locationCode = dataForSeoLocationCode(site.targetCountry);
    const languageCode = dataForSeoLanguageCode(site.language);
    if (
      locationCode !== job.locationCode ||
      languageCode !== job.languageCode
    ) {
      throw new Error("Expected-click demand locale changed before provider call");
    }
    const timestamp = Date.now();
    await requireCurrentProviderReservation(ctx, site, job, timestamp);
    const attempts: KeywordAttempt[] = [];
    for (const selected of job.selectedTopics as SelectedTopic[]) {
      const current = await currentSelectedTopic(ctx, site, selected);
      if (!current) continue;
      if (
        hasCurrentExactDemand(
          current.topic,
          locationCode,
          languageCode,
          timestamp,
        ) || hasCurrentVersionAttempt(current.topic)
      ) continue;
      const attempt: KeywordAttempt = {
        topicId: selected.topicId,
        keyword: selected.keyword,
        attemptedAt: timestamp,
        topicUpdatedAt: current.topic.updatedAt,
      };
      await ctx.db.patch(selected.topicId, {
        searchDemandBackfillAttemptVersion:
          EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
        searchDemandBackfillAttemptJobId: args.jobId,
        searchDemandBackfillAttemptKeyword: selected.keyword,
        searchDemandBackfillAttemptedAt: timestamp,
      });
      attempts.push(attempt);
    }
    if (attempts.length === 0) {
      await ctx.db.patch(args.jobId, {
        status: "completed",
        persistedTopics: 0,
        missingTopics: 0,
        skippedTopics: job.selectedTopics.length,
        workerToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      if (
        job.origin === "autonomous_fleet" &&
        args.suppressEvidenceChain !== true
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.expectedClickBackfillFleet.runEvidenceSite,
          { siteId: args.siteId },
        );
      }
      return { callRequired: false as const, reason: "no_current_topics" as const };
    }
    await ctx.db.patch(args.jobId, {
      keywordAttempts: attempts,
      providerCallAttempted: true,
      providerAttemptedAt: timestamp,
      providerCallsAttempted: job.providerCallsAttempted + 1,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return {
      callRequired: true as const,
      keywords: attempts.map((attempt) => attempt.keyword),
      locationCode,
      languageCode,
    };
  },
});

export const recordMetricReceipts = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    measuredAt: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    metrics: v.array(v.object({
      keyword: v.string(),
      searchVolume: v.number(),
      cpc: v.optional(v.number()),
      competition: v.optional(v.number()),
      trend: v.array(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    if (job.providerCallAttempted !== true || !job.providerAttemptedAt) {
      throw new Error("Metric receipt has no durable provider attempt");
    }
    if (job.providerCallCompleted === true) return { recorded: false };
    if (
      args.locationCode !== job.locationCode ||
      args.languageCode !== job.languageCode ||
      !Number.isFinite(args.measuredAt) ||
      args.measuredAt < job.providerAttemptedAt ||
      args.measuredAt > Date.now() + 5 * 60 * 1000 ||
      args.metrics.length > job.keywordAttempts.length
    ) {
      throw new Error("Metric receipt does not match its initiated request");
    }
    const reconciled = reconcileExactDemandMetrics(
      job.keywordAttempts as KeywordAttempt[],
      args.metrics,
    );
    const receipts: MetricReceipt[] = [];
    const failures: Array<{
      topicId: Id<"topic_clusters">;
      keyword: string;
      code: string;
      recordedAt: number;
    }> = [];
    for (const item of reconciled.measured) {
      const metric = item.metric;
      receipts.push({
        topicId: item.topicId,
        requestedKeyword: item.requestedKeyword,
        returnedKeyword: metric.keyword,
        searchVolume: metric.searchVolume,
        trend: metric.trend,
        ...(metric.cpc === undefined ? {} : { cpc: metric.cpc }),
        ...(metric.competition === undefined
          ? {}
          : { competition: metric.competition }),
        source: DATAFORSEO_DEMAND_SOURCE,
        measuredAt: args.measuredAt,
        locationCode: args.locationCode,
        languageCode: args.languageCode,
      });
    }
    for (const item of reconciled.missing) {
      failures.push({
        topicId: item.topicId,
        keyword: item.keyword,
        code: "exact_metric_missing",
        recordedAt: args.measuredAt,
      });
    }
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      metricReceipts: receipts,
      metricFailures: failures,
      providerCallCompleted: true,
      providerCallsCompleted: job.providerCallsCompleted + 1,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return {
      recorded: true,
      receipts: receipts.length,
      failures: failures.length,
    };
  },
});

export const persistDemand = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    suppressEvidenceChain: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    if (job.providerCallCompleted !== true) {
      throw new Error("Exact keyword metric receipt is incomplete");
    }
    const locationCode = dataForSeoLocationCode(site.targetCountry);
    const languageCode = dataForSeoLanguageCode(site.language);
    if (
      locationCode !== job.locationCode ||
      languageCode !== job.languageCode
    ) throw new Error("Expected-click demand locale changed before persistence");
    const attemptsByTopic = new Map(
      (job.keywordAttempts as KeywordAttempt[]).map((attempt) => [
        String(attempt.topicId),
        attempt,
      ]),
    );
    const selectedByTopic = new Map(
      (job.selectedTopics as SelectedTopic[]).map((selected) => [
        String(selected.topicId),
        selected,
      ]),
    );
    const timestamp = Date.now();
    const businessSignals = tenantTopicBusinessSignals(site);
    let persistedTopics = 0;
    let skippedTopics = job.selectedTopics.length - job.keywordAttempts.length;
    for (const receipt of job.metricReceipts as MetricReceipt[]) {
      const attempt = attemptsByTopic.get(String(receipt.topicId));
      const selected = selectedByTopic.get(String(receipt.topicId));
      if (!attempt || !selected) {
        skippedTopics += 1;
        continue;
      }
      const current = await currentSelectedTopic(ctx, site, selected);
      const topic = current?.topic;
      if (
        !topic ||
        topic.siteId !== args.siteId ||
        topic.primaryKeyword !== selected.keyword ||
        topic.updatedAt !== attempt.topicUpdatedAt ||
        topic.searchDemandBackfillAttemptVersion !==
          EXPECTED_CLICK_DEMAND_BACKFILL_VERSION ||
        topic.searchDemandBackfillAttemptJobId !== args.jobId ||
        topic.searchDemandBackfillAttemptKeyword !== selected.keyword ||
        topic.searchDemandBackfillAttemptedAt !== attempt.attemptedAt ||
        normalizeExactDemandKeyword(receipt.requestedKeyword) !==
          normalizeExactDemandKeyword(selected.keyword) ||
        normalizeExactDemandKeyword(receipt.returnedKeyword) !==
          normalizeExactDemandKeyword(selected.keyword) ||
        receipt.source !== DATAFORSEO_DEMAND_SOURCE ||
        receipt.locationCode !== locationCode ||
        receipt.languageCode !== languageCode
      ) {
        skippedTopics += 1;
        continue;
      }
      const fit = evaluateTopicBusinessFit({
        keyword: topic.primaryKeyword,
        label: topic.label,
        ...businessSignals,
      });
      if (!fit.eligible || topic.businessFitEligible === false) {
        skippedTopics += 1;
        continue;
      }
      await ctx.db.patch(topic._id, {
        searchVolume: receipt.searchVolume,
        ...(receipt.cpc === undefined ? {} : { cpc: receipt.cpc }),
        volumeTrend: receipt.trend,
        searchDemandSource: receipt.source,
        searchDemandMeasuredAt: receipt.measuredAt,
        searchDemandLocationCode: receipt.locationCode,
        searchDemandLanguageCode: receipt.languageCode,
        searchDemandBackfillVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
        searchDemandBackfillJobId: args.jobId,
        searchDemandBackfilledAt: timestamp,
        // A changed demand receipt invalidates every previous projection. The
        // existing SERP/authority backfill will create the next exact audit.
        expectedClicksMonthly: undefined,
        expectedClickProjectedPosition: undefined,
        expectedClickRankProbability: undefined,
        expectedClickStatus: undefined,
        expectedClickReasons: undefined,
        expectedClickAuditVersion: undefined,
        expectedClickAuditedAt: undefined,
        expectedClickBackfillVersion: undefined,
        expectedClickBackfillJobId: undefined,
        expectedClickBackfilledAt: undefined,
        businessFitEligible: true,
        businessFitScore: fit.score,
        businessFitVersion: fit.version,
        businessFitReasons: fit.reasons,
        businessFitCheckedAt: timestamp,
        updatedAt: timestamp,
      });
      persistedTopics += 1;
    }
    const missingTopics = job.metricFailures.length;
    await ctx.db.patch(args.jobId, {
      status: "completed",
      persistedTopics,
      missingTopics,
      skippedTopics,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      errorCode: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    if (
      job.origin === "autonomous_fleet" &&
      args.suppressEvidenceChain !== true
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.expectedClickBackfillFleet.runEvidenceSite,
        { siteId: args.siteId },
      );
    }
    return { persistedTopics, missingTopics, skippedTopics };
  },
});

export const markPartial = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    const timestamp = Date.now();
    const providerResponseUnverified =
      job.providerCallAttempted === true &&
      job.providerCallCompleted !== true;
    await ctx.db.patch(args.jobId, {
      status: providerResponseUnverified
        ? "provider_response_unverified"
        : "partial",
      errorCode: args.errorCode.slice(0, 80),
      workerToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    return {
      partial: true,
      providerResponseUnverified,
      providerCallAttempted: job.providerCallAttempted === true,
      providerCallCompleted: job.providerCallCompleted === true,
    };
  },
});

export const abortForProviderBalance = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    workerToken: v.string(),
    releaseReason: v.string(),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    if (job.providerCallAttempted === true || job.providerCallsAttempted !== 0) {
      throw new Error("A provider reservation cannot be released after paid work");
    }
    const releaseReason = args.releaseReason as ProviderReservationReleaseReason;
    if (
      releaseReason !== "provider_balance_insufficient" &&
      releaseReason !== "provider_balance_preflight_unavailable"
    ) throw new Error("Unknown provider reservation release reason");
    const timestamp = Date.now();
    const released = (await releaseSharedProviderReservation(ctx, {
      reservationId: job.providerSpendReservationId,
      siteId: args.siteId,
      purpose: "expected_click_demand_backfill",
      reason: releaseReason,
      timestamp,
    })).released;
    await ctx.db.patch(args.jobId, {
      status: "provider_balance_unavailable",
      errorCode: releaseReason,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return { aborted: true, released };
  },
});

export const scheduleResume = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    policyVersion: v.number(),
    suppressEvidenceChain: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (!siteExecutionActive(site) || !job || job.siteId !== args.siteId) {
      return { scheduled: false as const, reason: "site_unavailable" as const };
    }
    validateWorkerState(site, job);
    if (job.status === "completed") {
      return { scheduled: false as const, reason: "completed" as const };
    }
    if (job.status !== "partial") {
      return { scheduled: false as const, reason: "not_resumable" as const };
    }
    if (
      job.providerCallAttempted === true &&
      job.providerCallCompleted !== true
    ) {
      return {
        scheduled: false as const,
        reason: "provider_attempt_ambiguous" as const,
      };
    }
    if (
      job.providerCallAttempted !== true &&
      job.reservationDay !== utcDemandBackfillDay(Date.now())
    ) {
      return {
        scheduled: false as const,
        reason: "reservation_day_expired" as const,
      };
    }
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "pending",
      errorCode: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(0, workerApi.processExpectedClickDemandBackfill, {
      siteId: args.siteId,
      jobId: args.jobId,
      policyVersion: args.policyVersion,
      suppressEvidenceChain: args.suppressEvidenceChain,
    });
    return { scheduled: true as const };
  },
});
