// Nov 2026: the Pentra Answers onboarding (/start) and dashboard. Counts are said the backend's way ("named in `named`
// of `answered` answers"; no AI Overview and failed answers listed, never counted), every screen reads only the functions
// in ops/design/answers-api.md, and the dev-only harness that renders them with synthetic data is never served in
// production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { runTotals } from "../convex/lib/answerEngine.ts";
import { checkOutcomes, checkToEvidence, highlight, textToBlocks } from "../src/lib/answers/evidence.ts";
import { deltaText, describeDestination, headline, latestFullRun, nextFullRunAt, weekLog, weeklyDelta, winnable, WEEK_MS } from "../src/lib/answers/derive.ts";
import { elapsed, indexingState, listSentence, pageStatus, plural, timeAgo, utcStamp } from "../src/lib/answers/format.ts";
import { createSyntheticStore, type HarnessOptions } from "../src/lib/answers/synthetic.ts";
import { SYNTHETIC_NOW } from "../src/lib/answers/synthetic-data.ts";
import type { Check, Overview, Run } from "../src/lib/answers/types.ts";
import { formatUsd, PENTRA_PLAN } from "../src/lib/pricing.ts";

const read = (path: string) => readFileSync(path, "utf8");
const SITE = "site_kettlewood";
const store = (options: Partial<HarnessOptions> = {}) =>
  createSyntheticStore({ scenario: "dashboard", access: "paid", state: "ready", live: false, ...options });
const overviewOf = (options: Partial<HarnessOptions> = {}) => store(options).get("overview", { siteId: SITE }) as Overview;

const check = (over: Partial<Check> = {}): Check => ({
  checkId: "c1", questionId: "q1", question: "Who are the best deck builders in Austin, TX?", assistant: "chatgpt", askedAt: Date.UTC(2026, 10, 7, 14, 32),
  country: "US", status: "answered", error: null, excerpt: "", textChars: 0, named: false, cited: false, position: null, brandsNamed: 0,
  competitorsNamed: [], sources: [], citedPageUrls: [], ...over,
});

/* ─── Recorded data, written plainly ───────────────────────────────────── */

test("timestamps are UTC as recorded; elapsed time and counts are exact", () => {
  assert.equal(utcStamp(Date.UTC(2026, 10, 7, 14, 32, 59)), "2026-11-07 14:32 UTC");
  assert.equal(elapsed(48_000), "48s");
  assert.equal(elapsed(6 * 60_000 + 12_000), "6m 12s");
  assert.equal(elapsed(64 * 60_000), "1h 04m");
  assert.equal(timeAgo(SYNTHETIC_NOW - 3 * 3_600_000, SYNTHETIC_NOW), "3h ago");
  assert.equal(plural(1, "answer"), "1 answer");
  assert.equal(plural(1500, "answer"), "1,500 answers");
  assert.equal(listSentence(["ChatGPT", "Perplexity", "Gemini"]), "ChatGPT, Perplexity and Gemini");
  assert.equal(pageStatus("draft").label, "Draft");
});

test("the count sentence uses answered answers; no AI Overview and failed answers are said beside it, never inside", () => {
  const h = headline({ named: 3, answered: 143, noAnswer: 5, failed: 2, cited: 0 });
  assert.equal(h.sentence, "Named in 3 of 143 answers.");
  assert.equal(h.notCounted, "5 searches showed no AI Overview and 2 answers failed; listed, not counted.");
  assert.equal(headline({ named: 0, answered: 150, noAnswer: 0, failed: 0, cited: 0 }).notCounted, null);
});

