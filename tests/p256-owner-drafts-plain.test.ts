// P256 (Oct 30 2026): Cowork's fresh account wrote its first article in about two minutes, then read "didn't pass
// Pentra's quality review" and "Fact-check score is 78; strict minimum is 85" on it, with no way to approve it: the
// owner-review bar still held drafts on LLM scores (editorial 62) and a 98-character search description, which rule 2a
// had made notes for Autopilot only. Research kept 1 of 8 cited pages (6 were vendor blogs). Now: rule 2a for the owner
// too, the draft reads as ready to read with one line on what isn't sourced, no score is shown, and research makes one
// more bounded pass for primary sources when it keeps fewer than two.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ownerWaivableIssue } from "../convex/lib/articleQuality.ts";
import { HANDED_BACK_DRAFT, ownerDraftNote, ownerDraftReadable, plainReviewNote, plainReviewNotes, sourcingLine, unsourcedIssue,
  UNSOURCED_NOTE } from "../convex/lib/plainReviewNotes.ts";
import { PRIMARY_PASS_BELOW, primarySourcesRequest, sourceHosts } from "../convex/lib/researchPasses.ts";

// The fresh account's first draft, exactly as the publication check left it.
const FRESH_ISSUES = [
  "Meta description is too short for a useful search snippet (minimum 100 characters).",
  "Fact-check score is 78; strict minimum is 85.",
  "Editorial quality score is 62; strict minimum is 85.",
  "Strict publication requires a completed claim-to-evidence audit.",
];

test("P256 the fresh account's first draft has only notes: its owner can approve it", () => {
  for (const issue of FRESH_ISSUES) assert.equal(ownerWaivableIssue(issue, { factCheckScore: 78, claimEvidenceStatus: "failed" }), true, issue);
  // The objective checks still block.
  for (const issue of ["Reader-visible defect: pipeline text \"the preserved excerpts\" must not appear in an article.",
    "Reader-visible defect: 1 cited sentence(s) state a number their source does not contain, e.g. «Invoices are paid 40% faster [1].».",
    "A product-specific section requires validated first-party product evidence.", "Article contains a script tag; structured data belongs in the renderer."]) {
    assert.equal(ownerWaivableIssue(issue, { factCheckScore: 78 }), false, issue);
  }
});

