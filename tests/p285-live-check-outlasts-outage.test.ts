// P285 (Nov 3 2026): pentra.dev and leadpilot.chat answered HTTP 402 for 18+ hours when their hosting account was disabled.
// A delivered article's exact live check gave up after about 41 hours, and the site's content work then stayed fail-closed
// ("public_url_failed") with nothing to check it again, so a long outage would have stopped Autopilot for good. When the page
// cannot be fetched at all, the check now keeps going every 6 hours for a week; a page that loads but shows the wrong
// article still fails on the quick schedule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS, PUBLIC_URL_RETRY_DELAYS_MS } from "../convex/lib/publicUrlRetry.ts";

const hour = 3_600_000;
const span = (delays: readonly number[]) => delays.reduce((sum, delay) => sum + delay, 0);

test("P285 an unreachable page is checked again every 6 hours for a week; a wrong page still fails in about 41 hours", () => {
  assert.deepEqual(PUBLIC_URL_RETRY_DELAYS_MS, [30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, hour, 3 * hour, 12 * hour, 24 * hour],
    "the quick schedule is unchanged");
  assert.ok(span(PUBLIC_URL_RETRY_DELAYS_MS) < 42 * hour);
  assert.deepEqual(PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS.slice(0, 9), [...PUBLIC_URL_RETRY_DELAYS_MS], "an outage starts with the same quick checks");
  assert.ok(span(PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS) >= 7 * 24 * hour, `checked for a week (${(span(PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS) / hour).toFixed(0)} h)`);
  assert.ok(PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS.slice(9).every((delay) => delay === 6 * hour));
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /\}\)\.catch\(\(error: unknown\) => \{ unreachable = true; throw error; \}\);\n      verifyLivePublicationPage\(\{/,
    "only a failed fetch (an error status, a timeout) counts as unreachable");
  assert.match(publisher, /const nextDelay = \(unreachable \? PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS : PUBLIC_URL_RETRY_DELAYS_MS\)\[args\.attempt\];/);
});
