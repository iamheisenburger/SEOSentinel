import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolvePlanFromFeatures } from "../planLimits.ts";
import { accountDeletionKey } from "./accountDeletion.ts";

export type PlanSiteCandidate = {
  siteId: string;
  creationTime: number;
  deleting?: boolean;
};

export type SiteExecutionState = {
  deletionStatus?: string;
  planParkedAt?: number;
  domainOwnershipConflictAt?: number;
};

/** A parked or deleting tenant remains readable to its owner but cannot run
 * paid work, provider calls, publication, or autonomous mutations. */
export function siteExecutionActive<T extends SiteExecutionState>(
  site: T | null | undefined,
): site is T {
  return Boolean(
    site &&
      !site.deletionStatus &&
      !site.planParkedAt &&
      !site.domainOwnershipConflictAt,
  );
}

/**
 * Database-aware entitlement fence. Existing installations without an
 * account receipt keep their current site-local behavior. Once billing has
 * written a receipt, execution pauses during bounded reconciliation and only
 * resumes when the site's canonical plan mirror matches the completed receipt.
 */
export async function siteExecutionAuthorized(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites"> | null | undefined,
): Promise<boolean> {
  if (!siteExecutionActive(site) || !site.userId) return false;
  const deletionReceipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) =>
      q.eq("accountKey", accountDeletionKey(site.userId!))
    )
    .unique();
  // A verified Clerk deletion is a permanent lifecycle fence. The completed
  // tombstone deliberately survives entitlement/site purge so delayed billing
  // webhooks or captured sessions cannot resurrect paid execution.
  if (deletionReceipt) return false;
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  if (!entitlement) {
    // Rollout stays legacy-open until the authoritative Clerk fleet backfill
    // has a completed, aggregate-audited receipt for every existing account.
    // The operator then flips this Convex environment gate; an unknown account
    // fails closed and is never silently reinterpreted as Free.
    return process.env.PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT !== "true";
  }
  if (entitlement.status !== "completed") return false;
  const sitePlan = resolvePlanFromFeatures(site.planFeatures ?? []);
  return (
    sitePlan.maxSites === entitlement.maxSites &&
    sitePlan.maxArticles === entitlement.maxArticles
  );
}

/**
 * A plan reconciliation must block every new external write immediately, but
 * it cannot erase the truth about a write whose exact lease was acquired
 * before that transition. Callers may use this only to settle a validated
 * provider receipt; it is never an authorization to perform another call.
 */
export async function executionLeasePredatesPlanTransition(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites"> | null | undefined,
  leaseStartedAt: number | undefined,
): Promise<boolean> {
  if (!site || site.deletionStatus || !leaseStartedAt || !site.userId) {
    return false;
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const transitionStartedAt = Math.max(
    site.planAllowanceChangedAt ?? 0,
    site.domainOwnershipConflictAt ?? 0,
    entitlement?.syncStartedAt ?? 0,
  );
  return transitionStartedAt > 0 && leaseStartedAt <= transitionStartedAt;
}

/**
 * Select the exact sites covered by the current plan. Convex document
 * creation time is immutable, and the id tie-breaker makes the result stable
 * even for imports whose creation timestamps are identical.
 */
export function selectPlanEntitledSiteIds(
  candidates: readonly PlanSiteCandidate[],
  maxSites: number,
): Set<string> {
  const allowance = Math.max(0, Math.floor(maxSites));
  return new Set(
    candidates
      .filter((candidate) => !candidate.deleting)
      .sort((left, right) =>
        left.creationTime - right.creationTime ||
        left.siteId.localeCompare(right.siteId)
      )
      .slice(0, allowance)
      .map((candidate) => candidate.siteId),
  );
}
