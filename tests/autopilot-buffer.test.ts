import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  coveredPrimaryKeywords,
  exactCadenceWakeupAt,
  filterNonCannibalizingTopics,
  MAX_NEW_CANDIDATES_PER_24H,
  MAX_QUALITY_REPLACEMENTS_PER_24H,
  MIN_APPROVED_BUFFER,
  MIN_VERIFIED_TOPIC_HORIZON,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  isSealedReady,
  migrationBlocksAutopilot,
  pendingJobPriority,
  selectNonCannibalizingTopic,
  topicDiscoverySeedWindow,
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

test("fleet dispatch is paginated and tenant-isolated", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(autopilot, /withIndex\("by_autopilot"/);
  assert.match(autopilot, /paginate\(\{ cursor: args\.cursor \?\? null, numItems: 25 \}\)/);
  assert.match(autopilot, /internal\.actions\.pipeline\.autopilotTick/);
  assert.doesNotMatch(autopilot, /single-tenant canary/);
  assert.doesNotMatch(sites, /A different tenant is already in controlled rollout/);
});

test("topic coverage ignores broad article metadata and uses canonical primary keywords", () => {
  const covered = coveredPrimaryKeywords(
    [
      { _id: "used-topic", status: "used", primaryKeyword: "chatbot for lead generation" },
      { _id: "planned-topic", status: "planned", primaryKeyword: "AI chatbot for sales" },
    ],
    [
      { topicId: "used-topic", slug: "/chatbot-for-lead-generation" },
      { slug: "/legacy-website-conversion-guide" },
    ],
  );

  assert.deepEqual(covered, [
    "chatbot for lead generation",
    "legacy website conversion guide",
  ]);
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "AI chatbot for sales" }],
      covered,
    )?.primaryKeyword,
    "AI chatbot for sales",
  );
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
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: MIN_APPROVED_BUFFER - 1, lastOutcome: "quality_budget_exhausted" }),
    "quality_budget_exhausted",
  );
  assert.equal(
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: MIN_APPROVED_BUFFER, lastOutcome: "quality_budget_exhausted" }),
    "healthy",
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
  assert.match(pipeline, /continueAutopilotAfterProcessedJob/);
  assert.match(pipeline, /newly_sealed_buffer_item_is_due/);
  assert.match(
    pipeline,
    /ctx\.scheduler\.runAfter\(\s*0,\s*internal\.actions\.pipeline\.processNextJob/,
  );
  assert.match(pipeline, /runId: v\.optional\(v\.id\("autopilot_runs"\)\)/);
});

test("a sealed autonomous buffer arms the exact cadence deadline", () => {
  const now = Date.UTC(2026, 6, 22, 18, 0, 0);
  const cadenceMs = 24 * 60 * 60 * 1000;
  const lastPublishedAt = Date.UTC(2026, 6, 21, 23, 15, 1);
  assert.equal(
    exactCadenceWakeupAt({
      autonomousDelivery: true,
      sealedBufferCount: 2,
      lastPublishedAt,
      cadenceMs,
      now,
    }),
    lastPublishedAt + cadenceMs,
  );
  assert.equal(
    exactCadenceWakeupAt({
      autonomousDelivery: true,
      sealedBufferCount: 0,
      lastPublishedAt,
      cadenceMs,
      now,
    }),
    undefined,
  );
  assert.equal(
    exactCadenceWakeupAt({
      autonomousDelivery: false,
      sealedBufferCount: 2,
      lastPublishedAt,
      cadenceMs,
      now,
    }),
    undefined,
  );
  assert.equal(
    exactCadenceWakeupAt({
      autonomousDelivery: true,
      sealedBufferCount: 2,
      lastPublishedAt: now - cadenceMs,
      cadenceMs,
      now,
    }),
    undefined,
  );

  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(autopilot, /export const scheduleCadenceDeadline/);
  assert.match(autopilot, /withIndex\("by_site_scheduled"/);
  assert.match(autopilot, /ctx\.scheduler\.runAt/);
  assert.match(pipeline, /if \(!site\.autopilotEnabled\)/);
  assert.match(scheduler, /mode: "autopilot_disabled"/);
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

test("a replenished plan is filtered with the scheduler's exact overlap rule", () => {
  const accepted = filterNonCannibalizingTopics(
    [
      { primaryKeyword: "lead scoring automation" },
      { primaryKeyword: "lead scoring software" },
      { primaryKeyword: "website conversion checklist" },
      { primaryKeyword: "customer onboarding workflow" },
    ],
    ["automated lead scoring"],
  );
  assert.deepEqual(
    accepted.map((topic) => topic.primaryKeyword),
    ["website conversion checklist", "customer onboarding workflow"],
  );
});

test("topic discovery rotates intent seeds instead of replaying one exhausted request", () => {
  const base = [
    "lead qualification",
    "website conversion",
    "sales chatbot",
    "visitor engagement",
  ];
  const first = topicDiscoverySeedWindow(base, 0);
  const second = topicDiscoverySeedWindow(base, 1);
  assert.equal(first.length, 20);
  assert.equal(second.length, 20);
  assert.notDeepEqual(first, second);
  assert.ok(first.some((seed) => seed.includes("software")));
  assert.ok(second.some((seed) => !base.includes(seed)));
  assert.equal(MIN_VERIFIED_TOPIC_HORIZON, 7);

  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /topic_horizon_replenishment/);
  assert.match(scheduler, /MIN_VERIFIED_TOPIC_HORIZON/);
});
