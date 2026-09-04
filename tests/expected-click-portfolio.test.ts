import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_CLICK_PORTFOLIO_VERSION,
  ORGANIC_CTR_BY_POSITION,
  estimateTopicExpectedClicks,
  evaluateExpectedClickPortfolio,
  organicCtrAtPosition,
  validateOrganicClickGoal,
  type ExpectedClickTopicInput,
  type MeasuredAuthority,
  type MeasuredSerpCompetitor,
} from "../convex/lib/expectedClickPortfolio.ts";

const NOW = Date.UTC(2026, 7, 20, 12);
const SOURCE = "dataforseo:rank_scale_100";

function authority(domainRank: number, measuredAt = NOW): MeasuredAuthority {
  return {
    domainRank,
    referringDomains: Math.max(1, Math.round(domainRank * 4)),
    source: SOURCE,
    measuredAt,
  };
}

function competitors(ranks: number[], measuredAt = NOW): MeasuredSerpCompetitor[] {
  return ranks.map((domainRank, index) => ({
    ...authority(domainRank, measuredAt),
    position: index + 1,
    url: `https://competitor-${index + 1}.test/article`,
  }));
}

function topic(
  topicId: string,
  monthlySearches: number,
  ranks: number[],
  intentKey?: string,
): ExpectedClickTopicInput {
  return {
    topicId,
    keyword: `keyword ${topicId}`,
    intentKey,
    demand: {
      monthlySearches,
      source: "dataforseo:keyword_overview",
      measuredAt: NOW,
    },
    serpCompetitors: competitors(ranks),
  };
}

test("the versioned CTR curve is bounded and strictly declines through page one", () => {
  const ctrs = Object.keys(ORGANIC_CTR_BY_POSITION)
    .map(Number)
    .sort((left, right) => left - right)
    .map(organicCtrAtPosition);
  assert.equal(ctrs.length, 10);
  assert.ok(ctrs.every((ctr) => ctr > 0 && ctr < 1));
  for (let index = 1; index < ctrs.length; index += 1) {
    assert.ok(ctrs[index] < ctrs[index - 1]);
  }
  assert.equal(organicCtrAtPosition(11), 0);
  assert.equal(organicCtrAtPosition(Number.NaN), 0);
});

test("topic clicks equal measured demand times CTR times rank probability", () => {
  const result = estimateTopicExpectedClicks({
    topic: topic("formula", 2_000, [32, 36, 39, 42, 45, 48, 51, 54, 58, 62]),
    tenantAuthority: authority(50),
    now: NOW,
  });

  assert.equal(result.status, "eligible");
  assert.ok(result.projectedPosition !== null);
  assert.equal(
    result.expectedClicksMonthly,
    Math.round(2_000 * result.ctr * result.rankProbability * 100) / 100,
  );
  assert.equal(result.version, EXPECTED_CLICK_PORTFOLIO_VERSION);
});

test("portfolio intent grouping never changes individual topic eligibility", () => {
  const inputs = [
    topic("first", 2_000, [32, 36, 39, 42, 45, 48, 51, 54, 58, 62], "same-intent"),
    topic("second", 900, [35, 38, 41, 44, 47, 50, 53, 56, 59, 63], "same-intent"),
    { ...topic("missing", 500, [20, 25, 30, 35, 40]), demand: undefined },
  ];
  const tenantAuthority = authority(50);
  const directStatuses = new Map(inputs.map((input) => [
    input.topicId,
    estimateTopicExpectedClicks({ topic: input, tenantAuthority, now: NOW }).status,
  ]));
  const portfolio = evaluateExpectedClickPortfolio({
    topics: inputs,
    tenantAuthority,
    monthlyOrganicClickGoal: 100,
    now: NOW,
  });

  assert.deepEqual(
    new Map(portfolio.topics.map((result) => [result.topicId, result.status])),
    directStatuses,
  );
  assert.ok(portfolio.duplicateIntentTopicIds.includes("second"));
});

test("the same demand is worth more when tenant authority exceeds the actual SERP", () => {
  const openSerp = estimateTopicExpectedClicks({
    topic: topic("open", 1_000, [20, 25, 30, 35, 40, 45, 50, 55, 60, 65]),
    tenantAuthority: authority(70),
    now: NOW,
  });
  const strongSerp = estimateTopicExpectedClicks({
    topic: topic("strong", 1_000, [40, 45, 50, 55, 60, 65, 70, 75, 80, 85]),
    tenantAuthority: authority(20),
    now: NOW,
  });

  assert.equal(openSerp.status, "eligible");
  assert.equal(strongSerp.status, "eligible");
  assert.ok(openSerp.rankProbability > strongSerp.rankProbability);
  assert.ok(openSerp.projectedPosition! < strongSerp.projectedPosition!);
  assert.ok(openSerp.expectedClicksMonthly > strongSerp.expectedClicksMonthly);
});

