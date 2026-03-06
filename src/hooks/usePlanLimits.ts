"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
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
  const { has, isSignedIn } = useAuth();
  const syncFeatures = useMutation(api.sites.syncPlanFeatures);
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

  // Sync to Convex whenever features change
  useEffect(() => {
    if (!isSignedIn || !featuresKey || featuresKey === lastSynced.current)
      return;
    lastSynced.current = featuresKey;
    syncFeatures({ planFeatures: features }).catch(() => {
      // Silently fail — non-critical
    });
  }, [isSignedIn, featuresKey]);

  return {
    ...limits,
    features,
    isFreePlan: features.length === 0 || features.includes("max_articles_3"),
  };
}
