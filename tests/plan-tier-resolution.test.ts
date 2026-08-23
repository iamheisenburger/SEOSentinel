import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_PLANS,
  FREE_LIMITS,
  getLimitsFromFeatures,
  resolvePlanFromFeatures,
} from "../convex/planLimits.ts";

const exactFeatures = [
  ["max_sites_1", "max_articles_3"],
  ["max_sites_1", "max_articles_10"],
  ["max_sites_3", "max_articles_25"],
  ["max_sites_10", "max_articles_60"],
  ["max_sites_unlimited", "max_articles_150"],
] as const;

test("exact Clerk bundles resolve to the five public tiers", () => {
  for (const [index, features] of exactFeatures.entries()) {
    assert.deepEqual(resolvePlanFromFeatures(features), CANONICAL_PLANS[index]);
    assert.deepEqual(getLimitsFromFeatures(features), {
      maxSites: CANONICAL_PLANS[index].maxSites,
      maxArticles: CANONICAL_PLANS[index].maxArticles,
    });
  }
});

test("cumulative lower Clerk flags resolve to the highest complete tier", () => {
  assert.deepEqual(
    resolvePlanFromFeatures([
      "max_sites_1",
      "max_articles_3",
      "max_articles_10",
    ]),
    CANONICAL_PLANS[1],
  );
  assert.deepEqual(
    resolvePlanFromFeatures([
      "max_sites_1",
      "max_sites_3",
      "max_sites_10",
      "max_articles_3",
      "max_articles_10",
      "max_articles_25",
      "max_articles_60",
    ]),
    CANONICAL_PLANS[3],
  );
  assert.deepEqual(
    resolvePlanFromFeatures([
      "max_sites_1",
      "max_sites_3",
      "max_sites_10",
      "max_sites_unlimited",
      "max_articles_3",
      "max_articles_10",
      "max_articles_25",
      "max_articles_60",
      "max_articles_150",
    ]),
    CANONICAL_PLANS[4],
  );
});

test("mismatched volume signals fail down instead of creating hybrid limits", () => {
  const cases = [
    {
      features: ["max_sites_1", "max_articles_25"],
      expected: CANONICAL_PLANS[1],
    },
    {
      features: ["max_sites_3", "max_articles_10"],
      expected: CANONICAL_PLANS[1],
    },
    {
      features: ["max_sites_10", "max_articles_25"],
      expected: CANONICAL_PLANS[2],
    },
    {
      features: ["max_sites_unlimited", "max_articles_60"],
      expected: CANONICAL_PLANS[3],
    },
    {
      features: ["max_sites_3", "max_articles_150"],
      expected: CANONICAL_PLANS[2],
    },
  ] as const;

  for (const { features, expected } of cases) {
    assert.deepEqual(resolvePlanFromFeatures(features), expected);
    assert.ok(
      CANONICAL_PLANS.some((plan) =>
        plan.maxSites === expected.maxSites &&
        plan.maxArticles === expected.maxArticles
      ),
    );
  }
});

test("missing, unknown, duplicate, and authority aliases cannot overgrant", () => {
  assert.deepEqual(getLimitsFromFeatures([]), FREE_LIMITS);
  assert.deepEqual(
    getLimitsFromFeatures([
      "seo_authority_discovery",
      "authority_discovery",
      "max_articles_999",
      "max_sites_999",
      "unrelated_feature",
      "__proto__",
      "constructor",
      "toString",
    ]),
    FREE_LIMITS,
  );
  assert.deepEqual(
    resolvePlanFromFeatures([
      "max_sites_3",
      "max_sites_3",
      "max_articles_25",
      "max_articles_25",
      "seo_authority_discovery",
    ]),
    CANONICAL_PLANS[2],
  );
});

test("one-site defaults preserve Starter but incomplete higher tiers fail down", () => {
  assert.deepEqual(
    resolvePlanFromFeatures(["max_articles_10"]),
    CANONICAL_PLANS[1],
  );
  assert.deepEqual(
    resolvePlanFromFeatures(["max_articles_150"]),
    CANONICAL_PLANS[1],
  );
  assert.deepEqual(
    resolvePlanFromFeatures(["max_sites_10"]),
    CANONICAL_PLANS[0],
  );
});
