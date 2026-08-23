import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  businessSignalMatch,
  coveredIntentTopics,
  coveredPrimaryKeywords,
  evaluateTopicBusinessFit,
  evergreenTopicLabel,
  exactCadenceWakeupAt,
  filterNonCannibalizingIntentTopics,
  filterNonCannibalizingTopics,
  filterNonCannibalizingSerpTopics,
  hasReliableSerpFingerprint,
  hasTerminalTopicFitFailure,
  isUnderfilledPlanContinuationPayload,
  MAX_NEW_CANDIDATES_PER_24H,
  MAX_QUALITY_REPLACEMENTS_PER_24H,
  MIN_APPROVED_BUFFER,
  MIN_VERIFIED_TOPIC_HORIZON,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  contentWorkBlocksQualityRecovery,
  currentHealthOutcome,
  isSealedReady,
  keywordMatchesBusinessModel,
  keywordMatchesBusinessSignals,
  keywordDifficultyCeiling,
  migrationBlocksAutopilot,
  normalizedSerpQuestions,
  pendingJobPriority,
  selectNonCannibalizingTopic,
  serpFingerprintOverlap,
  topicDiscoverySeedBatches,
  topicDiscoverySeedWindow,
  tenantDiscoveryAnchors,
  tenantTopicBusinessSignals,
  topicReplenishmentBudget,
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

test("topic recovery capacity scales with tenant cadence but stays bounded", () => {
  assert.equal(topicReplenishmentBudget(1), 3);
  assert.equal(topicReplenishmentBudget(7), 3);
  assert.equal(topicReplenishmentBudget(21), 5);
  assert.equal(topicReplenishmentBudget(Number.NaN), 3);
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  assert.match(jobs, /args\.reason\?\.startsWith\("topic_"\)/);
  assert.match(jobs, /payloadReason\.startsWith\("topic_"\)/);
});

test("tenant profile sentences become bounded traceable discovery anchors", () => {
  const anchors = tenantDiscoveryAnchors([
    "AI chat engagement powered by live website content learning",
    "Low website lead conversion rates despite strong traffic",
    "Automated lead qualification and booking link integration",
  ]);
  assert.ok(anchors.includes("ai chat engagement"));
  assert.ok(anchors.includes("live website content learning"));
  assert.ok(anchors.includes("website lead conversion rates"));
  assert.ok(anchors.includes("automated lead qualification"));
  assert.ok(anchors.includes("booking link integration"));
  assert.ok(anchors.every((anchor) => anchor.split(/\s+/).length <= 6));
});

test("every topic stage can share one tenant business-signal projection", () => {
  const signals = tenantTopicBusinessSignals({
    niche: "Conversion software for SaaS businesses",
    blogTheme: "Website conversion and sales automation",
    siteSummary: "An AI agent that converts website visitors into leads",
    targetAudienceSummary: "SaaS founders and growth teams",
    productUsage: "Answers visitor questions and qualifies leads",
    siteType: "SaaS",
    anchorKeywords: ["AI sales agent"],
    keyFeatures: ["lead scoring"],
    painPoints: ["low website conversion"],
  });
  assert.ok(signals.coreBusinessSignals.includes("SaaS founders and growth teams"));
  assert.ok(signals.coreBusinessSignals.includes("low website conversion"));
  assert.ok(!signals.productAnchorSignals.includes("low website conversion"));
  assert.deepEqual(signals.productAnchorSignals, [
    "AI sales agent",
    "lead scoring",
  ]);
  assert.deepEqual(signals.businessModelSignals, [
    "SaaS",
    "Conversion software for SaaS businesses",
    "An AI agent that converts website visitors into leads",
  ]);

  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.ok((scheduler.match(/tenantTopicBusinessSignals\(site\)/g) ?? []).length >= 2);
  assert.ok((pipeline.match(/tenantTopicBusinessSignals\(site\)/g) ?? []).length >= 3);
});

