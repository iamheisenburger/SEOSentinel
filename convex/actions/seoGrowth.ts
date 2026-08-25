"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  addSearchConsoleDays,
  isSameSearchConsolePage,
  publishedArticlePageUrl,
  searchConsoleDate,
} from "../lib/searchPerformance";
import {
  classifySeoGrowth,
  type SeoGrowthClassification,
  type SeoWindow,
} from "../lib/seoGrowth";
import {
  isCompleteGscDateRange,
  type GscDateEpochReceipt,
} from "../lib/gscSearchAnalytics";
import { selectPreparedPublishedRevision } from "../lib/publishedRevision";

const COHORT_WINDOWS = [7, 14, 28, 56] as const;

type GrowthInput = {
  site: {
    siteId: Id<"sites">;
    domain: string;
    urlStructure?: string;
    canonicalDomain: string;
    domainRevision: number;
    gscConnectionRevision: number;
    gscProperty: string;
    gscSyncEpoch?: string;
  };
  dataWindowStart?: string;
  dataThrough?: string;
  dateEpochs: GscDateEpochReceipt[];
  rows: Doc<"search_page_daily">[];
  articles: Array<{
    articleId: Id<"articles">;
    topicId?: Id<"topic_clusters">;
    title: string;
    slug: string;
    publishedAt: number;
    gscIndexVerdict?: string;
    gscCoverageState?: string;
    gscPageFetchState?: string;
    gscRobotsTxtState?: string;
    gscInspectionError?: string;
  }>;
  monthlyOrganicClicksGoal: number;
};

type GrowthScanResult = {
  articlesEvaluated: number;
  openActions: number;
  stageCounts: {
    awaitingData: number;
    indexingPending: number;
    indexingStalled: number;
    noVisibility: number;
    lowVisibility: number;
    strikingDistance: number;
    lowCtr: number;
    performing: number;
  };
  replenishment?: {
    status: string;
    detail: string;
  };
  discoveryRepair?: {
    status: string;
    detail: string;
  };
  authority?: {
    status: string;
    detail: string;
  };
  revision?: {
    status: string;
    detail: string;
  };
};

async function growthActuationStillEligible(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  fingerprint: string,
  measurementKey: string,
): Promise<boolean> {
  return ctx.runQuery(internal.seoGrowth.getActionAttemptEligibilityInternal, {
    siteId,
    fingerprint,
    measurementKey,
  });
}

export const scanAllSites = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<{
    scheduled: number;
    scheduledNext: boolean;
  }> => {
    const page = await ctx.runQuery(internal.sites.listGrowthPage, { cursor });
    let scheduled = 0;
    for (const site of page.page) {
      if (!site.gscConnected) continue;
      await ctx.scheduler.runAfter(
        scheduled * 250,
        internal.actions.seoGrowth.scanSite,
        { siteId: site.siteId },
      );
      scheduled++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        Math.max(1_000, scheduled * 250),
        internal.actions.seoGrowth.scanAllSites,
        { cursor: page.continueCursor },
      );
    }
    return { scheduled, scheduledNext: !page.isDone };
  },
});

