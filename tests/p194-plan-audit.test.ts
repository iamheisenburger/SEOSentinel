// P194 (Oct 25 2026): topics queued before P179 were never grouped, and word matching misses a search a live article
// already answers in other words. pentra.dev published "Auto Posting on WordPress" beside its live "Publish Blog Posts to
// WordPress or Next.js Automatically", and Google left 5 of its 6 unindexed recent articles as such copies. The daily
// sweep now reads the unpublished work against the live articles with P179's grouping call.
import test from "node:test";
import assert from "node:assert/strict";
import { auditPlannedWork, parseResearchGroups } from "../convex/lib/researchGrouping.ts";

const live = ["Publish Blog Posts to WordPress or Next.js Automatically", "SEO Writer AI: Uses, Limits, and a Review Checklist"];
const verdicts = (rows: Array<[string, string, string]>) => parseResearchGroups(rows.map(r => r[0]), live,
  { groups: rows.map(([search, topic, covered_by]) => ({ search, topic, covered_by })) });

test("a search a live article answers is dropped; a waiting article on it is held back", () => {
  const groups = verdicts([["auto posting wordpress", "wordpress auto publishing", live[0]],
    ["seo writing ai free", "free ai seo writers", live[1]], ["ai blog writing", "ai blog writing", ""]]);
  const decisions = auditPlannedWork([
    { id: "job:1", keyword: "auto posting wordpress", searchVolume: 90, waiting: true },
    { id: "topic:2", keyword: "seo writing ai free", searchVolume: 40, waiting: false },
    { id: "topic:3", keyword: "ai blog writing", searchVolume: 260, waiting: false },
  ], groups);
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(decisions), byId([
    { id: "job:1", action: "covered", by: live[0] },
    { id: "topic:2", action: "covered", by: live[1] },
    { id: "topic:3", action: "keep", secondary: [] },
  ]));
});

test("of the planned searches one article answers, the most searched stays with the others as its secondary keywords", () => {
  const groups = verdicts([["website conversion rate optimization", "website conversion", ""], ["how to increase conversion on website", "website conversion", ""],
    ["improving website conversion rates", "website conversion", ""], ["lead generation tools for small businesses", "lead generation tools", ""]]);
  const decisions = auditPlannedWork([
    { id: "topic:a", keyword: "improving website conversion rates", searchVolume: 70, waiting: false },
    { id: "topic:b", keyword: "website conversion rate optimization", searchVolume: 320, waiting: false },
    { id: "topic:c", keyword: "how to increase conversion on website", searchVolume: 320, waiting: false },
    { id: "topic:d", keyword: "lead generation tools for small businesses", searchVolume: 30, waiting: false },
  ], groups);
  const keep = decisions.filter(d => d.action === "keep");
  assert.deepEqual(keep.map(d => d.id).sort(), ["topic:b", "topic:d"], "the most searched (the earlier one on a tie) and the distinct search stay");
  assert.deepEqual(keep.find(d => d.id === "topic:b"), { id: "topic:b", action: "keep",
    secondary: ["how to increase conversion on website", "improving website conversion rates"] });
  assert.deepEqual(decisions.filter(d => d.action === "merged").map(d => d.id).sort(), ["topic:a", "topic:c"]);
  assert.ok(decisions.filter(d => d.action === "merged").every(d => d.action === "merged" && d.into === "website conversion rate optimization"));
});

test("a waiting article keeps its group; a planned search with the same answer joins it, a second waiting one is held back", () => {
  const groups = verdicts([["lead scoring template", "lead scoring template", ""], ["lead scoring templates free", "lead scoring template", ""],
    ["lead scoring sheet", "lead scoring template", ""]]);
  const decisions = auditPlannedWork([
    { id: "topic:x", keyword: "lead scoring templates free", searchVolume: 900, waiting: false },
    { id: "job:y", keyword: "lead scoring template", searchVolume: 30, waiting: true },
    { id: "job:z", keyword: "lead scoring sheet", searchVolume: 10, waiting: true },
  ], groups);
  assert.deepEqual(decisions.find(d => d.id === "job:y"), { id: "job:y", action: "keep", secondary: ["lead scoring templates free"] });
  // P215: what they repeat is written and waiting to publish, not a live page or a planned topic.
  assert.deepEqual(decisions.find(d => d.id === "topic:x"), { id: "topic:x", action: "merged", into: "lead scoring template", waitingKeeper: true });
  assert.deepEqual(decisions.find(d => d.id === "job:z"), { id: "job:z", action: "covered", by: "lead scoring template", waitingKeeper: true });
});

test("a search the model gave no verdict for, or a covered_by outside the live list, changes nothing", () => {
  const groups = parseResearchGroups(["chat widget"], live, { groups: [{ search: "chat widget", topic: "chat widget", covered_by: "An article that is not live" }] });
  assert.deepEqual(auditPlannedWork([{ id: "topic:1", keyword: "chat widget", searchVolume: 10, waiting: false },
    { id: "topic:2", keyword: "sales detail", searchVolume: 10, waiting: false }], groups),
    [{ id: "topic:1", action: "keep", secondary: [] }], "an invented coverage is ignored; an unanswered search is left as it is");
});
