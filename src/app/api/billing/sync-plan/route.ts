import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ALL_FEATURE_KEYS } from "../../../../../convex/planLimits";
import { callPentraInternal } from "@/lib/pentra-internal-api";

export async function POST() {
  const { userId, has } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planFeatures = ALL_FEATURE_KEYS.filter((feature) => {
    try {
      return has({ feature } as Parameters<typeof has>[0]);
    } catch {
      return false;
    }
  });

  const user = await currentUser();
  const metadataFeatures = Array.isArray(user?.publicMetadata?.features)
    ? user.publicMetadata.features.filter(
        (feature): feature is string =>
          typeof feature === "string" && ALL_FEATURE_KEYS.includes(feature),
      )
    : [];

  for (const feature of metadataFeatures) {
    if (!planFeatures.includes(feature)) planFeatures.push(feature);
  }

  await callPentraInternal("/internal/plan/features", {
    userId,
    planFeatures,
  });
  return NextResponse.json({ ok: true });
}
