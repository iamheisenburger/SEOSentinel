import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OUTREACH_DELIVERY_LEASE_MS,
  approvalMatchesInbox,
  autonomousGmailCredentialIssues,
  deliveryLeaseState,
  gmailHttpFailureDisposition,
  liveDnsEvidenceIssues,
  opportunityEvidenceIsFresh,
  outreachDeletionGate,
  sanitizeDeliveryFailure,
  senderClaimIssues,
} from "../convex/lib/outreachDelivery.ts";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

test("autonomous Gmail credentials are durable and exactly send-only", () => {
  const send = "https://www.googleapis.com/auth/gmail.send";
  assert.deepEqual(autonomousGmailCredentialIssues({
    oauthScopes: `${send} openid email`,
    hasRefreshToken: true,
  }), []);
  assert.ok(autonomousGmailCredentialIssues({
    oauthScopes: `${send} https://www.googleapis.com/auth/gmail.readonly`,
    hasRefreshToken: true,
  }).length > 0);
  assert.ok(autonomousGmailCredentialIssues({
    oauthScopes: send,
    hasRefreshToken: false,
  }).some((issue) => /offline/i.test(issue)));
});

test("every plausibly ambiguous Gmail HTTP response is quarantined", () => {
  for (const status of [408, 409, 425, 429, 500, 503, 599]) {
    assert.equal(gmailHttpFailureDisposition(status).unverified, true, String(status));
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(gmailHttpFailureDisposition(status).unverified, false, String(status));
  }
  assert.equal(gmailHttpFailureDisposition(401).suspend, true);
  assert.equal(gmailHttpFailureDisposition(403).suspend, true);
  assert.equal(gmailHttpFailureDisposition(429).suspend, false);
});

test("opportunity evidence must still be fresh when delivery is claimed", () => {
  assert.equal(opportunityEvidenceIsFresh({ verifiedAt: NOW, now: NOW }), true);
  assert.equal(
    opportunityEvidenceIsFresh({
      verifiedAt: NOW - 7 * 24 * 60 * 60 * 1000 - 1,
      now: NOW,
    }),
    false,
  );
  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(
    backend,
    /opportunityEvidenceIsFresh\(\{[\s\S]*verifiedAt: opportunity\.verifiedAt,[\s\S]*now,[\s\S]*\}\)/,
  );
});

test("the exact source evidence is re-fetched and semantically bound to the atomic claim", () => {
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  const fetchAt = action.indexOf("async function liveOpportunityEvidence");
  const claimAt = action.indexOf("internal.outreach.claimApprovedDelivery");
  assert.ok(fetchAt >= 0 && claimAt > fetchAt);
  assert.match(action, /getApprovedDeliveryEvidenceInternal/);
  assert.match(action, /isSameOrganisationHost\(finalHost, requested\.hostname\)/);
  assert.match(action, /authorityEvidenceReceipt/);
  assert.match(action, /hasExactAnchorHref/);
  assert.match(action, /hasExactUnlinkedMention/);
  assert.doesNotMatch(action, /createHash\("sha256"\)\.update\(fetched\.text\)/);
  assert.match(action, /opportunityEvidence,/);

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /opportunityEvidence\.messageId !== message\._id/);
  assert.match(backend, /opportunityEvidence\.opportunityId !== opportunity\._id/);
  assert.match(backend, /opportunityEvidence\.evidenceHash !== opportunity\.evidenceHash/);
  assert.match(
    backend,
    /OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS/,
  );
});

test("one active tenant lease blocks a concurrent delivery claim", () => {
  assert.equal(deliveryLeaseState({
    status: "sending",
    attemptId: "attempt-one",
    leaseExpiresAt: NOW + OUTREACH_DELIVERY_LEASE_MS,
    now: NOW,
  }), "in_flight");
  assert.equal(deliveryLeaseState({
    status: "approved",
    now: NOW,
  }), "available");

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /claimApprovedDelivery = internalMutation/);
  assert.match(backend, /eq\("status", "sending"\)/);
  assert.match(backend, /status: "sending"/);
  assert.match(backend, /Another outreach delivery is already in progress/);
});

