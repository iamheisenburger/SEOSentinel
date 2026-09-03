import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v, type Infer } from "convex/values";
import { recordExpectedClickReservationOutcome } from "./lib/expectedClickSkipReceiptStore";
import { sanitizeSkipReceiptForOperator } from "./lib/expectedClickSkipReceipt";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  EXPECTED_CLICK_EVIDENCE_GSC_READ_LIMIT,
  EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
  expectedClickBackfillSelectionScore,
  hasCurrentExpectedClickDemand,
  needsExpectedClickEvidenceBackfill,
  selectExpectedClickBackfillCandidates,
  utcBackfillDay,
} from "./lib/expectedClickEvidenceBackfill";
import {
  EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
  normalizeExactDemandKeyword,
} from "./lib/expectedClickDemandBackfill";
import {
  DATAFORSEO_AUTHORITY_SOURCE,
  DEFAULT_EVIDENCE_MAX_AGE_MS,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
  estimateTopicExpectedClicks,
  measuredAuthorityIsFresh,
  planSerpAuthorityCollection,
  tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
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
  planEvidencePhaseReservation,
} from
  "./lib/expectedClickBackfillFleet";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  activeArticleJobTopicIds,
  cadenceInventoryNeedsPlannedRecovery,
  expectedClickTargetKind,
  filterPlannedTopicRecoveryCoverage,
  hasExactPlannedEvidenceAttempt,
  isCurrentExpectedClickBatch,
  plannedTargetsAllowedForQueue,
  plannedTopicEvidenceAdmission,
  plannedTopicSiteGate,
  PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION,
  prioritizeCadenceRecoveryCandidates,
  type PlannedRecoveryInventorySnapshot,
  uniqueExactPlannedTargets,
} from "./lib/plannedTopicEvidenceRecovery";
import {
  evaluateSerpAttainability,
  evaluateSerpBusinessIntent,
} from "./lib/serpAttainability";
import {
  articleMatchesCurrentDomain,
  takeCurrentDomainArticles,
  takeCurrentDomainTopics,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";

const workerApi = internal.actions.expectedClickEvidenceBackfill;
const FLEET_UNRESOLVED_STATUS_READ_LIMIT = 25;
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
const jobOriginValidator = v.union(
  v.literal("operator_canary"),
  v.literal("autonomous_fleet"),
);

function evidenceReservationTrigger(
  origin: string | undefined,
  policyVersion: number,
): string {
  // Production rows created before job origins were introduced used this
  // exact trigger. Keep them resumable without making them fleet-owned.
  return origin === undefined
    ? `operator_canary_v${policyVersion}`
    : origin === "operator_canary" || origin === "autonomous_fleet"
      ? `expected_click_evidence_${origin}_v${policyVersion}`
      : `invalid_expected_click_evidence_origin_v${policyVersion}`;
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
  searchVolume: number;
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

type SerpSnapshot = {
  topicId: Id<"topic_clusters">;
  observedAt: number;
  locationCode?: number;
  languageCode?: string;
  results: Array<{ position: number; url: string }>;
  plannedValidationVersion?: number;
  plannedBusinessIntentAligned?: boolean;
  plannedAttainable?: boolean;
  plannedCannibalizationClear?: boolean;
};

function plannedSerpSnapshotMatchesCurrentLocale(
  site: Doc<"sites">,
  snapshot: SerpSnapshot,
  timestamp: number,
): boolean {
  return Number.isFinite(snapshot.observedAt) &&
    snapshot.observedAt > 0 &&
    snapshot.observedAt <= timestamp + 5 * 60 * 1_000 &&
    timestamp - snapshot.observedAt <= DEFAULT_EVIDENCE_MAX_AGE_MS &&
    snapshot.locationCode === dataForSeoLocationCode(site.targetCountry) &&
    snapshot.languageCode?.trim().toLowerCase() ===
      dataForSeoLanguageCode(site.language).trim().toLowerCase();
}

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

type AuthorityEvidence = {
  domain: string;
  domainRank: number;
  referringDomains?: number;
  source: string;
  measuredAt: number;
};

function activeRollout(site: Doc<"sites">): boolean {
  return Boolean(
    siteExecutionActive(site) &&
      site.autopilotEnabled &&
      site.expectedClickSchedulingEnabled === true &&
      ["warm", "live"].includes(site.autopilotRolloutMode ?? "observe"),
  );
}

function hasCurrentDemandAttempt(topic: Doc<"topic_clusters">): boolean {
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
      ) === normalizeExactDemandKeyword(topic.primaryKeyword) &&
      topic.expectedClickEvidenceAttemptTopicUpdatedAt === topic.updatedAt,
  );
}

