import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";
import { coveredIntentTopics } from "../convex/lib/autopilotBuffer.ts";
import {
  articleReservesTopicIntent,
  decideTopicUpsert,
  dormantTopicRevivalPatch,
  isRecoverableWorkerQualityIssue,
  normalizeTopicIntentKeyword,
  recoverableWorkerQualityFailure,
  reconciledTopicStatus,
  terminalTopicQualitySettlement,
  topicMatchesLegacyWorkerFailureSettlement,
} from "../convex/lib/topicLifecycle.ts";

test("only externally published or current sealed-ready artifacts reserve intent", () => {
  assert.equal(articleReservesTopicIntent({ status: "draft" }), false);
  assert.equal(articleReservesTopicIntent({
    status: "review",
    publicationGateStatus: "passed",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "sealed",
  }), false);
  assert.equal(articleReservesTopicIntent({
    status: "ready",
    publicationGateStatus: "blocked",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "sealed",
  }), false);
  assert.equal(articleReservesTopicIntent({
    status: "ready",
    publicationGateStatus: "passed",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION - 1,
    auditedContentHash: "stale",
  }), false);
  assert.equal(articleReservesTopicIntent({
    status: "ready",
    publicationGateStatus: "passed",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "sealed",
  }), true);
  assert.equal(articleReservesTopicIntent({ status: "published" }), true);
});

