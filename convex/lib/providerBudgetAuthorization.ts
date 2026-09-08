import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { accountDeletionKey } from "./accountDeletion.ts";

export const MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD = 35_000_000;

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
