import assert from "node:assert/strict";
import test from "node:test";
import { firstPartyProductPage, productNamesInSearch, strictEvidenceSources } from "../convex/lib/sourceQuality.ts";

// P160 (Oct 22 2026): a comparison's facts about a named product must come from that product's own pages, but strict
// evidence rejected every vendor page as "secondary", so an "x alternatives" page could only hedge.
test("a comparison search names its products; a category names none", () => {
  assert.deepEqual(productNamesInSearch("seobot alternatives"), ["seobot"]);
  assert.deepEqual(productNamesInSearch("best SEObot alternatives for small teams"), ["seobot"]);
  assert.deepEqual(productNamesInSearch("seobot vs. outrank"), ["seobot", "outrank"]);
  assert.deepEqual(productNamesInSearch("compare surfer seo and frase"), ["surferseo", "frase"]);
  assert.deepEqual(productNamesInSearch("outrank pricing vs seobot pricing"), ["outrank", "seobot"]);
  assert.deepEqual(productNamesInSearch("keyword research tool alternatives"), [], "three words are a category");
  assert.deepEqual(productNamesInSearch("how to find keywords"), [], "not a comparison");
});

test("a named product's own website is evidence for it; other vendors and look-alike hosts are not", () => {
  const products = productNamesInSearch("seobot vs outrank");
  assert.equal(firstPartyProductPage("https://seobot.ai/pricing", products), true);
  assert.equal(firstPartyProductPage("https://help.seobot.ai/plans", products), true);
  assert.equal(firstPartyProductPage("https://www.outrank.so/", products), true);
  assert.equal(firstPartyProductPage("https://seobotreview.com/seobot", products), false, "a review site is not the product");
  assert.equal(firstPartyProductPage("https://otherplan.example/features", products), false);
  assert.equal(firstPartyProductPage("https://seobot.ai/pricing", []), false, "only when the search names it");
  const sources = [{ url: "https://seobot.ai/pricing" }, { url: "https://otherplan.example/features" }, { url: "https://www.ftc.gov/advertising" }];
  assert.deepEqual(strictEvidenceSources(sources).accepted.map((s) => s.url), ["https://www.ftc.gov/advertising"]);
  assert.deepEqual(strictEvidenceSources(sources, { firstPartyProducts: products }).accepted.map((s) => s.url),
    ["https://seobot.ai/pricing", "https://www.ftc.gov/advertising"]);
});
