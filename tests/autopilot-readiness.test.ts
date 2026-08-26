import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  describeAutopilotBlockers,
  liveAutopilotReadiness,
  requiredMonthlyArticlesForCadence,
  warmAutopilotReadiness,
} from "../convex/lib/autopilotReadiness.ts";
import { publicationAdapterConfigHash } from "../convex/lib/publicationArtifact.ts";
import { PUBLICATION_ADAPTER_VERSION } from "../convex/lib/publicationReceipts.ts";

const readySite = {
  autopilotEnabled: true,
  approvalRequired: false,
  cadencePerWeek: 4,
  domain: "example.com",
  niche: "B2B operations software",
  blogTheme: "practical operations guides",
  publishMethod: "github",
  repoOwner: "owner",
  repoName: "site",
  repoDefaultBranch: "main",
  githubToken: "secret",
  gscAccessToken: "secret",
  gscProperty: "sc-domain:example.com",
};

test("a fully connected tenant can warm and promote without operator intervention", () => {
  assert.deepEqual(warmAutopilotReadiness(readySite, true), {
    ready: true,
    blockers: [],
  });
  assert.deepEqual(liveAutopilotReadiness(readySite, true, 25), {
    ready: true,
    blockers: [],
  });

  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(autopilot, /export const promoteWarmSiteIfReady/);
  assert.match(autopilot, /export const getFleetReadiness/);
  assert.match(autopilot, /automatic_live_promotion/);
  assert.match(
    autopilot,
    /autopilotRolloutMode: "warm"[\s\S]{0,220}expectedClickSchedulingEnabled: true/,
  );
  assert.match(
    autopilot,
    /autopilotRolloutMode: "live"[\s\S]{0,220}expectedClickSchedulingEnabled: true/,
  );
  assert.match(scheduler, /internal\.autopilot\.promoteWarmSiteIfReady/);
  assert.match(
    scheduler,
    /rolloutMode === "warm" && buffer\.length >= MIN_APPROVED_BUFFER/,
  );
  assert.match(
    readFileSync("convex/actions/pipeline.ts", "utf8"),
    /export const repairOnboardingInternal = internalAction/,
  );
});

test("live mode rejects a subscription that cannot sustain the selected cadence", () => {
  assert.equal(requiredMonthlyArticlesForCadence(1), 5);
  assert.equal(requiredMonthlyArticlesForCadence(4), 18);
  assert.equal(requiredMonthlyArticlesForCadence(7), 31);
  assert.deepEqual(liveAutopilotReadiness(readySite, true, 10), {
    ready: false,
    blockers: ["subscription_capacity_below_cadence"],
  });
  assert.equal(
    describeAutopilotBlockers(["subscription_capacity_below_cadence"]),
    "lower the cadence or upgrade to a plan with enough monthly articles",
  );
});

test("monthly free-plan cadence is eligible for warm and live automation", () => {
  const monthlyCadence = (3 * 7) / 31;
  const monthlySite = { ...readySite, cadencePerWeek: monthlyCadence };
  assert.deepEqual(warmAutopilotReadiness(monthlySite, true), {
    ready: true,
    blockers: [],
  });
  assert.deepEqual(liveAutopilotReadiness(monthlySite, true, 3), {
    ready: true,
    blockers: [],
  });
  assert.equal(requiredMonthlyArticlesForCadence(monthlyCadence), 3);
});

test("incomplete tenants stay fail-closed with exact actionable blockers", () => {
  assert.deepEqual(
    warmAutopilotReadiness(
      {
        autopilotEnabled: true,
        cadencePerWeek: 3,
        domain: "example.com",
        niche: "agency",
        publishMethod: "wordpress",
      },
      false,
    ),
    {
      ready: false,
      blockers: [
        "site_crawl_missing",
        "wordpress_connection_incomplete",
      ],
    },
  );
  assert.deepEqual(
    liveAutopilotReadiness(
      { ...readySite, approvalRequired: true, gscAccessToken: undefined },
      true,
    ),
    {
      ready: false,
      blockers: ["manual_approval_requested", "search_console_not_connected"],
    },
  );
});

test("configured adapters cannot promote until the exact credentials pass preflight", () => {
  const webhook = {
    ...readySite,
    publishMethod: "webhook",
    webhookUrl: "https://example.com/api/pentra",
    webhookSecret: "secret",
  };
  assert.deepEqual(liveAutopilotReadiness(webhook, true, 25), {
    ready: false,
    blockers: ["publication_adapter_unverified"],
  });

  const verifiedWebhook = {
    ...webhook,
    publicationAdapterVerifiedAt: Date.now(),
    publicationAdapterVersion: PUBLICATION_ADAPTER_VERSION,
    publicationAdapterConfigHash: publicationAdapterConfigHash(webhook),
  };
  assert.deepEqual(liveAutopilotReadiness(verifiedWebhook, true, 25), {
    ready: true,
    blockers: [],
  });

  const sites = readFileSync("convex/sites.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(sites, /export const enforceLiveReadiness = internalMutation/);
  assert.match(sites, /live readiness regressed/);
  assert.match(scheduler, /internal\.sites\.enforceLiveReadiness/);
  assert.match(sites, /Live rollout prerequisites are incomplete/);

  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(
    autopilot,
    /LEGACY_PUBLISHER_PREFLIGHT_RETRY_MS[\s\S]*publication_adapter_unverified[\s\S]*verifyLegacyPublicationDestinationInternal/,
  );
  assert.match(
    autopilot,
    /publicationAdapterVerificationFailureCode ===[\s\S]*publisher_preflight_failed[\s\S]*publicationAdapterVerificationPolicyVersion[\s\S]*LEGACY_PUBLISHER_PREFLIGHT_POLICY_VERSION/,
  );
  assert.match(
    autopilot,
    /export const reconcileSealedBufferCount = internalMutation[\s\S]*approvedBufferCount/,
  );
  assert.match(
    autopilot,
    /export const promoteObserveSiteAfterReadinessMaintenance = internalMutation[\s\S]*warmAutopilotReadiness[\s\S]*oneSetupPromotionBlockers[\s\S]*publicationCommitBlocksRolloutTransition[\s\S]*autopilotRolloutMode: "warm"/,
  );
  assert.match(
    publisher,
    /publicationAdapterVerificationAttemptedAt !== args\.attemptedAt[\s\S]*publicationAdapterConfigHash\(current\) !== configHash/,
  );
  assert.match(
    publisher,
    /verifyPublicationDestinationHandler[\s\S]*settleLegacyPublicationAdapterPreflightInternal/,
  );
  assert.match(publisher, /destination_content_type_invalid/);
  assert.match(
    publisher,
    /settleLegacyPublicationAdapterPreflightInternal[\s\S]*promoteObserveSiteAfterReadinessMaintenance/,
  );
});
