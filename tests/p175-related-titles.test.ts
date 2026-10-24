// P175 (Oct 24 2026): a Related reading entry was the best 8-word window of the linked article's title, so 34 live
// entries on the owner sites read like "What Is an AI Sales Agent? How It" or "B2B SaaS Content Strategy for Ranking
// and Lead". An entry now names the article it links by its whole title.
import test from "node:test";
import assert from "node:assert/strict";
import { appendRelatedInternalLinks, relatedReadingTitle, selectRelatedInternalLinks, validateInternalLinkSuggestions } from "../convex/lib/internalLinks.ts";

const destinations = [
  { href: "/blog/ai-sales-agent", title: "What Is an AI Sales Agent? How It Works and Why Websites Need One", summary: "", keywords: ["ai sales agent"] },
  { href: "/blog/b2b-saas-content", title: "B2B SaaS Content Strategy for Ranking and Lead Generation: A Complete Guide", summary: "", keywords: [] },
  { href: "/blog/free-tools", title: "Best Free SEO Tools for Small Teams (No Budget Required)", summary: "", keywords: [] },
];

test("a Related reading entry is the linked article's whole title, its aside left out", () => {
  const links = selectRelatedInternalLinks({ currentTitle: "Sales agent lead generation content for SEO small teams", destinations, limit: 3 });
  const byHref = Object.fromEntries(links.map(link => [link.href, link.anchor]));
  assert.equal(byHref["/blog/ai-sales-agent"], "What Is an AI Sales Agent? How It Works and Why Websites Need One");
  assert.equal(byHref["/blog/b2b-saas-content"], "B2B SaaS Content Strategy for Ranking and Lead Generation: A Complete Guide");
  assert.equal(byHref["/blog/free-tools"], "Best Free SEO Tools for Small Teams");
  const valid = validateInternalLinkSuggestions(links, destinations.map(d => d.href), "/blog/self", { relatedReading: true });
  assert.equal(valid.length, 3, "whole titles pass the Related reading limits");
  assert.equal(validateInternalLinkSuggestions(links, destinations.map(d => d.href), "/blog/self").length, 1, "in-prose anchors keep the 8-word cap");
  const { markdown } = appendRelatedInternalLinks("# Title\n\nBody text.\n\n## Sources\n\n1. Source", valid);
  assert.match(markdown, /- \[What Is an AI Sales Agent\? How It Works and Why Websites Need One\]\(\/blog\/ai-sales-agent\)/);
});

test("a title too long for an entry uses its headline, never a cut", () => {
  assert.equal(relatedReadingTitle("Lead Scoring: a very long subtitle that keeps going well past any reasonable length for one entry"), "Lead Scoring");
  assert.equal(relatedReadingTitle("x"), null);
  assert.equal(relatedReadingTitle("How Often Should a Small Business Publish Blog Posts?"), "How Often Should a Small Business Publish Blog Posts?");
});
