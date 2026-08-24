import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  OUTREACH_AUTONOMY_CONSENT_TEXT,
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_POLICY_HASH,
  autonomousMessageAuthorizationMatches,
  autonomousOutreachConsentActive,
  autonomousOutreachRuntimeEnabled,
} from "../convex/lib/outreachAutonomy.ts";

const ACTIVE = {
  mode: "live",
  configurationVersion: 7,
  autonomyConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
  autonomyConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
  autonomyConsentAcceptedAt: 1_700_000_000_000,
  autonomyConsentAcceptedBy: "owner-1",
  autonomyConsentInboxConfigurationVersion: 7,
};

test("autonomous delivery requires the explicit runtime release switch", () => {
  assert.equal(
    createHash("sha256").update(OUTREACH_AUTONOMY_CONSENT_TEXT).digest("hex"),
    OUTREACH_AUTONOMY_POLICY_HASH,
    "the accepted policy hash must seal the exact owner-visible consent text",
  );
  assert.equal(autonomousOutreachRuntimeEnabled("true"), true);
  assert.equal(autonomousOutreachRuntimeEnabled(" TRUE "), true);
  for (const value of [undefined, "", "1", "yes", "false"]) {
    assert.equal(autonomousOutreachRuntimeEnabled(value), false);
  }
});

test("consent is active only for the exact current inbox configuration", () => {
  assert.equal(autonomousOutreachConsentActive(ACTIVE, "owner-1"), true);
  assert.equal(
    autonomousOutreachConsentActive({ ...ACTIVE, mode: "approval" }, "owner-1"),
    false,
  );
  assert.equal(
    autonomousOutreachConsentActive(
      { ...ACTIVE, configurationVersion: 8 },
      "owner-1",
    ),
    false,
  );
  assert.equal(
    autonomousOutreachConsentActive({
      ...ACTIVE,
      autonomyConsentPolicyHash: "stale-policy",
    }, "owner-1"),
    false,
  );
  assert.equal(
    autonomousOutreachConsentActive({
      ...ACTIVE,
      autonomyDisabledAt: ACTIVE.autonomyConsentAcceptedAt + 1,
    }, "owner-1"),
    false,
  );
  assert.equal(
    autonomousOutreachConsentActive(ACTIVE, "new-owner"),
    false,
  );
});

test("an automatic message is inseparable from the consent that authorized it", () => {
  assert.equal(
    autonomousMessageAuthorizationMatches({
      inbox: ACTIVE,
      ownerId: "owner-1",
      approvalKind: "account_autopilot",
      approvalConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
      approvalConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
      approvalConsentAcceptedAt: ACTIVE.autonomyConsentAcceptedAt,
    }),
    true,
  );
  assert.equal(
    autonomousMessageAuthorizationMatches({
      inbox: ACTIVE,
      ownerId: "owner-1",
      approvalKind: "owner_message",
      approvalConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
      approvalConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
      approvalConsentAcceptedAt: ACTIVE.autonomyConsentAcceptedAt,
    }),
    false,
  );
  assert.equal(
    autonomousMessageAuthorizationMatches({
      inbox: { ...ACTIVE, autonomyConsentAcceptedAt: 1_800_000_000_000 },
      ownerId: "owner-1",
      approvalKind: "account_autopilot",
      approvalConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
      approvalConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
      approvalConsentAcceptedAt: ACTIVE.autonomyConsentAcceptedAt,
    }),
    false,
  );
});
