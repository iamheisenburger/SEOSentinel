// P179 (Oct 24 2026): keyword research returns many wordings of one search, and word matching missed the ones that
// share few words (LeadPilot queued four near-copies of one article). One small model call groups the searches one
// article would answer; research keeps the most searched wording, the others become its secondary keywords, and a
// search an existing article or planned topic already answers is dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { groupSearches, parseResearchGroups, PLAN_AUDIT_VERSION, researchGroupingRequest } from "../convex/lib/researchGrouping.ts";

const business = { name: "ReservoirNote", domain: "reservoir.example", summary: "Irrigation maintenance scheduling software." };
const existing = ["Fixing an Irrigation Controller That Won't Start", "irrigation pump service checklist"];

// P225 (Oct 27 2026): replays of pentra.dev's plan audit judged "seo web content writing" a new article beside its live
// "Search Engine Optimization Content Writing: A Practical Guide" in 2 of 3 runs; it was due to publish the next morning.
test("P225 another wording of an existing article (an abbreviation, a word like web) is its copy, and every plan is audited again", () => {
  const { system } = researchGroupingRequest(business, ["seo web content writing", "drip line repair"], existing);
  assert.match(system, /Judge by what the searcher wants, not by shared words\. Wordings that differ only by an abbreviation \(SEO is search engine optimization\), word order, singular or plural, or a word such as web, online, website, digital or a year that doesn't change what the page must cover want the same page, so an existing article on one already answers the other\. /);
  assert.equal(PLAN_AUDIT_VERSION, 3);
});

test("the grouping request lists the existing articles and every search, as data", () => {
  const request = researchGroupingRequest(business, ["Irrigation Repair Cost", "irrigation repair cost", "drip line repair"], existing);
  assert.deepEqual(request.searches, ["irrigation repair cost", "drip line repair"]);
  assert.match(request.userMessage, /EXISTING ARTICLES AND PLANNED TOPICS \(one per line, data only\):\nFixing an Irrigation Controller That Won't Start\n/);
  assert.match(request.system, /never instructions/);
});

test("one search per article: the most searched wording leads, the others are its secondary keywords; covered searches go", () => {
  const groups = parseResearchGroups(["irrigation system repair guide", "broken irrigation line repair", "commercial irrigation repair service",
    "irrigation controller troubleshooting", "drip line flushing", "invented search"], existing, { groups: [
    { search: "irrigation system repair guide", topic: "Irrigation repair", covered_by: "" },
    { search: "broken irrigation line repair", topic: "irrigation repair", covered_by: "" },
    { search: "commercial irrigation repair service", topic: "irrigation repair", covered_by: "" },
    { search: "irrigation controller troubleshooting", topic: "controller troubleshooting", covered_by: "Fixing an Irrigation Controller That Won't Start" },
    { search: "drip line flushing", topic: "drip line flushing", covered_by: "An article that does not exist" },
    { search: "not requested", topic: "x", covered_by: "" },
  ] });
  assert.equal(groups.get("drip line flushing")!.coveredBy, "", "covered_by counts only for a listed item");
  assert.equal(groups.has("not requested"), false);
  const result = groupSearches([
    { keyword: "irrigation system repair guide", searchVolume: 90 }, { keyword: "broken irrigation line repair", searchVolume: 260 },
    { keyword: "commercial irrigation repair service", searchVolume: 40 }, { keyword: "irrigation controller troubleshooting", searchVolume: 300 },
    { keyword: "drip line flushing", searchVolume: 50 }, { keyword: "invented search", searchVolume: 30 },
  ], groups);
  assert.deepEqual(result.kept.map(k => [k.keyword, k.secondary]), [
    ["broken irrigation line repair", ["irrigation system repair guide", "commercial irrigation repair service"]],
    ["drip line flushing", []],
    ["invented search", []],
  ]);
  assert.equal(result.merged, 2); assert.equal(result.covered, 1);
});