test("P256 customers never read a score, a threshold or a check's name", () => {
  const notes = plainReviewNotes(FRESH_ISSUES);
  for (const note of notes) assert.doesNotMatch(note, /score|strict|minimum is|audit|ledger|\b\d{2}\b(?! to)/i, note);
  assert.ok(notes.includes(UNSOURCED_NOTE), "the fact check and the claim audit read as one plain line on sourcing");
  assert.equal(notes.filter(note => note === UNSOURCED_NOTE).length, 1);
  assert.match(plainReviewNote("Reader-visible defect: 1 cited sentence(s) state a number their source does not contain, e.g. «Invoices are paid 40% faster [1].»."),
    /^A number isn't in the source it cites: «Invoices are paid 40% faster \[1\]\.»/);
  assert.equal(plainReviewNote("Reader-visible defect: the section \"Pricing\" has no content."), "The section \"Pricing\" has no content.");
  assert.match(plainReviewNote("Claim ledger entry 3 is unsupported: the excerpt does not mention US tax."), /^Some statements aren't backed by a source yet/);
  assert.ok(unsourcedIssue("Fact-check score is 78; strict minimum is 85.") && !unsourcedIssue("Meta title is missing."));
  assert.equal(sourcingLine([{ url: "https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include" }], 6),
    "Backed by 1 source (gov.uk). 6 statements aren't matched to a source yet: check them, or edit them out, before you publish.");
});

test("P256 an owner's draft reads as a draft to read, never as a failure", () => {
  const notes = [
    ownerDraftNote("prepare", undefined, false), ownerDraftNote("review", undefined, true), ownerDraftNote("review_failed", "content_review_rejected", true),
    ownerDraftNote("ready", undefined, true), ownerDraftNote("failed", "bounded_content_quality_exhausted", true),
  ];
  for (const note of notes) assert.doesNotMatch(note ?? "", /didn't pass|failed|score|reviewer's notes/i, note ?? "");
  assert.match(ownerDraftNote("failed", "bounded_content_quality_exhausted", true)!, /^Your draft is ready to read\./);
  assert.equal(ownerDraftReadable("failed", "bounded_content_quality_exhausted", true), true);
  assert.equal(ownerDraftReadable("failed", "owner_rejected_draft", true), false);
  assert.equal(ownerDraftReadable("review_failed", "content_review_rejected", true), false, "Pentra is still revising it");
  assert.equal(ownerDraftNote("failed", "owner_rejected_draft", true), null, "other endings keep their own plain message");
  const customer = readFileSync("convex/lib/contentCustomer.ts", "utf8");
  assert.match(customer, /if \(reason === "bounded_content_quality_exhausted"\) return HANDED_BACK_DRAFT;/);
  assert.doesNotMatch(customer, /didn't pass Pentra's quality review/);
  assert.match(HANDED_BACK_DRAFT, /^Your draft is ready to read\./);
});

test("P256 the article page approves with one button and shows one plain sourcing line", () => {
  const page = readFileSync("src/app/(dashboard)/articles/[id]/page.tsx", "utf8");
  assert.match(page, /if \(acceptNotes\) await acceptOwnerReviewNotes\(\{ articleId, artifactHash: publicationArtifactHash\(article\) \}\);/);
  assert.match(page, /\{\(plainApproveAllowed \|\| acceptNotes\) && \(/);
  assert.match(page, /aria-label="Before you publish"/);
  assert.match(page, /sourcingLine\(article\.sources \?\? \[\], unsourced\.length\)/);
  assert.match(page, /plainReviewNotes\(blockingGateIssues\)/);
  assert.doesNotMatch(page, /Accept notes and approve for publishing|Fix these before requesting review|aria-label="Reviewer notes"/);
  assert.doesNotMatch(page, /<li key=\{index\}>\{issue\}<\/li>/, "no raw check result is rendered");
  const articles = readFileSync("src/app/(dashboard)/articles/page.tsx", "utf8");
  assert.doesNotMatch(articles, /stageLabel\(readiness\.ownerDraft\.latest\.stage\)/);
  const server = readFileSync("convex/articles.ts", "utf8");
  assert.match(server, /Fix this first: \$\{plainReviewNotes\(result\.blocking\)\.join\(" "\)\}/);
  assert.match(server, /isApiCmsMethod\(site\.publishMethod\) \|\| pasteDestination\(site\)\)\)/, "a site whose owner pastes articles approves too");
});

test("P256 the overview shows a Review-first owner's latest draft with Read it now", () => {
  const overview = readFileSync("src/components/content-work-overview.tsx", "utf8");
  assert.match(overview, /s\?\.ownerReviewedOnly && state\.ownerDraft\?\.latest && \(state\.ownerDraft\.latest\.readable \|\| OPEN_DRAFT_STAGES\.includes\(state\.ownerDraft\.latest\.stage\)\)\s*\? <LatestDraft /);
  assert.match(overview, /Read it now<\/Link>/);
  assert.doesNotMatch(overview, /"Revision needed"|"Quality review"/);
});

test("P256 research makes one more bounded pass for primary sources when it keeps fewer than three (P259)", () => {
  assert.equal(PRIMARY_PASS_BELOW, 3, "P259, Arshad's cost rule: research gathers 3 to 5 real sources");
  const request = primarySourcesRequest({ label: "What Should a Freelance Invoice Include?", primaryKeyword: "what should a freelance invoice include",
    targetCountry: "US, UK", siteName: "Madman Invoice", avoidHosts: sourceHosts(["https://www.freshbooks.com/hub/invoicing/x", "https://quickbooks.intuit.com/r/y",
      "https://www.freshbooks.com/hub/z"]) });
  assert.match(request.system, /primary sources only: government and regulator pages/);
  assert.match(request.system, /each one's own official source/);
  assert.match(request.userMessage, /Already found, not usable as evidence \(do not cite\): freshbooks\.com, quickbooks\.intuit\.com\n/);
  assert.match(request.userMessage, /Readers are in: US, UK/);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  // P262: a "best X" list's second pass looks up its options instead (tests/p261-live-trial-fixes.test.ts).
  assert.match(pipeline, /: kept\.readable\.length < PRIMARY_PASS_BELOW\) \{/);
  assert.match(pipeline, /maxUses: PRIMARY_PASS_SEARCHES, firstPartyProducts: namedProducts, pass: "primary", \.\.\.\(planned \? \{ reputableSecondary: true, maxTokens: 8000 \} : \{\}\) \}\);/);
  assert.match(pipeline, /researchQualityNotes\.push\(`Primary-source research pass unavailable: /, "a failed pass never stops the draft");
  const provider = readFileSync("convex/actions/contentWorkProvider.ts", "utf8");
  // Its receipt key keeps ":web_research:", so a refused research call stays optional (contentWork's rejection handling).
  assert.match(provider, /const logicalKey = `\$\{cw\.replacements\}:\$\{s\.phase\}:web_research\$\{args\.pass \? `:\$\{args\.pass\}` : ""\}`;/);
});

test("P256 a revision rewrites a search description the publication check flagged", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /\.\.\.\(article\.publicationGateIssues \?\? \[\]\)\.filter\(\(issue\) => \/\^Meta \(\?:description\|title\)\\b\/\.test\(issue\)\)\];/);
});
