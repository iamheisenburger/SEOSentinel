import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { accountDeletionKey, accountDeletionTombstoneUserId } from "./accountDeletion.ts";

export const MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD = 35_000_000;
export const MAX_CUMULATIVE_VALIDATION_MICRO_USD = 20_000_000;

/** A stopped/expired validation run never falls back to ordinary spending.
 * Its stable existing approval row remains authoritative across UTC months. */
export function validCumulativeValidationAuthorization(
  row: Doc<"provider_budget_authorizations"> | null, userId: string, timestamp: number,
) {
  return row?.accountKey === accountDeletionKey(userId) && validValidationContract(row, timestamp);
}
function validValidationContract(row: Doc<"provider_budget_authorizations"> | null, timestamp: number) {
  const run = row?.cumulativeValidation;
  return Boolean(row && run &&
    Number.isSafeInteger(timestamp) && Number.isSafeInteger(run.approvedAt) &&
    run.approvedAt <= timestamp && run.siteIds?.length === 2 && new Set(run.siteIds).size === 2 &&
    (run.expiresAt === undefined || (Number.isSafeInteger(run.expiresAt) && run.expiresAt > run.approvedAt)) &&
    (run.stoppedAt === undefined || (Number.isSafeInteger(run.stoppedAt) && run.stoppedAt >= run.approvedAt)) &&
    (run.independentFunding === undefined || (run.independentFunding.scope === "additional_provider_allowance" &&
      /^[a-zA-Z0-9_-]{8,128}$/.test(run.independentFunding.approvalReference) &&
      ![run.approvalReference, row!.approvalReference].includes(run.independentFunding.approvalReference))) &&
    Number.isSafeInteger(run.limitMicroUsd) && run.limitMicroUsd > 0 && run.limitMicroUsd <= MAX_CUMULATIVE_VALIDATION_MICRO_USD &&
    /^[a-zA-Z0-9_-]{8,128}$/.test(run.approvalReference));
}

/** Prospective readiness uses the saved schedule; execution uses immutable job
 * and reservation lineage. Neither caller arguments nor a month change can
 * opt an existing job out. Ordinary, unbound work has no validation grant. */
export async function contentValidationBinding(ctx: QueryCtx | MutationCtx, site: Doc<"sites">,
  timestamp: number, job?: Doc<"jobs"> | null) {
  const id = job ? job.contentWork?.validationAuthorizationId : site.contentSchedule?.validationAuthorizationId;
  const anchor = id ? await ctx.db.get(id) : null, run = anchor?.cumulativeValidation;
  if (job) {
    if (job.siteId !== site._id || !job.contentWork) throw new Error("Content validation job binding invalid");
    if (!id && site.contentSchedule?.validationAuthorizationId) {
      const scheduled = await ctx.db.get(site.contentSchedule.validationAuthorizationId);
      if (!site.userId || !validCumulativeValidationAuthorization(scheduled, site.userId, timestamp) ||
        job.createdAt >= scheduled!.cumulativeValidation!.approvedAt) throw new Error("Content validation run omitted from bound work");
    }
    for (const reservationId of [job.providerSpendReservationId, ...(job.contentWork.priorReservationIds ?? [])]) {
      if (!reservationId) continue;
      const receipt = await ctx.db.get(reservationId);
      if (!receipt || receipt.validationAuthorizationId !== id || (id && receipt.contentWorkJobId !== job._id) ||
        receipt.independentFundingApprovalReference !== run?.independentFunding?.approvalReference) {
        throw new Error("Content validation reservation lineage changed");
      }
    }
  }
  if (!id) return null;
  if (!site.userId || !validCumulativeValidationAuthorization(anchor, site.userId, timestamp) || !run ||
    !run.siteIds.includes(site._id) || (job && job.createdAt < run.approvedAt) ||
    site.contentSchedule?.validationAuthorizationId !== id) throw new Error("Content validation scope changed");
  return { id, run, state: run.stoppedAt !== undefined ? "stopped" as const :
    run.expiresAt !== undefined && timestamp >= run.expiresAt ? "expired" as const : "active" as const };
}

/** A receipt's funding source is fixed at admission, never inferred from its
 * purpose or a caller flag. Missing/corrupt scope cannot become an exemption.
 * A stopped run still owns its past costs; lifecycle never reclassifies them. */
export function validationReservationMatches(row: Doc<"provider_spend_reservations">,
  anchor: Doc<"provider_budget_authorizations"> | null, timestamp: number) {
  const run = anchor?.cumulativeValidation;
  return Boolean(anchor && run && row.validationAuthorizationId === anchor._id &&
    (validCumulativeValidationAuthorization(anchor, row.userId, timestamp) ||
      (row.siteId === undefined && row.userId === accountDeletionTombstoneUserId(anchor.accountKey) && validValidationContract(anchor, timestamp))) &&
    row.contentWorkJobId && row.purpose === "content_work" &&
    (row.siteId === undefined || run.siteIds.includes(row.siteId)) &&
    Number.isSafeInteger(row.reservedMicroUsd) && row.reservedMicroUsd > 0 &&
    Number.isSafeInteger(row.createdAt) && row.createdAt >= run.approvedAt && row.createdAt <= timestamp &&
    row.independentFundingApprovalReference === run.independentFunding?.approvalReference);
}

/** Same ledger, disjoint accounting scopes. Keep old unmarked receipts exactly
 * as they were; exclude only a receipt backed by an explicitly independent run.
 * No expired/stopped/monthly approval can put that cost onto ordinary work. */
export async function ordinaryProviderReservationRows(ctx: QueryCtx | MutationCtx,
  rows: Doc<"provider_spend_reservations">[], timestamp: number) {
  const anchors = new Map<string, Doc<"provider_budget_authorizations"> | null>();
  const ordinary: Doc<"provider_spend_reservations">[] = [];
  for (const row of rows) {
    if (!row.validationAuthorizationId) {
      if (row.independentFundingApprovalReference !== undefined) throw new Error("Provider funding receipt is incomplete");
      ordinary.push(row); continue;
    }
    const id = row.validationAuthorizationId;
    if (!anchors.has(id)) anchors.set(id, await ctx.db.get(id));
    const anchor = anchors.get(id)!;
    if (!row.independentFundingApprovalReference && !anchor?.cumulativeValidation?.independentFunding) {
      ordinary.push(row); continue; // Original approvals retain original accounting.
    }
    if (!validationReservationMatches(row, anchor, timestamp)) throw new Error("Provider funding receipt binding is invalid");
    if (!row.independentFundingApprovalReference) ordinary.push(row);
  }
  return ordinary;
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