test("an expired lease becomes unverified and the same message never returns to approved", () => {
  assert.equal(deliveryLeaseState({
    status: "sending",
    attemptId: "attempt-one",
    leaseExpiresAt: NOW - 1,
    now: NOW,
  }), "expired_unverified");
  assert.equal(deliveryLeaseState({
    status: "sending",
    now: NOW,
  }), "expired_unverified");

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /status: "delivery_unverified"/);
  assert.match(backend, /will not be retried automatically/);
  assert.match(backend, /resolveUnverifiedDelivery = mutation/);
  assert.match(backend, /confirmed_not_sent/);
  assert.match(backend, /delivery_reviewed_sent/);
  const completion = backend.slice(
    backend.indexOf("export const completeDeliveryAttempt"),
    backend.indexOf("export const failDeliveryAttempt"),
  );
  assert.doesNotMatch(completion, /ctx\.db\.patch\(messageId, \{\s*status: "approved"/);
  assert.match(completion, /queueNextVerifiedAutonomousFollowUp/);
  assert.ok(
    completion.indexOf("Delivery lease expired before receipt finalization") <
      completion.indexOf("queueNextVerifiedAutonomousFollowUp"),
    "an expired provider lease must become terminal before any next step is considered",
  );
  const manualReview = backend.slice(
    backend.indexOf("export const resolveUnverifiedDelivery"),
    backend.indexOf("export const recordReply"),
  );
  assert.doesNotMatch(
    manualReview,
    /queueNextVerifiedAutonomousFollowUp/,
    "a human assertion without the exact provider thread receipt cannot create a follow-up",
  );
});

test("every post-send settlement preserves newer terminal authority evidence", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.equal(
    backend.match(/outreachDeliverySettlementDecision\(\{/g)?.length,
    7,
    "Gmail receipt, owner review, signed relay, exact managed_ses, and signed Smartlead paths must share the terminal-state fence",
  );
  assert.equal(
    backend.match(/settlementLifecycle\.shouldMarkContacted/g)?.length,
    3,
  );
  const managedSettlement = backend.slice(
    backend.indexOf("export async function settleManagedSesAcceptedMessage"),
    backend.indexOf("export const completeManagedSesDeliveryAttempt"),
  );
  assert.match(managedSettlement, /message\.deliveryTransport !== MANAGED_SES_TRANSPORT/);
  assert.match(managedSettlement, /providerMessageIdDigest/);
  assert.match(managedSettlement, /rfcMessageIdDigest/);
  assert.match(managedSettlement, /threadReceipt/);
  assert.match(managedSettlement, /settled: false, followUpQueued: false/);
  assert.match(managedSettlement, /outreachDeliverySettlementDecision\(\{/);
});

test("tenant deletion is serialized behind live delivery and expired claims require review", () => {
  assert.deepEqual(
    outreachDeletionGate({
      sending: [
        {
          messageId: "live",
          status: "sending",
          attemptId: "attempt-live",
          leaseExpiresAt: NOW + OUTREACH_DELIVERY_LEASE_MS,
        },
        {
          messageId: "expired",
          status: "sending",
          attemptId: "attempt-expired",
          leaseExpiresAt: NOW - 1,
        },
      ],
      unresolvedDeliveryCount: 0,
      now: NOW,
    }),
    {
      state: "in_flight",
      expiredMessageIds: [],
      safePreboundaryMessageIds: [],
    },
    "a live claim must make the entire deletion attempt a no-op",
  );
  assert.deepEqual(
    outreachDeletionGate({
      sending: [{
        messageId: "expired",
        status: "sending",
        attemptId: "attempt-expired",
        leaseExpiresAt: NOW - 1,
      }],
      unresolvedDeliveryCount: 0,
      now: NOW,
    }),
    {
      state: "expired_unverified",
      expiredMessageIds: ["expired"],
      safePreboundaryMessageIds: [],
    },
  );
  assert.deepEqual(
    outreachDeletionGate({
      sending: [],
      unresolvedDeliveryCount: 1,
      now: NOW,
    }),
    {
      state: "manual_review",
      expiredMessageIds: [],
      safePreboundaryMessageIds: [],
    },
  );
  assert.deepEqual(
    outreachDeletionGate({
      sending: [],
      unresolvedDeliveryCount: 0,
      now: NOW,
    }),
    { state: "ready", expiredMessageIds: [], safePreboundaryMessageIds: [] },
  );
});

test("tenant deletion drains only exact expired pre-provider claims", () => {
  assert.deepEqual(outreachDeletionGate({
    sending: [{
      messageId: "v1-preboundary",
      status: "sending",
      attemptId: "attempt-v1",
      leaseExpiresAt: NOW - 1,
      boundaryVersion: 1,
    }],
    unresolvedDeliveryCount: 0,
    now: NOW,
  }), {
    state: "ready",
    expiredMessageIds: [],
    safePreboundaryMessageIds: ["v1-preboundary"],
  });
  for (const sending of [
    {
      messageId: "legacy",
      status: "sending",
      attemptId: "attempt-legacy",
      leaseExpiresAt: NOW - 1,
    },
    {
      messageId: "v1-postboundary",
      status: "sending",
      attemptId: "attempt-v1-post",
      leaseExpiresAt: NOW - 1,
      boundaryVersion: 1,
      externalAttemptedAt: NOW - 2,
    },
  ]) {
    assert.deepEqual(outreachDeletionGate({
      sending: [sending],
      unresolvedDeliveryCount: 0,
      now: NOW,
    }), {
      state: "expired_unverified",
      expiredMessageIds: [sending.messageId],
      safePreboundaryMessageIds: [],
    });
  }
  const sitesSource = readFileSync(
    new URL("../convex/sites.ts", import.meta.url),
    "utf8",
  );
  assert.match(sitesSource, /decision\.safePreboundaryMessageIds/);
  assert.match(sitesSource, /releaseDurableContactClaimForAccount/);
});

test("approval is bound to the exact inbox connection and sender profile version", () => {
  assert.equal(approvalMatchesInbox({
    messageInboxId: "inbox-a",
    approvedInboxId: "inbox-a",
    approvedInboxConfigurationVersion: 4,
    inboxId: "inbox-a",
    inboxConfigurationVersion: 4,
  }), true);
  assert.equal(approvalMatchesInbox({
    messageInboxId: "inbox-a",
    approvedInboxId: "inbox-a",
    approvedInboxConfigurationVersion: 3,
    inboxId: "inbox-a",
    inboxConfigurationVersion: 4,
  }), false);
  assert.equal(approvalMatchesInbox({
    messageInboxId: "inbox-a",
    approvedInboxId: undefined,
    approvedInboxConfigurationVersion: undefined,
    inboxId: "inbox-a",
    inboxConfigurationVersion: 0,
  }), false, "legacy approvals must fail closed");

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /configurationVersion: \(existing\?\.configurationVersion \?\? 0\) \+ 1/);
  assert.match(backend, /approvedInboxConfigurationVersion/);
  assert.match(backend, /older sender connection or compliance profile/);
});

test("claim-time sender validation rejects primary domains and stale or failed DNS", () => {
  assert.ok(senderClaimIssues({
    siteDomain: "tenant.com",
    provider: "gmail",
    status: "active",
    fromEmail: "hello@tenant.com",
    fromName: "Tenant Team",
    physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
    complianceConfirmedAt: NOW,
    verifiedAt: NOW,
    oauthScopes: "https://www.googleapis.com/auth/gmail.send",
    hasCredential: true,
    senderDomain: "tenant.com",
  }).some((issue) => issue.includes("primary")));

  assert.ok(liveDnsEvidenceIssues({
    checkedAt: NOW - 2 * 60 * 1000,
    now: NOW,
    senderDomain: "gettenant.com",
    expectedSenderDomain: "gettenant.com",
    dkimSelector: "google",
    expectedDkimSelector: "google",
    spf: true,
    dkim: true,
    dmarc: true,
  }).some((issue) => issue.includes("stale")));
  assert.ok(liveDnsEvidenceIssues({
    checkedAt: NOW,
    now: NOW,
    senderDomain: "gettenant.com",
    expectedSenderDomain: "gettenant.com",
    dkimSelector: "google",
    expectedDkimSelector: "google",
    spf: true,
    dkim: false,
    dmarc: true,
  }).some((issue) => issue.includes("SPF, DKIM and DMARC")));
});

test("Gmail is called only after the atomic claim and outcomes require the matching attempt", () => {
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  const claimAt = action.indexOf("internal.outreach.claimApprovedDelivery");
  const deliverAt = action.indexOf("outcome = await deliver({");
  assert.ok(claimAt > 0 && deliverAt > claimAt);
  assert.match(action, /completeDeliveryAttempt/);
  assert.match(action, /failDeliveryAttempt/);
  assert.doesNotMatch(action, /sendApprovedOutreachInternal/);

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /message\.deliveryAttemptId !== attemptId/);
  assert.match(backend, /opportunityLifecycleMatches/);
  assert.match(backend, /message\.opportunityEvidenceHash !== opportunity\.evidenceHash/);
  assert.match(backend, /message\.opportunitySourceUrl !== opportunity\.sourceUrl/);
  assert.match(backend, /message\.opportunityTargetUrl !== opportunity\.targetUrl/);
  assert.match(backend, /outreach_suppressions/);
  assert.match(backend, /contactEligibility/);
});

test("discard cannot race a sending lease and the public action sends at most one", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /\["sending", "delivery_unverified"\]\.includes\(message\.status\)/);
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  assert.match(action, /one owner-approved message per click\/action/);
  assert.match(action, /return sendHandler\(ctx, siteId, "approved"\)/);
});

