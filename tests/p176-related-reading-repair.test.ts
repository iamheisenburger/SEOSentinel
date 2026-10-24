// P176 (Oct 24 2026): a live scan of the owner sites found 34 Related reading entries cut at the old 8-word anchor cap
// ("What Is an AI Sales Agent? How It", on 9 LeadPilot pages). Autopilot completes them on its own enrolled pages
// through the exact correction path; this repair can only extend a cut title into the whole title.
import test from "node:test";
import assert from "node:assert/strict";
import { cutOfTitle, planCorrectiveChange, relatedReadingRepairProposal } from "../convex/lib/contentCorrection.ts";
import { relatedReadingTitle } from "../convex/lib/internalLinks.ts";

const titles = new Map([
  ["/blog/ai-sales-agent", "What Is an AI Sales Agent? How It Works and Why Websites Need One"],
  ["/blog/lead-scoring", "How to Build a B2B Lead Scoring System That Actually Works"],
  ["/blog/exit-intent", "Exit Intent Detection"],
]);
const list = "- [What Is an AI Sales Agent? How It](/blog/ai-sales-agent)\n- [Exit Intent Detection](/blog/exit-intent)\n- [How to Build a B2B Lead Scoring System](/blog/lead-scoring)";
const markdown = `Intro paragraph that stays exactly as it was written.\n\n## Related reading\n\n${list}\n\n## Sources\n\n1. [A source](https://example.org/a)`;
const page = (body: string, kind = "github") => ({ editable: { active: true, kind, markdown: body, sourceContent: `---\ntitle: "T"\n---\n\n${body}\n` } }) as never;

test("a cut Related reading title is completed; whole titles and other entries stay", () => {
  assert.equal(cutOfTitle("What Is an AI Sales Agent? How It", titles.get("/blog/ai-sales-agent")!), true);
  assert.equal(cutOfTitle("Exit Intent Detection", "Exit Intent Detection"), false);
  const proposal = relatedReadingRepairProposal(markdown, titles, relatedReadingTitle)!;
  assert.equal(proposal.before, list);
  assert.equal(proposal.replacement, "- [What Is an AI Sales Agent? How It Works and Why Websites Need One](/blog/ai-sales-agent)\n" +
    "- [Exit Intent Detection](/blog/exit-intent)\n- [How to Build a B2B Lead Scoring System That Actually Works](/blog/lead-scoring)");
  const patch = planCorrectiveChange({} as never, page(markdown), { kind: "related_reading_titles", before: proposal.before,
    replacement: proposal.replacement, reason: "Autopilot completes cut Related reading titles." });
  assert.equal(patch.after, proposal.replacement);
  assert.equal(patch.sourceAfter, proposal.replacement, "the GitHub source changes in exactly that list");
  assert.equal(relatedReadingRepairProposal(markdown.replace(list, proposal.replacement), titles, relatedReadingTitle), null, "a repaired list needs nothing");
});

test("the repair only extends cut titles in Pentra's Related reading list", () => {
  const reason = "Autopilot completes cut Related reading titles.";
  const attempt = (replacement: string, body = markdown, kind = "github") =>
    () => planCorrectiveChange({} as never, page(body, kind), { kind: "related_reading_titles", before: list, replacement, reason });
  assert.throws(attempt(list.replace("/blog/exit-intent", "/blog/other")), /cannot change a link/);
  assert.throws(attempt(list.replace("Exit Intent Detection", "A Different Article Name")), /only completes a cut title/);
  assert.throws(attempt(list.split("\n").slice(0, 2).join("\n")), /keeps the exact list/);
  assert.throws(attempt(list), /no cut title/);
  assert.throws(attempt(list.replace("How It](", "How It Works](") , markdown.replace("## Related reading", "## Further reading")), /Only Pentra's Related reading list/);
  assert.throws(attempt(list.replace("How It](", "How It Works]("), markdown, "wordpress"), /only to a GitHub Markdown source/);
});
