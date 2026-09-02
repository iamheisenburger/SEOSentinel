import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("existing-draft review performs bounded evidence-safe fixed-point recovery before terminal failure", () => {
  const source = readFileSync("convex/actions/pipeline.ts", "utf8");
  const start = source.indexOf("async function reviewExistingArticleHandler");
  const end = source.indexOf("export const reviewExistingArticleInternal", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  const recoveryStart = handler.indexOf("let lengthRecoveryPass = 1");
  const terminalCheck = handler.indexOf(
    "if (stats.wordCount < minimumWords || stats.wordCount > maxWords)",
  );
  assert.ok(recoveryStart >= 0 && terminalCheck > recoveryStart);

  const recovery = handler.slice(recoveryStart, terminalCheck);
  assert.match(recovery, /evidenceSafeLengthRecoveryTarget\(\{/);
  assert.match(recovery, /remediateFinalArticle\(\{/);
  assert.match(recovery, /lengthRecoveryPass <= 3/);
  assert.match(recovery, /deterministic evidence pruning can still leave the final artifact above/);
  assert.match(recovery, /minWords: recoveryTargetWords/);
  assert.match(recovery, /purpose: "evidence_safe_length_recovery"/);
  assert.match(recovery, /factCheckArticle\(/);
  assert.match(recovery, /auditFinalArticleWithUnsupportedClaimRemoval\(\{/);
  assert.match(recovery, /reviewed = lengthFactChecked/);
  assert.match(recovery, /stats = calculateArticleStats\(exactReviewedMarkdown\)/);
  assert.equal(
    (recovery.match(/remediateFinalArticle\(\{/g) ?? []).length,
    1,
    "one remediation call site must remain inside the explicit three-pass bound",
  );
});

test("length recovery uses a dedicated non-contradictory editor contract", () => {
  const source = readFileSync("convex/actions/pipeline.ts", "utf8");
  const start = source.indexOf("async function remediateFinalArticle");
  const end = source.indexOf("async function generateFinalMetadata", start);
  assert.ok(start >= 0 && end > start);
  const remediation = source.slice(start, end);

  assert.match(remediation, /const lengthRecovery = args\.purpose ===/);
  assert.match(remediation, /The stated minimum is a binding output contract/);
  assert.match(remediation, /reader-run procedures, input checklists, decision questions/);
  assert.match(remediation, /Do not optimize for a higher score through extra length/);
});

test("a recovery review persists its exact defect version instead of skipping later repairs", () => {
  const source = readFileSync("convex/actions/pipeline.ts", "utf8");
  const start = source.indexOf("async function reviewExistingArticleHandler");
  const end = source.indexOf("export const reviewExistingArticleInternal", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  assert.match(handler, /qualityRecoveryVersion\?: number/);
  assert.match(
    handler,
    /qualityRecoveryVersion: appliedQualityRecoveryVersion/,
  );
  assert.match(
    source,
    /qualityRecoveryVersion:\s*\n\s*qualityRecoveryAttemptVersionFromJob\(job\)/,
  );
});
