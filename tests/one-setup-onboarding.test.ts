import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aggregateOneSetupReadiness,
  aggregateOneSetupRequestState,
  initialOneSetupProgress,
  oneSetupCapabilityReadiness,
} from "../convex/lib/oneSetup.ts";
import {
  canonicalGscReceiptMutationFenceCurrent,
  GSC_CANONICAL_RECEIPT_FRESH_MS,
  hardGscOAuthFailure,
  oneSetupSearchMeasurementReceiptVerified,
} from "../convex/lib/oneSetupCanonical.ts";

const sites = readFileSync("convex/sites.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const wizard = readFileSync(
  "src/components/onboarding/setup-wizard.tsx",
  "utf8",
);
const adapterChoices = readFileSync(
  "src/components/onboarding/one-setup-adapter-choices.tsx",
  "utf8",
);
const readinessUi = readFileSync(
  "src/components/onboarding/setup-readiness.tsx",
  "utf8",
);
const dashboard = readFileSync(
  "src/app/(dashboard)/dashboard/page.tsx",
  "utf8",
);
const canonicalSetup = readFileSync(
  "convex/lib/oneSetupCanonical.ts",
  "utf8",
);
const gscSync = readFileSync("convex/actions/gscSync.ts", "utf8");

function exportedBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("managed setup queues work while owner-managed setup requests owner action", () => {
  assert.equal(initialOneSetupProgress("managed"), "requested");
  assert.equal(
    initialOneSetupProgress("connect_existing"),
    "owner_action_required",
  );
});

test("existing tenants have an explicit current-contract One Setup migration path", () => {
  assert.match(readinessUi, /!readiness\.requestExists/);
  assert.match(readinessUi, /\/dashboard\?setup=existing/);
  assert.match(dashboard, /setupMode === "existing"/);
  assert.match(dashboard, /<SetupWizard existingSite=\{site\}/);
  assert.match(wizard, /existingSite\?: ExistingSiteSetup/);
  assert.match(wizard, /useState<OutreachTransport>\("smtp"\)/);
  assert.match(wizard, /readOnly=\{Boolean\(existingSite\)\}/);
  assert.match(wizard, /existingSite \? \{ id: existingSite\._id \} : \{\}/);
  assert.match(wizard, /!existingSite \? \{ createOnly: true \} : \{\}/);
  assert.match(
    wizard,
    /preserve the same tenant and continue from durable receipts/i,
  );
});

test("One Setup exposes exact blockers and treats cadence as a target rate", () => {
  assert.match(wizard, /Postal address shown in email footers/);
  assert.match(wizard, /Do not enter an email address/);
  assert.match(wizard, /postalAddressError\(managedPhysicalAddress\)/);
  assert.match(wizard, /oneSetupFormBlockers/);
  assert.match(wizard, /Complete \{setupBlockers\.length\} required/);
  assert.match(wizard, /Articles per week/);
  assert.match(wizard, /target pace/);
  assert.match(wizard, /pauses automatically when the allowance is used/);
  assert.match(wizard, /cadenceFitsOperationalLimit\(cadence\)/);
  assert.doesNotMatch(wizard, /reserves.*monthly article credits/);
  assert.match(wizard, /\{ siteId: existingSite\._id \}/);
});

test("provisioning progress has deterministic fail-closed aggregation", () => {
  assert.equal(
    aggregateOneSetupRequestState([
      { mode: "managed", state: "ready" },
      { mode: "managed", state: "in_progress" },
      { mode: "managed", state: "requested" },
    ]),
    "in_progress",
  );
  assert.equal(
    aggregateOneSetupRequestState([
      { mode: "managed", state: "ready" },
      { mode: "managed", state: "blocked" },
    ]),
    "blocked",
  );
  assert.equal(
    aggregateOneSetupRequestState([
      { mode: "managed", state: "ready" },
      { mode: "managed", state: "ready" },
    ]),
    "ready",
  );
});

test("a provider progress report can never manufacture a connection receipt", () => {
  assert.equal(
    oneSetupCapabilityReadiness({
      connectionVerified: false,
      progress: { mode: "managed", state: "ready" },
    }),
    "in_progress",
  );
  assert.equal(
    oneSetupCapabilityReadiness({
      connectionVerified: false,
      progress: { mode: "connect_existing", state: "ready" },
    }),
    "action_required",
  );
  assert.equal(
    oneSetupCapabilityReadiness({
      connectionVerified: true,
      progress: { mode: "managed", state: "requested" },
    }),
    "ready",
  );
});

