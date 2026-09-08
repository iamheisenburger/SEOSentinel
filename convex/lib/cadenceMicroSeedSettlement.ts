import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { CADENCE_MICRO_SEED_VERSION } from "./cadenceMicroSeed.ts";
import { releaseSharedProviderReservation } from "./providerSpendReservation.ts";

/** A terminal job is refundable only with durable proof it never crossed the
 * paid boundary. v11's historical worker (and later workers) commits attempted,
 * timestamp and request tag before HTTP; none may be missing by inference.
 * Re-read in the caller's transaction: a concurrent begin/close/settle conflicts
 * on this job/ledger pair. Keep terminal status, attempts and source markers
 * unchanged so releasing unused money cannot authorize a replay. */
export async function releaseClosedMicroSeedBeforeProvider(
  ctx: MutationCtx,
  site: Pick<Doc<"sites">, "_id" | "userId">,
  jobId: Id<"cadence_micro_seed_jobs">,
  timestamp: number,
): Promise<{ released: boolean; reclaimedMicroUsd: number }> {
  const noRelease = { released: false, reclaimedMicroUsd: 0 };
  const job = await ctx.db.get(jobId);
  if (!site.userId || !job || job.siteId !== site._id || job.userId !== site.userId ||
      !["missed", "failed", "cancelled", "expired"].includes(job.status) ||
      !Number.isSafeInteger(job.policyVersion) || job.policyVersion < 11 || job.policyVersion > CADENCE_MICRO_SEED_VERSION ||
      job.providerCallAttempted !== false || job.providerCallCompleted !== false ||
      job.providerAttemptedAt !== undefined || job.providerCompletedAt !== undefined ||
      job.providerRequestTag !== undefined || job.providerTaskCostUsd !== undefined ||
      job.workerToken !== undefined || job.leaseExpiresAt !== undefined ||
      !Number.isSafeInteger(job.workerAttempts) || job.workerAttempts < 0 ||
      !Number.isFinite(timestamp) || !Number.isFinite(job.createdAt) ||
      job.completedAt === undefined || !Number.isFinite(job.completedAt) ||
      job.completedAt < job.createdAt || job.completedAt > timestamp ||
      !Number.isFinite(job.updatedAt) || job.updatedAt < job.completedAt || job.updatedAt > timestamp ||
      job.candidateReceipts.length !== 0 || job.candidateAudit !== undefined ||
      job.selectedCandidate !== undefined || (job.candidateShortlist?.length ?? 0) !== 0 ||
      (job.priorCandidateAttempts?.length ?? 0) !== 0 || (job.candidateAttemptCount ?? 0) !== 0 ||
      job.topicId !== undefined || job.evidenceJobId !== undefined ||
      (job.attemptKind !== undefined && !["primary", "fallback"].includes(job.attemptKind))) return noRelease;
  const purpose = job.attemptKind === "fallback" ? "cadence_micro_seed_fallback" : "cadence_micro_seed";
  const reservation = await ctx.db.get(job.providerSpendReservationId);
  if (!reservation || reservation.siteId !== site._id || reservation.userId !== site.userId ||
      reservation.purpose !== purpose || reservation.trigger !== `${purpose}_v${job.policyVersion}` ||
      !Number.isSafeInteger(reservation.reservedMicroUsd) || reservation.reservedMicroUsd <= 0 ||
      reservation.reservedMicroUsd !== job.providerCostReservedMicroUsd ||
      reservation.reservedMicroUsd !== job.providerCostCeilingMicroUsd ||
      reservation.createdAt !== job.createdAt || reservation.reservationDay !== job.reservationDay ||
      reservation.reservationDay !== new Date(job.createdAt).toISOString().slice(0, 10) ||
      reservation.reservationMonth !== new Date(job.createdAt).toISOString().slice(0, 7) ||
      reservation.releasedAt !== undefined || reservation.settledAt !== undefined ||
      reservation.settledMicroUsd !== undefined) return noRelease;
  const result = await releaseSharedProviderReservation(ctx, {
    reservationId: reservation._id, siteId: site._id, purpose,
    reason: "micro_seed_closed_before_provider_execution", timestamp,
  });
  return { released: result.released,
    reclaimedMicroUsd: result.released ? reservation.reservedMicroUsd : 0 };
}
