import assert from "node:assert/strict";
import test from "node:test";
import { brandTerms, checkSeeds, excludedFromMissed, freeCheckDomain, freeCheckLocale, freeCheckReportEmail, freeCheckView, healthSummary,
  isBrandedKeyword, parseSearchSeeds, searchSeedRequest, selectAlmostThere, selectMissedSearches, siteCoverage, FREE_CHECK_DAILY_CAP_MICRO_USD,
  FREE_CHECK_EMAIL_ADDRESS_DAILY_LIMIT, FREE_CHECK_HEALTH_CHECKS, FREE_CHECK_RESERVATION_MICRO_USD, FREE_CHECK_VERSION,
  FREE_CHECK_VISIBLE } from "../convex/lib/missedSearches.ts";
import { homepageDigest } from "../convex/lib/sitePrefill.ts";
import { plausibleEmail } from "../convex/lib/customerEmail.ts";
import type { BuyerFitVerdict } from "../convex/lib/topicFit.ts";
import { clientIp, freeCheckEmailKey, freeCheckVisitor } from "../src/lib/free-check.ts";
import { corePipelineFixture, START, type Fields } from "./helpers/core-pipeline-fixture.ts";

// The free Missed Searches Checker (P122, Oct 20 2026). Synthetic websites and
// providers only: no real site, search provider or model is contacted.

const keep = (keywords: string[], drop: string[] = []) => new Map<string, BuyerFitVerdict>([
  ...keywords.map(k => [k, { keyword: k, keep: true, reason: "fits" }] as const),
  ...drop.map(k => [k, { keyword: k, keep: false, reason: "another market" }] as const),
]);

test("the checked website is a public bare domain", () => {
  assert.equal(freeCheckDomain("https://www.GlazeLedger.co/pricing?x=1"), "glazeledger.co");
  assert.equal(freeCheckDomain("shop.glazeledger.co"), "shop.glazeledger.co");
  for (const bad of ["localhost", "studio.test", "http://10.0.0.1/", "not a website", ""]) assert.equal(freeCheckDomain(bad), null, bad);
});

test("searches are measured where the site sells and in its language", () => {
  assert.deepEqual(freeCheckLocale("studio.co.uk", "en"), { country: "uk", countryName: "the UK", language: "en" });
  assert.deepEqual(freeCheckLocale("glazeledger.co", "en-GB"), { country: "uk", countryName: "the UK", language: "en" });
  assert.deepEqual(freeCheckLocale("toepferei.de", "de-DE"), { country: "de", countryName: "Germany", language: "de" });
  assert.deepEqual(freeCheckLocale("glazeledger.io", null), { country: "us", countryName: "the US", language: "en" });
});

test("the brand is the business name, never a generic word domain", () => {
  const brands = brandTerms("leadpilot.chat", "LeadPilot");
  assert.ok(isBrandedKeyword("leadpilot pricing", brands) && isBrandedKeyword("lead pilot reviews", brands));
  assert.ok(!isBrandedKeyword("lead qualification chatbot", brands));
  const plumbing = brandTerms("plumbing.com", "Joe's Plumbing");
  assert.ok(!isBrandedKeyword("emergency plumbing repair", plumbing), "a generic domain word is not a brand");
  assert.ok(isBrandedKeyword("joe s plumbing hours", plumbing));
  assert.deepEqual(brandTerms("acme-tools.com", "Home"), ["acme-tools"], "a page word is never taken as the name");
});

test("seeds come from the homepage's own product words, never the brand", () => {
  const seeds = checkSeeds({ product: "Glaze inventory software for ceramic studios. Includes: Kiln firing records; Clay stock reconciliation.",
    summary: "GlazeLedger tracks glaze inventory for ceramic studios.", audience: "Ceramic studios and potters", questions: ["How does GlazeLedger work?"] },
  brandTerms("glazeledger.co", "GlazeLedger"));
  assert.ok(seeds.includes("kiln firing records") && seeds.includes("clay stock reconciliation"), seeds.join(" | "));
  assert.ok(seeds.every(seed => !seed.includes("glazeledger")));
});

