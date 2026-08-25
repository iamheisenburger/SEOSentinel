import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

import { accountDeletionKey } from "./accountDeletion.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./oneSetup.ts";
import {
  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
} from "./oneSetupInitialPlan.ts";
import {
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./siteDomainBinding.ts";

export type OneSetupInitialPlanCurrency =
  | { kind: "not_one_setup" }
  | {
      kind: "current";
      requestId: Id<"managed_provisioning_requests">;
    }
  | { kind: "stale"; reason: string };

/**
 * Validate the stable request/generation fence carried by a one-setup plan.
 * Legacy receipts become executable only after saveOneSetupRequest proves and
 * atomically enriches their exact request/execution binding. An unstamped job
 * is never directly authorized. The same check is used immediately before
 * paid work and inside the atomic topic/job commit.
 */
export async function oneSetupInitialPlanCurrency(
  ctx: QueryCtx | MutationCtx,
  args: {
    site: Doc<"sites">;
    job: Doc<"jobs">;
  },
): Promise<OneSetupInitialPlanCurrency> {
  const payload = args.job.payload && typeof args.job.payload === "object"
    ? args.job.payload as Record<string, unknown>
    : {};
  if (
    payload.manual !== true ||
    payload.reason !== "one_setup_initial_plan"
  ) return { kind: "not_one_setup" };

  const stableFields = [
    payload.oneSetupRequestId,
    payload.oneSetupInitialPlanReceiptVersion,
    payload.oneSetupInitialPlanGeneration,
    payload.oneSetupCanonicalDomainRevision,
  ];
  if (stableFields.every((value) => value === undefined)) {
    return { kind: "stale", reason: "legacy_receipt_unmigrated" };
  }
  if (
    stableFields.some((value) => value === undefined) ||
    payload.oneSetupInitialPlanReceiptVersion !==
      ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION ||
    !Number.isSafeInteger(payload.oneSetupInitialPlanGeneration) ||
    (payload.oneSetupInitialPlanGeneration as number) <= 0
  ) {
    return { kind: "stale", reason: "receipt_payload_invalid" };
  }

  const requestId = ctx.db.normalizeId(
    "managed_provisioning_requests",
    String(payload.oneSetupRequestId),
  );
  if (!requestId) {
    return { kind: "stale", reason: "receipt_payload_invalid" };
  }
  const request = await ctx.db.get(requestId);
  const currentDomain = siteCanonicalDomain(args.site);
  const currentCanonicalDomainRevision =
    siteCanonicalDomainRevision(args.site);
  const legacyUnstampedAllowed = siteUsesLegacyDomainReceipts(args.site);
  if (
    !args.site.userId ||
    args.job.siteId !== args.site._id ||
    !request ||
    request.siteId !== args.site._id ||
    request.ownerAccountKey !== accountDeletionKey(args.site.userId) ||
    request.domainSnapshot !== currentDomain ||
    request.contractVersion !== ONE_SETUP_CONTRACT_VERSION
  ) {
    return { kind: "stale", reason: "tenant_contract_changed" };
  }
  if (!oneSetupInitialPlanJobBindingMatches({
    requestId: String(request._id),
    requestPlanJobId: request.initialPlanJobId
      ? String(request.initialPlanJobId)
      : undefined,
    requestReceiptVersion: request.initialPlanReceiptVersion,
    requestGeneration: request.initialPlanGeneration,
    jobId: String(args.job._id),
    payloadRequestId: payload.oneSetupRequestId,
    payloadReceiptVersion: payload.oneSetupInitialPlanReceiptVersion,
    payloadGeneration: payload.oneSetupInitialPlanGeneration,
    requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
    payloadCanonicalDomainRevision:
      payload.oneSetupCanonicalDomainRevision,
    currentCanonicalDomainRevision,
    legacyUnstampedAllowed,
  })) {
    return { kind: "stale", reason: "receipt_generation_superseded" };
  }
  const currentFingerprint = oneSetupInitialPlanContextFingerprint(args.site);
  if (
    request.initialPlanContextFingerprint !== currentFingerprint
  ) {
    return { kind: "stale", reason: "planning_context_changed" };
  }
  return { kind: "current", requestId: request._id };
}
