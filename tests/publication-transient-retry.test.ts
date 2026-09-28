import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PUBLICATION_ATTEMPTS, MAX_TRANSIENT_PUBLICATION_ATTEMPTS, nextPublicationRetry, transientPublicationError } from "../convex/lib/publicationLease.ts";

test("a destination outage before any write is retried for about a day; failed writes keep three attempts", () => {
  assert.equal(transientPublicationError("Failed to read sealed GitHub branch:  (HTTP 503)"), true);
  assert.equal(transientPublicationError("GitHub repo unavailable: o/r (HTTP 502)"), true);
  assert.equal(transientPublicationError("WordPress idempotency lookup failed (503)"), true);
  assert.equal(transientPublicationError("WordPress API error (500): upstream"), false, "a failed write keeps three attempts");
  assert.equal(transientPublicationError("Failed to update branch:  (HTTP 503)"), false, "a failed write keeps three attempts");
  assert.equal(transientPublicationError("TypeError: fetch failed"), false, "a network error may have been a write");
  assert.equal(transientPublicationError("GitHub repo not found: o/r (HTTP 404)"), false);
  assert.equal(transientPublicationError("Failed to commit content/blog/x.md:  (HTTP 409) — conflict"), false);
  let delay = 0, attempts = 0;
  for (let previous = 0; ; previous++) {
    const next = nextPublicationRetry(previous, true); attempts = next.attempts;
    if (!next.willRetry) break;
    delay += next.retryDelayMs;
  }
  assert.equal(attempts, MAX_TRANSIENT_PUBLICATION_ATTEMPTS);
  assert.ok(delay >= 18 * 3_600_000 && delay <= 24 * 3_600_000, `${delay / 3_600_000}h of retries`);
  assert.equal(nextPublicationRetry(MAX_PUBLICATION_ATTEMPTS - 1, false).willRetry, false);
  assert.deepEqual(nextPublicationRetry(0, false), nextPublicationRetry(0, true), "the first attempts are unchanged");
});
