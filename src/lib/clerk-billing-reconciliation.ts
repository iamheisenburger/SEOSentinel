import {
  CANONICAL_PLANS,
  resolvePlanFromFeatures,
  type CanonicalPlan,
  type CanonicalPlanTier,
} from "../../convex/planLimits.ts";

const AUTHORITY_ALIASES = new Set([
  "seo_authority_discovery",
  "authority_discovery",
]);

const BILLING_LIFECYCLE_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.pastDue",
  "subscriptionItem.created",
  "subscriptionItem.updated",
  "subscriptionItem.active",
  "subscriptionItem.canceled",
  "subscriptionItem.upcoming",
  "subscriptionItem.ended",
  "subscriptionItem.abandoned",
  "subscriptionItem.incomplete",
  "subscriptionItem.pastDue",
  "subscriptionItem.freeTrialEnding",
]);

export type ClerkBillingSubscriptionLike = {
  subscriptionItems: readonly {
    status: string;
    periodEnd: number | null;
    plan: {
      features: readonly { slug: string }[];
    } | null;
  }[];
};

export type AuthoritativePlanFeatures = {
  tier: CanonicalPlanTier;
  planFeatures: string[];
};

export type CanonicalPlanSummary = {
  tier: CanonicalPlanTier;
  maxSites: number;
  maxArticles: number;
};

export type ClerkPlanMetadataLike = {
  privateMetadata?: unknown;
  publicMetadata?: unknown;
};

export type ClerkBillingStateLike = {
  subscription: ClerkBillingSubscriptionLike;
  metadata: ClerkPlanMetadataLike;
};

export type PlanEntitlementResolution =
  | {
      ok: true;
      entitlement: AuthoritativePlanFeatures;
    }
  | {
      ok: false;
      reason:
        | "invalid_private_override"
        | "invalid_legacy_override"
        | "legacy_override_migration_required";
    };

function canonicalVolumeFeatures(plan: CanonicalPlan): [string, string] {
  const siteFeature = plan.tier === "enterprise"
    ? "max_sites_unlimited"
    : `max_sites_${plan.maxSites}`;
  return [siteFeature, `max_articles_${plan.maxArticles}`];
}

function planIndex(plan: CanonicalPlan): number {
  return CANONICAL_PLANS.findIndex((candidate) => candidate.tier === plan.tier);
}

function tierIndex(tier: CanonicalPlanTier): number {
  return CANONICAL_PLANS.findIndex((candidate) => candidate.tier === tier);
}

