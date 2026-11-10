// P403 (Nov 10 2026): Get named done for the owner, and who the AI recommends shown even when setup confirmed no
// competitors. Arshad: "pentra can be more of a done for you service", "the competitors page has nothing".
// Cases: an Australian accounting app (rivals Xero, MYOB), a US plumber, a UK bakery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { corePipelineFixture } from "./helpers/core-pipeline-fixture.ts";
import { businessKey, recommendedRows } from "../src/lib/answers/business-key.ts";

test("who the AI recommends is counted from every answer, per assistant, spellings merged, never the business itself", () => {
  const answer = (assistant: string, businessesNamed: string[], named = false, status = "answered") => ({ assistant, status, named, businessesNamed, competitorsNamed: [] });
  const rows = recommendedRows([
    answer("chatgpt", ["Xero", "MYOB", "Ledgerly"], true),
    answer("perplexity", ["xero.com", "QuickBooks"]),
    answer("gemini", ["Xero"]),
    answer("chatgpt", ["Xero"], false, "error"),
  ], "Ledgerly", [{ name: "Reckon" }], ["chatgpt", "perplexity", "gemini"]);
  assert.deepEqual(rows.map((r) => [r.name, r.total]), [["Xero", 3], ["Ledgerly", 1], ["MYOB", 1], ["QuickBooks", 1], ["Reckon", 0]]);
  assert.deepEqual(rows[0].byAssistant, { chatgpt: 1, perplexity: 1, gemini: 1 });
  assert.equal(rows.find((r) => r.name === "Reckon")!.tracked, true, "a tracked competitor shows even when no answer names it");
  assert.equal(rows.find((r) => r.you)!.name, "Ledgerly");
  assert.equal(businessKey("Apollo.io"), businessKey("apollo"));
});

test("the daily work starts the listing, the next comparison page and the week's video by itself, once each", async () => {
  const f = corePipelineFixture(async () => new Response("{}", { status: 200 }), {}, {});
  const now = f.now();
  const siteId = f.add("sites", { domain: "ledgerly.example", userId: "user_ledgerly", siteName: "Ledgerly", publishMethod: "manual",
    answers: { enabled: true, enabledAt: now, source: "signup", confirmedAt: now }, createdAt: now, updatedAt: now });
  const runId = f.add("answer_runs", { siteId, kind: "weekly", status: "done", createdAt: now, country: "AU", assistants: ["chatgpt"], jobs: [], nextJob: 0, done: 3,
    answered: 3, named: 0, cited: 0, failed: 0, noAnswer: 0, costMicroUsd: 0 });
  const questionId = f.add("answer_questions", { siteId, question: "What's the best bookkeeping app for sole traders?", key: "q", intent: "recommendation", source: "generated",
    status: "active", createdAt: now });
  const check = (assistant: string, businessesNamed: string[], domains: string[]) => f.add("answer_checks", { siteId, runId, questionId,
    question: "What's the best bookkeeping app for sole traders?", assistant, askedAt: now - 3_600_000, country: "AU", status: "answered", excerpt: "", textChars: 100,
    named: false, cited: false, brandsNamed: businessesNamed.length, businessesNamed, competitorsNamed: [],
    sources: domains.map((d) => ({ url: `https://${d}/page`, domain: d, own: false })), citedPageUrls: [], endpoint: "e", costMicroUsd: 0 });
  check("chatgpt", ["Xero", "MYOB"], ["xero.com", "myob.com", "youtube.com"]);
  check("perplexity", ["Xero"], ["xero.com"]);
  check("google_ai_overview", ["MYOB", "Xero"], ["myob.com", "youtube.com"]);

  const first = await f.invoke("answerGrowthKit:autoWork", { siteId });
  assert.deepEqual(first.started, ["listing", "comparison:xero.com", "video"]);
  assert.equal(f.tables.answer_listing_kits.length, 1);
  assert.equal(f.tables.answer_pages.length, 1);
  assert.deepEqual(f.tables.answer_pages[0].comparisonWith, { name: "Xero", domain: "xero.com" });
  assert.equal(f.tables.answer_videos.length, 1);
  assert.equal(f.tables.answer_videos[0].version, 2);
  const scheduled = f.tables._scheduled_functions.map((s) => s.name);
  for (const name of ["actions/answerGrowthKit:makeListingKit", "actions/answerGrowthKit:writeComparison", "actions/answerGrowthKit:makeVideoKit"]) {
    assert.ok(scheduled.includes(name), `${name} scheduled`);
  }

  const second = await f.invoke("answerGrowthKit:autoWork", { siteId });
  assert.deepEqual(second.started, ["comparison:myob.com"], "the next day: the next rival's page; the listing and this week's video are already started");
  assert.equal(f.tables.answer_listing_kits.length, 1);
  assert.equal(f.tables.answer_videos.length, 1);
});

test("the hourly pass starts the day's work for sites on the plan, once a day, never for the free hour", async () => {
  const f = corePipelineFixture(async () => new Response("{}", { status: 200 }), {}, {});
  const now = f.now();
  const site = (userId: string, domain: string, growthPreparedAt: number) => f.add("sites", { domain, userId, siteName: domain, publishMethod: "manual", createdAt: now, updatedAt: now,
    answers: { enabled: true, enabledAt: now, source: "signup", confirmedAt: now, country: "US", lastSnapshotRunId: "answer_runs:0", lastFullRunAt: now, lastRecheckAt: now, growthPreparedAt } });
  const due = site("user_plumber", "riversideplumbing.example", now - 25 * 3_600_000);
  const fresh = site("user_bakery", "sourdoughco.example", now - 2 * 3_600_000);
  const free = site("user_free", "freeco.example", 0);
  for (const userId of ["user_plumber", "user_bakery"]) f.add("account_plan_entitlements", { userId, planFeatures: ["pentra_answers"], maxSites: 1, maxArticles: 0, syncVersion: 1, syncStartedAt: now });
  await f.invoke("answersDispatch:dispatch", {});
  const work = f.tables._scheduled_functions.filter((s) => s.name === "actions/answerGrowth:prepare" || s.name === "answerGrowthKit:autoWork");
  assert.deepEqual(work.map((s) => [s.name, s.args.siteId]).sort(), [["actions/answerGrowth:prepare", due], ["answerGrowthKit:autoWork", due]]);
  assert.ok((f.get(due)!.answers.growthPreparedAt ?? 0) >= now, "the day's work is marked started");
  assert.ok(fresh && free);
});
