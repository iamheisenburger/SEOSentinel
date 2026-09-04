"use node";

import { randomUUID } from "node:crypto";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  CADENCE_MICRO_SEED_FINALIZE_DELAY_MS,
  CADENCE_MICRO_SEED_BALANCE_RECEIPT_MAX_AGE_MS,
  CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS,
  CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES,
  CADENCE_MICRO_SEED_RESULT_LIMIT,
  CADENCE_MICRO_SEED_VERSION,
  cadenceMicroSeedAttemptKind,
  cadenceMicroSeedDiscoveryEndpoint,
  cadenceMicroSeedProviderCeilingMicroUsd,
} from "../lib/cadenceMicroSeed";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
} from
  "../lib/expectedClickEvidenceBackfill";
import { EXPECTED_CLICK_PORTFOLIO_VERSION } from
  "../lib/expectedClickPortfolio";
import { cadenceMicroSeedRecoveryBlockReason } from
  "../lib/plannedTopicEvidenceRecovery";
import {
  assertDataForSeoAccountBalance,
  isDataForSeoBalancePreflightError,
} from "../lib/dataForSeoAccountBalance";
import {
  discoverCadenceMicroSeedFromDataForSEO,
} from "./seoData";

const api = internal.cadenceMicroSeed;

function stableFailureCode(error: unknown): string {
  if (isDataForSeoBalancePreflightError(error)) {
    return error.code === "insufficient_balance"
      ? "provider_balance_insufficient"
      : "provider_balance_preflight_unavailable";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/429/.test(message)) return "provider_rate_limited";
  if (/http.*5\d\d/.test(message)) return "provider_unavailable";
  if (/timeout|timed out|deadline/.test(message)) return "provider_timeout";
  if (/cost exceeded/.test(message)) return "provider_cost_mismatch";
  if (/receipt|response|request echo|provider path|provider item|trend/.test(message)) {
    return "provider_receipt_incompatible";
  }
  if (/fence|authorization|lease|stale/.test(message)) {
    return "tenant_fence_changed";
  }
  if (/budget|reservation|account.*limit|fleet.*limit|monthly|daily/.test(message)) {
    return "provider_budget_race";
  }
  if (/planned[_ -]evidence/.test(message)) {
    return "planned_evidence_unavailable";
  }
  return "micro_seed_failed";
}

async function raiseMiss(
  ctx: Pick<ActionCtx, "runMutation">,
  siteId: Id<"sites">,
  jobId: Id<"cadence_micro_seed_jobs">,
  reason: string,
) {
  await ctx.runMutation(internal.autopilot.raiseAlert, {
    siteId,
    kind: "cadence_micro_seed_missed",
    message:
      "The bounded micro-seed could not prove a safe topic before cadence. No article was generated or published.",
    details: { jobId, reason },
  });
}

type MaterializedMicroSeed = {
  materialized: true;
  topicId: Id<"topic_clusters">;
  topicFingerprint: string;
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number;
  providerTaskCostUsd: number;
};

type ReconciledProviderCosts = {
  examined: number;
  settled: number;
  reclaimedMicroUsd: number;
};

async function resolveExhaustedSourcePlan(
  ctx: Pick<ActionCtx, "runQuery">,
  siteId: Id<"sites">,
): Promise<Id<"jobs"> | undefined> {
  let cursor: string | undefined;
  let examined = 0;
  for (let pageNumber = 0; pageNumber < 13; pageNumber += 1) {
    const page = await ctx.runQuery(api.findSourcePlanPageInternal, {
      siteId,
      examined,
      ...(cursor ? { cursor } : {}),
    }) as {
      sourcePlanId?: Id<"jobs">;
      isDone: boolean;
      continueCursor?: string;
      examined: number;
    };
    if (page.sourcePlanId) return page.sourcePlanId;
    if (page.isDone) return undefined;
    if (
      !page.continueCursor ||
      page.continueCursor === cursor ||
      page.examined <= examined
    ) throw new Error("cadence_source_plan_cursor_invalid");
    cursor = page.continueCursor;
    examined = page.examined;
  }
  throw new Error("cadence_source_plan_read_limit");
}