/** Safe browser-facing projection; never includes Clerk or metadata features. */
export function canonicalPlanSummary(
  entitlement: Pick<AuthoritativePlanFeatures, "tier">,
): CanonicalPlanSummary {
  const plan = CANONICAL_PLANS[tierIndex(entitlement.tier)];
  return {
    tier: plan.tier,
    maxSites: plan.maxSites,
    maxArticles: plan.maxArticles,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactCanonicalOverride(
  value: unknown,
): AuthoritativePlanFeatures | null {
  if (!Array.isArray(value) || value.some((feature) => typeof feature !== "string")) {
    return null;
  }
  const features = value as string[];
  const unique = new Set(features);
  if (unique.size !== features.length) return null;

  const aliases = features.filter((feature) => AUTHORITY_ALIASES.has(feature));
  const volumeFeatures = features.filter(
    (feature) => !AUTHORITY_ALIASES.has(feature),
  );
  for (const plan of CANONICAL_PLANS) {
    const expected = canonicalVolumeFeatures(plan);
    if (
      volumeFeatures.length === expected.length &&
      expected.every((feature) => volumeFeatures.includes(feature))
    ) {
      return {
        tier: plan.tier,
        planFeatures: [...expected, ...aliases.sort()],
      };
    }
  }
  return null;
}

function hasPlanFeatureCandidate(value: unknown): boolean {
  return Array.isArray(value) && value.some(
    (feature) =>
      typeof feature === "string" &&
      (feature.startsWith("max_sites_") ||
        feature.startsWith("max_articles_") ||
        AUTHORITY_ALIASES.has(feature)),
  );
}

function higherEntitlement(
  left: AuthoritativePlanFeatures,
  right: AuthoritativePlanFeatures,
): AuthoritativePlanFeatures {
  const selected = tierIndex(right.tier) > tierIndex(left.tier) ? right : left;
  const aliases = new Set(
    [...left.planFeatures, ...right.planFeatures].filter((feature) =>
      AUTHORITY_ALIASES.has(feature)
    ),
  );
  const plan = CANONICAL_PLANS[tierIndex(selected.tier)];
  return {
    tier: selected.tier,
    planFeatures: [
      ...canonicalVolumeFeatures(plan),
      ...[...aliases].sort(),
    ],
  };
}

/**
 * Clerk's current subscription is authoritative. An active item grants its
 * Plan, while Clerk's documented canceled state continues to grant through the
 * current paid period. Upcoming, incomplete, past-due and ended items cannot
 * grant access early or after expiry.
 */
export function authoritativePlanFeaturesFromSubscription(
  subscription: ClerkBillingSubscriptionLike,
  now = Date.now(),
): AuthoritativePlanFeatures {
  let selected = CANONICAL_PLANS[0];
  const legacyAliases = new Set<string>();

  for (const item of subscription.subscriptionItems) {
    const entitled = item.status === "active" ||
      (
        item.status === "canceled" &&
        Number.isFinite(item.periodEnd) &&
        (item.periodEnd ?? 0) > now
      );
    if (!entitled || !item.plan) continue;

    const featureSlugs = item.plan.features
      .map((feature) => feature.slug)
      .filter((slug): slug is string => typeof slug === "string");
    for (const slug of featureSlugs) {
      if (AUTHORITY_ALIASES.has(slug)) legacyAliases.add(slug);
    }

    // Resolve each Plan independently. Combining malformed partial features
    // across separate Subscription Items could manufacture a bundle that Clerk
    // never sold.
    const candidate = resolvePlanFromFeatures(featureSlugs);
    if (planIndex(candidate) > planIndex(selected)) selected = candidate;
  }

  return {
    tier: selected.tier,
    planFeatures: [
      ...canonicalVolumeFeatures(selected),
      ...[...legacyAliases].sort(),
    ],
  };
}

/**
 * Resolve the purchased Plan plus explicit server-managed grants. The private
 * metadata contract is `privateMetadata.pentraPlanFeatures`. A temporary
 * legacy public override is honored only when private metadata also contains
 * `pentraLegacyPublicPlanOverride: true`. Every override must be one exact
 * canonical bundle; partial flags never combine with Clerk Billing features.
 *
 * An unmarked legacy paid bundle that is stronger than the purchased Plan is
 * reported as a migration requirement. Callers must preserve the last verified
 * entitlement instead of silently downgrading the account.
 */
export function resolvePlanEntitlement(
  state: ClerkBillingStateLike,
  now = Date.now(),
): PlanEntitlementResolution {
  const purchased = authoritativePlanFeaturesFromSubscription(
    state.subscription,
    now,
  );
  const privateMetadata = record(state.metadata.privateMetadata);
  const publicMetadata = record(state.metadata.publicMetadata);

  const privateValue = privateMetadata?.pentraPlanFeatures;
  const privateOverride = privateValue === undefined
    ? null
    : exactCanonicalOverride(privateValue);
  if (privateValue !== undefined && !privateOverride) {
    return { ok: false, reason: "invalid_private_override" };
  }

  let trusted = privateOverride
    ? higherEntitlement(purchased, privateOverride)
    : purchased;

  const legacyValue = publicMetadata?.features;
  const legacyOverride = legacyValue === undefined
    ? null
    : exactCanonicalOverride(legacyValue);
  const legacyMarked =
    privateMetadata?.pentraLegacyPublicPlanOverride === true;

  if (legacyMarked) {
    if (!legacyOverride) {
      return { ok: false, reason: "invalid_legacy_override" };
    }
    trusted = higherEntitlement(trusted, legacyOverride);
  } else if (
    legacyOverride &&
    tierIndex(legacyOverride.tier) > tierIndex(trusted.tier)
  ) {
    return { ok: false, reason: "legacy_override_migration_required" };
  } else if (!legacyOverride && hasPlanFeatureCandidate(legacyValue)) {
    // A malformed historical plan-like value may still be backing an existing
    // account. Refuse to reinterpret or combine it automatically.
    return { ok: false, reason: "legacy_override_migration_required" };
  }

  return { ok: true, entitlement: trusted };
}

/** Build the server-only metadata patch for a reviewed legacy migration. */
export function legacyPublicOverrideMigrationPatch(
  publicMetadata: unknown,
): Record<string, unknown> | null {
  const legacyValue = record(publicMetadata)?.features;
  const legacyOverride = exactCanonicalOverride(legacyValue);
  if (!legacyOverride) return null;
  return {
    pentraPlanFeatures: legacyOverride.planFeatures,
  };
}

export function isClerkBillingLifecycleEvent(type: string): boolean {
  return BILLING_LIFECYCLE_EVENTS.has(type);
}

/** The signed event supplies only a lookup key. Its Plan/features are ignored. */
export function billingWebhookUserId(event: {
  type: string;
  data: unknown;
}): string | null {
  if (!isClerkBillingLifecycleEvent(event.type)) return null;
  if (!event.data || typeof event.data !== "object") return null;
  const payer = (event.data as { payer?: unknown }).payer;
  if (!payer || typeof payer !== "object") return null;
  const userId = (payer as { user_id?: unknown }).user_id;
  return typeof userId === "string" &&
      userId.startsWith("user_") &&
      userId.length <= 512
    ? userId
    : null;
}

type VerifiedWebhookEvent = { type: string; data: unknown };

export type ClerkBillingWebhookDependencies = {
  signingSecret?: string;
  verify: (
    request: Request,
    options: { signingSecret: string },
  ) => Promise<VerifiedWebhookEvent>;
  loadBillingState: (userId: string) => Promise<ClerkBillingStateLike>;
  syncPlanFeatures: (args: {
    userId: string;
    planFeatures: string[];
  }) => Promise<void>;
  requestAccountDeletion: (args: {
    userId: string;
    sourceEventId?: string;
  }) => Promise<void>;
  now?: () => number;
};

function deletedUserId(event: VerifiedWebhookEvent): string | null {
  if (event.type !== "user.deleted") return null;
  if (!event.data || typeof event.data !== "object") return null;
  const data = event.data as { id?: unknown; deleted?: unknown };
  return data.deleted === true &&
      typeof data.id === "string" &&
      data.id.startsWith("user_") &&
      data.id.length <= 512
    ? data.id
    : null;
}

function boundedSourceEventId(request: Request): string | undefined {
  const sourceEventId = request.headers.get("svix-id")?.trim();
  return sourceEventId && sourceEventId.length <= 512
    ? sourceEventId
    : undefined;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

/**
 * Signature-first, duplicate-safe billing reconciliation. Duplicate or
 * out-of-order lifecycle deliveries simply re-read Clerk and apply the same
 * canonical current state; no entitlement is derived from event contents.
 */
export async function handleClerkBillingWebhook(
  request: Request,
  dependencies: ClerkBillingWebhookDependencies,
): Promise<Response> {
  const signingSecret = dependencies.signingSecret?.trim();
  if (!signingSecret) {
    return json({ ok: false, error: "Webhook unavailable" }, 503);
  }

  let event: VerifiedWebhookEvent;
  try {
    event = await dependencies.verify(request, { signingSecret });
  } catch {
    return json({ ok: false, error: "Webhook verification failed" }, 400);
  }

  if (event.type === "user.deleted") {
    const userId = deletedUserId(event);
    if (!userId) {
      // A verified but malformed deletion must be retried or investigated. It
      // must never be acknowledged while the account can still execute.
      return json({ ok: false, error: "Invalid account deletion event" }, 400);
    }
    try {
      await dependencies.requestAccountDeletion({
        userId,
        sourceEventId: boundedSourceEventId(request),
      });
      return json({ ok: true, deletion: "scheduled" }, 200);
    } catch {
      // Clerk retries non-2xx deliveries. A retry is safer than acknowledging
      // an event before Pentra's durable execution fence exists.
      return json({ ok: false, error: "Account deletion unavailable" }, 503);
    }
  }

  if (!isClerkBillingLifecycleEvent(event.type)) {
    return json({ ok: true, ignored: true }, 200);
  }
  const userId = billingWebhookUserId(event);
  if (!userId) {
    // Pentra currently sells user plans, not organization plans. A verified
    // organization event is valid but does not map to a Pentra account owner.
    return json({ ok: true, ignored: true }, 200);
  }

  try {
    const state = await dependencies.loadBillingState(userId);
    const resolution = resolvePlanEntitlement(
      state,
      dependencies.now?.() ?? Date.now(),
    );
    if (!resolution.ok) {
      // Do not acknowledge a delivery that would silently replace a historical
      // admin grant. Once metadata is migrated/fixed, Clerk can retry safely.
      return json({ ok: false, error: "Plan reconciliation blocked" }, 503);
    }
    const authoritative = resolution.entitlement;
    await dependencies.syncPlanFeatures({
      userId,
      planFeatures: authoritative.planFeatures,
    });
    return json({ ok: true, tier: authoritative.tier }, 200);
  } catch {
    // A retry is safer than converting a transient Clerk/Convex failure into a
    // downgrade or acknowledging a billing event that was never reconciled.
    return json({ ok: false, error: "Billing reconciliation unavailable" }, 503);
  }
}
