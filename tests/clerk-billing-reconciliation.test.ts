import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyWebhook } from "@clerk/backend/webhooks";
import { Webhook } from "standardwebhooks";

import {
  authoritativePlanFeaturesFromSubscription,
  canonicalPlanSummary,
  handleClerkBillingWebhook,
  legacyPublicOverrideMigrationPatch,
  resolvePlanEntitlement,
  type ClerkBillingStateLike,
  type ClerkBillingSubscriptionLike,
} from "../src/lib/clerk-billing-reconciliation.ts";

const NOW = Date.UTC(2026, 7, 20, 12);
const SECRET = `whsec_${Buffer.from("pentra-clerk-webhook-test-secret").toString("base64")}`;

const tierFeatures = {
  free: ["max_sites_1", "max_articles_3"],
  starter: ["max_sites_1", "max_articles_10"],
  pro: ["max_sites_3", "max_articles_25"],
  scale: ["max_sites_10", "max_articles_60"],
  enterprise: ["max_sites_unlimited", "max_articles_150"],
} as const;

function item(
  tier: keyof typeof tierFeatures,
  status: string,
  periodEnd: number | null = NOW + 30 * 24 * 60 * 60 * 1000,
) {
  return {
    status,
    periodEnd,
    plan: {
      features: tierFeatures[tier].map((slug) => ({ slug })),
    },
  };
}

function subscription(
  items: ClerkBillingSubscriptionLike["subscriptionItems"],
): ClerkBillingSubscriptionLike {
  return { subscriptionItems: items };
}

function billingState(
  items: ClerkBillingSubscriptionLike["subscriptionItems"],
  metadata: ClerkBillingStateLike["metadata"] = {},
): ClerkBillingStateLike {
  return { subscription: subscription(items), metadata };
}

function signedRequest(
  event: Record<string, unknown>,
  secret = SECRET,
  messageId = "msg_billing_1",
): Request {
  const body = JSON.stringify(event);
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(messageId, timestamp, body);
  return new Request("https://pentra.dev/api/webhooks/clerk-billing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
    body,
  });
}

test("upgrade uses the freshly active higher Clerk Plan", () => {
  assert.deepEqual(
    authoritativePlanFeaturesFromSubscription(
      subscription([
        item("starter", "ended"),
        item("pro", "active"),
      ]),
      NOW,
    ),
    { tier: "pro", planFeatures: [...tierFeatures.pro] },
  );
});

test("a deferred downgrade does not take effect before its upcoming item activates", () => {
  assert.deepEqual(
    authoritativePlanFeaturesFromSubscription(
      subscription([
        item("scale", "active"),
        item("starter", "upcoming"),
      ]),
      NOW,
    ),
    { tier: "scale", planFeatures: [...tierFeatures.scale] },
  );
  assert.deepEqual(
    authoritativePlanFeaturesFromSubscription(
      subscription([
        item("scale", "ended", NOW),
        item("starter", "active"),
      ]),
      NOW,
    ),
    { tier: "starter", planFeatures: [...tierFeatures.starter] },
  );
});

test("cancellation retains paid access through period end and then falls to Free", () => {
  const canceled = item("pro", "canceled", NOW + 1_000);
  assert.deepEqual(
    authoritativePlanFeaturesFromSubscription(
      subscription([canceled, item("free", "upcoming")]),
      NOW,
    ),
    { tier: "pro", planFeatures: [...tierFeatures.pro] },
  );
  assert.deepEqual(
    authoritativePlanFeaturesFromSubscription(
      subscription([canceled, item("free", "active")]),
      NOW + 1_001,
    ),
    { tier: "free", planFeatures: [...tierFeatures.free] },
  );
});

test("a private server-only admin grant can raise but never reduce a purchased tier", () => {
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("free", "active")], {
        privateMetadata: {
          pentraPlanFeatures: [...tierFeatures.enterprise],
        },
      }),
      NOW,
    ),
    {
      ok: true,
      entitlement: {
        tier: "enterprise",
        planFeatures: [...tierFeatures.enterprise],
      },
    },
  );
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("scale", "active")], {
        privateMetadata: {
          pentraPlanFeatures: [...tierFeatures.starter],
        },
      }),
      NOW,
    ),
    {
      ok: true,
      entitlement: {
        tier: "scale",
        planFeatures: [...tierFeatures.scale],
      },
    },
  );
});

