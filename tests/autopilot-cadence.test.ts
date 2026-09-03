import assert from "node:assert/strict";
import test from "node:test";

import {
  compareQualityRecoveryCandidates,
  evaluateCadenceWindow,
  findRecoverableQualityArticle,
  hasAttemptedVersionedQualityRecovery,
  hasRecoverableQualityWork,
  needsDeterministicMechanicalRepair,
  needsVersionedQualityRecovery,
  qualityRecoveryTargetVersion,
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

test("a pre-fix media failure advances only through defect-bound recovery algorithms", () => {
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
  assert.equal(qualityRecoveryTargetVersion(legacy), 3);

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
      qualityRecoveryVersion: 3,
    }),
    false,
  );
  assert.equal(
    needsVersionedQualityRecovery({
      ...legacy,
      qualityRecoveryAttemptVersion: 3,
    }),
    true,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...legacy,
      qualityRecoveryAttemptVersion: 3,
    }),
    4,
  );
  assert.equal(
    needsVersionedQualityRecovery({
      ...legacy,
      qualityRecoveryAttemptVersion: 4,
    }),
    true,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...legacy,
      qualityRecoveryAttemptVersion: 4,
    }),
    7,
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
    false,
  );
  assert.equal(
    hasAttemptedVersionedQualityRecovery(
      [{
        createdAt: QUALITY_RECOVERY_VERSION_INTRODUCED_AT,
        payload: { articleId, qualityRetry: true, bufferFill: true },
      }],
      articleId,
      1,
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

test("worker, media, and claim-ledger defects retain isolated recovery versions", () => {
  const workerFailure = {
    _id: "article-worker-length",
    createdAt: NOW - 72 * HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Quality-review algorithm exhausted the strict length contract (1031/1200-3000 words).",
    ],
    qualityRevisionCount: 2,
    qualityRecoveryVersion: 1,
    qualityRecoveryAttemptVersion: 1,
  };
  assert.equal(QUALITY_RECOVERY_VERSION, 11);
  assert.equal(qualityRecoveryTargetVersion(workerFailure), 2);
  assert.equal(needsVersionedQualityRecovery(workerFailure), true);
  assert.equal(
    needsVersionedQualityRecovery({
      ...workerFailure,
      qualityRecoveryAttemptVersion: 2,
    }),
    false,
  );

  const completedMediaRecovery = {
    ...workerFailure,
    publicationGateIssues: [
      "Strict publication requires a completed media-quality review.",
    ],
    qualityRecoveryVersion: 1,
    qualityRecoveryAttemptVersion: 1,
  };
  assert.equal(qualityRecoveryTargetVersion(completedMediaRecovery), 3);
  assert.equal(needsVersionedQualityRecovery(completedMediaRecovery), true);
  assert.equal(
    needsVersionedQualityRecovery({
      ...completedMediaRecovery,
      qualityRecoveryAttemptVersion: 3,
    }),
    true,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...completedMediaRecovery,
      qualityRecoveryAttemptVersion: 3,
    }),
    4,
  );
  assert.equal(
    needsVersionedQualityRecovery({
      ...completedMediaRecovery,
      qualityRecoveryAttemptVersion: 4,
    }),
    true,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...completedMediaRecovery,
      qualityRecoveryAttemptVersion: 4,
    }),
    7,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...completedMediaRecovery,
      qualityRecoveryVersion: 4,
      qualityRecoveryAttemptVersion: 4,
    }),
    undefined,
  );

  const completedClaimLedgerRecovery = {
    ...workerFailure,
    publicationGateIssues: [
      "Editorial quality score is 78; strict minimum is 85.",
      "Strict publication requires a completed claim-to-evidence audit.",
    ],
    qualityRecoveryVersion: 4,
    qualityRecoveryAttemptVersion: 4,
  };
  assert.equal(
    qualityRecoveryTargetVersion(completedClaimLedgerRecovery),
    5,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...completedClaimLedgerRecovery,
      qualityRecoveryAttemptVersion: 5,
    }),
    7,
  );
  assert.equal(
    qualityRecoveryTargetVersion({
      ...completedClaimLedgerRecovery,
      publicationGateIssues: [
        "Editorial quality score is 78; strict minimum is 85.",
      ],
    }),
    undefined,
  );
});

test("version 7 reopens only post-audit depth-reconstruction failures", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    qualityRevisionCount: 2,
  };
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a completed media-quality review.",
    ],
    qualityRecoveryAttemptVersion: 4,
  }), 7);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a completed claim-to-evidence audit.",
    ],
    qualityRecoveryVersion: 4,
    qualityRecoveryAttemptVersion: 5,
  }), 7);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a completed media-quality review.",
    ],
    qualityRecoveryAttemptVersion: 6,
  }), 7);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a completed media-quality review.",
    ],
    qualityRecoveryAttemptVersion: 7,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Editorial quality score is 78; strict minimum is 85.",
    ],
    qualityRecoveryAttemptVersion: 5,
  }), undefined);
});

