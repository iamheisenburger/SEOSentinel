import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTopicBusinessFit, tenantCoreVocabulary, tenantTopicBusinessSignals } from "../convex/lib/autopilotBuffer.ts";

// A synthetic lead-qualification chatbot vendor (not a real tenant's profile).
const qualifier = tenantTopicBusinessSignals({
  siteType: "SaaS Product",
  niche: "B2B SaaS for AI lead qualification on business websites",
  siteSummary: "QualifyBot is a website chatbot that answers visitor questions, qualifies leads and books sales calls.",
  targetAudienceSummary: "Small B2B companies and agencies whose website traffic does not turn into qualified leads.",
  productUsage: "Install the chat widget on your website; it qualifies leads and hands them to your sales team.",
  anchorKeywords: ["lead qualification chatbot", "AI chatbot for lead capture", "automated lead scoring tool",
    "website lead generation automation", "sales chat widget"],
  keyFeatures: ["Lead scoring and qualification", "Contact capture", "Calendar booking"],
  painPoints: ["Too few website visitors become leads"],
});
const fits = (keyword: string, signals = qualifier) =>
  evaluateTopicBusinessFit({ keyword, label: keyword.replace(/^./, c => c.toUpperCase()), ...signals }).eligible;

test("the tenant's own recurring subject words count as distinctive for that tenant", () => {
  assert.deepEqual([...tenantCoreVocabulary(qualifier.productAnchorSignals)].sort(), ["lead", "leads"]);
  for (const keyword of ["b2b lead qualification process", "b2b lead scoring", "ai lead capture for small business",
    "lead qualification b2b", "how do chatbots qualify leads"]) {
    assert.equal(fits(keyword), true, keyword);
  }
});

test("off-business searches still fail after the widening", () => {
  for (const keyword of ["sales jobs near me", "sales jobs", "lead poisoning symptoms", "hire sales improvement consultant",
    "lead generation services", "celebrity gossip news today", "consultative sales coaching", "cheap flights to paris",
    "marketing agency near me", "leads"]) {
    assert.equal(fits(keyword), false, keyword);
  }
});

test("a word used once in the product phrases is not promoted", () => {
  const oneMention = tenantTopicBusinessSignals({
    niche: "Ceramic studio inventory software", siteSummary: "Inventory tracking for ceramic studios.",
    anchorKeywords: ["ceramic glaze inventory tracking", "kiln firing log", "clay stock reorder alerts", "studio sales report"],
    keyFeatures: ["Glaze recipes", "Kiln schedules"],
  });
  assert.equal(tenantCoreVocabulary(oneMention.productAnchorSignals).size, 0);
  assert.equal(fits("b2b sales report template", oneMention), false);
});

test("the widening never removes a keyword the strict gate accepts", () => {
  for (const keyword of ["lead qualification chatbot", "ai chatbot for lead capture", "sales chat widget pricing"]) {
    const strict = evaluateTopicBusinessFit({ keyword, label: keyword, ...qualifier, productAnchorSignals: [] });
    if (strict.eligible) assert.equal(fits(keyword), true, keyword);
  }
  assert.equal(fits("lead qualification chatbot"), true);
});
