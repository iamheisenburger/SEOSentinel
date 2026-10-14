import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { configuredCallToAction, firstPartyProductEvidence } from "../convex/lib/productEvidence.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";
import {
  ARTICLE_DEPTH_BASE_WORDS,
  initialArticleDepthTarget,
  validateClaimEvidenceLedger,
  STRICT_PUBLICATION_MIN_WORDS,
} from "../convex/lib/articleQuality.ts";

const site = {
  domain: "example-widgets.com",
  siteSummary: "Example Widgets sells modular shelving for small shops.",
  keyFeatures: ["Modular shelves", "Free delivery over $200"],
  pricingInfo: "Starter kit $149",
  ctaText: "Build your shelf",
  ctaUrl: "https://example-widgets.com/configure",
};

test("first-party evidence carries the owner's call to action exactly as the writer links it", () => {
  const evidence = firstPartyProductEvidence({ productName: "Example Widgets", site, crawled: { homepage: "Shelving for shops" } });
  const cta = configuredCallToAction(site, "Example Widgets");
  assert.ok(evidence.includes(cta.url) && evidence.includes(cta.label), evidence);
  assert.ok(evidence.includes("Configured pricing:\nStarter kit $149"));
  assert.ok(evidence.includes("Crawled homepage:\nShelving for shops"));
  // A ledger entry for the article's own CTA sentence is matched by the first-party snapshot.
  const claim = `Ready to plan a store layout? [${cta.label}](${cta.url}) with Example Widgets.`;
  const result = validateClaimEvidenceLedger({ markdown: `## Next step\n\n${claim}\n`, sources: [], researchEvidence: "",
    productEvidence: evidence, productEvidenceHash: sha256Hex(evidence),
    claimEvidence: [{ claim, supported: true, citationNumbers: [], reason: "The owner's configured call to action." }] });
  assert.ok(!result.issues.some(issue => issue.includes("entry 1")), JSON.stringify(result.issues));
});

test("without a configured CTA the writer and the evidence both use the site's homepage", () => {
  const bare = { domain: "https://Bare-Site.io/" };
  const cta = configuredCallToAction(bare, "Bare");
  assert.deepEqual(cta, { label: "Try Bare", url: "https://Bare-Site.io" });
  assert.ok(firstPartyProductEvidence({ productName: "Bare", site: bare, crawled: {} }).includes("https://Bare-Site.io"));
});

test("both evidence builders and the writer's CTA come from the shared helper", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.equal(pipeline.match(/firstPartyProductEvidence\(\{/g)?.length, 2);
  assert.ok(!pipeline.includes("Configured pricing:"), "no hand-built copy of the evidence remains");
  assert.ok(pipeline.includes("configuredCallToAction(site, productName)"));
});

test("pruning room: the writer aims well above the publication floor", () => {
  assert.ok(STRICT_PUBLICATION_MIN_WORDS < ARTICLE_DEPTH_BASE_WORDS);
  const target = initialArticleDepthTarget({ minimumWords: ARTICLE_DEPTH_BASE_WORDS, maximumWords: 2600 });
  assert.equal(target, 1500);
  // A 1,500-word draft can lose a third of its words to evidence pruning and still publish.
  assert.ok(target * (2 / 3) >= STRICT_PUBLICATION_MIN_WORDS);
});
