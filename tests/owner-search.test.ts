import assert from "node:assert/strict";
import test from "node:test";
import { ownerSearchArticleType, ownerSearchKeyword } from "../convex/lib/ownerSearch.ts";

// C4 (P158, Oct 22 2026): owners add searches they want a page for.
test("an owner's search is kept as people type it, and anything that isn't a search is refused", () => {
  assert.equal(ownerSearchKeyword("  SEObot   Alternatives? "), "seobot alternatives");
  assert.equal(ownerSearchKeyword("“best ai blog writer”"), "best ai blog writer");
  assert.equal(ownerSearchKeyword("seobot vs. outrank"), "seobot vs. outrank");
  assert.equal(ownerSearchKeyword("café menu ideas"), "café menu ideas");
  assert.equal(ownerSearchKeyword("seo"), null, "one word is too broad to write for");
  assert.equal(ownerSearchKeyword("one two three four five six seven eight nine"), null);
  assert.equal(ownerSearchKeyword("https://example.com/page"), null);
  assert.equal(ownerSearchKeyword("www.example.com pricing"), null);
  assert.equal(ownerSearchKeyword("<script> alert"), null);
  assert.equal(ownerSearchKeyword("a".repeat(81) + " b"), null);
});

test("the article type follows what the search asks for", () => {
  assert.deepEqual(ownerSearchArticleType("seobot alternatives"), { articleType: "comparison", intent: "commercial" });
  assert.deepEqual(ownerSearchArticleType("seobot vs outrank"), { articleType: "comparison", intent: "commercial" });
  assert.deepEqual(ownerSearchArticleType("compare ai blog writers"), { articleType: "comparison", intent: "commercial" });
  assert.deepEqual(ownerSearchArticleType("best ai blog writer"), { articleType: "listicle", intent: "commercial" });
  assert.deepEqual(ownerSearchArticleType("10 best seo tools"), { articleType: "listicle", intent: "commercial" });
  assert.deepEqual(ownerSearchArticleType("how to publish blog posts automatically"), { articleType: "how-to", intent: "informational" });
  assert.deepEqual(ownerSearchArticleType("seo launch checklist"), { articleType: "checklist", intent: "informational" });
  assert.deepEqual(ownerSearchArticleType("automated blog writing"), { intent: "informational" });
  assert.deepEqual(ownerSearchArticleType("best practices for seo"), { intent: "informational" }, "best practices are not a list of products");
  assert.deepEqual(ownerSearchArticleType("top of funnel content ideas"), { intent: "informational" });
});
