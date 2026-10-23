import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// P168 (Oct 23 2026): told to leave out the company behind a cited help page (P162), a LeadPilot draft wrote
// "That documentation says a lead is ..." and "The same documentation says ...": a reference readers cannot follow.
test("an unnamed documentation reference is caught as pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "That documentation says a lead is a person who has indicated an interest in your products or services.",
    "The same documentation says that instead of qualifying a lead, you might remove it by archiving it.",
    "The lifecycle documentation says that instead of qualifying a lead, you might archive it.",
    "A help article explains how to convert a qualified lead.",
    "One vendor's guide recommends scoring every inbound lead.",
    "The CRM documentation notes that a converted lead keeps its history.",
  ]) {
    assert.ok(readerVisibleDefects(sentence).some((defect) => /pipeline text/.test(defect)), sentence);
  }
});

test("named or advisory documentation prose is not pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "Check what the documentation says about field limits before you change the form.",
    "Google's documentation says to use one canonical URL per page [2].",
    "The Search Central documentation explains how canonical tags are chosen [1].",
    "Your CRM's documentation lists the fields a lead record needs.",
    "Keep the documentation for your scoring model next to the model itself.",
    // P169: LeadPilot's live Keap article, after naming Keap's help documentation.
    "The documentation describes how Keap adds and subtracts points for each action.",
    "The Keap documentation states that scores update when a contact changes.",
  ]) {
    assert.deepEqual(readerVisibleDefects(sentence), [], sentence);
  }
});

test("the writer states a documented fact itself instead of pointing at the documentation", () => {
  const writer = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(writer, /state the fact itself as plain guidance with its citation and leave the company out \(never "that documentation says"/);
});
