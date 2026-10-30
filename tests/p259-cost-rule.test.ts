// P259 (Oct 30 2026), Arshad's cost rule: "no article may loop through rewrites. Research gathers 3-5 real sources before
// writing, the article is written once, checked once for objective errors only, and gets at most one rewrite. If it still
// fails, it's held or shown to the user as a draft with the doubtful lines marked; it's never regenerated." Measured
// before: $0.38 per published article on the owner sites in the week to Oct 30 (pentra.dev paid for 13 drafts to publish
// 7); each rewrite cost as much as the first writing. And the writer now sees what Google shows for the search.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkableFactCheckFindings } from "../convex/lib/autopilotEditor.ts";
import { DOUBTFUL_LINE_TITLE, markDoubtfulLines } from "../convex/lib/plainReviewNotes.ts";
import { MAX_RESEARCH_SOURCES, PRIMARY_PASS_BELOW } from "../convex/lib/researchPasses.ts";
import { SERP_BRIEF_MAX_AGE_MS, serpArticleType, serpBriefFromAnalysis, serpBriefPrompt, serpBriefUsable } from "../convex/lib/serpBrief.ts";

const work = readFileSync("convex/contentWork.ts", "utf8");
const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

test("P259 at most one rewrite, only for an objective problem, and a failed article is never regenerated", () => {
  assert.match(work, /export const MAX_CONTENT_REWRITES = 1;/);
  assert.match(work, /if \(cw\.revisions < MAX_CONTENT_REWRITES && !notesOnly\) \{/);
  assert.match(work, /draft\.publicationGateIssues!\.every\(issue => ownerWaivableIssue\(issue, draft\)\) && readerVisibleIssues\(draft\)\.length === 0\);/);
  const revise = work.slice(work.indexOf("async function reviseFailedWork"), work.indexOf("async function retireQualityExhaustedTopics"));
  assert.doesNotMatch(revise, /chooseTopic\(/, "no replacement draft on another topic");
  assert.match(work, /cw\.failure !== "bounded_content_quality_exhausted" &&\n    \(!cw\.replacesJobId \|\| HELD_BACK_FAILURES\.has/, "a slot whose article failed its checks is never refilled");
});

test("P259 research gathers 3 to 5 real sources before writing", () => {
  assert.equal(PRIMARY_PASS_BELOW, 3);
  assert.equal(MAX_RESEARCH_SOURCES, 5);
  assert.match(pipeline, /researchSources = readable\.slice\(0, MAX_RESEARCH_SOURCES\);/);
});

test("P259 the one check counts made-up numbers, product facts and invented quotes or people", () => {
  assert.deepEqual(checkableFactCheckFindings(["“Invoices get paid faster with a logo,” said the founder.", "Be polite in reminders."], "Madman Invoice"),
    ["“Invoices get paid faster with a logo,” said the founder."]);
  assert.deepEqual(checkableFactCheckFindings(["According to Jane Doe, the template works."], "Madman Invoice"), ["According to Jane Doe, the template works."]);
});

test("P259 the writer sees what Google shows for the search, read once per topic", () => {
  const analysis = { dominantFormat: "listicle", paaQuestions: ["Is the Next.js blog starter free?", "Which template has MDX?"],
    results: [{ type: "featured_snippet", title: "Snippet", url: "https://x.example/a" },
      { title: "20 Best Next.js Blog Templates", url: "https://www.nextjstemplates.com/blog-templates", description: "Free and premium templates." },
      { title: "vercel/next.js blog-starter", url: "https://github.com/vercel/next.js/tree/canary/examples/blog-starter" },
      { title: "", url: "https://empty.example" }] };
  const brief = serpBriefFromAnalysis(analysis, 1_000, 2840, "en")!;
  assert.deepEqual(brief.results.map(r => r.url), ["https://www.nextjstemplates.com/blog-templates", "https://github.com/vercel/next.js/tree/canary/examples/blog-starter"]);
  assert.equal(serpBriefUsable(brief, 1_000 + SERP_BRIEF_MAX_AGE_MS - 1, 2840, "en"), true);
  assert.equal(serpBriefUsable(brief, 1_000 + SERP_BRIEF_MAX_AGE_MS, 2840, "en"), false, "a month-old reading is read again");
  assert.equal(serpBriefUsable(brief, 2_000, 2826, "en"), false, "another country's results are not this site's");
  assert.equal(serpArticleType("checklist", true), "listicle", "a search for software templates gets a list of them");
  assert.equal(serpArticleType("how-to", false), "how-to");
  assert.equal(serpArticleType("ultimate-guide", false), undefined);
  const prompt = serpBriefPrompt(brief);
  assert.match(prompt, /^WHAT GOOGLE SHOWS FOR THIS SEARCH/);
  assert.match(prompt, /1\. 20 Best Next\.js Blog Templates \(nextjstemplates\.com\): Free and premium templates\./);
  assert.match(prompt, /write a vetted list that names each option/);
  assert.match(prompt, /Is the Next\.js blog starter free\?/);
  assert.match(pipeline, /\} else if \(topic && topicId && !selectedWork && contentProviderActive\(\)\) \{/);
  assert.match(pipeline, /brief = fresh \? await ctx\.runMutation\(internal\.topics\.recordSerpBrief, \{ topicId, brief: fresh \}\) : null;/);
  assert.match(pipeline, /serpBrief \? serpBriefPrompt\(serpBrief\)/);
  assert.match(readFileSync("convex/topics.ts", "utf8"), /if \(topic\.serpBrief && brief\.observedAt - topic\.serpBrief\.observedAt < SERP_BRIEF_MAX_AGE_MS\) return topic\.serpBrief;/,
    "the first reading is kept, so retries and revisions see the same results");
});

test("P259 no 'check the documentation' filler, and a held draft's doubtful lines are marked for its owner", () => {
  assert.doesNotMatch(pipeline, /check the vendor's current documentation for the full list/);
  assert.match(pipeline, /Never send the reader to "check the documentation", "consult the official docs" or "consult a professional" in place of an answer/);
  const md = "Intro.\n\nIf you are based in the US, that list is not a legal requirement for you.\n\nMore.";
  const marked = markDoubtfulLines(md, ["If you are based in the US, that list is not a legal requirement for you."]);
  assert.equal(marked, `Intro.\n\n<mark title="${DOUBTFUL_LINE_TITLE}">If you are based in the US, that list is not a legal requirement for you.</mark>\n\nMore.`);
  assert.equal(markDoubtfulLines(marked, ["that list is not a legal requirement"]), marked, "never marks inside a mark");
  const page = readFileSync("src/app/(dashboard)/articles/[id]/page.tsx", "utf8");
  assert.match(page, /const previewMarkdown = unsourcedNoted \? markDoubtfulLines\(article\.markdown, unsourced\) : article\.markdown;/);
  assert.doesNotMatch(page, /\{article\.markdown\}\n\s*<\/ReactMarkdown>/, "the previews show the marked text; copies and publishing use the article's own");
});
