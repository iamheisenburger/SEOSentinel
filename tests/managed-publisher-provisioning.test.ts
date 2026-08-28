import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Doc } from "../convex/_generated/dataModel.ts";
import {
  managedProvisioningDecision,
  oneSetupCapabilityReadiness,
} from "../convex/lib/oneSetup.ts";
import {
  expectedPublisherDestinationReceipt,
  publisherAutopublishConsentCurrent,
  publisherAutopublishConsentReceipt,
  publisherConnectionComplete,
  publisherDestinationReceiptExactlyMatches,
  publisherDestinationReceiptVerified,
  publisherStandingAutopublishConsentCurrent,
  PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH,
  PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
  PUBLISHER_DESTINATION_RECEIPT_FRESH_MS,
} from "../convex/lib/publisherProvisioning.ts";

const timestamp = 1_900_000_000_000;
const ownerAccountKey = "owner-account-a";

function githubSite(
  overrides: Partial<Doc<"sites">> = {},
): Doc<"sites"> {
  return {
    _id: "site-a" as Doc<"sites">["_id"],
    _creationTime: timestamp - 10_000,
    domain: "example.com",
    canonicalDomain: "example.com",
    canonicalDomainRevision: 3,
    userId: "user-a",
    publishMethod: "github",
    repoOwner: "Owner",
    repoName: "Website",
    repoDefaultBranch: "main",
    githubToken: "github-secret-token",
    urlStructure: "/blog/[slug]",
    publisherConnectionGeneration: 7,
    createdAt: timestamp - 10_000,
    updatedAt: timestamp - 5_000,
    ...overrides,
  };
}

test("publisher destination receipt equality is field-based and fail closed", () => {
  const receipt = expectedPublisherDestinationReceipt({
    site: githubSite(),
    ownerAccountKey,
    verifiedAt: timestamp,
  });
  assert.ok(receipt);
  const reordered = {
    verifiedAt: receipt.verifiedAt,
    adapterVersion: receipt.adapterVersion,
    connectionGeneration: receipt.connectionGeneration,
    configHash: receipt.configHash,
    domainRevision: receipt.domainRevision,
    canonicalDomain: receipt.canonicalDomain,
    ownerAccountKey: receipt.ownerAccountKey,
    destinationId: receipt.destinationId,
    method: receipt.method,
    status: receipt.status,
    version: receipt.version,
  };
  assert.equal(
    JSON.stringify(reordered) === JSON.stringify(receipt),
    false,
  );
  assert.equal(
    publisherDestinationReceiptExactlyMatches(reordered, receipt),
    true,
  );
  assert.equal(
    publisherDestinationReceiptExactlyMatches(
      { ...reordered, connectionGeneration: receipt.connectionGeneration + 1 },
      receipt,
    ),
    false,
  );
});

function exactReceipt(site = githubSite()) {
  const receipt = expectedPublisherDestinationReceipt({
    site,
    ownerAccountKey,
    verifiedAt: timestamp,
  });
  assert.ok(receipt);
  return receipt;
}

test("canonical destination proof is bound to owner, domain epoch, config, generation, and freshness", () => {
  const site = githubSite();
  const receipt = exactReceipt(site);
  const verifiedSite = { ...site, publisherDestinationReceipt: receipt };
  assert.equal(
    publisherDestinationReceiptVerified({
      site: verifiedSite,
      ownerAccountKey,
      timestamp: timestamp + 1_000,
    }),
    true,
  );

  for (const invalid of [
    { ownerAccountKey: "owner-account-b" },
    { site: { ...verifiedSite, canonicalDomain: "other.example" } },
    { site: { ...verifiedSite, canonicalDomainRevision: 4 } },
    { site: { ...verifiedSite, repoName: "other-repository" } },
    { site: { ...verifiedSite, githubToken: "rotated-token" } },
    { site: { ...verifiedSite, publisherConnectionGeneration: 8 } },
    {
      timestamp:
        timestamp + PUBLISHER_DESTINATION_RECEIPT_FRESH_MS + 1,
    },
    {
      site: {
        ...verifiedSite,
        publisherDestinationReceipt: {
          ...receipt,
          status: "revoked" as const,
          revokedAt: timestamp + 1,
        },
      },
    },
  ]) {
    assert.equal(
      publisherDestinationReceiptVerified({
        site: invalid.site ?? verifiedSite,
        ownerAccountKey: invalid.ownerAccountKey ?? ownerAccountKey,
        timestamp: invalid.timestamp ?? timestamp + 1_000,
      }),
      false,
    );
  }
});

