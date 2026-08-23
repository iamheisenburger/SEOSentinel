"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import {
  ALL_FEATURE_KEYS,
  CANONICAL_PLANS,
  getLimitsFromFeatures,
  resolvePlanFromFeatures,
  type CanonicalPlanTier,
} from "../../convex/planLimits";

type CanonicalPlanSummary = {
  tier: CanonicalPlanTier;
  maxSites: number;
  maxArticles: number;
};

type CachedPlan = CanonicalPlanSummary & { userId: string };

const serverPlanCache = new Map<string, CanonicalPlanSummary>();
const inFlightPlanRequests = new Map<string, Promise<CanonicalPlanSummary>>();
const PLAN_SYNC_RETRY_MS = 5_000;
const PLAN_SYNC_MAX_RETRY_MS = 60_000;

function parseCanonicalPlanSummary(value: unknown): CanonicalPlanSummary | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const plan = CANONICAL_PLANS.find((candidate) =>
    candidate.tier === payload.tier
  );
  if (
    payload.ok !== true ||
    !plan ||
    payload.maxSites !== plan.maxSites ||
    payload.maxArticles !== plan.maxArticles
  ) {
    return null;
  }
  return {
    tier: plan.tier,
    maxSites: plan.maxSites,
    maxArticles: plan.maxArticles,
  };
}

function fetchAuthoritativePlan(
  userId: string,
  sessionFingerprint: string,
): Promise<CanonicalPlanSummary> {
  const requestKey = `${userId}:${sessionFingerprint}`;
  const existing = inFlightPlanRequests.get(requestKey);
  if (existing) return existing;

  const request = fetch("/api/billing/sync-plan", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Plan sync failed");
      const plan = parseCanonicalPlanSummary(await response.json());
      if (!plan) throw new Error("Invalid plan sync response");
      return plan;
    })
    .finally(() => {
      inFlightPlanRequests.delete(requestKey);
    });
  inFlightPlanRequests.set(requestKey, request);
  return request;
}

function canonicalFeatures(plan: CanonicalPlanSummary): string[] {
  return [
    plan.tier === "enterprise"
      ? "max_sites_unlimited"
      : `max_sites_${plan.maxSites}`,
    `max_articles_${plan.maxArticles}`,
  ];
}

/**
 * Hook that:
 * 1. Uses signed Clerk session features only as the initial display fallback.
 * 2. Reconciles Billing and server-only overrides through the authenticated API.
 * 3. Caches the sanitized canonical response for client-side gating.
 */
export function usePlanLimits() {
  const { has, isLoaded, isSignedIn, userId } = useAuth();
  const [resolvedPlan, setResolvedPlan] = useState<CachedPlan | null>(() => {
    if (!userId) return null;
    const cached = serverPlanCache.get(userId);
    return cached ? { userId, ...cached } : null;
  });

  // Determine which features the user has
  const features: string[] = [];
  if (isSignedIn && has) {
    for (const key of ALL_FEATURE_KEYS) {
      try {
        if (has({ feature: key } as Parameters<typeof has>[0])) {
          features.push(key);
        }
      } catch {
        // has() may throw if billing isn't set up yet — ignore
      }
    }
  }

  const sessionFeatures = [...features].sort();
  const sessionFingerprint = sessionFeatures.join(",") || "free";
  const fallbackPlan = resolvePlanFromFeatures(sessionFeatures);
  const authoritative = resolvedPlan?.userId === userId
    ? resolvedPlan
    : null;

  // Ask the server to derive the authoritative Clerk features. Never trust a
  // feature list supplied by the browser for backend quota enforcement.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = PLAN_SYNC_RETRY_MS;

    const sync = async () => {
      try {
        const plan = await fetchAuthoritativePlan(userId, sessionFingerprint);
        if (cancelled) return;
        serverPlanCache.set(userId, plan);
        setResolvedPlan({ userId, ...plan });
        retryDelay = PLAN_SYNC_RETRY_MS;
      } catch {
        if (!cancelled) {
          retryTimer = setTimeout(sync, retryDelay);
          retryDelay = Math.min(retryDelay * 2, PLAN_SYNC_MAX_RETRY_MS);
        }
      }
    };
    void sync();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isLoaded, isSignedIn, sessionFingerprint, userId]);

  const limits = authoritative ?? getLimitsFromFeatures(sessionFeatures);
  const returnedFeatures = authoritative
    ? canonicalFeatures(authoritative)
    : sessionFeatures;

  return {
    maxSites: limits.maxSites,
    maxArticles: limits.maxArticles,
    tier: authoritative?.tier ?? fallbackPlan.tier,
    features: returnedFeatures,
    isFreePlan: (authoritative?.tier ?? fallbackPlan.tier) === "free",
    isPlanLoaded: Boolean(authoritative),
    isPlanSyncing: Boolean(isLoaded && isSignedIn && !authoritative),
  };
}
