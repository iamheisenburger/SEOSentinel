import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolvePlanFromFeatures } from "../planLimits";
import { readProviderBudgetAuthorization, providerBudgetMonth, ordinaryProviderReservationRows, contentValidationBinding } from "./providerBudgetAuthorization";
import { inspectSharedProviderBudget, providerAccountMonthlyCeilingMicroUsd, providerReservationConsumedMicroUsd,
  PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD } from "./providerSpendReservation";
import { internalContentProcessingError } from "./contentAudit";

// Browser-facing copy is selected, never raw exception/provider payload text.
export function contentIssue(reason?: string) {
  if (!reason) return null;
  if (reason === "owner_rejected_draft") return "You declined this draft. It will not publish. You can request a new draft; previous work and spending remain recorded.";
  if (reason === "owner_edited_draft") return "A separately reviewed edit replaces this draft. The original content and spending remain in history.";
  if (reason === "content_model_response_invalid") return "The generation service returned an incomplete response. No publication occurred. Your saved draft and costs are retained; edit an available draft or explicitly request new work.";
  if (internalContentProcessingError(reason)) return "Pentra encountered an internal processing error. Our team must repair it. Your drafts, spending history and original deadline are preserved. You do not need to change your plan or fund a provider.";
  if (reason.includes("wordpress_receipt_update_required")) return "Update the Pentra WordPress connector to 1.1.0 or newer, then recheck this retained delivery. Do not publish another copy.";
  if (reason === "content_provider_credit_unavailable") return "Pentra's generation service is interrupted. Our team must restore it; you do not need to fund a provider or change your plan. Your original delivery deadline and prior attempt remain visible.";
  if (/budget|funding|reservation|priced/i.test(reason)) return "Spending capacity is unavailable. Review billing and the retained spending commitments; no limit was raised.";
  if (/permission|source|revision|conflict|customer|binding|destination|profile|409|412/i.test(reason)) return "The page, permission, business profile or destination changed. Review the current source; customer edits will not be overwritten.";
  if (/quality|audit|review|candidate|draft/i.test(reason)) return "Content did not pass the required review. Bounded retries remain visible; a failed slot is not silently replaced.";
  if (/verif|public|canonical|render|receipt/i.test(reason)) return "The live artifact is not yet verified. Pentra must reconcile the existing delivery before another write.";
  if (/entitlement|plan|billing/i.test(reason)) return "The current billing entitlement must be verified before work can continue.";
  return "This work needs reconciliation. Its original deadline, attempts and spending are retained. Contact support with the work reference.";
}

export async function contentFunding(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, budgetMicroUsd: number | undefined) {
  const now = Date.now(), window = providerBudgetMonth(now);
  const entitlement = site.userId ? await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique() : null;
  const base = providerAccountMonthlyCeilingMicroUsd(resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier);
  const authorization = site.userId ? await readProviderBudgetAuthorization(ctx, entitlement, site.userId, base, now) : null;
  const limit = authorization?.monthlyCeilingMicroUsd ?? base;
  // Own-account projection only; never returns another customer's ledger rows.
  const rows = site.userId ? await ctx.db.query("provider_spend_reservations").withIndex("by_user", q => q.eq("userId", site.userId!)).order("desc").take(2001) : [];
  let complete = rows.length <= 2000, ordinary = rows;
  try { ordinary = await ordinaryProviderReservationRows(ctx, rows, now); } catch { complete = false; }
  const current = ordinary.filter(r => r.createdAt >= window.startAt && r.releasedAt === undefined);
  const consumed = current.reduce((s, r) => s + providerReservationConsumedMicroUsd(r), 0);
  const settled = current.filter(r => r.settlementReason === "verified_provider_receipt_actual_cost").reduce((s, r) => s + providerReservationConsumedMicroUsd(r), 0);
  const dayStart = new Date(now).setUTCHours(0, 0, 0, 0);
  const daily = current.filter(r => r.createdAt >= dayStart).reduce((s, r) => s + providerReservationConsumedMicroUsd(r), 0);
  const incremental = authorization ? current.filter(r => r.createdAt >= authorization.approvedAt).reduce((s, r) => s + providerReservationConsumedMicroUsd(r), 0) : 0;
  const capacity = budgetMicroUsd && site.userId && complete ? await inspectSharedProviderBudget(ctx, {
    siteId: site._id, userId: site.userId, purpose: "content_work", trigger: "read_only_customer_readiness", reservedMicroUsd: budgetMicroUsd, timestamp: now,
  }) : null;
  let binding: Awaited<ReturnType<typeof contentValidationBinding>> = null;
  try { binding = await contentValidationBinding(ctx, site, now); } catch { /* Invalid funding stays blocked by admission. */ }
  return { status: !complete ? "unknown" as const : !budgetMicroUsd ? "unconfigured" as const : capacity?.ok ? "available" as const : "blocked" as const,
    independentAllowance: binding?.run.independentFunding ? { totalMicroUsd: binding.run.limitMicroUsd, state: binding.state,
      expiresAt: binding.run.expiresAt ?? null } : null,
    checkedAt: now, requestedMicroUsd: budgetMicroUsd ?? null, monthlyLimitMicroUsd: limit,
    settledActualMicroUsd: complete ? settled : null, heldCeilingMicroUsd: complete ? consumed - settled : null,
    accountAvailableMicroUsd: complete ? Math.max(0, Math.min(limit - consumed, PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD - daily,
      authorization ? authorization.incrementalLimitMicroUsd - incremental : Infinity)) : null,
    monthlyResetAt: window.endAt, dailyResetAt: dayStart + 86_400_000,
    incrementalLimitMicroUsd: authorization?.incrementalLimitMicroUsd ?? null,
    reason: capacity && !capacity.ok ? contentIssue(capacity.reason) : null,
    // An internal guard is not the provider's wallet. Do not fabricate a credit balance.
    providerCredit: "unverified" as const };
}