test("legacy public paid grants require a reviewed private migration marker", () => {
  const legacyMetadata = {
    publicMetadata: { features: [...tierFeatures.enterprise] },
  };
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("free", "active")], legacyMetadata),
      NOW,
    ),
    { ok: false, reason: "legacy_override_migration_required" },
  );
  assert.deepEqual(
    legacyPublicOverrideMigrationPatch(legacyMetadata.publicMetadata),
    { pentraPlanFeatures: [...tierFeatures.enterprise] },
  );
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("free", "active")], {
        ...legacyMetadata,
        privateMetadata: { pentraLegacyPublicPlanOverride: true },
      }),
      NOW,
    ),
    {
      ok: true,
      entitlement: {
        tier: "enterprise",
        planFeatures: [...tierFeatures.enterprise],
      },
    },
  );
});

test("partial or malformed metadata cannot combine with a subscription", () => {
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("free", "active")], {
        privateMetadata: { pentraPlanFeatures: ["max_articles_150"] },
      }),
      NOW,
    ),
    { ok: false, reason: "invalid_private_override" },
  );
  assert.deepEqual(
    resolvePlanEntitlement(
      billingState([item("starter", "active")], {
        privateMetadata: { pentraLegacyPublicPlanOverride: true },
        publicMetadata: { features: ["max_sites_unlimited"] },
      }),
      NOW,
    ),
    { ok: false, reason: "invalid_legacy_override" },
  );
});

test("an empty Billing response fails safely to the canonical Free bundle", () => {
  assert.deepEqual(
    resolvePlanEntitlement(billingState([]), NOW),
    {
      ok: true,
      entitlement: { tier: "free", planFeatures: [...tierFeatures.free] },
    },
  );
});

test("the browser-facing plan summary contains only canonical tier and limits", () => {
  const entitlement = {
    tier: "enterprise",
    planFeatures: [
      ...tierFeatures.enterprise,
      "seo_authority_discovery",
      "private_marker_that_must_not_escape",
    ],
  } as const;
  const summary = canonicalPlanSummary(entitlement);
  assert.deepEqual(summary, {
    tier: "enterprise",
    maxSites: 9999,
    maxArticles: 150,
  });
  assert.equal("planFeatures" in summary, false);
});

test("verified duplicates re-read Clerk and converge on the same canonical state", async () => {
  const synced: Array<{ userId: string; planFeatures: string[] }> = [];
  let loads = 0;
  const dependencies = {
    signingSecret: SECRET,
    verify: (request: Request, options: { signingSecret: string }) =>
      verifyWebhook(request, options),
    loadBillingState: async () => {
      loads++;
      return billingState([item("starter", "active")]);
    },
    syncPlanFeatures: async (args: { userId: string; planFeatures: string[] }) => {
      synced.push(args);
    },
    requestAccountDeletion: async () => {},
    now: () => NOW,
  };
  const event = {
    type: "subscriptionItem.updated",
    object: "event",
    // Deliberately contradictory event Plan: the authoritative fetch wins.
    data: {
      payer: { user_id: "user_test" },
      plan: { features: tierFeatures.enterprise },
    },
  };

  const first = await handleClerkBillingWebhook(
    signedRequest(event),
    dependencies,
  );
  const duplicate = await handleClerkBillingWebhook(
    signedRequest(event),
    dependencies,
  );

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(loads, 2);
  assert.deepEqual(synced, [
    { userId: "user_test", planFeatures: [...tierFeatures.starter] },
    { userId: "user_test", planFeatures: [...tierFeatures.starter] },
  ]);
});

test("an unmigrated legacy paid grant blocks webhook storage instead of downgrading", async () => {
  let synced = false;
  const event = {
    type: "subscriptionItem.updated",
    object: "event",
    data: { payer: { user_id: "user_owner" } },
  };
  const response = await handleClerkBillingWebhook(signedRequest(event), {
    signingSecret: SECRET,
    verify: (request, options) => verifyWebhook(request, options),
    loadBillingState: async () =>
      billingState([item("free", "active")], {
        publicMetadata: { features: [...tierFeatures.enterprise] },
      }),
    syncPlanFeatures: async () => {
      synced = true;
    },
    requestAccountDeletion: async () => {},
    now: () => NOW,
  });

  assert.equal(response.status, 503);
  assert.equal(synced, false);
});