test("all installed adapters share one receipt contract and incomplete connections fail closed", () => {
  const wordpress = githubSite({
    publishMethod: "wordpress",
    repoOwner: undefined,
    repoName: undefined,
    repoDefaultBranch: undefined,
    githubToken: undefined,
    wpUrl: "https://cms.example.com/",
    wpUsername: "publisher",
    wpAppPassword: "wordpress-secret",
  });
  const webhook = githubSite({
    publishMethod: "webhook",
    repoOwner: undefined,
    repoName: undefined,
    repoDefaultBranch: undefined,
    githubToken: undefined,
    webhookUrl: "https://publish.example.com/hook",
    webhookSecret: "a-secure-webhook-signing-secret-1234",
  });
  for (const site of [githubSite(), wordpress, webhook]) {
    assert.equal(publisherConnectionComplete(site), true);
    assert.ok(exactReceipt(site));
  }
  assert.equal(
    publisherConnectionComplete({ ...wordpress, wpAppPassword: undefined }),
    false,
  );
  assert.equal(
    expectedPublisherDestinationReceipt({
      site: { ...webhook, webhookSecret: undefined },
      ownerAccountKey,
      verifiedAt: timestamp,
    }),
    null,
  );
  for (const urlStructure of ["/../[slug]", "/blog/no-placeholder", "blog/[slug]"]) {
    assert.equal(
      expectedPublisherDestinationReceipt({
        site: { ...wordpress, urlStructure },
        ownerAccountKey,
        verifiedAt: timestamp,
      }),
      null,
      `invalid delivery URL structure must not mint a receipt: ${urlStructure}`,
    );
  }
});

test("standing autopublish consent is explicit, versioned, and tenant/domain bound", () => {
  const consent = publisherAutopublishConsentReceipt({
    ownerAccountKey,
    canonicalDomain: "example.com",
    domainRevision: 3,
    acceptedAt: timestamp,
  });
  assert.equal(consent.version, PUBLISHER_AUTOPUBLISH_CONSENT_VERSION);
  assert.equal(consent.policyHash, PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH);
  const request = {
    automationMode: "full" as const,
    ownerAccountKey,
    domainSnapshot: "example.com",
    domainRevisionSnapshot: 3,
    publisherAutopublishConsent: consent,
  } as Doc<"managed_provisioning_requests">;
  assert.equal(
    publisherAutopublishConsentCurrent({ request, timestamp: timestamp + 1 }),
    true,
  );
  for (const invalidConsent of [
    { ...consent, version: consent.version + 1 },
    { ...consent, policyHash: "obsolete-policy" },
    { ...consent, ownerAccountKey: "owner-account-b" },
    { ...consent, canonicalDomain: "other.example" },
    { ...consent, domainRevision: 4 },
  ]) {
    assert.equal(
      publisherAutopublishConsentCurrent({
        request: { ...request, publisherAutopublishConsent: invalidConsent },
        timestamp: timestamp + 1,
      }),
      false,
    );
  }
  assert.equal(
    publisherAutopublishConsentCurrent({
      request: {
        ...request,
        automationMode: "assisted",
        publisherAutopublishConsent: undefined,
      },
    }),
    true,
    "assisted review does not require standing unattended-publish consent",
  );
  assert.equal(
    publisherStandingAutopublishConsentCurrent({
      request: {
        ...request,
        automationMode: "assisted",
        publisherAutopublishConsent: undefined,
      },
    }),
    false,
    "changing the site to unattended delivery cannot reuse an assisted request",
  );
});

test("a structured owner boundary survives reconciliation until canonical proof exists", () => {
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "publisher",
      mode: "managed",
      canonicalReceiptVerified: false,
      currentProgress: {
        state: "owner_action_required",
        blockedReasonCode: "publisher_connection_required",
        actionRequiredBy: "owner",
        updatedAt: timestamp,
      },
      timestamp: timestamp + 1,
    }),
    {
      state: "owner_action_required",
      blockedReasonCode: "publisher_connection_required",
      actionRequiredBy: "owner",
    },
  );
  assert.equal(
    oneSetupCapabilityReadiness({
      connectionVerified: false,
      progress: { mode: "managed", state: "owner_action_required" },
    }),
    "action_required",
  );
});

