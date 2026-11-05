/** P361 (Nov 5 2026), Phase 6: the weekly results email. Right after the week's diagnosis (rollout sites first), the owner
 * hears what Google showed this week against the week before, the five factors and biggest problems the diagnosis
 * measured, what Pentra fixed (merges, folds, and whether each is live), what it published and improved, and what it does
 * next. Only measured numbers, in plain words. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { weeklyReportEmail } from "../convex/lib/customerNotices.ts";

test("the weekly email says what Google showed, what Pentra found and fixed, and what it does next, in plain words", () => {
  const email = weeklyReportEmail({ domain: "leadpilot.chat",
    search: { clicks: 3, impressions: 820, previousClicks: 1, previousImpressions: 760 },
    factors: { searches: "weak", pages: "failing", authority: "failing", clicks: "failing", ai: "unknown" },
    problems: ["It ranks on page one, but almost nobody clicks: 3 clicks from 1034 page-one impressions (about 64 expected at those positions)"],
    fixed: [{ kind: "folded", from: "/b2b-lead-scoring-system", to: "/sales-lead-scoring-system-2", live: true },
      { kind: "merged", from: "/crm-lead-scoring-guide", to: "/sales-lead-scoring-system-2", live: false }],
    published: [{ title: "Lead Qualification Specialist: What the Role Does", url: "https://leadpilot.chat/blog/lead-qualification-specialist" }],
    improved: [], aiNamed: { named: 0, asked: 15 }, next: "Aim new pages at searches buyers make; stop writing for these readers." });
  assert.equal(email.subject, "Your week on Google: leadpilot.chat");
  for (const line of ["- 3 clicks (up 200% on the week before)", "- 820 impressions (up 8% on the week before)", "- Searches it can win: weak",
    "- Named by AI assistants: not measured yet", "  (ChatGPT, Gemini and Google AI Mode named you in 0 of 15 answers to buyer questions)",
    "- Folded an article Google never showed into the one it does: /b2b-lead-scoring-system now leads to /sales-lead-scoring-system-2",
    "- Merged a duplicate article into the stronger one: /crm-lead-scoring-guide now leads to /sales-lead-scoring-system-2 (going live)",
    "Published: 1 new article", "Next: Aim new pages at searches buyers make; stop writing for these readers."]) {
    assert.ok(email.text.includes(line), line);
  }
  assert.match(email.text, /turn these emails off in Settings/);
  assert.doesNotMatch(email.text, /\b(?:slot|gate|deploy|ship|pipeline|SERP|KD)\b/i, "no internal words");
  const quiet = weeklyReportEmail({ domain: "pentra.dev", search: "not_connected", factors: {}, problems: [], fixed: [], published: [], improved: [], aiNamed: null, next: null });
  assert.match(quiet.text, /Connect Google Search Console in your dashboard/);
  assert.match(quiet.text, /Published: no new articles this week/);
});

test("it follows the week's diagnosis on the rollout sites, once a week, after the delivered redirects are checked", () => {
  const diagnosis = readFileSync("convex/siteDiagnosis.ts", "utf8");
  assert.match(diagnosis, /if \(DIAGNOSIS_ROLLOUT_DOMAINS\.includes\(bareDomain\(site\.domain\)\)\) await noteWeeklyReport\(ctx, site\);/);
  assert.match(diagnosis, /const WEEKLY_REPORT_DELAY_MS = 20 \* 60_000;/);
  assert.match(diagnosis, /eq\("kind", "weekly_report"\)\.eq\("key", week\)\)\.first\(\);\n  if \(logged\) return;/, "one a week, whatever reruns");
  const emails = readFileSync("convex/customerEmails.ts", "utf8");
  assert.match(emails, /if \(!diagnosis \|\| now - diagnosis\.createdAt > 3 \* DAY\) return null;/, "never without a fresh diagnosis");
  assert.match(emails, /else if \(log\.kind === "weekly_report"\) \{\n    message = await weeklyReport\(ctx, site, domain\);/);
  assert.match(readFileSync("convex/schema.ts", "utf8"), /v\.literal\("draft_ready"\), v\.literal\("weekly_report"\)\)/);
});
