import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_NEW_CANDIDATES_PER_24H,
  MAX_QUALITY_REPLACEMENTS_PER_24H,
  MIN_APPROVED_BUFFER,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  isSealedReady,
  migrationBlocksAutopilot,
  pendingJobPriority,
  selectNonCannibalizingTopic,
} from "../convex/lib/autopilotBuffer.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

test("candidate budget can still fill the target after two strict-gate rejections", () => {
  assert.equal(MAX_QUALITY_REPLACEMENTS_PER_24H, 2);
  assert.equal(
    MAX_NEW_CANDIDATES_PER_24H,
    TARGET_APPROVED_BUFFER + MAX_QUALITY_REPLACEMENTS_PER_24H,
  );
  assert.ok(MAX_NEW_CANDIDATES_PER_24H - 2 >= MIN_APPROVED_BUFFER);
});

test("a partial summary backfill cannot authorize autopilot", () => {
  // hasAnyArticle remains true even if one or many partial summaries exist;
  // only the migration's explicit completed marker opens the cron gate.
  assert.equal(migrationBlocksAutopilot(undefined, true), true);
  assert.equal(migrationBlocksAutopilot("running", true), true);
  assert.equal(migrationBlocksAutopilot("completed", true), false);
  assert.equal(migrationBlocksAutopilot(undefined, false), false);
});

test("only a current strict-gate sealed ready article enters the buffer", () => {
  const valid = {
    status: "ready",
    publicationGateStatus: "passed",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "abc",
  };
  assert.equal(isSealedReady(valid), true);
  assert.equal(isSealedReady({ ...valid, status: "review" }), false);
  assert.equal(isSealedReady({ ...valid, publicationGateStatus: "blocked" }), false);
  assert.equal(isSealedReady({ ...valid, auditedContentHash: undefined }), false);
});

test("health distinguishes scheduler, cadence, publication, quality, and buffer failures", () => {
  assert.equal(
    autopilotHealthStatus({ schedulerStale: true, publicationMissed: true, bufferCount: 0 }),
    "scheduler_stale",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: true, bufferCount: 0 }),
    "missed",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: 3, lastOutcome: "publication_failed" }),
    "publication_failed",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: 3, lastOutcome: "quality_quarantined" }),
    "quality_quarantined",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: 0 }),
    "buffer_empty",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: MIN_APPROVED_BUFFER - 1 }),
    "buffer_low",
  );
});

test("due publication outranks manual and replenishment jobs", () => {
  assert.ok(
    pendingJobPriority({ publishOnly: true }) >
      pendingJobPriority({ manual: true }),
  );
  assert.ok(
    pendingJobPriority({ manual: true }) >
      pendingJobPriority({ bufferFill: true }),
  );
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /processed\?\.buffered/);
  assert.match(pipeline, /newly_sealed_buffer_item_is_due/);
});

test("topic selection includes buffered coverage and can trigger fresh-plan recovery", () => {
  const topics = [
    { primaryKeyword: "website lead qualification workflow" },
    { primaryKeyword: "customer onboarding checklist" },
  ];
  const selected = selectNonCannibalizingTopic(topics, [
    "website lead qualification guide",
  ]);
  assert.equal(selected?.primaryKeyword, "customer onboarding checklist");

  const none = selectNonCannibalizingTopic(
    [{ primaryKeyword: "website lead qualification workflow" }],
    ["website lead qualification guide"],
  );
  assert.equal(none, undefined);
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "CRO audit" }],
      ["SEO strategy"],
    )?.primaryKeyword,
    "CRO audit",
  );
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /topic_overlap_replenishment/);
  assert.match(scheduler, /MAX_TOPIC_REPLENISHMENTS_PER_24H/);
  assert.match(scheduler, /topic_replenishment_exhausted/);
  assert.match(scheduler, /queuePlanIfAbsent/);
});

test("topic selection compares against each existing phrase instead of the whole corpus", () => {
  const topics = [{ primaryKeyword: "sales qualification questions" }];

  assert.equal(
    selectNonCannibalizingTopic(topics, [
      "sales automation guide",
      "lead qualification chatbot",
      "discovery questions template",
    ])?.primaryKeyword,
    "sales qualification questions",
  );

  assert.equal(
    selectNonCannibalizingTopic(topics, ["sales qualification framework"]),
    undefined,
  );
});
