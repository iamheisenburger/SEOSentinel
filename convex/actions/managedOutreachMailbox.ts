"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED,
  MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
  managedOutreachMailboxAdapterConfiguration,
} from "../lib/managedOutreachMailbox.ts";

/**
 * Provider-neutral action boundary. There is deliberately no fetch/provider
 * SDK here: this repository does not contain a managed transport adapter
 * (Workspace or Pentra-owned) or its authentication contract. Setting a
 * locator alone therefore cannot turn the stub into a real provisioner or
 * make readiness true.
 * A real implementation must first call
 * markProvisioningExternalBoundaryInternal, then perform one idempotent
 * operation keyed by operationKey that cannot start or commit after
 * externalDeadlineAt, then call the fenced canonical installer.
 */
export const provision = internalAction({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runMutation(
      internal.managedOutreachMailbox.getProvisioningOperation,
      args,
    );
    if (!claim) return { accepted: false as const, reason: "fence_changed" };
    const configured = managedOutreachMailboxAdapterConfiguration({
      endpoint: process.env.MANAGED_OUTREACH_MAILBOX_ADAPTER_URL,
      adapterVersion:
        process.env.MANAGED_OUTREACH_MAILBOX_ADAPTER_VERSION,
    });
    const reasonCode = configured
      ? MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED
      : MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE;
    const receipt = await ctx.runMutation(
      internal.managedOutreachMailbox.recordProvisioningAdapterBlocked,
      { ...args, reasonCode },
    );
    return {
      accepted: false as const,
      reason: reasonCode,
      operationKey: claim.operation.operationKey,
      recorded: receipt.recorded,
    };
  },
});

/** Release uses the same idempotent operation key. The current stub never
 * claims deprovision succeeded and never writes the completion tombstone. A
 * real adapter may report completion only after its durable operation-key
 * status serializes release ahead of every late provisioning result. */
export const release = internalAction({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runQuery(
      internal.managedOutreachMailbox.getReleaseOperation,
      args,
    );
    if (!claim) return { accepted: false as const, reason: "fence_changed" };
    const configured = managedOutreachMailboxAdapterConfiguration({
      endpoint: process.env.MANAGED_OUTREACH_MAILBOX_ADAPTER_URL,
      adapterVersion:
        process.env.MANAGED_OUTREACH_MAILBOX_ADAPTER_VERSION,
    });
    const reasonCode = configured
      ? MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED
      : MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE;
    const receipt = await ctx.runMutation(
      internal.managedOutreachMailbox.recordReleaseAdapterBlocked,
      { ...args, reasonCode },
    );
    return {
      accepted: false as const,
      reason: reasonCode,
      operationKey: claim.operation.operationKey,
      recorded: receipt.recorded,
    };
  },
});
