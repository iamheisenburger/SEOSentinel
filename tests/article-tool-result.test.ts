import assert from "node:assert/strict";
import test from "node:test";
import { ArticleSchema, recoverArticleToolTitle, recoverLeakedArticleEnvelope, stripLeakedToolEnvelope } from "../convex/lib/articleToolResult.ts";

test("missing draft title is recovered only from a bounded existing SEO headline without mutating the receipt", () => {
  const raw = Object.freeze({ slug: "sample", markdown: "An unchanged draft.", metaTitle: "  Existing headline  " });
  const parsed = ArticleSchema.parse(raw);
  assert.equal(parsed.title, "Existing headline");
  assert.equal(parsed.markdown, raw.markdown);
  assert.equal(parsed.metaTitle, raw.metaTitle);
  assert.equal(Object.hasOwn(raw, "title"), false);
});

test("explicit title is never replaced, and invalid or absent metadata cannot manufacture one", () => {
  const raw = { title: "Article headline", metaTitle: "SEO headline", slug: "sample", markdown: "Draft." };
  assert.equal(recoverArticleToolTitle(raw), raw);
  for (const metaTitle of [undefined, null, 42, "", " ", "x".repeat(66), "line\nbreak", "bad\u0001title"]) {
    assert.equal(ArticleSchema.safeParse({ slug: "sample", markdown: "Draft.", metaTitle }).success, false);
  }
  for (const title of [null, 42, []]) assert.equal(ArticleSchema.safeParse({ ...raw, title }).success, false);
  for (const value of [null, [], 42, "headline"]) assert.equal(recoverArticleToolTitle(value), value);
});

test("metadata recovery never relaxes required draft or source validation", () => {
  for (const fields of [{}, { markdown: 42, slug: "sample" }, { markdown: "Draft." },
    { markdown: "Draft.", slug: "sample", sources: [{ url: 42 }] }]) {
    assert.equal(ArticleSchema.safeParse({ metaTitle: "Existing headline", ...fields }).success, false);
  }
});

const leakedTail = "\n</markdown>\n<metaTitle>Sales Automation Chat Widget: A Practical Buyer's Guide</metaTitle>\n" +
  "<metaDescription>Learn how sales automation chat widgets work, how to vet one before buying, and a content audit to run before you install one.</metaDescription>\n" +
  "<metaKeywords>chat widget, sales automation</metaKeywords>\n<sources></sources>";

test("a leaked structured-output envelope is removed from the body and fills only unusable search metadata", () => {
  const raw = Object.freeze({ title: "Guide", slug: "guide", markdown: "# Guide\n\nUseful body." + leakedTail, metaTitle: "wait", metaDescription: "no." });
  const parsed = ArticleSchema.parse(raw);
  assert.equal(parsed.markdown, "# Guide\n\nUseful body.");
  assert.equal(parsed.metaTitle, "Sales Automation Chat Widget: A Practical Buyer's Guide");
  assert.match(parsed.metaDescription!, /^Learn how sales automation/);
  assert.match(raw.markdown, /<metaTitle>/, "raw receipt is not mutated");
});

test("usable real metadata is never replaced by leaked values", () => {
  const raw = { title: "Guide", slug: "guide", markdown: "Body." + leakedTail, metaTitle: "A real and adequate search title",
    metaDescription: "x".repeat(120) };
  const parsed = ArticleSchema.parse(raw);
  assert.equal(parsed.metaTitle, raw.metaTitle);
  assert.equal(parsed.metaDescription, raw.metaDescription);
  assert.equal(parsed.markdown, "Body.");
});

test("envelope stripping refuses unknown tags, out-of-range values and bodies without a closing markdown tag", () => {
  assert.equal(stripLeakedToolEnvelope("Body.\n<metaTitle>x</metaTitle>"), null);
  assert.equal(stripLeakedToolEnvelope("Body.\n</markdown><script>alert(1)</script>"), null);
  assert.equal(stripLeakedToolEnvelope("</markdown><metaTitle>x</metaTitle>"), null, "empty body is not recovered");
  const tooLong = { title: "T", slug: "t", markdown: "Body.\n</markdown><metaTitle>" + "y".repeat(61) + "</metaTitle>", metaTitle: "wait" };
  const parsed = ArticleSchema.parse(tooLong);
  assert.equal(parsed.metaTitle, "wait", "invalid leaked title leaves the field for the existing quality gate");
  assert.equal(parsed.markdown, "Body.");
  for (const value of [null, [], 42, { markdown: 42 }]) assert.equal(recoverLeakedArticleEnvelope(value), value);
});
