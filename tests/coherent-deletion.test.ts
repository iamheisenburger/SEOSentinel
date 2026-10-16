import assert from "node:assert/strict";
import test from "node:test";
import { deleteSentencesCoherently } from "../convex/lib/coherentDeletion.ts";

const flagged = (sentence: string) => /GoHighLevel|UNSUPPORTED/.test(sentence);

test("Oct 15 scars are never produced: steps, quotes, orphaned references and dangling list intros are held", () => {
  const md = [
    "## What a chat widget does",
    "",
    "A chat widget connects visitors to a GoHighLevel conversation engine. The engine replies, and the conversation can store contact fields.",
    "",
    "## Next steps",
    "",
    "1. Write the single outcome.",
    "2. List the GoHighLevel questions visitors ask most.",
    "3. Sort them into answerable and unknown.",
    "",
    "## Grounding",
    "",
    "- **Grounded answers.** Check what the agent says. The demo shows \"GoHighLevel cannot answer. I can capture your question.\" Test it yourself.",
    "",
    "## Planning",
    "",
    "UNSUPPORTED paragraph that the next one refers to.",
    "",
    "This means you should plan carefully.",
    "",
    "Three parts matter:",
    "",
    "- UNSUPPORTED only remaining item.",
  ].join("\n");
  const r = deleteSentencesCoherently(md, flagged);
  assert.equal(r.markdown, md, r.removed.join(" | "));
  assert.equal(r.removed.length, 0);
  assert.equal(r.held.length, 5);
});

test("clean deletions still happen: a middle sentence, an independent bullet, an opening sentence nothing leans on", () => {
  const md = [
    "Intro paragraph that stays.",
    "",
    "## Forms",
    "",
    "UNSUPPORTED long forms reduce conversion. A shorter form can be tested when completion is weak.",
    "",
    "Keep the qualification step. UNSUPPORTED teams convert 3x more. Review results weekly.",
    "",
    "- Write down the problem.",
    "- UNSUPPORTED teams that do this convert more.",
  ].join("\n");
  const r = deleteSentencesCoherently(md, flagged);
  assert.equal(r.markdown, [
    "Intro paragraph that stays.",
    "",
    "## Forms",
    "",
    "A shorter form can be tested when completion is weak.",
    "",
    "Keep the qualification step. Review results weekly.",
    "",
    "- Write down the problem.",
    "",
  ].join("\n"));
  assert.deepEqual(r.removed, ["UNSUPPORTED long forms reduce conversion.", "UNSUPPORTED teams convert 3x more.", "UNSUPPORTED teams that do this convert more."]);
});

test("a section whose only content is unsupported goes with its heading, except a numbered step or the introduction", () => {
  const md = "Intro.\n\n## Numbers\n\nUNSUPPORTED 80% of clicks.\n\n## Step 2: Measure\n\nUNSUPPORTED step text.\n\n## End\n\nDone.";
  const r = deleteSentencesCoherently(md, flagged);
  assert.equal(r.markdown, "Intro.\n\n## Step 2: Measure\n\nUNSUPPORTED step text.\n\n## End\n\nDone.");
  const intro = "UNSUPPORTED intro.\n\n## Body\n\nText.";
  assert.equal(deleteSentencesCoherently(intro, flagged).markdown, intro);
});

test("headings, tables, code and URLs are never edited; nothing removed returns the exact input", () => {
  const md = "## UNSUPPORTED heading\n\n| UNSUPPORTED | cell |\n| --- | --- |\n\n```\nUNSUPPORTED code.\n```\n\n- https://example.com/UNSUPPORTED";
  const r = deleteSentencesCoherently(md, flagged);
  assert.equal(r.markdown, md);
  assert.equal(r.removed.length, 0);
});

test("an FAQ answer is never deleted out from under its question", () => {
  const md = "## FAQ\n\n**Does it work offline?**\nYes, it keeps a local copy.\n\n**Is there a free way to try it?**\nUNSUPPORTED free trial details.\n\n## Related reading";
  const r = deleteSentencesCoherently(md, flagged);
  assert.equal(r.markdown, md);
  assert.deepEqual(r.held, ["UNSUPPORTED free trial details."]);
  const sameLine = "## FAQ\n\n**Is there a free way to try it?** UNSUPPORTED free trial details.\n\n**Other?** Fine.";
  assert.equal(deleteSentencesCoherently(sameLine, flagged).markdown, "## FAQ\n\n**Other?** Fine.",
    "a question and answer on one line go together: no stranded question");
});
