// P380 (Nov 7 2026), dawnlist.io: a new domain (authority 0) missed its first Autopilot slot with 12 topics planned. Its
// researched searches failed the page-one check (page one needs results within 10 points of the site's authority), and its
// AI-assistant buyer questions waited for the same check, so every pass ended "content_inputs_exhausted". With nothing
// winnable, Autopilot now writes the buyer questions Pentra asks ChatGPT, Gemini and Google AI Mode; winnable searches
// still come first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_QUESTION_TOPIC_NOTES, writableTopics } from "../convex/lib/topicVerdict.ts";

const now = Date.UTC(2026, 10, 7, 7);
const kept = { eligible: true };
const unwinnable = { version: 1, checkedAt: now - 3_600_000, rankable: false, reason: "page one is held by sites far stronger than this one",
  siteAuthority: 0, reachable: 0, measured: 7, results: 7, medianAuthority: 47 };
const winnable = { ...unwinnable, rankable: true, reachable: 3, reason: "3 of 8 reachable" };
type T = { id: string; notes?: string; buyerFit?: { eligible: boolean }; pageOne?: typeof unwinnable; ownerChosenAt?: number;
  groupBrake?: { braked: boolean; checkedAt: number } };
const none = (_: T) => false;

const dawnlist: T[] = [
  { id: "agency lead generation", buyerFit: kept, pageOne: unwinnable },
  { id: "who is dawnlist for", buyerFit: kept, notes: "A customer question the owner confirmed. Search forecasts are unknown." },
  { id: "how do i find new clients for my web design agency", buyerFit: kept, notes: AI_QUESTION_TOPIC_NOTES },
  { id: "how do i find the owner's email address for a local business", buyerFit: kept, notes: AI_QUESTION_TOPIC_NOTES, pageOne: unwinnable },
];

test("a new site with nothing winnable writes its AI-assistant buyer questions, not nothing", () => {
  assert.deepEqual(writableTopics(dawnlist, now, none).map((t) => t.id),
    ["how do i find new clients for my web design agency", "how do i find the owner's email address for a local business"]);
});

test("winnable searches and the owner's own searches still come first; the fallback never mixes in", () => {
  const withWin = [...dawnlist, { id: "local leads for business", buyerFit: kept, pageOne: winnable }];
  assert.deepEqual(writableTopics(withWin, now, none).map((t) => t.id), ["local leads for business"]);
  const owner = [...dawnlist, { id: "owner pick", ownerChosenAt: now }];
  assert.deepEqual(writableTopics(owner, now, (t) => t.ownerChosenAt !== undefined).map((t) => t.id), ["owner pick"]);
});

test("the fallback keeps buyer fit and the brake", () => {
  const held = [{ id: "q", notes: AI_QUESTION_TOPIC_NOTES, buyerFit: { eligible: false } },
    { id: "b", notes: AI_QUESTION_TOPIC_NOTES, buyerFit: kept, groupBrake: { braked: true, checkedAt: now - 3_600_000 } }];
  assert.deepEqual(writableTopics(held, now, none), []);
});

test("Autopilot and the dashboard's Coming up next make the same choice", () => {
  assert.match(readFileSync("convex/contentWork.ts", "utf8"), /const planned = phaseTwo \? writableTopics\(candidates, now, ownerChosen\) : \[\.\.\.candidates\];/);
  assert.match(readFileSync("src/components/content-work-overview.tsx", "utf8"), /order\?\.phaseTwo \? writableTopics\(shown, now, t => t\.ownerChosenAt !== undefined\) : shown/);
  assert.match(readFileSync("convex/contentWork.ts", "utf8"), /notes: AI_QUESTION_TOPIC_NOTES, buyerFit: \{ eligible: true/, "the topics carry the note the rule reads");
});