test("canonical tenant anchors reject adjacent service intent and preserve the product replacement", () => {
  const signals = tenantTopicBusinessSignals({
    siteType: "SaaS Product",
    niche: "B2B SaaS AI-powered lead generation and sales automation",
    blogTheme:
      "AI chatbot best practices and customer case studies showing lead improvements",
    siteSummary:
      "An AI sales agent that qualifies website visitors and captures leads",
    targetAudienceSummary: "B2B marketing and sales teams",
    productUsage: "Qualifies and hands off warm website leads",
    anchorKeywords: [
      "AI sales agent for websites",
      "lead qualification chatbot",
      "lead scoring and qualification tool",
    ],
    keyFeatures: [
      "Automated lead qualification and intent detection",
      "Lead scoring and hand-off system",
    ],
    painPoints: ["High customer acquisition costs"],
  });
  assert.equal(
    evaluateTopicBusinessFit({
      keyword: "customer service chatbot examples",
      label: "Customer Service Chatbot Examples That Convert",
      ...signals,
    }).eligible,
    false,
  );
  assert.equal(
    evaluateTopicBusinessFit({
      keyword: "lead scoring saas",
      label: "Lead Scoring SaaS for Automated Qualification",
      ...signals,
    }).eligible,
    true,
  );
});

test("final product-fit rejection is terminal for prose recovery", () => {
  assert.equal(
    hasTerminalTopicFitFailure([
      'Measured topic "customer service chatbot examples" failed the current tenant product-fit gate: keyword is not anchored to a specific tenant product or buyer problem',
    ]),
    true,
  );
  assert.equal(
    hasTerminalTopicFitFailure(["Meta description is too short"]),
    false,
  );
});

