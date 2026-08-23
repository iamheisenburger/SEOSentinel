import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  canonicalPlanSummary,
  type ClerkBillingSubscriptionLike,
  resolvePlanEntitlement,
} from "@/lib/clerk-billing-reconciliation";
import { callPentraInternal } from "@/lib/pentra-internal-api";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const client = await clerkClient();
    const [subscription, user] = await Promise.all([
      client.billing.getUserBillingSubscription(userId),
      client.users.getUser(userId),
    ]);
    const resolution = resolvePlanEntitlement({
      subscription: subscription as ClerkBillingSubscriptionLike,
      metadata: {
        privateMetadata: user.privateMetadata,
        publicMetadata: user.publicMetadata,
      },
    });
    if (!resolution.ok) {
      return NextResponse.json(
        { error: "Plan reconciliation blocked" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const authoritative = resolution.entitlement;
    await callPentraInternal("/internal/plan/features", {
      userId,
      planFeatures: authoritative.planFeatures,
    });
    return NextResponse.json(
      { ok: true, ...canonicalPlanSummary(authoritative) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Preserve the last verified entitlement during a transient Clerk/Convex
    // failure. The authenticated client retries instead of forcing a downgrade.
    return NextResponse.json(
      { error: "Billing reconciliation unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
