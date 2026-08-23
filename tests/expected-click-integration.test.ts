import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getDomainAuthorities } from "../convex/actions/seoData.ts";
import {
  DATAFORSEO_AUTHORITY_SOURCE,
  DATAFORSEO_DEMAND_SOURCE,
  estimatedAuthorityBulkCostUsd,
  evaluateExpectedClickPortfolio,
  evaluateStoredExpectedClickPortfolio,
  expectedClickIntentKey,
  planSerpAuthorityCollection,
  type ExpectedClickTopicInput,
  type StoredExpectedClickTopicEvidence,
} from "../convex/lib/expectedClickPortfolio.ts";

const NOW = Date.UTC(2026, 7, 20, 12);
const STALE_AT = NOW - 46 * 24 * 60 * 60 * 1000;

function storedTopic(
  topicId: string,
  searchVolume = 1_000,
): StoredExpectedClickTopicEvidence {
  const serpObservedAt = NOW - 60_000;
  const serpTopUrls = Array.from(
    { length: 5 },
    (_, index) => `https://competitor-${topicId}-${index + 1}.test/page`,
  );
  return {
    topicId,
    keyword: `keyword ${topicId}`,
    searchVolume,
    searchDemandSource: DATAFORSEO_DEMAND_SOURCE,
    searchDemandMeasuredAt: NOW,
    searchDemandLocationCode: 2840,
    searchDemandLanguageCode: "en",
    serpTopUrls,
    serpObservedAt,
    serpLocationCode: 2840,
    serpLanguageCode: "en",
    serpAuthorityCompetitors: serpTopUrls.map((url, index) => ({
      position: index + 1,
      url,
      domainRank: 30 + index * 5,
      referringDomains: 20 + index,
      source: DATAFORSEO_AUTHORITY_SOURCE,
      measuredAt: NOW,
    })),
  };
}

const TENANT_AUTHORITY = {
  domain: "tenant.test",
  currentDomain: "tenant.test",
  domainRank: 45,
  referringDomains: 80,
  source: DATAFORSEO_AUTHORITY_SOURCE,
  measuredAt: NOW,
};

test("authority planning canonicalizes and deduplicates domains", () => {
  const plan = planSerpAuthorityCollection({
    tenantDomain: "https://www.tenant.test/path",
    topics: [{
      topicId: "canonical",
      results: [
        { position: 1, url: "https://WWW.Example.test/one" },
        { position: 2, url: "http://example.test/two" },
        { position: 3, url: "https://tenant.test/own-result" },
        { position: 4, url: "https://Other.test/page" },
        { position: 5, url: "https://third.test/page" },
        { position: 6, url: "https://fourth.test/page" },
      ],
    }],
  });

  assert.deepEqual(plan.domains, [
    "example.test",
    "other.test",
    "third.test",
    "fourth.test",
  ]);
  assert.equal(new Set(plan.domains).size, plan.domains.length);
  assert.ok(plan.topics[0].candidates.every((candidate) =>
    candidate.domain !== "tenant.test"
  ));
  assert.equal(plan.topics[0].candidates.length, 5);
});

test("authority planning hard-caps ten topics, five positions each, and fifty domains", () => {
  const plan = planSerpAuthorityCollection({
    tenantDomain: "tenant.test",
    topics: Array.from({ length: 12 }, (_, topicIndex) => ({
      topicId: `topic-${topicIndex}`,
      results: Array.from({ length: 6 }, (_, resultIndex) => ({
        position: resultIndex + 1,
        url: `https://domain-${topicIndex}-${resultIndex}.test/page`,
      })),
    })),
  });

  assert.equal(plan.topics.length, 10);
  assert.ok(plan.topics.every((topic) => topic.candidates.length === 5));
  assert.equal(plan.domains.length, 50);
  assert.equal(new Set(plan.domains).size, 50);
  assert.ok(!plan.topics.some((topic) => topic.topicId === "topic-10"));
  assert.equal(estimatedAuthorityBulkCostUsd(plan.domains.length), 0.0258);
  assert.equal(estimatedAuthorityBulkCostUsd(5_000), 0.0258);
});

