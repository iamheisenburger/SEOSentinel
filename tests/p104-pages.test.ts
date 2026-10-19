import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// P104 (Oct 19 2026): pentra.dev/improving-pages-close-to-page-one showed two
// Sources sections, the body's own and the list the blog page appended.

test("the page appends a Sources list only when the body has none", async () => {
  const { markdownHasSourcesSection } = await import("../convex/lib/sourcesHeading.ts");
  assert.equal(markdownHasSourcesSection("Intro.\n\n## Sources\n\n- [1] One https://a.example\n"), true);
  assert.equal(markdownHasSourcesSection("Intro.\n\n### References:\n\n1. One\n"), true);
  assert.equal(markdownHasSourcesSection("Intro.\n\n## What the sources say\n\nText.\n"), false);
  assert.equal(markdownHasSourcesSection("```md\n## Sources\n```\n\nText.\n"), false, "a heading inside a code example is not a section");
  assert.equal(markdownHasSourcesSection("Intro only."), false);
});

test("a related-reading link naming the product is navigation, not a product claim", async () => {
  const { productNumberMismatches, readerVisibleIssues } = await import("../convex/lib/articleQuality.ts");
  const profile = "Name: Pentra\n\nDomain: pentra.dev\n\nPricing: Starter costs $49 a month for 10 articles.";
  const hash = createHash("sha256").update(profile).digest("hex");
  const related = "Body text.\n\n## Related reading\n\n- [7 ways Pentra finds pages near page one](/blog/near-page-one)\n- [Pentra pricing](/pricing)\n";
  assert.deepEqual(productNumberMismatches(related, profile, hash), []);
  assert.deepEqual(readerVisibleIssues({ markdown: related, sources: [], productEvidenceSnapshot: profile, productEvidenceHash: hash }), []);
  // A sentence that states the number is still a claim, in a list or not.
  assert.equal(productNumberMismatches("- Pentra checks 7 signals on every page, see [the guide](/blog/guide).", profile, hash).length, 1);
});
