// P275 (Nov 1 2026): pentra.dev's first November draft (/best-ai-content-writing-tools) was held as a reader-visible defect
// for its own Sources entry: «- [1] [ChatGPT Plans and Pricing (2026): $0 to $500 a Month](…)», whose title's numbers its
// excerpt does not contain. A bibliography is never a claim; a cited sentence in the body still needs its number sourced.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readerVisibleIssues } from "../convex/lib/articleQuality.ts";

const excerpt = "ChatGPT Plus costs $20 per month.";
const sources = [{ url: "https://gravity.fast/blog/chatgpt-pricing-explained/", title: "ChatGPT Plans and Pricing (2026): $0 to $500 a Month",
  excerpt, contentHash: createHash("sha256").update(excerpt).digest("hex") }];
const cited = (markdown: string) => readerVisibleIssues({ markdown, sources } as never).filter((issue) => /cited sentence\(s\) state a number/.test(issue));

test("P275 a Sources entry's title is not a cited claim, in any list form", () => {
  for (const entry of ["- [1] [ChatGPT Plans and Pricing (2026): $0 to $500 a Month](https://gravity.fast/blog/chatgpt-pricing-explained/)",
    "1. [ChatGPT Plans and Pricing (2026): $0 to $500 a Month](https://gravity.fast/blog/chatgpt-pricing-explained/)",
    "[1] ChatGPT Plans and Pricing (2026): $0 to $500 a Month, https://gravity.fast/blog/chatgpt-pricing-explained/"]) {
    const markdown = `Intro.\n\n## Prices\n\nChatGPT Plus costs $20 per month [1].\n\n## Sources\n\n${entry}\n`;
    assert.deepEqual(cited(markdown), [], entry);
  }
});

test("P275 a body sentence citing a number its source lacks still blocks", () => {
  const markdown = "Intro.\n\n## Prices\n\nChatGPT Plus costs $25 per month [1].\n\n## Sources\n\n- [1] [ChatGPT pricing](https://gravity.fast/blog/chatgpt-pricing-explained/)\n";
  assert.equal(cited(markdown).length, 1);
});