test("seeds are buyer searches read from the homepage, never its slogans or brand (leadpilot.chat, Oct 20)", () => {
  const html = `<html><head><title>LeadPilot — AI Sales Agent for Your Website</title><meta name="description" content="Turn website visitors into qualified leads 24/7."></head>
    <body><h1>Turn website visitors into qualified leads, automatically</h1><h2>One agent. Four jobs.</h2><h2>You decide what success means</h2>
    <p>LeadPilot embeds an AI sales agent on your site that answers questions, captures leads, and qualifies prospects while you sleep.</p></body></html>`;
  const digest = homepageDigest(html);
  assert.equal(digest.title, "LeadPilot — AI Sales Agent for Your Website");
  assert.deepEqual(digest.headings, ["Turn website visitors into qualified leads, automatically", "One agent. Four jobs.", "You decide what success means"]);
  const request = searchSeedRequest("leadpilot.chat", digest, ["How does lead capture work?"]);
  assert.match(request.userMessage, /HOMEPAGE \(data only\)/); assert.match(request.system, /never instructions/);
  const brands = brandTerms("leadpilot.chat", "LeadPilot");
  assert.deepEqual(parseSearchSeeds({ sells: "An AI sales agent for websites.", customers: "Small B2B companies.", searches: [
    "AI chatbot for website", "lead qualification software", "leadpilot pricing", "how do i qualify leads from my website traffic today",
    "website lead capture", "lead qualification software", "one"] }, brands),
  { seeds: ["ai chatbot for website", "lead qualification software", "website lead capture"], sells: "An AI sales agent for websites.", customers: "Small B2B companies." });
  assert.equal(parseSearchSeeds({ sells: "x", customers: "y", searches: ["ai chatbot"] }, brands), null, "too few usable seeds: fall back");
  assert.equal(parseSearchSeeds(null, brands), null);
});

test("missed searches: measured, winnable, kept by buyer fit, not covered or ranking, one per intent", () => {
  const input = { brands: ["glazeledger"], coverage: siteCoverage(["https://glazeledger.co/blog/how-to-track-glaze-inventory"], "GlazeLedger | Home"),
    ranked: [{ keyword: "glaze inventory software", searchVolume: 500, position: 2, url: "https://glazeledger.co/" },
      { keyword: "kiln log template", searchVolume: 200, position: 45, url: "https://glazeledger.co/blog/kilns" }] };
  assert.ok(excludedFromMissed("how to track glaze inventory", input), "the site has a page for it");
  assert.ok(excludedFromMissed("glaze inventory software", input), "already on page one");
  assert.ok(!excludedFromMissed("kiln log template", input), "position 45 is still missed");
  const found = [
    { keyword: "kiln firing schedule", searchVolume: 880, difficulty: 22, difficultyMeasured: true },
    { keyword: "kiln firing schedules", searchVolume: 300, difficulty: 20, difficultyMeasured: true },
    { keyword: "ceramic glaze recipes", searchVolume: 1900, difficulty: 45, difficultyMeasured: true },
    { keyword: "pottery studio management", searchVolume: 210, difficulty: 18, difficultyMeasured: false },
    { keyword: "kiln log template", searchVolume: 200, difficulty: 9, difficultyMeasured: true },
    { keyword: "twitch glaze overlay", searchVolume: 700, difficulty: 5, difficultyMeasured: true },
    { keyword: "glazeledger login", searchVolume: 90, difficulty: 2, difficultyMeasured: true },
  ];
  const verdicts = keep(["kiln firing schedule", "kiln firing schedules", "ceramic glaze recipes", "pottery studio management", "kiln log template",
    "glazeledger login"], ["twitch glaze overlay"]);
  assert.deepEqual(selectMissedSearches(found, verdicts, input), [
    { keyword: "kiln firing schedule", searchVolume: 880, difficulty: 22 },
    { keyword: "kiln log template", searchVolume: 200, difficulty: 9 },
  ]);
  // A search the fit check didn't judge is never shown.
  assert.deepEqual(selectMissedSearches(found, new Map(), input), []);
});