test("the weekly change is said with both runs' denominators, and 'no change' plainly", () => {
  const point = (named: number, answered: number, day: number) => ({ at: Date.UTC(2026, 10, day), named, answered, cited: 0, competitors: [] });
  assert.equal(deltaText(weeklyDelta([point(3, 145, 7)])!), "Baseline · Nov 7");
  assert.equal(deltaText(weeklyDelta([point(9, 144, 1), point(13, 146, 7)])!), "+4 answers vs the run before (9 of 144 on Nov 1).");
  assert.equal(deltaText(weeklyDelta([point(9, 144, 1), point(9, 146, 7)])!), "No change from the run before (9 of 144 on Nov 1).");
  assert.equal(deltaText(weeklyDelta([point(9, 144, 1), point(8, 146, 7)])!), "−1 answer vs the run before (9 of 144 on Nov 1).");
  assert.equal(weeklyDelta([]), null);
  assert.equal(nextFullRunAt([point(9, 144, 1)]), Date.UTC(2026, 10, 1) + WEEK_MS, "the dispatcher runs weekly after the last full run");
});

test("an answer is highlighted the way the engine matched it: the business, its domain, the rivals, the citation markers", () => {
  const business = { name: "Kettlewood Decks", domain: "kettlewooddecks.com" };
  const segments = highlight("Try kettlewood decks or KettlewoodDecks [1]; Cedar Row Builders is pricier. See kettlewooddecks.com.", business, ["Cedar Row Builders"]);
  assert.deepEqual(segments.filter((s) => typeof s !== "string"),
    [{ you: "kettlewood decks" }, { you: "KettlewoodDecks" }, { cite: 1 }, { rival: "Cedar Row Builders" }, { you: "kettlewooddecks.com" }]);
  const blocks = textToBlocks("Top picks:\n\n1. **Kettlewood Decks** for composite.\n2. Cedar Row Builders for big builds.\n\nGet two quotes.", business, ["Cedar Row Builders"]);
  assert.equal(blocks.length, 3);
  assert.ok("ol" in blocks[1]! && blocks[1].ol.length === 2);
  assert.deepEqual((blocks[1] as { ol: unknown[][] }).ol[0]![0], { you: "Kettlewood Decks" });
});

test("each answer's outcome is the engine's own: position, competitors named, cited pages, no AI Overview, failed", () => {
  assert.deepEqual(checkOutcomes(check({ named: true, position: 2, brandsNamed: 4 })), [{ kind: "named", label: "Named you · position 2 of 4" }]);
  assert.deepEqual(checkOutcomes(check({ competitorsNamed: ["Cedar Row Builders", "Halden Outdoor Co.", "Pecan Street Carpentry"] })),
    [{ kind: "rival", label: "Not mentioned · named Cedar Row Builders, Halden Outdoor Co. +1 more" }]);
  assert.deepEqual(checkOutcomes(check({ named: true, cited: true, citedPageUrls: ["https://kettlewooddecks.com/a"] })),
    [{ kind: "named", label: "Named you" }, { kind: "cited", label: "Cited your page" }]);
  assert.deepEqual(checkOutcomes(check({ status: "no_answer", assistant: "google_ai_overview" })), [{ kind: "none", label: "No AI Overview shown" }]);
  assert.deepEqual(checkOutcomes(check({ status: "error" })), [{ kind: "none", label: "No answer recorded" }]);
  const evidence = checkToEvidence(check({ status: "error", error: "Timed out after 90 seconds." }), { name: "Kettlewood Decks", domain: "kettlewooddecks.com" });
  assert.equal(evidence.askedAt, "2026-11-07 14:32 UTC");
  assert.equal(evidence.locale, "United States");
  assert.match(JSON.stringify(evidence.answer), /This answer failed: timed out after 90 seconds\. Failed answers are listed, never counted\./);
  const sourced = checkToEvidence(check({ sources: [{ url: "https://kettlewooddecks.com/blog/permits", domain: "kettlewooddecks.com", own: true }] }), { name: "K", domain: "kettlewooddecks.com" });
  assert.deepEqual(sourced.sources, [{ domain: "kettlewooddecks.com", title: "/blog/permits", url: "https://kettlewooddecks.com/blog/permits", yours: true }]);
});

