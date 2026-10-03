import assert from "node:assert/strict";
import test from "node:test";
import { researchSeedsForRound, searchLikePhrase, searchSeedLength } from "../convex/lib/researchSeeds.ts";

// Clauses a profile sentence such as "AI agent to engage visitors 24/7 outside
// business hours; lost leads (visitors who don't immediately fill out forms)"
// splits into. None of them is something people search for.
const FRAGMENTS = ["to engage visitors 24", "engage visitors 24", "7 outside business hours", "of context about visitor intent",
  "lost leads visitors who don t", "don t immediately fill out forms", "manual lead qualification consuming sales team"];

test("profile fragments are not used as research seeds; search-like phrases are", () => {
  for (const fragment of FRAGMENTS) assert.equal(searchLikePhrase(fragment), false, fragment);
  for (const phrase of ["booking link integration", "sales outreach", "lead qualification chatbot", "how to qualify leads", "plan a garden"]) {
    assert.equal(searchLikePhrase(phrase), true, phrase);
  }
  assert.equal(searchSeedLength("lead scoring"), true);
  assert.equal(searchSeedLength("crm"), false);
  assert.equal(searchSeedLength("one two three four five six seven"), false);
});

test("research seeds lead with real searches, mix in the owner's phrases and use profile text only to fill", () => {
  const demand = Array.from({ length: 30 }, (_, i) => `searched keyword ${i}`);
  const owner = Array.from({ length: 8 }, (_, i) => `owner phrase ${i}`);
  const profile = ["profile phrase one", "profile phrase two"];
  const seeds = researchSeedsForRound({ demand, owner, profile, round: 1 });
  assert.equal(seeds.length, 15);
  assert.deepEqual(seeds.slice(0, 6), ["searched keyword 0", "searched keyword 1", "owner phrase 0", "searched keyword 2", "searched keyword 3", "owner phrase 1"]);
  assert.equal(seeds.filter(s => s.startsWith("searched")).length, 10);
  assert.equal(seeds.filter(s => s.startsWith("owner")).length, 5);
  assert.ok(!seeds.some(s => s.startsWith("profile")), "profile text is not needed while real searches and owner phrases fill the run");
  // A new site has no search data yet: the owner's phrases, then profile phrases.
  const fresh = researchSeedsForRound({ demand: [], owner: owner.slice(0, 3), profile, round: 1 });
  assert.deepEqual(fresh, ["owner phrase 0", "owner phrase 1", "owner phrase 2", "profile phrase one", "profile phrase two"]);
});

test("each research run starts further along the real searches, so seeds are not repeated run after run", () => {
  const demand = Array.from({ length: 30 }, (_, i) => `searched keyword ${i}`);
  const owner = Array.from({ length: 10 }, (_, i) => `owner phrase ${i}`);
  const runs = [1, 2, 3].map(round => researchSeedsForRound({ demand, owner, profile: [], round }).filter(s => s.startsWith("searched")));
  assert.deepEqual(new Set(runs.flat()).size, 30, "three runs cover every real search once");
  const ownerRuns = [1, 2].map(round => researchSeedsForRound({ demand, owner, profile: [], round }).filter(s => s.startsWith("owner")));
  assert.equal(new Set(ownerRuns.flat()).size, 10);
  // Duplicates across sources are asked once.
  const merged = researchSeedsForRound({ demand: ["Lead Scoring", "lead scoring"], owner: ["lead scoring", "booking link integration"], profile: [], round: 1 });
  assert.deepEqual(merged, ["lead scoring", "booking link integration"]);
});
