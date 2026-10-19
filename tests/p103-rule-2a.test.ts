import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// P103, rule 2a (owner decision, Oct 19 2026): objective, reader-visible checks
// decide publication; LLM scores are notes. Positives below are the exact
// defects that went live or were held on the owner sites in October 2026.

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("reader-visible defects: the October live scars and pipeline text are caught", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  const cases: [string, RegExp][] = [
    ["In practice, this has three consequences for how you hunt for near-page-one pages:\n\n- Look at position per query, not per page.\n- Pages with no impressions have no recorded position.\n",
      /"three consequences" introduces only 2 items/],
    ["Look at three signals and read them together:\n\n- Impressions show whether the page is shown more often.\n- Clicks show whether the snippet persuades people.\n",
      /"three signals" introduces only 2 items/],
    ["If you use a tool like that, two checks follow:\n\n- **Confirm the pages you want it to learn from are publicly reachable.**\n\n## Quick reference\n\n- Use relative paths.\n",
      /"two checks" introduces only 1 item/],
    ["Steps:\n\n1. Export the queries.\n3. Sort by impressions.\n4. Pick the page.\n", /numbered list jumps from 1 to 3/],
    ["## Step 1: Pick the outcome\n\nText.\n\n## Step 3: Write the questions\n\nText.\n", /steps jump from Step 1 to Step 3/],
    ["**Step 3:** Ask.\n\n**Step 5:** Route.\n", /steps jump from Step 3 to Step 5/],
    ["The excerpt is truncated, so this article relies only on that one statement.", /pipeline text/],
    ["No external sources were verified for this draft, so the guidance below is a set of checks.", /pipeline text/],
    ["Based on the supplied evidence, the tool supports exports.", /pipeline text/],
    ["- First point\n-\n- Third point\n", /an empty list item/],
    ["## Sources\n\n- [1] One https://a.example\n\n## Sources\n\n- [1] One https://a.example\n", /2 Sources sections/],
    ["## Where Pentra fits\n\n## Sources\n\n- [1] One https://a.example\n", /section "Where Pentra fits" has no content/],
  ];
  for (const [markdown, expected] of cases) {
    const found = readerVisibleDefects(markdown);
    assert.ok(found.some((defect) => expected.test(defect)), `${expected} in ${JSON.stringify(found)} for ${JSON.stringify(markdown.slice(0, 60))}`);
  }
});

test("reader-visible defects: legitimate prose, code and numbering are not flagged", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  const clean = [
    // The count refers to topics, not to the questions listed (a real draft).
    "For a shortlist of, say, ten candidate topics, you can use Trends to ask:\n\n1. Is interest flat or growing?\n2. Is there a seasonal pattern?\n3. Is interest in your regions?\n4. Do related queries match?\n",
    // "First-party evidence" as ordinary SEO vocabulary (a real draft).
    "You can filter by country in Search Console. That is first-party evidence for where demand may already exist.",
    "Ask them to identify the retained evidence, unresolved objections and the next action.",
    // Markdown renders "1. 1. 1." as 1, 2, 3.
    "Do this:\n\n1. Export.\n1. Sort.\n1. Pick.\n",
    // A section whose only content is a code example is not empty.
    "## Example\n\n```html\n<script src=\"https://example.org/widget.js\"></script>\n```\n\n## Next step\n\nText.\n",
    // A list with as many items as announced, with nested detail.
    "Three things matter:\n\n- Fit\n  - industry\n- Intent\n- Timing\n",
    "## Step 1: Pick\n\nText.\n\n## Step 2: Write\n\nText.\n\n## Step 3: Test\n\nText.\n",
    "Use a two-step check before you publish: draft, then review.",
  ];
  for (const markdown of clean) assert.deepEqual(readerVisibleDefects(markdown), [], markdown.slice(0, 60));
});

