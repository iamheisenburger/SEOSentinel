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
