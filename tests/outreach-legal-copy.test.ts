import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const terms = readFileSync("src/app/legal/terms/page.tsx", "utf8");
const privacy = readFileSync("src/app/legal/privacy/page.tsx", "utf8");
const runbook = readFileSync("docs/OUTREACH_INBOUND_RELAY_RUNBOOK.md", "utf8");
const publicCopy = `${terms}\n${privacy}\n${runbook}`;

test("public outreach copy describes the bounded initial-only consent contract", () => {
  for (const source of [terms, privacy, runbook]) {
    assert.match(source, /tenant-level consent/i);
    assert.match(source, /one verified initial\s+outreach email/i);
    assert.match(source, /never authorizes?\s+(?:an\s+)?automated\s+follow-up/i);
  }

  assert.match(runbook, /Manual\s+mode remains distinct/);
  assert.doesNotMatch(publicCopy, /schedule at most two Gmail-threaded follow-ups/i);
});

test("public outreach copy describes disable settlement and bodyless relay boundaries", () => {
  for (const source of [terms, privacy, runbook]) {
    assert.match(source, /stops? new delivery claims|prevents? new delivery claims|blocks? new delivery claims/i);
    assert.match(source, /already claimed|claimed before/i);
    assert.match(source, /settle/i);
  }

  assert.match(terms, /signed, bodyless results/);
  assert.match(privacy, /signed, bodyless results/);
  assert.match(runbook, /Raw MIME, attachments, subject and body never cross the durable mutation boundary/);
});

test("public retention copy distinguishes site deletion from verified account deletion", () => {
  for (const source of [terms, privacy, runbook]) {
    assert.match(source, /account-wide[\s\S]*suppression and contact-cooldown/i);
    assert.match(source, /ordinary site deletion[\s\S]*(?:survive|preserves?|does not delete)/i);
    assert.match(source, /full-account deletion[\s\S]*purges?|purges?[\s\S]*full-account deletion/i);
    assert.match(source, /global hashed sender\s+reputation and pacing record/i);
    assert.match(source, /no more than 90 days/i);
  }
});
