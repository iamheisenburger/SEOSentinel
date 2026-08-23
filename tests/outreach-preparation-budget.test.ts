import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OUTREACH_PREPARE_MAX_OPPORTUNITIES,
  OUTREACH_PREPARE_MAX_PUBLIC_FETCHES,
  OUTREACH_PREPARE_MAX_RUNTIME_MS,
  OUTREACH_PREPARE_SETTLEMENT_RESERVE_MS,
  createOutreachPreparationBudget,
  reserveOutreachPreparationFetch,
  summarizeOutreachPreparationBudget,
} from "../convex/lib/outreachPreparationBudget.ts";

test("one preparation run is capped at 25 opportunities, 30 fetches and 90 seconds", () => {
  assert.equal(OUTREACH_PREPARE_MAX_OPPORTUNITIES, 25);
  assert.equal(OUTREACH_PREPARE_MAX_PUBLIC_FETCHES, 30);
  assert.equal(OUTREACH_PREPARE_MAX_RUNTIME_MS, 90_000);

  const budget = createOutreachPreparationBudget({
    requestedLimit: 100,
    now: 1_000,
  });
  assert.equal(budget.opportunityLimit, 25);
  for (let index = 0; index < 30; index++) {
    assert.equal(
      reserveOutreachPreparationFetch(budget, 10_000, 1_000),
      10_000,
    );
  }
  assert.equal(reserveOutreachPreparationFetch(budget, 10_000, 1_000), null);
  assert.equal(budget.publicFetches, 30);
  assert.equal(budget.stopReason, "public_fetch_budget_exhausted");
});

test("the shared deadline reserves settlement time and reports unfinished work", () => {
  const budget = createOutreachPreparationBudget({
    requestedLimit: 25,
    now: 10_000,
  });
  const latestStart =
    10_000 + OUTREACH_PREPARE_MAX_RUNTIME_MS -
    OUTREACH_PREPARE_SETTLEMENT_RESERVE_MS;
  assert.equal(
    reserveOutreachPreparationFetch(budget, 10_000, latestStart),
    null,
  );
  const summary = summarizeOutreachPreparationBudget({
    budget,
    considered: 4,
    offered: 25,
    hasMore: true,
    unsettledCurrent: true,
    now: latestStart,
  });
  assert.equal(summary.partial, true);
  assert.equal(summary.stopReason, "runtime_budget_exhausted");
  assert.equal(summary.deferredAtLeast, 23);
  assert.equal(summary.publicFetches, 0);
  assert.equal(summary.runtimeLimitMs, 90_000);
});

test("opportunity truncation is surfaced instead of reported as a complete run", () => {
  const budget = createOutreachPreparationBudget({
    requestedLimit: 25,
    now: 0,
  });
  const summary = summarizeOutreachPreparationBudget({
    budget,
    considered: 25,
    offered: 25,
    hasMore: true,
    now: 1_000,
  });
  assert.deepEqual(
    {
      partial: summary.partial,
      stopReason: summary.stopReason,
      deferredAtLeast: summary.deferredAtLeast,
    },
    {
      partial: true,
      stopReason: "opportunity_limit_reached",
      deferredAtLeast: 1,
    },
  );
});

test("target verification and contact discovery consume the same action budget", () => {
  const source = readFileSync("convex/actions/outreach.ts", "utf8");
  assert.match(source, /limit: budget\.opportunityLimit \+ 1/);
  assert.match(source, /opportunityRows\.slice\(0, budget\.opportunityLimit\)/);
  assert.match(source, /fetchLiveAuthorityTarget\([\s\S]*timeoutMs/);
  assert.match(source, /safeFetchPublicText\(url,[\s\S]*timeoutMs/);
  assert.ok(
    source.match(/runPublicFetchWithinBudget\(\{/g)?.length === 2,
    "both public-fetch call sites must share one budget",
  );
  assert.doesNotMatch(source, /Math\.min\(limit \?\? 25, 100\)/);
});