test("managed adapter execution is lease-fenced and delegates ready only to the reconciler", () => {
  const managed = readFileSync("convex/managedProvisioning.ts", "utf8");
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const actionStart = publisher.indexOf(
    "export const preflightManagedPublisherInternal",
  );
  const actionEnd = publisher.indexOf("async function publishToWordPress", actionStart);
  const action = publisher.slice(actionStart, actionEnd);
  const githubMetadataStart = publisher.indexOf("async function getDefaultBranch");
  const githubMetadataEnd = publisher.indexOf(
    "async function reverifyGithubConnectionHandler",
    githubMetadataStart,
  );
  const githubMetadata = publisher.slice(
    githubMetadataStart,
    githubMetadataEnd,
  );

  assert.match(managed, /getPublisherPreflightContext/);
  assert.match(managed, /managedProvisioningLeaseIsCurrent/);
  assert.match(
    managed,
    /getPublisherPreflightContext[\s\S]*siteExecutionAuthorized\(ctx, site\)/,
    "credential-bearing preflight context must fail closed for parked, conflicted, deleted, tombstoned, or unentitled sites",
  );
  assert.match(
    managed,
    /dispatchRequest[\s\S]*siteExecutionAuthorized\(ctx, site\)[\s\S]*reason: "execution_paused"[\s\S]*managedProvisioningRetryAt/,
    "execution-paused requests must not churn short provider leases",
  );
  assert.match(managed, /expectedRevision: args\.expectedRevision/);
  assert.match(managed, /expectedLeaseToken: args\.leaseToken/);
  assert.match(managed, /markPublisherPreflightInProgress/);
  assert.match(managed, /settlePublisherPreflightActionRequired/);
  assert.match(action, /reverifyGithubConnectionHandler/);
  assert.match(action, /verifyPublicationDestinationHandler/);
  assert.match(action, /siteSnapshot: context\.site/);
  assert.match(action, /beforeExternalRead: assertPreflightLeaseCurrent/);
  assert.match(githubMetadata, /permissions\?\.push !== true/);
  assert.match(githubMetadata, /does not grant repository write access/);
  assert.match(action, /publisher_connection_verification_required/);
  assert.match(action, /internal\.managedProvisioning\.reconcileRequest/);
  assert.doesNotMatch(action, /state:\s*["']ready["']/);
  assert.match(
    sites,
    /Provider progress cannot mark a capability ready; canonical reconciliation is required/,
  );
});

test("post-provider receipt CAS and generic owner UX expose no credential", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const security = readFileSync("convex/lib/siteSecurity.ts", "utf8");
  const readiness = readFileSync(
    "src/components/onboarding/setup-readiness.tsx",
    "utf8",
  );
  const wizard = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  assert.match(sites, /recordPublisherDestinationReceiptInternal/);
  assert.match(sites, /expectedPublisherDestinationReceipt/);
  assert.match(sites, /publisherDestinationReceiptExactlyMatches/);
  assert.doesNotMatch(
    sites.slice(
      sites.indexOf("export const recordPublisherDestinationReceiptInternal"),
      sites.indexOf("export const patchInternal"),
    ),
    /JSON\.stringify\(args\.receipt\)/,
  );
  assert.match(sites, /Publishing destination changed during verification/);
  assert.match(sites, /publisherConnectionGeneration/);
  assert.match(security, /"publisherDestinationReceipt"/);
  assert.match(sites, /Connect publishing/);
  assert.match(readiness, /connect_publishing/);
  assert.match(readiness, /review_publishing/);
  assert.match(readiness, /acceptPublisherAutopublishConsent/);
  assert.match(wizard, /publisherAutopublishConsentAccepted/);
  assert.match(wizard, /PUBLISHER_AUTOPUBLISH_CONSENT_TEXT/);
  assert.match(
    sites,
    /assertUnattendedPublishingTransitionAuthorized[\s\S]*!site\?\.userId[\s\S]*!request \|\|[\s\S]*publisherStandingAutopublishConsentCurrent/,
    "the shared settings fence must reject no-request, stale, assisted, and unconsented unattended transitions",
  );
  assert.match(
    sites,
    /if \(args\.id\)[\s\S]*assertUnattendedPublishingTransitionAuthorized[\s\S]*if \(existing\?\._id\)[\s\S]*assertUnattendedPublishingTransitionAuthorized[\s\S]*assertUnattendedPublishingTransitionAuthorized\(ctx, null/,
    "all upsert update/create paths must share the standing-consent transition fence",
  );
  assert.match(
    sites,
    /saveOneSetupRequest[\s\S]*desiredApprovalRequired[\s\S]*approvalRequired: desiredApprovalRequired[\s\S]*publisherAutopublishConsent:/,
    "explicit setup consent and the unattended site mode must commit atomically",
  );
  assert.match(wizard, /approvalRequired: true/);
  for (const secret of ["githubToken", "wpAppPassword", "webhookSecret"]) {
    assert.doesNotMatch(readiness, new RegExp(secret));
    assert.doesNotMatch(wizard, new RegExp(secret));
  }
});
