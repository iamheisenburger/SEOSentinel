/** P363 (Nov 5 2026), Phase 3: an improvement goes to a page buyers see. LeadPilot's page-one impressions were 86% people
 * who won't buy (definitions, job seekers), and its next improvement slot was going to a job-title page ("Lead
 * Qualification Specialist: What the Role Does", position 3.5 for the job title). The weekly diagnosis's reader labels are
 * now kept, and on the rollout sites a page whose labeled readers are mostly someone else waits, and a refresh answers a
 * buyer's search first. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mostlyNonBuyerReaders, NON_BUYER_MIN_LABELED, NON_BUYER_SHARE } from "../convex/lib/moneyPages.ts";

const page = "https://leadpilot.chat/blog/lead-qualification-specialist";
const labels = new Map([["lead qualification specialist", "job_seeker"], ["lead qualification specialist salary", "job_seeker"],
  ["lead qualification software", "buyer"], ["what is lead qualification", "learner"]]);

test("a page whose labeled readers are mostly job seekers or learners waits; a buyer page doesn't; unlabeled searches decide nothing", () => {
  assert.equal(mostlyNonBuyerReaders(page, [{ page, query: "Lead Qualification Specialist", impressions: 60 }, { page, query: "lead qualification software", impressions: 8 }], labels), true);
  assert.equal(mostlyNonBuyerReaders(page, [{ page, query: "lead qualification specialist", impressions: 30 }, { page, query: "lead qualification software", impressions: 20 }], labels), false,
    "60% non-buyers is under the 70% bar");
  assert.equal(mostlyNonBuyerReaders(page, [{ page, query: "what is lead qualification", impressions: 15 }], labels), false, "too few labeled impressions to judge");
  assert.equal(mostlyNonBuyerReaders(page, [{ page, query: "some unlabeled search", impressions: 500 }], labels), false);
  assert.equal(mostlyNonBuyerReaders(page, [{ page: "https://leadpilot.chat/blog/other", query: "lead qualification specialist", impressions: 500 }], labels), false, "another page's readers");
  assert.deepEqual([NON_BUYER_SHARE, NON_BUYER_MIN_LABELED], [0.7, 20]);
});

test("the diagnosis keeps its reader labels, and the improvement choice reads them on the rollout sites", () => {
  assert.match(readFileSync("convex/actions/siteDiagnosis.ts", "utf8"),
    /\.\.\.\(intents\.length \? \{ intents: intents\.slice\(0, 80\)\.map\(\(i\) => \(\{ query: i\.query\.trim\(\)\.toLowerCase\(\)\.slice\(0, 200\), label: i\.label \}\)\) \} : \{\}\),/);
  const pages = readFileSync("convex/selectedPages.ts", "utf8");
  assert.match(pages, /const labels = topicChoiceRollout\(site\.domain, site\.newSystemAt\) \? await readerLabels\(ctx, site\._id\) : new Map<string, string>\(\);/);
  assert.match(pages, /if \(mostlyNonBuyerReaders\(page\.url, measurements\.rows, labels\)\) continue;/);
  assert.match(pages, /\(labels\.get\(o\.query\.trim\(\)\.toLowerCase\(\)\) \?\? "buyer"\) === "buyer"\);/, "a refresh answers a buyer's search, or an unlabeled one");
  assert.match(readFileSync("convex/lib/siteDiagnosisSchema.ts", "utf8"), /intents: v\.optional\(v\.array\(v\.object\(\{ query: v\.string\(\), label: v\.string\(\) \}\)\)\),/);
});
