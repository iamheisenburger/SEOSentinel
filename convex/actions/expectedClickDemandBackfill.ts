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
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
  consumeExpectedClickDemandProviderCall,
  createExpectedClickDemandRuntime,
  utcDemandBackfillDay,
} from "../lib/expectedClickDemandBackfill";
import { getExactKeywordDemandFromDataForSEO } from "./seoData";

const api = internal.expectedClickDemandBackfill;
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
  if (/provider_attempt_ambiguous/.test(message)) {
    return "provider_attempt_ambiguous";
  }
  if (/authorization is stale|worker lease|site not found/.test(message)) {
    return "tenant_fence_changed";
  }
  if (/provider_call_limit/.test(message)) return "provider_call_ceiling";
  if (/reservation.*stale|reservation_day_expired/.test(message)) {
    return "provider_reservation_stale";
  }
  if (/incompatible exact keyword metrics/.test(message)) {
    return "provider_receipt_incompatible";
  }
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

/** Operator-only entry point; the free wallet check precedes reservation. */
export const queueExpectedClickDemandBackfill = internalAction({
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
    if (args.policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click demand backfill version");
    }
    await assertDataForSeoAccountBalance(
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    );
    return ctx.runMutation(api.reserveAndQueue, {
      ...args,
      origin: "operator_canary",
    });
  },
});

/** Fleet-only wrapper; it shares the exact operator preflight and mutation. */
export const queueExpectedClickDemandBackfillFleet = internalAction({
  args: {
    siteId: v.id("sites"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click demand backfill version");
    }
    await assertDataForSeoAccountBalance(
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    );
    return ctx.runMutation(api.reserveAndQueue, {
      ...args,
      origin: fleetOrigin,
    });
  },
});

/** Resume the exact job only; it never creates another reservation. */
export const resumeExpectedClickDemandBackfill = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    policyVersion: v.number(),
    suppressEvidenceChain: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== EXPECTED_CLICK_DEMAND_BACKFILL_VERSION) {
      throw new Error("Unsupported expected-click demand backfill version");
    }
    const job = await ctx.runQuery(api.getJobInternal, {
      siteId: args.siteId,
      jobId: args.jobId,
    });
    if (!job) throw new Error("Expected-click demand job not found");
    if (
      job.providerCallAttempted === true &&
      job.providerCallCompleted !== true
    ) {
      throw new Error("provider_attempt_ambiguous");
    }
    if (job.providerCallAttempted !== true) {
      if (job.reservationDay !== utcDemandBackfillDay(Date.now())) {
        throw new Error("reservation_day_expired");
      }
      await assertDataForSeoAccountBalance(
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      );
    }
    return ctx.runMutation(api.scheduleResume, args);
  },
});

export const processExpectedClickDemandBackfill = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("expected_click_demand_jobs"),
    policyVersion: v.number(),
    suppressEvidenceChain: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const workerToken = randomUUID();
    const claimed = await ctx.runMutation(api.claimWorker, {
      siteId: args.siteId,
      jobId: args.jobId,
      policyVersion: args.policyVersion,
      workerToken,
    });
    if (!claimed) return { processed: false };
    if (
      claimed.providerCallAttempted === true &&
      claimed.providerCallCompleted !== true
    ) {
      await ctx.runMutation(api.markPartial, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
        errorCode: "provider_attempt_ambiguous",
      });
      return {
        processed: false,
        partial: true,
        errorCode: "provider_attempt_ambiguous",
      };
    }

    if (claimed.providerCallAttempted !== true) {
      try {
        await assertDataForSeoAccountBalance(
          EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
        );
      } catch (error) {
        const releaseReason = releaseReasonFor(error);
        if (releaseReason) {
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
    }

    const runtime = createExpectedClickDemandRuntime();
    try {
      if (claimed.providerCallCompleted !== true) {
        consumeExpectedClickDemandProviderCall(runtime);
        const begun = await ctx.runMutation(api.beginProviderAttempt, {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          suppressEvidenceChain: args.suppressEvidenceChain,
        });
        if (!begun.callRequired) {
          if (begun.reason === "no_current_topics") {
            return { processed: true, persistedTopics: 0 };
          }
          if (begun.reason !== "receipt_recorded") {
            throw new Error(begun.reason);
          }
        } else {
          const metrics = await getExactKeywordDemandFromDataForSEO(
            begun.keywords,
            begun.locationCode,
            begun.languageCode,
          );
          const measuredAt = Date.now();
          await ctx.runMutation(api.recordMetricReceipts, {
            siteId: args.siteId,
            jobId: args.jobId,
            workerToken,
            measuredAt,
            locationCode: begun.locationCode,
            languageCode: begun.languageCode,
            metrics: metrics.map((metric) => ({
              keyword: metric.keyword,
              searchVolume: metric.searchVolume,
              trend: metric.trend,
              ...(metric.cpc === undefined ? {} : { cpc: metric.cpc }),
              ...(metric.competition === undefined
                ? {}
                : { competition: metric.competition }),
            })),
          });
        }
      }
      const result = await ctx.runMutation(api.persistDemand, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
        suppressEvidenceChain: args.suppressEvidenceChain,
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
        // Deletion, rollout and lease changes intentionally fence stale writes.
      }
      return {
        processed: false,
        partial: true,
        errorCode: stableFailureCode(error),
      };
    }
  },
});
