import assert from "node:assert/strict";
import test from "node:test";
import { auditResultHash, contradictoryContentAudit, semanticAuditPrompt } from "../convex/lib/contentAudit.ts";
import { contentServiceStatus } from "../src/lib/content-service-status.ts";

const clean = { score: 92, notes: ["Original reasoning."], materialDefects: [], claimEvidence: [] };
test("semantic clarification accepts only complete contradictory audits, never promotes a score or edits raw evidence", () => {
  for (const audit of [{ ...clean, score: 83 }, { ...clean, score: 80 }, { ...clean, materialDefects: ["Unsupported factual claim."] }]) {
    const saved = JSON.stringify(audit), hash = auditResultHash(audit);
    assert.equal(contradictoryContentAudit(audit), true);
    const prompt = semanticAuditPrompt("SAME ARTICLE AND EVIDENCE", audit);
    assert.match(prompt, /Do not raise the score/); assert.match(prompt, /Original reasoning/);
    assert.ok(prompt.includes(saved)); assert.equal(JSON.stringify(audit), saved); assert.equal(auditResultHash(audit), hash);
  }
  for (const value of [clean, { ...clean, score: 80, materialDefects: ["Real defect."] }, null, {},
    { ...clean, score: undefined }, { ...clean, score: "83" }, { ...clean, score: 83, notes: undefined },
    { ...clean, score: 83, materialDefects: [""] }, { ...clean, score: 83, claimEvidence: [{ supported: true }] }]) {
    assert.equal(contradictoryContentAudit(value), false); assert.throws(() => semanticAuditPrompt("Article", value));
  }
});

test("one authoritative presentation distinguishes paused, preparing, failed, ready, active, unknown and legacy service", () => {
  const base = { serviceMode: "growth_first", enabled: true, bindingCurrent: true, entitlement: true, approvalRequired: false,
    schedule: { paused: false, active: false }, ready: 0, complete: true, work: [] };
  assert.equal(contentServiceStatus(null).status, "loading");
  for (const [state, expected] of [[base, "preparing"], [{ ...base, ready: 2 }, "ready"],
    [{ ...base, schedule: { paused: false, active: true } }, "active"],
    [{ ...base, schedule: { paused: true, active: true } }, "paused"],
    [{ ...base, bindingCurrent: false }, "changed"],
    [{ ...base, work: [{ stage: "failed", systemFailure: true }] }, "failed"]] as const) {
    const result = contentServiceStatus(state); assert.equal(result.status, expected); assert.notEqual(result.label, "Autopilot on");
    if (expected === "paused") { assert.equal(result.canPause, false); assert.equal(result.canResume, true); assert.equal(result.canRetry, false); }
    if (expected === "failed") { assert.equal(result.label, "Delivery needs attention"); assert.equal(result.canPause, true); assert.equal(result.canResume, false); assert.equal(result.canRetry, false); }
  }
  assert.equal(contentServiceStatus({ serviceMode: "legacy_articles", enabled: true }).label, "Autopilot on");
  assert.equal(contentServiceStatus({ serviceMode: "legacy_articles", enabled: false }).label, "Manual");
  assert.equal(contentServiceStatus({ ...base, work: [{ stage: "failed", systemFailure: true, retiredAt: 1 }] }).status, "preparing");
});
