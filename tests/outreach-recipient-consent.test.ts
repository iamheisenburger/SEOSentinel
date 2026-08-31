import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GMAIL_RECIPIENT_CONSENT_POLICY_VERSION,
  gmailRecipientConsentCurrent,
  gmailRecipientConsentMatchesReceipt,
} from "../convex/lib/outreachRecipientConsent.ts";

const now = 1_800_000_000_000;
const current = {
  recipientConsentStatus: "verified",
  recipientConsentSource: "web_form",
  recipientConsentEvidenceHash: "a".repeat(64),
  recipientConsentPurpose: "commercial_email",
  recipientConsentRecordedAt: now - 1_000,
  recipientConsentExpiresAt: now + 1_000,
  recipientConsentPolicyVersion: GMAIL_RECIPIENT_CONSENT_POLICY_VERSION,
};

test("Gmail recipient consent is current only for a versioned affirmative receipt", () => {
  assert.equal(gmailRecipientConsentCurrent(current, now), true);
  assert.equal(gmailRecipientConsentCurrent({
    ...current,
    recipientConsentStatus: "revoked",
  }, now), false);
  assert.equal(gmailRecipientConsentCurrent({
    ...current,
    recipientConsentExpiresAt: now,
  }, now), false);
  assert.equal(gmailRecipientConsentCurrent({
    ...current,
    recipientConsentSource: "public_listing",
  }, now), false);
  assert.equal(gmailRecipientConsentCurrent({
    ...current,
    recipientConsentEvidenceHash: "not-a-receipt",
  }, now), false);
});

test("a Gmail policy receipt must match the current recipient consent exactly", () => {
  assert.equal(gmailRecipientConsentMatchesReceipt(current, current, now), true);
  assert.equal(gmailRecipientConsentMatchesReceipt(current, {
    ...current,
    recipientConsentEvidenceHash: "b".repeat(64),
  }, now), false);
});

test("Gmail consent is fenced at policy, approval, evidence claim, and provider boundary", () => {
  const outreach = readFileSync("convex/outreach.ts", "utf8");
  assert.match(outreach, /export const recordGmailRecipientConsent = mutation/);
  assert.match(outreach, /A public contact page proves discovery, not recipient consent/);
  assert.match(outreach, /Gmail approval requires current recipient opt-in evidence/);
  assert.match(outreach, /gmailRecipientConsentAuthorized/);
  assert.match(outreach, /recipient_consent_changed/);
  assert.match(outreach, /gmailRecipientConsentMatchesReceipt\(contact, policyReceipt, timestamp\)/);
});
