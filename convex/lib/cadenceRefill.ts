/** Bounded discovery capacity, independent of article quality admission. */
export const CADENCE_REFILL_RECHECK_MS = 15 * 60 * 1000;

export function topicReplenishmentBudget(cadencePerWeek: number): number {
  const dailyDemand = Number.isFinite(cadencePerWeek) && cadencePerWeek > 0
    ? Math.ceil(Math.min(21, cadencePerWeek) / 7)
    : 1;
  return dailyDemand + 2;
}

/** A click-goal audit may wait a day; a missing publication buffer may not. */
export function cadencePlanDailyLimit(
  cadencePerWeek: number,
  targetBufferShortfall: number,
): number {
  return Number.isFinite(targetBufferShortfall) && targetBufferShortfall > 0
    ? topicReplenishmentBudget(cadencePerWeek)
    : 1;
}

/**
 * A semantic miss remains terminal for its original paid job. A distinct
 * strategy can be considered after a short backoff when the current buffer
 * is underfilled. Queue, entitlement and shared spend limits still apply.
 * Funding, transport, safety and ambiguous failures keep their own deadlines.
 */
export function cadencePlanFailureEligibleAt(args: {
  failure?: { category: string; terminal: boolean; eligibleAt?: number };
  planCreatedAt: number;
  targetBufferShortfall: number;
}): number | undefined {
  const { failure } = args;
  if (
    failure?.category !== "semantic_zero_yield" || !failure.terminal ||
    !Number.isFinite(args.targetBufferShortfall) || args.targetBufferShortfall <= 0 ||
    !Number.isSafeInteger(args.planCreatedAt) || args.planCreatedAt < 0
  ) return failure?.eligibleAt;
  const retryAt = args.planCreatedAt + CADENCE_REFILL_RECHECK_MS;
  if (!Number.isSafeInteger(retryAt)) return failure.eligibleAt;
  return failure.eligibleAt === undefined ? retryAt : Math.min(retryAt, failure.eligibleAt);
}

/** Newest-first complete window; wake when the next counted slot expires. */
export function nextPlanWindowSlotAt(
  counted: readonly { createdAt: number }[],
  maximumRecent: number,
): number | undefined {
  if (!Number.isSafeInteger(maximumRecent) || maximumRecent < 1) return undefined;
  const slot = counted[maximumRecent - 1];
  if (!slot || !Number.isSafeInteger(slot.createdAt) || slot.createdAt < 0) return undefined;
  const dueAt = slot.createdAt + 24 * 60 * 60 * 1000 + 1_000;
  return Number.isSafeInteger(dueAt) ? dueAt : undefined;
}
