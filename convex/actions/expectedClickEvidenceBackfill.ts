"use node";

import { randomUUID } from "node:crypto";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  assertDataForSeoAccountBalance,
  isDataForSeoBalancePreflightError,
} from "../lib/dataForSeoAccountBalance";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  consumeExpectedClickBackfillAuthorityCall,
  consumeExpectedClickBackfillSerpCall,
  createExpectedClickBackfillRuntime,
  expectedClickBackfillRemainingCostMicroUsd,
} from "../lib/expectedClickEvidenceBackfill";
import {
  planSerpAuthorityCollection,
} from "../lib/expectedClickPortfolio";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "../lib/dataForSeoLocale";
import {
  analyzeSERPFromDataForSEO,
  getDomainAuthorities,
} from "./seoData";

const api = internal.expectedClickEvidenceBackfill;
const fleetOrigin = "autonomous_fleet" as const;

function stableFailureCode(error: unknown): string {
  if (isDataForSeoBalancePreflightError(error)) {
    return error.code === "insufficient_balance"
      ? "provider_balance_insufficient"
      : "provider_balance_preflight_unavailable";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/http\s*429/.test(message)) return "provider_rate_limited";
  if (/http\s*5\d\d/.test(message)) return "provider_unavailable";
  if (/timed?\s*out|timeout|deadline_exhausted/.test(message)) {
    return "provider_timeout";
  }
  if (/credentials not configured/.test(message)) {
    return "provider_credentials_missing";
  }
  if (/authority_attempt_ambiguous/.test(message)) {
    return "authority_attempt_ambiguous";
  }
  if (/authorization is stale|site not found|worker lease/.test(message)) {
    return "tenant_fence_changed";
  }
  if (/provider call ceiling/.test(message)) return "provider_call_ceiling";
  return "provider_execution_failed";
}

function releaseReasonFor(error: unknown):
  | "provider_balance_insufficient"
  | "provider_balance_preflight_unavailable"
  | null {
  if (!isDataForSeoBalancePreflightError(error)) return null;
  return error.code === "insufficient_balance"
    ? "provider_balance_insufficient"
    : "provider_balance_preflight_unavailable";
}

/**
 * Operator-only canary entry point. The free provider wallet check happens
 * before the atomic reservation/job mutation; the worker repeats a remaining-
 * envelope check immediately before any paid call.
 */
export const queueExpectedClickEvidenceBackfill = internalAction({
  args: {
    siteId: v.id("sites"),
    policyVersion: v.number(),
    plannedRecoveryGuard: v.optional(v.object({
      inspectionDay: v.string(),
      rolloutEpoch: v.number(),
      inspectionKey: v.string(),
      selected: v.array(v.object({
        topicId: v.id("topic_clusters"),
        keyword: v.string(),
        fingerprint: v.string(),
      })),
    })),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click evidence backfill version");
    }
    await assertDataForSeoAccountBalance(
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    );
    return ctx.runMutation(api.reserveAndQueue, {
      ...args,
      origin: "operator_canary",
    });
  },
});

/** Fleet-only wrapper; it shares the exact operator preflight and mutation. */
export const queueExpectedClickEvidenceBackfillFleet = internalAction({
  args: {
    siteId: v.id("sites"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click evidence backfill version");
    }
    await assertDataForSeoAccountBalance(
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    );
    return ctx.runMutation(api.reserveAndQueue, {
      ...args,
      origin: fleetOrigin,
    });
  },
});

/** Resume the exact durable batch. It never creates another reservation. */
export const resumeExpectedClickEvidenceBackfill = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click evidence backfill version");
    }
    const job = await ctx.runQuery(api.getJobInternal, {
      siteId: args.siteId,
      jobId: args.jobId,
    });
    if (!job) throw new Error("Expected-click evidence job not found");
    if (
      job.authorityDomains !== undefined &&
      job.authoritySnapshotComplete !== true
    ) {
      throw new Error("authority_attempt_ambiguous");
    }
    await assertDataForSeoAccountBalance(
      expectedClickBackfillRemainingCostMicroUsd({
        selectedTopics: job.selectedTopics.length,
        serpSnapshots: job.serpSnapshots.length + job.serpFailures.length,
        authoritySnapshotComplete: job.authoritySnapshotComplete === true,
      }),
    );
    return ctx.runMutation(api.scheduleResume, args);
  },
});

