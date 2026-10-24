// P173 (Oct 24 2026): a pentra.dev draft linked "Best Free SEO Tools for Small Teams (No Budget Required)" as "Best
// Free SEO Tools for Small Teams No": the anchor builder stripped the bracket from "(No" and cut the title there.
import test from "node:test";
import assert from "node:assert/strict";
import { preferredInternalLinkAnchorCandidates } from "../convex/lib/internalLinks.ts";

test("link text never cuts into a bracketed aside, and the title without the aside comes first", () => {
  const cases: Array<[string, string, string[]]> = [
    ["Best Free SEO Tools for Small Teams (No Budget Required)", "Best Free SEO Tools for Small Teams", ["No", "Budget", "Required"]],
    ["Lead Scoring Template (Free Download): How to Score Leads", "Lead Scoring Template", ["Free", "Download"]],
    ["How to Qualify Leads [2026 Guide] for B2B Teams", "How to Qualify Leads for B2B Teams", ["2026", "Guide"]],
  ];
  for (const [title, first, aside] of cases) {
    const anchors = preferredInternalLinkAnchorCandidates(title);
    assert.equal(anchors[0], first, title);
    for (const anchor of anchors) {
      const words = anchor.split(" ");
      assert.ok(!aside.some(word => words.includes(word)), `${title} -> "${anchor}" holds a word from inside the brackets`);
      assert.doesNotMatch(anchor, /[()[\]{}]/);
    }
  }
  // Titles without an aside keep their anchors.
  assert.equal(preferredInternalLinkAnchorCandidates("AI Article Writer for SEO")[0], "AI Article Writer for SEO");
});
