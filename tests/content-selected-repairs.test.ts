import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeImprovement, targetedImprovement, exactReplacement, contentWords, preserveWordPressReviewedText, classicHtmlMarkdown } from "../convex/lib/contentSelection.ts";
import { planCorrectiveChange, verifyCorrectivePatch } from "../convex/lib/contentCorrection.ts";
import { verifyCorrectedLink } from "../convex/lib/contentCorrectionProof.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";
import { articleWordCeiling } from "../convex/lib/articleQuality.ts";

const before = "Write down the decision you intend to make before choosing a tool or assigning an owner. Describe the boundary between an observation and an interpretation. If someone disputes a conclusion, ask which recorded detail they disagree with and what evidence would resolve the difference. Keep a place for uncertainty instead of treating a blank field as a confirmed negative.";
const after = "Propose a diagnostic walkthrough that makes the disputed handoff visible to an accountable reviewer. Separate the suspected cause from the recorded observation and describe a reversible experiment. Preserve unresolved contradictions alongside the proposed acceptance condition. Invite a colleague to reproduce the example and document which missing context prevents a conclusion.";
const site = { domain: "repair.example", siteSummary: "Confirmed irrigation maintenance scheduling software", productUsage: "Confirmed irrigation observation and maintenance workflows", keyFeatures: [] } as never;

test("bounded guidance at the actual word ceiling replaces only one paragraph, including a second meaningful edit", () => {
  // Capacity-only fixture, not a claim that placeholder prose passed an editor.
  const words = articleWordCeiling() - contentWords(before) - 2;
  const markdown = `Confirmed fact.\n\n${before}\n\n${Array(words).fill("context").join(" ")}`;
  const base = { title: "Confirmed guidance", kind: "github", markdown, sourceContent: markdown };
  assert.equal(contentWords(markdown), articleWordCeiling());
  const target = targetedImprovement(base, site, "diagnostic decision")!;
  assert.ok(target); assert.equal(target.maxWords, contentWords(before));
  const next = { title: base.title, markdown: exactReplacement(markdown, before, after) };
  assert.equal(assertSafeImprovement(base, next, target), after);
  assert.ok(contentWords(next.markdown) <= articleWordCeiling());
  const secondTarget = targetedImprovement({ ...base, ...next, sourceContent: next.markdown }, site, "handoff")!;
  const secondText = "Propose an explicit transfer checklist that distinguishes delegated responsibility from permission to approve. Identify the sender, receiver, acceptance evidence, and escalation route before transferring ownership. If acknowledgement is missing, retain the original assignee and flag the unresolved transfer. Let participants document objections and agree how an incomplete handover should be returned.";
  const second = { title: base.title, markdown: exactReplacement(next.markdown, secondTarget.before, secondText) };
  assert.equal(assertSafeImprovement(next, second, secondTarget), secondText);
  assert.ok(contentWords(second.markdown) <= articleWordCeiling());
  assert.ok(second.markdown.startsWith("Confirmed fact.\n\n"));
  assert.ok(second.markdown.endsWith(Array(words).fill("context").join(" ")));
});

test("targeted editing rejects no-op, cosmetic change, unrelated prose, new figures, links and excess length", () => {
  const base = { title: "Guidance", markdown: `${before}\n\nRetained customer fact.` };
  const target = { before, sourceBefore: before, maxWords: 80 };
  for (const changed of [before, before.replace("Write", "Record"), after + " The product saves 30%.", after + " [Learn](https://outside.example)", Array(100).fill("extra").join(" ")]) {
    assert.throws(() => assertSafeImprovement(base, { ...base, markdown: base.markdown.replace(before, changed) }, target));
  }
  assert.throws(() => assertSafeImprovement(base, { ...base, markdown: base.markdown.replace(before, after).replace("Retained", "Invented") }, target));
  assert.throws(() => exactReplacement(`${before}\n${before}`, before, after));
});

test("confirmed facts cannot be selected for discretionary replacement and unsupported layouts decline before work", () => {
  const fact = "The business provides " + "verified capabilities ".repeat(30);
  const markdown = fact + "\n\n" + "context ".repeat(1300);
  const s = { ...site as object, siteSummary: fact } as never;
  assert.equal(targetedImprovement({ kind: "github", markdown, sourceContent: markdown }, s, "business"), undefined);
  const narrative = "The office stands beside the orchard on the eastern lane. Harriet oversees the local workshop and keeps the original notebooks in the reception room. The team meets beside the entrance before moving to the work area. Their handwritten notes describe the building and the people responsible for its daily routines.";
  const narrativePage = narrative + "\n\n" + "context ".repeat(1300);
  assert.equal(targetedImprovement({ kind: "github", markdown: narrativePage, sourceContent: narrativePage }, site, "workshop"), undefined, "A source narrative is not editable guidance just because it misses a claim-detector pattern");
  assert.equal(targetedImprovement({ kind: "wordpress", markdown: before + "\n\n" + "context ".repeat(1300), sourceContent: '<div class="custom">unrelated layout</div>' }, site, "decision"), undefined);
});

test("owner factual corrections use exact confirmed evidence and retain source bytes in both adapters", () => {
  const wrong = "This company sells unrelated commercial paint through retail appointments.";
  for (const kind of ["github", "wordpress"]) {
    const markdown = wrong + "\n\n" + before, sourceContent = kind === "github" ? markdown : preserveWordPressReviewedText(renderSafePublicationHtml(markdown));
    const page = { url: "https://repair.example/blog/example", editable: { active: true, kind, markdown, sourceContent } } as never;
    const input = { kind: "factual_correction" as const, before: wrong, reason: "Owner confirms the wrong business description.", field: "siteSummary" as const };
    const patch = planCorrectiveChange(site, page, input);
    assert.equal(patch.after, (site as {siteSummary:string}).siteSummary);
    assert.equal(verifyCorrectivePatch(site, page, patch), markdown.replace(wrong, patch.after));
    assert.throws(() => verifyCorrectivePatch(site, page, { ...patch, after: "Invented business capability." }));
    assert.throws(() => verifyCorrectivePatch(site, page, { ...patch, sourceAfter: "Arbitrary replacement" }));
    assert.throws(() => planCorrectiveChange(site, page, { ...input, before: wrong + "\n\n" + before }));
  }
});

test("broken-link correction preserves anchor and prose and verifies a visible href, not text or hidden copies", () => {
  const markdown = "Consult the [owner guidance](https://repair.example/blog/missing) before deciding what to do next.";
  const page = { url: "https://repair.example/blog/example", editable: { active: true, kind: "wordpress", markdown, sourceContent: preserveWordPressReviewedText(renderSafePublicationHtml(markdown)) } } as never;
  const input = { kind: "technical_repair" as const, before: markdown, reason: "Owner confirms the broken internal navigation target.", targetUrl: "https://repair.example/blog/verified" };
  const patch = planCorrectiveChange(site, page, input), html = renderSafePublicationHtml(patch.after);
  verifyCorrectedLink(html, patch);
  assert.throws(() => verifyCorrectedLink(renderSafePublicationHtml(markdown), patch));
  assert.throws(() => verifyCorrectedLink(`<div hidden>${html}</div>`, patch));
  assert.throws(() => verifyCorrectedLink(`<script>${html}</script>`, patch));
  assert.throws(() => planCorrectiveChange(site, page, { ...input, targetUrl: "https://foreign.example/blog/target" }));
  assert.equal(classicHtmlMarkdown(html), patch.after);
});
