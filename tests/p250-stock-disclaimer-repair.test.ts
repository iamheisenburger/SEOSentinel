// P250 (Oct 30 2026): until P248 the writer was told to label proposed frameworks "as recommendations, not established
// industry facts"; 10 of the owner sites' live pages (pentra.dev 4 of 34, LeadPilot 6 of 122) say so in one stock
// clause, pipeline text since P248. Autopilot's repair chain removes only that clause from the live page, through the
// exact correction path (readerTextRepair: only process wording goes, nothing is added), one page at a time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planCorrectiveChange, RELATED_REPAIR_VERSION, stockDisclaimerRepairProposal } from "../convex/lib/contentCorrection.ts";

const page = (body: string) => ({ editable: { active: true, kind: "github", markdown: body, sourceContent: `---\ntitle: "T"\n---\n\n${body}\n` } }) as never;
const reason = "Autopilot removes the stock clause its writer added before P248.";

test("P250 the stock disclaimer clause leaves a live page; the advice around it stays word for word", () => {
  const live = [ // the live sentences (pentra.dev and LeadPilot, Oct 30 2026)
    ["This guide walks through a method. The method is a recommendation, not an industry standard, and every judgement call in it is something you can check against your own Search Console data.",
      "This guide walks through a method. The method is a recommendation, and every judgement call in it is something you can check against your own Search Console data."],
    ["This is a recommendation, not an industry rule: decide those two things first, then compare products only within the matching category.",
      "This is a recommendation: decide those two things first, then compare products only within the matching category."],
    ["The framework is the author's recommendation, not an industry standard.", "The framework is the author's recommendation."],
    ["The workflow in the later sections is the author's recommendation, not an industry standard, so adjust it to your own pace.",
      "The workflow in the later sections is the author's recommendation, so adjust it to your own pace."],
    ["Treat these thresholds as recommendations, not industry rules.", "Treat these thresholds as recommendations."],
    ["The scoring order is a recommendation rather than an established standard.", "The scoring order is a recommendation."],
  ];
  for (const [paragraph, expected] of live) {
    const markdown = `## Intro\n\n${paragraph}\n\n## Next\n\nMore text that stays.`;
    const proposal = stockDisclaimerRepairProposal(markdown);
    assert.deepEqual(proposal, { before: paragraph, replacement: expected }, paragraph);
    const patch = planCorrectiveChange({} as never, page(markdown), { kind: "reader_text_repair", before: proposal!.before, replacement: proposal!.replacement, reason });
    assert.equal(patch.sourceAfter, expected, "the GitHub source changes in exactly that paragraph");
  }
  assert.equal(stockDisclaimerRepairProposal("Plain advice that names no standard.\n\nGoogle's recommendation is to keep titles short."), null);
});

test("P250 the repair chain offers it when a page's links need nothing, under a new rule version", () => {
  const improvements = readFileSync("convex/contentImprovements.ts", "utf8");
  assert.match(improvements, /const stock = related \? null : stockDisclaimerRepairProposal\(e\.markdown\);/);
  assert.match(improvements, /kind: stock \? "reader_text_repair" : "related_reading_titles"/);
  assert.ok(RELATED_REPAIR_VERSION >= 4, "a fresh pass re-checks every page (P272: 5, its variants)");
});

// C3 (Cowork's launch audit): /beta did not say what happens after the 60 days.
test("P250 the founding beta says what happens when it ends", () => {
  assert.match(readFileSync("src/app/beta/page.tsx", "utf8"), /after 60 days you keep the free plan \(3 articles a month\) unless you choose a paid one/);
});

