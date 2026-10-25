// P181 (Oct 25 2026): pentra.dev's draft "Auto SEO Reviews" was held as "7 cited sentence(s) state a number their
// source does not contain", yet none of the seven stated a number: the check unwrapped each linked citation marker
// "([3](https://...))" into "3" and looked for 3 in the cited source's excerpt. The marker is a reference, not a claim.
import test from "node:test";
import assert from "node:assert/strict";
import { citedNumberMismatches, readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";

const source = (url: string, excerpt: string) => ({ url, title: "Guidance", excerpt, contentHash: sha256Hex(excerpt) });
const sources = [
  source("https://developers.google.com/search/docs/essentials/spam-policies", "Using automation to generate content with the primary purpose of manipulating ranking in search results is a violation of our spam policies."),
  source("https://developers.google.com/search/docs/fundamentals/creating-helpful-content", "Our systems reward original, high-quality content, however it is produced."),
  source("https://developers.google.com/search/blog/reviews-update", "Reviews are one of many factors used to rank content. In 2022 we described what high-quality reviews include."),
];

test("a citation marker linked to its source is not a number the sentence states", () => {
  for (const marker of ["([3](https://developers.google.com/search/blog/reviews-update))", "[3](https://developers.google.com/search/blog/reviews-update)",
    "([1](https://developers.google.com/search/docs/essentials/spam-policies), [2](https://developers.google.com/search/docs/fundamentals/creating-helpful-content))"]) {
    const sentence = `Google says review content is only one of many factors used in ranking content ${marker}.`;
    assert.deepEqual(citedNumberMismatches(sentence, sources), [], marker);
  }
  const markdown = "## Why reviews matter\n\nGoogle says review content is only one of many factors used in ranking content ([3](https://developers.google.com/search/blog/reviews-update)).";
  assert.ok(!readerVisibleIssues({ markdown, sources }).some(issue => /state a number/.test(issue)));
});

test("a number the cited source does not contain still blocks, whatever the marker's form", () => {
  assert.equal(citedNumberMismatches("Google says 40% of reviews are ranked by length ([3](https://developers.google.com/search/blog/reviews-update)).", sources).length, 1);
  assert.equal(citedNumberMismatches("Google says 40% of reviews are ranked by length [3].", sources).length, 1);
  assert.deepEqual(citedNumberMismatches("In 2022 Google described what high-quality reviews include ([3](https://developers.google.com/search/blog/reviews-update)).", sources), [],
    "a number the source states passes");
});