function hasAnyExactEvidenceAttempt(topic: Doc<"topic_clusters">): boolean {
  return hasExactPlannedEvidenceAttempt(
    topic,
    EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
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
    JSON.stringify(guard.selected) ===
      JSON.stringify(selectedPlannedDescriptors(selected));
}

function artifactFingerprint(article: Doc<"articles">): string | null {
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
  articles: Doc<"articles">[],
): Doc<"articles"> | undefined {
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
  article: Doc<"articles">,
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
  // Selection may use only known non-branded query evidence. Page totals can
  // contain brand demand or hidden/unattributed queries and must never be
  // projected onto this topic's keyword merely because they share a URL.
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

function evidenceCandidateInventory(args: {
  site: Doc<"sites">;
  topics: Doc<"topic_clusters">[];
  articles: Doc<"articles">[];
  activeArticleTopicIds: ReadonlySet<string>;
  pageRows: PageEvidenceRow[];
  timestamp: number;
  plannedSiteGateAllowed: boolean;
  plannedAuthorityFresh: boolean;
}) {
  const currentTopics = args.topics.filter((topic) =>
    topicMatchesCurrentDomain(args.site, topic)
  );
  const byTopic = new Map<string, Doc<"articles">[]>();
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
    alreadyAudited: 0,
    alreadyAttempted: 0,
    demandUnavailable: 0,
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
  let artifactPendingDemand = 0;
  const rawPlannedPendingDemand: Array<{
    primaryKeyword: string;
    serpTopUrls?: string[];
  }> = [];
  for (const topic of currentTopics) {
    const linkedArticles = byTopic.get(String(topic._id)) ?? [];
    const article = bestReservingArticle(linkedArticles);
    const artifactHash = article ? artifactFingerprint(article) : null;
    if (article && artifactHash) {
      candidateCounts.covered += 1;
      const fit = evaluateTopicBusinessFit({
        keyword: topic.primaryKeyword,
        label: topic.label,
        ...businessSignals,
      });
      const businessFitEligible =
        fit.eligible && topic.businessFitEligible !== false;
      const currentDemand = hasCurrentExpectedClickDemand({
        evidence: topic,
        locationCode,
        languageCode,
        now: args.timestamp,
      });
      if (
        businessFitEligible &&
        !currentDemand &&
        !hasCurrentDemandAttempt(topic)
      ) artifactPendingDemand += 1;
      if (!needsExpectedClickEvidenceBackfill(topic, args.timestamp)) {
        candidateCounts.alreadyAudited += 1;
        continue;
      }
      if (hasCurrentEvidenceAttempt(topic)) {
        candidateCounts.alreadyAttempted += 1;
        continue;
      }
      if (!currentDemand || (topic.searchVolume ?? 0) <= 0) {
        candidateCounts.demandUnavailable += 1;
        continue;
      }
      if (!businessFitEligible) {
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
        searchVolume: topic.searchVolume!,
        priority: topic.priority,
        gscClicks: gsc.clicks,
        gscImpressions: gsc.impressions,
        gscPosition: gsc.position,
        selectionScore: 0,
        topicCreatedAt: topic.createdAt,
        topicUpdatedAt: topic.updatedAt,
        serpTopUrls: topic.serpTopUrls,
      };
      candidate.selectionScore = expectedClickBackfillSelectionScore({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      });
      artifactCandidates.push(candidate);
      continue;
    }

    if (!args.plannedSiteGateAllowed) {
      candidateCounts.plannedGateBlocked += 1;
      continue;
    }
    const currentDemand = hasCurrentExpectedClickDemand({
      evidence: topic,
      locationCode,
      languageCode,
      now: args.timestamp,
    });
    const currentPositiveDemand =
      currentDemand && (topic.searchVolume ?? 0) > 0;
    const admission = plannedTopicEvidenceAdmission({
      site: args.site,
      topic,
      hasLinkedArticle: linkedArticles.length > 0,
      hasActiveArticleJob: args.activeArticleTopicIds.has(String(topic._id)),
      hasCurrentPositiveDemand: currentPositiveDemand,
      timestamp: args.timestamp,
    });
    if (!admission.eligible || !admission.fingerprint) {
      if (admission.reason === "current_positive_demand_required") {
        if (
          args.plannedAuthorityFresh &&
          !currentDemand &&
          !hasCurrentDemandAttempt(topic)
        ) {
          rawPlannedPendingDemand.push({
            primaryKeyword: topic.primaryKeyword,
            // Demand will not trust observational legacy SERPs either.
            serpTopUrls: undefined,
          });
        }
        candidateCounts.demandUnavailable += 1;
      } else {
        candidateCounts.plannedGateBlocked += 1;
      }
      continue;
    }
    if (!needsExpectedClickEvidenceBackfill(topic, args.timestamp)) {
      candidateCounts.alreadyAudited += 1;
      continue;
    }
    // Planned-mode attempts are terminal by exact keyword even if a later
    // audit touches the row's generic updatedAt.
    if (hasAnyExactEvidenceAttempt(topic)) {
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
      searchVolume: topic.searchVolume!,
      priority: topic.priority,
      gscClicks: 0,
      gscImpressions: 0,
      selectionScore: 0,
      topicCreatedAt: topic.createdAt,
      topicUpdatedAt: topic.updatedAt,
      // Only the fresh paid snapshot below may supply SERP evidence. Until
      // then canonical and within-batch dedupe use lexical fallback.
      serpTopUrls: undefined,
    };
    candidate.selectionScore = expectedClickBackfillSelectionScore({
      ...candidate,
      createdAt: candidate.topicCreatedAt,
    });
    rawPlannedCandidates.push(candidate);
  }
  const orderedPlannedCandidates = uniqueExactPlannedTargets(
    rawPlannedCandidates.slice().sort((left, right) =>
      right.selectionScore - left.selectionScore ||
      right.searchVolume - left.searchVolume ||
      right.gscImpressions - left.gscImpressions ||
      left.topicCreatedAt - right.topicCreatedAt ||
      String(left.topicId).localeCompare(String(right.topicId))
    ),
  );
  const plannedCandidates = filterPlannedTopicRecoveryCoverage(
    orderedPlannedCandidates,
    coveredTopics,
    EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
  );
  const plannedPendingDemand = filterPlannedTopicRecoveryCoverage(
    rawPlannedPendingDemand,
    coveredTopics,
    1,
  ).length;
  candidateCounts.artifactEligible = artifactCandidates.length;
  candidateCounts.plannedUnmaterialized = plannedCandidates.length;
  // A cadence-critical planned topic must not be starved behind measurement of
  // a page that is already published. Once the sealed buffer reaches its
  // minimum, the existing evidence-ready artifact priority resumes.
  const candidates = cadenceCritical &&
      plannedCandidates.length === 0 && plannedPendingDemand > 0
    ? []
    : prioritizeCadenceRecoveryCandidates(
        artifactCandidates,
        plannedCandidates,
        cadenceCritical,
      );
  candidateCounts.eligible = candidates.length;
  return {
    candidates,
    artifactCandidates,
    plannedCandidates,
    artifactPendingDemand,
    plannedPendingDemand,
    cadenceCritical,
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
  additionalCoverage: Array<{ primaryKeyword: string; serpTopUrls?: string[] }> = [],
): Promise<boolean> {
  const site = await ctx.db.get(siteId);
  const [topics, articles] = await Promise.all([
    site
      ? takeCurrentDomainTopics(
        ctx,
        site,
        EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
      )
      : Promise.resolve([]),
    site
      ? takeCurrentDomainArticles(
        ctx,
        site,
        EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
      )
      : Promise.resolve([]),
  ]);
  if (
    !site ||
    !topicMatchesCurrentDomain(site, topic) ||
    topics.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT ||
    articles.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT
  ) return false;
  const coverage = [
    ...coveredIntentTopics(
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
    ),
    ...additionalCoverage,
  ];
  return filterNonCannibalizingIntentTopics(
    [{ primaryKeyword: topic.primaryKeyword, serpTopUrls }],
    coverage,
    0.4,
    0.35,
    1,
  ).length === 1;
}

async function requireOwner(
  ctx: QueryCtx,
  siteId: Id<"sites">,
): Promise<Doc<"sites">> {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to inspect this evidence backfill");
  }
  return site;
}

function safeJobStatus(job: Doc<"expected_click_evidence_jobs"> | null) {
  if (!job) return null;
  return {
    jobId: job._id,
    status: job.status,
    policyVersion: job.policyVersion,
    reservationDay: job.reservationDay,
    selectedTopics: job.selectedTopics.length,
    candidateCounts: job.candidateCounts,
    serpSnapshots: job.serpSnapshots.length,
    serpFailures: job.serpFailures.length,
    serpAttempts: job.serpAttemptedTopicIds.length,
    serpAmbiguous: Math.max(
      0,
      job.serpAttemptedTopicIds.length -
        job.serpSnapshots.length - job.serpFailures.length,
    ),
    authoritySnapshotComplete: job.authoritySnapshotComplete === true,
    providerCallsAttempted: job.providerCallsAttempted,
    providerCallsCompleted: job.providerCallsCompleted,
    providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
    persistedTopics: job.persistedTopics ?? 0,
    insufficientTopics: job.insufficientTopics ?? 0,
    skippedTopics: job.skippedTopics ?? 0,
    workerAttempts: job.workerAttempts,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
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

async function latestJobForSite(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("expected_click_evidence_jobs")
    .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
    .order("desc")
    .first();
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

/**
 * Ambiguity can only exist while an evidence job is unresolved: every paid
 * attempt is durably recorded before HTTP, and terminal completion requires
 * matching receipts. Scan those states for every origin so an operator canary
 * still fences autonomous spend, without making clean terminal history an
 * eventual permanent fleet blocker.
 */
async function unresolvedEvidenceJobsForAmbiguity(
  ctx: Pick<QueryCtx, "db">,
  siteId: Id<"sites">,
): Promise<{
  jobs: Doc<"expected_click_evidence_jobs">[];
  exhausted: boolean;
}> {
  const groups = await Promise.all(EVIDENCE_UNRESOLVED_STATUSES.map((status) =>
    ctx.db
      .query("expected_click_evidence_jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", status)
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

/** Owner-visible status is deliberately aggregate-only and credential-free. */
export const getStatus = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireOwner(ctx, siteId);
    return {
      enabled: site.expectedClickSchedulingEnabled === true,
      rolloutMode: site.autopilotRolloutMode ?? "observe",
      activeRollout: activeRollout(site),
      latest: safeJobStatus(await latestJobForSite(ctx, siteId)),
    };
  },
});

/** Operator CLI status. It exposes no provider balance or tenant credentials. */
export const getStatusInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    return {
      enabled: site.expectedClickSchedulingEnabled === true,
      rolloutMode: site.autopilotRolloutMode ?? "observe",
      activeRollout: activeRollout(site),
      latest: safeJobStatus(await latestJobForSite(ctx, siteId)),
      // Why the last natural evaluation did or did not reserve work.
      // Without this a correct idle and a silent stall look identical.
      reservationReceipt: sanitizeSkipReceiptForOperator(
        await ctx.db
          .query("expected_click_backfill_skip_receipts")
          .withIndex("by_site_kind", (q) =>
            q.eq("siteId", siteId).eq("kind", "evidence")
          )
          .unique(),
      ),
    };
  },
});

export const getJobInternal = internalQuery({
  args: { siteId: v.id("sites"), jobId: v.id("expected_click_evidence_jobs") },
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
 * recovery, and cadence micro-seed admission. */
export async function expectedClickEvidenceFleetReadiness(
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
      };
    }
    const [
      unresolvedDemand,
      unresolvedEvidence,
      ambiguityCandidates,
    ] = await Promise.all([
      unresolvedFleetDemandJobs(ctx, siteId),
      unresolvedFleetEvidenceJobs(ctx, siteId),
      unresolvedEvidenceJobsForAmbiguity(ctx, siteId),
    ]);
    if (
      unresolvedDemand.exhausted ||
      unresolvedEvidence.exhausted ||
      ambiguityCandidates.exhausted
    ) {
      return {
        ready: false as const,
        reason: "unresolved_job_read_limit_exhausted" as const,
        actionable: true,
        candidateCount: 0,
      };
    }
    const ambiguousEvidence = ambiguityCandidates.jobs
      .filter(evidenceJobHasAmbiguousAttempt)
      .map((job) => ({
        createdAt: job.createdAt,
        ambiguous: true,
        phase: "evidence" as const,
      }));
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
    const unresolved = [
      ...unresolvedJobs.filter((job) => job.ambiguous),
      ...ambiguousEvidence,
    ]
      .sort((left, right) => left.createdAt - right.createdAt)[0] ??
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
      };
    }
    const reservationDay = utcBackfillDay(timestamp);
    const [todayEvidenceRows, todayDemandRows] = await Promise.all([
      ctx.db
        .query("expected_click_evidence_jobs")
        .withIndex("by_site_day", (q) =>
          q.eq("siteId", siteId).eq("reservationDay", reservationDay)
        )
        .collect(),
      ctx.db
        .query("expected_click_demand_jobs")
        .withIndex("by_site_day", (q) =>
          q.eq("siteId", siteId).eq("reservationDay", reservationDay)
        )
        .collect(),
    ]);
    const currentRolloutEpoch = site.autopilotRolloutEpoch ?? 0;
    const todayEvidenceJob = todayEvidenceRows.find((job) =>
      isCurrentExpectedClickBatch(
        job,
        currentRolloutEpoch,
        EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
      )
    );
    const todayDemandJob = todayDemandRows.find((job) =>
      isCurrentExpectedClickBatch(
        job,
        currentRolloutEpoch,
        EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
      )
    );
    if (todayEvidenceJob) {
      return {
        ready: false as const,
        reason: "daily_batch_exists" as const,
        actionable: false,
        candidateCount: 0,
      };
    }
    if (
      todayDemandJob &&
      ["pending", "running", "partial"].includes(todayDemandJob.status)
    ) {
      return {
        ready: false as const,
        reason: "demand_phase_incomplete" as const,
        actionable: todayDemandJob.status === "partial",
        candidateCount: 0,
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
            EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
          ),
          takeCurrentDomainArticles(
            ctx,
            site,
            EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
          ),
          activeArticleJobTopicIds(ctx, siteId),
          plannedTopicSiteGate(ctx, site, timestamp),
        ]);
    if (
      topics.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT ||
      articles.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT ||
      activeJobs.exhausted
    ) {
      return {
        ready: false as const,
        reason: "evidence_read_limit_exhausted" as const,
        actionable: true,
        candidateCount: 0,
      };
    }
    const tenantAuthority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    const plannedAuthorityFresh = snapshot?.plannedAuthorityFresh ??
      measuredAuthorityIsFresh(tenantAuthority, timestamp);
    const inventory = evidenceCandidateInventory({
      site,
      topics,
      articles,
      activeArticleTopicIds: activeJobs.topicIds,
      pageRows: [],
      timestamp,
      plannedSiteGateAllowed: plannedGate.allowed,
      plannedAuthorityFresh,
    });
    const pendingDemandCount = inventory.cadenceCritical
      ? inventory.plannedPendingDemand
      : inventory.artifactCandidates.length > 0 ||
        inventory.artifactPendingDemand > 0
        ? inventory.artifactPendingDemand
        : inventory.plannedPendingDemand;
    const selected = selectExpectedClickBackfillCandidates(
      inventory.candidates.map((candidate) => ({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      })),
    ).map(selectedWithoutTransientFields);
    const candidateCount = selected.length;
    if (pendingDemandCount > 0 && candidateCount === 0) {
      return {
        ready: false as const,
        reason: todayDemandJob?.status === "provider_balance_unavailable"
          ? "demand_phase_unavailable" as const
          : "demand_candidates_remaining" as const,
        actionable: todayDemandJob?.status === "provider_balance_unavailable",
        candidateCount,
        candidateCounts: inventory.candidateCounts,
      };
    }
    if (candidateCount === 0) {
      return {
        ready: false as const,
        reason: "no_current_demand_candidates" as const,
        actionable: false,
        candidateCount: 0,
        candidateCounts: inventory.candidateCounts,
      };
    }
    if (!plannedAuthorityFresh) {
      return {
        ready: false as const,
        reason: "tenant_authority_unavailable" as const,
        actionable: true,
        candidateCount,
      };
    }
    return {
      ready: true as const,
      reason: "eligible" as const,
      actionable: false,
      candidateCount,
      candidateCounts: inventory.candidateCounts,
      plannedSelection: selectedPlannedDescriptors(selected),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      reservationDay,
    };
}