test("close to page one: positions 4 to 20, off the brand, kept by buyer fit", () => {
  const ranked = [
    { keyword: "ceramic studio software", searchVolume: 390, position: 9, url: "https://glazeledger.co/features" },
    { keyword: "glaze inventory software", searchVolume: 500, position: 2, url: "https://glazeledger.co/" },
    { keyword: "glazeledger reviews", searchVolume: 70, position: 6, url: "https://glazeledger.co/reviews" },
    { keyword: "twitch glaze overlay", searchVolume: 500, position: 12, url: "https://glazeledger.co/blog/x" },
    { keyword: "kiln log template", searchVolume: 200, position: 45, url: "https://glazeledger.co/blog/kilns" },
  ];
  assert.deepEqual(selectAlmostThere(ranked, keep(["ceramic studio software", "glaze inventory software", "glazeledger reviews", "kiln log template"],
    ["twitch glaze overlay"]), ["glazeledger"]), [{ keyword: "ceramic studio software", searchVolume: 390, position: 9, url: "https://glazeledger.co/features" }]);
});

test("Google basics count each check once", () => {
  const summary = healthSummary([
    { code: "title_long", severity: "warning", message: "long" }, { code: "title_short", severity: "warning", message: "short" },
    { code: "robots_blocks_all", severity: "critical", message: "blocked" }, { code: "unknown_extra", severity: "warning", message: "?" },
  ]);
  assert.equal(summary.total, FREE_CHECK_HEALTH_CHECKS);
  assert.equal(summary.passed, FREE_CHECK_HEALTH_CHECKS - 2);
  assert.deepEqual(summary.issues.map(i => i.code), ["robots_blocks_all", "title_long", "title_short"]);
});

test("a signed-out visitor never receives the hidden searches", () => {
  const missed = Array.from({ length: 8 }, (_, i) => ({ keyword: `hidden search ${i}`, searchVolume: 100 - i, difficulty: 10 }));
  const row = { domain: "glazeledger.co", status: "done" as const, requestedAt: START, completedAt: START, missed };
  const out = freeCheckView(row, false);
  assert.equal(out.missed.length, FREE_CHECK_VISIBLE);
  assert.equal(out.hiddenCount, 8 - FREE_CHECK_VISIBLE); assert.equal(out.totalMissed, 8);
  assert.equal(out.monthlySearches, missed.reduce((s, k) => s + k.searchVolume, 0));
  assert.ok(!JSON.stringify(out).includes("hidden search 7"));
  assert.equal(freeCheckView(row, true).missed.length, 8);
});

test("the emailed report holds every missed search and says why it arrived", () => {
  const missed = Array.from({ length: 7 }, (_, i) => ({ keyword: `glaze search ${i}`, searchVolume: 200 - i, difficulty: 12 }));
  const email = freeCheckReportEmail({ domain: "glazeledger.co", status: "done", requestedAt: START, completedAt: START, countryName: "the UK", missed,
    almost: [{ keyword: "ceramic studio software", searchVolume: 390, position: 9, url: "https://glazeledger.co/features" }],
    health: { passed: 12, total: 13, issues: [{ code: "schema_missing", severity: "warning", message: "No structured data." }] } });
  assert.equal(email.subject, "7 Google searches glazeledger.co is missing");
  for (const k of missed) assert.ok(email.text.includes(k.keyword), k.keyword);
  assert.match(email.text, /#9 on Google, 390 a month \(\/features\)/);
  assert.match(email.text, /GOOGLE BASICS: 12 of 13 pass\n- No structured data\./);
  assert.match(email.text, /https:\/\/pentra\.dev\/check\/glazeledger\.co/);
  assert.match(email.text, /only email we'll send you about it/);
  assert.equal(plausibleEmail(" Owner@GlazeLedger.co "), "owner@glazeledger.co");
  for (const bad of ["owner@", "owner@glazeledger", "a b@c.co", "<x>@c.co", `${"a".repeat(250)}@c.co`]) assert.equal(plausibleEmail(bad), null, bad);
});

test("a visitor is an HMAC of IP and day, never the IP", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  assert.equal(clientIp(headers), "203.0.113.7");
  const day1 = freeCheckVisitor("203.0.113.7", START, "secret"), sameDay = freeCheckVisitor("203.0.113.7", START + 3_600_000, "secret");
  assert.match(day1, /^[a-f0-9]{64}$/); assert.equal(day1, sameDay);
  assert.notEqual(day1, freeCheckVisitor("203.0.113.7", START + 86_400_000, "secret"));
  assert.ok(!day1.includes("203"));
  const key = freeCheckEmailKey("Owner@GlazeLedger.co", START, "secret");
  assert.equal(key, freeCheckEmailKey("owner@glazeledger.co ", START, "secret")); assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, freeCheckEmailKey("owner@glazeledger.co", START + 86_400_000, "secret"));
});

