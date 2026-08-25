import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_CLICK_SKIP_RECEIPT_VERSION,
  EXPECTED_CLICK_SKIP_REASONS,
  boundedCandidateCounts,
  normalizeSkipReason,
  sanitizeSkipReceiptForOperator,
  skipReceiptWriteDecision,
  type ExpectedClickSkipReceipt,
} from "../convex/lib/expectedClickSkipReceipt.ts";

const T0 = Date.UTC(2026, 7, 25, 22, 0, 0);
const MINUTE = 60_000;

function receipt(
  overrides: Partial<ExpectedClickSkipReceipt> = {},
): ExpectedClickSkipReceipt {
  return {
    version: EXPECTED_CLICK_SKIP_RECEIPT_VERSION,
    kind: "demand",
    decision: "skipped",
    reason: "no_eligible_legacy_topics",
    evaluatedAt: T0,
    rolloutEpoch: 7,
    canonicalDomain: "leadpilot.chat",
    policyVersion: 1,
    selectedCandidateCount: 0,
    candidateCounts: { covered: 49, eligible: 0, plannedGateBlocked: 1 },
    ...overrides,
  };
}

test("only allowlisted reasons are ever persisted", () => {
  for (const reason of EXPECTED_CLICK_SKIP_REASONS) {
    assert.equal(normalizeSkipReason(reason), reason);
  }
  // Raw provider errors and free text must collapse, never pass through.
  assert.equal(normalizeSkipReason("DataForSEO 402: balance exhausted"), "unclassified");
  assert.equal(normalizeSkipReason(undefined), "unclassified");
  assert.equal(normalizeSkipReason({ nested: "object" }), "unclassified");
  assert.equal(normalizeSkipReason(""), "unclassified");
});

test("candidate counts are a fixed clamped integer set", () => {
  const bounded = boundedCandidateCounts({
    covered: 49,
    eligible: 9.9,
    plannedGateBlocked: -3,
    businessFitBlocked: 1e12,
    // Neither of these may survive.
    providerError: "boom",
    topicIds: ["a", "b", "c"],
  } as Record<string, unknown>);
  assert.equal(bounded.covered, 49);
  assert.equal(bounded.eligible, 9, "fractional counts truncate");
  assert.equal(bounded.plannedGateBlocked, 0, "negative counts clamp to zero");
  assert.equal(bounded.businessFitBlocked, 1_000_000, "counts are capped");
  assert.equal("providerError" in bounded, false);
  assert.equal("topicIds" in bounded, false);
  assert.deepEqual(boundedCandidateCounts(null), {});
});

test("the first evaluation inserts and an identical repeat only touches", () => {
  assert.deepEqual(
    skipReceiptWriteDecision({ existing: null, incoming: receipt() }),
    { action: "insert" },
  );
  // Hourly recovery repeating the same refusal must not create history.
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt(),
      incoming: receipt({ evaluatedAt: T0 + 60 * MINUTE }),
    }),
    { action: "touch" },
  );
});

test("a changed reason or count replaces the current receipt", () => {
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt(),
      incoming: receipt({
        evaluatedAt: T0 + MINUTE,
        reason: "provider_account_daily_budget_reserved",
      }),
    }),
    { action: "replace" },
  );
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt(),
      incoming: receipt({
        evaluatedAt: T0 + MINUTE,
        candidateCounts: { covered: 50, eligible: 1 },
      }),
    }),
    { action: "replace" },
  );
});

test("a successful reservation supersedes and cannot be undone by a stale refusal", () => {
  const queued = receipt({
    decision: "queued",
    reason: "queued",
    evaluatedAt: T0 + 5 * MINUTE,
    selectedCandidateCount: 9,
  });
  assert.deepEqual(
    skipReceiptWriteDecision({ existing: receipt(), incoming: queued }),
    { action: "replace" },
  );
  // A refusal that began before the queue commits must not restore skip state.
  const staleRefusal = receipt({ evaluatedAt: T0 + 2 * MINUTE });
  assert.deepEqual(
    skipReceiptWriteDecision({ existing: queued, incoming: staleRefusal }),
    { action: "ignore", reason: "stale_evaluation" },
  );
  // Same instant is still a loss for the refusal.
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: queued,
      incoming: receipt({ evaluatedAt: queued.evaluatedAt }),
    }),
    { action: "ignore", reason: "superseded_by_queued" },
  );
});

test("stale rollout, domain and revision bindings can never write", () => {
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt({ rolloutEpoch: 8 }),
      incoming: receipt({ rolloutEpoch: 7, evaluatedAt: T0 + MINUTE }),
    }),
    { action: "ignore", reason: "stale_rollout_epoch" },
  );
  // A newer epoch is a new lifecycle and always wins.
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt({ rolloutEpoch: 7 }),
      incoming: receipt({ rolloutEpoch: 8, evaluatedAt: T0 - MINUTE }),
    }),
    { action: "replace" },
  );
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt({ canonicalDomain: "new.example" }),
      incoming: receipt({
        canonicalDomain: "leadpilot.chat",
        evaluatedAt: T0 - MINUTE,
      }),
    }),
    { action: "ignore", reason: "stale_domain_binding" },
  );
  assert.deepEqual(
    skipReceiptWriteDecision({
      existing: receipt({ domainRevision: 3 }),
      incoming: receipt({ domainRevision: 2, evaluatedAt: T0 + MINUTE }),
    }),
    { action: "ignore", reason: "stale_domain_revision" },
  );
});

test("demand and evidence receipts are independent diagnoses", () => {
  const demand = receipt({ kind: "demand" });
  const evidence = receipt({
    kind: "evidence",
    reason: "tenant_authority_unavailable",
    evaluatedAt: T0 + MINUTE,
  });
  // Different kinds are stored under different keys, so a write decision for
  // one is computed against its own row, never the other's.
  assert.deepEqual(
    skipReceiptWriteDecision({ existing: null, incoming: evidence }),
    { action: "insert" },
  );
  assert.notEqual(demand.kind, evidence.kind);
});

test("the operator projection exposes no payload, error or unbounded field", () => {
  const projected = sanitizeSkipReceiptForOperator(
    receipt({
      blockingTopicId: "jn79s9k5bpzr7gk3khctnkfp0s8cvmx8",
      reason: "DataForSEO 402 balance exhausted" as never,
      candidateCounts: { covered: 49, eligible: 0 },
      // Fields a future caller might wrongly attach must not be projected.
      ...({
        providerResponse: { body: "secret" },
        siteConfig: { githubToken: "ghp_x" },
        topicIds: ["a", "b"],
      } as Record<string, unknown>),
    }),
  )!;
  assert.equal(projected.reason, "unclassified", "raw text is never projected");
  assert.equal(projected.blockingTopicId, "jn79s9k5bpzr7gk3khctnkfp0s8cvmx8");
  for (const forbidden of ["providerResponse", "siteConfig", "topicIds"]) {
    assert.equal(forbidden in projected, false, `${forbidden} leaked`);
  }
  const serialized = JSON.stringify(projected);
  assert.equal(/ghp_|secret/.test(serialized), false);
  assert.equal(sanitizeSkipReceiptForOperator(null), null);
});

test("a queued receipt records what was actually reserved", () => {
  const projected = sanitizeSkipReceiptForOperator(
    receipt({ decision: "queued", reason: "queued", selectedCandidateCount: 9 }),
  )!;
  assert.equal(projected.decision, "queued");
  assert.equal(projected.reason, "queued");
  assert.equal(projected.selectedCandidateCount, 9);
});