test("failed linked drafts re-enter revalidation instead of poisoning intent", () => {
  assert.equal(reconciledTopicStatus({
    currentStatus: "used",
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "planned");
  assert.equal(reconciledTopicStatus({
    currentStatus: "cannibalizing",
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "planned");
  assert.equal(reconciledTopicStatus({
    currentStatus: "queued",
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: true,
  }), "queued");
  assert.equal(reconciledTopicStatus({
    currentStatus: "planned",
    hasLinkedArticles: true,
    hasReservingArticle: true,
    hasActiveArticleJob: false,
  }), "used");
});

test("bounded topic quality exhaustion is terminal across fresh draft generations", () => {
  const args = {
    gateStatus: "blocked",
    issues: ["Article is too thin (1042 words; minimum 1200)."],
    maximumRevisions: 2,
    article: {
      siteId: "site-a",
      status: "review",
      topicId: "topic-a",
    },
    topic: {
      _id: "topic-a",
      siteId: "site-a",
      status: "queued",
    },
    checkedAt: 1_787_270_002_000,
  };
  const settlement = terminalTopicQualitySettlement({
    ...args,
    qualityRevisionCount: 2,
  });
  assert.ok(settlement);
  assert.equal(settlement.topicPatch.status, "disqualified");
  assert.equal(settlement.topicPatch.contentFeasibilityStatus, "too_thin");
  assert.match(
    settlement.topicPatch.disqualifiedReason,
    /^content_feasibility:too_thin:/,
  );
  assert.equal(terminalTopicQualitySettlement({
    ...args,
    qualityRevisionCount: 1,
  }), null);

  assert.equal(reconciledTopicStatus({
    currentStatus: "queued",
    contentFeasibilityStatus: "too_thin",
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: true,
  }), "disqualified");
});

test("an exhausted deterministic worker length failure becomes an article recovery issue", () => {
  const failure = recoverableWorkerQualityFailure({
    error: "Reviewed draft missed the length contract (1031/1200-3000 words)",
    attempts: 4,
    maximumAttempts: 4,
  });
  assert.ok(failure);
  assert.equal(failure.legacyFeasibilityStatus, "too_thin");
  assert.equal(
    failure.recoveryIssue,
    "Quality-review algorithm exhausted the strict length contract (1031/1200-3000 words).",
  );
  assert.equal(isRecoverableWorkerQualityIssue(failure.recoveryIssue), true);
});

test("worker recovery classification excludes transient and unexhausted failures", () => {
  const base = {
    attempts: 4,
    maximumAttempts: 4,
  };
  assert.equal(recoverableWorkerQualityFailure({
    ...base,
    error: "Provider connection timed out",
  }), null);
  assert.equal(recoverableWorkerQualityFailure({
    ...base,
    error:
      "Provider said: Reviewed draft missed the length contract (1031/1200-3000 words)",
  }), null);
  assert.equal(recoverableWorkerQualityFailure({
    ...base,
    attempts: 3,
    error: "Reviewed draft missed the length contract (1031/1200-3000 words)",
  }), null);
  assert.equal(isRecoverableWorkerQualityIssue(
    "Customer mentioned Quality-review algorithm exhausted the strict length contract (1031/1200-3000 words).",
  ), false);
});

test("legacy worker disqualification reversal requires an exact durable receipt", () => {
  const failure = recoverableWorkerQualityFailure({
    error: "Worker failure exhausted after 4 attempts: Reviewed draft missed the length contract (1031/1200-3000 words)",
    attempts: 4,
    maximumAttempts: 4,
  });
  assert.ok(failure);
  const exact = {
    status: "disqualified",
    contentFeasibilityStatus: "too_thin",
    contentFeasibilityVersion: 1,
    contentFeasibilityIssues: [
      "Article is too thin (1031 words; minimum 1200).",
    ],
    disqualifiedReason:
      "content_feasibility:too_thin: Article is too thin (1031 words; minimum 1200).",
  };
  assert.equal(topicMatchesLegacyWorkerFailureSettlement(exact, failure), true);
  assert.equal(topicMatchesLegacyWorkerFailureSettlement({
    ...exact,
    contentFeasibilityIssues: [
      "Article is too thin (1031 words; minimum 1200).",
      "Independent publication audit failed.",
    ],
  }, failure), false);
  assert.equal(topicMatchesLegacyWorkerFailureSettlement({
    ...exact,
    disqualifiedReason: "owner_disqualified",
  }, failure), false);
});

test("a stale used topic backed only by a rejected draft is not coverage", () => {
  const covered = coveredIntentTopics(
    [{
      _id: "topic-1",
      status: "used",
      primaryKeyword: "website visitor qualification",
    }],
    [{
      topicId: "topic-1",
      slug: "website-visitor-qualification",
      status: "rejected",
    }],
  );
  assert.deepEqual(covered, []);
});

test("reconciliation preserves independent disqualification and SERP overlap", () => {
  assert.equal(reconciledTopicStatus({
    currentStatus: "disqualified",
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "disqualified");
  assert.equal(reconciledTopicStatus({
    currentStatus: "used",
    businessFitEligible: false,
    hasLinkedArticles: true,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "disqualified");
  assert.equal(reconciledTopicStatus({
    currentStatus: "cannibalizing",
    hasLinkedArticles: false,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "cannibalizing");
  assert.equal(reconciledTopicStatus({
    currentStatus: "plan_checkpoint",
    checkpointExecutionLocked: true,
    hasLinkedArticles: false,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "plan_checkpoint");
  assert.equal(reconciledTopicStatus({
    currentStatus: "disqualified",
    checkpointExecutionLocked: true,
    hasLinkedArticles: false,
    hasReservingArticle: false,
    hasActiveArticleJob: false,
  }), "disqualified");
});

test("migration is explicitly tenant-scoped, paginated, dry-runnable, and idempotent", () => {
  const source = readFileSync("convex/topics.ts", "utf8");
  assert.match(source, /export const reconcileIntentLifecycleInternal/);
  assert.match(source, /siteId: v\.id\("sites"\)/);
  assert.match(source, /apply: v\.boolean\(\)/);
  assert.match(source, /withIndex\("by_site"/);
  assert.match(source, /cursor: cursor \?\? null/);
  assert.match(source, /reconcileTopicLifecycle/);
});

test("draft and terminal job transitions invoke lifecycle reconciliation", () => {
  const articles = readFileSync("convex/articles.ts", "utf8");
  const createDraft = articles.slice(
    articles.indexOf("export const createDraftForJob"),
    articles.indexOf("export const updateStatus"),
  );
  assert.doesNotMatch(createDraft, /status:\s*"used"/);
  assert.match(articles, /async function syncSummary[\s\S]*reconcileTopicLifecycle/);

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  assert.match(jobs, /export const markDone[\s\S]*reconcileJobTopicLifecycle/);
  assert.match(jobs, /export const markFailed[\s\S]*reconcileJobTopicLifecycle/);
  assert.match(jobs, /export const markRetryableFailure[\s\S]*reconcileJobTopicLifecycle/);
  assert.match(jobs, /export const markRetryableFailure[\s\S]*recoverableWorkerQualityFailure/);
  assert.match(
    jobs,
    /settleExhaustedArticleQualityFailuresForSiteInternal[\s\S]*by_site_type_created[\s\S]*recoverableWorkerQualityFailure[\s\S]*topicMatchesLegacyWorkerFailureSettlement/,
  );
  assert.match(articles, /terminalTopicQualitySettlement/);
});

test("the natural cadence migrates only exact pre-fix quality jobs into versioned recovery", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const migration = jobs.slice(
    jobs.indexOf("export const settleExhaustedArticleQualityFailuresForSiteInternal"),
    jobs.indexOf("export const markPublishFailed"),
  );
  assert.match(migration, /payload\.qualityRetry !== true/);
  assert.match(migration, /qualityRecoveryAttemptVersionFromJob\(job\)/);
  assert.match(migration, /articleMatchesCurrentDomain\(site, article\)/);
  assert.match(migration, /new Set<string>\(\)/);
  assert.match(migration, /topicMatchesLegacyWorkerFailureSettlement/);
  assert.doesNotMatch(migration, /ctx\.scheduler|processNextJob/);

  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const schedule = scheduler.slice(
    scheduler.indexOf("export const scheduleCadence"),
    scheduler.indexOf("export const", scheduler.indexOf("export const scheduleCadence") + 20),
  );
  assert.match(
    schedule,
    /settleExhaustedArticleQualityFailuresForSiteInternal/,
  );
  assert.doesNotMatch(schedule, /runControlledSmtpImapCanaryInternal/);
});

test("published and current sealed-ready coverage block exact or similar intent", () => {
  const articles = [
    { topicId: "published", status: "published" },
    {
      topicId: "ready",
      status: "ready",
      publicationGateStatus: "passed",
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "sealed-ready",
    },
  ];
  const reservingTopicIds = new Set(
    articles
      .filter(articleReservesTopicIntent)
      .map((article) => article.topicId),
  );
  const existingTopics = [
    { id: "published", primaryKeyword: "website sales chatbot" },
    { id: "ready", primaryKeyword: "qualify website visitors" },
  ];

  assert.equal(decideTopicUpsert({
    candidateKeyword: "best website sales chatbot",
    existingTopics,
    reservingTopicIds,
  }).kind, "blocked");
  assert.equal(decideTopicUpsert({
    candidateKeyword: "qualify website visitors",
    existingTopics,
    reservingTopicIds,
  }).kind, "blocked");
});

test("failed and quarantined exact rows revive instead of duplicating", () => {
  for (const article of [
    { status: "rejected" },
    {
      status: "ready",
      publicationGateStatus: "blocked",
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "quarantined",
    },
  ]) {
    const reservingTopicIds = new Set<string>();
    if (articleReservesTopicIntent(article)) reservingTopicIds.add("dormant");
    assert.deepEqual(decideTopicUpsert({
      candidateKeyword: "AI chatbot lead qualification",
      existingTopics: [{
        id: "dormant",
        primaryKeyword: " ai  chatbot lead qualification ",
      }],
      reservingTopicIds,
    }), { kind: "revive", topicId: "dormant" });
  }
});

test("terminal content infeasibility blocks new rows for the same intent", () => {
  assert.deepEqual(decideTopicUpsert({
    candidateKeyword: "intent detection dataset",
    existingTopics: [{
      id: "exhausted",
      primaryKeyword: "Intent Detection Dataset",
      contentFeasibilityStatus: "quality_exhausted",
    }],
    reservingTopicIds: new Set(),
  }), { kind: "blocked", blockingKeyword: "Intent Detection Dataset" });
});

test("non-exact dormant rows do not poison lexical dedupe", () => {
  assert.deepEqual(decideTopicUpsert({
    candidateKeyword: "ai chatbot for sales teams",
    existingTopics: [{
      id: "failed-neighbor",
      primaryKeyword: "ai chatbot for sales",
    }],
    reservingTopicIds: new Set(),
  }), { kind: "insert" });
});

test("accepted keyword keys use the same whitespace normalization as planner recovery", () => {
  assert.equal(
    normalizeTopicIntentKeyword("  B2B   Lead\nQualification "),
    "b2b lead qualification",
  );
});

test("dormant revival stores fresh verified evidence and clears stale disqualification", () => {
  const current = {
    primaryKeyword: "ai chatbot for sales",
    status: "disqualified",
    searchVolume: 10,
    searchDemandMeasuredAt: 1,
    expectedClicksMonthly: 0,
    disqualifiedReason: "legacy failure",
  };
  const supplied = {
    primaryKeyword: "ai chatbot for sales",
    status: "planned",
    searchVolume: 1_900,
    searchDemandSource: "dataforseo_google_ads_search_volume_live",
    searchDemandMeasuredAt: 1_787_270_000_000,
    serpObservedAt: 1_787_270_001_000,
    serpTopUrls: ["https://one.example/a", "https://two.example/b"],
    expectedClicksMonthly: 37.5,
    expectedClickAuditVersion: 1,
    businessFitEligible: true,
  };
  const patch = dormantTopicRevivalPatch(
    current,
    supplied,
    1_787_270_002_000,
  );

  assert.equal(patch.changed, true);
  assert.equal(patch.fields.searchVolume, 1_900);
  assert.equal(patch.fields.searchDemandMeasuredAt, 1_787_270_000_000);
  assert.equal(patch.fields.serpObservedAt, 1_787_270_001_000);
  assert.equal(patch.fields.expectedClicksMonthly, 37.5);
  assert.equal(patch.fields.disqualifiedReason, undefined);
  assert.equal(patch.fields.businessFitCheckedAt, 1_787_270_002_000);
  assert.equal(patch.fields.updatedAt, 1_787_270_002_000);
});

test("replaying an identical dormant revival is idempotent", () => {
  const supplied = {
    primaryKeyword: "ai chatbot for sales",
    status: "planned",
    searchVolume: 1_900,
    searchDemandMeasuredAt: 1_787_270_000_000,
    businessFitEligible: true,
    disqualifiedReason: undefined,
  };
  const first = dormantTopicRevivalPatch(
    { primaryKeyword: supplied.primaryKeyword, status: "used" },
    supplied,
    100,
  );
  assert.equal(first.changed, true);

  const replay = dormantTopicRevivalPatch(
    { ...supplied, updatedAt: 100 },
    supplied,
    200,
  );
  assert.equal(replay.changed, false);
  assert.equal("updatedAt" in replay.fields, false);
});

test("the database upsert shares canonical publication coverage and revives as planned", () => {
  const topics = readFileSync("convex/topics.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const upsert = topics.slice(
    topics.indexOf("export const upsertMany"),
    topics.indexOf("export const remove"),
  );
  assert.match(upsert, /coveredIntentTopics/);
  assert.match(upsert, /articleReservesTopicIntent/);
  assert.match(upsert, /status:\s*"planned"/);
  assert.match(upsert, /savedKeywordKeys|acceptedKeywordKeys/);
  assert.doesNotMatch(upsert, /ctx\.db\.patch\([^,]*article/);
  assert.match(
    pipeline,
    /acceptedKeywordKeys\.has\(normalizeTopicIntentKeyword\(topic\.primaryKeyword\)\)/,
  );
});