test("indexing is stated from the page's record, never as 'indexed by Google'", () => {
  const base = { status: "published", publishedUrl: "https://x.com/a", issues: [] as string[], googleSitemapAt: null };
  assert.equal(indexingState({ ...base, indexNow: null })!.label, "Checking");
  assert.equal(indexingState({ ...base, indexNow: { at: Date.UTC(2026, 10, 7), status: "submitted" } })!.detail, "Live, and sent to IndexNow Nov 7.");
  assert.equal(indexingState({ ...base, indexNow: null, issues: ["Not live yet at https://x.com/a. Check that your site rebuilt after Pentra's publish."] })!.label, "Not live yet");
  assert.equal(indexingState({ ...base, indexNow: { at: 1, status: "refused_403" } })!.detail, "Live. IndexNow refused the submission (403).");
  assert.equal(indexingState({ ...base, status: "draft", indexNow: null }), null);
  for (const path of ["src/lib/answers/format.ts", "src/components/answers/page-detail.tsx", "src/components/answers/dashboard/pages.tsx"]) {
    assert.doesNotMatch(read(path), /indexed by Google|Google indexed/i, path);
  }
});

test("where pages publish is said from the hosted address or the site's own connection", () => {
  assert.deepEqual(describeDestination({ target: "hosted", hostedDomain: "answers.x.com", hostedStatus: "pending_dns" }, null),
    { kind: "hosted", host: "answers.x.com", live: false, status: "pending_dns", label: "answers.x.com (once its DNS record is live)" });
  assert.equal(describeDestination({ target: "site" }, { _id: "s", domain: "x.com", publishMethod: "github", repoOwner: "acme", repoName: "site" }).kind, "site");
  assert.equal((describeDestination(null, { _id: "s", domain: "x.com", publishMethod: "github", repoOwner: "acme", repoName: "site" }) as { label: string }).label, "acme/site on GitHub");
  assert.equal(describeDestination(null, { _id: "s", domain: "x.com", publishMethod: "manual" }).kind, "none");
  assert.equal(describeDestination(null, undefined).kind, "loading");
});

/* ─── The harness's synthetic data obeys the backend's rules ───────────── */

test("synthetic runs are counted the engine's way, so every count opens the answers it came from", () => {
  const s = store();
  const overview = s.get("overview", { siteId: SITE }) as Overview;
  for (const run of overview.runs) {
    const log = s.get("runAnswers", { runId: run.runId }) as Check[];
    const totals = runTotals(log);
    assert.deepEqual([run.named, run.answered, run.failed, run.noAnswer], [totals.named, totals.answered, totals.failed, totals.noAnswer], run.runId);
  }
  assert.deepEqual(overview.trend.map((t) => t.named), overview.runs.filter((r) => r.status === "done" && r.kind !== "recheck").reverse().map((r) => r.named));
  for (const citation of overview.citations) {
    const answer = s.get("answerText", { checkId: citation.checkId })!;
    assert.ok(answer.cited && answer.sources.some((source) => source.own && source.url === citation.url), citation.citationId);
  }
  const question = overview.questions.find((q) => q.latest && q.latest.named > 0)!;
  const evidence = s.get("questionEvidence", { questionId: question.questionId })!;
  assert.ok(evidence.checks.every((c, i, all) => c.questionId === question.questionId && (i === 0 || all[i - 1]!.askedAt >= c.askedAt)));
  assert.ok(winnable(overview.questions).every((q) => q.opportunity?.status === "winnable"));
});

