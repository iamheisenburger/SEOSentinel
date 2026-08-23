import assert from "node:assert/strict";
import test from "node:test";

import {
  SERP_ATTAINABILITY_VERSION,
  evaluateSerpAttainability,
  evaluateSerpBusinessIntent,
  expectedOrganicValue,
  isEntrenchedHost,
} from "../convex/lib/serpAttainability.ts";

test("rejects a book-title SERP for a non-publishing SaaS tenant", () => {
  const result = evaluateSerpBusinessIntent({
    businessModelSignals: ["B2B SaaS", "AI lead qualification software"],
    results: [
      { url: "https://amazon.com/example", title: "The Qualified Sales Leader — Paperback" },
      { url: "https://audible.com/example", title: "The Qualified Sales Leader Audiobook" },
      { url: "https://goodreads.com/example", title: "The Qualified Sales Leader" },
      { url: "https://books.google.com/example", title: "The Qualified Sales Leader" },
      { url: "https://example.com/summary", title: "Qualified Sales Leader Book Summary" },
      { url: "https://example.org/article", title: "Sales leadership advice" },
      { url: "https://example.net/article", title: "Sales qualification guide" },
      { url: "https://example.edu/article", title: "Sales management" },
    ],
  });
  assert.equal(result.aligned, false);
  assert.match(result.reasons.join("; "), /book or audiobook/);
});

test("allows a book SERP when publishing is the tenant's business", () => {
  const result = evaluateSerpBusinessIntent({
    businessModelSignals: ["independent author and book publisher"],
    results: [
      { url: "https://amazon.com/example", title: "Example Paperback" },
      { url: "https://goodreads.com/example", title: "Example Book" },
    ],
  });
  assert.equal(result.aligned, true);
});

test("classifies entrenched publishers including subdomains", () => {
  assert.equal(isEntrenchedHost("salesforce.com"), true);
  assert.equal(isEntrenchedHost("www.hubspot.com"), true);
  assert.equal(isEntrenchedHost("blog.hubspot.com"), true);
  assert.equal(isEntrenchedHost("en.wikipedia.org"), true);
  assert.equal(isEntrenchedHost("leadpilot.chat"), false);
  assert.equal(isEntrenchedHost("someconsultancy.co.uk"), false);
});

test("rejects a SERP owned by mega-vendors", () => {
  // The real observed SERP shape behind LeadPilot's published topics.
  const result = evaluateSerpAttainability({
    serpTopUrls: [
      "https://www.salesforce.com/products/guide",
      "https://blog.hubspot.com/sales/qualification",
      "https://www.zendesk.com/service/chatbot",
      "https://www.reddit.com/r/sales/comments/abc",
      "https://www.linkedin.com/pulse/lead-qualification",
      "https://www.g2.com/categories/chatbot",
      "https://smallvendor.io/blog/qualify",
    ],
  });
  assert.equal(result.attainable, false);
  assert.ok(result.entrenchedRatio > 0.5);
  assert.equal(result.version, SERP_ATTAINABILITY_VERSION);
  assert.match(result.reasons[0], /entrenched publishers/);
});

test("accepts a SERP of comparable independent sites", () => {
  const result = evaluateSerpAttainability({
    serpTopUrls: [
      "https://conversionagency.io/services",
      "https://growthlab.co/cro-consulting",
      "https://someshop.com/blog/optimisation",
      "https://freelancecro.dev/hire",
      "https://www.reddit.com/r/marketing/comments/x",
    ],
  });
  assert.equal(result.attainable, true);
  assert.ok(result.score >= 50);
});

test("fails closed when no SERP evidence exists", () => {
  const result = evaluateSerpAttainability({ serpTopUrls: [] });
  assert.equal(result.attainable, false);
  assert.equal(result.observedResults, 0);
  assert.equal(result.entrenchedRatio, 1);
  assert.match(result.reasons[0], /No live SERP evidence/);
});

test("the tenant's own ranking never counts against it", () => {
  const urls = [
    "https://leadpilot.chat/blog/existing",
    "https://independentblog.com/a",
    "https://anotherblog.dev/b",
  ];
  const withoutHost = evaluateSerpAttainability({ serpTopUrls: urls });
  const withHost = evaluateSerpAttainability({
    serpTopUrls: urls,
    siteHost: "leadpilot.chat",
  });
  assert.equal(withHost.observedResults, withoutHost.observedResults - 1);
  assert.equal(withHost.attainable, true);
});

test("expected value prefers winnable demand over entrenched demand", () => {
  // A high-volume keyword on an open SERP must beat a tiny keyword whose page
  // one is owned by mega-vendors. This is the exact inversion that caused
  // 86 articles to earn a single click.
  const winnable = expectedOrganicValue({
    searchVolume: 1600,
    serpTopUrls: [
      "https://consultancy.io/a",
      "https://agency.dev/b",
      "https://smallblog.com/c",
    ],
    keywordDifficultyMeasured: true,
    keywordDifficulty: 20,
  });
  const entrenched = expectedOrganicValue({
    searchVolume: 10,
    serpTopUrls: [
      "https://www.salesforce.com/a",
      "https://blog.hubspot.com/b",
      "https://www.zendesk.com/c",
    ],
    keywordDifficultyMeasured: false,
    keywordDifficulty: 0,
  });
  assert.ok(winnable > entrenched);
  assert.equal(entrenched, 0);
});

test("unmeasured difficulty is penalised, never treated as easy", () => {
  const base = {
    searchVolume: 500,
    serpTopUrls: ["https://a.io/x", "https://b.io/y", "https://c.io/z"],
  };
  const measured = expectedOrganicValue({
    ...base,
    keywordDifficultyMeasured: true,
    keywordDifficulty: 0,
  });
  const unmeasured = expectedOrganicValue({
    ...base,
    keywordDifficultyMeasured: false,
    keywordDifficulty: 0,
  });
  assert.ok(measured > unmeasured);
});

test("zero-volume keywords have no expected organic value", () => {
  assert.equal(
    expectedOrganicValue({
      searchVolume: 0,
      serpTopUrls: ["https://independent.io/a"],
    }),
    0,
  );
});
