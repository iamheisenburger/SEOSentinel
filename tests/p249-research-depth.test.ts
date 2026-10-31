// P249 (Oct 30 2026): the first article on a new user's Next.js blog ("How to Build a Markdown Blog in Next.js") kept one
// source, named no API and showed no code: it told readers to "check the current Next.js documentation". Research now
// searches five times, official documentation first for the software a topic is about, and keeps a wider passage
// from documentation pages; the writer shows code only when the excerpts show the API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVIDENCE_EXCERPT_MAX_CHARS, excerptLimit, pageExcerpt } from "../convex/lib/evidenceExcerpt.ts";
import { classifyEvidenceSource } from "../convex/lib/sourceQuality.ts";

test("P249 a documentation page keeps the API names next to its cited quote; other sources keep the quote's window", () => {
  const quote = "Next.js supports generating static pages from Markdown files at build time.";
  const page = `${quote} ${"x ".repeat(450)} Use generateStaticParams to return the list of slugs, then read each file with fs.`;
  assert.equal(classifyEvidenceSource("https://nextjs.org/docs/app/api-reference/functions/generate-static-params").tier, "official-doc");
  assert.match(pageExcerpt(page, [quote], true)!, /generateStaticParams/, "the documentation passage reaches the API name");
  assert.doesNotMatch(pageExcerpt(page, [quote], false)!, /generateStaticParams/, "another source keeps a short window");
  assert.equal(pageExcerpt(page, ["A sentence that is not on the page at all."], true), null);
  assert.equal(excerptLimit(true), EVIDENCE_EXCERPT_MAX_CHARS);
  assert.equal(excerptLimit(false), 2500);
  const provider = readFileSync("convex/actions/contentWorkProvider.ts", "utf8");
  assert.match(provider, /excerpt = pageExcerpt\(plainPageText\(\(await fetchText\(source\.url\)\)\.text\), source\.excerpts, docs\) \?\? excerpt;/);
  assert.match(provider, /sources\.push\(\{ \.\.\.source, excerpt: excerpt\.slice\(0, excerptLimit\(docs\)\) \}\);/);
});

test("P249 research searches five times, documentation first, and the writer shows code only from the excerpts", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  // P268: a list's research runs up to 8 searches (its options' pricing pages); every other article's, five.
  assert.match(pipeline, /maxUses: listFormat \? LIST_RESEARCH_SEARCHES : 5,\n        firstPartyProducts: namedProducts,/);
  assert.match(pipeline, /search its official documentation first and cite the pages that show the exact features, settings, APIs, file names or commands/);
  assert.match(pipeline, /include a short code, configuration or command example built only from what the excerpts show, in a fenced code block\. Never invent an API/);
  assert.match(pipeline, /\.slice\(0, EVIDENCE_EXCERPT_MAX_CHARS\);/);
});
