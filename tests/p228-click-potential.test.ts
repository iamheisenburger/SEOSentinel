// P228 (Oct 27 2026): LeadPilot ranked in Google's top 20 for 28 searches in the 28 days to Oct 24 (772 impressions)
// and got 1 click. Its titles matched the searches; most were definitions Google answers on the results page. Autopilot
// now writes and refreshes for searches people open a page for first; definitions wait. Nothing is dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { ANSWERED_ON_GOOGLE_WEIGHT, clickPotential } from "../convex/lib/clickPotential.ts";
import { refreshOpportunities, refreshOpportunityValue } from "../convex/lib/articleRefresh.ts";
import { compareTopics } from "../convex/lib/topicOrder.ts";

test("P228 a definition or job-description search is worth less than one people open a page for", () => {
  for (const search of ["what is a lead sales associate", "associate lead meaning", "What does a sales consultant do?",
    "lead sales associate salary", "define lead qualification", "sales associate responsibilities", "what's lead scoring"]) {
    assert.equal(clickPotential(search), ANSWERED_ON_GOOGLE_WEIGHT, search);
  }
  for (const search of ["lead scoring template", "eloqua lead scoring", "lead scoring in marketo", "hire sales consultants",
    "what is the best way to automate lead generation", "what are the best ai sales tools", "meaningful engagement metrics",
    "lead definition template", "", "qué es lead scoring"]) {
    assert.equal(clickPotential(search), 1, search);
  }
});

test("P228 a refresh goes to the page ranking for a search people click through on first", () => {
  // LeadPilot's numbers: the definition sat higher and was shown more, but nobody clicked.
  const definition = { query: "what is a lead sales associate", impressions: 89, position: 5.9 };
  const clickable = { query: "eloqua lead scoring", impressions: 40, position: 8.5 };
  assert.ok(refreshOpportunityValue(clickable) > refreshOpportunityValue(definition));
  const page = "https://leadpilot.example/blog/lead-roles";
  const rows = [{ page, ...definition }, { page, ...clickable }];
  assert.deepEqual(refreshOpportunities(rows, page).map(o => o.query), ["eloqua lead scoring", "what is a lead sales associate"],
    "both stay eligible; the clickable search leads");
});

test("P228 Autopilot writes a search people open a page for before a definition of the same reach", () => {
  const definition = { primaryKeyword: "what is lead scoring", searchVolume: 300, keywordDifficulty: 8, keywordDifficultyMeasured: true, priority: 90 };
  const clickable = { primaryKeyword: "lead scoring template", searchVolume: 300, keywordDifficulty: 8, keywordDifficultyMeasured: true, priority: 10 };
  for (const authority of [2, null]) {
    const ordered = [definition, clickable].sort(compareTopics({ difficultyCeiling: 30, authority }));
    assert.deepEqual(ordered.map(t => t.primaryKeyword), ["lead scoring template", "what is lead scoring"], `authority ${authority}`);
  }
  // A definition the site can win much more easily still comes first: the order weighs, it never drops.
  const easyDefinition = { ...definition, keywordDifficulty: 0, searchVolume: 2000 };
  const hardClickable = { ...clickable, keywordDifficulty: 29, searchVolume: 20 };
  assert.equal([hardClickable, easyDefinition].sort(compareTopics({ difficultyCeiling: 30, authority: null }))[0], easyDefinition);
});
