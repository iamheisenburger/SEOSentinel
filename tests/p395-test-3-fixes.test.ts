// P395 (Nov 9 2026): Cowork's end-to-end test 3 (Boise dentist 8/10, Fathom Analytics 9/10). General causes, each pinned
// here on Cowork's cases AND on cases from other niches and countries (a UK plumber, a French bakery, a CRM question,
// LeadPilot's own drafts), so no fix only fits the example it came from:
// the setup read named competitors from the model's memory, which knows no Boise dentists, so a local owner's snapshot
// counted nobody named instead of them; a competitor typed as an address kept its run-together name when its host turned
// Pentra's servers away (boiseriverviewdental.com sits behind Sucuri; its title is "Riverview Dental"); "Nth of M" counted
// whatever a model listed in each answer, so Google Analytics was counted in one answer and skipped in another to the same
// question; every "Winnable" reason read the same template; every draft repeated the same blocks (the business's
// description, its prices, "when is another option a better fit", the sign-up link); the read never saw the services the
// site's menu lists ("Sleep Apnea").
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPlaceName, localCompetitors, mapsQuery, mergeCompetitors, nameFromMaps, pageTitle, parseMapsPlaces, siteNameFromHtml } from "../convex/lib/localCompetitors.ts";
import { challengeText } from "../convex/lib/pageText.ts";
import { parseSetupRead, setupReadRequest, sitePageNames } from "../convex/lib/answersSetup.ts";
import { judgeAnswer, placeNamed, questionOpportunity, recountPlacement } from "../convex/lib/answerEngine.ts";
import { answerPageRequest, dropEmptySections, editedDraft, repeatedContent, repeatedIssues, type DraftPage } from "../convex/lib/answerPages.ts";
import { corePipelineFixture, type Fields } from "./helpers/core-pipeline-fixture.ts";

