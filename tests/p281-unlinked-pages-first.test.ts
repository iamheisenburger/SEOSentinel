// P281 (Nov 1 2026): 5 of pentra.dev's 38 live articles had no inbound link from another article (P193's merges removed
// theirs), and one of them, keyword-research-tracking-2, stayed "Discovered - currently not indexed". A new article's
// Related reading now lists such a page first among siblings about as related (like P251's click zone), counted from the
// live Markdown of the site's own pages the link step already reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectRelatedInternalLinks, unlinkedDestinations } from "../convex/lib/internalLinks.ts";

test("P281 the pages no other article links to are counted from the site's own pages", () => {
  const destinations = ["/blog/keyword-research-tracking-2", "/blog/saas-keyword-research", "/blog/keyword-research-for-lawyers-2"].map((href) => ({ href }));
  const pages = [
    { href: "/blog/saas-keyword-research", markdown: "## Related reading\n\n- [Lawyers](/blog/keyword-research-for-lawyers-2)\n- [Itself](/blog/saas-keyword-research)" },
    { href: "/blog/keyword-research-for-lawyers-2", markdown: "Body with [a link](/blog/saas-keyword-research) and [home](/)." },
  ];
  assert.deepEqual([...unlinkedDestinations(destinations, pages)], ["/blog/keyword-research-tracking-2"], "a page's link to itself does not count");
});

test("P281 among siblings about as related, the page no article links to comes first", () => {
  const destinations = [
    { href: "/blog/keyword-research-for-lawyers-2", title: "Keyword Research for Lawyers: A Practical Guide for Law Firms", summary: "", keywords: [] },
    { href: "/blog/keyword-research-tracking-2", title: "Keyword Research Tracking: A Practical Guide for Teams", summary: "", keywords: [] },
  ];
  const choose = (unlinked?: Set<string>) => selectRelatedInternalLinks({ currentTitle: "Keyword Research for Small Businesses: A Practical Guide",
    destinations, limit: 1, unlinked }).map((link) => link.href);
  assert.deepEqual(choose(), ["/blog/keyword-research-for-lawyers-2"], "about as related: the tie goes by address");
  assert.deepEqual(choose(new Set(["/blog/keyword-research-tracking-2"])), ["/blog/keyword-research-tracking-2"], "the unlinked page comes first");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /unlinked: unlinkedDestinations\(servedSiblings, linkingPages\),/, "the article pipeline counts and passes them");
});