test("batched authority lookup uses one-hundred rank scale and never invents missing target evidence", async () => {
  let capturedEndpoint = "";
  let capturedBody: Array<{ targets: string[]; rank_scale: string }> = [];
  const evidence = await getDomainAuthorities(
    [
      "https://WWW.Alpha.test/path",
      "alpha.test",
      "beta.test",
      "gamma.test",
    ],
    {
      measuredAt: NOW,
      request: async (endpoint, body) => {
        capturedEndpoint = endpoint;
        capturedBody = body;
        return {
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [{
                // A partial bulk result must leave omitted targets and items
                // without a measured rank unmeasured.
                items: [
                  {
                    url: "alpha.test",
                    main_domain_rank: 24,
                    backlinks: 30,
                    referring_domains: 12,
                  },
                  {
                    url: "gamma.test",
                    backlinks: 10,
                    referring_domains: 5,
                  },
                ],
              }],
            },
          ],
        };
      },
    },
  );

  assert.equal(capturedEndpoint, "backlinks/bulk_pages_summary/live");
  assert.equal(capturedBody.length, 1);
  assert.ok(capturedBody.every((task) => task.rank_scale === "one_hundred"));
  assert.deepEqual(capturedBody[0].targets, [
    "alpha.test",
    "beta.test",
    "gamma.test",
  ]);
  assert.deepEqual(evidence.map((item) => item.domain), ["alpha.test"]);
  assert.equal(evidence[0].source, DATAFORSEO_AUTHORITY_SOURCE);
  assert.equal(evidence[0].measuredAt, NOW);
});

test("stored expected-click evidence fails closed when tenant, demand, or SERP proof is stale or unbound", async (t) => {
  await t.test("missing SERP observation timestamp", () => {
    const topic = storedTopic("missing-serp-time");
    delete topic.serpObservedAt;
    const result = evaluateStoredExpectedClickPortfolio({
      topics: [topic],
      tenantAuthority: TENANT_AUTHORITY,
      monthlyOrganicClickGoal: 100,
      now: NOW,
    });
    assert.equal(result.status, "insufficient_evidence");
    assert.deepEqual(result.insufficientEvidenceTopicIds, [topic.topicId]);
  });

  await t.test("authority URL does not belong to current SERP snapshot", () => {
    const topic = storedTopic("mismatched-url");
    topic.serpAuthorityCompetitors![0].url = "https://old-serp.test/page";
    const result = evaluateStoredExpectedClickPortfolio({
      topics: [topic],
      tenantAuthority: TENANT_AUTHORITY,
      monthlyOrganicClickGoal: 100,
      now: NOW,
    });
    assert.equal(result.status, "insufficient_evidence");
    assert.match(result.topics[0].reasons.join(" "), /4\/5 required/i);
  });

  await t.test("demand measurement is stale", () => {
    const topic = storedTopic("stale-demand");
    topic.searchDemandMeasuredAt = STALE_AT;
    const result = evaluateStoredExpectedClickPortfolio({
      topics: [topic],
      tenantAuthority: TENANT_AUTHORITY,
      monthlyOrganicClickGoal: 100,
      now: NOW,
    });
    assert.equal(result.status, "insufficient_evidence");
    assert.match(result.topics[0].reasons.join(" "), /demand is missing, stale/i);
  });

  await t.test("tenant authority measurement is stale", () => {
    const result = evaluateStoredExpectedClickPortfolio({
      topics: [storedTopic("stale-tenant")],
      tenantAuthority: { ...TENANT_AUTHORITY, measuredAt: STALE_AT },
      monthlyOrganicClickGoal: 100,
      now: NOW,
    });
    assert.equal(result.status, "insufficient_evidence");
    assert.match(result.topics[0].reasons.join(" "), /tenant authority is missing, stale/i);
  });

  await t.test("evidence locale no longer matches the tenant market", () => {
    const result = evaluateStoredExpectedClickPortfolio({
      topics: [storedTopic("changed-market")],
      tenantAuthority: TENANT_AUTHORITY,
      monthlyOrganicClickGoal: 100,
      currentLocationCode: 2826,
      currentLanguageCode: "en",
      now: NOW,
    });
    assert.equal(result.status, "insufficient_evidence");
  });
});