async function reconcileVerifiedProviderCostPages(
  ctx: Pick<ActionCtx, "runMutation">,
  siteId: Id<"sites">,
): Promise<ReconciledProviderCosts> {
  const aggregate: ReconciledProviderCosts = {
    examined: 0,
    settled: 0,
    reclaimedMicroUsd: 0,
  };
  let cursor: string | undefined;
  // The model owns a hard 2,000-row monthly read ceiling. Small transactions
  // keep reconciliation below Convex's one-second mutation budget even after
  // a tenant accumulates many immutable recovery generations.
  const maximumPages = 126;
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const page = await ctx.runMutation(api.reconcileVerifiedProviderCosts, {
      siteId,
      ...(cursor ? { cursor } : {}),
    }) as ReconciledProviderCosts & {
      isDone: boolean;
      continueCursor?: string;
    };
    aggregate.examined += page.examined;
    aggregate.settled += page.settled;
    aggregate.reclaimedMicroUsd += page.reclaimedMicroUsd;
    if (page.isDone) return aggregate;
    if (!page.continueCursor || page.continueCursor === cursor) {
      throw new Error("provider_cost_reconciliation_cursor_invalid");
    }
    cursor = page.continueCursor;
  }
  throw new Error("provider_cost_reconciliation_read_limit");
}

function durableMaterializedMicroSeed(
  job: Doc<"cadence_micro_seed_jobs"> | null,
): MaterializedMicroSeed | null {
  if (
    !job ||
    job.providerCallCompleted !== true ||
    !job.topicId ||
    !job.topicFingerprint ||
    !job.plannedEvidenceFingerprint ||
    !job.selectedCandidate ||
    !Number.isFinite(job.providerTaskCostUsd) ||
    !Number.isFinite(job.selectedCandidate.searchVolume) ||
    !Number.isFinite(job.selectedCandidate.difficulty)
  ) return null;
  return {
    materialized: true,
    topicId: job.topicId,
    topicFingerprint: job.topicFingerprint,
    keyword: job.selectedCandidate.keyword,
    searchVolume: job.selectedCandidate.searchVolume,
    keywordDifficulty: job.selectedCandidate.difficulty,
    providerTaskCostUsd: job.providerTaskCostUsd!,
  };
}

async function bindExactEvidenceJob(
  ctx: ActionCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"cadence_micro_seed_jobs">;
    topicId: Id<"topic_clusters">;
    evidenceJobId: Id<"expected_click_evidence_jobs">;
  },
): Promise<boolean> {
  try {
    await ctx.runMutation(api.recordEvidenceQueued, args);
    return true;
  } catch {
    // A mutation response may be lost after its transaction (including the
    // finalizer schedule) committed. Re-read before classifying the handoff.
    const durable = await ctx.runQuery(api.getJobInternal, {
      siteId: args.siteId,
      jobId: args.jobId,
    });
    return durable?.evidenceJobId === args.evidenceJobId &&
      ["evidence_running", "cadence_scheduling", "completed", "missed"]
        .includes(durable.status);
  }
}

async function reconcileExactEvidenceJob(
  ctx: ActionCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"cadence_micro_seed_jobs">;
    topicId: Id<"topic_clusters">;
  },
): Promise<
  | { found: true; bound: true; evidenceJobId: Id<"expected_click_evidence_jobs"> }
  | { found: true; bound: false; reason: string }
  | { found: false }
> {
  const exact = await ctx.runQuery(api.findExactEvidenceJobInternal, args);
  if (!exact) return { found: false };
  if (exact.conflict) {
    return { found: true, bound: false, reason: "evidence_job_conflict" };
  }
  const bound = await bindExactEvidenceJob(ctx, {
    ...args,
    evidenceJobId: exact.evidenceJobId,
  });
  return bound
    ? { found: true, bound: true, evidenceJobId: exact.evidenceJobId }
    : { found: true, bound: false, reason: "evidence_receipt_incompatible" };
}

async function recordUnverifiedHandoffOrObserveCommit(
  ctx: ActionCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"cadence_micro_seed_jobs">;
    topicId: Id<"topic_clusters">;
    reason: string;
  },
): Promise<Id<"expected_click_evidence_jobs"> | null> {
  try {
    await ctx.runMutation(api.recordEvidenceHandoffUnverified, args);
    return null;
  } catch {
    const durable = await ctx.runQuery(api.getJobInternal, {
      siteId: args.siteId,
      jobId: args.jobId,
    });
    if (
      durable?.evidenceJobId &&
      ["evidence_running", "cadence_scheduling", "completed", "missed"]
        .includes(durable.status)
    ) return durable.evidenceJobId;
    throw new Error("Evidence handoff state could not be reconciled");
  }
}