test("synthetic mutations refuse what the backend refuses, with its sentences", async () => {
  const paid = store();
  await assert.rejects(paid.actions.updateBusiness({ siteId: SITE, name: "K", sells: "Decks", buyers: "", offerings: [] }), /Say what the business sells in a sentence\./);
  await assert.rejects(paid.actions.editDraft({ pageId: "p_3_v1", title: "T", metaDescription: "", markdown: "short" }), /A page needs a title and its text\./);
  await assert.rejects(paid.actions.editDraft({ pageId: "p_0_v1", title: "T", metaDescription: "", markdown: "x".repeat(300) }), /Only a draft can be edited/);
  await assert.rejects(paid.actions.runNow({ siteId: SITE }), /less than six hours ago/);
  await assert.rejects(paid.actions.setHostedDomain({ siteId: SITE, domain: "docs.kettlewooddecks.com" }), /like answers\.kettlewooddecks\.com/);
  await assert.rejects(paid.actions.createSite({ domain: "another-business.com" }), /already tracks kettlewooddecks\.com/);
  const free = store({ scenario: "drafts", access: "free" });
  await assert.rejects(free.actions.publishDraft({ pageId: "p_19_v1" }), /Publishing is part of the Pentra plan\./);
  await assert.rejects(free.actions.runNow({ siteId: SITE }), /Re-asking the assistants is part of the Pentra plan\./);
  const understood = store({ scenario: "understood", access: "free" });
  await understood.actions.confirmSetup({ siteId: SITE, competitors: [{ name: "A" }, ...Array.from({ length: 10 }, (_, i) => ({ name: `Rival ${i}` }))] });
  const state = understood.get("setupState", { siteId: SITE })!;
  assert.equal(state.competitors.length, 8, "eight at most; one-letter names dropped");
  assert.ok(state.confirmedAt);
  understood.dispose();
});

/* ─── The screens, rendered with the harness provider ──────────────────── */