/**
 * Provider-free fleet gate. Evidence is allowed only after the day's demand
 * phase is terminal (or no unmigrated demand candidate remains), and any
 * unresolved ambiguous paid attempt blocks autonomous replay for review.
 */
export const getFleetReadinessInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) =>
    expectedClickEvidenceFleetReadiness(ctx, siteId),
});

/**
 * Natural fleet inspection with a durable refusal receipt.
 *
 * A non-ready result prevents the provider preflight and reservation mutation
 * from running. Persist that provider-free decision in the same transaction
 * that re-evaluates it, rather than trying to record a potentially stale
 * action-level query result.
 */
export const inspectAndRecordFleetReadinessInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const evaluatedAt = Date.now();
    const readiness = await expectedClickEvidenceFleetReadiness(
      ctx,
      siteId,
      evaluatedAt,
    );
    if (readiness && !readiness.ready) {
      await recordExpectedClickReservationOutcome(ctx, {
        siteId,
        kind: "evidence",
        policyVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
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
    const unresolved = await unresolvedFleetEvidenceJobs(ctx, siteId);
    if (unresolved.exhausted) {
      return {
        action: "blocked" as const,
        reason: "unresolved_job_read_limit_exhausted" as const,
        actionable: true,
      };
    }
    const job = unresolved.jobs.find(evidenceJobHasAmbiguousAttempt) ??
      oldestUnresolvedFleetJob(unresolved.jobs);
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
    if (evidenceJobHasAmbiguousAttempt(job)) {
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
    const providerWorkComplete =
      job.serpSnapshots.length + job.serpFailures.length >=
        job.selectedTopics.length &&
      job.authoritySnapshotComplete === true;
    if (!providerWorkComplete && job.reservationDay !== utcBackfillDay(now)) {
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

/**
 * Atomic queue after the free provider-account preflight. Every eligibility
 * gate and the one-batch/policy/day check runs before shared spend reservation.
 */
export const reserveAndQueue = internalMutation({
  args: {
    siteId: v.id("sites"),
    policyVersion: v.number(),
    origin: jobOriginValidator,
    plannedRecoveryGuard: v.optional(plannedRecoveryGuardValidator),
  },
  handler: async (ctx, args) => {
    // Written in this same transaction so an overlapping dispatcher can never
    // observe a decision the stored evidence contradicts.
    const evaluatedAt = Date.now();
    const outcome = await reserveEvidenceOutcome(ctx, args);
    await recordExpectedClickReservationOutcome(ctx, {
      siteId: args.siteId,
      kind: "evidence",
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

async function reserveEvidenceOutcome(
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
    if (policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click evidence backfill version");
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
    const reservationDay = utcBackfillDay(timestamp);
    const [
      todayJobRows,
      todayDemandJobRows,
      unresolvedDemand,
      unresolvedEvidence,
    ] = await Promise.all([
      ctx.db
        .query("expected_click_evidence_jobs")
        .withIndex("by_site_day", (q) =>
          q.eq("siteId", siteId).eq("reservationDay", reservationDay)
        )
        .collect(),
      ctx.db
        .query("expected_click_demand_jobs")
        .withIndex("by_site_day", (q) =>
          q.eq("siteId", siteId).eq("reservationDay", reservationDay)
        )
        .collect(),
      unresolvedFleetDemandJobs(ctx, siteId),
      unresolvedFleetEvidenceJobs(ctx, siteId),
    ]);
    const todayJobs = todayJobRows.filter((job) =>
      isCurrentExpectedClickBatch(
        job,
        site.autopilotRolloutEpoch ?? 0,
        EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
      )
    );
    const todayDemandJobs = todayDemandJobRows.filter((job) =>
      isCurrentExpectedClickBatch(
        job,
        site.autopilotRolloutEpoch ?? 0,
        EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
      )
    );
    // A provider-balance race can release the shared reservation, but it must
    // not create a loophole around the tenant's one-new-job-per-UTC-day fence.
    // The operator can try again on the next UTC day; paid work is never
    // multiplied by repeatedly queueing fresh rows after an aborted worker.
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
    const todayDemandJob = todayDemandJobs[0];
    const initialPhaseDecision = planEvidencePhaseReservation({
      origin,
      todayDemandJob: todayDemandJob
        ? {
            id: String(todayDemandJob._id),
            status: todayDemandJob.status,
            origin: todayDemandJob.origin,
          }
        : undefined,
      pendingDemandCandidates: 0,
      unresolvedDemandJobs: unresolvedDemand.jobs.length,
      unresolvedEvidenceJobs: unresolvedEvidence.jobs.length,
      unresolvedReadLimitExhausted:
        unresolvedDemand.exhausted || unresolvedEvidence.exhausted,
    });
    if (!initialPhaseDecision.allowed) {
      return {
        queued: false as const,
        reason: initialPhaseDecision.reason,
      };
    }

    const tenantAuthority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    if (!measuredAuthorityIsFresh(tenantAuthority, timestamp)) {
      return {
        queued: false as const,
        reason: "tenant_authority_unavailable" as const,
      };
    }

    const [topics, articles, gscPageRead, activeJobs, plannedGate] =
      await Promise.all([
      takeCurrentDomainTopics(
        ctx,
        site,
        EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
      ),
      takeCurrentDomainArticles(
        ctx,
        site,
        EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT,
      ),
      takeCurrentGscPageRows(
        ctx,
        site,
        EXPECTED_CLICK_EVIDENCE_GSC_READ_LIMIT,
      ),
      activeArticleJobTopicIds(ctx, siteId),
      plannedTopicSiteGate(ctx, site, timestamp),
    ]);
    if (
      topics.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT ||
      articles.length >= EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT ||
      gscPageRead.exhausted ||
      activeJobs.exhausted
    ) {
      return {
        queued: false as const,
        reason: "evidence_read_limit_exhausted" as const,
      };
    }
    const pageRows = gscPageRead.rows;
    const inventory = evidenceCandidateInventory({
      site,
      topics,
      articles,
      activeArticleTopicIds: activeJobs.topicIds,
      pageRows,
      timestamp,
      plannedSiteGateAllowed: plannedGate.allowed,
      plannedAuthorityFresh: true,
    });
    const candidates = plannedRecoveryGuard
      ? inventory.artifactCandidates.length === 0
        ? inventory.plannedCandidates
        : []
      : plannedTargetsAllowedForQueue(origin, false)
        ? inventory.candidates
        : inventory.artifactCandidates;
    const pendingDemandCount = plannedRecoveryGuard
      ? inventory.plannedPendingDemand
      : inventory.cadenceCritical
        ? inventory.plannedPendingDemand
        : !plannedTargetsAllowedForQueue(origin, false) ||
          inventory.artifactCandidates.length > 0 ||
          inventory.artifactPendingDemand > 0
        ? inventory.artifactPendingDemand
        : inventory.plannedPendingDemand;
    const candidateCounts = inventory.candidateCounts;
    const selectedTopics = selectExpectedClickBackfillCandidates(
      candidates.map((candidate) => ({
        ...candidate,
        createdAt: candidate.topicCreatedAt,
      })),
    ).map(selectedWithoutTransientFields);
    const phaseDecision = planEvidencePhaseReservation({
      origin,
      todayDemandJob: todayDemandJob
        ? {
            id: String(todayDemandJob._id),
            status: todayDemandJob.status,
            origin: todayDemandJob.origin,
          }
        : undefined,
      pendingDemandCandidates: pendingDemandCount,
      readyEvidenceCandidates: selectedTopics.length,
      unresolvedDemandJobs: unresolvedDemand.jobs.length,
      unresolvedEvidenceJobs: unresolvedEvidence.jobs.length,
      unresolvedReadLimitExhausted:
        unresolvedDemand.exhausted || unresolvedEvidence.exhausted,
    });
    if (!phaseDecision.allowed) {
      return {
        queued: false as const,
        reason: phaseDecision.reason,
        pendingDemandCount,
      };
    }
    if (selectedTopics.length === 0) {
      return {
        queued: false as const,
        reason: plannedRecoveryGuard
          ? "planned_recovery_precondition_changed" as const
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
      purpose: "expected_click_evidence_backfill",
      trigger: evidenceReservationTrigger(origin, policyVersion),
      reservedMicroUsd:
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      timestamp,
    });
    if (!shared.ok) {
      return { queued: false as const, reason: shared.reason };
    }
    const jobId = await ctx.db.insert("expected_click_evidence_jobs", {
      siteId,
      userId: site.userId,
      status: "pending",
      policyVersion,
      origin,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      reservationDay,
      providerCostCeilingMicroUsd:
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      providerSpendReservationId: shared.reservationId,
      demandPrerequisiteMode: phaseDecision.prerequisiteMode,
      demandPrerequisiteJobId: todayDemandJob?._id,
      selectionScope: plannedRecoveryGuard
        ? "planned_unmaterialized"
        : "all_eligible",
      plannedRecoveryInspectionKey: plannedRecoveryGuard?.inspectionKey,
      selectedTopics,
      candidateCounts,
      serpSnapshots: [],
      serpFailures: [],
      serpAttemptedTopicIds: [],
      providerCallsAttempted: 0,
      providerCallsCompleted: 0,
      workerAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(0, workerApi.processExpectedClickEvidenceBackfill, {
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
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    };
}

function validateWorkerState(
  site: Doc<"sites">,
  job: Doc<"expected_click_evidence_jobs">,
): void {
  if (
    !activeRollout(site) ||
    job.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION ||
    job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0)
  ) {
    throw new Error("Expected-click evidence backfill authorization is stale");
  }
}

export const claimWorker = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
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
    if (args.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click evidence backfill version");
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
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
      startedAt: job.startedAt ?? timestamp,
      errorCode: undefined,
      updatedAt: timestamp,
    });
    return {
      ...job,
      status: "running",
      workerToken: args.workerToken,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
    };
  },
});

async function requireWorker(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"expected_click_evidence_jobs">;
    workerToken: string;
  },
): Promise<{
  site: Doc<"sites">;
  job: Doc<"expected_click_evidence_jobs">;
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
    throw new Error("Expected-click evidence backfill worker lease is invalid");
  }
  validateWorkerState(site, job);
  return { site, job };
}

async function requireCurrentProviderReservation(
  ctx: MutationCtx,
  site: Doc<"sites">,
  job: Doc<"expected_click_evidence_jobs">,
  timestamp: number,
): Promise<void> {
  const [reservation, demandPrerequisite] = await Promise.all([
    ctx.db.get(job.providerSpendReservationId),
    job.demandPrerequisiteJobId
      ? ctx.db.get(job.demandPrerequisiteJobId)
      : Promise.resolve(null),
  ]);
  const fleetPrerequisiteValid = job.origin !== "autonomous_fleet" || (
    job.demandPrerequisiteMode === "no_remaining_demand_candidates" &&
    job.demandPrerequisiteJobId === undefined
  ) || (
    job.demandPrerequisiteMode === "completed_fleet_demand" &&
    Boolean(
      demandPrerequisite &&
      demandPrerequisite.siteId === site._id &&
      demandPrerequisite.origin === "autonomous_fleet" &&
      demandPrerequisite.status === "completed" &&
      demandPrerequisite.reservationDay === job.reservationDay,
    )
  );
  if (
    !reservation ||
    reservation.siteId !== site._id ||
    reservation.userId !== site.userId ||
    reservation.purpose !== "expected_click_evidence_backfill" ||
    reservation.trigger !==
      evidenceReservationTrigger(job.origin, job.policyVersion) ||
    reservation.reservedMicroUsd !==
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    reservation.reservationDay !== job.reservationDay ||
    reservation.releasedAt !== undefined ||
    job.providerCostCeilingMicroUsd !==
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    job.providerCostReservedMicroUsd !==
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
    !fleetPrerequisiteValid ||
    job.reservationDay !== utcBackfillDay(timestamp)
  ) {
    throw new Error("Expected-click evidence provider reservation is stale");
  }
}

/**
 * Re-resolve the exact tenant-owned topic/artifact immediately before paid
 * work. Selection and persistence have the same fence, but provider calls
 * must not spend on an artifact that changed in between those two points.
 */
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
  const timestamp = Date.now();
  if (
    !topic ||
    topic.siteId !== site._id ||
    !topicMatchesCurrentDomain(site, topic) ||
    topic.primaryKeyword !== selected.keyword ||
    topic.label !== selected.label ||
    topic.searchVolume !== selected.searchVolume ||
    topic.updatedAt !== selected.topicUpdatedAt ||
    !needsExpectedClickEvidenceBackfill(topic, timestamp) ||
    !hasCurrentExpectedClickDemand({
      evidence: topic,
      locationCode: dataForSeoLocationCode(site.targetCountry),
      languageCode: dataForSeoLanguageCode(site.language),
      now: timestamp,
    })
  ) return null;
  const fit = evaluateTopicBusinessFit({
    keyword: topic.primaryKeyword,
    label: topic.label,
    ...tenantTopicBusinessSignals(site),
  });
  if (!fit.eligible || topic.businessFitEligible === false) return null;
  if (targetKind === "planned_topic") {
    const [siteGate, activeJobs, linkedArticle] = await Promise.all([
      plannedTopicSiteGate(ctx, site, timestamp),
      activeArticleJobTopicIds(ctx, site._id),
      ctx.db
        .query("articles")
        .withIndex("by_topic", (q) => q.eq("topicId", selected.topicId))
        .first(),
    ]);
    const tenantAuthority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    const admission = plannedTopicEvidenceAdmission({
      site,
      topic,
      hasLinkedArticle: Boolean(
        linkedArticle && articleMatchesCurrentDomain(site, linkedArticle),
      ),
      hasActiveArticleJob: activeJobs.topicIds.has(String(topic._id)),
      hasCurrentPositiveDemand:
        (topic.searchVolume ?? 0) > 0 &&
        hasCurrentExpectedClickDemand({
          evidence: topic,
          locationCode: dataForSeoLocationCode(site.targetCountry),
          languageCode: dataForSeoLanguageCode(site.language),
          now: timestamp,
        }),
      timestamp,
    });
    if (
      !siteGate.allowed ||
      activeJobs.exhausted ||
      !measuredAuthorityIsFresh(tenantAuthority, timestamp) ||
      !admission.eligible ||
      admission.fingerprint !== selected.plannedTopicFingerprint ||
      // Before the paid SERP receipt exists, dedupe must use lexical fallback
      // rather than treating legacy URLs without provenance as evidence.
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

export const getExecutionStateInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !siteExecutionActive(site) ||
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "running" ||
      job.workerToken !== args.workerToken ||
      (job.leaseExpiresAt ?? 0) <= Date.now()
    ) return null;
    validateWorkerState(site, job);
    return { site, job };
  },
});

export const beginProviderCall = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    kind: v.union(v.literal("serp"), v.literal("authority")),
    topicId: v.optional(v.id("topic_clusters")),
    authorityDomains: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    if (job.providerCallsAttempted >= EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT) {
      throw new Error("Expected-click evidence provider call ceiling exhausted");
    }
    let selectedTopic: SelectedTopic | undefined;
    let currentTopic: Doc<"topic_clusters"> | undefined;
    if (args.kind === "serp") {
      selectedTopic = args.topicId
        ? (job.selectedTopics as SelectedTopic[]).find(
          (topic) => topic.topicId === args.topicId,
        )
        : undefined;
      if (!args.topicId || !selectedTopic) {
        throw new Error("SERP call crossed a selected topic boundary");
      }
      if (
        job.serpSnapshots.some((item: SerpSnapshot) => item.topicId === args.topicId) ||
        job.serpFailures.some((item) => item.topicId === args.topicId) ||
        job.serpAttemptedTopicIds.includes(args.topicId)
      ) return { allowed: false as const, reason: "already_recorded" as const };
      const current = await currentSelectedTopic(ctx, site, selectedTopic);
      if (!current) {
        return {
          allowed: false as const,
          reason: "topic_or_artifact_changed" as const,
        };
      }
      currentTopic = current.topic;
      const attemptAlreadyRecorded =
        expectedClickTargetKind(selectedTopic) === "planned_topic"
          ? hasAnyExactEvidenceAttempt(currentTopic)
          : hasCurrentEvidenceAttempt(currentTopic);
      if (attemptAlreadyRecorded) {
        return {
          allowed: false as const,
          reason: "topic_attempt_already_recorded" as const,
        };
      }
    } else if (job.authoritySnapshotComplete === true) {
      return { allowed: false as const, reason: "already_recorded" as const };
    } else if (job.authorityDomains !== undefined) {
      // A live bulk call was already initiated. Its response is ambiguous if
      // no receipt exists; replaying it would violate the one-call contract.
      return { allowed: false as const, reason: "authority_attempt_ambiguous" as const };
    } else {
      // The bulk authority purchase is derived from prior SERP snapshots. If
      // any source topic/artifact drifted, do not buy authority for stale SERPs.
      for (const snapshot of job.serpSnapshots as SerpSnapshot[]) {
        const selected = (job.selectedTopics as SelectedTopic[]).find(
          (candidate) => candidate.topicId === snapshot.topicId,
        );
        const current = selected
          ? await currentSelectedTopic(ctx, site, selected)
          : null;
        if (!selected || !current) {
          return {
            allowed: false as const,
            reason: "topic_or_artifact_changed" as const,
          };
        }
        if (expectedClickTargetKind(selected) === "planned_topic") {
          const validationComplete =
            snapshot.plannedValidationVersion ===
              PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION &&
            snapshot.plannedBusinessIntentAligned === true &&
            snapshot.plannedAttainable === true &&
            snapshot.plannedCannibalizationClear === true &&
            plannedSerpSnapshotMatchesCurrentLocale(
              site,
              snapshot,
              Date.now(),
            );
          const otherPlannedCoverage = (job.serpSnapshots as SerpSnapshot[])
            .filter((candidate) => candidate.topicId !== snapshot.topicId)
            .flatMap((candidate) => {
              const other = (job.selectedTopics as SelectedTopic[]).find(
                (item) => item.topicId === candidate.topicId,
              );
              return other &&
                  expectedClickTargetKind(other) === "planned_topic"
                ? [{
                    primaryKeyword: other.keyword,
                    serpTopUrls: candidate.results.map((result) => result.url),
                  }]
                : [];
            });
          if (
            !validationComplete ||
            !(await plannedTopicClearsCurrentCoverage(
              ctx,
              site._id,
              current.topic,
              snapshot.results.map((result) => result.url),
              otherPlannedCoverage,
            ))
          ) {
            return {
              allowed: false as const,
              reason: "planned_serp_validation_stale" as const,
            };
          }
        }
      }
    }
    const timestamp = Date.now();
    await requireCurrentProviderReservation(ctx, site, job, timestamp);
    if (
      args.kind === "authority" &&
      (args.authorityDomains?.length ?? 0) > 50
    ) throw new Error("Authority call exceeded the bounded domain ceiling");
    if (args.kind === "serp" && args.topicId && selectedTopic && currentTopic) {
      await ctx.db.patch(args.topicId, {
        expectedClickEvidenceAttemptVersion:
          EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
        expectedClickEvidenceAttemptJobId: args.jobId,
        expectedClickEvidenceAttemptKeyword: selectedTopic.keyword,
        expectedClickEvidenceAttemptTopicUpdatedAt:
          selectedTopic.topicUpdatedAt,
        expectedClickEvidenceAttemptedAt: timestamp,
      });
    }
    await ctx.db.patch(args.jobId, {
      providerCallsAttempted: job.providerCallsAttempted + 1,
      ...(args.kind === "serp" && args.topicId
        ? {
            serpAttemptedTopicIds: [
              ...job.serpAttemptedTopicIds,
              args.topicId,
            ],
          }
        : {}),
      ...(args.kind === "authority"
        ? { authorityDomains: args.authorityDomains ?? [] }
        : {}),
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return { allowed: true as const };
  },
});

export const recordSerpSnapshot = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    topicId: v.id("topic_clusters"),
    observedAt: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    results: v.array(v.object({ position: v.number(), url: v.string() })),
    intentResults: v.optional(v.array(v.object({
      position: v.number(),
      url: v.string(),
      title: v.string(),
      description: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    const selected = (job.selectedTopics as SelectedTopic[]).find(
      (topic) => topic.topicId === args.topicId,
    );
    if (!selected) {
      throw new Error("SERP snapshot crossed a selected topic boundary");
    }
    if (!job.serpAttemptedTopicIds.includes(args.topicId)) {
      throw new Error("SERP snapshot has no matching provider attempt");
    }
    if (
      job.serpSnapshots.some(
        (snapshot: SerpSnapshot) => snapshot.topicId === args.topicId,
      ) ||
      job.serpFailures.some((failure) => failure.topicId === args.topicId)
    ) return { recorded: false };
    const results = args.results
      .filter((result) =>
        Number.isInteger(result.position) &&
        result.position >= 1 &&
        result.position <= 10 &&
        /^https?:\/\//i.test(result.url)
      )
      .sort((left, right) => left.position - right.position)
      .filter((result, index, all) =>
        index === all.findIndex((other) => other.position === result.position)
      )
      .slice(0, 10);
    const timestamp = Date.now();
    if (
      !Number.isFinite(args.observedAt) ||
      args.observedAt <= 0 ||
      args.observedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("SERP snapshot timestamp is invalid");
    if (results.length < 5) {
      throw new Error("A SERP evidence snapshot requires five organic results");
    }
    const targetKind = expectedClickTargetKind(selected);
    if (!targetKind) {
      throw new Error("SERP snapshot selected target is malformed");
    }
    let plannedValidation:
      | {
          plannedValidationVersion: number;
          plannedBusinessIntentAligned: true;
          plannedAttainable: true;
          plannedCannibalizationClear: true;
        }
      | undefined;
    if (targetKind === "planned_topic") {
      const current = await currentSelectedTopic(ctx, site, selected);
      const intentResults = (args.intentResults ?? [])
        .filter((result) =>
          Number.isInteger(result.position) &&
          result.position >= 1 &&
          result.position <= 10 &&
          /^https?:\/\//i.test(result.url)
        )
        .sort((left, right) => left.position - right.position)
        .filter((result, index, all) =>
          index === all.findIndex((other) => other.position === result.position)
        )
        .slice(0, 10);
      const exactIntentReceipt = JSON.stringify(
        intentResults.map(({ position, url }) => ({ position, url })),
      ) === JSON.stringify(results);
      const intent = exactIntentReceipt
        ? evaluateSerpBusinessIntent({
            results: intentResults,
            businessModelSignals:
              tenantTopicBusinessSignals(site).businessModelSignals,
          })
        : { aligned: false, classifiedResults: 0, reasons: [] };
      const attainable = evaluateSerpAttainability({
        serpTopUrls: results.map((result) => result.url),
        siteHost: site.domain,
      });
      const priorPlannedCoverage = (job.serpSnapshots as SerpSnapshot[])
        .flatMap((snapshot) => {
          const prior = (job.selectedTopics as SelectedTopic[]).find(
            (candidate) => candidate.topicId === snapshot.topicId,
          );
          return prior && expectedClickTargetKind(prior) === "planned_topic"
            ? [{
                primaryKeyword: prior.keyword,
                serpTopUrls: snapshot.results.map((result) => result.url),
              }]
            : [];
        });
      const cannibalizationClear = Boolean(
        current && await plannedTopicClearsCurrentCoverage(
          ctx,
          site._id,
          current.topic,
          results.map((result) => result.url),
          priorPlannedCoverage,
        ),
      );
      const localeReceiptCurrent =
        args.locationCode === dataForSeoLocationCode(site.targetCountry) &&
        args.languageCode.trim().toLowerCase() ===
          dataForSeoLanguageCode(site.language).trim().toLowerCase() &&
        current?.topic.expectedClickEvidenceAttemptJobId === args.jobId &&
        Number.isFinite(current?.topic.expectedClickEvidenceAttemptedAt) &&
        args.observedAt >=
          (current?.topic.expectedClickEvidenceAttemptedAt ?? Infinity);
      const failureCode = !current
        ? "topic_or_target_changed"
        : !localeReceiptCurrent
          ? "serp_locale_receipt_mismatch"
        : !exactIntentReceipt || !intent.aligned
          ? "serp_business_intent_mismatch"
          : !attainable.attainable
            ? "serp_unattainable"
            : !cannibalizationClear
              ? "serp_cannibalization_conflict"
              : null;
      if (failureCode) {
        await ctx.db.patch(args.jobId, {
          serpFailures: [...job.serpFailures, {
            topicId: args.topicId,
            code: failureCode,
            recordedAt: timestamp,
          }],
          providerCallsCompleted: job.providerCallsCompleted + 1,
          leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
          updatedAt: timestamp,
        });
        return { recorded: false, rejected: true, reason: failureCode };
      }
      plannedValidation = {
        plannedValidationVersion: PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION,
        plannedBusinessIntentAligned: true,
        plannedAttainable: true,
        plannedCannibalizationClear: true,
      };
    }
    await ctx.db.patch(args.jobId, {
      serpSnapshots: [...job.serpSnapshots, {
        topicId: args.topicId,
        observedAt: args.observedAt,
        locationCode: args.locationCode,
        languageCode: args.languageCode,
        results,
        ...plannedValidation,
      }],
      providerCallsCompleted: job.providerCallsCompleted + 1,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return { recorded: true };
  },
});

export const recordSerpFailure = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    topicId: v.id("topic_clusters"),
    code: v.union(
      v.literal("insufficient_organic_results"),
      v.literal("provider_call_failed"),
    ),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    if (!job.selectedTopics.some(
      (topic: SelectedTopic) => topic.topicId === args.topicId,
    )) throw new Error("SERP failure crossed a selected topic boundary");
    if (!job.serpAttemptedTopicIds.includes(args.topicId)) {
      throw new Error("SERP failure has no matching provider attempt");
    }
    if (
      job.serpFailures.some((failure) => failure.topicId === args.topicId) ||
      job.serpSnapshots.some(
        (snapshot: SerpSnapshot) => snapshot.topicId === args.topicId,
      )
    ) {
      return { recorded: false };
    }
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      serpFailures: [...job.serpFailures, {
        topicId: args.topicId,
        code: args.code,
        recordedAt: timestamp,
      }],
      providerCallsCompleted: job.providerCallsCompleted + 1,
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return { recorded: true };
  },
});

export const recordAuthoritySnapshot = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    domains: v.array(v.string()),
    providerCallMade: v.boolean(),
    evidence: v.array(v.object({
      domain: v.string(),
      domainRank: v.number(),
      referringDomains: v.optional(v.number()),
      source: v.string(),
      measuredAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    if (job.authoritySnapshotComplete === true) return { recorded: false };
    if (args.domains.length > 50 || args.evidence.length > 50) {
      throw new Error("Authority evidence exceeded the bounded domain ceiling");
    }
    if (
      !args.providerCallMade &&
      (args.domains.length > 0 || args.evidence.length > 0)
    ) throw new Error("Authority evidence requires a recorded provider call");
    const domainSet = new Set(args.domains);
    if (
      args.providerCallMade &&
      JSON.stringify(job.authorityDomains ?? null) !==
        JSON.stringify(args.domains)
    ) {
      throw new Error("Authority receipt does not match its initiated request");
    }
    const latestSerpObservedAt = Math.max(
      0,
      ...job.serpSnapshots.map(
        (snapshot: SerpSnapshot) => snapshot.observedAt,
      ),
    );
    if (args.evidence.some((item) =>
      !domainSet.has(item.domain) ||
      item.source !== DATAFORSEO_AUTHORITY_SOURCE ||
      item.domainRank < 0 ||
      item.domainRank > 100 ||
      item.measuredAt < latestSerpObservedAt
    )) throw new Error("Authority evidence is incompatible with its request");
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      authorityDomains: args.domains,
      authorityEvidence: args.evidence,
      authoritySnapshotComplete: true,
      providerCallsCompleted:
        job.providerCallsCompleted + (args.providerCallMade ? 1 : 0),
      leaseExpiresAt: timestamp + EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS,
      updatedAt: timestamp,
    });
    return { recorded: true };
  },
});

export const persistEvidence = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    if (job.authoritySnapshotComplete !== true) {
      throw new Error("Authority evidence is incomplete");
    }
    const tenantAuthority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    const timestamp = Date.now();
    if (!measuredAuthorityIsFresh(tenantAuthority, timestamp)) {
      throw new Error("Tenant authority expired before evidence persistence");
    }
    const authorityByDomain = new Map<string, AuthorityEvidence>(
      (job.authorityEvidence ?? []).map((item: AuthorityEvidence) => [
        item.domain,
        item,
      ]),
    );
    const authorityPlan = planSerpAuthorityCollection({
      tenantDomain: site.domain,
      topics: job.serpSnapshots.map((snapshot: SerpSnapshot) => ({
        topicId: String(snapshot.topicId),
        results: snapshot.results,
      })),
    });
    const candidatesByTopic = new Map(
      authorityPlan.topics.map((topic) => [topic.topicId, topic.candidates]),
    );
    const locationCode = dataForSeoLocationCode(site.targetCountry);
    const languageCode = dataForSeoLanguageCode(site.language);
    const businessSignals = tenantTopicBusinessSignals(site);
    let persistedTopics = 0;
    let insufficientTopics = 0;
    let skippedTopics =
      job.selectedTopics.length - job.serpSnapshots.length;
    for (const selected of job.selectedTopics as SelectedTopic[]) {
      const snapshot = (job.serpSnapshots as SerpSnapshot[]).find(
        (item: SerpSnapshot) => item.topicId === selected.topicId,
      );
      if (!snapshot) continue;
      const current = await currentSelectedTopic(ctx, site, selected);
      const topic = current?.topic;
      if (
        !topic ||
        topic.siteId !== args.siteId ||
        topic.primaryKeyword !== selected.keyword ||
        topic.searchVolume !== selected.searchVolume ||
        topic.updatedAt !== selected.topicUpdatedAt
      ) {
        skippedTopics += 1;
        continue;
      }
      if (expectedClickTargetKind(selected) === "planned_topic") {
        const otherPlannedCoverage = (job.serpSnapshots as SerpSnapshot[])
          .filter((candidate) => candidate.topicId !== snapshot.topicId)
          .flatMap((candidate) => {
            const other = (job.selectedTopics as SelectedTopic[]).find(
              (item) => item.topicId === candidate.topicId,
            );
            return other && expectedClickTargetKind(other) === "planned_topic"
              ? [{
                  primaryKeyword: other.keyword,
                  serpTopUrls: candidate.results.map((result) => result.url),
                }]
              : [];
          });
        if (
          snapshot.plannedValidationVersion !==
            PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION ||
          snapshot.plannedBusinessIntentAligned !== true ||
          snapshot.plannedAttainable !== true ||
          snapshot.plannedCannibalizationClear !== true ||
          !plannedSerpSnapshotMatchesCurrentLocale(site, snapshot, timestamp) ||
          !(await plannedTopicClearsCurrentCoverage(
            ctx,
            site._id,
            topic,
            snapshot.results.map((result) => result.url),
            otherPlannedCoverage,
          ))
        ) {
          skippedTopics += 1;
          continue;
        }
      }
      const fit = evaluateTopicBusinessFit({
        keyword: topic.primaryKeyword,
        label: topic.label,
        ...businessSignals,
      });
      if (
        !fit.eligible ||
        topic.businessFitEligible === false ||
        !hasCurrentExpectedClickDemand({
          evidence: topic,
          locationCode,
          languageCode,
          now: timestamp,
        })
      ) {
        skippedTopics += 1;
        continue;
      }
      const competitors = (
        candidatesByTopic.get(String(selected.topicId)) ?? []
      ).flatMap((candidate) => {
        const evidence = authorityByDomain.get(candidate.domain);
        return evidence
          ? [{
              position: candidate.position,
              url: candidate.url,
              domain: candidate.domain,
              domainRank: evidence.domainRank,
              referringDomains: evidence.referringDomains,
              source: evidence.source,
              measuredAt: evidence.measuredAt,
            }]
          : [];
      });
      const estimate = estimateTopicExpectedClicks({
        topic: {
          topicId: String(topic._id),
          keyword: topic.primaryKeyword,
          demand: {
            monthlySearches: topic.searchVolume!,
            source: topic.searchDemandSource!,
            measuredAt: topic.searchDemandMeasuredAt!,
          },
          serpCompetitors: competitors,
        },
        tenantAuthority,
        now: timestamp,
      });
      await ctx.db.patch(topic._id, {
        serpTopUrls: snapshot.results.map((result) => result.url),
        serpObservedAt: snapshot.observedAt,
        serpLocationCode: snapshot.locationCode ?? locationCode,
        serpLanguageCode: snapshot.languageCode ?? languageCode,
        serpAuthorityCompetitors: competitors,
        expectedClicksMonthly: estimate.expectedClicksMonthly,
        expectedClickProjectedPosition: estimate.projectedPosition ?? undefined,
        expectedClickRankProbability: estimate.rankProbability,
        expectedClickStatus: estimate.status,
        expectedClickReasons: estimate.reasons,
        expectedClickAuditVersion: EXPECTED_CLICK_PORTFOLIO_VERSION,
        expectedClickAuditedAt: timestamp,
        expectedClickBackfillVersion:
          EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
        expectedClickBackfillJobId: args.jobId,
        expectedClickBackfilledAt: timestamp,
        businessFitEligible: true,
        businessFitScore: fit.score,
        businessFitVersion: fit.version,
        businessFitReasons: fit.reasons,
        businessFitCheckedAt: timestamp,
        updatedAt: timestamp,
      });
      persistedTopics += 1;
      if (estimate.status !== "eligible") insufficientTopics += 1;
    }
    await ctx.db.patch(args.jobId, {
      status: "completed",
      persistedTopics,
      insufficientTopics,
      skippedTopics,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      errorCode: undefined,
      cadenceFollowupScheduledAt: timestamp,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    // The evidence receipt is now durable and provider work is finished. Wake
    // the tenant immediately so a newly scheduler-ready topic can fill the
    // sealed buffer without waiting for the coarse fleet cron. Convex commits
    // this schedule atomically with the one completed-job receipt, so retries
    // cannot replay SERPs or emit a second continuation.
    await ctx.scheduler.runAfter(
      0,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId: args.siteId,
        trigger: "expected_click_evidence_ready",
        reason: persistedTopics > 0
          ? `evidence_persisted_${persistedTopics}`
          : "evidence_completed_without_scheduler_ready_topic",
      },
    );
    return { persistedTopics, insufficientTopics, skippedTopics };
  },
});

export const markPartial = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "partial",
      errorCode: args.errorCode.slice(0, 80),
      workerToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    return {
      partial: true,
      providerCallsAttempted: job.providerCallsAttempted,
      providerCallsCompleted: job.providerCallsCompleted,
    };
  },
});

export const abortForProviderBalance = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    workerToken: v.string(),
    releaseReason: v.string(),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    if (job.providerCallsAttempted !== 0) {
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
      purpose: "expected_click_evidence_backfill",
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
    jobId: v.id("expected_click_evidence_jobs"),
    policyVersion: v.number(),
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
    const timestamp = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "pending",
      errorCode: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(0, workerApi.processExpectedClickEvidenceBackfill, {
      siteId: args.siteId,
      jobId: args.jobId,
      policyVersion: args.policyVersion,
    });
    return { scheduled: true as const };
  },
});
