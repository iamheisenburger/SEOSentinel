// Pentra Answers (Nov 2026): the engine's pure core. Every count Pentra shows is computed by these rules from stored
// answers, so they are pinned here: how each assistant's reply is read, who an answer names and cites, honest totals,
// which questions are winnable, spend caps, the page contract, publishing files and the weekly email.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_ASSISTANTS, ANSWER_ENDPOINTS, answerSlug, assistantRequest, brandMatcher, cleanQuestion, cleanSourceUrl, excerptAround, judgeAnswer,
  parseAssistantReply, questionKey, questionOpportunity, runTotals,
} from "../convex/lib/answerEngine.ts";
import { answersAccess, answersAllows, answersEnabled, competitorFromDomain, spendFits, ANSWERS_FREE_ACCOUNT_CAP_MICRO_USD,
  ANSWERS_SITE_MONTHLY_CAP_MICRO_USD } from "../convex/lib/answersAccess.ts";
import { parseQuestions, questionsRequest } from "../convex/lib/answerQuestions.ts";
import { answerPageRequest, checkDraftPage, pageSource, parseDraftPage, uniqueSlug } from "../convex/lib/answerPages.ts";
import { defaultContentDir, githubAnswerFile, hostedPageUrl, indexNowRequest, publicPageUrl, urlStructureOf, validHostedDomain } from "../convex/lib/answerPublishing.ts";
import { answersReadyEmail, answersWeeklyEmail } from "../convex/lib/answersWeekly.ts";

const business = { name: "Dawnlist", domain: "dawnlist.io" };
const competitors = [{ name: "Apollo", domain: "apollo.io" }, { name: "Hunter", domain: "hunter.io" }];

test("five assistants, never Copilot, each through a provider measured to work", () => {
  assert.deepEqual([...ANSWER_ASSISTANTS], ["chatgpt", "perplexity", "gemini", "google_ai_mode", "google_ai_overview"]);
  assert.equal(ANSWER_ENDPOINTS.chatgpt, "cloro.ai-search.chatgpt.scrape", "not crawl4ai, which succeeded 3.9% of the time");
  assert.deepEqual(assistantRequest("chatgpt", "Q?", "GB").body, { prompt: "Q?", country: "GB", include: { markdown: true } });
  assert.deepEqual(assistantRequest("google_ai_overview", "Q?", "US").body, { query: "Q?", gl: "US", pages: 1, include: { aioverview: true } });
  assert.equal(assistantRequest("perplexity", "Q?", "US").body.input, "Q?", "the question as asked, nothing added");
});

test("each provider's reply is read: text and sources, tracking stripped, provider links dropped", () => {
  const chatgpt = parseAssistantReply("chatgpt", { success: true, result: { text: "Use Dawnlist or Apollo.", sources: [
    { position: 1, label: "Guide", url: "https://blog.example.com/guide?utm_source=chatgpt.com" }],
    citationPills: [{ url: "https://blog.example.com/guide?utm_source=chatgpt.com", label: "Guide" }, { url: "https://www.google.com/search?q=x" }] } });
  assert.deepEqual(chatgpt, { kind: "answer", text: "Use Dawnlist or Apollo.", sources: [{ url: "https://blog.example.com/guide", title: "Guide" }] });
  const perplexity = parseAssistantReply("perplexity", { output: [{ type: "message", content: [{ type: "output_text", text: "Try Hunter [1].",
    annotations: [{ type: "url_citation", url: "https://hunter.io/", title: "Hunter" }] }] }] });
  assert.equal(perplexity?.kind, "answer");
  assert.deepEqual(perplexity?.kind === "answer" ? perplexity.sources : [], [{ url: "https://hunter.io/", title: "Hunter" }]);
  assert.deepEqual(parseAssistantReply("google_ai_overview", { success: true, result: { organicResults: [] } }),
    { kind: "none", reason: "Google showed no AI Overview for this search" });
  const overview = parseAssistantReply("google_ai_overview", { success: true, result: { aiOverview: { text: "Overview names Apollo.", sources: [{ url: "https://x.example/a", title: "A" }] } } });
  assert.deepEqual(overview, { kind: "answer", text: "Overview names Apollo.", sources: [{ url: "https://x.example/a", title: "A" }] });
  assert.equal(parseAssistantReply("gemini", null), null);
  assert.equal(cleanSourceUrl("javascript:alert(1)"), null);
});