const harness = (() => {
  const code = buildSync({
    entryPoints: ["tests/helpers/answers-render-entry.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false, jsx: "automatic",
    alias: {
      "next/link": "./tests/helpers/next-link-stub.tsx",
      "next/navigation": "./tests/helpers/next-navigation-stub.ts",
      "@clerk/nextjs": "./tests/helpers/clerk-stub.ts",
      "@clerk/nextjs/experimental": "./tests/helpers/clerk-stub.ts",
    },
  }).outputFiles[0]!.text;
  const runtime = { exports: {} as { renderHarness: (config: string, path: string) => { html: string; navigations: string[] } } };
  const actual = createRequire(import.meta.url);
  // react-markdown and remark-gfm are ES modules: in node mode the bundle's interop reads the whole module as the
  // default import, so hand it the default export (with the named exports on it), as a bundler would.
  const esm = new Set(["react-markdown", "remark-gfm"]);
  const load = (name: string) => {
    if (!esm.has(name)) return actual(name);
    const mod = actual(name) as { default: object };
    return Object.assign(mod.default, mod);
  };
  runInNewContext(code, { module: runtime, exports: runtime.exports, require: load, console, URLSearchParams, TextEncoder, URL, Intl, setTimeout, clearTimeout });
  return runtime.exports.renderHarness;
})();

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("/start signed out: the domain step, then Pentra's own sign-up and sign-in with the domain kept", () => {
  const empty = text(harness("reading~free~signed-out", "start").html);
  assert.match(empty, /Which site should we check\?/);
  const { html } = harness("reading~free~signed-out", "start?domain=kettlewooddecks.com");
  assert.match(text(html), /Create your account to check kettlewooddecks\.com/);
  assert.match(html, /href="\/sign-up\?redirect_url=%2Fstart%3Fdomain%3Dkettlewooddecks\.com"/);
  assert.match(html, /href="\/sign-in\?redirect_url=%2Fstart%3Fdomain%3Dkettlewooddecks\.com"/);
  assert.match(text(html), /We can't make an assistant recommend you\./);
});

test("/start reading, then 'Here's what we understood' with the read fields editable and competitors as chips", () => {
  assert.match(text(harness("reading~free", "start?site=site_kettlewood").html), /Reading kettlewooddecks\.com.*Usually 20 to 40 seconds/);
  const { html } = harness("understood~free", "start?site=site_kettlewood");
  assert.match(text(html), /Here’s what we understood/);
  assert.match(html, /value="Kettlewood Decks"/);
  for (const name of ["Cedar Row Builders", "Halden Outdoor Co.", "Pecan Street Carpentry", "Lone Star Deck &amp; Fence"]) assert.match(html, new RegExp(`aria-label="Remove ${name.replace(/\./g, "\\.")}"`));
  assert.match(text(html), /Looks right\. Ask the assistants/);
  const failed = text(harness("read-error~free", "start?site=site_kettlewood").html);
  assert.match(failed, /We couldn't read all of kettlewooddecks\.com/);
  assert.match(failed, /didn't answer within 20 seconds/);
});

test("/start's first hour: honest counts as they arrive, partial failures said, safe to close", () => {
  const s = store({ scenario: "first-hour", access: "free" });
  const run = s.get("setupState", { siteId: SITE })!.run as Run;
  const page = text(harness("first-hour~free", "start?site=site_kettlewood").html);
  assert.match(page, new RegExp(`${run.done} of ${run.total} asked · named in ${run.named} of ${run.answered} answers`));
  assert.match(page, /Safe to close this tab\. We'll email you when it's ready\./);
  assert.match(page, /1 answer failed; counts show what Pentra has/);
  assert.match(page, /Showing the newest 12 of 62/);
  assert.doesNotMatch(page, /\d+%/, "no percentage");
  assert.match(text(harness("setup-error~free", "start?site=site_kettlewood").html), /The first hour couldn't start.*tries again by itself within six hours/);
  assert.match(text(harness("run-failed~free", "start?site=site_kettlewood").html), /The run stopped before it finished/);
});

test("/start's snapshot and drafts: the count sentence, drafts marked not published, and the plan offered once", () => {
  const run = store({ scenario: "drafts", access: "free" }).get("setupState", { siteId: SITE })!.run as Run;
  const snapshot = text(harness("drafts~free", "start?site=site_kettlewood").html);
  assert.match(snapshot, new RegExp(`Named in ${run.named} of ${run.answered} answers\\.`));
  assert.match(snapshot, /4 searches showed no AI Overview and 2 answers failed ; listed, not counted\./);
  assert.match(snapshot, /Questions you can win now/);
  assert.match(snapshot, new RegExp(`Publish these 4 pages and keep tracking\\. ${formatUsd(PENTRA_PLAN.monthly).replace("$", "\\$")}/mo`));
  const drafts = text(harness("drafts~free", "start?site=site_kettlewood&view=drafts").html);
  assert.equal(drafts.match(/Draft · not published/g)?.length, 4, "each draft row says so");
  assert.match(drafts, /Drafts · not published\. Read them, edit them, and publish them on the plan\./);
  assert.doesNotMatch(snapshot, /\d%|score/i, "no percentage and no score anywhere in the snapshot");
  assert.match(drafts, /Not kept · retried next run/);
  const paid = text(harness("drafts~paid", "start?site=site_kettlewood").html);
  assert.doesNotMatch(paid, /Keep my free snapshot/, "paying and Pentra's own sites never see the upgrade bar");
  const owner = text(harness("drafts~owner", "start?site=site_kettlewood").html);
  assert.doesNotMatch(owner, /Publish with Pentra|Keep my free snapshot/);
});

test("the overview: count sentence with the weekly change, each assistant, the trend, citations and the week's log", () => {
  const overview = overviewOf();
  const run = latestFullRun(overview.runs)!;
  const page = text(harness("dashboard~paid", "dashboard").html);
  assert.match(page, new RegExp(`Named in ${run.named} of ${run.answered} answers\\.`));
  assert.match(page, /\+4 answers vs the run before \(9 of 144 on Oct 31\)\./);
  assert.match(page, /last asked 3h ago · next run around Nov 14/);
  assert.match(page, /Ask again now/);
  assert.match(page, /Latest citations/);
  assert.match(page, /This week/);
  const log = weekLog(overview, SYNTHETIC_NOW);
  assert.ok(log.some((e) => /^Published|cited “/.test(e.text)) && log.every((e, i) => i === 0 || log[i - 1]!.at >= e.at));
  const free = text(harness("drafts~free", "dashboard").html);
  assert.doesNotMatch(free, /Ask again now/);
  assert.match(free, /Citations come from published pages, which are part of the plan\./);
  const upgraded = text(harness("new-plan~paid", "dashboard?upgraded=1").html);
  assert.match(upgraded, /You're on Pentra\./);
  assert.match(upgraded, /Your 5 draft pages from the free hour publish automatically within the hour\. Choose where they publish first\./);
  assert.match(upgraded, /Choose where pages publish/);
  assert.doesNotMatch(upgraded, /Connect where pages publish\./, "one prompt, not two");
  assert.match(upgraded, /Couldn't publish 5 pages: Choose where your pages publish/, "failures with one reason are said once");
});

test("questions, pages, citations, competitors, settings and billing render from the API's shapes", () => {
  const questions = text(harness("dashboard~paid", "dashboard/questions").html);
  assert.match(questions, /32 of 40 tracked/);
  assert.match(questions, /Winnable/);
  assert.match(questions, /New this week/);
  const pages = harness("dashboard~paid", "dashboard/pages?tab=drafts").html;
  assert.match(text(pages), /GitHub refused the commit \(403\)/);
  assert.match(text(pages), /Retry publish/);
  const detail = text(harness("dashboard~paid", "dashboard/pages/p_0_v1").html);
  assert.match(detail, /Facts used · 5/);
  assert.match(detail, /Sources · 3/);
  assert.match(detail, /Live, and sent to IndexNow Oct 18\./);
  const cited = overviewOf().citations;
  const citations = text(harness("dashboard~paid", "dashboard/citations").html);
  assert.match(citations, new RegExp(`${cited.length} citations · ${new Set(cited.map((c) => c.pageId).filter(Boolean)).size} pages cited`));
  assert.match(text(harness("new-plan~paid", "dashboard/citations").html), /No citations yet/);
  assert.match(text(harness("dashboard~paid", "dashboard/competitors").html), /Who the answers name/);
  const settings = harness("dashboard~paid", "dashboard/settings").html;
  assert.match(text(settings), /answers\.kettlewooddecks\.com/);
  assert.match(text(settings), /Publishing to kettlewood\/kettlewooddecks\.com on GitHub/);
  assert.match(settings, /role="switch" aria-checked="false" aria-label="Autopublish"/);
  assert.match(text(settings), /IndexNow \(Bing\) for hosted pages and GitHub-published Next\.js or Astro sites/);
  assert.match(text(harness("dashboard~owner", "dashboard/billing").html), /never billed/);
  assert.match(text(harness("drafts~free", "dashboard/billing").html), /After you upgrade, they publish automatically within the hour/);
  assert.match(text(harness("dashboard~paid~legacy", "dashboard").html), /Switch to Pentra Answers/);
  assert.match(harness("dashboard~paid~loading", "dashboard").html, /aria-busy="true"/);
});

/* ─── The app's routes: Answers sites get Answers, articles sites keep theirs ─ */

const dashboardPage = buildSync({
  entryPoints: ["src/app/(dashboard)/dashboard/page.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  external: ["@/contexts/site-context", "@/hooks/usePlanLimits", "@/components/onboarding/setup-wizard", "@/components/onboarding/content-start",
    "@/components/content-work-overview", "@/components/content-work-service", "@/components/growth-loop/growth-loop-status", "@/components/ui/article-progress"],
  alias: { "next/navigation": "./tests/helpers/next-navigation-stub.ts" },
}).outputFiles[0]!.text;

function renderDashboard(context: Record<string, unknown>) {
  const actual = createRequire(import.meta.url);
  const queried: string[] = [];
  const runtime = { exports: {} as { default: () => ReactNode } };
  runInNewContext(dashboardPage, { module: runtime, exports: runtime.exports, URLSearchParams,
    require: (name: string) => {
      if (name === "@/contexts/site-context") return { useActiveSite: () => context };
      if (name === "@/hooks/usePlanLimits") return { usePlanLimits: () => ({ maxSites: 1, maxArticles: 3 }) };
      if (name.startsWith("@/components/")) return new Proxy({}, { get: () => () => null });
      if (name === "@clerk/nextjs") return { useAuth: () => ({ userId: "owner" }), UserButton: () => null };
      if (name === "next/link") return function Link({ children, href }: { children: ReactNode; href: string }) { return createElement("a", { href }, children); };
      if (name === "convex/react") return {
        useAction: () => () => assert.fail("rendering never calls an action"),
        useMutation: () => () => assert.fail("rendering never calls a mutation"),
        useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
          const fn = getFunctionName(ref);
          queried.push(fn);
          if (args === "skip" || fn === "answers:overview" || fn === "jobs:getDashboardActivity") return undefined;
          if (fn === "articles:countThisMonth") return 0;
          if (fn === "autopilot:getHealthForSite") return { health: { status: "healthy" }, alerts: [] };
          if (fn.startsWith("searchPerformance:")) return null;
          return [];
        },
      };
      return actual(name);
    } });
  return { html: renderToStaticMarkup(createElement(runtime.exports.default)), queried };
}

test("/dashboard: an articles site keeps its dashboard with a switch card; an Answers site gets the Answers overview", () => {
  const legacySite = { _id: "site-a", domain: "irrigation.example" };
  const legacy = renderDashboard({ sites: [legacySite], activeSite: legacySite, answersStatus: "ready", answersSites: [{ siteId: "site-a", domain: "irrigation.example", name: null, answers: false, confirmed: false }] });
  assert.match(text(legacy.html), /See what AI assistants say about irrigation\.example/);
  assert.match(text(legacy.html), /Switch to Pentra Answers/);
  assert.ok(legacy.queried.some((fn) => fn.startsWith("jobs:")), "the articles dashboard still renders and reads its own data");
  assert.ok(!legacy.queried.includes("answers:overview"));

  const answersSite = { _id: "site-b", domain: "kettlewooddecks.com" };
  const answers = renderDashboard({ sites: [answersSite], activeSite: answersSite, answersStatus: "ready", answersSites: [{ siteId: "site-b", domain: "kettlewooddecks.com", name: "Kettlewood Decks", answers: true, confirmed: true }] });
  assert.match(answers.html, /aria-label="Loading the overview"/);
  assert.ok(answers.queried.includes("answers:overview"));
  assert.ok(!answers.queried.some((fn) => fn.startsWith("jobs:")), "no articles query for an Answers site");

  const loading = renderDashboard({ sites: [answersSite], activeSite: answersSite, answersStatus: "loading" });
  assert.ok(!loading.queried.some((fn) => fn.startsWith("jobs:")), "nothing of the articles dashboard flashes while the sites load");
});

test("the harness is dev-only: 404 in production builds and on every host but the local acceptance port", () => {
  for (const path of ["src/app/e2e-acceptance/answers/[config]/layout.tsx", "src/app/e2e-acceptance/answers/page.tsx"]) {
    assert.match(read(path), /if \(process\.env\.NODE_ENV === "production"\) notFound\(\);/, path);
  }
  assert.match(read("src/proxy.ts"), /if \(pathname\.startsWith\("\/e2e-acceptance"\)\) \{\s*return new NextResponse\("Not found", \{ status: 404 \}\);/);
  // Screens read only the functions in ops/design/answers-api.md (plus the site's existing connection functions).
  const backend = read("src/lib/answers/backend.tsx");
  const used = [...backend.matchAll(/api\.([a-zA-Z]+)\.([a-zA-Z]+)/g)].map((m) => `${m[1]}.${m[2]}`);
  const allowed = new Set(["answers.mySites", "answers.setupState", "answers.overview", "answers.runProgress", "answers.questionEvidence", "answers.runAnswers",
    "answers.answerText", "answerPages.page", "sites.get", "answers.createSite", "answers.updateBusiness", "answers.confirmSetup", "answers.addQuestion",
    "answers.setQuestionStatus", "answers.setPreferences", "answers.runNow", "answers.switchToAnswers", "answerPages.editDraft", "answerPages.publishDraft",
    "answerPublish.setHostedDomain", "answerPublish.usePublishingConnection", "answerPublish.retryFailed", "sites.updateSite", "sites.upsert",
    "publisher.verifyPublicationDestination", "publisher.listGithubRepositories"]);
  assert.deepEqual(used.filter((fn) => !allowed.has(fn)), []);
});