test("site domain changes demote the sender and invalidate approvals", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /demoteOutreachForDomainChange/);
  assert.match(sites, /status: "connected"/);
  assert.match(sites, /mode: "approval"/);
  assert.match(sites, /verifiedAt: undefined/);
  assert.match(sites, /configurationVersion: \(inbox\.configurationVersion \?\? 0\) \+ 1/);
  assert.match(sites, /cannot change while outreach delivery is in progress/);
});

test("stored delivery errors are sanitized and ambiguous outcomes require review", () => {
  assert.equal(
    sanitizeDeliveryFailure("secret token abc failed"),
    "The Gmail authorization is unavailable; reconnect the inbox before review.",
  );
  assert.equal(
    sanitizeDeliveryFailure("provider said HTTP 403 account=user@example.com"),
    "Gmail delivery failed with HTTP 403.",
  );
  assert.equal(
    sanitizeDeliveryFailure("network aborted"),
    "Gmail did not confirm delivery before the request timeout; manual review is required.",
  );
});

test("contact receipts reject cross-organisation redirects and store the fetched URL", () => {
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  assert.match(action, /isSameOrganisationHost\(finalHost, domain\)/);
  assert.match(action, /foundOn: fetched\.value\.url/);
  assert.doesNotMatch(action, /foundOn: url,/);
});

