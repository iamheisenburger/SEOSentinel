// Pentra Answers quality (Nov 8 2026, Cowork's end-to-end test of a Boise dentist): position counted among every business
// an answer names; names in the question never counted; questions never built around a competitor; "winnable" selective;
// the site read and the page writer read the business's own pages (a host's hidden bot check aside); pages never send a
// buyer to a competitor; sources numbered 1, 2, 3; competitor names typed as a domain become their real names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeAnswer, questionOpportunity, ANSWERS_WINNABLE_SCORE, parseNamedBusinesses, namesCompetitor } from "../convex/lib/answerEngine.ts";
import { challengePage, profileLinks, relevantLinks, siteLinks } from "../convex/lib/siteLinks.ts";
import { checkDraftPage, finalizeDraftPage, pageSource, parseDraftPage } from "../convex/lib/answerPages.ts";
import { botWall } from "../convex/lib/missedSearches.ts";
import { nameFromDomainOnly, properCompetitorName } from "../convex/lib/answersAccess.ts";

const dentist = { name: "Osterkamp Family Dental", domain: "osterkampfamilydental.example" };
const rivals = [{ name: "Boise Family Dental Care", domain: "boisefamilydental.example" }, { name: "Mallard Family Dental Center", domain: "mallard.example" }];

test("position is the business's place among every business the answer names, and names in the question never count", () => {
  const text = "Top Invisalign providers in Boise: 1. Smile Studio 2. Boise Family Dental Care 3. Ridge Dental 4. Elm Ortho 5. Bright Smiles 6. Osterkamp Family Dental.";
  const listed = ["Smile Studio", "Boise Family Dental Care", "Ridge Dental", "Elm Ortho", "Bright Smiles", "Osterkamp Family Dental"];
  const judged = judgeAnswer({ text, sources: [] }, dentist, rivals, { question: "Who offers Invisalign in Boise?", namedOrder: listed });
  assert.equal(judged.position, 6, "6th of 6, never '1 of 1' among confirmed names");
  assert.equal(judged.brandsNamed, 6);
  const versus = judgeAnswer({ text: "Boise Family Dental Care and Mallard Family Dental Center both offer cleanings.", sources: [] }, dentist, rivals,
    { question: "Boise Family Dental Care vs Mallard Family Dental Center: which is better?" });
  assert.deepEqual(versus.competitorsNamed, [], "competitors named in the question are the question echoed, not recommendations");
  assert.equal(namesCompetitor("Is Mallard Family Dental Center good for kids?", rivals), true);
  assert.deepEqual(parseNamedBusinesses({ businesses: ["Smile Studio", " smile studio ", "", "Ridge Dental"] }), ["Smile Studio", "Ridge Dental"]);
});

test("winnable is selective: not being named is not by itself an opening", () => {
  const answered = (sources: Array<{ domain: string; title?: string }>, competitorsNamed: string[] = []) =>
    ({ status: "answered", named: false, cited: false, competitorsNamed, sources: sources.map((s) => ({ url: `https://${s.domain}/x`, own: false, ...s })) });
  const crowded = questionOpportunity("What is the best dentist in Boise for families?", [
    answered([{ domain: "a.example", title: "Best dentist in Boise for families" }, { domain: "b.example", title: "Best Boise family dentist" }]),
    answered([{ domain: "c.example", title: "Best dentists Boise families" }, { domain: "d.example", title: "Boise family dentist best" }])]);
  assert.equal(crowded.status, "monitoring", "four pages already answer it");
  const opening = questionOpportunity("Which Boise dentist treats sleep apnea with an oral appliance?", [
    answered([{ domain: "small.example", title: "Sleep apnea" }], ["Boise Family Dental Care"]), answered([], ["Mallard"])]);
  assert.ok(opening.score >= ANSWERS_WINNABLE_SCORE && opening.status === "winnable", "unnamed, competitors recommended, no page answers it");
});