// ── The whole check through the registered Convex handlers ──

const DOMAIN = "glazeledger.co";
const HOME = `<!doctype html><html lang="en-GB"><head><title>GlazeLedger | Glaze inventory software for ceramic studios</title>
<meta name="description" content="GlazeLedger tracks glaze inventory, kiln firing records and clay stock for ceramic studios, so potters reorder supplies before they run out.">
<script type="application/ld+json">{"@type":"Organization"}</script></head><body>
<h1>Glaze inventory software for ceramic studios</h1><h2>Kiln firing records</h2><h2>Clay stock reconciliation</h2>
<p>${"Ceramic studios use GlazeLedger to record every glaze batch, kiln firing and clay delivery in one place, so the whole team knows what is in stock and what to reorder. ".repeat(8)}</p>
<a href="/blog">Blog</a> <a href="/signup">Start free trial</a></body></html>`;
const LABS = [
  ["how to track glaze inventory", 300, 10], ["glaze inventory spreadsheet", 260, 12], ["pottery studio management", 210, 18],
  ["kiln firing schedule cone 6", 880, 22], ["glazeledger login", 90, 5], ["clay stock reconciliation", 40, 3],
  ["ceramic glaze recipes", 1900, 45], ["twitch glaze overlay", 600, 4], ["kiln log template", 200, 9],
] as const;
const IDEAS = [["pottery inventory app", 140, 15]] as const;
const RANKED = [
  ["glazeledger", 1, 900], ["glaze inventory software", 2, 500], ["ceramic studio software", 9, 390],
  ["twitch glaze overlay", 12, 600], ["kiln log template", 45, 200],
] as const;

