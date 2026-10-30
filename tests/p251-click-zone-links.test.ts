// P251 (Oct 30 2026): new articles linked other pages by topic alone. The pages Google already shows near the click zone
// (LeadPilot's sales-lead-scoring-system-2 at 16, lead-scoring-solutions at 30) gain most from one more internal link,
// so among destinations about as related they now come first; an unrelated page never gets a link for its position.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clickZoneFromRows, selectRelatedInternalLinks } from "../convex/lib/internalLinks.ts";

const zone = clickZoneFromRows([
  { page: "https://leadpilot.chat/blog/sales-lead-scoring-system-2", impressions: 60, position: 15 },
  { page: "https://leadpilot.chat/blog/sales-lead-scoring-system-2/", impressions: 40, position: 18 },
  { page: "https://leadpilot.chat/blog/chatbot-pricing", impressions: 80, position: 9 },
  { page: "https://leadpilot.chat/blog/lead-scoring-basics", impressions: 3, position: 6 },
]);
const destinations = [
  { href: "/blog/lead-scoring-basics", title: "Lead Scoring Basics for Sales Teams" },
  { href: "/blog/sales-lead-scoring-system-2", title: "Sales Lead Scoring System for Small Teams" },
  { href: "/blog/chatbot-pricing", title: "Chatbot Pricing Explained" },
  { href: "/blog/lead-scoring-template-sales-teams", title: "Lead Scoring Template for Sales Teams: Score Leads Step by Step" },
];

test("P251 a page's 28-day impressions and average position come from its Search Console rows", () => {
  assert.deepEqual(zone.get("/blog/sales-lead-scoring-system-2"), { impressions: 100, position: 16.2 }, "weighted by impressions, any trailing slash");
});

test("P251 among destinations about as related a page near the click zone comes first; an unrelated page never does", () => {
  const pick = (clickZone?: typeof zone) => selectRelatedInternalLinks({ currentTitle: "How to Score Sales Leads", destinations, limit: 2, clickZone }).map(link => link.href);
  assert.deepEqual(pick(), ["/blog/lead-scoring-template-sales-teams", "/blog/lead-scoring-basics"]);
  assert.deepEqual(pick(zone), ["/blog/lead-scoring-template-sales-teams", "/blog/sales-lead-scoring-system-2"],
    "the page at 16 replaces an equally related page Google barely shows; the clearly closer match keeps its place");
  assert.ok(!selectRelatedInternalLinks({ currentTitle: "How to Score Sales Leads", destinations, limit: 6, clickZone: zone })
    .some(link => link.href === "/blog/chatbot-pricing"), "position never buys a link to an unrelated page");
});

test("P251 the article pipeline reads the site's click zone once and passes it to the related-article choice", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /internal\.searchPerformance\.pageClickZoneInternal, \{ siteId \}\)\.catch\(\(\) => \[\]\)/);
  assert.match(pipeline, /destinations: relatedArticles,\n    limit: 3,\n    clickZone,/);
  assert.match(readFileSync("convex/searchPerformance.ts", "utf8"), /export const pageClickZoneInternal = internalQuery/);
});