test("a business's own pages are found from its homepage links, and a host's hidden bot check is recognized", () => {
  const html = `<nav><a href="/new-patients/">New Patients</a><a href="https://osterkampfamilydental.example/dental-services/sleep-apnea/">Sleep Apnea</a>
    <a href="/dental-services/">Dental Services</a><a href="/about-us/">Dr. Osterkamp</a><a href="https://other.example/x">Elsewhere</a>
    <a href="/files/menu.pdf">Menu</a><a href="#top">Top</a></nav>`;
  const links = siteLinks(html, "osterkampfamilydental.example");
  assert.deepEqual(links.map((l) => l.url), ["https://osterkampfamilydental.example/new-patients", "https://osterkampfamilydental.example/dental-services/sleep-apnea",
    "https://osterkampfamilydental.example/dental-services", "https://osterkampfamilydental.example/about-us"]);
  assert.deepEqual(relevantLinks(links, "Is there a Boise dentist who treats sleep apnea without a CPAP?").map((l) => l.text), ["Sleep Apnea"]);
  assert.equal(profileLinks(links)[0].text, "Sleep Apnea", "services pages first");
  const sgcaptcha = `<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head><body></body></html>`;
  assert.equal(challengePage(sgcaptcha), true);
  assert.equal(botWall(sgcaptcha), true);
});

test("a page never sends a buyer to a competitor, its sources are numbered 1, 2, 3, and a page the business can't answer isn't written", () => {
  const sources = [1, 2, 3].map((n) => pageSource(n, `https://s${n}.example/a`, `Source ${n}`, `Sleep apnea affects many adults; 26% of adults have it. `.repeat(12), 1));
  const body = ["Osterkamp Family Dental treats sleep apnea with oral appliances that keep the airway open.", "",
    "## How common is it?", "", "About 26% of adults have it [3]. Snoring is a common sign [1].", "",
    "## How Osterkamp Family Dental handles this", "", "Osterkamp Family Dental fits a custom oral appliance.", "",
    ...Array.from({ length: 60 }, (_, i) => `Practical point ${i} for patients.`)].join("\n");
  const draft = parseDraftPage({ title: "Sleep apnea treatment in Boise", metaDescription: "Oral appliances.", markdown: body, facts: [], fit: "strong" }, sources)!;
  const final = finalizeDraftPage(draft, sources);
  assert.match(final.page.markdown, /26% of adults have it \[1\]\. Snoring is a common sign \[2\]\./, "first cited is [1], no gap");
  assert.match(final.page.markdown, /## Sources\n\n1\. \[Source 3\]\(https:\/\/s3\.example\/a\)\n2\. \[Source 1\]\(https:\/\/s1\.example\/a\)$/);
  assert.deepEqual(final.sources.map((s) => s.n), [1, 2]);
  const evidence = "Name: Osterkamp Family Dental\nDomain: osterkampfamilydental.example";
  const toRival = { ...draft, markdown: `${draft.markdown}\n\nFor another option, see [Mallard](https://mallard.example/reviews).` };
  const blocking = checkDraftPage(toRival, { businessName: dentist.name, businessDomain: dentist.domain, sources, productEvidence: evidence, competitors: rivals }).blocking;
  assert.ok(blocking.some((b) => /links to mallard\.example, a competitor/.test(b)));
  const naming = { ...draft, markdown: `${draft.markdown}\n\nBoise Family Dental Care also offers this.` };
  assert.ok(checkDraftPage(naming, { businessName: dentist.name, businessDomain: dentist.domain, sources, productEvidence: evidence, competitors: rivals }).blocking
    .some((b) => /names Boise Family Dental Care, a competitor/.test(b)));
  assert.equal(parseDraftPage({ title: "t", metaDescription: "m", markdown: "x", facts: [], fit: "none", fitReason: "No implants page" }, sources)!.fit, "none");
});

test("a competitor typed as a run-together domain gets its real name; short brand names stay", () => {
  assert.equal(nameFromDomainOnly("Boiseriverviewdental", "boiseriverviewdental.com"), true);
  assert.equal(nameFromDomainOnly("Apollo", "apollo.io"), false, "a short brand is its name already");
  assert.equal(properCompetitorName("Boise Riverview Dental", "boiseriverviewdental.com"), "Boise Riverview Dental");
  assert.equal(properCompetitorName("Apollo.io", "apollo.io"), null);
  assert.equal(properCompetitorName("Home", "boiseriverviewdental.com"), null);
});
