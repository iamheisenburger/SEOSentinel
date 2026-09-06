import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { markdownCitationMarkers, removeUnverifiedMarkdownCitations as clean } from "../convex/lib/markdownCitations.ts";
import { inlineCitationNumbers, validateClaimEvidenceLedger } from "../convex/lib/articleQuality.ts";

test("Markdown citation helpers work in a bundled server runtime", () => {
  const code = buildSync({ entryPoints: ["convex/lib/markdownCitations.ts"], bundle: true,
    platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const runtime = { exports: {} as { removeUnverifiedMarkdownCitations: typeof clean; markdownCitationMarkers: typeof markdownCitationMarkers } };
  runInNewContext(code, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url) });
  assert.equal(runtime.exports.removeUnverifiedMarkdownCitations("Fact [9]. Keep `a[9]`.", 0), "Fact. Keep `a[9]`.");
  assert.deepEqual(structuredClone(runtime.exports.markdownCitationMarkers("Fact [1]. Keep `a[9]`.")), [{ start: 5, end: 8, numbers: [1] }]);
});

test("citation pruning preserves code, indentation, hard breaks and non-citation links exactly", () => {
  const markdown = [
    "## Example",
    "Ordinary  double spacing stays.  \nA hard break stays too.",
    "- Parent\n  - Nested item\n    continuation",
    "```js\nconst result = values[9];\n  console.log(result);\n```",
    "    const indented = values[8];",
    "Use `values[7]` or the literal \\[6] in your example.",
    "[Documentation](https://example.invalid/docs) ![diagram [5]](https://example.invalid/img.png)",
    "[Named documentation][docs]\n\n[docs]: https://example.invalid/docs",
  ].join("\n\n");
  assert.equal(clean(markdown, 0), markdown);
  assert.deepEqual(inlineCitationNumbers(markdown), []);
});

test("citation validation cannot use literal code as evidence or count unused metadata", () => {
  assert.deepEqual(inlineCitationNumbers("Fact [1] with `array[9]`.\n\n[8]: https://example.invalid/unused"), [1]);
  assert.deepEqual(inlineCitationNumbers("Fact [1](https://example.invalid/source) and [source][2].\n\n[2]: https://example.invalid/second"), [1, 2]);
  const code = "Use `values[9]` to illustrate indexing in your example.";
  assert.equal(validateClaimEvidenceLedger({
    markdown: code, sources: [], researchEvidence: "", productEvidence: "",
    claimEvidence: [{ claim: code, citationNumbers: [], supported: true, reason: "A reader instruction, not a sourced claim." }],
  }).passed, true);
  const falseSupport = "Chatbots convert more website visitors. Type `array[1]` into the example.";
  assert.deepEqual(markdownCitationMarkers(falseSupport), []);
  assert.equal(validateClaimEvidenceLedger({
    markdown: falseSupport, sources: [], researchEvidence: "", productEvidence: "",
    claimEvidence: [{ claim: falseSupport, citationNumbers: [], supported: true, reason: "An unsupported assertion is still unsupported." }],
  }).passed, false);
});

test("unsupported reference citations are removed as units without orphaned definitions", () => {
  const markdown = "A product fact [1].\n\n[1]: https://example.invalid/product";
  assert.equal(clean(markdown, 0), "A product fact.\n\n");
  assert.equal(clean("Read [the **documentation**][9].\n\n[9]: https://example.invalid/docs", 0),
    "Read the **documentation**.\n\n");
  assert.equal(clean("A product fact [9](https://example.invalid/source).", 0), "A product fact.");
});

test("valid citation definitions and destinations are not accidentally rewritten", () => {
  const markdown = "A supported fact [1].\n\n[1]: https://example.invalid/source \"Title\"";
  assert.equal(clean(markdown, 1), markdown);
  assert.equal(clean("A fact [1](https://example.invalid/source).", 1), "A fact [1](https://example.invalid/source).");
});

test("grouped numeric links cannot retain an unbound citation or ambiguous destination", () => {
  assert.equal(clean("A fact [1, 9](https://example.invalid/source).", 1), "A fact [1].");
  assert.equal(clean("A fact [1, 9].\n\n[1, 9]: https://example.invalid/source", 1), "A fact [1].\n\n");
});

test("mixed and adjacent citation slots prune deterministically and idempotently", () => {
  for (const [markdown, expected] of [
    ["A fact [1, 9].", "A fact [1]."],
    ["A fact [8] [9].", "A fact."],
    ["A fact [9] continues here.", "A fact continues here."],
    ["[9] Start here.", "Start here."],
    ["A fact [8][9].", "A fact."],
    ["A fact [1, 1].", "A fact [1]."],
  ]) {
    assert.equal(clean(markdown, 1), expected);
    assert.equal(clean(clean(markdown, 1), 1), expected);
  }
  for (const count of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(clean("A fact [1].", count), "A fact.");
  }
});
