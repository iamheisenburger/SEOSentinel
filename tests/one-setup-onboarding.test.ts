import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aggregateOneSetupReadiness,
  aggregateOneSetupRequestState,
  initialOneSetupProgress,
  oneSetupCapabilityReadiness,
} from "../convex/lib/oneSetup.ts";

const sites = readFileSync("convex/sites.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const wizard = readFileSync(
  "src/components/onboarding/setup-wizard.tsx",
  "utf8",
);
const readinessUi = readFileSync(
  "src/components/onboarding/setup-readiness.tsx",
  "utf8",
);

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
    "contractVersion",
    "revision",
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
  assert.match(readiness, /publicationDestinationBlockers\(site\)/);
  assert.match(readiness, /site\.gscAccessToken && site\.gscProperty/);
  assert.match(readiness, /inbox\.credentialOwnerAccountKey === ownerAccountKey/);
  assert.match(readiness, /inbox\.spfVerifiedAt/);
  assert.match(readiness, /inbox\.dkimVerifiedAt/);
  assert.match(readiness, /inbox\.dmarcVerifiedAt/);
  assert.match(readiness, /inbox\.complianceConfirmedAt/);
  assert.match(readiness, /autonomousGmailCredentialIssues/);
  assert.match(readiness, /accountCadenceSnapshot/);
  assert.match(readiness, /cadenceFitsMonthlyAllowance/);
  assert.match(readiness, /Automation mode authorized/);
  assert.match(readiness, /aggregateOneSetupReadiness/);
});

test("one-setup UX defaults to managed Full Autopilot and hides provider controls", () => {
  assert.match(wizard, /useState<SetupMode>\("managed"\)/);
  assert.ok(
    [...wizard.matchAll(/useState<SetupMode>\("managed"\)/g)].length >= 3,
  );
  assert.match(wizard, /useState<AutomationMode>\("full"\)/);
  assert.match(wizard, /Managed setup/);
  assert.match(wizard, /Connect existing/);
  assert.match(wizard, /Advanced connection controls/);
  assert.match(wizard, /hasSelfManaged/);
  assert.match(wizard, /Managed setup never asks you to edit DNS here/);
  assert.doesNotMatch(wizard, /repoOwner|repoName|App Password|webhookSecret/);
  assert.doesNotMatch(wizard, /LeadPilot/i);
  assert.doesNotMatch(wizard, /engine is running/i);
});

test("readiness copy distinguishes setup receipts from production outcomes", () => {
  assert.match(readinessUi, /canonical receipt/);
  assert.match(readinessUi, /separate rollout and consent gates/);
  assert.match(readinessUi, /does not claim an article was/);
  assert.match(readinessUi, /a backlink was acquired/);
  assert.match(readinessUi, /a ranking/);
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