test("version 8 reopens only claim-audit truncation and its false length failure", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    qualityRevisionCount: 2,
    qualityRecoveryVersion: 7,
    qualityRecoveryAttemptVersion: 7,
  };
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a completed claim-to-evidence audit.",
    ],
  }), 8);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryVersion: 5,
    publicationGateIssues: [
      "Quality-review algorithm exhausted the strict length contract (690/1200-2600 words).",
    ],
  }), 8);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryAttemptVersion: 8,
    publicationGateIssues: [
      "Strict publication requires a completed claim-to-evidence audit.",
    ],
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Editorial quality score is 78; strict minimum is 85.",
    ],
  }), undefined);
});

test("version 9 reopens only a version-8 exact editorial audit that can now be remediated", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Editorial quality score is 78; strict minimum is 85.",
    ],
    qualityRevisionCount: 5,
    qualityRecoveryVersion: 8,
    qualityRecoveryAttemptVersion: 8,
  };
  assert.equal(qualityRecoveryTargetVersion(base), 9);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryAttemptVersion: 9,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a reviewed HTTPS hero image.",
    ],
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryVersion: 7,
    qualityRecoveryAttemptVersion: 7,
  }), undefined);
});

test("version 10 reopens only an applied version-9 editorial result for bounded fixed-point repair", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Editorial quality score is 83; strict minimum is 85.",
    ],
    qualityRevisionCount: 6,
    qualityRecoveryVersion: 9,
    qualityRecoveryAttemptVersion: 9,
  };
  assert.equal(qualityRecoveryTargetVersion(base), 10);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryAttemptVersion: 10,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryVersion: 8,
    qualityRecoveryAttemptVersion: 9,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Strict publication requires a reviewed HTTPS hero image.",
    ],
  }), undefined);
});

test("version 11 reopens only an applied version-10 internal-link seal failure", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [
      "Post-review internal-link sealing failed: Article provider execution failed without a safe replay condition.",
    ],
    qualityRevisionCount: 7,
    qualityRecoveryVersion: 10,
    qualityRecoveryAttemptVersion: 10,
  };
  assert.equal(qualityRecoveryTargetVersion(base), 11);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryAttemptVersion: 11,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    qualityRecoveryVersion: 9,
  }), undefined);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Editorial quality score is 83; strict minimum is 85.",
    ],
  }), undefined);
});

test("version 3 media recovery recognizes both sides of the migrated contract before failover", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    qualityRevisionCount: 2,
    qualityRecoveryVersion: 2,
    qualityRecoveryAttemptVersion: 2,
  };
  for (const issue of [
    "Strict publication requires a reviewed HTTPS hero image.",
    "A product-specific section requires validated first-party visual evidence.",
    "A product-specific section requires validated first-party product evidence.",
  ]) {
    assert.equal(
      qualityRecoveryTargetVersion({
        ...base,
        publicationGateIssues: [issue],
      }),
      3,
    );
  }
  assert.equal(
    qualityRecoveryTargetVersion({
      ...base,
      publicationGateIssues: [
        "A product-specific section has an unrelated editorial issue.",
      ],
    }),
    undefined,
  );
});

test("recovery fills the buffer from the strongest candidate without bypassing gates", () => {
  const candidates = [
    {
      _id: "new-low-score",
      createdAt: NOW - HOUR,
      factCheckScore: 95,
      editorialQualityScore: 42,
      publicationGateIssues: ["one"],
    },
    {
      _id: "older-near-pass",
      createdAt: NOW - 2 * HOUR,
      factCheckScore: 92,
      editorialQualityScore: 84,
      publicationGateIssues: ["one", "two"],
    },
    {
      _id: "oldest-near-pass",
      createdAt: NOW - 3 * HOUR,
      factCheckScore: 90,
      editorialQualityScore: 84,
      publicationGateIssues: ["one"],
    },
  ].sort(compareQualityRecoveryCandidates);
  assert.deepEqual(
    candidates.map((candidate) => candidate._id),
    ["older-near-pass", "oldest-near-pass", "new-low-score"],
  );
});

test("version 2 recovery matches only the durable algorithm issue contract", () => {
  const base = {
    createdAt: NOW - HOUR,
    status: "review",
    publicationGateStatus: "blocked",
    qualityRevisionCount: 2,
  };
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Quality-review algorithm exhausted below the strict length minimum (899 words).",
    ],
  }), 2);
  assert.equal(qualityRecoveryTargetVersion({
    ...base,
    publicationGateIssues: [
      "Customer says the quality-review algorithm exhausted below the strict length minimum.",
    ],
  }), undefined);
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
