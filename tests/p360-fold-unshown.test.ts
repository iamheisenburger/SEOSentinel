/** P360 (Nov 5 2026), Phase 3's first engine: an article Google showed to nobody for 28 days, live 60+ days, folds into the
 * article on its subject that Google does show (a permanent redirect; its subject becomes a section there). The weekly
 * diagnosis's action for these pages was "merge it into a stronger page or rewrite it for a search the site can win";
 * Phase 1's duplicate check can't see them (an unshown page shares no searches). A dry run on LeadPilot's real data
 * folded "How to Build a B2B Lead Scoring System That Actually Works" (76 days, never shown) into "Sales Lead Scoring
 * System: How to Build One..." (103 impressions). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_UNSHOWN_MERGES_PER_RUN, planUnshownMerges, UNSHOWN_MIN_AGE_DAYS, UNSHOWN_SIBLING_MIN_IMPRESSIONS } from "../convex/lib/duplicatePages.ts";

const DAY = 86_400_000, now = 1_793_900_000_000;
const url = (slug: string) => `https://leadpilot.chat/blog/${slug}`;
const article = (slug: string, title: string, ageDays: number) => ({ url: url(slug), title, publishedAt: now - ageDays * DAY });
const shown = (slug: string, impressions: number, clicks = 0) => ({ page: url(slug), impressions, clicks });

test("an article Google never shows folds into the shown article on its subject, never one without a shown sibling", () => {
  const articles = [
    article("b2b-lead-scoring-system", "How to Build a B2B Lead Scoring System That Actually Works", 76),
    article("sales-lead-scoring-system-2", "Sales Lead Scoring System: How to Build One That Actually Predicts Revenue", 120),
    article("exit-intent-popup-timing", "Exit Intent Popup Timing for B2B Sites", 80),
    article("lead-scoring-template", "Lead Scoring Template for Small Sales Teams", 30),
  ];
  const plan = planUnshownMerges({ articles, gsc: [shown("sales-lead-scoring-system-2", 103, 1)], now, mayMerge: () => true, taken: new Set() });
  assert.deepEqual(plan.map((m) => [m.from, m.to, m.ageDays, m.toImpressions]),
    [[url("b2b-lead-scoring-system"), url("sales-lead-scoring-system-2"), 76, 103]]);
  // "exit intent popup timing" has no shown sibling: it waits (a rewrite, not a fold); the 30-day template is still settling.
  assert.equal(UNSHOWN_MIN_AGE_DAYS, 60); assert.equal(UNSHOWN_SIBLING_MIN_IMPRESSIONS, 20); assert.equal(MAX_UNSHOWN_MERGES_PER_RUN, 3);
});

test("a sibling barely shown, an article already merged this run, a page that isn't live and indexable never fold; at most three a run", () => {
  const base = [article("a-lead-scoring-guide", "Lead Scoring Guide for SaaS", 90), article("lead-scoring-saas", "Lead Scoring for SaaS Companies", 200)];
  assert.equal(planUnshownMerges({ articles: base, gsc: [shown("lead-scoring-saas", 19)], now, mayMerge: () => true, taken: new Set() }).length, 0,
    "a sibling must itself be shown (20+ impressions)");
  assert.equal(planUnshownMerges({ articles: base, gsc: [shown("lead-scoring-saas", 50)], now, mayMerge: () => true, taken: new Set([url("a-lead-scoring-guide")]) }).length, 0);
  assert.equal(planUnshownMerges({ articles: base, gsc: [shown("lead-scoring-saas", 50)], now, mayMerge: (u) => !u.includes("a-lead"), taken: new Set() }).length, 0,
    "only a live, indexable Pentra article on its own address");
  const many = Array.from({ length: 6 }, (_, i) => article(`lead-scoring-saas-idea-${i}`, `Lead Scoring for SaaS: Idea ${i}`, 70 + i));
  const plan = planUnshownMerges({ articles: [...many, base[1]], gsc: [shown("lead-scoring-saas", 50)], now, mayMerge: () => true, taken: new Set() });
  assert.equal(plan.length, 3, "at most three a week");
  assert.deepEqual(plan.map((m) => m.ageDays), [75, 74, 73], "oldest first");
  const chain = planUnshownMerges({ articles: [article("lead-scoring-saas-a", "Lead Scoring for SaaS Teams", 100), article("lead-scoring-saas-b", "Lead Scoring for SaaS Startups", 100)],
    gsc: [], now, mayMerge: () => true, taken: new Set() });
  assert.equal(chain.length, 0, "two unshown articles never fold into each other");
});

test("the weekly run folds after duplicate merges, owner review keeps them waiting, and each fold is recorded with its reason", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.ok(action.indexOf("await recordMerges(ctx, site, d.merges, gsc)") < action.indexOf("await recordUnshownMerges(ctx, site, pages, gsc, merged)"));
  assert.match(action, /const folded = gsc\.length && !site\.ownerReview \? await recordUnshownMerges\(ctx, site, pages, gsc, merged\) : \[\];/);
  assert.match(action, /reason: "merged_unshown" as const, foldQuestions: \[m\.fromTitle\.slice\(0, 120\)\]/, "its subject becomes a section of the kept article");
  assert.match(readFileSync("convex/siteRedirects.ts", "utf8"), /reason: merge\.reason \?\? "merged_duplicate"/);
  assert.match(readFileSync("convex/schema.ts", "utf8"), /reason: v\.union\(v\.literal\("merged_duplicate"\), v\.literal\("merged_unshown"\)\)/);
  assert.match(readFileSync("src/components/site-diagnosis-card.tsx", "utf8"), /r\.reason === "merged_unshown" \? "Folded unseen article " : "Merged duplicate "/);
});

test("the repairs can run on their own, free: no paid check, no diagnosis recorded, rollout sites only", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /export const runRepairs = internalAction\(\{ args: \{ siteId: v\.id\("sites"\) \},\n  handler: async \(ctx, \{ siteId \}\): Promise<RunResult> => runDiagnosis\(ctx, siteId, true, \{ repairsOnly: true \}\) \}\);/);
  assert.match(action, /const wantsPaid = !repairsOnly && \(/, "no spend hold, so no paid part runs");
  assert.match(action, /const freeSpeedTest = Boolean\(process\.env\.PAGESPEED_API_KEY\) && !repairsOnly;/);
  assert.match(action, /if \(repairsOnly && !topicChoiceRollout\(site\.domain, site\.newSystemAt\)\) return \{ skipped: "not a rollout site" \};/);
  assert.ok(action.indexOf("if (repairsOnly) return {") < action.indexOf("await ctx.runMutation(internal.siteDiagnosis.record"), "the weekly record is never replaced by a partial one");
});