export const processExpectedClickEvidenceBackfill = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_evidence_jobs"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const workerToken = randomUUID();
    const claimed = await ctx.runMutation(api.claimWorker, {
      ...args,
      workerToken,
    });
    if (!claimed) return { processed: false };
    try {
      await assertDataForSeoAccountBalance(
        expectedClickBackfillRemainingCostMicroUsd({
          selectedTopics: claimed.selectedTopics.length,
          serpSnapshots:
            claimed.serpSnapshots.length + claimed.serpFailures.length,
          authoritySnapshotComplete:
            claimed.authoritySnapshotComplete === true,
        }),
      );
    } catch (error) {
      const releaseReason = releaseReasonFor(error);
      if (releaseReason && claimed.providerCallsAttempted === 0) {
        return ctx.runMutation(api.abortForProviderBalance, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          releaseReason,
        });
      }
      await ctx.runMutation(api.markPartial, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
        errorCode: stableFailureCode(error),
      });
      return { processed: false, partial: true };
    }

    const runtime = createExpectedClickBackfillRuntime();
    try {
      for (const selected of claimed.selectedTopics) {
        const state = await ctx.runQuery(api.getExecutionStateInternal, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
        });
        if (!state) throw new Error("Expected-click evidence worker lease lost");
        const alreadyRecorded =
          state.job.serpSnapshots.some(
            (snapshot) => snapshot.topicId === selected.topicId,
          ) ||
          state.job.serpFailures.some(
            (failure) => failure.topicId === selected.topicId,
          ) || state.job.serpAttemptedTopicIds.includes(selected.topicId);
        if (alreadyRecorded) continue;
        if (
          state.job.providerCallsAttempted >=
            EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT
        ) throw new Error("Expected-click evidence provider call ceiling exhausted");
        consumeExpectedClickBackfillSerpCall(runtime);
        const begun = await ctx.runMutation(api.beginProviderCall, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          kind: "serp",
          topicId: selected.topicId,
        });
        if (!begun.allowed) continue;
        const locationCode = dataForSeoLocationCode(state.site.targetCountry);
        const languageCode = dataForSeoLanguageCode(state.site.language);
        let analysis: Awaited<ReturnType<typeof analyzeSERPFromDataForSEO>>;
        try {
          analysis = await analyzeSERPFromDataForSEO(
            selected.keyword,
            locationCode,
            languageCode,
          );
        } catch (error) {
          // A failed paid attempt is terminal for this topic in the bounded
          // batch. Recording it prevents a resume from silently paying for
          // the same SERP twice; the other selected topics can still proceed.
          await ctx.runMutation(api.recordSerpFailure, {
            siteId: args.siteId,
            jobId: args.jobId,
            workerToken,
            topicId: selected.topicId,
            code: "provider_call_failed",
          });
          throw error;
        }
        const intentResults = analysis.results
          .filter((result) =>
            result.type === "organic" &&
            Number.isInteger(result.position) &&
            result.position >= 1 &&
            result.position <= 10 &&
            /^https?:\/\//i.test(result.url)
          )
          .map((result) => ({
            position: result.position,
            url: result.url,
            title: result.title,
            description: result.description,
          }))
          .slice(0, 10);
        const results = intentResults.map(({ position, url }) => ({
          position,
          url,
        }));
        const observedAt = Date.now();
        if (results.length < 5) {
          await ctx.runMutation(api.recordSerpFailure, {
            siteId: args.siteId,
            jobId: args.jobId,
            workerToken,
            topicId: selected.topicId,
            code: "insufficient_organic_results",
          });
          continue;
        }
        await ctx.runMutation(api.recordSerpSnapshot, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          topicId: selected.topicId,
          observedAt,
          locationCode,
          languageCode,
          results,
          intentResults,
        });
      }

      const state = await ctx.runQuery(api.getExecutionStateInternal, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
      });
      if (!state) throw new Error("Expected-click evidence worker lease lost");
      if (state.job.authoritySnapshotComplete !== true) {
        const authorityPlan = planSerpAuthorityCollection({
          tenantDomain: state.site.domain,
          topics: state.job.serpSnapshots.map((snapshot) => ({
            topicId: String(snapshot.topicId),
            results: snapshot.results,
          })),
        });
        let evidence: Awaited<ReturnType<typeof getDomainAuthorities>> = [];
        const providerCallMade = authorityPlan.domains.length > 0;
        if (providerCallMade) {
          consumeExpectedClickBackfillAuthorityCall(runtime);
          const begun = await ctx.runMutation(api.beginProviderCall, {
            siteId: args.siteId,
            jobId: args.jobId,
            workerToken,
            kind: "authority",
            authorityDomains: authorityPlan.domains,
          });
          if (!begun.allowed) {
            throw new Error(begun.reason);
          }
          evidence = await getDomainAuthorities(authorityPlan.domains, {
            maxDomains: 50,
            measuredAt: Date.now(),
          });
        }
        await ctx.runMutation(api.recordAuthoritySnapshot, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          domains: authorityPlan.domains,
          providerCallMade,
          evidence: evidence.map((item) => ({
            domain: item.domain,
            domainRank: item.domainRank,
            referringDomains: item.referringDomains,
            source: item.source,
            measuredAt: item.measuredAt,
          })),
        });
      }
      const result = await ctx.runMutation(api.persistEvidence, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
      });
      return { processed: true, ...result };
    } catch (error) {
      try {
        await ctx.runMutation(api.markPartial, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          errorCode: stableFailureCode(error),
        });
      } catch {
        // A deletion/rollout/lease fence intentionally prevents stale workers
        // from writing even their terminal status.
      }
      return {
        processed: false,
        partial: true,
        errorCode: stableFailureCode(error),
      };
    }
  },
});