test("unmeasured or stale evidence never masquerades as an easy keyword", () => {
  const staleAt = NOW - 46 * 24 * 60 * 60 * 1000;
  const missingDemand = topic("missing", 1_000, [10, 20, 30, 40, 50]);
  delete missingDemand.demand;
  const missing = estimateTopicExpectedClicks({
    topic: missingDemand,
    tenantAuthority: authority(90),
    now: NOW,
  });
  const stale = estimateTopicExpectedClicks({
    topic: topic("stale", 1_000, [10, 20, 30, 40, 50]),
    tenantAuthority: authority(90, staleAt),
    now: NOW,
  });

  assert.equal(missing.status, "insufficient_evidence");
  assert.equal(missing.expectedClicksMonthly, 0);
  assert.match(missing.reasons.join(" "), /demand is missing, stale, or not auditable/i);
  assert.equal(stale.status, "insufficient_evidence");
  assert.equal(stale.expectedClicksMonthly, 0);
  assert.match(stale.reasons.join(" "), /Tenant authority is missing, stale/i);
});

test("mixed authority providers and shallow SERPs fail closed", () => {
  const mixed = topic("mixed", 1_000, [25, 30, 35, 40, 45]);
  mixed.serpCompetitors[0].source = "another-provider";
  const result = estimateTopicExpectedClicks({
    topic: mixed,
    tenantAuthority: authority(50),
    now: NOW,
  });
  const shallow = estimateTopicExpectedClicks({
    topic: topic("shallow", 1_000, [25, 30, 35, 40]),
    tenantAuthority: authority(50),
    now: NOW,
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.match(result.reasons.join(" "), /incompatible provider scales/i);
  assert.equal(shallow.status, "insufficient_evidence");
  assert.match(shallow.reasons.join(" "), /4\/5 required/i);
});

test("explicit shared intent contributes only the strongest topic once", () => {
  const sharedWeak = topic(
    "shared-weak",
    500,
    [20, 25, 30, 35, 40, 45, 50, 55, 60, 65],
    "same-serp-fingerprint",
  );
  const sharedStrong = topic(
    "shared-strong",
    2_000,
    [20, 25, 30, 35, 40, 45, 50, 55, 60, 65],
    "same-serp-fingerprint",
  );
  const evaluation = evaluateExpectedClickPortfolio({
    topics: [sharedWeak, sharedStrong],
    tenantAuthority: authority(70),
    monthlyOrganicClickGoal: 1,
    now: NOW,
  });

  assert.equal(evaluation.decision, "accept");
  assert.deepEqual(evaluation.countedTopicIds, ["shared-strong"]);
  assert.deepEqual(evaluation.duplicateIntentTopicIds, ["shared-weak"]);
  assert.equal(
    evaluation.expectedClicksMonthly,
    evaluation.topics.find((item) => item.topicId === "shared-strong")!
      .expectedClicksMonthly,
  );
});

test("complete measured inventory below goal is rejected with an explicit deficit", () => {
  const evaluation = evaluateExpectedClickPortfolio({
    topics: [
      topic("one", 100, [30, 35, 40, 45, 50, 55, 60, 65, 70, 75]),
      topic("two", 100, [30, 35, 40, 45, 50, 55, 60, 65, 70, 75]),
    ],
    tenantAuthority: authority(30),
    monthlyOrganicClickGoal: 100,
    now: NOW,
  });

  assert.equal(evaluation.decision, "reject");
  assert.equal(evaluation.status, "below_goal");
  assert.equal(evaluation.supportsGoal, false);
  assert.ok(evaluation.clickDeficit! > 0);
  assert.match(evaluation.reasons[0], /replenish or revise/i);
});

test("unknown topic potential flags the inventory instead of falsely rejecting it", () => {
  const unknown = topic("unknown", 10_000, [20, 25, 30, 35, 40]);
  delete unknown.demand;
  const evaluation = evaluateExpectedClickPortfolio({
    topics: [
      topic("measured", 100, [30, 35, 40, 45, 50, 55, 60, 65, 70, 75]),
      unknown,
    ],
    tenantAuthority: authority(30),
    monthlyOrganicClickGoal: 100,
    now: NOW,
  });

  assert.equal(evaluation.decision, "flag");
  assert.equal(evaluation.status, "insufficient_evidence");
  assert.deepEqual(evaluation.insufficientEvidenceTopicIds, ["unknown"]);
});

test("a measured portfolio that clears the configured goal is accepted", () => {
  const evaluation = evaluateExpectedClickPortfolio({
    topics: [
      topic("one", 2_000, [20, 25, 30, 35, 40, 45, 50, 55, 60, 65]),
      topic("two", 2_000, [20, 25, 30, 35, 40, 45, 50, 55, 60, 65]),
    ],
    tenantAuthority: authority(70),
    monthlyOrganicClickGoal: 400,
    now: NOW,
  });

  assert.equal(evaluation.decision, "accept");
  assert.equal(evaluation.status, "supports_goal");
  assert.equal(evaluation.supportsGoal, true);
  assert.ok(evaluation.expectedClicksMonthly >= 400);
  assert.equal(evaluation.clickDeficit, 0);
});

test("legacy tenants without a goal are flagged and goal validation is bounded", () => {
  const evaluation = evaluateExpectedClickPortfolio({
    topics: [],
    tenantAuthority: authority(50),
    now: NOW,
  });
  assert.equal(evaluation.decision, "flag");
  assert.equal(evaluation.status, "goal_unconfigured");
  assert.equal(validateOrganicClickGoal(undefined), undefined);
  assert.equal(validateOrganicClickGoal(100), 100);
  assert.throws(() => validateOrganicClickGoal(0), /between 1 and 1,000,000/);
  assert.throws(() => validateOrganicClickGoal(1.5), /whole number/);
});