test("link receipts reject cross-organisation redirects and store the final publisher URL", () => {
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  const verifier = action.slice(action.indexOf("async function pageLinksToTarget"));
  assert.match(verifier, /isSameOrganisationHost\(finalHost, requestedHost\)/);
  assert.match(verifier, /return \{ found: false \}/);
  assert.match(verifier, /receiptUrl: found \? fetched\.url : undefined/);
  assert.match(verifier, /acquiredLinkUrl: receipt\.receiptUrl/);
  assert.doesNotMatch(verifier, /acquiredLinkUrl: opportunity\.sourceUrl/);
});

test("only a fresh authority scan can recover a discarded or definitively failed draft", () => {
  const authority = readFileSync("convex/seoAuthority.ts", "utf8");
  assert.match(authority, /existing\.status === "outreach_prepared"/);
  assert.match(authority, /withIndex\("by_opportunity"/);
  assert.match(authority, /!hasLiveOrDeliveredMessage/);
  assert.match(authority, /outreachPreparedAt: undefined/);
  assert.match(authority, /delivery_unverified/);

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(
    backend,
    /Run a fresh authority scan before generating and approving a new draft/,
  );
});

test("pre-send evidence is semantic and contact publication is re-fetched", () => {
  const action = readFileSync("convex/actions/outreach.ts", "utf8");
  assert.match(action, /authorityEvidenceReceipt/);
  assert.match(action, /hasExactAnchorHref/);
  assert.match(action, /hasExactUnlinkedMention/);
  assert.match(action, /extractContactCandidates/);
  assert.match(action, /contactReceiptUrl: contactPage\.url/);
  const liveEvidence = action.slice(
    action.indexOf("async function liveOpportunityEvidence"),
    action.indexOf("async function deliver"),
  );
  assert.doesNotMatch(
    liveEvidence,
    /createHash\("sha256"\)\.update\(fetched\.text\)/,
  );

  const backend = readFileSync("convex/outreach.ts", "utf8");
  assert.match(backend, /contact\.discoveredFromUrl !== opportunityEvidence\.contactReceiptUrl/);
  assert.match(backend, /opportunityEvidence\.contactCheckedAt/);
});
