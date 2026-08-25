/**
 * Durable write path for the expected-click reservation receipt.
 *
 * Kept beside the authoritative reservation mutations rather than in a
 * separate scheduled job: the receipt must be written in the same transaction
 * that decided the outcome, or an overlapping dispatcher could observe a
 * decision that no longer matches the stored evidence.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  EXPECTED_CLICK_SKIP_RECEIPT_VERSION,
  boundedCandidateCounts,
  normalizeSkipReason,
  skipReceiptWriteDecision,
  type ExpectedClickBackfillKind,
  type ExpectedClickSkipReceipt,
} from "./expectedClickSkipReceipt.ts";

export type ReservationOutcome = {
  queued: boolean;
  reason?: string;
  candidateCounts?: Record<string, unknown> | null;
  selectedCandidateCount?: number;
  unresolvedJobCount?: number;
  nextEligibleAt?: number;
  blockingTopicId?: Id<"topic_clusters">;
};

/**
 * Record the current reservation outcome for one site and phase.
 *
 * Never throws: a diagnostic must not be able to fail a reservation that
 * otherwise succeeded, and must never roll back durable job creation.
 */
export async function recordExpectedClickReservationOutcome(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    kind: ExpectedClickBackfillKind;
    policyVersion: number;
    evaluatedAt: number;
    outcome: ReservationOutcome;
  },
): Promise<void> {
  try {
    const site = await ctx.db.get(args.siteId);
    // Without a site there is no tenant binding to write the receipt against.
    if (!site) return;

    const incoming: ExpectedClickSkipReceipt = {
      version: EXPECTED_CLICK_SKIP_RECEIPT_VERSION,
      kind: args.kind,
      decision: args.outcome.queued ? "queued" : "skipped",
      reason: normalizeSkipReason(
        args.outcome.queued ? "queued" : args.outcome.reason,
      ),
      evaluatedAt: args.evaluatedAt,
      nextEligibleAt: args.outcome.nextEligibleAt,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      canonicalDomain: String(site.canonicalDomain ?? site.domain ?? ""),
      domainRevision: site.canonicalDomainRevision,
      policyVersion: args.policyVersion,
      selectedCandidateCount: Math.max(
        0,
        Math.trunc(args.outcome.selectedCandidateCount ?? 0),
      ),
      unresolvedJobCount: args.outcome.unresolvedJobCount,
      candidateCounts: boundedCandidateCounts(args.outcome.candidateCounts),
      blockingTopicId: args.outcome.blockingTopicId
        ? String(args.outcome.blockingTopicId)
        : undefined,
    };

    const existingRow = await ctx.db
      .query("expected_click_backfill_skip_receipts")
      .withIndex("by_site_kind", (q) =>
        q.eq("siteId", args.siteId).eq("kind", args.kind)
      )
      .unique();

    const decision = skipReceiptWriteDecision({
      existing: existingRow
        ? {
          version: existingRow.version,
          kind: existingRow.kind as ExpectedClickBackfillKind,
          decision: existingRow.decision as "skipped" | "queued",
          reason: normalizeSkipReason(existingRow.reason),
          evaluatedAt: existingRow.evaluatedAt,
          nextEligibleAt: existingRow.nextEligibleAt,
          rolloutEpoch: existingRow.rolloutEpoch,
          canonicalDomain: existingRow.canonicalDomain,
          domainRevision: existingRow.domainRevision,
          policyVersion: existingRow.policyVersion,
          selectedCandidateCount: existingRow.selectedCandidateCount,
          unresolvedJobCount: existingRow.unresolvedJobCount,
          candidateCounts: existingRow.candidateCounts,
          blockingTopicId: existingRow.blockingTopicId
            ? String(existingRow.blockingTopicId)
            : undefined,
        }
        : null,
      incoming,
    });
    if (decision.action === "ignore") return;

    const row = {
      ...incoming,
      siteId: args.siteId,
      blockingTopicId: args.outcome.blockingTopicId,
      updatedAt: args.evaluatedAt,
    };
    if (!existingRow) {
      await ctx.db.insert("expected_click_backfill_skip_receipts", {
        ...row,
        createdAt: args.evaluatedAt,
      });
      return;
    }
    if (decision.action === "touch") {
      // Same refusal and binding: refresh liveness only, never create history.
      await ctx.db.patch(existingRow._id, {
        evaluatedAt: args.evaluatedAt,
        updatedAt: args.evaluatedAt,
      });
      return;
    }
    await ctx.db.patch(existingRow._id, row);
  } catch {
    // Diagnostics are strictly best-effort. A receipt failure must never
    // surface as a reservation failure or undo a durable job.
  }
}
