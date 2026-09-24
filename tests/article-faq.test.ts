import assert from "node:assert/strict";
import test from "node:test";
import { articleFaq } from "../src/lib/article-faq.ts";

test("FAQ structured data comes only from the article's FAQ section, as plain text", () => {
  const markdown = [
    "Intro", "", "## What it is", "", "### Is this a question?", "Not an FAQ entry.", "",
    "## Frequently asked questions", "", "### How long does a crawl take?", "", "It depends on the number of pages [1].", "",
    "**Can I pause it?** Yes, any time from the [dashboard](/dashboard).", "", "### Unanswered?", "",
    "## Sources", "", "- [Google](https://developers.google.com)",
  ].join("\n");
  assert.deepEqual(articleFaq(markdown), [
    { question: "How long does a crawl take?", answer: "It depends on the number of pages." },
    { question: "Can I pause it?", answer: "Yes, any time from the dashboard." },
  ]);
  assert.deepEqual(articleFaq("## Setup\n\n### Why?\nBecause."), []);
});
