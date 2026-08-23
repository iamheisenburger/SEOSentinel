"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import { internalAction } from "../_generated/server.js";
import type { ActionCtx } from "../_generated/server.js";
import { v } from "convex/values";
import {
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
} from "../lib/expectedClickDemandBackfill.ts";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
} from "../lib/expectedClickEvidenceBackfill.ts";
import {
  selectPlannedRecoveryPhase,
} from "../lib/plannedTopicEvidenceRecovery.ts";

const PLANNED_RECOVERY_COMBINED_CEILING_MICRO_USD =
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD +
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD;

type PlannedRecoveryDescriptor = {
  phase: "demand" | "evidence";
  inspectionDay: string;
  rolloutEpoch: number;
  selected: Array<{
    topicId: Id<"topic_clusters">;
    keyword: string;
    fingerprint: string;
  }>;
};

function plannedRecoveryInspectionKey(
  siteId: Id<"sites">,
  descriptor: PlannedRecoveryDescriptor,
): string {
  return createHash("sha256").update(JSON.stringify({
    contract: "planned-topic-evidence-recovery-v1",
    siteId: String(siteId),
    phase: descriptor.phase,
    inspectionDay: descriptor.inspectionDay,
    rolloutEpoch: descriptor.rolloutEpoch,
    artifactCandidates: 0,
    selected: descriptor.selected.map((item) => ({
      topicId: String(item.topicId),
      keyword: item.keyword,
      fingerprint: item.fingerprint,
    })),
  })).digest("hex");
}

async function inspectPlannedRecovery(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<
  | ({ ready: true; inspectionKey: string } & PlannedRecoveryDescriptor)
  | { ready: false; reason: string; demand?: unknown; evidence?: unknown }
> {
  const [demand, evidence] = await Promise.all([
    ctx.runQuery(
      internal.expectedClickDemandBackfill.getFleetReadinessInternal,
      { siteId },
    ),
    ctx.runQuery(
      internal.expectedClickEvidenceBackfill.getFleetReadinessInternal,
      { siteId },
    ),
  ]);
  const demandRecord = demand as null | {
    ready?: boolean;
    reason?: string;
    reservationDay?: string;
    rolloutEpoch?: number;
    candidateCounts?: { artifactEligible?: number };
    plannedSelection?: PlannedRecoveryDescriptor["selected"];
  };
  const evidenceRecord = evidence as null | {
    ready?: boolean;
    reason?: string;
    reservationDay?: string;
    rolloutEpoch?: number;
    candidateCounts?: { artifactEligible?: number };
    plannedSelection?: PlannedRecoveryDescriptor["selected"];
  };
  const candidate = selectPlannedRecoveryPhase(demandRecord, evidenceRecord);
  if (!candidate) {
    return {
      ready: false,
      reason: demandRecord?.reason ?? evidenceRecord?.reason ?? "site_unavailable",
      demand: demandRecord,
      evidence: evidenceRecord,
    };
  }
  const descriptor: PlannedRecoveryDescriptor = {
    phase: candidate.phase,
    inspectionDay: candidate.inspectionDay,
    rolloutEpoch: candidate.rolloutEpoch,
    selected: candidate.selected,
  };
  return {
    ready: true,
    ...descriptor,
    inspectionKey: plannedRecoveryInspectionKey(siteId, descriptor),
  };
}

function queuedSuccessfully(result: unknown): result is { queued: true } {
  return Boolean(
    result && typeof result === "object" &&
      "queued" in result && result.queued === true,
  );
}

function resultReason(result: unknown): string {
  if (
    result && typeof result === "object" && "reason" in result &&
    typeof result.reason === "string"
  ) return result.reason;
  return "planned_recovery_not_queued";
}

/**
 * Operator-only, inspect-first bridge for a funded but plan-attempt-exhausted
 * tenant. Inspect is provider-free. Apply recomputes and atomically binds the
 * exact day/epoch/phase/ordered topic fingerprints before the ordinary $0.10
 * demand or evidence reservation can be created.
 */
export const recoverPlannedTopicEvidence = internalAction({
  args: {
    siteId: v.id("sites"),
    mode: v.union(v.literal("inspect"), v.literal("apply")),
    inspectionKey: v.optional(v.string()),
    inspectionDay: v.optional(v.string()),
    rolloutEpoch: v.optional(v.number()),
    phase: v.optional(v.union(v.literal("demand"), v.literal("evidence"))),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const inspected = await inspectPlannedRecovery(ctx, args.siteId);
    if (args.mode === "inspect" || !inspected.ready) {
      return {
        ...inspected,
        providerCallsMade: 0,
        planReservationsCreated: 0,
        demandCeilingMicroUsd:
          EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
        evidenceCeilingMicroUsd:
          EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
        combinedCeilingMicroUsd:
          PLANNED_RECOVERY_COMBINED_CEILING_MICRO_USD,
      };
    }
    if (
      !args.inspectionKey ||
      args.inspectionKey !== inspected.inspectionKey ||
      args.inspectionDay !== inspected.inspectionDay ||
      args.rolloutEpoch !== inspected.rolloutEpoch ||
      args.phase !== inspected.phase
    ) {
      return {
        applied: false,
        reason: "planned_recovery_inspection_stale",
        current: inspected,
      };
    }
    const plannedRecoveryGuard = {
      inspectionDay: inspected.inspectionDay,
      rolloutEpoch: inspected.rolloutEpoch,
      inspectionKey: inspected.inspectionKey,
      selected: inspected.selected,
    };
    const result = inspected.phase === "demand"
      ? await ctx.runAction(
          internal.actions.expectedClickDemandBackfill
            .queueExpectedClickDemandBackfill,
          {
            siteId: args.siteId,
            policyVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
            plannedRecoveryGuard,
          },
        )
      : await ctx.runAction(
          internal.actions.expectedClickEvidenceBackfill
            .queueExpectedClickEvidenceBackfill,
          {
            siteId: args.siteId,
            policyVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
            plannedRecoveryGuard,
          },
        );
    const applied = queuedSuccessfully(result);
    return {
      applied,
      phase: inspected.phase,
      inspectionKey: inspected.inspectionKey,
      ...(!applied ? { reason: resultReason(result) } : {}),
      result,
    };
  },
});
