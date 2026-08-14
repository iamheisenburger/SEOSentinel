import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  coveredIntentTopics,
  coveredPrimaryKeywords,
  evergreenTopicLabel,
  exactCadenceWakeupAt,
  filterNonCannibalizingIntentTopics,
  filterNonCannibalizingTopics,
  filterNonCannibalizingSerpTopics,
  hasReliableSerpFingerprint,
  MAX_NEW_CANDIDATES_PER_24H,
  MAX_QUALITY_REPLACEMENTS_PER_24H,
  MIN_APPROVED_BUFFER,
  MIN_VERIFIED_TOPIC_HORIZON,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  contentWorkBlocksQualityRecovery,
  isSealedReady,
  keywordMatchesBusinessModel,
  keywordMatchesBusinessSignals,
  migrationBlocksAutopilot,
  normalizedSerpQuestions,
  pendingJobPriority,
  selectNonCannibalizingTopic,
  serpFingerprintOverlap,
  topicDiscoverySeedBatches,
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

test("cached SERP records without a People Also Ask block stay array-shaped", () => {
  assert.deepEqual(normalizedSerpQuestions(undefined), []);
  assert.deepEqual(normalizedSerpQuestions(null), []);
  assert.deepEqual(
    normalizedSerpQuestions(["How does it work?", "", 42, "Who is it for?"]),
    ["How does it work?", "Who is it for?"],
  );
});

test("pending plan work yields to bounded quality recovery", () => {
  assert.equal(
    contentWorkBlocksQualityRecovery([{ type: "plan" }], true),
    false,
  );
  assert.equal(
    contentWorkBlocksQualityRecovery([{ type: "plan" }], false),
    true,
  );
  assert.equal(
    contentWorkBlocksQualityRecovery(
      [{ type: "plan" }, { type: "article" }],
      true,
    ),
    true,
  );
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(pipeline, /pending_plan:[\s\S]*pending_topic_plan_ready_for_processing/);
  assert.match(scheduler, /mode: "pending_plan"/);
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

test("every completed run reconciles the current sealed buffer count", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const finishRun = autopilot.slice(
    autopilot.indexOf("export const markRunFinished"),
    autopilot.indexOf("export const markRunFailed"),
  );
  assert.match(
    finishRun,
    /const currentReady = await ctx\.db[\s\S]*const approvedBufferCount = currentReady\.filter\(isSealedReady\)\.length/,
  );
  assert.match(finishRun, /approvedBufferCount,/);
  assert.doesNotMatch(
    finishRun,
    /approvedBufferCount === undefined/,
  );
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

test("topic selection normalizes close SEO synonyms without collapsing distinct intent", () => {
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "when to use conversational AI for sales" }],
      ["AI chatbot for sales"],
    ),
    undefined,
  );
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "how to engage website visitors in real time" }],
      ["website visitor engagement"],
    ),
    undefined,
  );
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "chatbot vs contact forms" }],
      ["AI chatbot for sales"],
    )?.primaryKeyword,
    "chatbot vs contact forms",
  );
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "sales leads" }],
      ["lead sales software"],
    )?.primaryKeyword,
    "sales leads",
  );
  assert.equal(
    selectNonCannibalizingTopic(
      [{ primaryKeyword: "sales leads software" }],
      ["sales leads"],
    ),
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

test("live SERP fingerprints block same-intent topics with different wording", () => {
  const common = [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/d",
  ];
  const covered = [{
    primaryKeyword: "website visitor engagement",
    serpTopUrls: [...common, "https://one.test/e", "https://one.test/f"],
  }];
  const accepted = filterNonCannibalizingSerpTopics(
    [
      {
        primaryKeyword: "improve website conversations",
        serpTopUrls: [...common, "https://two.test/e", "https://two.test/f"],
      },
      {
        primaryKeyword: "sales discovery checklist",
        serpTopUrls: [
          "https://example.com/a?ref=serp",
          "https://distinct.test/b",
          "https://distinct.test/c",
          "https://distinct.test/d",
          "https://distinct.test/e",
          "https://distinct.test/f",
        ],
      },
    ],
    covered,
  );
  assert.deepEqual(
    accepted.map((topic) => topic.primaryKeyword),
    ["sales discovery checklist"],
  );
  assert.deepEqual(
    serpFingerprintOverlap(
      covered[0].serpTopUrls,
      [...common, "https://two.test/e", "https://two.test/f"],
    ),
    { shared: 4, coefficient: 4 / 6 },
  );
  assert.equal(hasReliableSerpFingerprint(common), false);
  assert.equal(
    hasReliableSerpFingerprint([...common, "https://example.com/e"]),
    true,
  );
});

test("live SERP evidence overrides lexical similarity while legacy rows fail closed", () => {
  const distinctA = [1, 2, 3, 4, 5, 6].map((n) =>
    `https://sales-a.test/${n}`
  );
  const distinctB = [1, 2, 3, 4, 5, 6].map((n) =>
    `https://sales-b.test/${n}`
  );
  assert.deepEqual(
    filterNonCannibalizingIntentTopics(
      [{
        primaryKeyword: "conversational AI for sales",
        serpTopUrls: distinctB,
      }],
      [{ primaryKeyword: "AI chatbot for sales", serpTopUrls: distinctA }],
    ).map((topic) => topic.primaryKeyword),
    ["conversational AI for sales"],
  );
  assert.deepEqual(
    filterNonCannibalizingIntentTopics(
      [{ primaryKeyword: "conversational AI for sales" }],
      [{ primaryKeyword: "AI chatbot for sales" }],
    ),
    [],
  );
  const covered = coveredIntentTopics(
    [{
      _id: "parent-topic",
      status: "used",
      primaryKeyword: "AI chatbot for sales",
      serpTopUrls: distinctA,
    }],
    [{ topicId: "parent-topic", slug: "ai-chatbot-for-sales" }],
  );
  assert.deepEqual(
    filterNonCannibalizingIntentTopics(
      [{
        primaryKeyword: "conversational AI for sales",
        serpTopUrls: distinctB,
      }],
      covered,
    ).map((topic) => topic.primaryKeyword),
    ["conversational AI for sales"],
  );
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /coveredIntentTopics/);
  assert.match(scheduler, /filterNonCannibalizingIntentTopics/);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /export const backfillTopicSerpFingerprints = internalAction/);
  assert.match(pipeline, /DataForSEO returned fewer than five organic URLs/);
  assert.match(pipeline, /Math\.min\(5, Math\.floor\(limit \?\? 5\)\)/);
  assert.match(pipeline, /internal\.actions\.pipeline\.backfillTopicSerpFingerprints/);
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

test("topic discovery splits a rotated window into bounded distinct requests", () => {
  const seeds = Array.from({ length: 20 }, (_, index) => `Business Seed ${index}`);
  const batches = topicDiscoverySeedBatches(seeds, 5, 3);

  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 5]);
  assert.equal(new Set(batches.flat()).size, 15);
  assert.equal(batches[0][0], "business seed 0");
  assert.equal(batches[2][4], "business seed 14");
});