test("the owner aggregate reports exact receipt progress and fail-closed priority", () => {
  assert.deepEqual(
    aggregateOneSetupReadiness([
      "ready",
      "ready",
      "queued",
      "action_required",
    ]),
    {
      status: "action_required",
      readyCount: 2,
      totalCount: 4,
      percent: 50,
    },
  );
  assert.equal(
    aggregateOneSetupReadiness(["ready", "blocked"]).status,
    "blocked",
  );
  assert.equal(
    aggregateOneSetupReadiness(["ready", "ready"]).status,
    "ready",
  );
});

test("the provisioning contract is additive, tenant-fenced, and credential-free", () => {
  const tableStart = schema.indexOf("managed_provisioning_requests: defineTable");
  const tableEnd = schema.indexOf("account_plan_entitlements: defineTable", tableStart);
  assert.ok(tableStart >= 0 && tableEnd > tableStart);
  const table = schema.slice(tableStart, tableEnd);

  for (const field of [
    "siteId",
    "ownerAccountKey",
    "domainSnapshot",
    "domainRevisionSnapshot",
    "contractVersion",
    "revision",
    "configurationRevision",
    "automationMode",
    "requestedCadencePerWeek",
    "publisher",
    "searchMeasurement",
    "outreachMailbox",
    "aggregateState",
  ]) {
    assert.match(table, new RegExp(`${field}:`));
  }
  for (const forbiddenField of [
    "oauthToken:",
    "oauthRefreshToken:",
    "password:",
    "dnsRecord:",
    "providerId:",
    "resellerId:",
  ]) {
    assert.doesNotMatch(table, new RegExp(forbiddenField, "i"));
  }
  assert.match(table, /\.index\("by_site", \["siteId"\]\)/);
  assert.match(sites, /"managed_provisioning_requests"/);
});

test("setup intent is owner/domain/version/cadence fenced and adapter progress uses CAS", () => {
  const save = exportedBlock(sites, "saveOneSetupRequest");
  const progress = exportedBlock(
    sites,
    "setOneSetupCapabilityProgressInternal",
  );
  assert.match(save, /requireSiteOwner\(ctx, args\.siteId\)/);
  assert.match(save, /accountDeletionKey\(site\.userId\)/);
  assert.match(save, /normalizedAuthorityDomain\(site\.domain\)/);
  assert.match(save, /ONE_SETUP_CONTRACT_VERSION/);
  assert.match(save, /Save the site cadence before submitting setup/);
  assert.match(save, /Save the site automation mode before submitting setup/);
  assert.match(progress, /expectedRevision/);
  assert.match(progress, /request\.revision !== args\.expectedRevision/);
  assert.match(progress, /request\.ownerAccountKey !== accountDeletionKey/);
  assert.match(progress, /request\.domainSnapshot !== domainSnapshot/);
  assert.match(progress, /request\.domainRevisionSnapshot/);
  assert.match(progress, /oneSetupDomainRevisionReceiptMatches/);
  assert.match(progress, /siteUsesLegacyDomainReceipts\(site\)/);
  assert.doesNotMatch(progress, /domainRevisionSnapshot \?\? 0/);
  assert.match(
    progress,
    /Owner-managed connections cannot be advanced by a provider/,
  );
  assert.match(
    progress,
    /Managed provisioning cannot delegate credential entry silently/,
  );
});

test("aggregate readiness trusts canonical publishing, GSC, mailbox, and plan receipts", () => {
  const readiness = exportedBlock(sites, "getOneSetupReadiness");
  assert.match(readiness, /oneSetupPublisherReceiptVerified\(site\)/);
  assert.match(readiness, /oneSetupSearchMeasurementReceiptVerified\(site\)/);
  assert.match(readiness, /gscConnectionMatchesCurrentDomain\(site\)/);
  assert.match(readiness, /currentDomainPage\(ctx, site\)/);
  assert.match(readiness, /takeCurrentDomainTopics/);
  assert.match(readiness, /contentAnalysisMatchesCurrentDomain\(site\)/);
  assert.match(readiness, /oneSetupOutreachMailboxReceiptVerified/);
  assert.match(canonicalSetup, /publicationDestinationBlockers\(site\)/);
  assert.match(canonicalSetup, /site\.gscAccessToken/);
  assert.match(canonicalSetup, /site\.gscRefreshToken/);
  assert.match(canonicalSetup, /site\.gscReceiptStatus === "verified"/);
  assert.match(canonicalSetup, /canonicalGscBindingCurrent\(site\)/);
  assert.match(canonicalSetup, /inbox\.credentialOwnerAccountKey === args\.ownerAccountKey/);
  assert.match(canonicalSetup, /inbox\.spfVerifiedAt/);
  assert.match(canonicalSetup, /inbox\.dkimVerifiedAt/);
  assert.match(canonicalSetup, /inbox\.dmarcVerifiedAt/);
  assert.match(canonicalSetup, /inbox\.complianceConfirmedAt/);
  assert.match(canonicalSetup, /autonomousOutreachTransportIssues/);
  assert.match(readiness, /accountCadenceSnapshot/);
  assert.match(readiness, /cadenceFitsOperationalLimit/);
  assert.match(readiness, /Automation mode authorized/);
  assert.match(readiness, /aggregateOneSetupReadiness/);
});