async function queueOrReconcileEvidence(
  ctx: ActionCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"cadence_micro_seed_jobs">;
    topicId: Id<"topic_clusters">;
  },
): Promise<
  | { queued: true; evidenceJobId: Id<"expected_click_evidence_jobs"> }
  | { queued: false; reason: string }
> {
  let queueFailure: unknown;
  try {
    const inspection = await ctx.runAction(
      internal.actions.plannedTopicEvidenceRecovery.recoverPlannedTopicEvidence,
      { siteId: args.siteId, mode: "inspect" },
    ) as {
      ready?: boolean;
      phase?: string;
      inspectionKey?: string;
      inspectionDay?: string;
      rolloutEpoch?: number;
      selected?: Array<{ topicId: Id<"topic_clusters"> }>;
    };
    if (
      inspection.ready !== true ||
      inspection.phase !== "evidence" ||
      !inspection.inspectionKey ||
      !inspection.inspectionDay ||
      typeof inspection.rolloutEpoch !== "number" ||
      inspection.selected?.length !== 1 ||
      inspection.selected[0]?.topicId !== args.topicId
    ) throw new Error("planned_evidence_inspection_unavailable");
    const applied = await ctx.runAction(
      internal.actions.plannedTopicEvidenceRecovery.recoverPlannedTopicEvidence,
      {
        siteId: args.siteId,
        mode: "apply",
        inspectionKey: inspection.inspectionKey,
        inspectionDay: inspection.inspectionDay,
        rolloutEpoch: inspection.rolloutEpoch,
        phase: "evidence",
      },
    ) as {
      applied?: boolean;
      reason?: string;
      result?: { queued?: boolean; jobId?: Id<"expected_click_evidence_jobs"> };
    };
    const evidenceJobId = applied.applied === true &&
        applied.result?.queued === true
      ? applied.result.jobId
      : undefined;
    if (!evidenceJobId) {
      throw new Error(applied.reason ?? "planned_evidence_not_queued");
    }
    if (await bindExactEvidenceJob(ctx, { ...args, evidenceJobId })) {
      return { queued: true, evidenceJobId };
    }
    queueFailure = new Error("evidence_receipt_incompatible");
  } catch (error) {
    queueFailure = error;
  }

  // The apply action may have committed before its response was lost. Never
  // mark a pre-call block until the database proves no exact evidence job.
  const reconciled = await reconcileExactEvidenceJob(ctx, args);
  if (reconciled.found && reconciled.bound) {
    return { queued: true, evidenceJobId: reconciled.evidenceJobId };
  }
  const reason = reconciled.found
    ? reconciled.reason
    : stableFailureCode(queueFailure);
  if (reconciled.found) {
    const committedEvidenceJobId = await recordUnverifiedHandoffOrObserveCommit(
      ctx,
      {
      ...args,
      reason,
      },
    );
    if (committedEvidenceJobId) {
      return { queued: true, evidenceJobId: committedEvidenceJobId };
    }
    return { queued: false, reason };
  }
  try {
    await ctx.runMutation(api.recordEvidenceBlocked, { ...args, reason });
    return { queued: false, reason };
  } catch {
    // One final OCC-safe reconciliation closes the race where a concurrent
    // apply inserted the exact job after the first query.
    const raced = await reconcileExactEvidenceJob(ctx, args);
    if (raced.found && raced.bound) {
      return { queued: true, evidenceJobId: raced.evidenceJobId };
    }
    const raceReason = raced.found
      ? raced.reason
      : "evidence_handoff_state_changed";
    const committedEvidenceJobId = await recordUnverifiedHandoffOrObserveCommit(
      ctx,
      {
      ...args,
      reason: raceReason,
      },
    );
    if (committedEvidenceJobId) {
      return { queued: true, evidenceJobId: committedEvidenceJobId };
    }
    return { queued: false, reason: raceReason };
  }
}

/**
 * Internal inspect/apply entry. Inspection is provider-free. Apply must carry
 * the exact descriptor returned by the immediately preceding inspection and
 * performs a free wallet check for both the discovery and evidence envelopes
 * before the atomic discovery reservation is allowed.
 */
