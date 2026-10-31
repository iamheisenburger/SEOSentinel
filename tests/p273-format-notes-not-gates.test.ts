// P273 (Oct 31 2026): P268 raised a list's option floor to 6, and the plan's format check held pentra.dev's Nov 1 Autopilot
// article ("Plan check: A list needs at least 6 items (it has 5).") until its slot failed. Rule 2a: only objective,
// reader-facing checks hold an Autopilot draft. A missing outline section or format element goes to the one fix and the
// notes, never the gate; a number no source states, a product fact outside the profile and an unnamed person still block.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCheckIssues, planCheckNotes, runPlanChecks } from "../convex/lib/articlePlanChecks.ts";

const sheet = { sources: [{ url: "https://www.irs.gov/p583", text: "Keep records for 3 years." }], profile: "Name: Pentra", productName: "Pentra" };

test("P273 a list one option short, a missing section or a missing table is a note for the fix, never a gate", () => {
  const list = "Intro.\n\n## Options\n\n### One\n\nA.\n\n### Two\n\nB.\n\n### Three\n\nC.\n\n### Four\n\nD.\n\n### Five\n\nE.";
  const failures = runPlanChecks(list, sheet, { format: "list", sections: ["Options", "How to choose"], minItems: 6 });
  assert.deepEqual(planCheckIssues(failures), [], "nothing holds the draft");
  assert.deepEqual(planCheckNotes(failures), ["Plan note: The outline's section \"How to choose\" is missing.", "Plan note: A list needs at least 6 items (it has 5)."]);
  const comparison = runPlanChecks("Intro.\n\n## Compare\n\nNo table.", sheet, { format: "comparison", sections: ["Compare"] });
  assert.deepEqual(planCheckIssues(comparison), []);
});

test("P273 a number no source states still holds the draft", () => {
  const failures = runPlanChecks("Intro.\n\n## Options\n\nMost owners save 40% of their time.", sheet, { format: "guide", sections: ["Options"] });
  assert.deepEqual(planCheckIssues(failures), ["Plan check: 1 sentence(s) state a number that is not in the fact sheet or the confirmed details."]);
  assert.match(readFileSync("convex/actions/pipeline.ts", "utf8"), /\.\.\.fixNotes, \.\.\.planCheckIssues\(failures\), \.\.\.planCheckNotes\(failures\),/);
});
