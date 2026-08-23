import { clerkClient } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/backend/webhooks";

import {
  handleClerkBillingWebhook,
  type ClerkBillingSubscriptionLike,
} from "@/lib/clerk-billing-reconciliation";
import { callPentraInternal } from "@/lib/pentra-internal-api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleClerkBillingWebhook(request, {
    signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    verify: (incoming, options) => verifyWebhook(incoming, options),
    loadBillingState: async (userId) => {
      const client = await clerkClient();
      const [subscription, user] = await Promise.all([
        client.billing.getUserBillingSubscription(userId),
        client.users.getUser(userId),
      ]);
      return {
        subscription: subscription as ClerkBillingSubscriptionLike,
        metadata: {
          privateMetadata: user.privateMetadata,
          publicMetadata: user.publicMetadata,
        },
      };
    },
    syncPlanFeatures: async ({ userId, planFeatures }) => {
      await callPentraInternal("/internal/plan/features", {
        userId,
        planFeatures,
      });
    },
    requestAccountDeletion: async ({ userId, sourceEventId }) => {
      await callPentraInternal("/account-deletion", {
        userId,
        sourceEventId,
      });
    },
  });
}