export const scanSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<GrowthScanResult> => {
    const input: GrowthInput = await ctx.runQuery(
      internal.seoGrowth.getSiteInputs,
      { siteId },
    );
    const classifications: SeoGrowthClassification[] = input.articles.map((article) => {
      const startDate = searchConsoleDate(article.publishedAt);
      const pageUrl = publishedArticlePageUrl(
        input.site.domain,
        input.site.urlStructure,
        article.slug,
      );
      const pageRows = input.rows.filter((row) =>
        !!row.page && isSameSearchConsolePage(row.page, pageUrl)
      );
      const windows: SeoWindow[] = COHORT_WINDOWS.map((days) => {
        const expectedEndDate = addSearchConsoleDays(startDate, days - 1);
        const rows = pageRows.filter(
          (row) => row.date >= startDate && row.date <= expectedEndDate,
        );
        const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
        const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
        const nonBrandedClicks = rows.reduce(
          (sum, row) => sum + row.nonBrandedClicks,
          0,
        );
        const nonBrandedImpressions = rows.reduce(
          (sum, row) => sum + row.nonBrandedImpressions,
          0,
        );
        const unattributedClicks = rows.reduce(
          (sum, row) => sum + (row.unattributedClicks ?? 0),
          0,
        );
        const unattributedImpressions = rows.reduce(
          (sum, row) => sum + (row.unattributedImpressions ?? 0),
          0,
        );
        const position = impressions > 0
          ? rows.reduce((sum, row) => sum + row.weightedPosition, 0) /
            impressions
          : null;
        const nonBrandedPosition = nonBrandedImpressions > 0
          ? rows.reduce(
            (sum, row) => sum + row.nonBrandedWeightedPosition,
            0,
          ) / nonBrandedImpressions
          : null;
        const queryCoverageComplete = impressions === 0 || (
          rows.length > 0 &&
          rows.every((row) => row.queryCoverageComplete === true)
        );
        return {
          days,
          complete: isCompleteGscDateRange(
            input.dateEpochs,
            startDate,
            expectedEndDate,
          ),
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: position === null ? null : Math.round(position * 10) / 10,
          nonBrandedClicks,
          nonBrandedImpressions,
          nonBrandedCtr: nonBrandedImpressions > 0
            ? nonBrandedClicks / nonBrandedImpressions
            : 0,
          nonBrandedPosition: nonBrandedPosition === null
            ? null
            : Math.round(nonBrandedPosition * 10) / 10,
          unattributedClicks,
          unattributedImpressions,
          queryCoverageComplete,
        };
      });
      return classifySeoGrowth({
        articleId: article.articleId,
        startDate,
        dataThrough: input.dataThrough,
        indexInspection: {
          verdict: article.gscIndexVerdict,
          coverageState: article.gscCoverageState,
          pageFetchState: article.gscPageFetchState,
          robotsTxtState: article.gscRobotsTxtState,
          error: article.gscInspectionError,
        },
        windows,
      });
    });

    const windowStart = input.dataThrough
      ? addSearchConsoleDays(input.dataThrough, -27)
      : undefined;
    const rollingWindowComplete = Boolean(
      windowStart &&
      input.dataThrough &&
      isCompleteGscDateRange(
        input.dateEpochs,
        windowStart,
        input.dataThrough,
      ),
    );
    const rollingRows = windowStart
      ? input.rows.filter(
        (row) => row.date >= windowStart && row.date <= input.dataThrough!,
      )
      : [];
    const totalClicks = rollingRows.reduce((sum, row) => sum + row.clicks, 0);
    const totalImpressions = rollingRows.reduce(
      (sum, row) => sum + row.impressions,
      0,
    );
    const nonBrandedClicks = rollingRows.reduce(
      (sum, row) => sum + row.nonBrandedClicks,
      0,
    );
    const nonBrandedImpressions = rollingRows.reduce(
      (sum, row) => sum + row.nonBrandedImpressions,
      0,
    );
    const averagePosition = totalImpressions > 0
      ? Math.round((rollingRows.reduce(
        (sum, row) => sum + row.weightedPosition,
        0,
      ) / totalImpressions) * 10) / 10
      : 0;
    const reconciliation = await ctx.runMutation(
      internal.seoGrowth.reconcileSite,
      {
      siteId,
      expectedCanonicalDomain: input.site.canonicalDomain,
      expectedDomainRevision: input.site.domainRevision,
      expectedGscConnectionRevision: input.site.gscConnectionRevision,
      expectedGscProperty: input.site.gscProperty,
      expectedGscSyncEpoch: input.site.gscSyncEpoch,
      expectedGscDataThrough: input.dataThrough,
      classifications: classifications.map((classification) => ({
        ...classification,
        articleId: classification.articleId as Id<"articles">,
      })),
      health: {
        dataThrough: input.dataThrough,
        windowStart,
        windowDays: 28,
        dataDays: rollingWindowComplete ? 28 : 0,
        organicClicks: totalClicks,
        organicImpressions: totalImpressions,
        nonBrandedClicks,
        nonBrandedImpressions,
        averagePosition,
        monthlyOrganicClicksGoal: input.monthlyOrganicClicksGoal,
      },
      },
    );

    // A growth scan may request many remediations, but planning is deliberately
    // serialized and capped at one measured recovery plan per tenant per day.
    // This prevents a bad cohort from multiplying DataForSEO and model spend.
    const request = [...reconciliation.replenishmentRequests]
      .sort((a, b) => b.priority - a.priority)[0];
    let replenishment: GrowthScanResult["replenishment"];
    if (
      request &&
      await growthActuationStillEligible(
        ctx,
        siteId,
        request.fingerprint,
        request.measurementKey,
      )
    ) {
      const queued = await ctx.runMutation(internal.jobs.queuePlanIfAbsent, {
        siteId,
        reason: "seo_growth_support_replenishment",
        since: Date.now() - 24 * 60 * 60 * 1000,
        maximumRecent: 1,
        growthParentArticleId: request.articleId,
        growthSeed: request.growthSeed,
        growthActionFingerprint: request.fingerprint,
        growthMeasurementKey: request.measurementKey,
      });
      const status = queued.queued
        ? "queued_growth_plan"
        : queued.reason === "autopilot_disabled"
          ? "not_applicable"
          : "bounded_wait";
      const detail = queued.queued
        ? "Queued one bounded, measured support-topic plan for the highest-priority page."
        : queued.reason === "recent_limit"
          ? "A growth support plan has already been attempted for this tenant in the last 24 hours."
          : queued.reason === "active"
            ? "Another topic plan is already active for this tenant; the growth request will retry on the next scan."
            : "Autopilot is not eligible to execute this growth request.";
      await ctx.runMutation(internal.seoGrowth.recordAutomationResult, {
        siteId,
        fingerprint: request.fingerprint,
        measurementKey: request.measurementKey,
        status,
        detail,
      });
      if (queued.queued) {
        await ctx.runMutation(internal.autopilot.dispatchSiteFollowup, {
          siteId,
          trigger: "seo_growth_support",
          reason: "measured_growth_action",
        });
      }
      replenishment = { status, detail };
    }

    const discoveryRequest = [...reconciliation.discoveryRepairRequests]
      .sort((a, b) => b.priority - a.priority)[0];
    let discoveryRepair: GrowthScanResult["discoveryRepair"];
    if (
      discoveryRequest &&
      await growthActuationStillEligible(
        ctx,
        siteId,
        discoveryRequest.fingerprint,
        discoveryRequest.measurementKey,
      )
    ) {
      const attemptedAt = Date.now();
      try {
        const result = await ctx.runAction(
          internal.actions.gscSync.submitSitemapInternal,
          {
            siteId,
            expectedCanonicalDomain: input.site.canonicalDomain,
            expectedDomainRevision: input.site.domainRevision,
            expectedConnectionRevision: input.site.gscConnectionRevision,
            expectedProperty: input.site.gscProperty,
          },
        );
        const detail = result.isPending
          ? "Search Console accepted and exactly verified the tenant sitemap; Google reports processing is pending."
          : `Search Console accepted and exactly verified the tenant sitemap with ${result.errors ?? 0} error(s) and ${result.warnings ?? 0} warning(s).`;
        await ctx.runMutation(internal.seoGrowth.recordDiscoveryRepair, {
          siteId,
          fingerprint: discoveryRequest.fingerprint,
          measurementKey: discoveryRequest.measurementKey,
          status: "discovery_repair_verified",
          detail,
          attemptedAt,
          verifiedAt: result.verifiedAt,
          sitemapUrl: result.sitemapUrl,
        });
        discoveryRepair = { status: "discovery_repair_verified", detail };
      } catch {
        const detail =
          "Search Console did not confirm the tenant sitemap submission; the action remains fail-closed and will retry on the next measured scan.";
        await ctx.runMutation(internal.seoGrowth.recordDiscoveryRepair, {
          siteId,
          fingerprint: discoveryRequest.fingerprint,
          measurementKey: discoveryRequest.measurementKey,
          status: "discovery_repair_failed",
          detail,
          attemptedAt,
        });
        discoveryRepair = { status: "discovery_repair_failed", detail };
      }
    }

    // Authority work is evidence-first and capped to one measured page per
    // tenant per weekly cycle. Discovery can prepare reviewable drafts, but it
    // never sends a message or counts a backlink without the later receipts.
    const authorityRequest = [...reconciliation.authorityRequests]
      .sort((a, b) => b.priority - a.priority)[0];
    let authority: GrowthScanResult["authority"];
    if (
      authorityRequest &&
      await growthActuationStillEligible(
        ctx,
        siteId,
        authorityRequest.fingerprint,
        authorityRequest.measurementKey,
      )
    ) {
      const attemptedAt = Date.now();
      try {
        const discovery = await ctx.runAction(
          internal.actions.backlinks.analyzeBacklinksInternal,
          {
            siteId,
            articleId: authorityRequest.articleId,
            growthActionFingerprint: authorityRequest.fingerprint,
            growthMeasurementKey: authorityRequest.measurementKey,
          },
        );
        const verified = discovery.mentions.length + discovery.brokenLinks.length;
        const applicableDiscoveryStages = [
          discovery.stages.mentionsApplicable
            ? discovery.stages.mentionsComplete
            : undefined,
          discovery.stages.brokenLinksApplicable
            ? discovery.stages.brokenLinksComplete
            : undefined,
        ].filter((value): value is boolean => value !== undefined);
        const fullDiscovery =
          applicableDiscoveryStages.length > 0 &&
          applicableDiscoveryStages.every(Boolean);
        const partialDiscovery =
          applicableDiscoveryStages.some(Boolean) && !fullDiscovery;
        let prepared = 0;
        let blocked = 0;
        if (
          verified > 0 &&
          await growthActuationStillEligible(
            ctx,
            siteId,
            authorityRequest.fingerprint,
            authorityRequest.measurementKey,
          )
        ) {
          const drafts = await ctx.runAction(
            internal.actions.outreach.prepareOutreachInternal,
            { siteId, limit: Math.min(verified, 25) },
          );
          prepared = drafts.drafted;
          blocked = drafts.blocked;
        }
        const status = prepared > 0
          ? "authority_outreach_prepared"
          : verified > 0
            ? "authority_verified_waiting_readiness"
            : fullDiscovery
              ? "authority_no_safe_candidate"
              : partialDiscovery
                ? "authority_discovery_partial"
                : "authority_discovery_unavailable";
        const detail = prepared > 0
          ? `Verified ${verified} authority opportunity(s) and prepared ${prepared} tenant-scoped draft(s) for review.`
          : verified > 0
            ? `Verified ${verified} authority opportunity(s); ${blocked} draft(s) remain blocked by contact or inbox readiness.`
            : fullDiscovery
              ? "A bounded evidence scan found no safe authority opportunity for this page."
              : partialDiscovery
                ? "One authority-discovery stage completed without a safe candidate, but another applicable stage failed; Pentra will retry without claiming a verified no-candidate result."
                : "Authority discovery is unavailable or this tenant is not eligible for automated growth work.";
        await ctx.runMutation(internal.seoGrowth.recordAuthorityDiscovery, {
          siteId,
          fingerprint: authorityRequest.fingerprint,
          measurementKey: authorityRequest.measurementKey,
          status,
          detail,
          attemptedAt,
          verifiedAt: verified > 0 || fullDiscovery ? Date.now() : undefined,
        });
        authority = { status, detail };
      } catch {
        const status = "authority_discovery_failed";
        const detail =
          "Authority discovery failed without sending outreach; the page remains queued for a bounded retry.";
        await ctx.runMutation(internal.seoGrowth.recordAuthorityDiscovery, {
          siteId,
          fingerprint: authorityRequest.fingerprint,
          measurementKey: authorityRequest.measurementKey,
          status,
          detail,
          attemptedAt,
        });
        authority = { status, detail };
      }
    }

    // A scan executes at most one deterministic published revision for this
    // tenant. The revision action performs its own current rollout, tenant,
    // immutable-base, external CAS, and live-page checks before it can mark
    // the measured growth action executed.
    const revisionRequests = [...reconciliation.revisionRequests]
      .sort((a, b) =>
        b.priority - a.priority || a.fingerprint.localeCompare(b.fingerprint)
      );
    let revision: GrowthScanResult["revision"];
    if (revisionRequests.length > 0) {
      const selection = await selectPreparedPublishedRevision({
        requests: revisionRequests,
        prepare: async (request) => {
          if (!await growthActuationStillEligible(
            ctx,
            siteId,
            request.fingerprint,
            request.measurementKey,
          )) {
            return {
              status: "bounded_wait" as const,
              detail: "The measured growth attempt was superseded before revision preparation.",
            };
          }
          let prepared = await ctx.runMutation(
            internal.publishedRevisions.prepareForGrowthAction,
            {
              siteId,
              articleId: request.articleId,
              fingerprint: request.fingerprint,
              measurementKey: request.measurementKey,
              actionKind: request.actionKind,
            },
          );
          if (prepared.repair === "legacy_github_receipt_adoption") {
            const adoption = await ctx.runAction(
              internal.publisher.adoptLegacyGitHubPublicationReceiptInternal,
              { siteId, articleId: request.articleId },
            );
            if (adoption.status === "verified") {
              prepared = await ctx.runMutation(
                internal.publishedRevisions.prepareForGrowthAction,
                {
                  siteId,
                  articleId: request.articleId,
                  fingerprint: request.fingerprint,
                  measurementKey: request.measurementKey,
                  actionKind: request.actionKind,
                },
              );
            } else {
              prepared = {
                status: "no_safe_candidate",
                detail: adoption.detail,
              };
            }
          }
          return prepared;
        },
        onSkipped: async (request, outcome) => {
          const status = outcome.status === "bounded_wait"
            ? "bounded_wait"
            : "no_safe_candidate";
          await ctx.runMutation(internal.seoGrowth.recordAutomationResult, {
            siteId,
            fingerprint: request.fingerprint,
            measurementKey: request.measurementKey,
            status,
            detail: outcome.detail,
          });
          revision = { status, detail: outcome.detail };
        },
      });
      if (selection.selected) {
        const { request: revisionRequest, prepared } = selection.selected;
        if (!await growthActuationStillEligible(
          ctx,
          siteId,
          revisionRequest.fingerprint,
          revisionRequest.measurementKey,
        )) {
          const status = "bounded_wait";
          const detail =
            "The tenant rollout changed after revision preparation; no external write was attempted.";
          await ctx.runMutation(internal.seoGrowth.recordAutomationResult, {
            siteId,
            fingerprint: revisionRequest.fingerprint,
            measurementKey: revisionRequest.measurementKey,
            status,
            detail,
          });
          revision = { status, detail };
        } else {
          try {
            const executed = await ctx.runAction(
              internal.publisher.executePublishedRevisionInternal,
              { revisionId: prepared.revisionId },
            );
            const status = executed.status === "verified"
              ? "executed"
              : "revision_verification_pending";
            const detail = executed.status === "verified"
              ? "The exact deterministic revision was already verified live."
              : "The destination acknowledged the exact external CAS; Pentra is verifying the revised live URL before counting success.";
            // A new delivery atomically records revision_verification_pending
            // with its exact receipt. Do not write that older state here: the
            // zero-delay verifier may already have promoted the action to
            // executed. Only the idempotent, already-live path needs this call.
            if (executed.status === "verified") {
              await ctx.runMutation(internal.seoGrowth.recordAutomationResult, {
                siteId,
                fingerprint: revisionRequest.fingerprint,
                measurementKey: revisionRequest.measurementKey,
                status,
                detail,
              });
            }
            revision = { status, detail };
          } catch {
            const state = await ctx.runQuery(
              internal.publishedRevisions.getReceiptInternal,
              { revisionId: prepared.revisionId },
            );
            const status = state?.status === "verification_pending"
              ? "revision_verification_pending"
              : state?.status === "unverified"
                ? "revision_unverified"
                : "revision_failed";
            const detail = status === "revision_verification_pending"
              ? "The exact external receipt is preserved and live verification remains pending; Pentra will not repeat the external write."
              : status === "revision_unverified"
                ? "The external delivery outcome is ambiguous. Pentra will reconcile only by exact idempotency key and bytes; it will not blind-write."
                : "The deterministic revision failed a tenant, destination, quality, or external-drift precondition and was not counted as executed.";
            revision = { status, detail };
          }
        }
      }
    }

    return {
      articlesEvaluated: reconciliation.articlesEvaluated,
      openActions: reconciliation.openActions,
      stageCounts: reconciliation.stageCounts,
      replenishment,
      discoveryRepair,
      authority,
      revision,
    };
  },
});
