import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("existing-draft review performs one evidence-bound length recovery before terminal failure", () => {
  const source = readFileSync("convex/actions/pipeline.ts", "utf8");
  const start = source.indexOf("async function reviewExistingArticleHandler");
  const end = source.indexOf("export const reviewExistingArticleInternal", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  const recoveryStart = handler.indexOf("if (stats.wordCount < minimumWords)");
  const terminalCheck = handler.indexOf(
    "if (stats.wordCount < minimumWords || stats.wordCount > maxWords)",
  );
  assert.ok(recoveryStart >= 0 && terminalCheck > recoveryStart);

  const recovery = handler.slice(recoveryStart, terminalCheck);
  assert.match(recovery, /remediateFinalArticle\(\{/);
  assert.match(recovery, /using only the supplied product and research evidence/);
  assert.match(recovery, /factCheckArticle\(/);
  assert.match(recovery, /auditFinalArticleWithUnsupportedClaimRemoval\(\{/);
  assert.match(recovery, /reviewed = lengthFactChecked/);
  assert.match(recovery, /stats = calculateArticleStats\(exactReviewedMarkdown\)/);
  assert.equal(
    (recovery.match(/remediateFinalArticle\(\{/g) ?? []).length,
    1,
    "length recovery must stay bounded to one provider remediation pass",
  );
});
