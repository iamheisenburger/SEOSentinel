import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("customer growth status uses the scheduler's evidence-bound readiness", () => {
  const source = readFileSync("convex/growthLoop.ts", "utf8");
  assert.match(source, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(source, /schedulerReadyTopicIds\.length/);
  assert.match(source, /planning_snapshot_read_limit/);
  assert.doesNotMatch(
    source,
    /topics\.some\(\(topic\) => topic\.status === "planned"\)/,
  );
});