test("plan retries rotate discovery using the durable worker attempt count", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /\(payload\?\.replenishmentSequence \?\? 0\) \+ \(job\.workerAttempts \?\? 0\)/,
  );
  assert.match(pipeline, /minimumResults: 20/);
  assert.match(pipeline, /targetDomain: site\.domain/);
  assert.match(pipeline, /if \(discoveredKeywords\.length > 0\)/);
  assert.match(pipeline, /if \(candidates\.length > 0\)/);
});

test("verified volume still requires a specific business relevance signal", () => {
  const signals = [
    "AI website agent",
    "visitor qualification",
    "lead capture",
    "conversion",
    "embedded chat widget",
    "lead generation strategies",
    "sales qualification techniques",
    "outside business hours",
    "sales development costs",
  ];

  assert.equal(
    keywordMatchesBusinessSignals("website visitor engagement", signals),
    true,
  );
  assert.equal(
    keywordMatchesBusinessSignals("lead capture software", signals),
    true,
  );
  assert.equal(keywordMatchesBusinessSignals("embed link", signals), true);
  assert.equal(keywordMatchesBusinessSignals("website page", signals), false);
  assert.equal(keywordMatchesBusinessSignals("free ai website", signals), false);
  assert.equal(keywordMatchesBusinessSignals("agent works", signals), false);
  assert.equal(keywordMatchesBusinessSignals("outside sales", signals), false);
  assert.equal(keywordMatchesBusinessSignals("sales strategy", signals), false);
  assert.equal(
    keywordMatchesBusinessSignals(
      "sales development representative",
      signals,
    ),
    false,
  );
});

test("generic-only profiles require two matching signals", () => {
  assert.equal(
    keywordMatchesBusinessSignals("AI sales agent tools", ["AI sales agent"]),
    true,
  );
  assert.equal(
    keywordMatchesBusinessSignals("free AI websites", ["AI sales agent"]),
    false,
  );
});

test("service-provider intent must match the tenant business model", () => {
  assert.equal(
    keywordMatchesBusinessModel("conversion optimization consulting", [
      "AI sales software",
      "website chatbot SaaS",
    ]),
    false,
  );
  assert.equal(
    keywordMatchesBusinessModel("agency lead generation software", [
      "AI sales software",
    ]),
    true,
  );
  assert.equal(
    keywordMatchesBusinessModel("conversion optimization consulting", [
      "conversion consulting agency",
    ]),
    true,
  );
});

test("broad cost language cannot smuggle an unrelated audience into a niche plan", () => {
  const constructionSignals = [
    "construction cost estimating",
    "builder ready cost estimate report",
    "residential builders",
  ];
  assert.equal(
    keywordMatchesBusinessSignals(
      "cost benefit analysis for students",
      constructionSignals,
    ),
    false,
  );
  assert.equal(
    keywordMatchesBusinessSignals(
      "DA stage construction cost estimation",
      constructionSignals,
    ),
    true,
  );
  assert.equal(
    keywordMatchesBusinessSignals(
      "DA Stage Cost Estimation for Residential Projects",
      ["cost benefit analysis for students"],
    ),
    false,
  );
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /Business\/title relevance gate/);
  assert.match(
    pipeline,
    /preLinkIssues\.length === 0 && targetAlignmentPassed/,
  );
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /hasTerminalTargetAlignmentFailure/);
});

test("evergreen topic labels cannot retain a stale generated year", () => {
  assert.equal(
    evergreenTopicLabel(
      "Sales Automation: The Complete 2024 Guide",
      2026,
    ),
    "Sales Automation: The Complete Guide",
  );
  assert.equal(
    evergreenTopicLabel("Sales Automation Guide 2026", 2026),
    "Sales Automation Guide 2026",
  );
});
