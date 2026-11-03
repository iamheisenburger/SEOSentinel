// P288 (Nov 3 2026): Cowork's batch 3 found research doing its job and the plan throwing it away. The how-to read
// QuickBooks, NetSuite, Experian, CFI and FreshBooks guides and the Austin article read local trade and permit pages, but
// all count as "blogs" and at most 2 were kept: 2 sources each, under Cowork's bar of 3. And the claims check (batch 2's
// wrong facts) was skipped on the list and the tutorial: it kept a flat $0.20 free for the fix on top of its own price,
// so at $0.26 spent it never ran, though both articles really cost $0.29 of the $0.50 cap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_STRONG_SOURCES, rankedResearchSources, type SourceRole } from "../convex/lib/researchPasses.ts";

test("P288 with no owner or publication page, up to 4 guides are kept as context", () => {
  const blogs = ["quickbooks.intuit.com/r", "netsuite.com/a", "experian.com/b", "corporatefinanceinstitute.com/c", "freshbooks.com/d", "numeric.io/e"]
    .map((host) => `https://${host}`);
  const roles = new Map<string, SourceRole>(blogs.map((url) => [url, "blog"]));
  const ranked = rankedResearchSources(blogs.map((url) => ({ url })), roles, 6);
  assert.equal(MIN_STRONG_SOURCES, 4);
  assert.deepEqual(ranked.kept.map((s) => s.url), blogs.slice(0, 4), "in research order");
  assert.deepEqual(ranked.counts, { owner: 0, publication: 0, context: 4, dropped: 2 });
  const withOwner = new Map(roles); withOwner.set("https://www.irs.gov/x", "owner");
  const mixed = rankedResearchSources([{ url: "https://www.irs.gov/x" }, ...blogs.map((url) => ({ url }))], withOwner, 6);
  assert.equal(mixed.counts.context, 3, "4 sources in all");
});

test("P288 the claims check runs whenever its own price fits under the cap", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  const cap = work.slice(work.indexOf("const optional = ARTICLE_OPTIONAL_STEP.test(args.key);"), work.indexOf("const retainedRunCreditHold"));
  assert.match(cap, /if \(spent >= cap \|\| \(optional && spent \+ args\.ceilingMicroUsd > cap\)\) \{/);
  assert.doesNotMatch(cap, /reserve/);
});