test("Search Console readiness is fresh, revocable, and domain-bound", () => {
  const timestamp = 1_900_000_000_000;
  const base = {
    domain: "example.com",
    canonicalDomain: "example.com",
    gscAccessToken: "access",
    gscRefreshToken: "refresh",
    gscProperty: "sc-domain:example.com",
    gscReceiptStatus: "verified",
    gscReceiptRevision: 1,
    gscReceiptVerifiedAt: timestamp - 1_000,
  } as unknown as Parameters<
    typeof oneSetupSearchMeasurementReceiptVerified
  >[0];
  assert.equal(
    oneSetupSearchMeasurementReceiptVerified(base, timestamp),
    true,
  );
  assert.equal(
    oneSetupSearchMeasurementReceiptVerified({
      ...base,
      gscReceiptVerifiedAt:
        timestamp - GSC_CANONICAL_RECEIPT_FRESH_MS - 1,
    }, timestamp),
    false,
  );
  assert.equal(
    oneSetupSearchMeasurementReceiptVerified({
      ...base,
      gscReceiptStatus: "revoked",
      gscReceiptRevokedAt: timestamp,
    }, timestamp),
    false,
  );
  assert.equal(
    oneSetupSearchMeasurementReceiptVerified({
      ...base,
      gscProperty: "sc-domain:other.example",
    }, timestamp),
    false,
  );
  assert.equal(
    oneSetupSearchMeasurementReceiptVerified({
      ...base,
      canonicalDomainRevision: 2,
      gscCanonicalDomain: "example.com",
      gscDomainRevision: 1,
    }, timestamp),
    false,
  );
  assert.equal(
    canonicalGscReceiptMutationFenceCurrent({
      site: base,
      expectedCanonicalDomain: "example.com",
      expectedDomainRevision: 0,
      expectedGscProperty: "sc-domain:example.com",
      expectedReceiptRevision: 1,
    }),
    true,
  );
  assert.equal(
    canonicalGscReceiptMutationFenceCurrent({
      site: { ...base, gscReceiptRevision: 2 },
      expectedCanonicalDomain: "example.com",
      expectedDomainRevision: 0,
      expectedGscProperty: "sc-domain:example.com",
      expectedReceiptRevision: 1,
    }),
    false,
  );
  assert.equal(
    hardGscOAuthFailure({ status: 400, errorCode: "invalid_grant" }),
    true,
  );
  assert.equal(
    hardGscOAuthFailure({ status: 503, errorCode: "invalid_grant" }),
    false,
  );
  assert.equal(
    hardGscOAuthFailure({ status: 403, errorCode: "" }),
    true,
  );
  assert.ok(
    [...gscSync.matchAll(/status === 401 \|\| .*status === 403/g)].length >= 4,
  );
  assert.match(gscSync, /markGscReceiptRevokedInternal/);
  assert.match(gscSync, /markGscReceiptVerifiedInternal/);
  assert.match(gscSync, /expectedReceiptRevision/);
  assert.match(
    gscSync,
    /GSC access-token refresh was temporarily unavailable/,
  );
  assert.match(sites, /Search Console connection changed during token refresh/);
  assert.match(sites, /A revoked Search Console connection cannot be refreshed/);
  assert.match(sites, /site\.gscReceiptStatus === "revoked"/);
  assert.match(
    sites,
    /args\.verifiedAt <= \(site\.gscReceiptRevokedAt \?\? 0\)/,
  );
  assert.match(sites, /autopilotRolloutMode: "warm"/);
  assert.match(
    exportedBlock(sites, "markGscReceiptRevokedInternal"),
    /gscReceiptRevision \?\? 0\) \+ 1/,
  );
});

