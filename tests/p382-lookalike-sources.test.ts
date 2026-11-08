// P382 (Nov 8 2026), watchdog: pentra.dev's draft "How often should a small business publish blog posts" was held as
// "two cited sources share a brand-like name ("searchenginejournal" / "searchenginewatch") — one is likely a lookalike
// store". Both are real publications. The P335 check flagged any two cited names sharing their first five letters, and
// that day the slot had nothing else to publish. Now only an objective lookalike blocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTENT_CHECKS_VERSION, lookalikeSourcePair, readerVisibleIssues } from "../convex/lib/articleQuality.ts";

const lookalike = (urls: string[]) => readerVisibleIssues({
  markdown: "Publishing steadily helps [1]. Fresh pages get crawled [2].\n\n## Sources\n\n1. [One](" + urls[0] + ")\n2. [Two](" + urls[1] + ")",
  sources: urls.map((url, i) => ({ url, title: `Source ${i + 1}` })),
}).filter((issue) => /lookalike/.test(issue));

test("two real publications that share their first letters are not lookalikes", () => {
  assert.deepEqual(lookalike(["https://www.searchenginejournal.com/blogging-frequency/", "https://www.searchenginewatch.com/2024/blog-posts/"]), []);
  for (const pair of [["marketingcharts", "marketingprofs"], ["salesforce", "salesloft"], ["contentmarketinginstitute", "contently"], ["hubspot", "hubstaff"]]) {
    assert.equal(lookalikeSourcePair(pair), null, pair.join(" / "));
  }
  assert.equal(lookalikeSourcePair(["searchenginejournal", "searchenginejournal"]), null, "two pages of one site");
  assert.equal(lookalikeSourcePair(["appendix0", "appendix1", "appendix2"]), null, "numbered siblings");
});

test("a name one or two letters off, or the brand plus a shop word, is still held", () => {
  assert.equal(lookalike(["https://lodgecastiron.com/a", "https://lodgecastlron.com/b"]).length, 1);
  assert.deepEqual(lookalikeSourcePair(["lodgecastiron", "lodgecastironshop"]), ["lodgecastironshop", "lodgecastiron"]);
  assert.deepEqual(lookalikeSourcePair(["officiallodgecastiron", "lodgecastiron"]), ["officiallodgecastiron", "lodgecastiron"]);
  assert.deepEqual(lookalikeSourcePair(["nerdwallet", "nerdwalet"]), ["nerdwallet", "nerdwalet"]);
  assert.equal(lookalikeSourcePair(["zapier", "zapper"])?.length, 2, "short names: one letter apart");
  assert.equal(lookalikeSourcePair(["forbes", "fortune"]), null, "short names: two letters apart are different sites");
});

test("drafts held under the old rule are judged again", () => {
  assert.ok(CONTENT_CHECKS_VERSION >= 6);
});