export const recoverCadenceGap = internalAction({
  args: {
    siteId: v.id("sites"),
    mode: v.union(v.literal("inspect"), v.literal("apply")),
    inspectionKey: v.optional(v.string()),
    reservationDay: v.optional(v.string()),
    rolloutEpoch: v.optional(v.number()),
    sourcePlanId: v.optional(v.id("jobs")),
    sourcePlanFingerprint: v.optional(v.string()),
    attemptKind: v.optional(v.union(
      v.literal("primary"),
      v.literal("fallback"),
    )),
    parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
    parentMicroSeedReceiptFingerprint: v.optional(v.string()),
    providerCostCeilingMicroUsd: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const reconciledCosts = await reconcileVerifiedProviderCostPages(
      ctx,
      args.siteId,
    );
    const sourcePlanId = await resolveExhaustedSourcePlan(ctx, args.siteId);
    if (!sourcePlanId) {
      return {
        ready: false,
        reason: "source_plan_not_exhausted",
        providerCallsMade: 0,
        providerReservationsCreated: 0,
        evidenceCeilingMicroUsd:
          EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
        reconciledCosts,
      };
    }
    const [demandReadiness, evidenceReadiness, demandStatus] = await Promise.all([
      ctx.runQuery(internal.expectedClickDemandBackfill.getFleetReadinessInternal, {
        siteId: args.siteId,
      }),
      ctx.runQuery(internal.expectedClickEvidenceBackfill.getFleetReadinessInternal, {
        siteId: args.siteId,
      }),
      ctx.runQuery(internal.expectedClickDemandBackfill.getStatusInternal, {
        siteId: args.siteId,
      }),
    ]);
    const recoveryBlockReason = cadenceMicroSeedRecoveryBlockReason(
      demandReadiness,
      evidenceReadiness,
      demandStatus?.terminalNoMetricReceiptValid === true,
    );
    const inspected = await ctx.runQuery(api.inspectInternal, {
      siteId: args.siteId,
      sourcePlanId,
      recoveryPrechecked: true,
      ...(recoveryBlockReason ? { recoveryBlockReason } : {}),
    });
    if (args.mode === "inspect" || !inspected.ready) {
      return {
        ...inspected,
        providerCallsMade: 0,
        providerReservationsCreated: 0,
        discoveryCeilingMicroUsd: inspected.ready
          ? inspected.providerCostCeilingMicroUsd
          : undefined,
        evidenceCeilingMicroUsd:
          EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
        reconciledCosts,
      };
    }
    if (
      args.inspectionKey !== inspected.inspectionKey ||
      args.reservationDay !== inspected.reservationDay ||
      args.rolloutEpoch !== inspected.rolloutEpoch ||
      args.sourcePlanId !== inspected.sourcePlanId ||
      args.sourcePlanFingerprint !== inspected.sourcePlanFingerprint ||
      args.attemptKind !== inspected.attemptKind ||
      args.parentMicroSeedJobId !== inspected.parentMicroSeedJobId ||
      args.parentMicroSeedReceiptFingerprint !==
        inspected.parentMicroSeedReceiptFingerprint ||
      args.providerCostCeilingMicroUsd !==
        inspected.providerCostCeilingMicroUsd
    ) {
      return { applied: false, reason: "micro_seed_inspection_stale", current: inspected };
    }
    const providerBalanceRequiredMicroUsd =
      inspected.providerCostCeilingMicroUsd +
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD *
        CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES;
    await assertDataForSeoAccountBalance(providerBalanceRequiredMicroUsd);
    const providerBalancePreflightAt = Date.now();
    const result = await ctx.runMutation(api.reserveAndQueue, {
      siteId: args.siteId,
      inspectionKey: inspected.inspectionKey,
      reservationDay: inspected.reservationDay,
      rolloutEpoch: inspected.rolloutEpoch,
      sourcePlanId: inspected.sourcePlanId,
      sourcePlanFingerprint: inspected.sourcePlanFingerprint,
      attemptKind: inspected.attemptKind,
      parentMicroSeedJobId: inspected.parentMicroSeedJobId,
      parentMicroSeedReceiptFingerprint:
        inspected.parentMicroSeedReceiptFingerprint,
      providerCostCeilingMicroUsd: inspected.providerCostCeilingMicroUsd,
      providerBalancePreflightAt,
      providerBalanceRequiredMicroUsd,
    });
    return { applied: result.queued === true, result, reconciledCosts };
  },
});

