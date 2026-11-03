// P294 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md steps 2 and 6): a new signup's first draft still held after its one fix was
// handed back as "Open it to see what to check" (homework, and since P289 nothing in it is marked); it is now kept
// internally and Pentra writes the next topic once (the end-to-end run is in core-pipeline-integration.test.ts). And prices
// say when they were read, in code: LeadPilot's Nov 4 chatbot list gave Tidio's and Zendesk's prices undated though the
// writer was told to date them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withPriceDate } from "../convex/lib/backedFacts.ts";

const at = Date.UTC(2026, 10, 3);

test("P294 a planned article's prices say when they were read, inline beside the first price (v3.1)", () => {
  assert.equal(withPriceDate("Intro.\n\n## Compare the options\n\n### Tidio\n\n**Price:** $39 a month [2].", at),
    "Intro.\n\n## Compare the options\n\n### Tidio\n\n**Price:** $39 (as of November 2026) a month [2].");
  assert.equal(withPriceDate("Plans start at $12 a month [1].\n\n## Next\n\nMore.", at),
    "Plans start at $12 (as of November 2026) a month [1].\n\n## Next\n\nMore.");
  for (const unchanged of ["Prices as of October 2026: $5 a month [1].", "No prices here.", "Text.\n\n## Sources\n\n1. A $9 page.", "```\nconst price = '$5';\n```"]) {
    assert.equal(withPriceDate(unchanged, at), unchanged);
  }
  // v3.1 (batch 6): a standalone "Prices as of…" line the writer left is pipeline text and goes; the bank-reconciliation
  // article carried one under "Documents you need", a section with no price.
  assert.equal(withPriceDate("## Documents you need\n\nPrices as of November 2026.\n\nGather these.", at),
    "## Documents you need\n\nGather these.");
  // P295 runs the empty-section and FAQ-order fixes in the same line, before the gate; v3.1 renumbers citations after them.
  assert.match(readFileSync("convex/actions/pipeline.ts", "utf8"), /markdown: renumberCitations\(withPriceDate\(withFaqLast\(emptied\.markdown\), article\.createdAt \?\? Date\.now\(\)\)\) \};\n\s+const candidate = candidateFor\(fields\);/);
});

test("P294 an owner's held planned draft gets the next topic once, never a third draft", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /const OWNER_NEXT_TOPIC_SUFFIX = ":next-topic";/);
  assert.match(work, /if \(cw\.ownerRequest && !cw\.ownerRequest\.sourceArticleId && cw\.intent === "create" && draft\?\.qualityPlan === "fixed_v1" &&\n\s+!cw\.ownerRequest\.key\.endsWith\(OWNER_NEXT_TOPIC_SUFFIX\)\) \{/,
    "planned new drafts only (an owner's edit keeps its text), and only once");
  assert.match(work, /await ctx\.db\.patch\(held\._id, \{ contentWork: \{ \.\.\.cw, retiredAt: Date\.now\(\) \}, updatedAt: Date\.now\(\) \}\);\n\s+await archiveRetiredContentArtifact\(ctx, \(await ctx\.db\.get\(held\._id\)\)!\);/);
});