function world(options: { homepageDown?: boolean; resendStatus?: number; seedAnswer?: unknown } = {}) {
  const calls: string[] = [], emails: Fields[] = [], seedRequests: string[] = [];
  const page = (body: string, type = "text/html; charset=utf-8", status = 200) => new Response(body, { status, headers: { "content-type": type } });
  const ok = (result: unknown) => new Response(JSON.stringify({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result }] }),
    { headers: { "content-type": "application/json" } });
  const labsItems = (rows: ReadonlyArray<readonly [string, number, number]>) => [{ items: rows.map(([keyword, volume, kd]) =>
    ({ keyword, keyword_info: { search_volume: volume }, keyword_properties: { keyword_difficulty: kd } })) }];
  const f = corePipelineFixture(async (url, init) => {
    calls.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === DOMAIN || url.hostname === `www.${DOMAIN}`) {
      if (options.homepageDown) return page("down", "text/html", 503);
      if (url.hostname === `www.${DOMAIN}`) return new Response(null, { status: 301, headers: { location: `https://${DOMAIN}/` } });
      if (url.pathname === "/") return page(HOME);
      if (url.pathname === "/robots.txt") return page(`User-agent: *\nAllow: /\nSitemap: https://${DOMAIN}/sitemap.xml\n`, "text/plain");
      if (url.pathname === "/sitemap.xml") return page(`<?xml version="1.0"?><urlset><url><loc>https://${DOMAIN}/</loc></url>
        <url><loc>https://${DOMAIN}/blog/how-to-track-glaze-inventory</loc></url><url><loc>https://${DOMAIN}/pricing</loc></url></urlset>`, "application/xml");
      return page("not found", "text/html", 404);
    }
    if (url.origin === "https://api.dataforseo.com") {
      const endpoint = url.pathname.replace("/v3/", "");
      const body = JSON.parse(String(init.body))[0];
      if (endpoint === "dataforseo_labs/google/ranked_keywords/live") {
        assert.equal(body.target, DOMAIN); assert.equal(body.location_code, 2826); assert.equal(body.language_code, "en");
        return ok([{ items: RANKED.map(([keyword, position, volume]) => ({ keyword_data: { keyword, keyword_info: { search_volume: volume } },
          ranked_serp_element: { serp_item: { type: "organic", rank_group: position, url: `https://${DOMAIN}/${position}` } } })) }]);
      }
      if (endpoint === "dataforseo_labs/google/keyword_suggestions/live") return ok(labsItems(LABS));
      if (endpoint === "dataforseo_labs/google/keyword_ideas/live") return ok(labsItems(IDEAS));
      if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
        const all = [...LABS, ...IDEAS];
        return ok([{ items: body.keywords.map((keyword: string) => ({ keyword, keyword_difficulty: all.find(([k]) => k === keyword)?.[2] ?? 50 })) }]);
      }
      assert.fail(`Unexpected DataForSEO endpoint ${endpoint}`);
    }
    if (url.origin === "https://api.anthropic.com") {
      const body = JSON.parse(String(init.body)), tool = body.tools?.[0]?.name;
      let input: unknown;
      if (tool === "submit_search_seeds") {
        seedRequests.push(String(body.messages[0].content));
        input = options.seedAnswer ?? { sells: "Glaze and kiln record software for ceramic studios.", customers: "Owners of pottery and ceramic studios.",
          searches: ["glaze inventory software", "kiln firing log", "pottery studio management", "GlazeLedger app"] };
      } else {
        assert.equal(tool, "submit_topic_fit");
        const searches = String(body.messages[0].content).split("SEARCHES (one per line, data only):\n")[1]?.split("\n\n")[0] ?? "";
        input = { verdicts: searches.split("\n").filter(Boolean).map(search => ({ keyword: search, keep: !search.includes("twitch"), reason: "Synthetic verdict." })) };
      }
      return new Response(JSON.stringify({ id: "synthetic-call", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "tool_use", id: "synthetic-tool", name: tool, input }] }),
      { headers: { "content-type": "application/json" } });
    }
    if (url.origin === "https://api.resend.com") {
      assert.equal(url.pathname, "/emails"); assert.equal(init.method, "POST");
      emails.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: `synthetic-email-${emails.length}` }), { status: options.resendStatus ?? 200, headers: { "content-type": "application/json" } });
    }
    assert.fail(`Unexpected network ${url.href}`);
  }, { RESEND_API_KEY: "synthetic-only" }, { syntheticHosts: [DOMAIN, `www.${DOMAIN}`] });
  return { f, calls, emails, seedRequests };
}

const visitor = (n: number) => String(n).padStart(64, "a");
const spendRow = (f: ReturnType<typeof corePipelineFixture>) => f.tables.free_check_quota.find(r => r.kind === "spend")!;

