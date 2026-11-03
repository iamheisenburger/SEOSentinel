// P287 (Nov 3 2026): batch 3's yoga list ("best scheduling software for yoga studios", 2,328 words, 9 sources) was held
// on two metadata checks alone. "...setup steps and ways to reduce no-shows." was read as an unfinished sentence (the
// verb "shows" after the hyphen), and "(2026)" in the search title was "an unsupported year". The same flaw holds any
// description ending "drop-in", "check-in" or "how-to", and the description clamp cut such a word off ("ways to reduce.").
// A hyphenated last word is a complete word, and a year the title doesn't give leaves the search title in code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampMetaDescription, clampMetaTitle, withoutUnsupportedMetaYears } from "../convex/lib/articleQuality.ts";

test("P287 a description ending in a hyphenated word is complete and kept whole", () => {
  for (const description of [
    "Compare scheduling software for yoga studios: key features, seven options with pricing, fees to watch, setup steps and ways to reduce no-shows.",
    "Book classes online, sell class packs and manage every drop-in.",
    "A plain guide to the hotel booking flow, from search to check-in.",
    "Everything a new studio owner needs, in one short how-to.",
  ]) assert.equal(clampMetaDescription(description), description);
  assert.equal(clampMetaDescription("A practical guide that explains the steps and the tools to compare with full"),
    "A practical guide that explains the steps and the tools.", "a real unfinished ending is still cut");
});

test("P287 a year the title doesn't give leaves the search title; one it gives stays", () => {
  const title = "Best Scheduling Software for Yoga Studios: Features, Pricing and How to Choose";
  assert.equal(withoutUnsupportedMetaYears("Best Scheduling Software for Yoga Studios (2026)", title), "Best Scheduling Software for Yoga Studios");
  assert.equal(withoutUnsupportedMetaYears("Best Yoga Studio Software in 2026: 7 Picks", title), "Best Yoga Studio Software: 7 Picks");
  assert.equal(withoutUnsupportedMetaYears("Yoga Booking Software - 2026", title), "Yoga Booking Software");
  assert.equal(withoutUnsupportedMetaYears("Tax Changes for 2026 Explained", "Tax Changes for 2026: What Freelancers Need to Know"), "Tax Changes for 2026 Explained");
  assert.equal(clampMetaTitle("Best Scheduling Software for Yoga Studios (2026)", 60, title), "Best Scheduling Software for Yoga Studios");
  assert.equal(clampMetaTitle("Best Scheduling Software for Yoga Studios (2026)"), "Best Scheduling Software for Yoga Studios (2026)", "unchanged without a title");
});

test("P287 every search title Pentra writes, and a held draft judged again, go through the year cleanup", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.equal((pipeline.match(/clampMetaTitle\([^;\n]*?, 60, /g) ?? []).length, 5, "the five places a search title is set pass the title");
  assert.match(pipeline, /metaTitle: withoutUnsupportedMetaYears\(article\.metaTitle, article\.title\), metaDescription: article\.metaDescription \};/);
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /editorialQualityScore: undefined, metaTitle: withoutUnsupportedMetaYears\(article\.metaTitle, article\.title\) \};/);
});
