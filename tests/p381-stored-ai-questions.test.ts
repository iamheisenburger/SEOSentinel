// P381 (Nov 7 2026), watchdog: pentra.dev missed its Autopilot slots from Nov 5 21:42Z ("content_inputs_exhausted" on every
// pass) with five AI-assistant buyer questions stored on its Nov 5 10:40Z diagnosis. Questions joined the plan only at the
// weekly diagnosis, and that step (P362) shipped at 14:02Z, after the run. With nothing to write, Autopilot now adds the
// stored questions to the plan (never a repeat of a topic or page the site has) and writes one in the same pass (P380).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentIntentConflicts } from "../convex/lib/autopilotBuffer.ts";

const work = readFileSync("convex/contentWork.ts", "utf8");
const choose = work.slice(work.indexOf("async function chooseTopic("), work.indexOf("const FALLBACK_TOPICS_PER_DAY"));

test("with nothing to write, the stored AI questions join the plan and one is written in the same pass", () => {
  assert.match(choose, /query\("site_diagnoses"\)\.withIndex\("by_site_created", q => q\.eq\("siteId", site\._id\)\)\.order\("desc"\)\.first\(\)\)\?\.aiAnswers\?\.questions/);
  assert.match(choose, /if \(stored\.length && await insertAiQuestionTopics\(ctx, site, inventory, stored\) > 0\) \{\n\s+const next = \(await eligiblePlannedTopics\(ctx, site, excludedIntents\)\)\.planned\[0\];\n\s+if \(next\) return next;/);
  assert.ok(choose.indexOf("insertAiQuestionTopics") < choose.indexOf("queueFallbackTopicsForChecks"), "before the slower fallback");
});

test("the weekly diagnosis and the fallback add questions the same way", () => {
  assert.match(work, /return \{ added: await insertAiQuestionTopics\(ctx, site, inventory, questions\) \};/);
  const insert = work.slice(work.indexOf("async function insertAiQuestionTopics"), work.indexOf("/** Phase 2 (P364)"));
  assert.match(insert, /taken\.some\(t => contentIntentConflicts\(proposal, t\)\)\) continue;/, "never a repeat");
  assert.match(insert, /notes: AI_QUESTION_TOPIC_NOTES, buyerFit: \{ eligible: true/, "written under P380's rule");
});

test("a question the site already answered is left out (pentra.dev's first question)", () => {
  const used = { primaryKeyword: "how do i get more customers from google without writing every article myself" };
  const q = (s: string) => ({ primaryKeyword: s.toLowerCase().replace(/[?!.\s]+$/, "") });
  assert.equal(contentIntentConflicts(q("How can I get more customers from Google without writing every blog article myself?"), used), true);
  assert.equal(contentIntentConflicts(q("How often should a small business publish blog posts to help its Google rankings?"), used), false);
});