export const processCadenceMicroSeed = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.policyVersion !== CADENCE_MICRO_SEED_VERSION) {
      throw new Error("Unsupported cadence micro-seed version");
    }
    const workerToken = randomUUID();
    const claimed = await ctx.runMutation(api.claimWorker, {
      ...args,
      workerToken,
    });
    if (!claimed) return { processed: false };
    const claimedKind = cadenceMicroSeedAttemptKind(claimed.attemptKind);
    const claimedProviderCeiling = claimedKind
      ? cadenceMicroSeedProviderCeilingMicroUsd(claimedKind)
      : null;
    if (
      claimedProviderCeiling === null ||
      claimed.providerCostCeilingMicroUsd !== claimedProviderCeiling ||
      claimed.providerCostReservedMicroUsd !== claimedProviderCeiling ||
      typeof claimed.providerBalancePreflightAt !== "number" ||
      !Number.isSafeInteger(claimed.providerBalancePreflightAt) ||
      claimed.providerBalancePreflightAt > claimed.createdAt ||
      claimed.createdAt - claimed.providerBalancePreflightAt >
        CADENCE_MICRO_SEED_BALANCE_RECEIPT_MAX_AGE_MS ||
      claimed.providerBalanceRequiredMicroUsd !==
        claimedProviderCeiling +
          EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD *
            CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES
    ) {
      await ctx.runMutation(api.markProviderResponseUnverified, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
        errorCode: "provider_cost_contract_incompatible",
      });
      await raiseMiss(
        ctx,
        args.siteId,
        args.jobId,
        "provider_cost_contract_incompatible",
      );
      return { processed: false, reason: "provider_cost_contract_incompatible" };
    }
    const begun = await ctx.runMutation(api.beginProviderAttempt, {
      siteId: args.siteId,
      jobId: args.jobId,
      workerToken,
    });
    if (!begun.allowed) {
      await ctx.runMutation(api.markProviderResponseUnverified, {
        siteId: args.siteId,
        jobId: args.jobId,
        workerToken,
        errorCode: begun.reason,
      });
      await raiseMiss(ctx, args.siteId, args.jobId, begun.reason);
      return { processed: false, reason: begun.reason };
    }

    let materialized:
      | { materialized: false; reason: string }
      | MaterializedMicroSeed
      | null = null;
    try {
      const attemptKind = cadenceMicroSeedAttemptKind(begun.attemptKind);
      if (
        !attemptKind ||
        begun.endpoint !== cadenceMicroSeedDiscoveryEndpoint(attemptKind) ||
        begun.resultLimit !== CADENCE_MICRO_SEED_RESULT_LIMIT ||
        begun.includeSerpInfo !== false ||
        begun.includeClickstreamData !== false
      ) throw new Error("Cadence micro-seed provider contract drifted");
      const receipt = await discoverCadenceMicroSeedFromDataForSEO(
        begun.providerSeeds,
        begun.locationCode,
        begun.languageCode,
        {
          endpoint: begun.endpoint,
          limit: begun.resultLimit,
          requestTag: begun.providerRequestTag,
        },
      );
      materialized = await ctx.runMutation(
        api.recordProviderReceiptAndMaterialize,
        {
          siteId: args.siteId,
          jobId: args.jobId,
          workerToken,
          endpoint: receipt.endpoint,
          seed: receipt.seed,
          seeds: receipt.seeds,
          requestTag: receipt.requestTag,
          resultLimit: receipt.resultLimit,
          locationCode: receipt.locationCode,
          languageCode: receipt.languageCode,
          providerTaskCostUsd: receipt.providerTaskCostUsd,
          providerRowsReceived: receipt.providerRowsReceived,
          providerRowsRejected: receipt.providerRowsRejected,
          measuredAt: Date.now(),
          candidates: receipt.candidates,
        },
      );
    } catch (error) {
      const code = stableFailureCode(error);
      const durable = await ctx.runQuery(api.getJobInternal, {
        siteId: args.siteId,
        jobId: args.jobId,
      });
      const committed = durableMaterializedMicroSeed(durable);
      if (committed) {
        materialized = committed;
      } else if (
        durable?.providerCallCompleted === true &&
        durable.status === "missed" &&
        !durable.topicId
      ) {
        const reason = durable.errorCode ?? "no_strict_candidate";
        await raiseMiss(ctx, args.siteId, args.jobId, reason);
        return { processed: true, materialized: false, reason };
      } else {
        let ambiguityRecorded = false;
        try {
          await ctx.runMutation(api.markProviderResponseUnverified, {
            siteId: args.siteId,
            jobId: args.jobId,
            workerToken,
            errorCode: code,
          });
          ambiguityRecorded = true;
        } catch {
          const raced = await ctx.runQuery(api.getJobInternal, {
            siteId: args.siteId,
            jobId: args.jobId,
          });
          const racedCommit = durableMaterializedMicroSeed(raced);
          if (racedCommit) {
            materialized = racedCommit;
          } else {
            await raiseMiss(ctx, args.siteId, args.jobId, code);
            return {
              processed: false,
              providerAttemptAmbiguous: true,
              errorCode: code,
            };
          }
        }
        if (ambiguityRecorded) {
          await raiseMiss(ctx, args.siteId, args.jobId, code);
          return {
            processed: false,
            providerAttemptAmbiguous: true,
            errorCode: code,
          };
        }
      }
    }
    if (!materialized) {
      await raiseMiss(ctx, args.siteId, args.jobId, "durable_state_unavailable");
      return { processed: false, reason: "durable_state_unavailable" };
    }
    if (materialized.materialized === false) {
      await raiseMiss(ctx, args.siteId, args.jobId, materialized.reason);
      return { processed: true, materialized: false, reason: materialized.reason };
    }

    const evidence = await queueOrReconcileEvidence(ctx, {
      siteId: args.siteId,
      jobId: args.jobId,
      topicId: materialized.topicId,
    });
    if (evidence.queued) {
      return {
        processed: true,
        materialized: true,
        topicId: materialized.topicId,
        evidenceJobId: evidence.evidenceJobId,
        keyword: materialized.keyword,
        searchVolume: materialized.searchVolume,
        keywordDifficulty: materialized.keywordDifficulty,
        providerTaskCostUsd: materialized.providerTaskCostUsd,
      };
    }
    await raiseMiss(ctx, args.siteId, args.jobId, evidence.reason);
    return {
      processed: true,
      materialized: true,
      evidenceQueued: false,
      reason: evidence.reason,
    };
  },
});

