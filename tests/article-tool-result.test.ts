import assert from "node:assert/strict";
import test from "node:test";
import { ArticleSchema, recoverArticleToolTitle } from "../convex/lib/articleToolResult.ts";

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
