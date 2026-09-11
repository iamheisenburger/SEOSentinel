import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  plannedTopicDemandAdmission, plannedTopicEvidenceAdmission, plannedTopicSiteGate,
  type PlannedTopicSiteGate,
} from "./lib/plannedTopicEvidenceRecovery";
import {
  evaluateTopicBusinessFit, tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import {
  articleMatchesCurrentDomain, topicMatchesCurrentDomain, siteCanonicalDomain,
  siteCanonicalDomainRevision, normalizeCanonicalDomain,
} from "./lib/siteDomainBinding";
import {
  DATAFORSEO_AUTHORITY_SOURCE, DATAFORSEO_DEMAND_SOURCE, DEFAULT_EVIDENCE_MAX_AGE_MS,
  measuredAuthorityIsFresh, tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
import { dataForSeoLanguageCode, dataForSeoLocationCode } from "./lib/dataForSeoLocale";
import { hasCurrentExactDemand, hasCurrentVersionAttempt } from "./expectedClickDemandBackfill";
import { hasAnyExactEvidenceAttempt } from "./expectedClickEvidenceBackfill";
import { hasCurrentExpectedClickDemand, needsExpectedClickEvidenceBackfill } from "./lib/expectedClickEvidenceBackfill";
import { sha256Hex } from "./lib/publicationArtifact";
import { articleReservesTopicIntent } from "./lib/topicLifecycle";

export const DIAGNOSTIC_TOPIC_LIMIT = 8;
export const DIAGNOSTIC_INVENTORY_LIMIT = 512;
export const DIAGNOSTIC_ACTIVE_JOB_LIMIT = 50;

function sourceCode(source: string | undefined) {
  return source === undefined ? "missing" : source === DATAFORSEO_AUTHORITY_SOURCE ||
    source === DATAFORSEO_DEMAND_SOURCE ? source : "unrecognized";
}

/** Read-only support surface. It deliberately cannot authorize queueing: a
 * phase that passes these predicates still needs ordinary coverage, ordering,
 * daily/source-policy no-replay and atomic funding admission. No fingerprint
 * usable as an operator recovery capability is returned. */
export const inspectAdmission = internalQuery({
  args: { siteId: v.id("sites"), topicIds: v.array(v.id("topic_clusters")) },
  handler: async (ctx, { siteId, topicIds }) => {
    if (topicIds.length < 1 || topicIds.length > DIAGNOSTIC_TOPIC_LIMIT ||
      new Set(topicIds).size !== topicIds.length) {
      throw new Error("diagnostic_topic_bound");
    }
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("diagnostic_site_unavailable");
    // Resolve identifiers through an exact tenant index, never db.get of an
    // untrusted topic ID. A foreign ID cannot read another tenant's document.
    const topics = await ctx.db.query("topic_clusters")
      .withIndex("by_site", q => q.eq("siteId", siteId))
      .take(DIAGNOSTIC_INVENTORY_LIMIT + 1);
    if (topics.length > DIAGNOSTIC_INVENTORY_LIMIT) {
      return { complete: false as const, reason: "topic_inventory_incomplete" };
    }
    const selected = topicIds.map(id => topics.find(t => t._id === id));
    if (selected.some(t => !t || t.siteId !== siteId)) {
      throw new Error("diagnostic_topic_scope_mismatch");
    }
    const timestamp = Date.now();
    const [summaries, activeGroups, migration, gate] = await Promise.all([
      ctx.db.query("article_summaries").withIndex("by_site", q => q.eq("siteId", siteId))
        .take(DIAGNOSTIC_INVENTORY_LIMIT + 1),
      Promise.all(["pending", "running"].map(status => ctx.db.query("jobs")
        .withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", status))
        .take(DIAGNOSTIC_ACTIVE_JOB_LIMIT + 1))),
      ctx.db.query("maintenance_state").withIndex("by_key", q =>
        q.eq("key", "publication-integrity-v4")).first(),
      plannedTopicSiteGate(ctx, site, timestamp),
    ]);
    if (summaries.length > DIAGNOSTIC_INVENTORY_LIMIT ||
      activeGroups.some(rows => rows.length > DIAGNOSTIC_ACTIVE_JOB_LIMIT) ||
      migration?.status !== "completed") {
      return { complete: false as const, reason: "article_job_inventory_incomplete" };
    }
    const authority = tenantAuthorityFromStoredEvidence({ domain: site.seoAuthorityDomain,
      currentDomain: site.domain, domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains, source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt });
    const authorityFresh = measuredAuthorityIsFresh(authority, timestamp);
    const currentArticles = summaries.filter(a => articleMatchesCurrentDomain(site, a));
    const active = activeGroups.flat().filter(j => j.type === "article");
    const locationCode = dataForSeoLocationCode(site.targetCountry);
    const languageCode = dataForSeoLanguageCode(site.language);
    const siteReason = (g: PlannedTopicSiteGate) => g.allowed ? undefined : g.reason;
    return {
      complete: true as const, observedAt: timestamp, siteId,
      canonicalDomain: siteCanonicalDomain(site), domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0, siteGate: gate,
      tenantAuthority: { fresh: authorityFresh, source: sourceCode(site.seoAuthoritySource),
        measuredAt: site.seoAuthorityMeasuredAt, expiresAt: site.seoAuthorityMeasuredAt === undefined
          ? undefined : site.seoAuthorityMeasuredAt + DEFAULT_EVIDENCE_MAX_AGE_MS,
        domainMatches: normalizeCanonicalDomain(site.seoAuthorityDomain ?? "") === siteCanonicalDomain(site),
        domainRank: site.seoAuthorityDomainRank },
      currentLocale: { locationCode, languageCode },
      readBounds: { topics: topics.length, summaries: summaries.length,
        activeJobs: activeGroups.flat().length, topicLimit: DIAGNOSTIC_TOPIC_LIMIT,
        inventoryLimit: DIAGNOSTIC_INVENTORY_LIMIT, perStatusJobLimit: DIAGNOSTIC_ACTIVE_JOB_LIMIT },
      topics: selected.map(maybeTopic => {
        const topic = maybeTopic!;
        const linked = currentArticles.filter(a => a.topicId === topic._id);
        const jobs = active.filter(j => j.payload && typeof j.payload === "object" &&
          (j.payload as Record<string, unknown>).topicId === topic._id);
        const args = { site, topic, hasLinkedArticle: linked.length > 0, hasActiveArticleJob: jobs.length > 0 };
        const demandAdmission = plannedTopicDemandAdmission(args);
        const currentDemand = hasCurrentExactDemand(topic, locationCode, languageCode, timestamp);
        const currentPositiveDemand = hasCurrentExpectedClickDemand({ evidence: topic, locationCode,
          languageCode, now: timestamp }) && (topic.searchVolume ?? 0) > 0;
        const evidenceAdmission = plannedTopicEvidenceAdmission({ ...args, hasCurrentPositiveDemand: currentPositiveDemand, timestamp });
        const fit = evaluateTopicBusinessFit({ keyword: topic.primaryKeyword, label: topic.label,
          ...tenantTopicBusinessSignals(site) });
        const domainCurrent = topicMatchesCurrentDomain(site, topic);
        const artifactRoute = linked.some(articleReservesTopicIntent);
        // This is the actual planned branch's first-predicate order. Report
        // coverage/batch as uninspected, never call predicate passage selected.
        const demandFirstRule = !domainCurrent ? "topic_domain_stale" : artifactRoute ? "artifact_route_not_planned_recovery" : siteReason(gate) ??
          (!authorityFresh ? "tenant_authority_unavailable" :
            !demandAdmission.eligible ? demandAdmission.reason : currentDemand ? "demand_already_current" :
              hasCurrentVersionAttempt(topic) ? "exact_demand_already_attempted" : "requires_ordinary_selection");
        const evidenceFirstRule = !domainCurrent ? "topic_domain_stale" : artifactRoute ? "artifact_route_not_planned_recovery" : siteReason(gate) ??
          (!evidenceAdmission.eligible ? evidenceAdmission.reason :
            !needsExpectedClickEvidenceBackfill(topic, timestamp) ? "evidence_already_current" :
              hasAnyExactEvidenceAttempt(topic) ? "exact_evidence_already_attempted" : "requires_ordinary_selection");
        return {
          topicId: topic._id, keyword: topic.primaryKeyword.slice(0, 160),
          status: ["planned", "plan_checkpoint", "used", "cannibalizing", "disqualified"].includes(topic.status ?? "")
            ? topic.status : "unclassified", domainCurrent,
          demand: { admission: { eligible: demandAdmission.eligible, reason: demandAdmission.reason }, firstRule: demandFirstRule },
          evidence: { admission: { eligible: evidenceAdmission.eligible, reason: evidenceAdmission.reason }, firstRule: evidenceFirstRule },
          selectionInspected: false,
          linkedArticles: linked.slice(0, 8).map(a => ({ articleId: a.articleId,
            status: ["draft", "review", "ready", "rejected", "published"].includes(a.status) ? a.status : "unclassified" })),
          linkedArticleCount: linked.length,
          activeArticleJobs: jobs.slice(0, 8).map(j => ({ jobId: j._id, status: j.status })),
          activeArticleJobCount: jobs.length,
          fit: { storedEligible: topic.businessFitEligible, storedScore: topic.businessFitScore,
            storedVersion: topic.businessFitVersion, disqualified: Boolean(topic.disqualifiedReason),
            currentEligible: fit.eligible, currentScore: fit.score, currentVersion: fit.version,
            scoreMatches: topic.businessFitScore === fit.score, versionMatches: topic.businessFitVersion === fit.version,
            reasonsMatch: JSON.stringify(topic.businessFitReasons ?? []) === JSON.stringify(fit.reasons),
            storedReasonsHash: sha256Hex(JSON.stringify(topic.businessFitReasons ?? [])),
            currentReasonsHash: sha256Hex(JSON.stringify(fit.reasons)) },
          demandProvenance: { current: currentDemand, currentPositive: currentPositiveDemand,
            searchVolume: topic.searchVolume, source: sourceCode(topic.searchDemandSource),
            measuredAt: topic.searchDemandMeasuredAt, locationCode: topic.searchDemandLocationCode,
            languageMatches: topic.searchDemandLanguageCode?.trim().toLowerCase() === languageCode,
            keywordDifficulty: topic.keywordDifficulty, keywordDifficultyMeasured: topic.keywordDifficultyMeasured },
          serpProvenance: { resultCount: topic.serpTopUrls?.length ?? 0, observedAt: topic.serpObservedAt,
            locationCode: topic.serpLocationCode, languageMatches: topic.serpLanguageCode?.trim().toLowerCase() === languageCode,
            authorityCount: topic.serpAuthorityCompetitors?.length ?? 0,
            authority: (topic.serpAuthorityCompetitors ?? []).slice(0, 10).map(a => ({ position: a.position,
              domainHash: sha256Hex(a.domain), source: sourceCode(a.source), measuredAt: a.measuredAt,
              domainRank: a.domainRank, fresh: measuredAuthorityIsFresh(a, timestamp) })) },
          attempts: { demandCurrentExact: hasCurrentVersionAttempt(topic),
            demandVersion: topic.searchDemandBackfillAttemptVersion, demandAt: topic.searchDemandBackfillAttemptedAt,
            evidenceCurrentExact: hasAnyExactEvidenceAttempt(topic), evidenceVersion: topic.expectedClickEvidenceAttemptVersion,
            evidenceAt: topic.expectedClickEvidenceAttemptedAt,
            checkpointVersion: topic.planCheckpointVersion, checkpointJobId: topic.planCheckpointJobId,
            checkpointId: topic.planCheckpointId, checkpointSerpAttemptedAt: topic.planCheckpointSerpAttemptedAt,
            checkpointSerpReceiptPresent: topic.planCheckpointSerpReceipt !== undefined,
            checkpointTerminal: Boolean(topic.planCheckpointTerminalFailureCode),
            microSeedJobId: topic.cadenceMicroSeedJobId, microSeedVersion: topic.cadenceMicroSeedVersion,
            microSeedAnchorEligible: topic.cadenceMicroSeedAnchorEligible },
        };
      }),
    };
  },
});