export const resumeCadenceEvidenceHandoff = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const job = await ctx.runQuery(api.getJobInternal, args);
    if (!job || job.status !== "awaiting_evidence") {
      return { resumed: false, reason: "job_not_awaiting_evidence" };
    }
    const materialized = durableMaterializedMicroSeed(job);
    if (!materialized) {
      await raiseMiss(ctx, args.siteId, args.jobId, "topic_receipt_unavailable");
      return { resumed: false, reason: "topic_receipt_unavailable" };
    }
    const evidence = await queueOrReconcileEvidence(ctx, {
      ...args,
      topicId: materialized.topicId,
    });
    if (!evidence.queued) {
      await raiseMiss(ctx, args.siteId, args.jobId, evidence.reason);
    }
    return { resumed: evidence.queued, ...evidence };
  },
});

export const reconcileCadenceMicroSeed = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const result = await ctx.runMutation(api.reconcileWatchdog, args);
    if (
      result.reconciled &&
      [
        "terminal_provider_ambiguity",
        "terminal_watchdog_exhausted",
        "terminal_incompatible_state",
        "terminal_execution_fence_changed",
      ].includes(result.action ?? "")
    ) {
      await raiseMiss(ctx, args.siteId, args.jobId, result.action!);
    }
    return result;
  },
});

export const scheduleCadenceForMicroSeed = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const job = await ctx.runQuery(api.getJobInternal, args);
    if (!job || job.status !== "cadence_scheduling") {
      return { scheduled: false, reason: "job_not_scheduling" };
    }
    let scheduled = 0;
    let mode = "scheduler_action_failed";
    try {
      const result = await ctx.runAction(
        internal.actions.scheduler.scheduleCadence,
        { siteId: args.siteId },
      );
      scheduled = Number.isInteger(result.scheduled) ? result.scheduled : 0;
      mode = typeof result.mode === "string" && result.mode
        ? result.mode
        : "idle";
    } catch {
      // The scheduler may have committed the exact article queue before its
      // action response was lost. The mutation below derives proof from DB.
    }
    const receipt = await ctx.runMutation(api.recordCadenceScheduleResult, {
      ...args,
      scheduled,
      mode,
    });
    if (receipt.recorded && receipt.exhausted) {
      await raiseMiss(ctx, args.siteId, args.jobId, "cadence_schedule_unverified");
    }
    return receipt;
  },
});