test("an answer is judged once, the same way everywhere: named, cited, position, competitors, own pages", () => {
  const judged = judgeAnswer({ text: "For local leads, Apollo is popular. Dawnlist sends 15 leads a day. Hunter finds emails. Instantly, you can start.",
    sources: [{ url: "https://dawnlist.io/blog/find-clients", title: "Find clients" }, { url: "https://g2.com/x" }] }, business, [...competitors, { name: "Instantly", domain: "instantly.ai" }]);
  assert.equal(judged.named, true);
  assert.equal(judged.cited, true);
  assert.deepEqual(judged.citedPageUrls, ["https://dawnlist.io/blog/find-clients"]);
  assert.equal(judged.position, 2, "named second, after Apollo");
  assert.deepEqual(judged.competitorsNamed, ["Apollo", "Hunter", "Instantly"]);
  const lower = judgeAnswer({ text: "you can instantly see results with apollo-style tools", sources: [] }, business, [{ name: "Instantly", domain: "instantly.ai" }]);
  assert.deepEqual(lower.competitorsNamed, [], "an everyday word in lowercase is not the brand");
  assert.equal(lower.named, false);
  assert.equal(brandMatcher({ name: "LeadPilot" })!.test("try Lead Pilot today") >= 0, true);
  assert.ok(excerptAround("a ".repeat(800) + "Dawnlist" + " b".repeat(800), 1600).includes("Dawnlist"));
});

test("totals count only the answers given, keep every denominator, and list who is named instead", () => {
  const c = (assistant: string, status: string, named = false, rivals: string[] = []) =>
    ({ assistant, status, named, cited: false, competitorsNamed: rivals, sources: [{ domain: "g2.com", own: false }] });
  const totals = runTotals([c("chatgpt", "answered", true), c("chatgpt", "answered", false, ["Apollo"]), c("gemini", "answered", false, ["Apollo", "Hunter"]),
    c("google_ai_overview", "no_answer"), c("perplexity", "error")]);
  assert.equal(totals.asked, 5);
  assert.equal(totals.answered, 3);
  assert.equal(totals.named, 1);
  assert.equal(totals.noAnswer, 1);
  assert.equal(totals.failed, 1);
  assert.deepEqual(totals.competitors, [{ name: "Apollo", named: 2 }, { name: "Hunter", named: 1 }]);
  assert.deepEqual(totals.byAssistant.find((a) => a.assistant === "chatgpt"), { assistant: "chatgpt", asked: 2, answered: 2, named: 1, cited: 0 });
  assert.deepEqual(totals.topSources, [{ domain: "g2.com", answers: 3 }]);
});

test("a question is winnable from its answers, covered when most name the business, with plain reasons", () => {
  const notNamed = (rivals: string[], domain = "smallblog.example", title = "Some page") =>
    ({ status: "answered", named: false, cited: false, competitorsNamed: rivals, sources: [{ domain, own: false, title }] });
  const winnable = questionOpportunity("How do I find local businesses that need a new website?", [notNamed(["Apollo"]), notNamed([]), notNamed(["Hunter"])]);
  assert.equal(winnable.status, "winnable");
  assert.ok(winnable.reasons[0].startsWith("Not named in any of 3 answers"));
  const covered = questionOpportunity("Best lead tool?", [{ ...notNamed([]), named: true }, { ...notNamed([]), named: true }, notNamed([])]);
  assert.equal(covered.status, "covered");
  const big = questionOpportunity("What is a CRM?", [notNamed([], "wikipedia.org"), notNamed([], "hubspot.com"), notNamed([], "reddit.com")]);
  assert.notEqual(big.status, "winnable", "answers that lean on big sites only are monitored");
  assert.equal(questionOpportunity("Q?", []).status, "monitoring");
});

test("questions are kept clean: real questions, never naming the business, once each", () => {
  assert.equal(cleanQuestion("what's the best tool for finding local leads?", business), "What's the best tool for finding local leads?");
  assert.equal(cleanQuestion("Is Dawnlist good?", business), null);
  assert.equal(cleanQuestion("find leads", business), null);
  assert.equal(questionKey("Best tool, for leads?"), questionKey("best tool for leads"));
  const parsed = parseQuestions({ questions: [{ question: "How do I find web design clients?", intent: "how_to" }, { question: "how do I find web design clients", intent: "how_to" },
    { question: "Is dawnlist.io legit?", intent: "problem" }, { question: "What does a lead list cost per month?", intent: "made_up" }] }, business, [], 10);
  assert.deepEqual(parsed, [{ question: "How do I find web design clients?", intent: "how_to" }, { question: "What does a lead list cost per month?", intent: "problem" }]);
  const request = questionsRequest({ ...business, summary: "Leads", audience: "Agencies", features: [], problems: [], usage: "", pricing: "", market: "US", siteType: "",
    language: "en", competitors }, 30, []);
  assert.match(request.system, /Never name the business itself \(Dawnlist, dawnlist\.io\)/);
  assert.match(request.system, /Apollo, Hunter/);
  assert.equal(answerSlug("How do I find local businesses that need a new website?"), "find-local-businesses-that-need-a-new-website");
  assert.equal(uniqueSlug("Best lead tool?", new Set(["best-lead-tool"])), "best-lead-tool-2");
});

