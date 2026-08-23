"use node";

import { randomBytes } from "node:crypto";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  EXACT_ORGANIC_FUNNEL_EVENT_TYPES,
  formatOutcomeIngestToken,
  isOutcomeIngestPubliclyEnabled,
  normalizeOutcomeGoalKey,
  OUTCOME_INGEST_SAFETY_VERSION,
  outcomeTokenHash,
  type OutcomeEventType,
} from "../lib/outcomeReceipts.ts";

type OutcomeCredentialStatus = {
  configured: boolean;
  status: string;
  version: number;
  qualifiedActionGoalKey?: string;
  createdAt?: number;
  rotatedAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
  updatedAt?: number;
};

type RotatedOutcomeCredential = OutcomeCredentialStatus & {
  token: string;
  authorizationScheme: "Bearer";
  endpointPath: "/outcomes/v1/receipts";
  safetyContract: string;
  warning: string;
};

type OutcomeIngestRuntimeReadiness = {
  siteId: Id<"sites">;
  endpointPath: "/outcomes/v1/receipts";
  safetyContract: string;
  acceptedExactFunnel: OutcomeEventType[];
  credential: OutcomeCredentialStatus;
  tenantExecutionAuthorized: boolean;
  publicEndpointEnabled: boolean;
  ready: boolean;
};

export const getIngestRuntimeReadiness = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<OutcomeIngestRuntimeReadiness> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const tenant: { owned: boolean; executionAuthorized: boolean } =
      await ctx.runQuery(
      internal.outcomes.getIngestTenantReadinessInternal,
      { siteId, ownerUserId: identity.subject },
    );
    if (!tenant.owned) {
      throw new Error("Not authorized to inspect this site's outcome ingestion");
    }
    const credential: OutcomeCredentialStatus = await ctx.runQuery(
      internal.outcomes.getIngestCredentialStatusInternal,
      { siteId },
    );
    const publicEndpointEnabled = isOutcomeIngestPubliclyEnabled({
      enabled: process.env.OUTCOME_INGEST_ENABLED,
      safetyVersion: process.env.OUTCOME_INGEST_SAFETY_VERSION,
    });
    return {
      siteId,
      endpointPath: "/outcomes/v1/receipts" as const,
      safetyContract: OUTCOME_INGEST_SAFETY_VERSION,
      acceptedExactFunnel: [...EXACT_ORGANIC_FUNNEL_EVENT_TYPES],
      credential,
      tenantExecutionAuthorized: tenant.executionAuthorized,
      publicEndpointEnabled,
      ready: tenant.executionAuthorized && publicEndpointEnabled &&
        credential.configured &&
        credential.status === "active",
    };
  },
});

/**
 * Generate and rotate a site's server-to-server outcome credential. The raw
 * token exists only in this action result; the mutation receives and stores a
 * tenant-bound digest. Callers must place it in a private backend secret store,
 * never in browser JavaScript, analytics tags, or public environment values.
 */
export const rotateIngestCredential = action({
  args: {
    siteId: v.id("sites"),
    qualifiedActionGoalKey: v.string(),
  },
  handler: async (
    ctx,
    { siteId, qualifiedActionGoalKey },
  ): Promise<RotatedOutcomeCredential> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const authorized = await ctx.runQuery(
      internal.outcomes.canManageCredentialInternal,
      { siteId, ownerUserId: identity.subject },
    );
    if (!authorized) {
      throw new Error("Not authorized to rotate this site's outcome credential");
    }
    const goalKey = normalizeOutcomeGoalKey(qualifiedActionGoalKey);
    const token = formatOutcomeIngestToken(randomBytes(32));
    const status: OutcomeCredentialStatus = await ctx.runMutation(
      internal.outcomes.storeRotatedCredentialInternal,
      {
        siteId,
        ownerUserId: identity.subject,
        tokenHash: outcomeTokenHash(String(siteId), token),
        qualifiedActionGoalKey: goalKey,
      },
    );
    return {
      ...status,
      token,
      authorizationScheme: "Bearer" as const,
      endpointPath: "/outcomes/v1/receipts" as const,
      safetyContract: OUTCOME_INGEST_SAFETY_VERSION,
      warning:
        "Store this token in the destination site's private server environment. It will not be shown again and must never be shipped to a browser.",
    };
  },
});
