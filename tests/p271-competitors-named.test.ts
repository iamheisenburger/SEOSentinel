// P271 (Oct 31 2026): the first production article under P268 (pentra.dev, "astro keyword research") planned "six named
// keyword tools with prices", which are pentra.dev's listed competitors. Research, told only "not its competitors", spent
// 9 searches on their pages; the competitor filter then dropped all 14 ("kept 0 (14 competitor)") and the article had no
// sources. The planner and every research pass now name the competitors, and a list never targets one as an option.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coverageSourcesRequest, optionSourcesRequest, primarySourcesRequest } from "../convex/lib/researchPasses.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const competitors = ["Jasper.ai", "Copy.ai", "Surfer SEO", "Semrush", "Ahrefs"];

test("P271 the planner knows the business's competitors and plans no coverage that names or prices them", () => {
  assert.match(pipeline, /site\.competitors\?\.length \? `COMPETITORS OF THE BUSINESS \(never named, priced or planned for\): \$\{site\.competitors\.join\(", "\)\}` : "",/);
  assert.match(pipeline, /never plan a section or coverage item that names, prices or depends on them; plan such a comparison by kind of tool or by the job it does instead/);
});

test("P271 every research pass names the competitors it must not research", () => {
  const line = /Do not research or cite the business's competitors \(the article never names them\): Jasper\.ai, Copy\.ai, Surfer SEO, Semrush, Ahrefs/;
  assert.match(coverageSourcesRequest({ label: "Astro keyword research", primaryKeyword: "astro keyword research", coverage: ["Free tools"], avoidHosts: [], competitors }).userMessage, line);
  assert.match(optionSourcesRequest({ label: "x", primaryKeyword: "best keyword tool", options: [], competitors }).userMessage, line);
  assert.match(primarySourcesRequest({ label: "x", primaryKeyword: "x", siteName: "Pentra", avoidHosts: [], competitors }).userMessage, line);
  assert.doesNotMatch(coverageSourcesRequest({ label: "x", primaryKeyword: "x", coverage: [], avoidHosts: [] }).userMessage, /competitors/, "none listed: nothing added");
  assert.match(pipeline, /: `Do not research \$\{site\.siteName \?\? site\.domain\} itself or its competitors\$\{competitorList\.length \? ` \(\$\{competitorList\.join\(", "\)\}\)` : ""\}; research the subject for its readers\.`,/);
  assert.match(pipeline, /productName: site\.siteName \?\? site\.domain, competitors: competitorList \}\)/);
});

test("P271 a list never researches a competitor as one of its options", () => {
  assert.match(pipeline, /\? listedOptions\(serpBrief\) : \[\]\)\.filter\(\(option\) => !competitorKeys\.includes\(competitorKey\(option\)\)\);/);
  // The same key for a listed competitor and an option named in the results ("Surfer SEO" vs "surferseo.com", "Semrush").
  const key = (name: string) => name.toLowerCase().replace(/^https?:\/\//, "").replace(/\.(?:com|io|co|ai|org|net)\/?$/, "").replace(/[^a-z0-9]/g, "");
  assert.equal(key("Surfer SEO"), key("surferseo.com"));
  assert.equal(key("Jasper.ai"), key("Jasper"));
  assert.match(pipeline, /const competitorKey = \(name: string\) => name\.toLowerCase\(\)\.replace\(\/\^https\?:\\\/\\\/\/, ""\)\.replace\(\/\\\.\(\?:com\|io\|co\|ai\|org\|net\)\\\/\?\$\/, ""\)\.replace\(\/\[\^a-z0-9\]\/g, ""\);/);
});