function inputTopic(
  topicId: string,
  demand: number,
  urls: string[],
): ExpectedClickTopicInput {
  return {
    topicId,
    keyword: `keyword ${topicId}`,
    intentKey: expectedClickIntentKey(urls),
    demand: {
      monthlySearches: demand,
      source: DATAFORSEO_DEMAND_SOURCE,
      measuredAt: NOW,
    },
    serpCompetitors: Array.from({ length: 5 }, (_, index) => ({
      position: index + 1,
      url: urls[index],
      domainRank: 30 + index * 5,
      referringDomains: 20 + index,
      source: DATAFORSEO_AUTHORITY_SOURCE,
      measuredAt: NOW,
    })),
  };
}

test("reordered measured SERPs produce the same stable intent key", () => {
  const urls = ["a", "b", "c", "d", "e"].map(
    (name) => `https://${name}.test/page`,
  );
  assert.equal(expectedClickIntentKey(urls), expectedClickIntentKey([...urls].reverse()));
});

test("partially overlapping measured SERPs count only their strongest topic", () => {
  const shared = ["c", "d", "e"].map((name) => `https://${name}.test/page`);
  const weak = inputTopic("partial-weak", 1_000, [
    "https://a.test/page",
    "https://b.test/page",
    ...shared,
  ]);
  const strong = inputTopic("partial-strong", 2_000, [
    ...shared,
    "https://f.test/page",
    "https://g.test/page",
  ]);
  const result = evaluateExpectedClickPortfolio({
    topics: [weak, strong],
    tenantAuthority: TENANT_AUTHORITY,
    monthlyOrganicClickGoal: 1,
    now: NOW,
  });

  assert.deepEqual(result.countedTopicIds, ["partial-strong"]);
  assert.deepEqual(result.duplicateIntentTopicIds, ["partial-weak"]);
});

test("complete low-volume persisted inventory explicitly rejects the click goal", () => {
  const result = evaluateStoredExpectedClickPortfolio({
    topics: [storedTopic("low-one", 10), storedTopic("low-two", 10)],
    tenantAuthority: TENANT_AUTHORITY,
    monthlyOrganicClickGoal: 100,
    now: NOW,
  });

  assert.equal(result.decision, "reject");
  assert.equal(result.status, "below_goal");
  assert.equal(result.supportsGoal, false);
  assert.ok(result.expectedClicksMonthly < 100);
  assert.ok((result.clickDeficit ?? 0) > 0);
});

test("topic replenishment, scheduler health, and canonical growth goal share one portfolio audit", () => {
  const topics = readFileSync("convex/topics.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");

  assert.match(topics, /query\("seo_growth_goals"\)/);
  assert.match(topics, /DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL/);
  assert.match(topics, /currentLocationCode: dataForSeoLocationCode/);
  assert.ok(
    pipeline.indexOf("recordSeoAuthorityEvidenceInternal") <
      pipeline.indexOf("internal.topics.upsertMany"),
  );
  assert.match(pipeline, /Paid topic planning requires a queued plan job/);
  assert.match(scheduler, /topic_portfolio_goal_replenishment/);
  assert.match(scheduler, /topic_portfolio_evidence_replenishment/);
  assert.match(scheduler, /recordTopicPortfolioAudit/);
  assert.match(autopilot, /portfolioSupportsGoal/);
  assert.match(autopilot, /topic_portfolio_below_goal/);
});
