// P255 (Oct 30 2026): Cowork's re-run, item 15 (ops/COWORK-RERUN-OCT30-RESULTS.md). The test account's draft for
// "nextjs blog template" named no template (people searching it want templates); its generateMetadata example stopped
// after the imports and the Props type; its review message was jargon; and the draft that never passed review left
// the free plan at "3 of 3, Limit Reached".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { codeExampleStopsShort, readerVisibleDefects } from "../convex/lib/articleQuality.ts";
import { classifyEvidenceSource, searchAsksForProducts } from "../convex/lib/sourceQuality.ts";

test("P255 a search for templates, themes, starters or boilerplates asks for them by name", () => {
  for (const search of ["nextjs blog template", "astro blog themes", "saas starter kit", "react boilerplate", "next.js starter"])
    assert.equal(searchAsksForProducts(search), true, search);
  assert.equal(searchAsksForProducts("how to build a blog with next.js"), false);
  assert.equal(searchAsksForProducts("lead scoring template"), false, "a document to fill in, not a product");
  assert.equal(searchAsksForProducts("blog post template"), false);
});

test("P255 a repository's own pages document it; its issues and discussions do not", () => {
  for (const url of ["https://github.com/vercel/next.js/tree/canary/examples/blog-starter", "https://github.com/timlrx/tailwind-nextjs-starter-blog",
    "https://github.com/satnaing/astro-paper/blob/main/README.md"]) assert.equal(classifyEvidenceSource(url).tier, "official-doc", url);
  for (const url of ["https://github.com/vercel/next.js/issues/123", "https://github.com/vercel/next.js/discussions/456", "https://github.com/vercel/next.js/pull/7"])
    assert.equal(classifyEvidenceSource(url).strictEligible, false, url);
});

test("P255 a code example that stops after its imports and types is a reader-visible defect; whole examples are not", () => {
  const cut = "import type { Metadata, ResolvingMetadata } from 'next'\n\ntype Props = {\n  params: Promise<{ slug: string }>\n}\n";
  assert.equal(codeExampleStopsShort("ts", cut), true);
  const whole = cut + "\nexport async function generateMetadata({ params }: Props): Promise<Metadata> {\n  const { slug } = await params\n  return { title: slug }\n}\n";
  assert.equal(codeExampleStopsShort("ts", whole), false);
  assert.equal(codeExampleStopsShort("ts", "type Post = {\n  title: string\n  date: string\n}\n"), false, "a type on its own, with no imports, is a fine example");
  assert.equal(codeExampleStopsShort("bash", "import x"), false);
  assert.ok(readerVisibleDefects("## Metadata\n\nSet the title:\n\n```ts\n" + cut + "```\n").some(defect => /only its imports and types/.test(defect)));
  assert.deepEqual(readerVisibleDefects("## Metadata\n\nSet the title:\n\n```ts\n" + whole + "```\n").filter(defect => /imports and types/.test(defect)), []);
  assert.match(readFileSync("convex/actions/pipeline.ts", "utf8"), /Show a whole example: never one that stops after its imports or types/);
});

test("P255 a draft that didn't pass review reads in plain words", () => {
  const customer = readFileSync("convex/lib/contentCustomer.ts", "utf8");
  assert.doesNotMatch(customer, /Bounded retries remain visible/);
  // P256: plain, and not framed as a failure.
  assert.match(customer, /This draft isn't ready to publish yet\. Open it to read it and see what to check\./);
});
