import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
  automaticSingleExecutionCheckpointTargetFromPayload,
} from "./planProviderBudget.ts";
import { classifyCadenceFailure } from "./cadenceLiveness.ts";
import { settleSharedProviderReservation } from "./providerSpendReservation.ts";

/** Retain the complete spent execution ceiling, not an invented actual cost.
 * Only a conclusively terminal single-execution checkpoint plan can retire
 * its unused second execution. Pending, ambiguous, retried and legacy plans
 * retain their complete reservation. authorizeSingleExecution also rejects a
 * settled reservation, permanently fencing subsequent provider work. */
export async function retireSingleExecutionPlanContingencies(
  ctx: MutationCtx,
  site: Doc<"sites">,
  timestamp: number,
): Promise<{ examined: number; retired: number; reclaimedMicroUsd: number }> {
  const month = new Date(timestamp);
  const monthStart = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const jobs = await ctx.db.query("jobs")
    .withIndex("by_site_type_created", q =>
      q.eq("siteId", site._id).eq("type", "plan").gte("createdAt", monthStart))
    .order("desc").take(32);
  let retired = 0;
  for (const job of jobs) {
    if (job.siteId !== site._id || job.type !== "plan" ||
        !["done", "failed"].includes(job.status) || job.workerAttempts !== 0 ||
        job.workerToken !== undefined || job.leaseExpiresAt !== undefined ||
        job.nextAttemptAt !== undefined || job.updatedAt > timestamp ||
        !automaticSingleExecutionCheckpointTargetFromPayload(job.payload) ||
        job.providerCostCeilingMicroUsd !== AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
        job.providerCostReservedMicroUsd !== AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
        job.providerReservationReleasedAt !== undefined ||
        !job.providerSpendReservationId) continue;
    if (job.status === "failed" && (
      job.cadenceFailure?.category !== "semantic_zero_yield" ||
      job.cadenceFailure.terminal !== true ||
      classifyCadenceFailure({ message: job.error ?? "", now: job.updatedAt }).category !== "semantic_zero_yield"
    )) continue;
    const checkpoints = await ctx.db.query("plan_candidate_checkpoints")
      .withIndex("by_plan_job", q => q.eq("planJobId", job._id)).take(2);
    // stage() also closes zero-candidate manifests as `empty`. They consumed
    // their first discovery execution but can never use the reserved second
    // execution. Require the complete empty-manifest/ledger binding rather
    // than treating any terminal-looking checkpoint as a refund receipt.
    const emptyExecutionClosed = (checkpoint: Doc<"plan_candidate_checkpoints">) =>
      job.status === "failed" && checkpoint.status === "empty" &&
      checkpoint.userId === site.userId &&
      checkpoint.providerSpendReservationId === job.providerSpendReservationId &&
      checkpoint.providerCostReservedMicroUsd === job.providerCostReservedMicroUsd &&
      checkpoint.providerCostCeilingMicroUsd === job.providerCostCeilingMicroUsd &&
      checkpoint.reservationDay === job.providerCostReservationDay &&
      checkpoint.candidateTopicIds.length === 0 && checkpoint.candidateFingerprints.length === 0 &&
      (checkpoint.inlineCompletedTopicIds?.length ?? 0) === 0 &&
      (checkpoint.terminallyExcludedTopicIds?.length ?? 0) === 0 &&
      (checkpoint.activatedTopicIds?.length ?? 0) === 0 &&
      checkpoint.activatedAt === undefined && checkpoint.activationScheduledAt === undefined &&
      checkpoint.completedAt !== undefined && Number.isFinite(checkpoint.completedAt) &&
      checkpoint.completedAt >= job.createdAt && checkpoint.completedAt <= job.updatedAt;
    if (checkpoints.length > 1 || (job.status === "done" && checkpoints.length !== 1) ||
        checkpoints.some(checkpoint => checkpoint.siteId !== site._id ||
          checkpoint.planJobId !== job._id || checkpoint.workerExecution !== 1 ||
          (checkpoint.status !== (job.status === "done" ? "inline_completed" : "terminal_blocked") &&
            !emptyExecutionClosed(checkpoint)))) continue;
    const reservation = await ctx.db.get(job.providerSpendReservationId);
    if (!reservation || reservation.siteId !== site._id || reservation.userId !== site.userId ||
        reservation.purpose !== "topic_plan" || reservation.trigger !== "topic_plan" ||
        reservation.reservedMicroUsd !== AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
        reservation.createdAt !== job.createdAt ||
        reservation.reservationDay !== job.providerCostReservationDay ||
        reservation.reservationDay !== new Date(job.createdAt).toISOString().slice(0, 10) ||
        reservation.releasedAt !== undefined || reservation.settledAt !== undefined ||
        reservation.settledMicroUsd !== undefined) continue;
    const result = await settleSharedProviderReservation(ctx, {
      reservationId: reservation._id, siteId: site._id, purpose: "topic_plan",
      actualMicroUsd: AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
      reason: "single_execution_plan_contingency_retired", timestamp,
    });
    if (result.settled) retired += 1;
  }
  return { examined: jobs.length, retired,
    reclaimedMicroUsd: retired * (AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD -
      AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD) };
}