test("authority ceiling is identical for shortlist and final review", () => {
  assert.equal(keywordDifficultyCeiling(10, 999), 10);
  assert.equal(keywordDifficultyCeiling(10, 1_000), 20);
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
      { topicId: "used-topic", slug: "/chatbot-for-lead-generation", status: "published" },
      { slug: "/legacy-website-conversion-guide", status: "published" },
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
    autopilotHealthStatus({ schedulerStale: false, publicationMissed: false, bufferCount: 3, lastOutcome: "job_failed" }),
    "job_failed",
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

test("a newer strict sealed article clears only stale content-worker health", () => {
  assert.equal(
    currentHealthOutcome({
      lastOutcome: "job_failed",
      lastOutcomeAt: 100,
      latestSealedAt: 101,
    }),
    undefined,
  );
  assert.equal(
    currentHealthOutcome({
      lastOutcome: "quality_quarantined",
      lastOutcomeAt: 100,
      latestSealedAt: 99,
    }),
    "quality_quarantined",
  );
  assert.equal(
    currentHealthOutcome({
      lastOutcome: "publication_failed",
      lastOutcomeAt: 100,
      latestSealedAt: 101,
    }),
    "publication_failed",
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

test("a reserved underfill continuation yields to proved topics and due delivery", () => {
  const validContinuation = {
    reason: "topic_horizon_replenishment",
    underfilledPlanContinuation: {
      version: 1,
      firstExecutionCount: 1,
      remainingTopicCapacity: 9,
      queuedAt: Date.UTC(2026, 7, 23, 12),
    },
  };
  assert.equal(
    isUnderfilledPlanContinuationPayload(validContinuation),
    true,
  );
  assert.equal(
    isUnderfilledPlanContinuationPayload({
      ...validContinuation,
      underfilledPlanContinuation: {
        ...validContinuation.underfilledPlanContinuation,
        version: 2,
      },
    }),
    false,
  );
  assert.equal(
    isUnderfilledPlanContinuationPayload({
      ...validContinuation,
      underfilledPlanContinuation: {
        ...validContinuation.underfilledPlanContinuation,
        remainingTopicCapacity: 10,
      },
    }),
    false,
  );
  assert.equal(isUnderfilledPlanContinuationPayload({}), false);

  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /const pendingUnderfilledPlan = siteJobs\.find/);
  assert.match(scheduler, /\(job\.workerAttempts \?\? 0\) === 1/);
  assert.match(scheduler, /const contentBlockingJobs = pendingUnderfilledPlan/);
  assert.match(
    scheduler,
    /contentWorkBlocksQualityRecovery\(\s*contentBlockingJobs/,
  );
  assert.match(
    scheduler,
    /buffer\.length >= TARGET_APPROVED_BUFFER\) \{[\s\S]{0,180}if \(pendingUnderfilledPlan\)/,
  );
  assert.match(
    scheduler,
    /if \(!selectedTopic\) \{[\s\S]{0,120}if \(pendingUnderfilledPlan\)/,
  );
  assert.match(
    scheduler,
    /recentCandidates\.length >= candidateBudget\) \{[\s\S]{0,120}if \(pendingUnderfilledPlan\)/,
  );
  assert.match(scheduler, /mode: "pending_plan"/);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /const ordinarySchedulerContinuation =/);
  assert.match(
    pipeline,
    /isUnderfilledPlanContinuationPayload\(job\.payload\)/,
  );
});

test("specific jobs schedule the durable worker without a nested action deadline", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const wrapper = pipeline.slice(
    pipeline.indexOf("export const processSpecificJob"),
    pipeline.indexOf("export const processNextJob"),
  );
  assert.match(wrapper, /ctx\.scheduler\.runAfter\(/);
  assert.match(wrapper, /internal\.actions\.pipeline\.processNextJob/);
  assert.doesNotMatch(wrapper, /ctx\.runAction\(/);
  assert.doesNotMatch(
    jobs,
    /scheduler\.runAfter\([\s\S]*?processSpecificJob/,
  );
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
  assert.match(scheduler, /topicReplenishmentBudget/);
  assert.match(scheduler, /maximumRecent: maximumTopicReplenishments/);
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
    [{ topicId: "parent-topic", slug: "ai-chatbot-for-sales", status: "published" }],
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
  assert.match(pipeline, /Legacy SERP fingerprint backfill is disabled/);
  assert.match(pipeline, /metered expected-click evidence backfill workflow/);
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

test("plan retries reuse the original discovery rotation under one reserved budget", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /payload\?\.replenishmentSequence \?\? 0/,
  );
  assert.doesNotMatch(
    pipeline,
    /\(payload\?\.replenishmentSequence \?\? 0\) \+ \(job\.workerAttempts \?\? 0\)/,
  );
  assert.match(pipeline, /classifyPlanFailure\(message\)/);
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
    "website visitor engagement",
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
  assert.equal(keywordMatchesBusinessSignals("embed link", signals), false);
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

test("LeadPilot topic fit rejects measured keywords that do not describe its product or buyer problem", () => {
  const coreBusinessSignals = [
    "B2B SaaS AI lead generation and sales automation",
    "AI sales agent for websites",
    "lead qualification chatbot",
    "website lead generation automation",
    "AI chatbot for lead capture",
    "automated lead qualification software",
    "website visitor engagement AI",
  ];
  const businessModelSignals = [
    "SaaS Product",
    "AI lead generation software for business websites",
  ];
  const productAnchorSignals = [
    "AI sales agent for websites",
    "lead qualification chatbot",
    "website lead generation automation",
    "AI chatbot for lead capture",
    "website visitor engagement AI",
  ];

  for (const keyword of [
    "customer lead time",
    "lead connector crm",
    "lead generation program",
    "lead generation job",
    "real estate lead generation platforms",
    "best lead generation for realtors",
    "employee chatbot",
    "consultative selling training",
    "sales enablement courses",
    "sales manager training courses",
    "direct sales",
    "conversion rate optimization services",
  ]) {
    assert.equal(
      evaluateTopicBusinessFit({
        keyword,
        coreBusinessSignals,
        productAnchorSignals,
        businessModelSignals,
      }).eligible,
      false,
      `expected ${keyword} to fail tenant product fit`,
    );
  }

  assert.equal(
    evaluateTopicBusinessFit({
      keyword: "lead capture software",
      label: "How to Choose Lead Capture Software for Your Website",
      coreBusinessSignals,
      productAnchorSignals,
      businessModelSignals,
    }).eligible,
    true,
  );
});

test("LeadPilot topic fit preserves specific product and buyer-problem queries", () => {
  const coreBusinessSignals = [
    "B2B SaaS AI lead generation and sales automation",
    "AI sales agent for websites",
    "lead qualification chatbot",
    "website lead generation automation",
    "AI chatbot for lead capture",
    "automated lead qualification software",
    "website visitor engagement AI",
    "sales qualification techniques",
  ];
  const businessModelSignals = [
    "SaaS Product",
    "AI lead generation software for business websites",
  ];
  const productAnchorSignals = [
    "AI sales agent for websites",
    "lead qualification chatbot",
    "website lead generation automation",
    "AI chatbot for lead capture",
    "website visitor engagement AI",
    "sales qualification techniques",
  ];

  for (const keyword of [
    "website visitor engagement",
    "lead capture software",
    "website chatbot",
    "sales qualification frameworks",
    "automated lead qualification",
    "cost per sales qualified lead",
  ]) {
    assert.equal(
      evaluateTopicBusinessFit({
        keyword,
        coreBusinessSignals,
        productAnchorSignals,
        businessModelSignals,
      }).eligible,
      true,
      `expected ${keyword} to pass tenant product fit`,
    );
  }
});

test("business-fit stemming does not confuse consultation with consuming", () => {
  const fit = evaluateTopicBusinessFit({
    keyword: "sales consultation",
    coreBusinessSignals: [
      "AI sales agent for websites",
      "manual lead qualification consuming sales team time",
    ],
    productAnchorSignals: [
      "manual lead qualification consuming sales team time",
      "sales automation chat widget",
    ],
    businessModelSignals: ["B2B SaaS", "AI sales software"],
  });
  assert.equal(fit.eligible, false);
});

test("a measured growth seed cannot substitute for core tenant relevance", () => {
  const fit = evaluateTopicBusinessFit({
    keyword: "consultative selling examples",
    label: "Consultative Selling Examples and Real-World Applications",
    coreBusinessSignals: [
      "website chatbot",
      "automated lead qualification software",
      "website visitor engagement",
    ],
    businessModelSignals: ["SaaS Product", "AI sales software"],
    growthSeed: "consultative selling training",
  });

  assert.equal(fit.eligible, false);
  assert.match(fit.reasons.join("; "), /unsupported subject signals/);
});

test("business-fit evidence stays tenant-specific and auditable", () => {
  const construction = businessSignalMatch(
    "residential construction cost estimation",
    [
      "construction cost estimating",
      "builder ready cost estimate report",
      "residential builders",
    ],
  );
  const chatbot = businessSignalMatch(
    "residential construction cost estimation",
    ["website chatbot", "lead qualification software"],
  );

  assert.equal(construction.eligible, true);
  assert.ok(construction.score >= 70);
  assert.ok(construction.matchedDistinctiveRoots.length >= 2);
  assert.equal(chatbot.eligible, false);
  assert.ok(chatbot.unmatchedDistinctiveRoots.length >= 2);
});

test("the scheduler revalidates stale topics and the queue fails closed", () => {
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

  assert.match(scheduler, /export const auditTopicBusinessFit = internalAction/);
  assert.match(scheduler, /recordBusinessFitAuditsInternal/);
  assert.match(
    scheduler,
    /audits: businessFitAudits\.map\([\s\S]*topicId, eligible, score, version, reasons/,
  );
  assert.doesNotMatch(
    scheduler,
    /\{\s*siteId,\s*audits: businessFitAudits\s*\}/,
  );
  assert.match(scheduler, /topic_business_fit_replenishment/);
  assert.match(jobs, /topic_business_fit_failed/);
  assert.match(pipeline, /disqualifyQueuedTopicInternal/);
  assert.match(pipeline, /failureKind: "topic_business_fit_failed"/);
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
  assert.equal(
    keywordMatchesBusinessModel("conversion rate optimization services", [
      "AI sales software",
    ]),
    false,
  );
  assert.equal(
    keywordMatchesBusinessModel("sales enablement courses", [
      "AI sales software",
    ]),
    false,
  );
  assert.equal(
    keywordMatchesBusinessModel("sales enablement courses", [
      "sales training provider",
    ]),
    true,
  );
  assert.equal(
    keywordMatchesBusinessModel("how to train your chatbot", [
      "AI chatbot SaaS",
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
