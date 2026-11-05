// P278 (Nov 1 2026): pentra.dev's /seo-optimization-automation, reused by P277, was sealed with a Related reading of two
// homepage sections, "[SEO automation](/#features)" and "[How It](/#pipeline)". Its best matches were articles merged
// away (P193): they filled the top 3, the check after the choice dropped them, and the list fell back to the crawl's
// homepage anchors. Siblings now come from served pages, and a section of a page is never a destination.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectRelatedInternalLinks } from "../convex/lib/internalLinks.ts";
import { servedDestinations } from "../convex/lib/pentraConsolidation.ts";

test("P278 siblings come from pages served on their own URL, so merged articles cannot crowd them out", () => {
  // The three best matches for "seo optimization automation" on pentra.dev were merged away (P193).
  const merged = ["automate-seo-article-writing-at-scale", "automate-seo-content-creation-without-writers", "automate-keyword-research-seo"]
    .map((slug) => ({ href: `/blog/${slug}`, title: `Automate SEO ${slug.replace(/-/g, " ")}`, summary: "", keywords: ["seo automation"] }));
  const served = { href: "/blog/will-seo-be-automated", title: "Will SEO Be Automated? What Can (and Can't) Run Without a Human Today", summary: "", keywords: [] };
  assert.deepEqual(servedDestinations("pentra.dev", merged), []);
  const choose = (destinations: typeof merged) => selectRelatedInternalLinks({ currentTitle: "SEO Optimization Automation: What to Automate, What to Keep Manual",
    currentKeywords: ["seo optimization automation"], destinations, limit: 3 }).map((link) => link.href);
  assert.ok(!choose([...merged, served]).includes(served.href), "chosen from every article, the merged ones fill the list");
  assert.deepEqual(choose(servedDestinations("pentra.dev", [...merged, served])), [served.href], "chosen from served pages, the live one is listed");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /const servedSiblings = servedDestinations\(site\.domain, relatedArticles, merged\);/);
  assert.match(pipeline, /destinations: servedSiblings,\n    limit: 3,\n    clickZone,/);
  assert.match(pipeline, /pages\.filter\(\(page: \{ slug: string \}\) => !page\.slug\.includes\("#"\)\);/, "a section of a page is not reading");
});
