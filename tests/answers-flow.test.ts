// Pentra Answers (Nov 2026), end to end on the real handlers: the owner confirms, Pentra writes the questions, asks the five
// assistants (each answer stored as proof the moment it arrives), totals the run honestly, picks the winnable questions,
// writes pages from fetched sources and the business's facts, publishes them to the site's GitHub blog, and checks them
// live before IndexNow. Providers are synthetic; spend is held and settled at their reported cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { corePipelineFixture, type Fields } from "./helpers/core-pipeline-fixture.ts";

const json = (body: unknown, cost?: number, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json", ...(cost !== undefined ? { "X-Treg-Cost-Micro": String(cost) } : {}) } });
const html = (text: string) => new Response(`<html><head><title>Page</title></head><body><main>${text}</main></body></html>`,
  { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const QUESTIONS = ["How do I find local businesses that need a new website?", "What's the best tool to find clients for a web design agency?",
  "How much does a lead list for agencies cost per month?", "How do I find small businesses with slow websites?", "Which lead tool gives the owner's email address?",
  "How do I find businesses that need IT support near me?", "What are alternatives to Apollo for local agencies?", "How do SEO agencies find new local clients?",
  "How do I know a local business needs a new website?", "What's a good way to get clients for an accessibility audit service?",
  "How can a booking software company find salons without online booking?", "Where can I find restaurants that need a better website?"];
const PAGE_BODY = ["Acme Leads finds local businesses that show a measured sign they need a new website, so you can contact them with the proof.", "",
  "## What signs show a business needs a new website?", "", "Slow mobile pages and missing HTTPS are the clearest signs. Cold outreach that cites a specific problem gets more replies; reply rates average 8.4% in 2026 [1].", "",
  "## How Acme Leads handles this", "", "Acme Leads sends a short list of businesses each weekday with the sign it measured and the owner's contact.", "",
  ...Array.from({ length: 70 }, (_, i) => `Practical step ${i + 1}: check one more thing before you send the first email.`),
  "", "## FAQ", "", "### Is it free to try?", "", "Yes, the first list is free."].join("\n");

function network(calls: Array<{ url: string; body?: Fields }>) {
  return async (url: URL, init: RequestInit) => {
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.href, ...(body ? { body } : {}) });
    if (url.hostname === "treg.to") {
      const endpoint = url.pathname.replace("/call/", "");
      if (endpoint === "cloro.ai-search.chatgpt.scrape") return json({ success: true, result: { text: "Agencies often use Apollo to find leads. A lead guide explains more.",
        sources: [{ label: "Lead guide", url: "https://leads.example/guide?utm_source=chatgpt.com" }] } }, 2800);
      if (endpoint === "perplexity.web.answer.fast") return json({ output: [{ type: "message", content: [{ type: "output_text",
        text: "Acme Leads finds local businesses with slow websites [1].", annotations: [{ type: "url_citation", url: "https://acme.example/blog/older-post", title: "Acme" }] }] }] }, 1300);
      if (endpoint === "cloro.ai-search.gemini.scrape") return json({ success: true, result: { text: "Hunter and Apollo are common choices.",
        sources: [{ url: "https://leads.example/guide", label: "Lead guide" }] } }, 2400);
      if (endpoint === "cloro.google.serp.ai_mode") return json({ success: true, result: { text: "Try a lead list built for agencies.", sources: [] } }, 2400);
      if (endpoint === "cloro.google.serp.organic") return json({ success: true, result: { organicResults: [] } }, 2000);
      throw new Error(`unexpected treg endpoint ${endpoint}`);
    }
    if (url.hostname === "api.anthropic.com") {
      const tool = body.tools[0].name;
      if (tool === "submit_business_read") return json({ id: "msg_0", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "tool_use", id: "tool_0", name: tool, input: { name: "Newco", sells: "Daily lists of local businesses that need web design, with proof.",
          buyers: "Web design agencies", offerings: ["Daily lead lists", "Verified emails"], country: "US", local: false, location: "",
          competitors: [{ name: "Apollo", domain: "apollo.example" }, { name: "Newco", domain: "newco.example" }] } }], usage: { input_tokens: 3000, output_tokens: 300 } });
      const input = tool === "submit_buyer_questions"
        ? { questions: QUESTIONS.map((question) => ({ question, intent: "how_to" })) }
        : { title: "How do I find local businesses that need a new website?", metaDescription: "Look for measured signs like slow mobile pages.", markdown: PAGE_BODY,
          facts: [{ text: "Reply rates average 8.4% in 2026", source: "source", sourceNumber: 1 }, { text: "Acme Leads sends a list each weekday", source: "business" }] };
      return json({ id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "tool_use", id: "tool_1", name: tool, input }], usage: { input_tokens: 4000, output_tokens: 2000 } });
    }
    if (url.hostname === "newco.example") return html("Newco: daily lists of local businesses that need web design, with the proof attached. ".repeat(20));
    if (url.hostname === "leads.example") return html("Cold outreach that names a specific problem gets more replies. Reply rates average 8.4% in 2026 across agencies. ".repeat(12));
    if (url.hostname === "acme.example") {
      if (url.pathname.startsWith("/blog/")) return html("How do I find local businesses that need a new website? Acme Leads finds local businesses.");
      return html("Acme Leads: daily lists of local businesses that need your service, with the proof. The first list is free. ".repeat(10));
    }
    if (url.hostname === "api.github.com") {
      if (init.method === "GET") return json({ message: "Not Found" }, undefined, 404);
      return json({ content: {}, commit: { sha: "abc123", html_url: "https://github.com/acme/site/commit/abc123" } }, undefined, 201);
    }
    if (url.hostname === "api.indexnow.org") return new Response("", { status: 202 });
    throw new Error(`unexpected network ${url.href}`);
  };
}

