import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cadenceRevisionRecoveryReceiptValid,
  effectiveCadencePublicationAt,
  type CadenceRevisionExhaustionAttempt,
} from "../convex/lib/cadenceRevision.ts";

const now = Date.UTC(2026, 8, 4, 22, 0, 0);

function attempt(
  overrides: Partial<CadenceRevisionExhaustionAttempt> = {},
): CadenceRevisionExhaustionAttempt {
  return {
    id: "primary",
    siteId: "site",
    sourcePlanId: "plan",
    attemptKind: "primary",
    policyVersion: 35,
    rolloutEpoch: 4,
    status: "missed",
    errorCode: "no_strict_candidate",
    providerCallAttempted: true,
    providerCallCompleted: true,
    providerAttemptedAt: now - 20_000,
    providerCompletedAt: now - 15_000,
    completedAt: now - 10_000,
    createdAt: now - 30_000,
    candidateReceiptCount: 4,
    candidateAudit: {
      received: 4,
      accepted: 0,
      invalidMetric: 0,
      intentUnavailable: 0,
      difficulty: 0,
      brand: 0,
      businessFit: 0,
      duplicate: 0,
      overlap: 4,
    },
    candidateShortlistCount: 0,
    priorCandidateAttemptCount: 0,
    hasSelectedOrTopicReceipt: false,
    hasEvidenceReceipt: false,
    cadenceScheduleAttempts: 0,
    hasCadenceScheduleReceipt: false,
    finalizeAttempts: 0,
    ...overrides,
  };
}

const parent = attempt();
const child = attempt({
  id: "fallback",
  attemptKind: "fallback",
  errorCode: "semantic_failure",
  createdAt: now - 9_000,
  providerAttemptedAt: now - 8_000,
  providerCompletedAt: now - 7_000,
  completedAt: now - 1_000,
  candidateReceiptCount: 300,
  candidateAudit: {
    received: 300,
    accepted: 1,
    invalidMetric: 159,
    intentUnavailable: 0,
    difficulty: 67,
    brand: 3,
    businessFit: 57,
    duplicate: 0,
    overlap: 13,
  },
  candidateShortlistCount: 1,
  candidateAttemptCount: 1,
  priorCandidateAttemptCount: 0,
  hasSelectedOrTopicReceipt: true,
  hasEvidenceReceipt: true,
  finalizeAttempts: 1,
  parentMicroSeedJobId: "primary",
  parentMicroSeedReceiptFingerprint: "a".repeat(64),
});

test("cadence revision requires exact terminal primary and fallback receipts", () => {
  assert.equal(cadenceRevisionRecoveryReceiptValid({
    siteId: "site",
    rolloutEpoch: 4,
    policyVersion: 35,
    expectedParentReceiptFingerprint: "a".repeat(64),
    parent,
    child,
    now,
  }), true);
});

test("cadence revision fails closed on provider, epoch, or schedule ambiguity", () => {
  for (const invalidChild of [
    { ...child, providerCallCompleted: false },
    { ...child, rolloutEpoch: 3 },
    { ...child, cadenceScheduleAttempts: 1 },
    { ...child, hasCadenceScheduleReceipt: true },
    { ...child, parentMicroSeedReceiptFingerprint: "invalid" },
  ]) {
    assert.equal(cadenceRevisionRecoveryReceiptValid({
      siteId: "site",
      rolloutEpoch: 4,
      policyVersion: 35,
      expectedParentReceiptFingerprint: "a".repeat(64),
      parent,
      child: invalidChild,
      now,
    }), false);
  }
});

test("a verified revision advances the cadence clock without rewriting article history", () => {
  assert.equal(effectiveCadencePublicationAt({
    articlePublishedAt: 100,
    verifiedRevisionAt: 200,
  }), 200);
  assert.equal(effectiveCadencePublicationAt({
    articlePublishedAt: 300,
    verifiedRevisionAt: 200,
  }), 300);
  assert.equal(effectiveCadencePublicationAt({}), undefined);
});

test("the natural scheduler gives sealed articles priority then uses the due revision lane", () => {
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const delivery = scheduler.indexOf(
    "autonomousDelivery && publicationDue && buffer.length > 0",
  );
  const recovery = scheduler.indexOf("prepareForCadenceRecovery");
  assert.ok(delivery >= 0 && recovery > delivery);
  assert.match(
    scheduler,
    /prepareForCadenceRecovery[\s\S]*executePublishedRevisionInternal[\s\S]*mode: "cadence_revision"/,
  );

  const revisions = readFileSync("convex/publishedRevisions.ts", "utf8");
  assert.match(
    revisions,
    /sealedReady[\s\S]*A sealed new article has priority over cadence revision recovery/,
  );
  assert.match(
    revisions,
    /cadenceRevisionRecoveryReceiptValid[\s\S]*deterministicInternalLinkRevision/,
  );
});
