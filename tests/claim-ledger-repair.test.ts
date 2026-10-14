import assert from "node:assert/strict";
import test from "node:test";

import { repairClaimLedgerByDeletion, validateClaimEvidenceLedger } from "../convex/lib/articleQuality.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";

const productEvidence = "Name: ExampleApp\nDomain: example.invalid\nExampleApp helps teams research keyword ranking and publish content. Its workflow records how the system works and what steps an author chose.";
const hash = sha256Hex(productEvidence);
const own = "ExampleApp helps teams research keyword ranking and publish content.";
const external = "VendorDock does not publish how its keyword ranking system works.";
const advice = "Before choosing a tool, list the three questions your team asks most often.";

test("a sentence the snapshot does not support is deleted from the article and its ledger entry", () => {
  const paragraph = `${own} ${external}`;
  const markdown = `## Choosing a tool\n\n${paragraph}\n\n${advice}\n`;
  const claimEvidence = [{ claim: paragraph, supported: true, citationNumbers: [], reason: "The auditor asserted support from overlapping vocabulary." }];
  const before = validateClaimEvidenceLedger({ markdown, sources: [], researchEvidence: "", productEvidence, productEvidenceHash: hash, claimEvidence });
  assert.equal(before.passed, false);
  const repaired = repairClaimLedgerByDeletion({ markdown, productEvidence, productEvidenceHash: hash, claimEvidence });
  assert.equal(repaired.removed, 1);
  assert.ok(!repaired.markdown.includes("VendorDock") && repaired.markdown.includes(own) && repaired.markdown.includes(advice), repaired.markdown);
  assert.equal(repaired.claimEvidence[0].claim, own);
  const after = validateClaimEvidenceLedger({ markdown: repaired.markdown, sources: [], researchEvidence: "", productEvidence, productEvidenceHash: hash, claimEvidence: repaired.claimEvidence });
  assert.equal(after.passed, true, after.issues.join("\n"));
});

test("a table whose ledger unit is unsupported is removed whole; prose around it stays", () => {
  const table = "| Option | Signal |\n|---|---|\n| VendorDock | Publishes ranking mechanics weekly |\n| ExampleApp | Records author steps |";
  const markdown = `## Compare\n\n${advice}\n\n${table}\n\n${own}\n`;
  const claimEvidence = [
    { claim: table, supported: false, citationNumbers: [], reason: "The table's VendorDock row has no retained evidence." },
    { claim: own, supported: true, citationNumbers: [], reason: "The first-party snapshot states this capability." },
  ];
  const repaired = repairClaimLedgerByDeletion({ markdown, productEvidence, productEvidenceHash: hash, claimEvidence });
  assert.ok(!repaired.markdown.includes("| Option |") && repaired.markdown.includes(advice) && repaired.markdown.includes(own), repaired.markdown);
  assert.deepEqual(repaired.claimEvidence.map(e => e.claim), [own]);
  const after = validateClaimEvidenceLedger({ markdown: repaired.markdown, sources: [], researchEvidence: "", productEvidence, productEvidenceHash: hash, claimEvidence: repaired.claimEvidence });
  assert.equal(after.passed, true, after.issues.join("\n"));
});

test("nothing is deleted without a hash-valid snapshot, from cited entries, or from supported text", () => {
  const paragraph = `${own} ${external}`;
  const markdown = `${paragraph}\n`;
  const claimEvidence = [{ claim: paragraph, supported: true, citationNumbers: [], reason: "The auditor asserted support from overlapping vocabulary." }];
  for (const productEvidenceHash of [undefined, "0".repeat(64)]) {
    const repaired = repairClaimLedgerByDeletion({ markdown, productEvidence, productEvidenceHash, claimEvidence });
    assert.equal(repaired.markdown, markdown);
    assert.equal(repaired.removed, 0);
  }
  const cited = [{ claim: paragraph, supported: true, citationNumbers: [1], reason: "Cited to source one, which the deterministic check verifies." }];
  assert.equal(repairClaimLedgerByDeletion({ markdown, productEvidence, productEvidenceHash: hash, claimEvidence: cited }).markdown, markdown);
  const supported = [{ claim: own, supported: true, citationNumbers: [], reason: "The first-party snapshot states this capability." }];
  assert.equal(repairClaimLedgerByDeletion({ markdown: `${own}\n`, productEvidence, productEvidenceHash: hash, claimEvidence: supported }).removed, 0);
});