test("one-setup UX defaults every bootstrap-v1 tenant to zero-cost SMTP/IMAP", () => {
  assert.match(wizard, /existingPublisherKind\(existingSite\?\.publishMethod\)/);
  assert.match(wizard, /: "github";/);
  assert.match(
    wizard,
    /useState<OutreachTransport>\("smtp"\)/,
  );
  assert.match(wizard, /const publisherMode: SetupMode = "connect_existing"/);
  assert.match(wizard, /const measurementMode: SetupMode = "connect_existing"/);
  assert.match(wizard, /outreachTransport === "smartlead_managed"/);
  assert.match(
    wizard,
    /existingSite\?\.approvalRequired === true \? "assisted" : "full"/,
  );
  assert.match(wizard, /One Setup keeps provider authorization\s+inside this\s+guided flow/);
  assert.match(wizard, /Describe the business once, authorize each connection/);
  assert.match(wizard, /Business and target market/);
  assert.match(wizard, /targetAudienceSummary: targetAudience\.trim\(\)/);
  assert.match(wizard, /productUsage: productUsage\.trim\(\)/);
  assert.match(wizard, /Outreach sender details/);
  assert.match(schema, /outreachSenderProfile: v\.optional\(v\.object/);
  assert.match(readinessUi, /connect_search_measurement/);
  assert.match(readinessUi, /connect_gmail_outreach/);
  assert.match(readinessUi, /configure_smtp_outreach/);
  assert.match(wizard, /Customer-managed SMTP\/IMAP · approval only/);
  assert.doesNotMatch(wizard, /mode === "managed" \? "smartlead_managed" : "smtp"/);
  assert.match(wizard, /One guided setup/);
  assert.match(adapterChoices, /Publishing destination/);
  assert.match(adapterChoices, /GitHub/);
  assert.match(adapterChoices, /WordPress/);
  assert.match(adapterChoices, /Signed webhook/);
  assert.match(adapterChoices, /Managed sender/);
  assert.match(adapterChoices, /Gmail/);
  assert.match(adapterChoices, /SMTP/);
  assert.match(adapterChoices, /Beta — not included in bootstrap v1 GA/);
  assert.match(adapterChoices, /NEXT_PUBLIC_PENTRA_FULL_MANAGED_BETA/);
  assert.match(
    wizard,
    /Pentra automatically researches, creates, quality-checks, publishes, measures, and adapts after the required production readiness gates verify/,
  );
  assert.match(
    wizard,
    /Authority outreach begins only after sender consent, mailbox, compliance, pacing, and runtime gates are all ready/,
  );
  assert.match(wizard, /Advanced setup options/);
  assert.match(wizard, /Advanced connection controls/);
  assert.match(wizard, /hasSelfManaged/);
  assert.match(wizard, /One Setup keeps provider authorization\s+inside this\s+guided flow/);
  assert.doesNotMatch(wizard, /repoOwner|repoName|App Password|webhookSecret/);
  assert.doesNotMatch(wizard, /LeadPilot/i);
  assert.doesNotMatch(wizard, /engine is running/i);
  const primaryManagedSummary = wizard.indexOf("One guided setup");
  const advancedSetup = wizard.indexOf("Advanced setup options");
  const integrationChoices = wizard.indexOf("Integration ownership");
  assert.ok(
    primaryManagedSummary >= 0 &&
      advancedSetup > primaryManagedSummary &&
      integrationChoices > advancedSetup,
    "the primary path must stay website + cadence while per-integration choices remain advanced",
  );
});

test("readiness keeps machinery collapsed and separates progress from outcomes", () => {
  assert.match(readinessUi, /Setup complete/);
  assert.match(readinessUi, /Connections verified/);
  assert.match(
    readinessUi,
    /live cadence begins only after its production readiness gates pass/,
  );
  assert.match(readinessUi, /readiness\.publishingRolloutLive !== true/);
  assert.match(readinessUi, /One step needs your approval/);
  assert.match(readinessUi, /View setup details/);
  assert.match(readinessUi, /Setup progress is separate from outcome reporting/);
  assert.match(readinessUi, /acquired links/);
  assert.match(readinessUi, /ranking changes/);
  assert.ok(
    readinessUi.indexOf("actionStages.length > 0") <
      readinessUi.indexOf("View setup details"),
    "the current owner/Pentra action must appear before collapsed internal detail",
  );
  assert.doesNotMatch(readinessUi, /LeadPilot/i);
});

test("create-only onboarding cannot overwrite an existing tenant", () => {
  const upsert = exportedBlock(sites, "upsert");
  assert.match(upsert, /createOnly: v\.optional\(v\.boolean\(\)\)/);
  assert.match(
    upsert,
    /A create-only setup cannot update an existing site/,
  );
  assert.match(upsert, /This website is already connected to your account/);
  assert.match(wizard, /createOnly: true/);
  assert.match(wizard, /Retry saved setup/);
});