test("access: Pentra's own sites run Answers by code; the plan publishes and re-asks; the free hour is one snapshot", () => {
  assert.equal(answersEnabled({ domain: "https://www.dawnlist.io/" }), true);
  assert.equal(answersEnabled({ domain: "estiflow.example" }), false, "existing customers keep their service until they switch");
  assert.equal(answersEnabled({ domain: "new.example", answers: { enabled: true } }), true);
  assert.equal(answersAccess({ domain: "pentra.dev" }, []), "owner");
  assert.equal(answersAccess({ domain: "new.example" }, ["pentra_answers"]), "paid");
  assert.equal(answersAccess({ domain: "new.example" }, ["max_sites_3"]), "free");
  assert.deepEqual(answersAllows("free"), { snapshot: true, drafts: true, publish: false, recheck: false, weekly: false });
  assert.deepEqual(competitorFromDomain("https://www.apollo.io"), { name: "Apollo", domain: "apollo.io" });
  assert.deepEqual(competitorFromDomain("app.hubspot.com"), { name: "Hubspot", domain: "app.hubspot.com" });
  assert.deepEqual(competitorFromDomain("copy.ai"), { name: "Copy.ai", domain: "copy.ai" }, "a short name keeps its ending: the brand, not the word");
  assert.deepEqual(competitorFromDomain("jasper.ai"), { name: "Jasper", domain: "jasper.ai" }, "answers write Jasper as Jasper");
  const copy = judgeAnswer({ text: "Copy the steps below. Tools like Copy.ai and Jasper write drafts.", sources: [] }, business,
    [competitorFromDomain("copy.ai")!, competitorFromDomain("jasper.ai")!]);
  assert.deepEqual(copy.competitorsNamed, ["Copy.ai", "Jasper"], "\"Copy the steps\" is not Copy.ai");
});

test("spend: a free account gets one snapshot's budget, a paid site a month's, the service a daily breaker", () => {
  const base = { holdMicroUsd: 500_000, accountFreeSpent: 0, siteMonthSpent: 0, fleetDaySpent: 0, fleetDailyCap: 60_000_000 };
  assert.deepEqual(spendFits({ ...base, access: "free" }), { ok: true });
  assert.deepEqual(spendFits({ ...base, access: "free", accountFreeSpent: ANSWERS_FREE_ACCOUNT_CAP_MICRO_USD }), { ok: false, reason: "free_snapshot_budget" });
  assert.deepEqual(spendFits({ ...base, access: "paid", siteMonthSpent: ANSWERS_SITE_MONTHLY_CAP_MICRO_USD }), { ok: false, reason: "site_monthly_cap" });
  assert.deepEqual(spendFits({ ...base, access: "owner", fleetDaySpent: 60_000_000 }), { ok: false, reason: "fleet_daily_cap" });
  assert.deepEqual(spendFits({ ...base, access: "paid", holdMicroUsd: 0 }), { ok: false, reason: "invalid_hold" });
});

