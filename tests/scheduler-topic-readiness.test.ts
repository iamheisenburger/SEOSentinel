import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  schedulerReadyTopic,
} from "../convex/lib/schedulerTopicReadiness.ts";

const baseTopic = {
  _id: "topic-1",
  status: "planned",
  primaryKeyword: "lead qualification software",
  searchVolume: 500,
  keywordDifficulty: 18,
  keywordDifficultyMeasured: true,
  serpIntent: "commercial",
  serpTopUrls: [
    "https://one.example/a",
    "https://two.example/b",
    "https://three.example/c",
    "https://four.example/d",
    "https://five.example/e",
  ],
};

function ready(overrides: Partial<typeof baseTopic> = {}) {
  return schedulerReadyTopic({
    topic: { ...baseTopic, ...overrides },
    businessFitEligible: true,
    serpBusinessIntentAligned: true,
    expectedClickStatus: "eligible",
    serpAttainable: true,
  });
}

test("the shared scheduler predicate accepts only exact live evidence inventory", () => {
  assert.equal(ready(), true);
  assert.equal(ready({ keywordDifficultyMeasured: false }), false);
  assert.equal(ready({ serpIntent: "" }), false);
  assert.equal(ready({ serpTopUrls: baseTopic.serpTopUrls.slice(0, 4) }), false);
  assert.equal(
    schedulerReadyTopic({
      topic: baseTopic,
      businessFitEligible: true,
      serpBusinessIntentAligned: true,
      expectedClickStatus: "awaiting_live_demand",
      serpAttainable: true,
    }),
    false,
  );
});

test("workflow residue can never make setup or runtime topic-ready", () => {
  for (const status of [
    "plan_checkpoint",
    "used",
    "queued",
    "cannibalizing",
    "disqualified",
  ]) {
    assert.equal(ready({ status }), false, `${status} must not be inventory`);
  }
  assert.equal(ready({ status: "future_workflow_state" }), false);
  assert.equal(
    schedulerReadyTopic({
      topic: {
        ...baseTopic,
        planCheckpointTerminalFailureCode: "semantic_zero_yield",
      },
      businessFitEligible: true,
      serpBusinessIntentAligned: true,
      expectedClickStatus: "eligible",
      serpAttainable: true,
    }),
    false,
  );
});

test("setup readiness and automatic runtime consume the same projection", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");

  assert.match(sites, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(
    sites,
    /schedulerReadiness\?\.schedulerReadyTopicIds\.length \?\? 0\) > 0/,
  );
  assert.doesNotMatch(
    sites.slice(
      sites.indexOf("export const getOneSetupReadiness"),
      sites.indexOf("export const setOneSetupCapabilityProgressInternal"),
    ),
    /status", "planned"\)[\s\S]*\.first\(\)/,
  );
  assert.match(topics, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(jobs, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(scheduler, /inventoryAudit\.schedulerReadyTopicIds/);
  assert.match(
    scheduler,
    /schedulerReadyTopicIds\.has\(String\(topic\._id\)\)/,
  );
});
