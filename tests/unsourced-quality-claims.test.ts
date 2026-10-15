import assert from "node:assert/strict";
import test from "node:test";

import { stripUnsourcedQualityClaims } from "../convex/lib/articleQuality.ts";

test("unsourced evidence claims leave titles and descriptions grammatical", () => {
  assert.equal(stripUnsourcedQualityClaims("SaaS Lead Scoring: An Evidence-Based Framework for Prioritizing Website Leads"),
    "SaaS Lead Scoring: A Framework for Prioritizing Website Leads");
  assert.equal(stripUnsourcedQualityClaims("Evidence-Based Lead Scoring for SaaS"), "Lead Scoring for SaaS");
  assert.equal(stripUnsourcedQualityClaims("Use a data-driven approach to ranking"), "Use an approach to ranking");
  assert.equal(stripUnsourcedQualityClaims("A research-backed guide to local keywords"), "A guide to local keywords");
  assert.equal(stripUnsourcedQualityClaims("Learn an evidence based method and a science-backed checklist."), "Learn a method and a checklist.");
});

test("other wording is untouched", () => {
  for (const text of ["How to collect evidence before choosing a tool", "Keyword research that matches buyer intent", "Based on your data, decide"]) {
    assert.equal(stripUnsourcedQualityClaims(text), text);
  }
});

import { stripDraftProcessNotes } from "../convex/lib/articleQuality.ts";

test("notes about the drafting process are deleted; reader prose, headings and code stay", () => {
  const lead = "This article explains how to evaluate free options without relying on marketing claims.";
  const note = "No external sources were verified for this draft, so the guidance below is a set of reader-run checks and the author's proposed evaluation framework, not established industry fact.";
  const markdown = `Free tools can help you draft articles.\n\n${lead} ${note}\n\n## Start with the job\n\n- Check the plan limits. This draft does not cover pricing.\n\n\`\`\`\nthis draft stays in code\n\`\`\`\n`;
  const cleaned = stripDraftProcessNotes(markdown);
  assert.ok(cleaned.includes(lead) && !cleaned.includes("No external sources"), cleaned);
  assert.ok(cleaned.includes("- Check the plan limits.") && !cleaned.includes("This draft does not"), cleaned);
  assert.ok(cleaned.includes("## Start with the job") && cleaned.includes("this draft stays in code"), cleaned);
  const untouched = "A rough draft of your keyword list is fine. Sources of demand differ by market.";
  assert.equal(stripDraftProcessNotes(untouched), untouched);
});
