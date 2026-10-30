// P257 (Oct 30 2026): Cowork's re-run on the fresh account (ops/COWORK-FRESH-ACCOUNT-RERUN-RESULTS-OCT31.md):
// 1. after approving the first draft, Generate wrote nothing ("Your existing draft request is retained");
// 3. a changed setup refused Generate without saying what to do; 4. "statements to check" listed the owner's own
// confirmed pricing and general advice; 5. an approved draft still said "Approve it when you're happy with it";
// 6. an owner's search was refused because an article listed it among its keywords for one section;
// 2. a Review-first site's dashboard said "Pentra is researching topics" though research runs for Autopilot only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { statementsToCheck } from "../convex/lib/articleQuality.ts";
import { ownerDraftNote } from "../convex/lib/plainReviewNotes.ts";

const profile = "Name: Madman Invoice\n\nDomain: madmanhakim.github.io\n\nSummary: Madman Invoice is a web app for freelancers to create and send invoices. Free plan: up to 5 invoices a month. Paid plan: $9 a month for unlimited invoices. Supports USD, EUR and GBP. Invoices are sent by email as PDFs.";
const claims = [
  "It is written for freelance designers, writers and developers in the US and UK who bill clients directly.",
  "If you are based in the US, that list is not a legal requirement for you.",
  "Contact information should include an email address that you actually monitor.",
  "The free plan covers up to 5 invoices a month, and the paid plan is $9 a month for unlimited invoices.",
  "Late invoices are paid 40% faster when they include a due date.",
  "Madman Invoice sends every invoice by email as a PDF.",
];
const notes = claims.map(c => `Unverified claim: «${c}»`).join(" ");

test("P257 statements to check leave out the owner's own confirmed facts and general advice", () => {
  assert.deepEqual(statementsToCheck({ factCheckNotes: notes, productEvidenceSnapshot: profile }), [claims[0], claims[1], claims[4]]);
  assert.ok(statementsToCheck({ factCheckNotes: notes }).includes(claims[3]), "without a confirmed profile a number is still worth checking");
  const page = readFileSync("src/app/(dashboard)/articles/[id]/page.tsx", "utf8");
  assert.match(page, /const unsourced = handedBack \? statementsToCheck\(article\) : \[\];/);
});

test("P257 an approved draft says so", () => {
  assert.match(ownerDraftNote("ready", undefined, true, "ready")!, /^Approved\. Publish it from the draft page/);
  assert.match(ownerDraftNote("ready", undefined, true, "review")!, /^Your draft is ready to read\. Approve it/);
});

test("P257 only a draft still being written holds the next request; a changed setup says what to do", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /const OWNER_DRAFT_WRITING_STAGES: readonly string\[\] = \["prepare", "review", "review_failed"\];/);
  assert.match(work, /const outstanding = jobs\.find\(ownerDraftWriting\);/);
  assert.match(work, /Open Settings, tick the box under “Review changed setup” and press Confirm changed setup/);
  const articles = readFileSync("src/app/(dashboard)/articles/page.tsx", "utf8");
  assert.match(articles, /readiness\.bindingCurrent === false && <p role="alert"/);
  assert.match(articles, /href="\/settings#changed-content-setup">Confirm the changed setup in Settings<\/Link>/);
  assert.doesNotMatch(articles, /Your existing draft request is retained/);
});

test("P257 an owner's search is refused only for a page about it, not a section listed among an article's keywords", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /const \{ topics, titleCoverage \} = await eligiblePlannedTopics\(ctx, site\);/);
  assert.match(work, /const page = titleCoverage\.find\(c => c\.primaryKeyword && contentIntentConflicts\(proposal, c\)\);/);
});

test("P257 a Review-first dashboard never says Pentra is researching topics", () => {
  const overview = readFileSync("src/components/content-work-overview.tsx", "utf8");
  assert.match(overview, /\{autopilot \? "Pentra is researching topics your customers search for\. They'll appear here\."\s*: "Pentra picks each draft's topic from your business details when you ask for one\./);
});
