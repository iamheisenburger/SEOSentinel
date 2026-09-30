import assert from "node:assert/strict";
import test from "node:test";

import {
  pentraOnlyFileHistory,
  pentraOwnedMarkdown,
  REFRESH_HISTORY_LIMIT,
  REFRESH_COOLDOWN_MS,
  refreshArticleOldEnough,
  refreshOpportunities,
  refreshSlotAvailable,
  refreshWindowStart,
} from "../convex/lib/articleRefresh.ts";

const page = "https://maple.example/blog/garden-visit";

test("a refresh needs a real page-2 search: 10+ impressions at average position 8-30", () => {
  const rows = [
    { page, query: "garden visit checklist", impressions: 6, position: 14 },
    { page, query: "garden visit checklist", impressions: 6, position: 16 },
    { page, query: "garden visit cost", impressions: 40, position: 4 }, // already top of page one
    { page, query: "garden pruning notes", impressions: 30, position: 45 }, // too deep to lift
    { page, query: "garden access form", impressions: 9, position: 12 }, // too little demand
    { page: "https://maple.example/blog/other", query: "garden visit checklist", impressions: 99, position: 12 },
  ];
  assert.deepEqual(refreshOpportunities(rows, page), [{ query: "garden visit checklist", impressions: 12, position: 15 }]);
});

test("refreshes take at most one of every four automatic slots", () => {
  const slot = (intent: string, deadlineAt: number, extra: Record<string, unknown> = {}) => ({ contentWork: { intent, deadlineAt, ...extra } });
  assert.equal(refreshSlotAvailable([]), true);
  assert.equal(refreshSlotAvailable([slot("create", 1), slot("create", 2), slot("create", 3)]), true);
  assert.equal(refreshSlotAvailable([slot("improve", 1), slot("create", 2), slot("create", 3), slot("create", 4)]), true);
  assert.equal(refreshSlotAvailable([slot("create", 1), slot("improve", 2), slot("create", 3), slot("create", 4)]), false);
  // Owner-requested drafts and retired work are not automatic slots.
  assert.equal(refreshSlotAvailable([slot("improve", 9, { ownerRequest: {} }), slot("improve", 8, { retiredAt: 1 })]), true);
});

test("only an article live for four weeks qualifies, and the cooldown is 60 days", () => {
  const now = Date.UTC(2026, 8, 30);
  assert.equal(refreshArticleOldEnough(now - 27 * 86_400_000, now), false);
  assert.equal(refreshArticleOldEnough(now - 28 * 86_400_000, now), true);
  assert.equal(refreshArticleOldEnough(undefined, now), false);
  assert.equal(REFRESH_COOLDOWN_MS, 60 * 86_400_000);
});

test("only Pentra's own delivery of the exact article is adopted", () => {
  const key = `pentra:${"a".repeat(64)}`;
  const file = (generator: string, deliveryKey: string) => `---\ntitle: "Garden visit"\ngenerator: "${generator}"\npentraDeliveryKey: "${deliveryKey}"\n---\nBody\n`;
  assert.equal(pentraOwnedMarkdown(file("pentra", key), key), true);
  assert.equal(pentraOwnedMarkdown(file("hugo", key), key), false);
  assert.equal(pentraOwnedMarkdown(file("pentra", `pentra:${"b".repeat(64)}`), key), false);
  assert.equal(pentraOwnedMarkdown("# No frontmatter", key), false);
});

test("the refresh window is the newest 28 days of Search Console receipts", () => {
  assert.equal(refreshWindowStart(["2026-08-01", "2026-09-26", "2026-09-10"]), "2026-08-30");
  assert.equal(refreshWindowStart([]), undefined);
});

test("only a file whose whole history is Pentra's own deliveries can be refreshed", () => {
  const pentra = (verb: string) => ({ sha: verb, commit: { message: `Pentra ${verb} pentra:3f9a1c: Garden visit checklist` } });
  assert.equal(pentraOnlyFileHistory([pentra("publish")]), true);
  assert.equal(pentraOnlyFileHistory([pentra("improve"), pentra("revise"), pentra("publish")]), true);
  assert.equal(pentraOnlyFileHistory([{ sha: "o", commit: { message: "Fix a typo" } }, pentra("publish")]), false,
    "one owner commit makes the file the owner's");
  assert.equal(pentraOnlyFileHistory([{ commit: { message: "Pentra publish without a key" } }]), false);
  assert.equal(pentraOnlyFileHistory([]), false);
  assert.equal(pentraOnlyFileHistory({ message: "Not Found" }), false);
  assert.equal(pentraOnlyFileHistory(Array.from({ length: REFRESH_HISTORY_LIMIT }, () => pentra("improve"))), false,
    "a history longer than the limit is not proven");
});