async function drain(f: ReturnType<typeof corePipelineFixture>, untilMs = 0) {
  for (let guard = 0; guard < 400; guard++) {
    const ran = await f.runNextScheduled();
    if (ran) continue;
    const pending = f.tables._scheduled_functions.filter((r) => r.state.kind === "pending").sort((a, b) => a.at - b.at)[0];
    if (!pending || pending.at > f.now() + untilMs) return;
    f.setTime(pending.at);
  }
  assert.fail("scheduled work never settled");
}

test("the first hour and the plan, end to end: questions, five assistants, proof, totals, pages, publish, live check", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(network(calls), { TREG_TOKEN: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org"] });
  const now = f.now();
  const siteId = f.add("sites", { domain: "acme.example", userId: "user_acme", siteName: "Acme Leads", siteSummary: "Daily lists of local businesses that need your service.",
    targetAudienceSummary: "Web design agencies", keyFeatures: ["Daily lead lists"], targetCountry: "United States", publishMethod: "github", githubToken: "synthetic-only",
    repoOwner: "acme", repoName: "site", repoDefaultBranch: "main", urlStructure: "/blog/[slug]", competitors: ["apollo.example"],
    answers: { enabled: true, enabledAt: now, source: "signup" }, createdAt: now, updatedAt: now });
  f.add("account_plan_entitlements", { userId: "user_acme", planFeatures: ["pentra_answers"], maxSites: 1, maxArticles: 0, syncVersion: 1, syncStartedAt: now });

  f.setIdentity("user_acme");
  await f.invoke("answers:confirmSetup", { siteId, competitors: [{ name: "Apollo", domain: "apollo.example" }, { name: "Hunter", domain: "hunter.example" }], country: "US" });
  f.setIdentity(null);
  await drain(f, 10 * 60_000);

  const runs = f.tables.answer_runs;
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(run.kind, "snapshot");
  assert.equal(run.status, "done");
  assert.equal(run.done, QUESTIONS.length * 5, "every question to every assistant");
  assert.equal(run.noAnswer, QUESTIONS.length, "no AI Overview is a no-answer, never 'not named'");
  assert.equal(run.answered, QUESTIONS.length * 4);
  assert.equal(run.named, QUESTIONS.length, "Perplexity named Acme Leads (and cited its page) in each answer");
  assert.equal(run.cited, QUESTIONS.length);
  assert.deepEqual(run.competitors.slice(0, 2), [{ name: "Apollo", named: QUESTIONS.length * 2 }, { name: "Hunter", named: QUESTIONS.length }]);
  assert.equal(f.tables.answer_texts.length, QUESTIONS.length * 4, "every answer's full text kept as proof");
  const chatgptCheck = f.tables.answer_checks.find((c) => c.assistant === "chatgpt")!;
  assert.deepEqual(chatgptCheck.sources, [{ url: "https://leads.example/guide", title: "Lead guide", domain: "leads.example", own: false }]);
  assert.deepEqual(chatgptCheck.competitorsNamed, ["Apollo"]);
  assert.ok(f.tables.answer_questions.every((q) => q.latest && q.opportunity), "each question carries its latest result and opportunity");

  const pages = f.tables.answer_pages;
  assert.equal(pages.length, 5, "the first hour writes five pages");
  for (const page of pages) {
    assert.equal(page.status, "published", page.notWrittenReason ?? page.publishError ?? "");
    assert.match(page.markdown, /## Sources\n\n1\. \[Lead guide\]\(https:\/\/leads\.example\/guide\)/);
    assert.ok(page.facts.some((fact: Fields) => fact.url === "https://leads.example/guide"), "facts keep their source address");
    assert.match(page.publishedUrl, /^https:\/\/acme\.example\/blog\//);
  }
  // The first live page places the site's IndexNow key file; every later one is submitted with it.
  assert.deepEqual(pages.map((p) => p.indexNow?.status).sort(), ["key_committed", "submitted", "submitted", "submitted", "submitted"]);
  assert.equal(calls.filter((c) => c.url === "https://api.indexnow.org/indexnow").length, 4);
  const commits = calls.filter((c) => c.url.startsWith("https://api.github.com/repos/acme/site/contents/") && c.body?.content);
  assert.ok(commits.some((c) => /^content\/blog\/.+\.md$/.test(decodeURIComponent(c.url.split("/contents/")[1]))));
  const committed = Buffer.from(commits.find((c) => c.url.includes("/content/blog/"))!.body!.content, "base64").toString("utf8");
  assert.match(committed, /^---\ntitle: "How do I find local businesses that need a new website\?"\ndescription: ".+"\ngenerator: "pentra"/);

  const spend = f.tables.answer_spend;
  assert.ok(spend.length > 0 && spend.every((r) => r.state === "settled"), "every hold settled");
  const asked = spend.filter((r) => r.purpose === "ask").reduce((sum, r) => sum + r.actualMicroUsd, 0);
  assert.equal(asked, QUESTIONS.length * (2800 + 1300 + 2400 + 2400 + 2000), "settled at the providers' reported cost");
  assert.equal(f.tables.answer_spend_days.length, 1);
  assert.equal(f.tables.answer_spend_days[0].microUsd, spend.reduce((sum, r) => sum + r.actualMicroUsd, 0), "the day's total is exactly what was spent");

  f.setIdentity("user_acme");
  const overview = await f.invoke("answers:overview", { siteId });
  assert.equal(overview.access, "paid");
  assert.equal(overview.runs[0].named, QUESTIONS.length);
  assert.equal(overview.pages.length, 5);
  assert.ok(overview.pages.every((p: Fields) => typeof p.liveAt === "number" && p.liveAt >= p.publishedAt), "each page's live date, from Pentra's own load of it");
  assert.equal(overview.site.nextRunAt, f.get(siteId)!.answers.lastFullRunAt + 7 * 86_400_000, "the weekly run, a week after the first hour");
  const progress = await f.invoke("answers:runProgress", { runId: run._id });
  const per = Object.fromEntries(progress.perAssistant.map((p: Fields) => [p.assistant, p]));
  assert.deepEqual(per.perplexity, { assistant: "perplexity", total: QUESTIONS.length, done: QUESTIONS.length, answered: QUESTIONS.length, named: QUESTIONS.length });
  assert.deepEqual(per.chatgpt, { assistant: "chatgpt", total: QUESTIONS.length, done: QUESTIONS.length, answered: QUESTIONS.length, named: 0 });
  assert.deepEqual(per.google_ai_overview, { assistant: "google_ai_overview", total: QUESTIONS.length, done: QUESTIONS.length, answered: 0, named: 0 },
    "no AI Overview counts as asked, never as answered");
  const evidence = await f.invoke("answers:questionEvidence", { questionId: f.tables.answer_questions[0]._id });
  assert.equal(evidence.checks.length, 5, "every count opens to its answers");
  const full = await f.invoke("answers:answerText", { checkId: chatgptCheck._id });
  assert.equal(full.text, "Agencies often use Apollo to find leads. A lead guide explains more.");
  f.setIdentity("someone_else");
  assert.equal(await f.invoke("answers:overview", { siteId }), null, "another account sees nothing");
  f.assertOffline();
});

test("the free first hour keeps its pages as drafts and never re-asks; the plan is what publishes", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(network(calls), { TREG_TOKEN: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org"] });
  const now = f.now();
  const siteId = f.add("sites", { domain: "acme.example", userId: "user_free", siteName: "Acme Leads", siteSummary: "Daily lists of local businesses.",
    publishMethod: "github", githubToken: "synthetic-only", repoOwner: "acme", repoName: "site", repoDefaultBranch: "main", answers: { enabled: true, enabledAt: now, source: "signup" },
    createdAt: now, updatedAt: now });
  f.setIdentity("user_free");
  await f.invoke("answers:confirmSetup", { siteId, competitors: [{ name: "Apollo" }] });
  f.setIdentity(null);
  await drain(f, 60_000);
  assert.equal(f.tables.answer_runs.length, 1);
  assert.equal(f.tables.answer_pages.length, 5);
  assert.ok(f.tables.answer_pages.every((p) => p.status === "draft"), "drafts, not published");
  assert.equal(calls.filter((c) => c.url.includes("api.github.com")).length, 0, "nothing written to the site");
  f.setIdentity("user_free");
  await assert.rejects(f.invoke("answers:runNow", { siteId }), /part of the Pentra plan/);
  await assert.rejects(f.invoke("answerPages:publishDraft", { pageId: f.tables.answer_pages[0]._id }), /part of the Pentra plan/);
  f.setIdentity(null);
  await f.invoke("answersDispatch:dispatch", {});
  await drain(f, 60_000);
  assert.equal(f.tables.answer_runs.length, 1, "no weekly run on the free snapshot");
  assert.ok(f.tables.answer_pages.every((p) => p.status === "draft"), "still drafts");
  // The owner upgrades: the next hourly pass publishes the free hour's drafts.
  f.add("account_plan_entitlements", { userId: "user_free", planFeatures: ["pentra_answers"], maxSites: 1, maxArticles: 0, syncVersion: 1, syncStartedAt: f.now() });
  await f.invoke("answersDispatch:dispatch", {});
  await drain(f, 10 * 60_000);
  assert.ok(f.tables.answer_pages.every((p) => p.status === "published"), "published after upgrading");
  f.assertOffline();
});

test("a new account: its website created on Answers, read for the owner to confirm, competitors suggested (never itself)", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(network(calls), { TREG_TOKEN: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org"] });
  f.setIdentity("user_new");
  await assert.rejects(f.invoke("answers:createSite", { domain: "not a domain" }), /Enter your website's address/);
  const { siteId, created } = await f.invoke("answers:createSite", { domain: "https://www.Newco.example/pricing" });
  assert.equal(created, true);
  const site = f.get(siteId)!;
  assert.equal(site.domain, "newco.example");
  assert.equal(site.answers.enabled, true);
  assert.equal(site.autopilotEnabled, false, "the article engine is off for Answers sites");
  f.setIdentity(null);
  await drain(f, 60_000);
  f.setIdentity("user_new");
  const state = await f.invoke("answers:setupState", { siteId });
  assert.equal(state.name, "Newco");
  assert.equal(state.sells, "Daily lists of local businesses that need web design, with proof.");
  assert.deepEqual(state.competitors, [{ name: "Apollo", domain: "apollo.example" }], "the business is never its own competitor");
  assert.equal(state.country, "US");
  assert.equal(state.run, null, "nothing is asked before the owner confirms");
  assert.equal(calls.filter((c) => c.url.includes("treg.to")).length, 0);
  assert.equal((await f.invoke("answers:createSite", { domain: "newco.example" })).created, false, "the same site again is the same site");
  await assert.rejects(f.invoke("answers:createSite", { domain: "another.example" }), /One website per account/);
  assert.deepEqual((await f.invoke("answers:mySites", {})).map((s: Fields) => s.domain), ["newco.example"]);
  f.assertOffline();
});

test("Pentra's own sites: Answers by code with drafts first, then version 2 publishes dawnlist and LeadPilot and restarts pentra.dev", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const f = corePipelineFixture(network(calls), { TREG_TOKEN: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org"] });
  const now = f.now();
  const dawnlist = f.add("sites", { domain: "dawnlist.io", userId: "owner", siteName: "Dawnlist", competitors: ["copy.ai", "apollo.io"], createdAt: now, updatedAt: now });
  const pentra = f.add("sites", { domain: "pentra.dev", userId: "owner", siteName: "Pentra", competitors: ["copy.ai", "jasper.ai"], createdAt: now, updatedAt: now });
  // Version 1 state (what P383 created): Answers on, drafts first, a finished first hour.
  for (const siteId of [dawnlist, pentra]) {
    f.get(siteId)!.answers = { enabled: true, enabledAt: now, source: "owner", confirmedAt: now, autopublish: false, weeklyEmail: true, country: "US",
      competitors: [{ name: "Copy", domain: "copy.ai" }], lastSnapshotRunId: "answer_runs:0" };
    const questionId = f.add("answer_questions", { siteId, question: "How do I find clients?", key: "how do i find clients", intent: "how_to", source: "generated",
      status: "active", createdAt: now });
    f.add("answer_pages", { siteId, questionId, question: "How do I find clients?", status: "draft", title: "How do I find clients?", slug: "find-clients",
      metaDescription: "x", markdown: "x", facts: [], sources: [], issues: [], version: 1, contentHash: "h", writerModel: "m", costMicroUsd: 1, createdAt: now,
      updatedAt: now, citations: 0 });
  }
  await f.invoke("answersDispatch:dispatch", {});
  const d = f.get(dawnlist)!.answers, p = f.get(pentra)!.answers;
  assert.equal(d.ownerVersion, 3, "versions 2 and 3 apply in one pass");
  assert.equal(d.autopublish, true, "dawnlist publishes now that its drafts were read");
  assert.deepEqual(d.competitors, [{ name: "Copy.ai", domain: "copy.ai" }, { name: "Apollo", domain: "apollo.io" }]);
  const scheduled = f.tables._scheduled_functions.map((r) => r.name);
  assert.ok(scheduled.includes("actions/answerPublish:publishPage"), "its drafts go out");
  assert.equal(p.autopublish, false, "pentra.dev stays on drafts until its relaunch is read");
  assert.equal(p.lastSnapshotRunId, undefined, "its first hour runs again");
  assert.deepEqual(p.publishing, { target: "hosted", hostedDomain: "answers.pentra.dev", hostedStatus: "pending_dns" }, "its pages live at answers.pentra.dev");
  assert.ok(f.tables.answer_host_index.some((r) => r.host === "answers.pentra.dev" && r.siteId === pentra));
  assert.ok(f.tables.answer_questions.filter((q) => q.siteId === pentra).every((q) => q.status === "removed"), "old questions set aside, not deleted");
  assert.ok(f.tables.answer_pages.filter((q) => q.siteId === pentra).every((q) => q.status === "retired"), "old drafts retired, not deleted");
  const reread = f.tables._scheduled_functions.find((r) => r.name === "actions/answersSetup:readSite")!;
  assert.deepEqual(reread.args, { siteId: pentra, force: true, then: "snapshot" });
  assert.ok(reread.at >= now + 30 * 60_000, "read after the relaunch has deployed");
  assert.equal(f.tables._scheduled_functions.filter((r) => r.name === "actions/answerPublish:publishPage").length, 1, "dawnlist's one draft, once");
  await f.invoke("answersDispatch:dispatch", {});
  assert.equal(f.tables._scheduled_functions.filter((r) => r.name === "actions/answersSetup:readSite").length, 1, "a version applies once");
  assert.equal(f.get(pentra)!.answers.ownerVersion, 3);
});

test("a new account's first hour: its address kept, a failed setup retried at once, the ready email with counts and drafts", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const emails: Fields[] = [];
  const base = network(calls);
  let questionsFail = true;
  const f = corePipelineFixture(async (url, init) => {
    if (url.hostname === "api.resend.com") { emails.push(JSON.parse(String(init.body))); return json({ id: "email_1" }); }
    // A thin third-party source (Acme's short blog post) is tried through the rendering fallback, which finds nothing more.
    if (url.href === "https://treg.to/call/treg.web.extract") return json({ success: false }, 0, 502);
    if (questionsFail && url.hostname === "api.anthropic.com" && typeof init.body === "string" && init.body.includes("submit_buyer_questions")) {
      const body = JSON.parse(init.body);
      return json({ id: "msg_q", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "tool_use", id: "tool_q", name: "submit_buyer_questions", input: { questions: [] } }], usage: { input_tokens: 3000, output_tokens: 20 } });
    }
    const response = await base(url, init);
    // This account's business is Newco: the synthetic page writer names it.
    if (url.hostname !== "api.anthropic.com") return response;
    return new Response((await response.text()).replaceAll("Acme Leads", "Newco"), { status: response.status, headers: response.headers });
  }, { TREG_TOKEN: "synthetic-only", RESEND_API_KEY: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org"] });
  f.setIdentity("user_ready");
  const { siteId } = await f.invoke("answers:createSite", { domain: "newco.example", email: " Owner@Newco.example " });
  assert.deepEqual(f.tables.account_contacts.map((c) => [c.userId, c.email, c.emailUpdates]), [["user_ready", "owner@newco.example", true]],
    "the first-hour email has somewhere to go");
  f.setIdentity(null);
  await drain(f, 60_000);

  // The questions can't be written the first time: the owner sees why, and "Try again" restarts at once (not in 30 minutes).
  f.setIdentity("user_ready");
  await f.invoke("answers:confirmSetup", { siteId, competitors: [{ name: "Apollo", domain: "apollo.example" }] });
  f.setIdentity(null);
  await drain(f, 60_000);
  assert.match(f.get(siteId)!.answers.setupError, /questions couldn't be written/);
  assert.equal(f.tables.answer_runs.length, 0);
  questionsFail = false;
  f.setIdentity("user_ready");
  await f.invoke("answers:confirmSetup", { siteId, competitors: [{ name: "Apollo", domain: "apollo.example" }] });
  assert.equal(f.get(siteId)!.answers.setupError, undefined, "the error clears as the retry starts");
  f.setIdentity(null);
  await drain(f, 20 * 60_000);
  assert.equal(f.tables.answer_runs.length, 1);
  assert.equal(f.tables.answer_runs[0].status, "done");
  assert.deepEqual(f.tables.answer_pages.map((p) => p.status), ["draft", "draft", "draft", "draft", "draft"], "the free hour's five drafts");

  assert.equal(emails.length, 1, "one ready email");
  const email = emails[0];
  assert.deepEqual(email.to, ["owner@newco.example"]);
  assert.equal(email.subject, `Your first hour: named in 0 of ${QUESTIONS.length * 4} AI answers · newco.example`, "the assistants name Acme Leads and Apollo, never Newco");
  assert.match(email.text, new RegExp(`the ${QUESTIONS.length} questions your buyers ask`));
  assert.match(email.text, new RegExp(`- Perplexity: 0 of ${QUESTIONS.length}`));
  assert.match(email.text, new RegExp(`- Apollo: ${QUESTIONS.length * 2} of ${QUESTIONS.length * 4}`), "who is named instead, with the denominator");
  assert.match(email.text, /Answer pages drafted for the questions you can win: 5/);
  assert.match(email.text, /Pentra plan \(\$249 a month\): https:\/\/pentra\.dev\/dashboard\/billing/);
  assert.ok(f.get(siteId)!.answers.snapshotEmailAt, "sent once");
  await f.invoke("actions/answerEmail:sendSnapshotReady", { siteId, runId: f.tables.answer_runs[0]._id });
  assert.equal(emails.length, 1, "never twice");
  f.assertOffline();
});

test("version 3: LeadPilot's published answer files are written again with the field its blog needs; dawnlist gets suggested competitors", async () => {
  const calls: Array<{ url: string; body?: Fields }> = [];
  const base = network(calls);
  const f = corePipelineFixture(async (url, init) => {
    if (url.hostname === "dawnlist.io") return html("Dawnlist: daily lists of local businesses that need your service, with the proof attached. ".repeat(10));
    if (url.hostname === "leadpilot.chat") return html("Best AI chatbot for a B2B SaaS site? LeadPilot answers every visitor. ".repeat(10));
    return base(url, init);
  }, { TREG_TOKEN: "synthetic-only" }, { syntheticHosts: ["api.github.com", "api.indexnow.org", "dawnlist.io", "leadpilot.chat"] });
  const now = f.now();
  const owner = { enabled: true, enabledAt: now, source: "owner", confirmedAt: now, autopublish: true, weeklyEmail: true, country: "US", ownerVersion: 2 };
  const leadpilot = f.add("sites", { domain: "leadpilot.chat", userId: "owner", siteName: "LeadPilot", publishMethod: "github", githubToken: "synthetic-only",
    repoOwner: "owner", repoName: "LeadPilot", repoDefaultBranch: "main", urlStructure: "/blog/[slug]", createdAt: now, updatedAt: now,
    answers: { ...owner, competitors: [{ name: "Intercom", domain: "intercom.example" }], lastSnapshotRunId: "answer_runs:0", lastFullRunAt: now, lastRecheckAt: now } });
  const dawnlist = f.add("sites", { domain: "dawnlist.io", userId: "owner", siteName: "Dawnlist", siteSummary: "Confirmed facts.", createdAt: now, updatedAt: now,
    answers: { ...owner, competitors: [], lastSnapshotRunId: "answer_runs:1", lastFullRunAt: now, lastRecheckAt: now } });
  const slug = "best-ai-chatbot-for-a-b2b-saas-site";
  const questionId = f.add("answer_questions", { siteId: leadpilot, question: "Best AI chatbot for a B2B SaaS site?", key: "best ai chatbot b2b saas site", intent: "best",
    source: "generated", status: "active", createdAt: now });
  const pageId = f.add("answer_pages", { siteId: leadpilot, questionId, question: "Best AI chatbot for a B2B SaaS site?", status: "published",
    title: "Best AI chatbot for a B2B SaaS site?", slug, metaDescription: "LeadPilot answers every visitor.", markdown: "LeadPilot answers every visitor.", facts: [],
    sources: [], issues: [], version: 1, contentHash: "h", writerModel: "m", costMicroUsd: 1, createdAt: now, updatedAt: now, citations: 0,
    publishedUrl: `https://leadpilot.chat/blog/${slug}`, publishedAt: now, publishTarget: "github",
    publishReceipt: JSON.stringify({ method: "github", deliveryKey: "answer:p1:v1", path: `content/blog/${slug}.md`, sha: "old" }) });
  f.setTime(now + 60_000);
  await f.invoke("answersDispatch:dispatch", {});
  assert.equal(f.get(leadpilot)!.answers.ownerVersion, 3);
  assert.equal(f.get(dawnlist)!.answers.ownerVersion, 3);
  await drain(f, 10 * 60_000);
  const put = calls.find((c) => c.url.endsWith(`/contents/content/blog/${slug}.md`) && c.body?.content);
  assert.ok(put, "the file is written again at its own path");
  const file = Buffer.from(put!.body!.content, "base64").toString("utf8");
  assert.match(file, /\nqualityGateVersion: 1\n/, "the field LeadPilot's blog requires");
  assert.match(file, /pentraDeliveryKey: "answer:p1:v1"/, "the same delivery key");
  assert.match(file, new RegExp(`date: "${new Date(now).toISOString()}"`), "the original date");
  assert.equal(f.get(pageId)!.status, "published");
  assert.ok(typeof f.get(pageId)!.liveAt === "number", "checked live again");
  assert.ok(f.get(dawnlist)!.answers.competitors.some((c: Fields) => c.name === "Apollo"), "dawnlist's suggested competitors");
  assert.equal(f.get(dawnlist)!.siteSummary, "Confirmed facts.", "its confirmed facts stay");
  await f.invoke("answersDispatch:dispatch", {});
  assert.equal(f.tables._scheduled_functions.filter((r) => r.name === "actions/answerPublish:refreshPublishedFile").length, 1, "a version applies once");
  f.assertOffline();
});
