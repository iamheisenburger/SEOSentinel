import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const jobs = readFileSync(
  new URL("../convex/jobs.ts", import.meta.url),
  "utf8",
);

test("the durable quality queue admits the scheduler's one-shot versioned recovery", () => {
  const start = jobs.indexOf("export const queueQualityRetryIfAbsent");
  const end = jobs.indexOf("export const queuePlanIfAbsent", start);
  const queue = jobs.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(queue, /qualityRecoveryTargetVersion\([\s\S]*article/);
  assert.match(queue, /reason: "revision_limit"/);
  assert.match(queue, /hasAttemptedVersionedQualityRecovery/);
  assert.match(queue, /withIndex\("by_article_created"/);
  assert.match(queue, /q\.eq\("articleId", articleId\)/);
  assert.match(queue, /\.collect\(\)/);
  assert.doesNotMatch(queue, /withIndex\("by_site_type_created"/);
  assert.doesNotMatch(queue, /\.take\(\d+\)/);
  assert.match(queue, /qualityRecoveryAttemptVersion: version/);
  assert.match(queue, /qualityRecoveryVersion: versionedQualityRecoveryVersion/);
  assert.match(queue, /reason: "already_attempted"/);
});