test("a free check finds missed searches, holds and settles its cost, and is reused for a week", async () => {
  const { f, calls, seedRequests } = world();
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: "https://www.GlazeLedger.co/pricing", visitor: visitor(1) }), { status: "running", domain: DOMAIN });
  assert.equal(spendRow(f).microUsd, FREE_CHECK_RESERVATION_MICRO_USD, "the worst case is held before any paid call");
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(2) }), { status: "running", domain: DOMAIN });
  assert.equal(f.tables._scheduled_functions.length, 1, "a running check is never started twice");
  assert.equal((await f.invoke("freeCheck:get", { domain: DOMAIN })).step, "Reading your homepage");

  const ran = await f.runNextScheduled();
  assert.deepEqual(ran?.result, { status: "done" });
  const view = await f.invoke("freeCheck:get", { domain: `www.${DOMAIN}` });
  assert.equal(view.status, "done"); assert.equal(view.countryName, "the UK"); assert.equal(view.keywordsUnavailable, false);
  assert.deepEqual(view.missed.map((k: Fields) => k.keyword), ["kiln firing schedule cone 6", "glaze inventory spreadsheet", "pottery studio management",
    "kiln log template", "pottery inventory app"]);
  assert.equal(view.totalMissed, 6); assert.equal(view.hiddenCount, 1);
  assert.ok(!JSON.stringify(view).includes("clay stock reconciliation"), "the hidden search is not sent to a signed-out visitor");
  for (const absent of ["how to track glaze inventory", "glazeledger login", "ceramic glaze recipes", "twitch glaze overlay"]) {
    assert.ok(!JSON.stringify(view).includes(absent), `${absent} is covered, branded, too hard or off-market`);
  }
  assert.deepEqual(view.almost.map((k: Fields) => [k.keyword, k.position]), [["ceramic studio software", 9]]);
  assert.deepEqual(view.health.issues.map((i: Fields) => i.code), ["home_canonical_missing"]);
  assert.equal(view.health.passed, view.health.total - 1);
  f.setIdentity("visitor-account");
  assert.equal((await f.invoke("freeCheck:get", { domain: DOMAIN })).missed.length, 6, "a signed-in visitor sees every missed search");
  f.setIdentity(null);

  // Settled at DataForSEO's reported cost plus the fit call's list price.
  const paid = calls.filter(c => c.startsWith("api.dataforseo.com")).length;
  assert.ok(paid >= 4 && paid <= 6, `DataForSEO calls: ${paid}`);
  let usd = 0;
  for (let i = 0; i < paid; i++) usd += 0.01;
  const cost = Math.ceil(usd * 1_000_000) + 60 + 60;
  assert.equal(spendRow(f).microUsd, cost);
  assert.equal(f.tables.free_checks[0].costMicroUsd, cost);
  assert.ok(!calls.some(c => c.includes("google_ads")), "no Google Ads request (the costly source) for a free check");
  assert.equal(seedRequests.length, 1); assert.match(seedRequests[0], /Headings: Glaze inventory software for ceramic studios \| Kiln firing records/);
  const diagnostics = await f.invoke("freeCheck:diagnosticsFor", { domain: DOMAIN });
  assert.equal(diagnostics.version, FREE_CHECK_VERSION);
  assert.deepEqual(diagnostics.diagnostics.seeds, ["glaze inventory software", "kiln firing log", "pottery studio management"], "the brand seed is dropped");
  assert.equal(diagnostics.diagnostics.seedSource, "model");
  assert.ok(diagnostics.diagnostics.discovered > 0 && diagnostics.diagnostics.judged > 0 && diagnostics.diagnostics.kept > 0);

  // Reused for a week at no cost; then checked again.
  f.setTime(START + 6 * 86_400_000);
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(3) }), { status: "done", domain: DOMAIN });
  assert.equal(f.tables._scheduled_functions.length, 1);
  f.setTime(START + 8 * 86_400_000);
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(3) }), { status: "running", domain: DOMAIN });
  assert.equal(f.tables._scheduled_functions.length, 2);
  assert.equal(f.tables.free_checks.length, 1, "one row per website");
  assert.equal((await f.invoke("freeCheck:get", { domain: DOMAIN })).missed.length, 0, "the old result is not mixed into the new run");
  f.assertOffline();
});