export function cadenceMicroSeedFleetJitterMs(
  siteId: string,
  day: string,
  windowMs = 60_000,
): number {
  const boundedWindow = Math.max(1, Math.floor(windowMs));
  let hash = 2_166_136_261;
  for (const character of `${day}:${siteId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % boundedWindow;
}

export const dispatchCadenceMicroSeedFleet = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<unknown> => {
    const page = await ctx.runQuery(
      internal.sites.listExpectedClickBackfillFleetPage,
      { cursor },
    ) as {
      page: Array<{ siteId: Id<"sites"> }>;
      isDone: boolean;
      continueCursor: string;
    };
    const day = new Date().toISOString().slice(0, 10);
    let scheduled = 0;
    for (const site of page.page) {
      try {
        await ctx.scheduler.runAfter(
          cadenceMicroSeedFleetJitterMs(String(site.siteId), day),
          internal.actions.cadenceMicroSeed.runCadenceMicroSeedFleetSite,
          { siteId: site.siteId },
        );
        scheduled += 1;
      } catch {
        console.error("[cadence-micro-seed] tenant dispatch failed");
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.actions.cadenceMicroSeed.dispatchCadenceMicroSeedFleet,
        { cursor: page.continueCursor },
      );
    }
    return { scheduled, scheduledNext: !page.isDone };
  },
});

export const runCadenceMicroSeedFleetSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<unknown> => {
    const semanticContinuation = await ctx.runMutation(
      api.resumeLegacySemanticCandidateInternal,
      { siteId },
    );
    if (semanticContinuation.advanced) {
      return {
        applied: true,
        reason: "legacy_semantic_candidate_advanced",
        semanticContinuation,
        legacyTopicsQuarantined: 0,
        legacyArticlesQuarantined: 0,
      };
    }
    const legacyRepairs = await ctx.runQuery(
      api.listLegacyAnchorMismatchRepairsInternal,
      { siteId },
    );
    let legacyTopicsQuarantined = 0;
    let legacyArticlesQuarantined = 0;
    for (const topicId of legacyRepairs.topicIds) {
      const repaired = await ctx.runMutation(
        internal.articles.quarantineLegacyCadenceAnchorMismatch,
        { siteId, topicId },
      );
      if (repaired.quarantined) {
        legacyTopicsQuarantined += 1;
        legacyArticlesQuarantined += repaired.articlesQuarantined;
      }
    }
    const inspected = await ctx.runAction(
      internal.actions.cadenceMicroSeed.recoverCadenceGap,
      { siteId, mode: "inspect" },
    ) as {
      ready?: boolean;
      inspectionKey?: string;
      reservationDay?: string;
      rolloutEpoch?: number;
      sourcePlanId?: Id<"jobs">;
      sourcePlanFingerprint?: string;
      attemptKind?: "primary" | "fallback";
      parentMicroSeedJobId?: Id<"cadence_micro_seed_jobs">;
      parentMicroSeedReceiptFingerprint?: string;
      providerCostCeilingMicroUsd?: number;
      reason?: string;
    };
    if (
      inspected.ready !== true ||
      !inspected.inspectionKey ||
      !inspected.reservationDay ||
      typeof inspected.rolloutEpoch !== "number" ||
      !inspected.sourcePlanId ||
      !inspected.sourcePlanFingerprint ||
      !inspected.attemptKind ||
      typeof inspected.providerCostCeilingMicroUsd !== "number"
    ) return {
      applied: false,
      reason: inspected.reason ?? "not_ready",
      legacyTopicsQuarantined,
      legacyArticlesQuarantined,
    };
    try {
      const applied = await ctx.runAction(
        internal.actions.cadenceMicroSeed.recoverCadenceGap,
        {
          siteId,
          mode: "apply",
          inspectionKey: inspected.inspectionKey,
          reservationDay: inspected.reservationDay,
          rolloutEpoch: inspected.rolloutEpoch,
          sourcePlanId: inspected.sourcePlanId,
          sourcePlanFingerprint: inspected.sourcePlanFingerprint,
          attemptKind: inspected.attemptKind,
          parentMicroSeedJobId: inspected.parentMicroSeedJobId,
          parentMicroSeedReceiptFingerprint:
            inspected.parentMicroSeedReceiptFingerprint,
          providerCostCeilingMicroUsd:
            inspected.providerCostCeilingMicroUsd,
        },
      );
      return {
        ...(applied as Record<string, unknown>),
        legacyTopicsQuarantined,
        legacyArticlesQuarantined,
      };
    } catch (error) {
      return {
        applied: false,
        reason: stableFailureCode(error),
        legacyTopicsQuarantined,
        legacyArticlesQuarantined,
      };
    }
  },
});

export const finalizeCadenceMicroSeed = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const state = await ctx.runQuery(api.getFinalizationStateInternal, args);
    if (!state?.site || !state.topic || !state.evidence) {
      await raiseMiss(ctx, args.siteId, args.jobId, "evidence_state_unavailable");
      return { finalized: false, reason: "evidence_state_unavailable" };
    }
    if (
      state.linkedArticleId ||
      state.activeArticleJob ||
      ["queued", "used"].includes(state.topic.status ?? "planned")
    ) {
      return ctx.runMutation(api.finalizeEvidence, {
        ...args,
        outcome: "already_consumed",
        reason: "topic_already_consumed",
      });
    }

    const evidence = state.evidence;
    if (evidence.status === "completed") {
      const eligible = evidence.persistedTopics === 1 &&
        state.topic.expectedClickBackfillVersion ===
          EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
        state.topic.expectedClickBackfillJobId === evidence._id &&
        state.topic.expectedClickAuditVersion === EXPECTED_CLICK_PORTFOLIO_VERSION &&
        state.topic.expectedClickStatus === "eligible" &&
        Number.isFinite(state.topic.expectedClicksMonthly) &&
        (state.topic.expectedClicksMonthly ?? 0) > 0;
      const serpFailure = evidence.serpFailures[0]?.code;
      const reason = eligible
        ? "eligible"
        : serpFailure ??
          (evidence.insufficientTopics
            ? "insufficient_expected_click_evidence"
            : "evidence_not_persisted");
      const finalized = await ctx.runMutation(api.finalizeEvidence, {
        ...args,
        outcome: eligible ? "eligible" : "semantic_failure",
        reason,
      });
      if (!eligible && !finalized.retryQueued) {
        await raiseMiss(ctx, args.siteId, args.jobId, reason);
      }
      return finalized;
    }

    const preCallBlocked = evidence.providerCallsAttempted === 0 &&
      ["provider_balance_unavailable", "partial"].includes(evidence.status);
    if (preCallBlocked) {
      const finalized = await ctx.runMutation(api.finalizeEvidence, {
        ...args,
        outcome: "precall_blocked",
        reason: evidence.errorCode ?? "evidence_pre_call_blocked",
      });
      await raiseMiss(
        ctx,
        args.siteId,
        args.jobId,
        evidence.errorCode ?? "evidence_pre_call_blocked",
      );
      return finalized;
    }

    const ambiguous = evidence.providerCallsAttempted >
        evidence.providerCallsCompleted ||
      (evidence.status === "partial" && evidence.providerCallsAttempted > 0) ||
      (evidence.authorityDomains !== undefined &&
        evidence.authoritySnapshotComplete !== true);
    if (ambiguous) {
      const finalized = await ctx.runMutation(api.finalizeEvidence, {
        ...args,
        outcome: "evidence_unverified",
        reason: "provider_attempt_ambiguous",
      });
      await raiseMiss(ctx, args.siteId, args.jobId, "provider_attempt_ambiguous");
      return finalized;
    }

    const attempt = await ctx.runMutation(api.incrementFinalizeAttempt, args);
    if (attempt.incremented && !attempt.exhausted) {
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_FINALIZE_DELAY_MS,
        internal.actions.cadenceMicroSeed.finalizeCadenceMicroSeed,
        args,
      );
      return { finalized: false, waiting: true, attempts: attempt.attempts };
    }
    const finalized = await ctx.runMutation(api.finalizeEvidence, {
      ...args,
      outcome: "unresolved",
      reason: `evidence_${evidence.status}_after_${CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS}_checks`,
    });
    await raiseMiss(ctx, args.siteId, args.jobId, "evidence_unresolved");
    return finalized;
  },
});
