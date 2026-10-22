import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeImprovement, spliceRefreshSection } from "../convex/lib/contentSelection.ts";

// P161 (Oct 22 2026): LeadPilot's first automatic refresh came back with a renamed H1 on top and without a stray
// line of the page; the section-only check rejected it three times and the slot went to a new article.
const title = "Lead Scoring Template: Turn Website Conversations Into Next Steps";
const base = [
  "A lead scoring template should answer one practical question: what should happen next for this visitor.",
  "## Copy this lead scoring template",
  "Record what the visitor said, what they asked and which evidence supports each field before choosing an action.",
  "## Final lead-scoring checklist",
  "- [ ] What did the visitor actually say or ask?",
  "[LeadPilot](https://leadpilot.chat/)",
  ": https://leadpilot.chat/",
  "## Related reading",
  "- [B2B lead qualification](/blog/b2b-lead-qualification)",
].join("\n\n") + "\n";
const target = { before: "## Final lead-scoring checklist", sourceBefore: "## Final lead-scoring checklist", maxWords: 350, mode: "insert_section" as const };
const sentence = "Work through the worksheet in the order the conversation gives you information, and let the evidence decide the action before any score is added.";
const section = `## How do you fill in a lead scoring template for a website conversation?\n\n${Array.from({ length: 7 }, () => sentence).join(" ")}`;

test("a refresh draft that drifted outside its section is rebuilt from the page's source", () => {
  const drifted = `# Lead Scoring Template: Record Website Conversation Evidence\n\n${base.replace("## Final lead-scoring checklist", `${section}\n\n## Final lead-scoring checklist`)
    .replace(": https://leadpilot.chat/\n\n", "")}`;
  assert.throws(() => assertSafeImprovement({ title, markdown: base }, { title, markdown: drifted }, target), /changed existing article text/);
  const spliced = spliceRefreshSection(base, drifted, target)!;
  assert.equal(spliced, base.trimEnd().replace("## Final lead-scoring checklist", `${section}\n\n## Final lead-scoring checklist`));
  assert.equal(assertSafeImprovement({ title, markdown: base }, { title, markdown: spliced }, target), `${section}\n\n${target.before}`);
  // A clean draft is unchanged.
  assert.equal(spliceRefreshSection(base, spliced, target), spliced);
});

test("only the first new section is kept, and a draft without one is left to the check", () => {
  const twoNew = base.replace("## Final lead-scoring checklist", `${section}\n\n## Another new section\n\n${sentence}\n\n## Final lead-scoring checklist`);
  assert.equal(spliceRefreshSection(base, twoNew, target), base.trimEnd().replace("## Final lead-scoring checklist", `${section}\n\n## Final lead-scoring checklist`));
  assert.equal(spliceRefreshSection(base, `# Renamed\n\n${base}`, target), null, "no new section: nothing to splice");
  assert.equal(spliceRefreshSection(base, base, { ...target, before: "## Missing anchor" }), null);
});
