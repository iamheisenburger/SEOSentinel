/** P362 (Nov 5 2026), Phase 5: AI answers. The weekly check asked ChatGPT, Gemini and Google AI Mode the buyer questions and
 * found neither owner site named (LeadPilot 0 of 15, pentra.dev 0 of 13), and its action said "get listed on the pages the
 * assistants cite" without saying which: the answers' sources were fetched and thrown away. Now each answer keeps the sites
 * it cited, the finding and the weekly email name the most-cited ones, and the buyer questions themselves become topics
 * (Phase 2's page-one check decides whether each is written). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiAnswerTotals, citedHosts, topCitedSites, type AiAnswerCheck } from "../convex/lib/aiAnswers.ts";
import { diagnoseSite } from "../convex/lib/siteDiagnosis.ts";
import { weeklyReportEmail } from "../convex/lib/customerNotices.ts";

const business = { name: "LeadPilot", domain: "leadpilot.chat" };

test("an answer keeps the sites it cited: hosts once each, the business's own and Google's redirect links left out", () => {
  assert.deepEqual(citedHosts(["https://www.g2.com/categories/chatbots", "https://g2.com/x", "https://leadpilot.chat/blog/a", "https://blog.leadpilot.chat/b",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", "not a url", "https://www.reddit.com/r/sales/comments/1"], business),
    ["g2.com", "reddit.com"]);
});

test("the most-cited sites across the week's answers, counted once per answer, two answers or more", () => {
  const check = (sources: string[], answered = true): AiAnswerCheck => ({ question: "q", assistant: "chatgpt", answered, named: false, cited: false, sources });
  const checks = [check(["g2.com", "reddit.com", "g2.com"]), check(["g2.com", "hubspot.com"]), check(["g2.com", "reddit.com"]), check(["capterra.com"]),
    check(["capterra.com", "g2.com"], false)];
  assert.deepEqual(topCitedSites(checks), [{ site: "g2.com", answers: 3 }, { site: "reddit.com", answers: 2 }]);
  assert.deepEqual(aiAnswerTotals(checks).citedSites, [{ site: "g2.com", answers: 3 }, { site: "reddit.com", answers: 2 }]);
});

test("the finding names where to be listed, and the weekly email says it", () => {
  const d = diagnoseSite({ domain: "leadpilot.chat", gsc: [], authority: null, pageOne: [], crawlComplete: false, sitemap: null, intents: [], speed: [], now: 1_793_900_000_000,
    aiAnswers: { asked: 15, named: 0, cited: 0, byAssistant: [], citedSites: [{ site: "g2.com", answers: 6 }, { site: "reddit.com", answers: 4 }] }, aiAttempt: null, pages: [] } as never);
  const ai = d.findings.find((f) => f.factor === "ai")!;
  assert.match(ai.action, /Get listed or mentioned on the sites the assistants cite most for these questions \(g2\.com, 6 answers; reddit\.com, 4 answers\)/);
  const email = weeklyReportEmail({ domain: "leadpilot.chat", search: "not_connected", factors: { ai: "failing" }, problems: [], fixed: [], published: [], improved: [],
    aiNamed: { named: 0, asked: 15 }, citedSites: [{ site: "g2.com", answers: 6 }, { site: "reddit.com", answers: 4 }], next: null });
  assert.match(email.text, /\(the sites they cite most for those questions: g2\.com, reddit\.com\)/);
});

test("the buyer questions become topics to check on the rollout sites, never a repeat, never past Phase 2's check", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /export const addAiQuestionTopics = internalMutation/);
  assert.match(work, /!topicChoiceRollout\(siteCanonicalDomain\(site\) \?\? site\.domain\)\) return \{ added: 0 \};/);
  assert.match(work, /if \(namesCompetitor\(label, competitors\) \|\| taken\.some\(t => contentIntentConflicts\(proposal, t\)\)\) continue;/);
  assert.doesNotMatch(work.slice(work.indexOf("export const addAiQuestionTopics"), work.indexOf("/** Phase 2: a page-one check as stored on a topic")), /pageOne:/,
    "no page-one verdict is invented: the check still decides");
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /if \(aiQuestions\.length && !repairsOnly\) \{\n    try \{ await ctx\.runMutation\(internal\.contentWork\.addAiQuestionTopics/);
  assert.match(action, /sources: citedHosts\(got\.answer\.sources, business\) \}/);
  assert.match(readFileSync("convex/lib/siteDiagnosisSchema.ts", "utf8"), /sources: v\.optional\(v\.array\(v\.string\(\)\)\), error: v\.optional\(v\.string\(\)\)/);
});
