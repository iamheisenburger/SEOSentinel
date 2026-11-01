// P276 (Nov 1 2026): P273 (a list's option count no longer blocks) and P275 (a Sources entry's title is not a claim)
// corrected blocking checks, and pentra.dev's Nov 1 and Nov 2 drafts failed on exactly those. Failures judged by checks
// since corrected are no failing streak and cause no backoff (P181); the version records that the checks changed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTENT_CHECKS_VERSION } from "../convex/lib/articleQuality.ts";

test("P276 failures judged before P273 and P275 corrected the checks are no failing streak", () => {
  assert.equal(CONTENT_CHECKS_VERSION, 2);
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /return job\.contentWork!\.failure === "bounded_content_quality_exhausted" && \(job\.contentWork!\.checksVersion \?\? 0\) < CONTENT_CHECKS_VERSION;/,
    "a failure recorded under version 1 reads as outdated");
  assert.match(work, /checksVersion: CONTENT_CHECKS_VERSION \}, updatedAt: Date\.now\(\) \}\);/, "new failures record today's version");
});