test("a result from an older version of the check runs again; a failed seed call falls back to the homepage's words", async () => {
  const { f, seedRequests } = world({ seedAnswer: { sells: "", customers: "", searches: [] } });
  await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(1) });
  await f.runNextScheduled();
  const first = await f.invoke("freeCheck:diagnosticsFor", { domain: DOMAIN });
  assert.equal(first.diagnostics.seedSource, "homepage"); assert.equal(seedRequests.length, 1);
  assert.ok(first.diagnostics.seeds.includes("kiln firing records"), first.diagnostics.seeds.join(" | "));
  f.tables.free_checks[0].version = FREE_CHECK_VERSION - 1;
  assert.equal((await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(2) })).status, "running");
  assert.equal(f.tables._scheduled_functions.length, 2);
  f.assertOffline();
});

test("free checks stop at the visitor's daily limit and the day's spend cap", async () => {
  const { f } = world();
  for (const name of ["one", "two", "three"]) {
    assert.equal((await f.invoke("freeCheck:request", { domain: `${name}-studio.co`, visitor: visitor(7) })).status, "running");
  }
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: "four-studio.co", visitor: visitor(7) }), { status: "limited", domain: "four-studio.co" });
  spendRow(f).microUsd = FREE_CHECK_DAILY_CAP_MICRO_USD - FREE_CHECK_RESERVATION_MICRO_USD + 1;
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: "five-studio.co", visitor: visitor(8) }), { status: "paused", domain: "five-studio.co" });
  assert.equal(f.tables._scheduled_functions.length, 3, "nothing paid starts past a limit");
  assert.deepEqual(await f.invoke("freeCheck:request", { domain: "localhost", visitor: visitor(8) }), { status: "invalid", domain: null });
  // A new day: yesterday's visitor counters are removed, the spend row stays as cost history.
  f.setTime(START + 86_400_000);
  assert.equal((await f.invoke("freeCheck:request", { domain: "four-studio.co", visitor: visitor(9) })).status, "running");
  assert.equal(f.tables.free_check_quota.filter(r => r.kind === "visitor" && r.key === `visitor:${visitor(7)}`).length, 0);
  assert.equal(f.tables.free_check_quota.filter(r => r.kind === "spend").length, 2);
  f.assertOffline();
});

test("an unreachable website fails clearly and returns its hold; a replaced run writes nothing", async () => {
  const { f, calls } = world({ homepageDown: true });
  await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(1) });
  const scheduled = f.tables._scheduled_functions[0];
  assert.deepEqual((await f.runNextScheduled())?.result, { status: "failed" });
  const view = await f.invoke("freeCheck:get", { domain: DOMAIN });
  assert.equal(view.status, "failed"); assert.match(view.error, /couldn't open https:\/\/glazeledger\.co \(HTTP 503\)/);
  assert.equal(spendRow(f).microUsd, 0, "no paid call was made");
  assert.ok(!calls.some(c => c.startsWith("api.")));
  assert.equal((await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(2) })).status, "failed", "retried at most hourly");
  // A late result from a run that a newer run replaced changes nothing but its cost.
  f.setTime(START + 2 * 3_600_000);
  assert.equal((await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(2) })).status, "running");
  const { checkId, requestedAt, day, reservedMicroUsd } = scheduled.args;
  await f.invoke("freeCheck:complete", { checkId, requestedAt, day, reservedMicroUsd, costMicroUsd: 0, costUncertain: false,
    outcome: { kind: "failed", error: "stale" } });
  assert.equal(f.tables.free_checks[0].status, "running");
  f.assertOffline();
});

