"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import {
  ALL_FEATURE_KEYS,
  getLimitsFromFeatures,
} from "../../convex/planLimits";

/**
 * Hook that:
 * 1. Reads the user's Clerk plan features via has()
 * 2. Syncs them to Convex (so backend crons can enforce limits)
 * 3. Returns { maxSites, maxArticles } for client-side gating
 */
export function usePlanLimits() {
  const { has, isLoaded, isSignedIn } = useAuth();
  const lastSynced = useRef<string>("");

  // Determine which features the user has
  const features: string[] = [];
  if (isSignedIn && has) {
    for (const key of ALL_FEATURE_KEYS) {
      try {
        if (has({ feature: key } as any)) {
          features.push(key);
        }
      } catch {
        // has() may throw if billing isn't set up yet — ignore
      }
    }
  }

  // Also check public_metadata.features (for owner/admin overrides)
  const { user } = useUser();
  const metaFeatures = (user?.publicMetadata as any)?.features as string[] | undefined;
  if (metaFeatures?.length) {
    for (const mf of metaFeatures) {
      if (!features.includes(mf)) features.push(mf);
    }
  }

  const limits = getLimitsFromFeatures(features);
  const featuresKey = features.sort().join(",");

  // Ask the server to derive the authoritative Clerk features. Never trust a
  // feature list supplied by the browser for backend quota enforcement.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const syncKey = featuresKey || "free";
    if (syncKey === lastSynced.current) return;

    fetch("/api/billing/sync-plan", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Plan sync failed");
        lastSynced.current = syncKey;
      })
      .catch(() => {
        // The next authenticated render retries. Client gating remains intact.
      });
  }, [isLoaded, isSignedIn, featuresKey]);

  return {
    ...limits,
    features,
    isFreePlan: features.length === 0 || features.includes("max_articles_3"),
  };
}