test("invalid signatures and missing secrets fail before any entitlement read", async () => {
  let touched = false;
  const dependencies = {
    signingSecret: SECRET,
    verify: (request: Request, options: { signingSecret: string }) =>
      verifyWebhook(request, options),
    loadBillingState: async () => {
      touched = true;
      return billingState([item("enterprise", "active")]);
    },
    syncPlanFeatures: async () => {
      touched = true;
    },
    requestAccountDeletion: async () => {
      touched = true;
    },
  };
  const event = {
    type: "subscriptionItem.active",
    object: "event",
    data: { payer: { user_id: "user_test" } },
  };
  const invalid = await handleClerkBillingWebhook(
    signedRequest(event, `whsec_${Buffer.from("wrong-secret").toString("base64")}`),
    dependencies,
  );
  assert.equal(invalid.status, 400);
  assert.equal(touched, false);

  const missing = await handleClerkBillingWebhook(
    new Request("https://pentra.dev/api/webhooks/clerk-billing", {
      method: "POST",
    }),
    { ...dependencies, signingSecret: undefined },
  );
  assert.equal(missing.status, 503);
  assert.equal(touched, false);
});

test("a verified user deletion fences the account without reading Billing", async () => {
  let billingRead = false;
  const deletions: Array<{ userId: string; sourceEventId?: string }> = [];
  const event = {
    type: "user.deleted",
    object: "event",
    data: { object: "user", id: "user_deleted_owner", deleted: true },
  };

  const response = await handleClerkBillingWebhook(
    signedRequest(event, SECRET, "msg_user_deleted_1"),
    {
      signingSecret: SECRET,
      verify: (request, options) => verifyWebhook(request, options),
      loadBillingState: async () => {
        billingRead = true;
        return billingState([item("enterprise", "active")]);
      },
      syncPlanFeatures: async () => {
        billingRead = true;
      },
      requestAccountDeletion: async (args) => {
        deletions.push(args);
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(billingRead, false);
  assert.deepEqual(deletions, [{
    userId: "user_deleted_owner",
    sourceEventId: "msg_user_deleted_1",
  }]);
});

test("account deletion fails closed and remains retryable", async () => {
  const event = {
    type: "user.deleted",
    object: "event",
    data: { object: "user", id: "user_deleted_owner", deleted: true },
  };
  const base = {
    signingSecret: SECRET,
    verify: (request: Request, options: { signingSecret: string }) =>
      verifyWebhook(request, options),
    loadBillingState: async () => billingState([]),
    syncPlanFeatures: async () => {},
  };

  const unavailable = await handleClerkBillingWebhook(signedRequest(event), {
    ...base,
    requestAccountDeletion: async () => {
      throw new Error("temporary internal failure");
    },
  });
  assert.equal(unavailable.status, 503);

  const malformed = await handleClerkBillingWebhook(
    signedRequest({ ...event, data: { object: "user", deleted: true } }),
    { ...base, requestAccountDeletion: async () => {} },
  );
  assert.equal(malformed.status, 400);
});

test("the billing routes use fresh server-side Clerk Billing and user metadata", () => {
  const middleware = readFileSync("src/proxy.ts", "utf8");
  const syncRoute = readFileSync("src/app/api/billing/sync-plan/route.ts", "utf8");
  const clientHook = readFileSync("src/hooks/usePlanLimits.ts", "utf8");
  assert.match(middleware, /"\/api\/webhooks\/clerk-billing"/);
  assert.match(syncRoute, /getUserBillingSubscription/);
  const webhookRoute = readFileSync(
    "src/app/api/webhooks/clerk-billing/route.ts",
    "utf8",
  );
  assert.match(webhookRoute, /requestAccountDeletion/);
  assert.match(webhookRoute, /"\/account-deletion"/);
  assert.match(syncRoute, /users\.getUser/);
  assert.match(syncRoute, /resolvePlanEntitlement/);
  assert.match(syncRoute, /canonicalPlanSummary/);
  assert.doesNotMatch(syncRoute, /auth\.has|currentUser|metadataFeatures/);
  assert.match(clientHook, /serverPlanCache/);
  assert.match(clientHook, /fetchAuthoritativePlan/);
  assert.match(clientHook, /PLAN_SYNC_RETRY_MS/);
  assert.doesNotMatch(clientHook, /useUser|publicMetadata|privateMetadata/);
});