const json = (body: unknown, cost?: number, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json", ...(cost !== undefined ? { "X-Treg-Cost-Micro": String(cost) } : {}) } });

// treg's Google Maps reply for "family dentist in Boise, ID" (Nov 9 2026, measured live; rows trimmed to the fields used,
// a 4-review listing and two listings without a site of their own added).
const row = (name: string, website: string | undefined, reviews: number, rating = 4.9) => ({ name, ...(website ? { website } : {}), review_count: reviews, rating,
  category: "Dentist", url: "https://www.google.com/maps/place/?q=place_id:x" });
const BOISE_MAPS = { output: { places: [
  row("Boise Family Dental Care", "https://www.boisedentist.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb", 573, 4.8),
  row("Tiny New Dental", "https://tinynewdental.example/", 4),
  row("Tree City Family Dental", "https://treecitydental.com/?utm_source=gmb&utm_medium=organic", 643, 5),
  row("Bird Family Dental", "https://www.birdfamilydental.com/", 371),
  row("Idaho Family Dental-Dr. Anna Budolfson, DMD", "https://idahofamilydental.com/", 21, 4),
  row("Facebook Only Dental", "https://www.facebook.com/facebookonlydental", 80),
  row("No Site Dental", undefined, 90),
  row("Lamb Family Dental", "https://dentalboise.com/", 525),
  row("Boise Family Dental Care", "https://boisedentist.com/?utm_source=google", 621),
  row("Osterkamp Family Dental", "http://osterkampfamilydental.com/", 373),
  row("Blaisdell Family Dentistry", "https://www.blaisdellfamilydentistry.com/?utm_source=GoogleBusinessProfile", 278),
], count: 11 }, _treg: { served_by: "crawl4ai.google.serp.maps", charged_micro: 150 } };
// treg's Google Maps reply for "boiseriverviewdental.com" (measured live): the practice's two locations, one website.
const RIVERVIEW_MAPS = { output: { places: [row("Riverview Dental", "http://www.boiseriverviewdental.com/", 324), row("Riverview Dental", "http://www.boiseriverviewdental.com/", 69, 4.7)], count: 2 } };
// boiseriverviewdental.com's own head, as a plain fetch receives it (Nov 9 2026).
const RIVERVIEW_HEAD = `<!DOCTYPE html><html lang="en-US"><head><meta charset="UTF-8" /><meta name="description" content="" /><title>Riverview Dental</title></head><body><p>Our goal here at Boise Riverview Dental is to create a comfortable, relaxing, dental experience.</p></body></html>`;
// What Sucuri's firewall shows a cloud server instead.
const SUCURI_BLOCK = `<!DOCTYPE html><html><head><title>Sucuri WebSite Firewall - Access Denied</title></head><body><h1>Access Denied - Sucuri Website Firewall</h1><p>If you are the site owner, please contact cloudproxy@sucuri.net</p></body></html>`;

test("a local business's competitors are the businesses Google Maps lists for what its buyers search, never itself", () => {
  const places = parseMapsPlaces(BOISE_MAPS);
  assert.deepEqual(places.filter((p) => /Facebook Only|No Site/.test(p.name)).map((p) => [p.name, p.domain ?? null]), [["Facebook Only Dental", null], ["No Site Dental", null]],
    "a business without a site of its own is listed by name, never given a platform's address");
  assert.equal(places.find((p) => p.name.startsWith("Boise Family"))?.domain, "boisedentist.com", "tracking parameters and www dropped");
  assert.deepEqual(localCompetitors(places, { name: "Osterkamp Family Dental", domain: "osterkampfamilydental.com" }), [
    { name: "Boise Family Dental Care", domain: "boisedentist.com" }, { name: "Tree City Family Dental", domain: "treecitydental.com" },
    { name: "Bird Family Dental", domain: "birdfamilydental.com" }, { name: "Idaho Family Dental-Dr. Anna Budolfson, DMD", domain: "idahofamilydental.com" },
    { name: "Facebook Only Dental" },
  ], "Google's order, the business itself and a second location left out, a listing almost nobody reviewed skipped, names as listed");
  assert.equal(cleanPlaceName("Riverview Dental | Boise"), "Riverview Dental", "only a spaced separator cuts a name");
  assert.equal(cleanPlaceName("Scott E. Hayhurst Family and Cosmetic Dentistry"), "Scott E. Hayhurst Family and Cosmetic Dentistry");
  assert.equal(mapsQuery("family dentist", "Boise, ID"), "family dentist Boise, ID");
  assert.equal(mapsQuery("", "Boise, ID"), null);
  assert.deepEqual(mergeCompetitors([{ name: "Bird Family Dental", domain: "birdfamilydental.com" }],
    [{ name: "Bird Family Dental", domain: "birdfamilydental.com" }, { name: "Aspen Dental", domain: "aspendental.com" }]),
  [{ name: "Bird Family Dental", domain: "birdfamilydental.com" }, { name: "Aspen Dental", domain: "aspendental.com" }]);
});

test("the same rules in other niches and countries: a UK plumber and a French bakery, profiles on shared platforms never taken for a site", () => {
  const leeds = { output: { places: [
    row("Brightside Plumbing & Heating", "https://www.brightsideplumbing.example.co.uk/", 212),
    row("Pipeline Plumbers Leeds", "https://www.facebook.com/pipelineplumbersleeds", 140),
    row("Aire Valley Heating", "https://linktr.ee/airevalleyheating", 95),
    row("Kirkstall Boiler Care", "https://kirkstallboilers.example.co.uk/?utm_source=gbp", 61),
    row("Two Names Plumbing", "https://sharedsite.example.co.uk/", 50), row("Another Name Heating", "https://sharedsite.example.co.uk/", 44),
    row("Headingley Plumbing Co", "https://headingleyplumbing.example.co.uk/", 33),
  ] } };
  assert.deepEqual(localCompetitors(parseMapsPlaces(leeds), { name: "Leeds Plumbing Ltd", domain: "leedsplumbing.example.co.uk" }).map((c) => [c.name, c.domain ?? null]), [
    ["Brightside Plumbing & Heating", "brightsideplumbing.example.co.uk"], ["Pipeline Plumbers Leeds", null], ["Aire Valley Heating", null],
    ["Kirkstall Boiler Care", "kirkstallboilers.example.co.uk"], ["Two Names Plumbing", null],
  ], "kept in Google's order; a social or link-page profile, or an address two differently named listings share, gives no address");
  const lyon = { output: { places: [
    row("Boulangerie Saint-Éloi", "https://www.boulangeriesainteloi.example.fr/", 410), row("Maison Pain d’Épices", "https://painepices.example.fr/", 120),
    row("Le Fournil de Lyon", "https://www.instagram.com/fournildelyon/", 300), row("Au Bon Pain Lyonnais", "https://aubonpain.example.fr/", 88),
  ] } };
  assert.deepEqual(localCompetitors(parseMapsPlaces(lyon), { name: "Boulangerie Croix-Rousse", domain: "boulangerie-croixrousse.example.fr" }).map((c) => c.domain ?? c.name),
    ["boulangeriesainteloi.example.fr", "painepices.example.fr", "Le Fournil de Lyon", "aubonpain.example.fr"]);
  assert.equal(mapsQuery("boulangerie", "Lyon"), "boulangerie Lyon", "no English preposition in a French search");
  // A city name several countries share returns another country's businesses unless the search names the country
  // (measured Nov 9: "dentist Bristol" gave American practices; providers ignore a country filter).
  assert.equal(mapsQuery("dentist", "Bristol", "GB"), "dentist Bristol, United Kingdom");
  assert.equal(mapsQuery("accountant", "Perth", "AU"), "accountant Perth, Australia");
  assert.equal(mapsQuery("plumber", "Brisbane, Australia", "AU"), "plumber Brisbane, Australia", "a place that names its country is left as it is");
  assert.equal(mapsQuery("restaurante", "Guadalajara", "MX"), "restaurante Guadalajara, Mexico");
});

test("a competitor typed as an address gets the name its own site or Maps listing uses, never a run-together one", () => {
  assert.equal(siteNameFromHtml(RIVERVIEW_HEAD, "boiseriverviewdental.com"), "Riverview Dental");
  assert.equal(siteNameFromHtml("<title>Home | Riverview Dental</title>", "boiseriverviewdental.com"), "Riverview Dental");
  assert.equal(siteNameFromHtml("<title>Family Dentist in Boise, ID - Riverview Dental</title>", "boiseriverviewdental.com"), "Riverview Dental");
  assert.equal(siteNameFromHtml(`<meta property="og:site_name" content="Gentle Family Dentistry" /><title>Dr. Rita Harding</title>`, "drritaharding.com"),
    "Dr. Rita Harding", "the part matching the address wins over a declared name");
  // A declared name that doesn't match the address can be a parent group's or a platform's: never taken (the business's
  // Maps listing is asked instead). Measured Nov 9 on a small German firm whose site declares its group's name.
  assert.equal(siteNameFromHtml(`<meta property="og:site_name" content="Gentle Family Dentistry" /><title>Welcome</title>`, "drritaharding.com"), null);
  assert.equal(siteNameFromHtml(`<meta property="og:site_name" content="Beispiel Unternehmensgruppe" /><title>Steuerberatung in Köln – Beispiel Unternehmensgruppe</title>`,
    "steuerberaterin-muster.example.de"), null);
  assert.equal(pageTitle("<title>Best Orthodontist in Pune | Braces &amp; Aligners</title>"), "Best Orthodontist in Pune | Braces & Aligners");
  assert.equal(siteNameFromHtml(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Home"},{"@type":"Dentist","name":"Bird Family Dental"}]}</script><title>Smile brighter today</title>`,
    "birdfamilydental.com"), "Bird Family Dental");
  assert.equal(siteNameFromHtml("<title>Smile brighter today</title>", "birdfamilydental.com"), null, "a slogan is never a name");
  // Other niches and countries: accents dropped to compare with the address, a UK trade, a software company's data.
  assert.equal(siteNameFromHtml("<title>Boulangerie Saint-Éloi – Pain au levain à Lyon</title>", "boulangeriesainteloi.example.fr"), "Boulangerie Saint-Éloi");
  assert.equal(siteNameFromHtml("<title>Home | Brightside Plumbing &amp; Heating</title>", "brightsideplumbing.example.co.uk"), "Brightside Plumbing & Heating");
  assert.equal(siteNameFromHtml(`<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Pipedrive CRM","publisher":{"@type":"Organization","name":"Pipedrive"}}</script><title>The CRM for sales teams</title>`,
    "pipedrive.example.com"), "Pipedrive CRM");
  assert.equal(nameFromMaps(parseMapsPlaces(RIVERVIEW_MAPS), "boiseriverviewdental.com"), "Riverview Dental");
  assert.equal(nameFromMaps(parseMapsPlaces(BOISE_MAPS), "boiseriverviewdental.com"), null);
  assert.equal(challengeText(SUCURI_BLOCK), true, "Sucuri's firewall page is never read as the site");
});

test("the setup read sees the site's own pages (its menu's \"Sleep Apnea\") and says what a buyer searches on Maps", () => {
  const names = sitePageNames([
    { url: "https://osterkampfamilydental.com/dental-services/sleep-apnea", text: "Sleep Apnea" },
    { url: "https://osterkampfamilydental.com/dental-services/sedation-dentistry", text: "" },
    { url: "https://osterkampfamilydental.com/privacy-policy", text: "Privacy Policy" },
    { url: "https://osterkampfamilydental.com/team", text: "Learn more" },
    { url: "https://osterkampfamilydental.com/dental-services/sleep-apnea/faq", text: "Sleep Apnea" },
  ]);
  assert.deepEqual(names, ["Sleep Apnea", "sedation dentistry", "Privacy Policy", "Learn more"], "every page's name, once; the read ignores what says nothing");
  assert.deepEqual(sitePageNames([{ url: "https://boulangerie.example.fr/nos-pains/pain-au-levain/", text: "" }, { url: "https://boulangerie.example.fr/commandes/", text: "Commandes" }]),
    ["pain au levain", "Commandes"], "a French site's page names as they are");
  const request = setupReadRequest({ domain: "osterkampfamilydental.com", title: "Boise Dentist", description: "", headings: [], text: "We care for families in Boise.",
    nameHint: "", sitePages: names });
  assert.match(request.userMessage, /Pages on the site \(its menu and sitemap\): Sleep Apnea \| sedation dentistry \| Privacy Policy \| Learn more/);
  assert.match(request.system, /a service the site gives its own page \(listed under "Pages on the site"\) is one of them/);
  assert.match(request.system, /`searchTerm`: for a local business, the words a buyer types into a map search to find this kind of business, in the page's language, without the place; else empty\./);
  assert.doesNotMatch(request.system, /dentist|plumber|restaurant/i, "no example businesses in the instructions");
  assert.ok(request.inputSchema.required.includes("searchTerm"));
  const read = parseSetupRead({ name: "Osterkamp Family Dental", sells: "Family and restorative dentistry in Boise.", buyers: "Families", country: "US", local: true,
    location: "Boise, ID", searchTerm: " family  dentist ", competitors: [],
    offerings: ["Implants", "Invisalign", "Same-day crowns", "Sleep apnea", "Sedation", "Pediatric", "Cosmetic", "Emergency", "Root canals", "Dentures", "Eleventh"] },
  "osterkampfamilydental.com");
  assert.equal(read?.searchTerm, "family dentist");
  assert.equal(read?.offerings.length, 10, "ten offerings, as the setup screen holds");
  assert.ok(read?.offerings.includes("Sleep apnea"));
});

const FATHOM = { name: "Fathom Analytics", domain: "usefathom.com" };
const RIVALS = [{ name: "Plausible", domain: "plausible.io" }];

test("\"Nth of M\" counts the same businesses in every answer to a question, never the name the question asks about", () => {
  const question = "Which website analytics tools respect visitor privacy?";
  // Google AI Mode names Google Analytics first; ChatGPT names it last; the listing call skipped it in ChatGPT's answer.
  const aiMode = "Google Analytics is the most widely used tool, but privacy-focused options include Fathom Analytics, Plausible and Simple Analytics.";
  const chatgpt = "For privacy, Fathom Analytics and Plausible are strong choices; both are lighter than Google Analytics.";
  const a = judgeAnswer({ text: aiMode, sources: [] }, FATHOM, RIVALS, { question, namedOrder: ["Google Analytics", "Fathom Analytics", "Plausible", "Simple Analytics"] });
  const b = judgeAnswer({ text: chatgpt, sources: [] }, FATHOM, RIVALS, { question, namedOrder: ["Fathom Analytics"] });
  assert.deepEqual([a.position, a.brandsNamed, a.namedOrder], [2, 4, ["Google Analytics", "Fathom Analytics", "Plausible", "Simple Analytics"]]);
  assert.deepEqual([b.position, b.brandsNamed, b.namedOrder], [1, 2, ["Fathom Analytics", "Plausible"]],
    "a confirmed competitor the listing missed is still counted");
  const union = [...new Set([...a.namedOrder, ...b.namedOrder])];
  const again = recountPlacement(chatgpt, FATHOM, RIVALS, question, b.namedOrder, union);
  assert.deepEqual([again.position, again.brandsNamed, again.namedOrder], [1, 3, ["Fathom Analytics", "Plausible", "Google Analytics"]],
    "Google Analytics, counted in the other answer, is counted here too");
  // A question about alternatives to Google Analytics: its name is the question echoed back, never an option, everywhere.
  const echo = "What are privacy-friendly alternatives to Google Analytics?";
  const a2 = judgeAnswer({ text: aiMode, sources: [] }, FATHOM, RIVALS, { question: echo, namedOrder: ["Google Analytics", "Fathom Analytics", "Plausible", "Simple Analytics"] });
  assert.deepEqual([a2.position, a2.brandsNamed], [1, 3]);
  assert.deepEqual(recountPlacement(chatgpt, FATHOM, RIVALS, echo, ["Fathom Analytics"], union).namedOrder, ["Fathom Analytics", "Plausible"]);
  // A name another answer listed is matched as written: "simple analytics" in lower case is the everyday words.
  const plain = "Fathom Analytics offers simple analytics without cookies, unlike Plausible.";
  assert.deepEqual(recountPlacement(plain, FATHOM, RIVALS, question, ["Fathom Analytics"], ["Simple Analytics", "Plausible"]).namedOrder, ["Fathom Analytics", "Plausible"]);
  // Another niche: a CRM question. HubSpot is counted wherever an answer names it once any answer to the question did.
  const crm = { name: "Pipedrive", domain: "pipedrive.com" };
  const q2 = "Which CRM is easiest for a five-person sales team?";
  const t1 = "Pipedrive is the easiest to start with; HubSpot has a free tier; Salesforce suits larger teams.";
  const t2 = "Most small teams pick HubSpot or Pipedrive.";
  const one = judgeAnswer({ text: t1, sources: [] }, crm, [], { question: q2, namedOrder: ["Pipedrive", "HubSpot", "Salesforce"] });
  const two = judgeAnswer({ text: t2, sources: [] }, crm, [], { question: q2, namedOrder: ["Pipedrive"] });
  assert.deepEqual([one.position, one.brandsNamed, two.position, two.brandsNamed], [1, 3, 1, 1]);
  assert.deepEqual(recountPlacement(t2, crm, [], q2, two.namedOrder, [...one.namedOrder]).namedOrder, ["HubSpot", "Pipedrive"], "2nd of 2, the same businesses as the other answer");
  // No listing at all: the business and the confirmed competitors, as before.
  assert.deepEqual(placeNamed("Plausible or Fathom Analytics.", { businessAt: 14, businessName: "Fathom Analytics", isBusiness: (n) => /fathom/i.test(n), names: [],
    rivalHits: [{ name: "Plausible", at: 0 }] }), { position: 2, order: ["Plausible", "Fathom Analytics"] });
});

test("each winnable reason says what that question's answers show: who they name instead and the sites they cite", () => {
  const check = (rivals: string[], domains: string[]) => ({ status: "answered", named: false, cited: false, competitorsNamed: rivals,
    sources: domains.map((domain) => ({ domain, own: false, title: "A page" })) });
  const local = questionOpportunity("Which Leeds plumber can fix a boiler on a Sunday?", [
    check(["Brightside Plumbing", "Kirkstall Boiler Care"], ["heatingadvice.example", "leedsblog.example"]), check(["Brightside Plumbing"], ["heatingadvice.example", "boilerguide.example"]),
    check([], ["emergencyhelp.example"])]);
  assert.equal(local.reasons[0], "Brightside Plumbing is named in 2 of 3 answers, Kirkstall Boiler Care in 1; you in none.");
  assert.equal(local.reasons[1], "They cite heatingadvice.example, boilerguide.example and 2 more; none of those pages answers this exact question.");
  const quiet = questionOpportunity("How long does a combi boiler last?", [check([], ["a.example"]), check([], ["a.example"])]);
  assert.equal(quiet.reasons[0], "None of the 2 answers names you or a competitor you track.");
  assert.notEqual(local.reasons.slice(0, 2).join(" "), quiet.reasons.slice(0, 2).join(" "));
});

const longPage = (lead: string, n = 60) => [lead, "", "## Sedation options at Osterkamp Family Dental", "",
  ...Array.from({ length: n }, (_, i) => `Sentence ${i + 1} explains one more thing an anxious patient wants to know before a visit.`)].join("\n");

test("a page never repeats the business's other pages: copied blocks are revised, then taken out while the page stays full", () => {
  const other = { question: "Does Osterkamp Family Dental offer same-day crowns?", markdown: [
    "Same-day crowns take one visit.", "", "## When is another option a better fit?", "",
    "Osterkamp Family Dental is a family and restorative practice in Southeast Boise that cares for patients of every age.",
    "[Request an appointment](https://osterkampfamilydental.com/request-appointment/)"].join("\n") };
  const page = [longPage("Sedation helps anxious patients through care."), "", "[Request an appointment](https://osterkampfamilydental.com/request-appointment/)", "",
    "## When is another option a better fit?", "",
    "Osterkamp Family Dental is a family and restorative practice in Southeast Boise that cares for patients of every age."].join("\n");
  const repeated = repeatedContent(page, [other]);
  assert.deepEqual(repeated.headings.map((h) => h.text), ["When is another option a better fit?"]);
  assert.equal(repeated.sentences.length, 1, "the copied description; a booking link on every page is no copied block");
  const issues = repeatedIssues(repeated);
  assert.match(issues[0], /^The heading "When is another option a better fit\?" is also on the page for "Does Osterkamp Family Dental offer same-day crowns\?"/);
  assert.match(issues[1], /is word for word on the page for "Does Osterkamp Family Dental offer same-day crowns\?"\. Say only what this question needs/);
  const draft: DraftPage = { title: "t", metaDescription: "m", markdown: page, facts: [], fit: "strong" };
  const edited = editedDraft(draft, { businessName: "Osterkamp Family Dental", businessDomain: "osterkampfamilydental.com", productEvidence: "", ownProblems: [], otherPages: [other] });
  assert.doesNotMatch(edited.markdown, /cares for patients of every age/);
  assert.match(edited.markdown, /Request an appointment/);
  assert.doesNotMatch(edited.markdown, /When is another option a better fit/, "a heading left with nothing under it goes too");
  // A page that is mostly a copy keeps its words (taking them out would leave nothing to read; the revision tried).
  const thin = editedDraft({ ...draft, markdown: other.markdown + "\n\nOne more line." }, { businessName: "Osterkamp Family Dental", businessDomain: "osterkampfamilydental.com",
    productEvidence: "", ownProblems: [], otherPages: [other] });
  assert.match(thin.markdown, /cares for patients of every age/);
  assert.equal(dropEmptySections("Intro.\n\n## Empty\n\n## Full\n\nText.\n\n### Sub\n\n## Last"), "Intro.\n\n## Full\n\nText.");
  const request = answerPageRequest({ question: "Which Boise dentist offers sedation?", businessName: "Osterkamp Family Dental", productEvidence: "facts", market: "Boise, ID, US",
    language: "en", landscape: [], sources: [], competitorNames: [], otherQuestions: ["Does Osterkamp Family Dental offer same-day crowns?"] });
  assert.match(request.system, /headed by what it does for this question in plain words, not a generic heading\./);
  assert.match(request.system, /3c\. This page is one of several on Osterkamp Family Dental's site, each answering its own question .* material that would read the same on any of its pages belongs only on the page whose question asks for it\./);
  assert.doesNotMatch(request.system, /[Ss]edation|insurance|call to action/, "no example wording in the instructions");
  // LeadPilot's own drafts (Nov 2026, not from the report): the stock heading and the copied product line are caught.
  const lp1 = { question: "What's the best AI chatbot for a B2B SaaS website?", markdown: "## What does LeadPilot cost?\n\nLeadPilot is an AI sales agent that embeds into your website and books meetings.\n\n## FAQ\n\nSome answer." };
  const lp2 = "Intro.\n\n## What does LeadPilot cost?\n\nLeadPilot is an AI sales agent that embeds into your website and books meetings.\n\n## FAQ\n\nAnother answer.";
  const lp = repeatedContent(lp2, [lp1]);
  assert.deepEqual([lp.headings.map((h) => h.text), lp.sentences.length], [["What does LeadPilot cost?"], 1], "a one-word FAQ heading every page has is not a copy");
  assert.match(request.userMessage, /other answer pages answer these questions \(leave their material to them\):\n- Does Osterkamp Family Dental offer same-day crowns\?/);
});

// ── On the real handlers ──

const SITE_HTML = `<html><head><title>Osterkamp Family Dental | Boise Dentist</title></head><body><nav><a href="/dental-services/sleep-apnea/">Sleep Apnea</a><a href="/about/">About</a></nav><main>${"Osterkamp Family Dental cares for Boise families with implants, Invisalign and same-day crowns. ".repeat(12)}</main></body></html>`;

function setupNetwork(calls: Array<{ url: string; body?: Fields }>, options: { riverviewBlocked?: boolean } = {}) {
  return async (url: URL, init: RequestInit) => {
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.href, ...(body ? { body } : {}) });
    if (url.hostname === "treg.to" && url.pathname === "/call/treg.google.serp.maps") {
      if (/Best Orthodontist in Pune/.test(body.q)) return json({ output: { places: [row("Sample Dental Clinic", "https://bestclinicpune.example.in/", 210)] } }, 150);
      if (/bestclinicpune/.test(body.q)) return json({ output: { places: [] } }, 150);
      return json(/boiseriverviewdental/.test(body.q) ? RIVERVIEW_MAPS : BOISE_MAPS, 150);
    }
    if (url.hostname === "treg.to") return json({ success: false }, 0, 502);
    if (url.hostname === "api.anthropic.com") {
      return json({ id: "msg_r", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "tool_use", id: "tool_r", name: "submit_business_read", input: { name: "Osterkamp Family Dental", sells: "Family and restorative dentistry in Boise, Idaho.",
          buyers: "Families in Boise", offerings: ["Implants", "Sleep apnea treatment"], country: "US", local: true, location: "Boise, ID", searchTerm: "family dentist",
          competitors: [] } }], usage: { input_tokens: 4000, output_tokens: 400 } });
    }
    if (url.hostname === "osterkampfamilydental.com") {
      if (/sitemap/.test(url.pathname)) return new Response("not found", { status: 404 });
      return new Response(SITE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.hostname === "bestclinicpune.example.in" || url.hostname === "www.bestclinicpune.example.in") {
      return new Response(`<html><head><meta property="og:site_name" content="Clinic Group India" /><title>Best Orthodontist in Pune | Braces | Sample Dental Clinic</title></head><body>Care</body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.hostname === "boiseriverviewdental.com" || url.hostname === "www.boiseriverviewdental.com") {
      return new Response(options.riverviewBlocked ? SUCURI_BLOCK : RIVERVIEW_HEAD, { status: options.riverviewBlocked ? 403 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw new Error(`unexpected network ${url.href}`);
  };
}

const HOSTS = { syntheticHosts: ["osterkampfamilydental.com", "www.osterkampfamilydental.com", "boiseriverviewdental.com", "www.boiseriverviewdental.com",
  "bestclinicpune.example.in", "www.bestclinicpune.example.in"] };

async function drain(f: ReturnType<typeof corePipelineFixture>) {
  for (let guard = 0; guard < 50; guard++) if (!(await f.runNextScheduled())) return;
  assert.fail("scheduled work never settled");
}

test("a local dentist's setup suggests the Boise practices Google Maps lists, and reads its menu's services", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(setupNetwork(calls), { TREG_TOKEN: "synthetic-only" }, HOSTS);
  f.setIdentity("user_osterkamp");
  const { siteId } = await f.invoke("answers:createSite", { domain: "osterkampfamilydental.com", email: "owner@osterkamp.example" });
  f.setIdentity(null);
  await drain(f);
  const maps = calls.find((c) => c.url === "https://treg.to/call/treg.google.serp.maps");
  assert.equal(maps?.body?.q, "family dentist Boise, ID, United States", "one Maps search, for what the read says buyers type, in its city and country");
  const read = calls.find((c) => c.url.startsWith("https://api.anthropic.com/"));
  assert.match(String(read?.body?.messages?.[0]?.content ?? ""), /Pages on the site \(its menu and sitemap\): Sleep Apnea \| About/);
  const site = f.tables.sites.find((s) => s._id === siteId)!;
  assert.deepEqual(site.answers.competitors.map((c: { name: string }) => c.name),
    ["Boise Family Dental Care", "Tree City Family Dental", "Bird Family Dental", "Idaho Family Dental-Dr. Anna Budolfson, DMD", "Facebook Only Dental"]);
  const spend = f.tables.answer_spend.find((r) => r.purpose === "read")!;
  assert.equal(spend.state, "settled");
  assert.ok(spend.actualMicroUsd > 150, "the Maps search is in the read's settled cost");
  f.assertOffline();
});

test("a typed competitor address shows its real name at once: from its homepage, or its Maps listing when the host blocks Pentra", async () => {
  for (const blocked of [false, true]) {
    const calls: Array<{ url: string; body?: Fields }> = [];
    const f = corePipelineFixture(setupNetwork(calls, { riverviewBlocked: blocked }), { TREG_TOKEN: "synthetic-only" }, HOSTS);
    f.setIdentity("user_osterkamp");
    const { siteId } = await f.invoke("answers:createSite", { domain: "osterkampfamilydental.com" });
    const found = await f.invoke("actions/answersSetup:lookupCompetitor", { siteId, domain: "https://www.boiseriverviewdental.com/" });
    assert.deepEqual(found, { name: "Riverview Dental", domain: "boiseriverviewdental.com" }, blocked ? "from its Maps listing" : "from its homepage");
    assert.equal(calls.some((c) => c.url === "https://treg.to/call/treg.google.serp.maps" && /boiseriverviewdental/.test(String(c.body?.q))), blocked,
      "Maps only when the homepage can't say");
    const lookup = f.tables.answer_spend.find((r) => r.purpose === "lookup")!;
    assert.equal(lookup.state, blocked ? "settled" : "released", "held against the account's spend; nothing charged when the homepage answered");
    f.setIdentity("someone_else");
    await assert.rejects(f.invoke("actions/answersSetup:lookupCompetitor", { siteId, domain: "boiseriverviewdental.com" }), /Site not found/);
    f.setIdentity(null);
    await assert.rejects(f.invoke("actions/answersSetup:lookupCompetitor", { siteId, domain: "boiseriverviewdental.com" }), /Sign in first/);
  }
});

test("a site whose own name doesn't match its address is named by its Maps listing, found by the page's own title", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(setupNetwork(calls), { TREG_TOKEN: "synthetic-only" }, HOSTS);
  f.setIdentity("user_osterkamp");
  const { siteId } = await f.invoke("answers:createSite", { domain: "osterkampfamilydental.com" });
  const found = await f.invoke("actions/answersSetup:lookupCompetitor", { siteId, domain: "bestclinicpune.example.in" });
  assert.deepEqual(found, { name: "Sample Dental Clinic", domain: "bestclinicpune.example.in" }, "never the group name the site declares");
  assert.equal(calls.find((c) => c.url === "https://treg.to/call/treg.google.serp.maps")?.body?.q, "Best Orthodontist in Pune | Braces | Sample Dental Clinic",
    "Maps is searched by the page's own words, not its address");
});

test("a competitor saved with a run-together name is renamed from its Maps listing after confirming (the backstop)", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(setupNetwork(calls, { riverviewBlocked: true }), { TREG_TOKEN: "synthetic-only" }, HOSTS);
  f.setIdentity("user_osterkamp");
  const { siteId } = await f.invoke("answers:createSite", { domain: "osterkampfamilydental.com" });
  f.setIdentity(null);
  await drain(f);
  f.setIdentity("user_osterkamp");
  await f.invoke("answers:confirmSetup", { siteId, competitors: [{ name: "Boiseriverviewdental", domain: "boiseriverviewdental.com" }] });
  f.setIdentity(null);
  const named = f.tables._scheduled_functions.find((r) => r.name === "actions/answersSetup:nameCompetitors");
  assert.ok(named, "the backstop is scheduled");
  await f.invoke("actions/answersSetup:nameCompetitors", { siteId });
  const site = f.tables.sites.find((s) => s._id === siteId)!;
  assert.deepEqual(site.answers.competitors, [{ name: "Riverview Dental", domain: "boiseriverviewdental.com" }]);
});

test("a finished run recounts each named answer over every business its question's answers were counted with", async () => {
  const f = corePipelineFixture(async (url) => { throw new Error(`unexpected network ${url.href}`); }, {});
  const now = f.now();
  const siteId = f.add("sites", { domain: "usefathom.com", siteName: "Fathom Analytics", userId: "user_fathom", planFeatures: [], language: "en",
    answers: { enabled: true, enabledAt: now, source: "signup", confirmedAt: now, competitors: [{ name: "Plausible", domain: "plausible.io" }] } });
  const questionId = f.add("answer_questions", { siteId, question: "Which website analytics tools respect visitor privacy?", key: "k", intent: "recommendation", source: "generated",
    status: "active", createdAt: now });
  const runId = f.add("answer_runs", { siteId, kind: "recheck", status: "asking", createdAt: now, startedAt: now, country: "US", assistants: ["chatgpt", "google_ai_mode"],
    jobs: [], nextJob: 0, done: 2, answered: 2, named: 2, cited: 0, failed: 0, noAnswer: 0, costMicroUsd: 0 });
  const base = { siteId, runId, questionId, question: "Which website analytics tools respect visitor privacy?", askedAt: now, country: "US", status: "answered", excerpt: "",
    named: true, cited: false, sources: [], citedPageUrls: [], endpoint: "e", costMicroUsd: 0, competitorsNamed: ["Plausible"] };
  const aiMode = f.add("answer_checks", { ...base, assistant: "google_ai_mode", textChars: 120, position: 2, brandsNamed: 4,
    businessesNamed: ["Google Analytics", "Fathom Analytics", "Plausible", "Simple Analytics"] });
  const chatgpt = f.add("answer_checks", { ...base, assistant: "chatgpt", textChars: 100, position: 1, brandsNamed: 2, businessesNamed: ["Fathom Analytics", "Plausible"] });
  f.add("answer_texts", { siteId, checkId: aiMode, text: "Google Analytics is the most widely used tool, but privacy-focused options include Fathom Analytics, Plausible and Simple Analytics." });
  f.add("answer_texts", { siteId, checkId: chatgpt, text: "For privacy, Fathom Analytics and Plausible are strong choices; both are lighter than Google Analytics." });
  await f.invoke("answers:finishRun", { runId });
  const after = f.tables.answer_checks.find((c) => c._id === chatgpt)!;
  assert.deepEqual([after.position, after.brandsNamed, after.businessesNamed], [1, 3, ["Fathom Analytics", "Plausible", "Google Analytics"]]);
  const unchanged = f.tables.answer_checks.find((c) => c._id === aiMode)!;
  assert.deepEqual([unchanged.position, unchanged.brandsNamed], [2, 4]);
});

test("only a run-together name is looked up: \"plausible.io\" stays \"Plausible\", as answers write it", async () => {
  const { nameFromDomainOnly } = await import("../convex/lib/answersAccess.ts");
  assert.equal(nameFromDomainOnly("Plausible", "plausible.io"), false);
  assert.equal(nameFromDomainOnly("Boiseriverviewdental", "boiseriverviewdental.com"), true);
  const { readFileSync } = await import("node:fs");
  const screen = readFileSync(new URL("../src/components/answers/onboarding/understood.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(!domain \|\| !nameFromDomainOnly\(competitor\.name, domain\)\) return;/);
  assert.match(readFileSync(new URL("../src/components/answers/dashboard/competitors.tsx", import.meta.url), "utf8"), /useCompetitorLookup\(overview\.site\.siteId, setList\)/);
});