test("an answer page: sources numbered from what it cites, facts tied to their sources, objective checks only block", () => {
  const sources = [pageSource(1, "https://a.example/guide", "Guide", "Agencies that email prospects get 8.4% replies on average in 2026. ".repeat(10), 1),
    pageSource(2, "https://b.example/list", "List", "Local businesses with slow sites are common. ".repeat(10), 1)];
  const body = ["Dawnlist finds local businesses that show a measured sign they need your service, so your first email can cite the proof.", "",
    "## What should I look for?", "", "Reply rates average 8.4% for cold outreach [1]. Slow websites are a common sign [2].", "",
    "## How Dawnlist handles this", "", "Dawnlist sends a short list every weekday morning.", "", ...Array.from({ length: 60 }, (_, i) => `Practical point ${i} about choosing well.`)].join("\n");
  const draft = parseDraftPage({ title: "How do I find local businesses that need a new website?", metaDescription: "Look for measured signs.", markdown: body,
    facts: [{ text: "Reply rates average 8.4%", source: "source", sourceNumber: 1 }, { text: "Dawnlist sends a list every weekday", source: "business" }] }, sources)!;
  assert.match(draft.markdown, /## Sources\n\n1\. \[Guide\]\(https:\/\/a\.example\/guide\)\n2\. \[List\]\(https:\/\/b\.example\/list\)/);
  assert.deepEqual(draft.facts[0], { text: "Reply rates average 8.4%", source: "source", url: "https://a.example/guide" });
  const evidence = "Name: Dawnlist\nDomain: dawnlist.io\nSummary: Daily leads with proof.";
  assert.deepEqual(checkDraftPage(draft, { businessName: "Dawnlist", businessDomain: "dawnlist.io", sources, productEvidence: evidence }).blocking, []);
  const wrongNumber = { ...draft, markdown: draft.markdown.replace("8.4%", "31%") };
  assert.ok(checkDraftPage(wrongNumber, { businessName: "Dawnlist", businessDomain: "dawnlist.io", sources, productEvidence: evidence }).blocking
    .some((issue) => /state a number their source does not contain/.test(issue)), "a number its source doesn't contain blocks");
  const unnamed = { ...draft, markdown: draft.markdown.replace(/Dawnlist/g, "the tool") };
  assert.ok(checkDraftPage(unnamed, { businessName: "Dawnlist", businessDomain: "dawnlist.io", sources, productEvidence: evidence }).blocking.includes("The page never names Dawnlist."));
  const request = answerPageRequest({ question: "Q?", businessName: "Dawnlist", productEvidence: evidence, market: "US", language: "en", landscape: [], sources, mayName: [] });
  assert.match(request.system, /trust the live pages and leave the conflicting claim out/);
  assert.match(request.system, /Never invent features, prices, customers, results, reviews/);
});

test("publishing: the blog's own layout when detected, Pentra's default otherwise; hosted addresses are the site's subdomains", () => {
  const page = { title: "Find web design clients", slug: "find-web-design-clients", metaDescription: "How.", markdown: "Body [1].\n\n## Sources\n\n1. [A](https://a.example)",
    sources: [{ n: 1, url: "https://a.example", title: "A" }], firstPublishedAt: Date.UTC(2026, 10, 8), deliveryKey: "answer:x:v1" };
  const plain = githubAnswerFile(page, { domain: "dawnlist.io" });
  assert.equal(plain.path, "content/blog/find-web-design-clients.md");
  assert.equal(plain.url, "https://dawnlist.io/blog/find-web-design-clients");
  assert.match(plain.content, /^---\ntitle: "Find web design clients"\ndescription: "How\."\ngenerator: "pentra"\npentraDeliveryKey: "answer:x:v1"\nstatus: "published"/);
  // Blogs built to read Pentra's article files (LeadPilot's) hide a post without qualityGateVersion.
  assert.match(plain.content, /\nstatus: "published"\nqualityGateVersion: 1\ncanonicalUrl: "https:\/\/dawnlist\.io\/blog\/find-web-design-clients"\n/);
  const layout = { version: 1, framework: "nextjs", postsDir: "posts", fileName: "slug", extension: ".md", urlStructure: "/articles/[slug]",
    fields: [{ key: "title", from: "title" }, { key: "summary", from: "description" }, { key: "layout", from: "copy", raw: "layout: post" }], sample: { path: "", slug: "", title: "" } };
  const mirrored = githubAnswerFile(page, { domain: "dawnlist.io", githubLayout: layout });
  assert.equal(mirrored.path, "posts/find-web-design-clients.md");
  assert.equal(mirrored.url, "https://dawnlist.io/articles/find-web-design-clients");
  assert.match(mirrored.content, /^---\ntitle: "Find web design clients"\nsummary: "How\."\nlayout: post\npentraDeliveryKey/);
  assert.throws(() => githubAnswerFile({ ...page, slug: "../evil" }, { domain: "dawnlist.io" }));
  assert.equal(urlStructureOf({ urlStructure: "/guides" }), "/guides/[slug]");
  assert.equal(defaultContentDir("/[slug]"), "content/blog");
  assert.equal(publicPageUrl("www.dawnlist.io", "/blog/[slug]", "x"), "https://dawnlist.io/blog/x");
  assert.equal(validHostedDomain("answers.dawnlist.io", "dawnlist.io"), "answers.dawnlist.io");
  assert.equal(validHostedDomain("dawnlist.io", "dawnlist.io"), null);
  assert.equal(validHostedDomain("answers.evil.com", "dawnlist.io"), null);
  assert.equal(validHostedDomain("help.dawnlist.io", "dawnlist.io"), null, "always answers.<domain>, so the site routes it without a lookup");
  assert.equal(validHostedDomain("https://Answers.dawnlist.io/", "www.dawnlist.io"), "answers.dawnlist.io");
  assert.equal(hostedPageUrl("answers.dawnlist.io", "x"), "https://answers.dawnlist.io/x");
  assert.deepEqual(indexNowRequest("https://answers.dawnlist.io/x", "k", "https://answers.dawnlist.io/pentra-indexnow.txt", ["https://answers.dawnlist.io/x"]).body,
    { host: "answers.dawnlist.io", key: "k", keyLocation: "https://answers.dawnlist.io/pentra-indexnow.txt", urlList: ["https://answers.dawnlist.io/x"] });
});

test("the weekly email states counts with their denominators, says 'no change' plainly, and never promises", () => {
  const email = answersWeeklyEmail({ name: "Dawnlist", domain: "dawnlist.io",
    thisWeek: { answered: 140, named: 6, byAssistant: [{ assistant: "chatgpt", answered: 30, named: 2 }], competitors: [{ name: "Apollo", named: 41 }] },
    lastWeek: { answered: 140, named: 6 }, citations: [{ assistant: "perplexity", question: "How do I find web design clients?", title: "Find clients", at: Date.UTC(2026, 10, 12) }],
    published: [{ title: "Find clients", url: "https://dawnlist.io/blog/find-clients" }], rewritten: [], questionsAdded: 3, dashboardUrl: "https://pentra.dev/dashboard" });
  assert.equal(email.subject, "Named in 6 of 140 AI answers this week · dawnlist.io");
  assert.match(email.text, /Last week: 6 of 140 \(no change\)\./);
  assert.match(email.text, /- ChatGPT: 2 of 30/);
  assert.match(email.text, /- Perplexity cited "Find clients" for "How do I find web design clients\?" \(2026-11-12\)/);
  assert.match(email.text, /We can't make an assistant recommend you\./);
});

test("a business is found under the punctuation answers use: ampersands, apostrophes, hyphens", () => {
  const deck = brandMatcher({ name: "Lone Star Deck & Fence", domain: "lonestardeck.example" })!;
  assert.ok(deck.test("For a new fence, Lone Star Deck & Fence is well reviewed.") >= 0);
  assert.ok(deck.test("Try Lone Star Deck and Fence") < 0, "a different word between is a different name");
  const lowes = brandMatcher({ name: "Lowe's" })!;
  for (const text of ["Lowe's carries it.", "Lowe’s carries it.", "Lowes carries it."]) assert.ok(lowes.test(text) >= 0, text);
  assert.ok(brandMatcher({ name: "HubSpot" })!.test("Hub-Spot and others") >= 0);
  assert.ok(brandMatcher({ name: "Dawnlist" })!.test("Dawnlisting is not it") < 0, "a longer word is not the name");
});

test("the first-hour email: counts with denominators, the drafts, and one next step per account", () => {
  const input = { name: "Acme", domain: "acme.example", questions: 30, answered: 120, named: 9,
    byAssistant: [{ assistant: "chatgpt", answered: 30, named: 2 }, { assistant: "google_ai_overview", answered: 18, named: 0 }],
    competitors: [{ name: "Apollo", named: 40 }], drafts: [{ title: "How do I find leads?" }], writing: 2, next: "free" as const,
    dashboardUrl: "https://pentra.dev/dashboard", billingUrl: "https://pentra.dev/dashboard/billing", settingsUrl: "https://pentra.dev/dashboard/settings#publishing" };
  const free = answersReadyEmail(input);
  assert.equal(free.subject, "Your first hour: named in 9 of 120 AI answers · acme.example");
  assert.match(free.text, /Acme was named in 9 of 120 answers\./);
  assert.match(free.text, /- ChatGPT: 2 of 30\n- Google AI Overviews?: 0 of 18/);
  assert.match(free.text, /- Apollo: 40 of 120/);
  assert.match(free.text, /drafted for the questions you can win: 1\n- How do I find leads\?\n\(2 more are still being written\.\)/);
  assert.match(free.text, /\$249 a month\): https:\/\/pentra\.dev\/dashboard\/billing/);
  assert.doesNotMatch(free.text, /guarantee|will rank|will be recommended/i, "never a promise");
  assert.match(answersReadyEmail({ ...input, next: "publishing" }).text, /publish to your site automatically/);
  assert.match(answersReadyEmail({ ...input, next: "connect" }).text, /settings#publishing/);
  assert.doesNotMatch(answersReadyEmail({ ...input, next: "publishing" }).text, /\$249/);
});
