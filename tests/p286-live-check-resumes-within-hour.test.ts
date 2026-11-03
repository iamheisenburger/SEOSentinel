// P286 (Nov 3 2026): pentra.dev and leadpilot.chat answered HTTP 402 for a day while their hosting account was disabled.
// Each site's delivered article was next checked 12 to 23 hours later (P285's schedule kept the quick checks' 12 and
// 24 hour gaps), so a restore would have left both schedules stopped most of a day. And a check that ran out stayed failed
// for good: a customer who fixed their build was told to check their connection, and Autopilot never resumed. An
// unreachable page is now checked hourly, and the scheduler checks a waiting or failed page itself at most hourly,
// recording only success: the retries, attempts and the failure on record stay as they were.
// The end-to-end runs are in core-pipeline-integration.test.ts ("P286 ...").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS, PUBLIC_URL_PROBE_AFTER_FAILURE_MS, PUBLIC_URL_PROBE_INTERVAL_MS } from "../convex/lib/publicUrlRetry.ts";

const hour = 3_600_000;

test("P286 an unreachable page is never left more than an hour without a check during the week", () => {
  assert.ok(Math.max(...PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS) <= hour);
  assert.ok(PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) >= 7 * 24 * hour);
  assert.equal(PUBLIC_URL_PROBE_INTERVAL_MS, hour);
  assert.equal(PUBLIC_URL_PROBE_AFTER_FAILURE_MS, 30 * 24 * hour);
});

test("P286 the scheduler's extra check records only success and starts no retries", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const verify = publisher.slice(publisher.indexOf("export const verifyPublicPublicationInternal"), publisher.indexOf("export const publishArticleInternal"));
  const probeExit = verify.indexOf("if (args.probe) return");
  assert.ok(probeExit > 0, "a failed extra check returns at once");
  assert.ok(probeExit < verify.indexOf("ctx.scheduler.runAfter(") && probeExit < verify.lastIndexOf("internal.articles.recordPublicPublicationCheck"),
    "before any retry is scheduled or any failure recorded");
  const work = readFileSync("convex/contentWork.ts", "utf8");
  const advance = work.slice(work.indexOf("export const advance = internalMutation"), work.indexOf("const failed = waiting.find(j => j.contentWork!.stage === \"review_failed\")"));
  assert.match(advance, /expectedContentHash: article\.publishedContentHash, attempt: article\.publicUrlCheckAttempts \?\? 0, probe: true \}\)/);
  assert.match(advance, /now - Math\.max\(lastCheck, cw\.liveProbeAt \?\? 0\) >= PUBLIC_URL_PROBE_INTERVAL_MS/, "at most hourly");
  assert.match(advance, /article\.publicUrlStatus === "failed" && now - lastCheck < PUBLIC_URL_PROBE_AFTER_FAILURE_MS/, "a failed check for 30 days");
  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /status === "verified" && article\.publicUrlStatus === "failed" \? \{ publicUrlEarlierFailure: \{ error: article\.publicUrlCheckError,/,
    "a failure verified later stays on record");
});