test("the full report is emailed once on request, within limits, and the address is never stored", async () => {
  const { f, emails } = world();
  const ask = (n: number, email = "Owner@GlazeLedger.co", key = "b") => f.invoke("freeCheck:emailReport",
    { domain: DOMAIN, email, emailKey: key.repeat(64), visitor: visitor(n) });
  assert.deepEqual(await ask(1), { status: "no_result" }, "nothing to send before a check finishes");
  await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(1) });
  await f.runNextScheduled();
  assert.deepEqual(await ask(1, "not an email"), { status: "invalid" });
  assert.deepEqual(await ask(1), { status: "sent" });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].from, "Pentra <hello@pentra.dev>"); assert.deepEqual(emails[0].to, ["owner@glazeledger.co"]);
  assert.equal(emails[0].reply_to, "pentrahelp@gmail.com");
  assert.equal(emails[0].subject, "6 Google searches glazeledger.co is missing");
  assert.ok(emails[0].text.includes("clay stock reconciliation"), "the hidden searches are in the requested email");
  for (let i = 1; i < FREE_CHECK_EMAIL_ADDRESS_DAILY_LIMIT; i++) assert.equal((await ask(2)).status, "sent");
  assert.deepEqual(await ask(3), { status: "limited" }, "per address and day");
  assert.equal((await ask(3, "other@studio.co", "c")).status, "sent");
  assert.equal((await ask(3, "third@studio.co", "d")).status, "sent");
  assert.equal((await ask(3, "fourth@studio.co", "e")).status, "sent");
  assert.deepEqual(await ask(3, "fifth@studio.co", "f"), { status: "limited" }, "per visitor and day (a refused request isn't counted)");
  const stored = JSON.stringify(Object.entries(f.tables).filter(([table]) => table !== "_scheduled_functions"));
  for (const address of ["owner@glazeledger.co", "other@studio.co"]) assert.ok(!stored.includes(address), `${address} is not stored`);
  assert.equal((await f.invoke("freeCheck:numbers", { since: START - 1 })).reportsEmailed, emails.length);
  assert.equal(emails.length, 5);
  f.assertOffline();
});

test("a report Resend refuses is reported as not sent and not counted", async () => {
  const { f, emails } = world({ resendStatus: 500 });
  await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(1) });
  await f.runNextScheduled();
  assert.deepEqual(await f.invoke("freeCheck:emailReport", { domain: DOMAIN, email: "owner@glazeledger.co", emailKey: "b".repeat(64), visitor: visitor(1) }),
    { status: "failed" });
  assert.equal(emails.length, 1);
  assert.equal(f.tables.acquisition_events.filter(e => e.kind === "report_emailed").length, 0);
  f.assertOffline();
});

test("signup clicks and signups from the checker are counted, never a person", async () => {
  const { f } = world();
  await f.invoke("freeCheck:request", { domain: DOMAIN, visitor: visitor(1) });
  assert.deepEqual(await f.invoke("freeCheck:track", { kind: "signup_click", domain: `www.${DOMAIN}`, visitor: visitor(1) }), { recorded: true });
  f.add("sites", { userId: "owner-1", domain: `https://www.${DOMAIN}` });
  f.setIdentity("someone-else");
  assert.deepEqual(await f.invoke("freeCheck:recordSignup", { domain: DOMAIN }), { recorded: false }, "only an account that has the website");
  f.setIdentity("owner-1");
  assert.deepEqual(await f.invoke("freeCheck:recordSignup", { domain: DOMAIN }), { recorded: true });
  assert.deepEqual(await f.invoke("freeCheck:recordSignup", { domain: DOMAIN }), { recorded: false }, "once per website");
  const numbers = await f.invoke("freeCheck:numbers", { since: START - 1 });
  assert.equal(numbers.started, 1); assert.equal(numbers.signupClicks, 1); assert.equal(numbers.signups, 1); assert.equal(numbers.running, 1);
  for (const event of f.tables.acquisition_events) assert.deepEqual(Object.keys(event).filter(k => !k.startsWith("_")).sort(), ["at", "domain", "kind", "source"]);
  for (let i = 0; i < 40; i++) await f.invoke("freeCheck:track", { kind: "signup_click", visitor: visitor(2) });
  assert.equal(f.tables.acquisition_events.filter(e => e.kind === "signup_click").length, 31, "clicks are bounded per visitor and day");
  f.assertOffline();
});
