import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { accountDeletionKey } from "./accountDeletion.ts";

export const MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD = 35_000_000;
export const MAX_CUMULATIVE_VALIDATION_MICRO_USD = 20_000_000;

/** A stopped/expired validation run never falls back to ordinary spending.
 * Its stable existing approval row remains authoritative across UTC months. */
export function validCumulativeValidationAuthorization(
  row: Doc<"provider_budget_authorizations"> | null, userId: string, timestamp: number,
) {
  const run = row?.cumulativeValidation;
  return Boolean(row?.accountKey === accountDeletionKey(userId) && run &&
    Number.isSafeInteger(timestamp) && Number.isSafeInteger(run.approvedAt) &&
    run.approvedAt <= timestamp && run.siteIds?.length === 2 && new Set(run.siteIds).size === 2 &&
    (run.expiresAt === undefined || (Number.isSafeInteger(run.expiresAt) && run.expiresAt > run.approvedAt)) &&
    (run.stoppedAt === undefined || (Number.isSafeInteger(run.stoppedAt) && run.stoppedAt >= run.approvedAt)) &&
    Number.isSafeInteger(run.limitMicroUsd) && run.limitMicroUsd > 0 && run.limitMicroUsd <= MAX_CUMULATIVE_VALIDATION_MICRO_USD &&
    /^[a-zA-Z0-9_-]{8,128}$/.test(run.approvalReference));
}

/** Prospective readiness uses the saved schedule; execution uses immutable job
 * and reservation lineage. Neither caller arguments nor a month change can
 * opt an existing job out. Ordinary, unbound work has no validation grant. */
export async function contentValidationBinding(ctx: QueryCtx | MutationCtx, site: Doc<"sites">,
  timestamp: number, job?: Doc<"jobs"> | null) {
  const id = job ? job.contentWork?.validationAuthorizationId : site.contentSchedule?.validationAuthorizationId;
  if (job) {
    if (job.siteId !== site._id || !job.contentWork) throw new Error("Content validation job binding invalid");
    for (const reservationId of [job.providerSpendReservationId, ...(job.contentWork.priorReservationIds ?? [])]) {
      if (!reservationId) continue;
      const receipt = await ctx.db.get(reservationId);
      if (!receipt || receipt.validationAuthorizationId !== id || (id && receipt.contentWorkJobId !== job._id)) {
        throw new Error("Content validation reservation lineage changed");
      }
    }
  }
  if (!id) return null;
  const anchor = await ctx.db.get(id), run = anchor?.cumulativeValidation;
  if (!site.userId || !validCumulativeValidationAuthorization(anchor, site.userId, timestamp) || !run ||
    !run.siteIds.includes(site._id) || (job && job.createdAt < run.approvedAt) ||
    site.contentSchedule?.validationAuthorizationId !== id) throw new Error("Content validation scope changed");
  return { id, run, state: run.stoppedAt !== undefined ? "stopped" as const :
    run.expiresAt !== undefined && timestamp >= run.expiresAt ? "expired" as const : "active" as const };
}

export function providerBudgetMonth(timestamp: number) {
  const date = new Date(timestamp);
  return { month: date.toISOString().slice(0, 7),
    startAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    endAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}

/** Approval receipts survive site deletion and expire by the billing clock,
 * without a cron mutation. A plan change cannot inherit an older tier's lift. */
export function activeProviderBudgetAuthorization(
  authorization: Doc<"provider_budget_authorizations"> | null | undefined,
  userId: string,
  baseMonthlyCeilingMicroUsd: number,
  timestamp: number,
) {
  if (!authorization || !Number.isSafeInteger(timestamp) ||
      !Number.isSafeInteger(authorization.approvedAt) ||
      !Number.isSafeInteger(baseMonthlyCeilingMicroUsd)) return null;
  const window = providerBudgetMonth(timestamp);
  if (authorization.accountKey !== accountDeletionKey(userId) ||
      authorization.month !== window.month || authorization.windowStartAt !== window.startAt ||
      authorization.expiresAt !== window.endAt || authorization.approvedAt < window.startAt ||
      authorization.approvedAt > timestamp || timestamp >= authorization.expiresAt ||
      authorization.baseMonthlyCeilingMicroUsd !== baseMonthlyCeilingMicroUsd ||
      !Number.isSafeInteger(authorization.monthlyCeilingMicroUsd) ||
      authorization.monthlyCeilingMicroUsd <= baseMonthlyCeilingMicroUsd ||
      authorization.monthlyCeilingMicroUsd > MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD ||
      !Number.isSafeInteger(authorization.incrementalLimitMicroUsd) || authorization.incrementalLimitMicroUsd <= 0 ||
      authorization.incrementalLimitMicroUsd > authorization.monthlyCeilingMicroUsd - baseMonthlyCeilingMicroUsd) return null;
  return authorization;
}

export async function readProviderBudgetAuthorization(
  ctx: QueryCtx | MutationCtx,
  entitlement: Doc<"account_plan_entitlements"> | null,
  userId: string,
  baseMonthlyCeilingMicroUsd: number,
  timestamp: number,
) {
  const authorization = entitlement?.providerBudgetAuthorizationId
    ? await ctx.db.get(entitlement.providerBudgetAuthorizationId) : null;
  return activeProviderBudgetAuthorization(authorization, userId, baseMonthlyCeilingMicroUsd, timestamp);
}
