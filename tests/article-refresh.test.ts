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


import { assertSafeImprovement, refreshInsertTarget } from "../convex/lib/contentSelection.ts";

const para = (seed: string, n = 60) => Array.from({ length: n }, (_, i) => `${seed}${i % 7}`).join(" ") + ".";
const article = [
  "Intro paragraph that sets the scene for readers who arrived from search and want a direct answer quickly.",
  "## How keyword research connects to production", para("research"),
  "## Where a tool like Pentra fits", para("tool"),
  "## Final note on scope", para("scope", 30),
  "## Related reading", "- [One](/blog/one)\n- [Two](/blog/two)",
].join("\n\n");
const base = { kind: "github", title: "Guide", markdown: article, sourceContent: `---\ntitle: "Guide"\n---\n\n${article}\n`, header: `---\ntitle: "Guide"\n---\n\n` };
const guidance = [
  "Start with the question the reader brings and write down what a useful answer must let them decide before anything else.",
  "Separate what you observed from what you suspect, and choose one reversible next step that tests the suspicion directly.",
  "Ask a colleague to reproduce the example and challenge any missing context before the team relies on the conclusion.",
  "Keep open questions visible and name who can answer each one, so the work does not stall on an unstated assumption.",
  "Describe the acceptance condition in plain words and agree who approves the result once that condition is met.",
  "Prefer a small change you can inspect over a sweeping rewrite, so the effect of each step stays easy to see.",
  "Record which evidence you considered and which question remains open, so a later reviewer can continue without guessing.",
  "Close by listing the next action, the reason for it, and the check that will show whether it was done.",
  "Invite the people affected to correct the record in their own words before the guidance is shared more widely.",
  "Review the result against the original scope and drop anything outside it unless the owner approves it.",
].join(" ");
const withSection = (section: string) => article.replace("## Final note on scope", `${section}\n\n## Final note on scope`);

test("a refresh inserts one section before the article's closing block and keeps every other byte", () => {
  const target = refreshInsertTarget(base, "standard")!;
  assert.equal(target.mode, "insert_section");
  assert.equal(target.before, "## Final note on scope", "the earliest heading of the trailing closing run");
  const section = `## A direct answer for this search\n\n${guidance}`;
  assert.equal(assertSafeImprovement(base, { title: "Guide", markdown: withSection(section) }, target), `${section}\n\n## Final note on scope`);
});

test("a refresh section may not change existing text or add unsourced material", () => {
  const target = refreshInsertTarget(base, "standard")!;
  const ok = `## A direct answer for this search\n\n${guidance}`;
  const reject = (markdown: string, pattern: RegExp) =>
    assert.throws(() => assertSafeImprovement(base, { title: "Guide", markdown }, target), pattern);
  reject(withSection(ok).replace("Intro paragraph", "Opening paragraph"), /changed existing article text/);
  reject(withSection(`${ok} Teams that do this see 37 percent more clicks.`), /number the article does not already state/);
  reject(withSection(`${ok} See [the guide](https://example.com).`), /links, images, HTML or code/);
  reject(withSection("## Too short\n\nKeep it brief."), /length is outside its bounds/);
  reject(withSection(`## How keyword research connects to production\n\n${guidance}`), /repeats an existing heading/);
  reject(withSection(`## A direct answer\n\n${guidance}\n\n## Second section\n\n${guidance}`), /exactly one section/);
  assert.throws(() => assertSafeImprovement(base, { title: "Other", markdown: withSection(ok) }, target), /title/);
});

test("no refresh when the article has no closing block or no room under its word ceiling", () => {
  assert.equal(refreshInsertTarget({ ...base, markdown: article.replace(/## Final note on scope[\s\S]*$/, "") , sourceContent: base.sourceContent }, "standard"), undefined);
  const long = article.replace("## Final note on scope", `${para("long", 2500)}\n\n## Final note on scope`);
  assert.equal(refreshInsertTarget({ ...base, markdown: long, sourceContent: `${base.header}${long}\n` }, "standard"), undefined);
  assert.equal(refreshInsertTarget({ ...base, kind: "wordpress" }, "standard"), undefined);
});
