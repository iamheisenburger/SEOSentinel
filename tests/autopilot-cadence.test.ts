import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCadenceWindow,
  findRecoverableQualityArticle,
  hasAttemptedVersionedQualityRecovery,
  hasRecoverableQualityWork,
  needsDeterministicMechanicalRepair,
  needsVersionedQualityRecovery,
  QUALITY_RECOVERY_VERSION,
  QUALITY_RECOVERY_VERSION_INTRODUCED_AT,
} from "../convex/lib/autopilotCadence.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

test("standard cadence stops after one attempt", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 1,
  });

  assert.equal(result.canGenerate, false);
});

test("autonomous cadence allows one fallback after a blocked draft", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, true);
});

test("autonomous cadence stops after two blocked attempts", () => {
  const result = evaluateCadenceWindow({
    articles: [
      { createdAt: NOW - HOUR, status: "review" },
      { createdAt: NOW - 2 * HOUR, status: "review" },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.recentAttempts, 2);
});

test("a publication closes the cadence window", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "published" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.hasRecentPublication, true);
});

test("attempts outside the cadence window do not block generation", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - 25 * HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 1,
  });

  assert.equal(result.canGenerate, true);
});

test("a quarantined prose candidate is revised before a fallback is generated", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        _id: "article-1",
        createdAt: NOW - HOUR,
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: ["Editorial quality score is 78; strict minimum is 85."],
        qualityRevisionCount: 0,
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.recoveryArticleId, "article-1");
});

test("deferred media failures recover on the same draft instead of generating a duplicate", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        _id: "article-1",
        createdAt: NOW - HOUR,
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: ["Strict publication requires a reviewed HTTPS hero image."],
        qualityRevisionCount: 0,
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.recoveryArticleId, "article-1");
  assert.equal(result.canGenerate, false);
});

test("a max-revision draft gets deterministic repair only for mechanical defects", () => {
  assert.equal(
    needsDeterministicMechanicalRepair({
      createdAt: NOW - HOUR,
      status: "review",
      publicationGateStatus: "blocked",
      publicationGateIssues: [
        "Meta description ends with a dangling or incomplete phrase.",
      ],
      qualityRevisionCount: 2,
    }),
    true,
  );
  assert.equal(
    needsDeterministicMechanicalRepair({
      createdAt: NOW - HOUR,
      status: "review",
      publicationGateStatus: "blocked",
      publicationGateIssues: [
        "Editorial quality score is 78; strict minimum is 85.",
      ],
      qualityRevisionCount: 2,
    }),
    false,
  );
  assert.equal(
    needsDeterministicMechanicalRepair({
      createdAt: NOW - HOUR,
      status: "review",
      publicationGateStatus: "blocked",
      publicationGateIssues: [
        "Structured introduction near line 93 promises a list or table but none follows.",
      ],
      qualityRevisionCount: 2,
    }),
    true,
  );
});

test("a pre-fix media failure gets exactly one pass under the current recovery algorithm", () => {
  const legacy = {
    _id: "article-legacy-media",
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Editorial quality score is 84; strict minimum is 85.",
      "Strict publication requires a completed media-quality review.",
      "A product-specific section requires validated first-party visual evidence.",
    ],
    qualityRevisionCount: 2,
  };
  assert.equal(needsVersionedQualityRecovery(legacy), true);

  const window = evaluateCadenceWindow({
    articles: [legacy],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });
  assert.equal(window.recoveryArticleId, "article-legacy-media");
  assert.equal(window.canGenerate, false);

  assert.equal(
    needsVersionedQualityRecovery({
      ...legacy,
      qualityRecoveryVersion: QUALITY_RECOVERY_VERSION,
    }),
    false,
  );
  assert.equal(
    needsVersionedQualityRecovery({
      ...legacy,
      qualityRecoveryAttemptVersion: QUALITY_RECOVERY_VERSION,
    }),
    false,
  );
  assert.equal(
    needsVersionedQualityRecovery({
      ...legacy,
      publicationGateIssues: [
        "Editorial quality score is 84; strict minimum is 85.",
      ],
    }),
    false,
  );
});

test("a failed versioned recovery is durably recognized without provider replay", () => {
  const articleId = "article-legacy-media";
  assert.equal(
    hasAttemptedVersionedQualityRecovery(
      [{
        createdAt: QUALITY_RECOVERY_VERSION_INTRODUCED_AT,
        payload: { articleId, qualityRetry: true, bufferFill: true },
      }],
      articleId,
    ),
    true,
  );
  assert.equal(
    hasAttemptedVersionedQualityRecovery(
      [{
        createdAt: QUALITY_RECOVERY_VERSION_INTRODUCED_AT - 1,
        payload: { articleId, qualityRetry: true, bufferFill: true },
      }],
      articleId,
    ),
    false,
  );
  assert.equal(
    hasAttemptedVersionedQualityRecovery(
      [{
        createdAt: 1,
        payload: {
          articleId,
          qualityRetry: true,
          qualityRecoveryVersion: QUALITY_RECOVERY_VERSION,
        },
      }],
      articleId,
    ),
    true,
  );
  assert.equal(
    hasAttemptedVersionedQualityRecovery(
      [{
        createdAt: QUALITY_RECOVERY_VERSION_INTRODUCED_AT,
        payload: {
          articleId,
          qualityRetry: true,
          deterministicRepair: true,
        },
      }],
      articleId,
    ),
    false,
  );
});

test("versioned recovery cannot expire before a repair release reaches its next cadence", () => {
  const legacy = {
    _id: "article-legacy-media-outside-window",
    createdAt: NOW - 72 * HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Strict publication requires a completed media-quality review.",
    ],
    qualityRevisionCount: 2,
  };

  assert.equal(
    hasRecoverableQualityWork([legacy], NOW - 24 * HOUR),
    true,
  );
  assert.equal(
    findRecoverableQualityArticle([legacy], NOW, 24)?._id,
    "article-legacy-media-outside-window",
  );
  assert.equal(
    findRecoverableQualityArticle(
      [{ ...legacy, qualityRecoveryVersion: QUALITY_RECOVERY_VERSION }],
      NOW,
      24,
    ),
    undefined,
  );
});

test("publication time, not old draft creation time, closes the cadence window", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        createdAt: NOW - 48 * HOUR,
        publishedAt: NOW - HOUR,
        status: "published",
        publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
        auditedContentHash: "sealed-content-hash",
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.hasRecentPublication, true);
  assert.equal(result.canGenerate, false);
});

test("a maintenance timestamp cannot make a legacy publication look fresh", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        createdAt: NOW - 48 * HOUR,
        publishedAt: NOW - HOUR,
        status: "published",
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.hasRecentPublication, false);
  assert.equal(result.canGenerate, true);
});