test("invented statistics: a cited number must be in the cited source's verified excerpt", async () => {
  const { citedNumberMismatches } = await import("../convex/lib/articleQuality.ts");
  const excerpt = "In our 2025 study of 1,200 sites, 42% of pages that ranked in the top ten had been updated within a year. ".repeat(3);
  const sources = [{ url: "https://research.example/study", title: "Study", excerpt, contentHash: sha(excerpt) }];
  assert.deepEqual(citedNumberMismatches("Of pages in the top ten, 42% had been updated within a year [1].", sources), []);
  assert.equal(citedNumberMismatches("Of pages in the top ten, 45% had been updated within a year [1].", sources).length, 1);
  // A source without a verified excerpt cannot support a number.
  const unhashed = [{ ...sources[0], contentHash: "not-the-hash" }];
  assert.equal(citedNumberMismatches("Of pages in the top ten, 42% had been updated within a year [1].", unhashed).length, 1);
  // Digits inside a link target are not a claim; a sentence with no number is not checked here.
  assert.deepEqual(citedNumberMismatches("See the guide [[1]](https://research.example/2024/guide-77).", sources), []);
  assert.deepEqual(citedNumberMismatches("Updating pages helps them stay relevant [1].", sources), []);
});

test("product claims: numbers about the customer's product must be in the confirmed profile", async () => {
  const { productNumberMismatches } = await import("../convex/lib/articleQuality.ts");
  const profile = "Name: Pentra\n\nDomain: pentra.dev\n\nPricing: Starter costs $49 a month for 10 articles.";
  const hash = sha(profile);
  assert.deepEqual(productNumberMismatches("Pentra Starter costs $49 a month for 10 articles.", profile, hash), []);
  assert.equal(productNumberMismatches("Pentra Starter costs $39 a month.", profile, hash).length, 1);
  assert.deepEqual(productNumberMismatches("![Pentra dashboard](https://pentra.dev/img-123.png)", profile, hash), []);
  assert.deepEqual(productNumberMismatches("Most teams publish 4 articles a month.", profile, hash), [], "not about the product");
  assert.deepEqual(productNumberMismatches("Pentra Starter costs $39 a month.", profile, "wrong-hash"), [], "unverifiable profile: no verdict");
});

test("checkable fact-check findings: cited, numeric or product sentences; general advice is not", async () => {
  const { checkableFactCheckFindings, autopilotEditPassIssue, autopilotVerificationNote } = await import("../convex/lib/autopilotEditor.ts");
  const findings = [
    "Google Search Console shows queries for the last 16 months.",
    "Keyword Planner groups ideas by theme [2].",
    "Pentra checks every article before it is published.",
    "Start with the pages that are already close to page one.",
    "Start with the pages that are already close to page one.",
  ];
  assert.deepEqual(checkableFactCheckFindings(findings, "Pentra"), findings.slice(0, 3));
  assert.match(autopilotEditPassIssue(3), /^Autopilot edit pass: 3 fact-check finding/);
  assert.match(autopilotVerificationNote("A «quoted» claim."), /^Verify against the preserved sources and the business profile: «A quoted claim\.»/);
});

test("applyFactCheckFindings keepText keeps every sentence and scores over all listed claims", async () => {
  const { applyFactCheckFindings } = await import("../convex/lib/articleQuality.ts");
  const markdown = "# Title\n\nThe register keeps 12 notes per observation. Review it weekly.\n";
  const kept = applyFactCheckFindings({ markdown, unverifiedClaims: ["The register keeps 12 notes per observation."],
    claimCount: 4, verifiedCount: 3, confidenceScore: 75, keepText: true });
  assert.equal(kept.markdown, markdown, "nothing is cut");
  assert.equal(kept.confidenceScore, 75, "the unverified claim still counts against the score");
  const cut = applyFactCheckFindings({ markdown, unverifiedClaims: ["The register keeps 12 notes per observation."],
    claimCount: 4, verifiedCount: 3, confidenceScore: 75 });
  assert.notEqual(cut.markdown, markdown, "the legacy path still deletes");
});

test("rule 2a acceptance: reader-visible issues block the seal for every actor", async () => {
  const { readerVisibleIssues } = await import("../convex/lib/articleQuality.ts");
  const article = { markdown: "Look at three signals and read them together:\n\n- One.\n- Two.\n", sources: [] };
  assert.equal(readerVisibleIssues(article).length, 1);
  assert.deepEqual(readerVisibleIssues({ markdown: "A clean paragraph that says something useful.", sources: [] }), []);
});
