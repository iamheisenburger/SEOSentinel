/**
 * Authority outreach: inboxes, drafts, suppression and contacts.
 *
 * Two rules shape every function here.
 *
 * 1. Tenant isolation is checked on the record, not inferred from the
 *    argument. A message, contact or suppression is only ever reachable
 *    through the site that owns it.
 * 2. Mailbox credentials never leave the backend. Public queries return a
 *    redacted view; the full record is available only to internal actions that
 *    actually need to authenticate to a mail provider.
 */

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  DEFAULT_DAILY_SEND_CAP,
  DOMAIN_CONTACT_COOLDOWN_DAYS,
  contactEligibility,
  normalizeDomain,
  outreachComplianceIssues,
  outreachSendDecision,
  outreachSenderReadinessIssues,
  utcDayKey,
} from "./lib/outreachPacing.ts";
import {
  resolveGmailReconnectProfile,
  sanitizeInboxForClient,
} from "./lib/outreachSecurity.ts";
import {
  OUTREACH_DELIVERY_LEASE_MS,
  OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS,
  approvalMatchesInbox,
  deliveryLeaseState,
  liveDnsEvidenceIssues,
  opportunityEvidenceIsFresh,
  sanitizeDeliveryFailure,
  senderClaimIssues,
} from "./lib/outreachDelivery.ts";
import {
  canonicalPublicationUrl,
  verifiedAuthorityTarget,
} from "./lib/publicationLive.ts";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance.ts";
import {
  OUTREACH_INBOUND_LEASE_MS,
  OUTREACH_INBOUND_LOOKBACK_MS,
  OUTREACH_INBOUND_OVERLAP_MS,
  shouldPromoteOutreachInbound,
} from "./lib/outreachInbound.ts";
import {
  OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS,
  OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS,
  OUTREACH_INBOUND_RELAY_CANARY_TTL_MS,
  inboundRelayAliasHash,
  inboundRelayConfigurationHash,
  inboundRelayConfigured,
  inboundRelayDsnRoutingReady,
  inboundRelayDsnRoutingTarget,
  OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
  inboundRelayEmailHash,
  inboundRelayMessageIdHash,
  normalizeInboundRelayDomain,
  normalizeRfcMessageId,
} from "./lib/outreachInboundRelay.ts";
import { accountDeletionKey } from "./lib/accountDeletion.ts";

function inboundRelayRuntimeConfig() {
  return {
    domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    secrets: [
      process.env.OUTREACH_INBOUND_RELAY_SECRET,
      process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    ],
    dsnTargetSecret:
      process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
    adapterVersion: process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
    retentionPolicyHash:
      process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
    retentionAudited: process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  };
}

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to access this site's outreach");
  }
  return site;
}

async function inboxForSite(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .unique();
}

async function pendingLegacyUnboundMessageCount(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
): Promise<number> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const settledStatuses = ["sent", "delivery_reviewed_sent", "replied"];
  const pending = await Promise.all([
    ...settledStatuses.map((status) =>
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_relay_status_sent", (q) =>
          q
            .eq("inboxId", inboxId)
            .eq("inboundRelayAliasHash", undefined)
            .eq("status", status)
            .gte("sentAt", cutoff)
        )
        .first()
    ),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_inbox_relay_status_sent", (q) =>
        q
          .eq("inboxId", inboxId)
          .eq("inboundRelayAliasHash", undefined)
          .eq("status", "delivery_unverified")
      )
      .first(),
  ]);
  // This is an existence/preflight result, not a misleading total. One direct
  // indexed hit is enough to prevent a reconnect from overwriting read access.
  return pending.some(Boolean) ? 1 : 0;
}

async function assertNoActiveDelivery(
  ctx: MutationCtx,
  siteId: Id<"sites">,
): Promise<void> {
  const inbox = await inboxForSite(ctx, siteId);
  const [sending, unverified, canaries] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "sending"))
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified")
      )
      .first(),
    inbox
      ? ctx.db
          .query("outreach_inbound_relay_canaries")
          .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
          .take(2)
      : Promise.resolve([]),
  ]);
  const activeCanary = canaries.some(
    (canary) =>
      canary.deliveryStatus === "claimed" &&
      (canary.deliveryLeaseExpiresAt ?? 0) > Date.now(),
  );
  if (sending || unverified || activeCanary) {
    throw new Error("The inbox cannot change while outreach delivery is in progress");
  }
}

async function outreachSettlementLifecycleActive(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
): Promise<boolean> {
  if (
    !site?.userId ||
    site.deletionStatus ||
    site.accountDeletionRequestedAt ||
    site.domainOwnershipConflictAt
  ) {
    return false;
  }
  const deletionReceipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) =>
      q.eq("accountKey", accountDeletionKey(site.userId!))
    )
    .unique();
  if (deletionReceipt) return false;
  return true;
}

async function relaySettlementAuthorized(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
  sentAt: number | undefined,
): Promise<boolean> {
  const policy = await outreachSettlementPolicy(ctx, site);
  return Boolean(sentAt && policy.allows(sentAt));
}

async function outreachSettlementPolicy(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
): Promise<{
  allows: (deliveryBoundaryAt: number | undefined) => boolean;
  maximumDeliveryBoundaryAt?: number;
}> {
  if (!(await outreachSettlementLifecycleActive(ctx, site))) {
    return { allows: () => false, maximumDeliveryBoundaryAt: 0 };
  }
  if (await siteExecutionAuthorized(ctx, site)) {
    return { allows: (deliveryBoundaryAt) => Boolean(deliveryBoundaryAt) };
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site!.userId!))
    .unique();
  const transitionStartedAt = Math.max(
    site!.planAllowanceChangedAt ?? 0,
    site!.planParkedAt ?? 0,
    entitlement?.syncStartedAt ?? 0,
  );
  return {
    maximumDeliveryBoundaryAt: transitionStartedAt,
    allows: (deliveryBoundaryAt) => Boolean(
      transitionStartedAt > 0 &&
      deliveryBoundaryAt &&
      deliveryBoundaryAt <= transitionStartedAt
    ),
  };
}

const LEGACY_INBOUND_SETTLED_STATUSES = [
  "sent",
  "delivery_reviewed_sent",
  "replied",
] as const;

async function legacyUnboundMessages(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
  options: {
    limit: number;
    maximumDeliveryBoundaryAt?: number;
  },
): Promise<Array<Doc<"outreach_messages">>> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  if (
    options.maximumDeliveryBoundaryAt !== undefined &&
    options.maximumDeliveryBoundaryAt < cutoff
  ) {
    return [];
  }
  const perStatus = Math.max(1, Math.min(40, options.limit));
  const batches = await Promise.all(
    LEGACY_INBOUND_SETTLED_STATUSES.flatMap((status) => {
      if (options.maximumDeliveryBoundaryAt !== undefined) {
        return [
          ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox_relay_status_claimed", (q) =>
              q
                .eq("inboxId", inboxId)
                .eq("inboundRelayAliasHash", undefined)
                .eq("status", status)
                .gte("deliveryClaimedAt", cutoff)
                .lte("deliveryClaimedAt", options.maximumDeliveryBoundaryAt!)
            )
            .order("desc")
            .take(perStatus),
          ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox_relay_status_sent", (q) =>
              q
                .eq("inboxId", inboxId)
                .eq("inboundRelayAliasHash", undefined)
                .eq("status", status)
                .gte("sentAt", cutoff)
                .lte("sentAt", options.maximumDeliveryBoundaryAt!)
            )
            .order("desc")
            .take(perStatus),
        ];
      }
      return [
        ctx.db
          .query("outreach_messages")
          .withIndex("by_inbox_relay_status_sent", (q) =>
            q
              .eq("inboxId", inboxId)
              .eq("inboundRelayAliasHash", undefined)
              .eq("status", status)
              .gte("sentAt", cutoff)
          )
          .order("desc")
          .take(perStatus),
      ];
    }),
  );
  const unique = new Map<string, Doc<"outreach_messages">>();
  for (const message of batches.flat()) {
    const boundary = message.deliveryClaimedAt ?? message.sentAt;
    if (
      message.sentAt &&
      message.sentAt >= cutoff &&
      (message.providerMessageId || message.providerThreadId) &&
      (options.maximumDeliveryBoundaryAt === undefined ||
        (boundary !== undefined &&
          boundary <= options.maximumDeliveryBoundaryAt))
    ) unique.set(message._id, message);
  }
  return [...unique.values()]
    .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))
    .slice(0, options.limit);
}

async function legacyUnboundMessagesMissingThread(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
  maximumDeliveryBoundaryAt?: number,
): Promise<Array<Doc<"outreach_messages">>> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const batches = await Promise.all(
    LEGACY_INBOUND_SETTLED_STATUSES.map((status) =>
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_relay_thread_status_sent", (q) =>
          q
            .eq("inboxId", inboxId)
            .eq("inboundRelayAliasHash", undefined)
            .eq("providerThreadId", undefined)
            .eq("status", status)
            .gte("sentAt", cutoff)
        )
        .order("desc")
        .take(10)
    ),
  );
  return batches
    .flat()
    .filter((message) => {
      const boundary = message.deliveryClaimedAt ?? message.sentAt;
      return Boolean(
        message.providerMessageId &&
        (maximumDeliveryBoundaryAt === undefined ||
          (boundary !== undefined && boundary <= maximumDeliveryBoundaryAt))
      );
    })
    .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))
    .slice(0, 10);
}

// ── Inbox ──

export const getInbox = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    const legacyDrainRequired = inbox
      ? (await pendingLegacyUnboundMessageCount(ctx, inbox._id)) > 0
      : false;
    const runtimeConfig = inboundRelayRuntimeConfig();
    const routingTarget =
      inbox &&
      inbox.provider === "gmail" &&
      !["disconnected", "suspended"].includes(inbox.status) &&
      Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken) &&
      (await siteExecutionAuthorized(ctx, site))
        ? await inboundRelayDsnRoutingTarget({
            siteId: String(site._id),
            inboxId: String(inbox._id),
            generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
            relayDomain: runtimeConfig.domain,
            secret: runtimeConfig.dsnTargetSecret,
          })
        : null;
    const routingCanaryReady = Boolean(
      routingTarget &&
      inbox?.inboundRelayDsnRoutingTargetHash === routingTarget.hash &&
      inbox.inboundRelayDsnRoutingTargetVersion === routingTarget.version &&
      inboundRelayDsnRoutingReady({
        inbox,
        now: Date.now(),
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        runtimeConfig,
      }),
    );
    return sanitizeInboxForClient(
      inbox,
      Date.now(),
      inboundRelayConfigured(runtimeConfig),
      routingCanaryReady,
      legacyDrainRequired,
      routingTarget?.address,
    );
  },
});

/**
 * Mailbox credentials are accepted only from Pentra's signed server-side
 * Google OAuth callback. Keeping this internal prevents a browser client from
 * injecting SMTP/transactional-provider secrets into the cold-mail path.
 */
export const connectGmailInboxInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    oauthAccessToken: v.string(),
    oauthRefreshToken: v.optional(v.string()),
    oauthExpiresAt: v.optional(v.number()),
    oauthScopes: v.string(),
    senderDomain: v.string(),
    dkimSelector: v.string(),
    dnsCheckedAt: v.number(),
    spfVerified: v.boolean(),
    dkimVerified: v.boolean(),
    dmarcVerified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    await assertNoActiveDelivery(ctx, args.siteId);
    const now = Date.now();
    if (
      args.oauthAccessToken.length < 10 ||
      args.dnsCheckedAt < now - 10 * 60 * 1000 ||
      args.dnsCheckedAt > now + 60 * 1000 ||
      !/^[a-z0-9_-]{1,63}$/i.test(args.dkimSelector)
    ) {
      throw new Error("Mailbox verification evidence is invalid or stale");
    }
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const readinessIssues = outreachSenderReadinessIssues({
      siteDomain: site.domain,
      provider: "gmail",
      fromEmail,
    });
    if (readinessIssues.length > 0) throw new Error(readinessIssues.join(" "));
    const grantedScopes = args.oauthScopes.split(/\s+/).filter(Boolean);
    const allowedScopes = new Set([
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    if (
      !grantedScopes.includes("https://www.googleapis.com/auth/gmail.send") ||
      !grantedScopes.every((scope) => allowedScopes.has(scope))
    ) {
      throw new Error("Google did not return a strict send-only Gmail grant");
    }
    const emailDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
    if (!emailDomain || emailDomain !== normalizeDomain(args.senderDomain)) {
      throw new Error("Sender-domain evidence does not match the connected mailbox");
    }

    const existing = await inboxForSite(ctx, args.siteId);
    const existingRefreshHasLegacyRead = Boolean(
      existing?.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ),
    );
    const existingScopes = existing?.oauthScopes?.split(/\s+/).filter(Boolean) ?? [];
    const existingRefreshIsStrictOutbound = Boolean(
      existing?.oauthRefreshToken &&
      existingScopes.includes("https://www.googleapis.com/auth/gmail.send") &&
      existingScopes.every((scope) => allowedScopes.has(scope)),
    );
    const reconnectsSameMailbox = Boolean(
      existing && existing.fromEmail.trim().toLowerCase() === fromEmail,
    );
    if (
      existing &&
      existingRefreshHasLegacyRead &&
      (await pendingLegacyUnboundMessageCount(ctx, existing._id)) > 0
    ) {
      throw new Error(
        "Legacy Gmail monitoring still has unbound sent messages; reconnect is blocked until its 90-day compatibility drain completes",
      );
    }
    if (
      !args.oauthRefreshToken &&
      (!reconnectsSameMailbox || !existingRefreshIsStrictOutbound)
    ) {
      throw new Error("Google did not provide durable offline mailbox access");
    }
    const dnsReady = args.spfVerified && args.dkimVerified && args.dmarcVerified;
    const reconnectProfile = resolveGmailReconnectProfile({
      requestedFromName: args.fromName,
      existingFromName: existing?.fromName,
      physicalMailingAddress: existing?.physicalMailingAddress,
      complianceConfirmedAt: existing?.complianceConfirmedAt,
    });
    const complianceReady = reconnectProfile.complianceReady;
    const ready = dnsReady && complianceReady;
    const inboundReady = false;
    const dsnRoutingTargetGeneration = existing
      ? reconnectsSameMailbox
        ? existing.inboundRelayDsnRoutingTargetGeneration ?? 1
        : (existing.inboundRelayDsnRoutingTargetGeneration ?? 1) + 1
      : 1;
    const record = {
      provider: "gmail",
      fromEmail,
      fromName: reconnectProfile.fromName,
      oauthAccessToken: args.oauthAccessToken,
      oauthRefreshToken: args.oauthRefreshToken ??
        (reconnectsSameMailbox ? existing?.oauthRefreshToken : undefined),
      oauthExpiresAt: args.oauthExpiresAt,
      oauthScopes: args.oauthScopes,
      senderDomain: emailDomain,
      dkimSelector: args.dkimSelector,
      dnsCheckedAt: args.dnsCheckedAt,
      spfVerifiedAt: args.spfVerified ? args.dnsCheckedAt : undefined,
      dkimVerifiedAt: args.dkimVerified ? args.dnsCheckedAt : undefined,
      dmarcVerifiedAt: args.dmarcVerified ? args.dnsCheckedAt : undefined,
      configurationVersion: (existing?.configurationVersion ?? 0) + 1,
      verifiedAt: ready ? now : undefined,
      status: ready ? "warming" : "connected",
      mode: "approval",
      dailySendCap: Math.max(
        1,
        Math.min(existing?.dailySendCap ?? DEFAULT_DAILY_SEND_CAP, DEFAULT_DAILY_SEND_CAP),
      ),
      lastError: !dnsReady
        ? "SPF, DKIM and DMARC must all verify before outreach can send."
        : !complianceReady
          ? "Add the sender name and physical mailing address before outreach can send."
          : undefined,
      inboundLastError: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      inboundRelayDsnRoutingTargetGeneration: dsnRoutingTargetGeneration,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { inboxId: existing._id, reconnected: true, ready, inboundReady };
    }
    const inboxId = await ctx.db.insert("outreach_inboxes", {
      ...record,
      siteId: args.siteId,
      warmupStartedAt: now,
      sentToday: 0,
      sentTodayDay: utcDayKey(now),
      createdAt: now,
    });
    return { inboxId, reconnected: false, ready, inboundReady };
  },
});

export const setInboxComplianceProfile = mutation({
  args: {
    siteId: v.id("sites"),
    fromName: v.string(),
    physicalMailingAddress: v.string(),
  },
  handler: async (ctx, { siteId, fromName, physicalMailingAddress }) => {
    await requireSiteOwner(ctx, siteId);
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) throw new Error("Connect the secondary-domain Gmail inbox first");
    const safeName = fromName.replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
    const safeAddress = physicalMailingAddress
      .replace(/[\r\n]+/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (safeName.length < 2 || safeName.length > 100) {
      throw new Error("Enter the real person or business name that will send outreach");
    }
    if (safeAddress.length < 15 || safeAddress.length > 300) {
      throw new Error("Enter a complete physical mailing address for the email footer");
    }
    const dnsReady = Boolean(
      inbox.spfVerifiedAt && inbox.dkimVerifiedAt && inbox.dmarcVerifiedAt,
    );
    const now = Date.now();
    await ctx.db.patch(inbox._id, {
      fromName: safeName,
      physicalMailingAddress: safeAddress,
      complianceConfirmedAt: now,
      configurationVersion: (inbox.configurationVersion ?? 0) + 1,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      verifiedAt: dnsReady ? now : undefined,
      status: dnsReady ? "warming" : "connected",
      mode: "approval",
      lastError: dnsReady
        ? undefined
        : "SPF, DKIM and DMARC must all verify before outreach can send.",
      updatedAt: now,
    });
    return { ready: dnsReady, status: dnsReady ? "warming" : "connected" };
  },
});

/** Rotate only this tenant's Workspace DSN intake capability. The address is
 * derived for the authenticated owner and is never stored; its non-secret
 * generation is durable so routine reconnects and plan parking stay stable. */
export const rotateInboundRelayDsnRoutingTarget = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (!(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("This site's outreach configuration is currently parked");
    }
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (
      !inbox ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken)
    ) {
      throw new Error("Connect the Gmail outreach inbox before rotating its route");
    }
    const runtimeConfig = inboundRelayRuntimeConfig();
    const generation =
      (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) + 1;
    const target = await inboundRelayDsnRoutingTarget({
      siteId: String(siteId),
      inboxId: String(inbox._id),
      generation,
      relayDomain: runtimeConfig.domain,
      secret: runtimeConfig.dsnTargetSecret,
    });
    if (!target) {
      throw new Error("The per-inbox DSN routing target is unavailable");
    }
    await ctx.db.patch(inbox._id, {
      inboundRelayDsnRoutingTargetGeneration: generation,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      updatedAt: Date.now(),
    });
    return {
      rotated: true as const,
      routingAddress: target.address,
      canaryReady: false as const,
    };
  },
});

export const setInboxMode = mutation({
  args: { siteId: v.id("sites"), mode: v.string() },
  handler: async (ctx, { siteId, mode }) => {
    await requireSiteOwner(ctx, siteId);
    await assertNoActiveDelivery(ctx, siteId);
    if (mode !== "approval") {
      throw new Error("Automatic outreach delivery is disabled; use owner-approved one-message sends");
    }
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) throw new Error("No outreach inbox is connected for this site");
    await ctx.db.patch(inbox._id, { mode, updatedAt: Date.now() });
    return { mode };
  },
});

export const disconnectInbox = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) return { disconnected: false };
    // Credentials are cleared rather than the row deleted so warm-up history
    // and the audit trail on sent messages survive a reconnect.
    await ctx.db.patch(inbox._id, {
      status: "disconnected",
      mode: "approval",
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      oauthExpiresAt: undefined,
      oauthScopes: undefined,
      complianceConfirmedAt: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      verifiedAt: undefined,
      inboundSyncPageToken: undefined,
      inboundSyncWindowStartedAt: undefined,
      inboundSyncLeaseId: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      configurationVersion: (inbox.configurationVersion ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return { disconnected: true };
  },
});

export const getInboxInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!(await siteExecutionAuthorized(ctx, site))) return null;
    const inbox = await inboxForSite(ctx, siteId);
    return inbox
      ? { ...inbox, siteRolloutEpoch: site?.autopilotRolloutEpoch ?? 0 }
      : null;
  },
});

export const getGmailReconnectReadinessInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return { ready: false, reason: "Tenant is unavailable." };
    }
    const inbox = await inboxForSite(ctx, siteId);
    if (
      !inbox ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      )
    ) {
      return { ready: true };
    }
    const pending = await pendingLegacyUnboundMessageCount(ctx, inbox._id);
    return pending > 0
      ? {
          ready: false,
          pending,
          reason:
            "This legacy inbox still monitors sent messages without relay aliases. Reconnect is blocked until the bounded 90-day compatibility drain completes.",
        }
      : { ready: true };
  },
});

/** Legacy readonly polling is retained only as post-send compliance
 * settlement. Unlike growth work, it may finish replies for messages sent
 * before plan parking/reconciliation, but never after deletion or conflict. */
export const listLegacyInboundFleetPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("outreach_inboxes")
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    const page: Array<{
      siteId: Id<"sites">;
      autopilotEnabled: boolean;
      autopilotRolloutMode: string;
      inboxConfigurationValid: boolean;
      hasInbox: boolean;
      inboxProvider?: string;
      inboxStatus?: string;
      inboxMode?: string;
      inboxVerified: boolean;
      hasVerifiedOpportunities: boolean;
      hasApprovedMessages: boolean;
      hasLinksToVerify: boolean;
      inboundMonitoringReady: boolean;
      inboundMonitoringMode: "legacy_gmail";
      hasMessagesToMonitor: boolean;
    }> = [];
    for (const inbox of result.page) {
      if (
        inbox.provider !== "gmail" ||
        !inbox.oauthScopes?.split(/\s+/).includes(
          "https://www.googleapis.com/auth/gmail.readonly",
        ) ||
        !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
        ["disconnected", "suspended"].includes(inbox.status)
      ) continue;
      const [site, inboxes] = await Promise.all([
        ctx.db.get(inbox.siteId),
        ctx.db
          .query("outreach_inboxes")
          .withIndex("by_site", (q) => q.eq("siteId", inbox.siteId))
          .take(2),
      ]);
      if (inboxes.length !== 1 || inboxes[0]._id !== inbox._id) continue;
      const policy = await outreachSettlementPolicy(ctx, site);
      if (policy.maximumDeliveryBoundaryAt === 0) continue;
      const [candidate] = await legacyUnboundMessages(ctx, inbox._id, {
        limit: 1,
        maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
      });
      if (!candidate || !policy.allows(
        candidate.deliveryClaimedAt ?? candidate.sentAt,
      )) {
        continue;
      }
      page.push({
        siteId: inbox.siteId,
        autopilotEnabled: false,
        autopilotRolloutMode: "observe",
        inboxConfigurationValid: true,
        hasInbox: true,
        inboxProvider: inbox.provider,
        inboxStatus: inbox.status,
        inboxMode: inbox.mode,
        inboxVerified: Boolean(inbox.verifiedAt),
        hasVerifiedOpportunities: false,
        hasApprovedMessages: false,
        hasLinksToVerify: false,
        inboundMonitoringReady: true,
        inboundMonitoringMode: "legacy_gmail",
        hasMessagesToMonitor: true,
      });
    }
    return { ...result, page };
  },
});

export const getLegacyInboundFleetState = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) return null;
    const inbox = inboxes[0];
    if (
      inbox.provider !== "gmail" ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
      ["disconnected", "suspended"].includes(inbox.status)
    ) return null;
    const site = await ctx.db.get(siteId);
    const policy = await outreachSettlementPolicy(ctx, site);
    if (policy.maximumDeliveryBoundaryAt === 0) return null;
    const [candidate] = await legacyUnboundMessages(ctx, inbox._id, {
      limit: 1,
      maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
    });
    if (!candidate || !policy.allows(
      candidate.deliveryClaimedAt ?? candidate.sentAt,
    )) return null;
    return {
      siteId,
      autopilotEnabled: false,
      autopilotRolloutMode: "observe",
      inboxConfigurationValid: true,
      hasInbox: true,
      inboxProvider: inbox.provider,
      inboxStatus: inbox.status,
      inboxMode: inbox.mode,
      inboxVerified: Boolean(inbox.verifiedAt),
      hasVerifiedOpportunities: false,
      hasApprovedMessages: false,
      hasLinksToVerify: false,
      inboundMonitoringReady: true,
      inboundMonitoringMode: "legacy_gmail" as const,
      hasMessagesToMonitor: true,
    };
  },
});

export const getLegacyInboundOwnership = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    return (await outreachSettlementLifecycleActive(ctx, site))
      ? { userId: site!.userId }
      : null;
  },
});

export const markInboxVerified = internalMutation({
  args: { inboxId: v.id("outreach_inboxes"), siteId: v.id("sites") },
  handler: async (ctx, { inboxId, siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    const inbox = await ctx.db.get(inboxId);
    if (!inbox || inbox.siteId !== siteId) throw new Error("Inbox not found for site");
    await assertNoActiveDelivery(ctx, siteId);
    if (
      !inbox.spfVerifiedAt ||
      !inbox.dkimVerifiedAt ||
      !inbox.dmarcVerifiedAt ||
      !inbox.physicalMailingAddress ||
      !inbox.complianceConfirmedAt
    ) {
      throw new Error("DNS and sender compliance must verify before the inbox can activate");
    }
    const now = Date.now();
    await ctx.db.patch(inboxId, {
      verifiedAt: now,
      status: "active",
      lastError: undefined,
      updatedAt: now,
    });
  },
});

export const recordInboxError = internalMutation({
  args: {
    inboxId: v.id("outreach_inboxes"),
    siteId: v.id("sites"),
    error: v.string(),
    suspend: v.optional(v.boolean()),
    expectedConfigurationVersion: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { inboxId, siteId, error, suspend, expectedConfigurationVersion },
  ) => {
    const inbox = await ctx.db.get(inboxId);
    if (!inbox || inbox.siteId !== siteId) throw new Error("Inbox not found for site");
    if (
      expectedConfigurationVersion !== undefined &&
      (inbox.configurationVersion ?? 0) !== expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    await ctx.db.patch(inboxId, {
      lastError: sanitizeDeliveryFailure(error),
      // A provider-level rejection suspends sending rather than retrying into
      // a block, which is what turns a warning into a blacklisting.
      status: suspend ? "suspended" : inbox.status,
      mode: suspend ? "approval" : inbox.mode,
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

// ── Messages ──

export const listMessages = query({
  args: {
    siteId: v.id("sites"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, status, limit }) => {
    await requireSiteOwner(ctx, siteId);
    const take = Math.max(1, Math.min(limit ?? 50, 200));
    if (status) {
      return ctx.db
        .query("outreach_messages")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status),
        )
        .order("desc")
        .take(take);
    }
    const statuses = [
      "draft",
      "blocked",
      "approved",
      "sending",
      "delivery_unverified",
      "delivery_reviewed_sent",
      "sent",
      "replied",
      "failed",
      "bounced",
      "skipped",
    ];
    const batches = await Promise.all(
      statuses.map((s) =>
        ctx.db
          .query("outreach_messages")
          .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", s))
          .order("desc")
          .take(take),
      ),
    );
    return batches
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, take);
  },
});

export const insertDraft = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.optional(v.id("outreach_inboxes")),
    opportunityId: v.id("seo_authority_opportunities"),
    toEmail: v.string(),
    toDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    status: v.string(),
    sequenceStep: v.number(),
    threadKey: v.string(),
    complianceIssues: v.optional(v.array(v.string())),
    blockedReason: v.optional(v.string()),
    pacingReason: v.optional(v.string()),
    pacingVersion: v.optional(v.number()),
    inboxConfigurationVersion: v.optional(v.number()),
    opportunityEvidenceHash: v.optional(v.string()),
    opportunitySourceUrl: v.optional(v.string()),
    opportunityTargetUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [site, opportunity] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.opportunityId),
    ]);
    if (!siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    if (!opportunity || opportunity.siteId !== args.siteId) {
      throw new Error("Authority opportunity not found for site");
    }
    if (args.inboxId) {
      const inbox = await ctx.db.get(args.inboxId);
      if (!inbox || inbox.siteId !== args.siteId) {
        throw new Error("Inbox not found for site");
      }
      if (
        args.inboxConfigurationVersion !== undefined &&
        args.inboxConfigurationVersion !== (inbox.configurationVersion ?? 0)
      ) {
        throw new Error("The draft sender profile changed before it was stored");
      }
    }
    // A message that is queued or already delivered is untouchable.
    const LIVE = [
      "draft",
      "approved",
      "sending",
      "delivery_unverified",
      "delivery_reviewed_sent",
      "sent",
      "replied",
    ];
    const now = Date.now();

    const [sameOpportunity, sameThread] = await Promise.all([
      ctx.db
        .query("outreach_messages")
        .withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId))
        .collect(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_thread", (q) => q.eq("threadKey", args.threadKey))
        .collect(),
    ]);

    // One live message per opportunity: re-running discovery must not queue
    // the same email twice.
    const liveForOpportunity = sameOpportunity.find((m) => LIVE.includes(m.status));
    if (liveForOpportunity) {
      const refreshesStaleDraft =
        liveForOpportunity.status === "draft" &&
        liveForOpportunity.inboxConfigurationVersion !==
          args.inboxConfigurationVersion;
      if (refreshesStaleDraft) {
        await ctx.db.patch(liveForOpportunity._id, {
          ...args,
          approvedAt: undefined,
          approvedInboxId: undefined,
          approvedInboxConfigurationVersion: undefined,
          updatedAt: now,
        });
        return {
          messageId: liveForOpportunity._id,
          status: args.status,
          alreadyExisted: true,
        };
      }
      return {
        messageId: liveForOpportunity._id,
        status: liveForOpportunity.status,
        alreadyExisted: true,
      };
    }

    // And one live thread per recipient domain. Two opportunities on the same
    // site are two reasons to write, not two emails: sending both is the
    // behaviour that gets a sender marked as spam. A second opportunity is
    // still recorded, but held blocked behind the one already in flight.
    const liveForThread = sameThread.find(
      (m) => LIVE.includes(m.status) && m.opportunityId !== args.opportunityId,
    );
    const heldBehindThread = Boolean(liveForThread) && args.status !== "blocked";

    const record = {
      ...args,
      toEmail: args.toEmail.trim().toLowerCase(),
      toDomain: normalizeDomain(args.toDomain),
      status: heldBehindThread ? "blocked" : args.status,
      blockedReason: heldBehindThread
        ? `Another message to ${normalizeDomain(args.toDomain)} is already in flight.`
        : args.blockedReason,
      // Written explicitly so a refreshed message clears a stale issue list
      // rather than keeping one it no longer has.
      complianceIssues: args.complianceIssues,
    };

    // A previously blocked message is refreshed in place. That is what lets a
    // tenant connect an inbox, re-run, and see the same message become
    // sendable instead of accumulating a second blocked row per attempt.
    const blocked = sameOpportunity.find((m) => m.status === "blocked");
    if (blocked) {
      await ctx.db.patch(blocked._id, { ...record, updatedAt: now });
      return { messageId: blocked._id, status: record.status, alreadyExisted: true };
    }

    const messageId = await ctx.db.insert("outreach_messages", {
      ...record,
      createdAt: now,
      updatedAt: now,
    });
    return { messageId, status: record.status, alreadyExisted: false };
  },
});

export const approveMessage = mutation({
  args: { siteId: v.id("sites"), messageId: v.id("outreach_messages") },
  handler: async (ctx, { siteId, messageId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (!siteExecutionActive(site)) {
      throw new Error("This site is parked outside the current plan allowance");
    }
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    if (message.status !== "draft") {
      throw new Error(`Only a draft can be approved (status is "${message.status}")`);
    }
    if ((message.complianceIssues ?? []).length > 0) {
      throw new Error("Message cannot be approved while compliance issues remain");
    }
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) {
      throw new Error("Exactly one outreach inbox must be connected before approval");
    }
    const inbox = inboxes[0];
    const configurationVersion = inbox.configurationVersion ?? 0;
    if (
      message.inboxId !== inbox._id ||
      message.inboxConfigurationVersion === undefined ||
      message.inboxConfigurationVersion !== configurationVersion
    ) {
      throw new Error("The draft uses a stale sender profile; regenerate it before approval");
    }
    const complianceIssues = outreachComplianceIssues({
      body: message.body,
      toEmail: message.toEmail,
      fromEmail: inbox.fromEmail,
      physicalMailingAddress: inbox.physicalMailingAddress,
    });
    if (complianceIssues.length > 0) {
      throw new Error("The draft no longer passes the current sender compliance profile");
    }
    const approvedAt = Date.now();
    await ctx.db.patch(messageId, {
      status: "approved",
      approvedAt,
      approvedInboxId: inbox._id,
      approvedInboxConfigurationVersion: configurationVersion,
      updatedAt: approvedAt,
    });
    return { status: "approved" };
  },
});

export const discardMessage = mutation({
  args: { siteId: v.id("sites"), messageId: v.id("outreach_messages") },
  handler: async (ctx, { siteId, messageId }) => {
    await requireSiteOwner(ctx, siteId);
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    if (message.sentAt) throw new Error("A sent message cannot be discarded");
    if (["sending", "delivery_unverified"].includes(message.status)) {
      throw new Error(
        "A message cannot be discarded while delivery is in progress or awaiting manual review",
      );
    }
    await ctx.db.patch(messageId, { status: "skipped", updatedAt: Date.now() });
    return { status: "skipped" };
  },
});

const dnsEvidenceValidator = v.object({
  senderDomain: v.string(),
  dkimSelector: v.string(),
  checkedAt: v.number(),
  spf: v.boolean(),
  dkim: v.boolean(),
  dmarc: v.boolean(),
});

const liveOpportunityEvidenceValidator = v.object({
  messageId: v.id("outreach_messages"),
  opportunityId: v.id("seo_authority_opportunities"),
  evidenceHash: v.string(),
  checkedAt: v.number(),
  contactEmail: v.string(),
  contactReceiptUrl: v.string(),
  contactCheckedAt: v.number(),
  targetReceiptUrl: v.optional(v.string()),
  targetCheckedAt: v.optional(v.number()),
});

const inboundRelayBindingValidator = v.object({
  aliasAddress: v.string(),
  aliasHash: v.string(),
  aliasDomain: v.string(),
  outboundRfcMessageId: v.string(),
  dsnRoutingTargetHash: v.string(),
  dsnRoutingTargetVersion: v.number(),
  dsnRoutingTargetGeneration: v.number(),
});

/**
 * Atomically select and lease one approved message.
 *
 * Convex mutations are serializable. The `approved` -> `sending` transition is
 * therefore the idempotency boundary: two concurrent owner actions cannot
 * both receive the same message, and a tenant can have at most one claim.
 */
export const claimApprovedDelivery = internalMutation({
  args: {
    siteId: v.id("sites"),
    attemptId: v.string(),
    release: v.literal("approved"),
    dnsEvidence: dnsEvidenceValidator,
    opportunityEvidence: liveOpportunityEvidenceValidator,
    inboundRelay: v.optional(inboundRelayBindingValidator),
  },
  handler: async (
    ctx,
    {
      siteId,
      attemptId,
      release,
      dnsEvidence,
      opportunityEvidence,
      inboundRelay,
    },
  ) => {
    const now = Date.now();
    if (!/^[a-z0-9-]{20,100}$/i.test(attemptId)) {
      throw new Error("Delivery attempt identifier is invalid");
    }

    const unresolved = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified"),
      )
      .first();
    if (unresolved) {
      return {
        claimed: false as const,
        reason: "A previous Gmail delivery has an unverified outcome and requires manual review.",
      };
    }

    const inFlight = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "sending"))
      .take(2);
    if (inFlight.length > 0) {
      const expired = inFlight.find(
        (message) =>
          deliveryLeaseState({
            status: message.status,
            leaseExpiresAt: message.deliveryLeaseExpiresAt,
            attemptId: message.deliveryAttemptId,
            now,
          }) === "expired_unverified",
      );
      if (expired) {
        await ctx.db.patch(expired._id, {
          status: "delivery_unverified",
          deliveryLeaseExpiredAt: now,
          failureReason:
            "The delivery lease expired without a verified Gmail receipt. Manual review is required; this message will not be retried automatically.",
          updatedAt: now,
        });
        return {
          claimed: false as const,
          reason: "A delivery lease expired without a verified receipt; manual review is required.",
        };
      }
      return {
        claimed: false as const,
        reason: "Another outreach delivery is already in progress for this tenant.",
      };
    }

    const [site, inboxes] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(2),
    ]);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return {
        claimed: false as const,
        reason: "Tenant is unavailable or parked outside the current plan allowance.",
      };
    }
    if (inboxes.length !== 1) {
      return {
        claimed: false as const,
        reason: "Exactly one outreach inbox must be connected for this tenant.",
      };
    }
    const inbox = inboxes[0];
    if (release !== "approved" || !["approval", "live"].includes(inbox.mode)) {
      return {
        claimed: false as const,
        reason: "This delivery was not released through the current owner-approved mode.",
      };
    }

    const configuredRelayDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    const relayIsConfigured = inboundRelayConfigured(inboundRelayRuntimeConfig());
    const legacyGmailReadReady = Boolean(
      inbox.provider === "gmail" &&
      inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) &&
      (inbox.oauthRefreshToken || inbox.oauthAccessToken),
    );
    if (!inboundRelay && !legacyGmailReadReady) {
      return {
        claimed: false as const,
        reason:
          "The signed inbound relay is unavailable, so replies and opt-outs cannot be handled safely.",
      };
    }
    if (inboundRelay) {
      const aliasDomain = normalizeInboundRelayDomain(inboundRelay.aliasDomain);
      const aliasAddress = inboundRelay.aliasAddress.trim().toLowerCase();
      const outboundMessageId = normalizeRfcMessageId(
        inboundRelay.outboundRfcMessageId,
      );
      const expectedDsnRoutingTarget = await inboundRelayDsnRoutingTarget({
        siteId: String(siteId),
        inboxId: String(inbox._id),
        generation:
          inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
        relayDomain: configuredRelayDomain ?? undefined,
        secret: inboundRelayRuntimeConfig().dsnTargetSecret,
      });
      if (
        !relayIsConfigured ||
        !configuredRelayDomain ||
        aliasDomain !== configuredRelayDomain ||
        !aliasAddress.endsWith(`@${configuredRelayDomain}`) ||
        !/^reply-[a-z0-9_-]{32,64}@[a-z0-9.-]+$/i.test(aliasAddress) ||
        inboundRelayAliasHash(aliasAddress) !== inboundRelay.aliasHash ||
        !/^[a-f0-9]{64}$/.test(inboundRelay.aliasHash) ||
        !expectedDsnRoutingTarget ||
        inboundRelay.dsnRoutingTargetHash !==
          expectedDsnRoutingTarget.hash ||
        inboundRelay.dsnRoutingTargetVersion !==
          expectedDsnRoutingTarget.version ||
        inboundRelay.dsnRoutingTargetHash !==
          inbox.inboundRelayDsnRoutingTargetHash ||
        inboundRelay.dsnRoutingTargetVersion !==
          OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
        inboundRelay.dsnRoutingTargetVersion !==
          inbox.inboundRelayDsnRoutingTargetVersion ||
        inboundRelay.dsnRoutingTargetGeneration !==
          (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
        !outboundMessageId ||
        !outboundMessageId.endsWith(
          `@${normalizeDomain(inbox.senderDomain ?? "")}>`,
        ) ||
        !inboundRelayDsnRoutingReady({
          inbox,
          now,
          rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
          runtimeConfig: inboundRelayRuntimeConfig(),
        })
      ) {
        return {
          claimed: false as const,
          reason:
            "The signed inbound relay binding or hard-bounce routing canary is invalid or unavailable.",
        };
      }
    }

    const senderIssues = senderClaimIssues({
      siteDomain: site.domain,
      provider: inbox.provider,
      status: inbox.status,
      fromEmail: inbox.fromEmail,
      fromName: inbox.fromName,
      physicalMailingAddress: inbox.physicalMailingAddress,
      complianceConfirmedAt: inbox.complianceConfirmedAt,
      verifiedAt: inbox.verifiedAt,
      oauthScopes: inbox.oauthScopes,
      hasCredential: Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken),
      senderDomain: inbox.senderDomain,
    });
    const dnsIssues = liveDnsEvidenceIssues({
      checkedAt: dnsEvidence.checkedAt,
      now,
      senderDomain: dnsEvidence.senderDomain,
      expectedSenderDomain: inbox.senderDomain,
      dkimSelector: dnsEvidence.dkimSelector,
      expectedDkimSelector: inbox.dkimSelector,
      spf: dnsEvidence.spf,
      dkim: dnsEvidence.dkim,
      dmarc: dnsEvidence.dmarc,
    });
    if (senderIssues.length > 0 || dnsIssues.length > 0) {
      await ctx.db.patch(inbox._id, {
        dnsCheckedAt: dnsEvidence.checkedAt,
        spfVerifiedAt: dnsEvidence.spf ? dnsEvidence.checkedAt : undefined,
        dkimVerifiedAt: dnsEvidence.dkim ? dnsEvidence.checkedAt : undefined,
        dmarcVerifiedAt: dnsEvidence.dmarc ? dnsEvidence.checkedAt : undefined,
        ...(dnsIssues.length > 0
          ? { status: "connected", mode: "approval", verifiedAt: undefined }
          : {}),
        lastError:
          dnsIssues[0] ?? senderIssues[0] ?? "The current sender is not ready.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The current sender or its live DNS evidence is not ready for delivery.",
      };
    }

    const pacing = outreachSendDecision({ inbox, now, release: "approved" });
    if (!pacing.allowed) return { claimed: false as const, reason: pacing.reason };

    const message = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "approved"))
      .order("asc")
      .first();
    if (!message) {
      return { claimed: false as const, reason: "No owner-approved message is ready." };
    }

    if (
      !approvalMatchesInbox({
        messageInboxId: message.inboxId,
        approvedInboxId: message.approvedInboxId,
        approvedInboxConfigurationVersion:
          message.approvedInboxConfigurationVersion,
        inboxId: inbox._id,
        inboxConfigurationVersion: inbox.configurationVersion,
      })
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The approved draft is bound to an older sender connection or compliance profile. Regenerate and approve a fresh draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved draft uses a stale sender profile and requires a fresh review.",
      };
    }

    const opportunity = await ctx.db.get(message.opportunityId);
    let targetPublicationMatches = opportunity?.type !== "broken_link";
    if (opportunity?.type === "broken_link" && opportunity.articleId) {
      const article = await ctx.db.get(opportunity.articleId);
      const target = article
        ? verifiedAuthorityTarget({ site, article, now })
        : null;
      try {
        targetPublicationMatches = Boolean(
          target &&
          target.targetUrl === opportunity.targetUrl &&
          opportunityEvidence.targetReceiptUrl &&
          canonicalPublicationUrl(opportunityEvidence.targetReceiptUrl) ===
            canonicalPublicationUrl(opportunity.targetUrl) &&
          Number.isFinite(opportunityEvidence.targetCheckedAt) &&
          opportunityEvidence.targetCheckedAt! <= now + 5_000 &&
          now - opportunityEvidence.targetCheckedAt! <=
            OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS,
        );
      } catch {
        targetPublicationMatches = false;
      }
    }
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      opportunity.status !== "outreach_prepared" ||
      !opportunityEvidenceIsFresh({ verifiedAt: opportunity.verifiedAt, now }) ||
      opportunityEvidence.messageId !== message._id ||
      opportunityEvidence.opportunityId !== opportunity._id ||
      !Number.isFinite(opportunityEvidence.checkedAt) ||
      opportunityEvidence.checkedAt > now + 5_000 ||
      now - opportunityEvidence.checkedAt >
        OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS ||
      opportunityEvidence.evidenceHash !== opportunity.evidenceHash ||
      !message.opportunityEvidenceHash ||
      message.opportunityEvidenceHash !== opportunity.evidenceHash ||
      message.opportunitySourceUrl !== opportunity.sourceUrl ||
      message.opportunityTargetUrl !== opportunity.targetUrl ||
      !targetPublicationMatches ||
      normalizeDomain(opportunity.sourceDomain) !== normalizeDomain(message.toDomain)
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The authority opportunity no longer matches verified tenant evidence. Regenerate and review the draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved message no longer has matching verified opportunity evidence.",
      };
    }

    const complianceIssues = outreachComplianceIssues({
      body: message.body,
      toEmail: message.toEmail,
      fromEmail: inbox.fromEmail,
      physicalMailingAddress: inbox.physicalMailingAddress,
    });
    if (complianceIssues.length > 0 || (message.complianceIssues ?? []).length > 0) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The approved message no longer passes the current delivery compliance checks.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved message requires a fresh compliance review.",
      };
    }

    const [suppressions, priorDomainMessages, contact] = await Promise.all([
      ctx.db
        .query("outreach_suppressions")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .collect(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_site_domain", (q) =>
          q.eq("siteId", siteId).eq("toDomain", message.toDomain),
        )
        .collect(),
      ctx.db
        .query("outreach_contacts")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", siteId).eq("email", message.toEmail),
        )
        .unique(),
    ]);
    if (
      !contact ||
      normalizeDomain(contact.domain) !== normalizeDomain(message.toDomain) ||
      !contact.discoveredFromUrl ||
      contact.email !== opportunityEvidence.contactEmail ||
      contact.discoveredFromUrl !== opportunityEvidence.contactReceiptUrl ||
      !Number.isFinite(opportunityEvidence.contactCheckedAt) ||
      opportunityEvidence.contactCheckedAt > now + 5_000 ||
      now - opportunityEvidence.contactCheckedAt >
        OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The recipient no longer has a matching observed contact receipt. Regenerate and review the draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The recipient contact evidence requires a fresh review.",
      };
    }
    const history = priorDomainMessages
      .filter(
        (row) =>
          ["sent", "delivery_reviewed_sent", "replied"].includes(row.status) &&
          row.sentAt,
      )
      .map((row) => ({ domain: row.toDomain, lastContactedAt: row.sentAt! }));
    const eligibility = contactEligibility({
      sourceDomain: message.toDomain,
      toEmail: message.toEmail,
      now,
      history,
      suppressedDomains: suppressions
        .filter((row) => row.kind === "domain")
        .map((row) => row.value),
      suppressedEmails: suppressions
        .filter((row) => row.kind === "email")
        .map((row) => row.value),
    });
    if (!eligibility.eligible) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason: eligibility.reason.slice(0, 500),
        updatedAt: now,
      });
      return { claimed: false as const, reason: eligibility.reason };
    }

    await ctx.db.patch(inbox._id, {
      dnsCheckedAt: dnsEvidence.checkedAt,
      spfVerifiedAt: dnsEvidence.checkedAt,
      dkimVerifiedAt: dnsEvidence.checkedAt,
      dmarcVerifiedAt: dnsEvidence.checkedAt,
      lastError: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(message._id, {
      status: "sending",
      deliveryAttemptId: attemptId,
      deliveryClaimedAt: now,
      deliveryLeaseExpiresAt: now + OUTREACH_DELIVERY_LEASE_MS,
      deliveryLeaseExpiredAt: undefined,
      failureReason: undefined,
      ...(inboundRelay
        ? {
            inboundRelayAliasHash: inboundRelay.aliasHash,
            inboundRelayAliasDomain: normalizeInboundRelayDomain(
              inboundRelay.aliasDomain,
            )!,
            inboundRelayOutboundMessageIdHash: inboundRelayMessageIdHash(
              inboundRelay.outboundRfcMessageId,
            ),
            inboundRelayRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
            inboundRelayInboxConfigurationVersion:
              inbox.configurationVersion ?? 0,
            inboundRelaySenderDomain: normalizeDomain(
              inbox.senderDomain ?? "",
            ),
            inboundRelayDsnRoutingTargetHash:
              inboundRelay.dsnRoutingTargetHash,
            inboundRelayDsnRoutingTargetVersion:
              inboundRelay.dsnRoutingTargetVersion,
            inboundRelayDsnRoutingTargetGeneration:
              inboundRelay.dsnRoutingTargetGeneration,
          }
        : {}),
      updatedAt: now,
    });
    return {
      claimed: true as const,
      attemptId,
      inbox,
      message,
      leaseExpiresAt: now + OUTREACH_DELIVERY_LEASE_MS,
    };
  },
});

export const getApprovedDeliveryEvidenceInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const message = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "approved")
      )
      .order("asc")
      .first();
    if (!message) return null;
    const opportunity = await ctx.db.get(message.opportunityId);
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      opportunity.status !== "outreach_prepared"
    ) {
      return null;
    }
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    let targetTitle: string | undefined;
    if (opportunity.type === "broken_link") {
      if (!opportunity.articleId) return null;
      const article = await ctx.db.get(opportunity.articleId);
      const target = article
        ? verifiedAuthorityTarget({ site, article, now: Date.now() })
        : null;
      if (!target || target.targetUrl !== opportunity.targetUrl) return null;
      targetTitle = target.title;
    }
    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", siteId).eq("email", message.toEmail),
      )
      .unique();
    if (!contact || !contact.discoveredFromUrl) return null;
    return {
      messageId: message._id,
      opportunityId: opportunity._id,
      sourceUrl: opportunity.sourceUrl,
      sourceDomain: opportunity.sourceDomain,
      type: opportunity.type,
      targetUrl: opportunity.targetUrl,
      context: opportunity.context,
      anchorText: opportunity.anchorText,
      targetTitle,
      toEmail: message.toEmail,
      contactDiscoveredFromUrl: contact.discoveredFromUrl,
    };
  },
});

export const completeDeliveryAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    providerMessageId: v.optional(v.string()),
    providerThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { siteId, messageId, attemptId, providerMessageId, providerThreadId },
  ) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    const now = Date.now();
    if (
      message.status !== "sending" ||
      message.deliveryAttemptId !== attemptId
    ) {
      return { recorded: false, reason: "Delivery attempt no longer owns this message." };
    }
    if ((message.deliveryLeaseExpiresAt ?? 0) <= now) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          "Gmail returned after the delivery lease expired. The outcome requires manual review and will not be retried automatically.",
        updatedAt: now,
      });
      return { recorded: false, reason: "Delivery lease expired before receipt finalization." };
    }
    const safeProviderMessageId = providerMessageId
      ?.replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 200);
    const safeProviderThreadId = providerThreadId
      ?.replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 200);
    if (!safeProviderMessageId) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          "Gmail did not return a valid delivery receipt. Manual review is required and the message will not be retried automatically.",
        updatedAt: now,
      });
      return { recorded: false, reason: "Gmail receipt was missing or invalid." };
    }
    await ctx.db.patch(messageId, {
      status: "sent",
      sentAt: now,
      providerMessageId: safeProviderMessageId,
      providerThreadId: safeProviderThreadId || undefined,
      updatedAt: now,
    });

    // The daily counter and its day key move together so a stale count can
    // never authorise tomorrow's sends.
    if (message.inboxId) {
      const inbox = await ctx.db.get(message.inboxId);
      if (inbox && inbox.siteId === siteId) {
        const today = utcDayKey(now);
        const current = inbox.sentTodayDay === today ? (inbox.sentToday ?? 0) : 0;
        await ctx.db.patch(inbox._id, {
          sentToday: current + 1,
          sentTodayDay: today,
          lastSentAt: now,
          status: inbox.status === "connected" ? "warming" : inbox.status,
          updatedAt: now,
        });
      }
    }

    const opportunity = await ctx.db.get(message.opportunityId);
    if (opportunity && opportunity.siteId === siteId) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: now,
        updatedAt: now,
      });
    }

    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", siteId).eq("email", message.toEmail),
      )
      .unique();
    if (contact) await ctx.db.patch(contact._id, { lastContactedAt: now, updatedAt: now });

    return { recorded: true };
  },
});

export const failDeliveryAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    reason: v.string(),
    bounced: v.optional(v.boolean()),
    unverified: v.optional(v.boolean()),
  },
  handler: async (ctx, { siteId, messageId, attemptId, reason, bounced, unverified }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    const now = Date.now();
    if (message.status !== "sending" || message.deliveryAttemptId !== attemptId) {
      return { recorded: false };
    }
    await ctx.db.patch(messageId, {
      status: unverified ? "delivery_unverified" : bounced ? "bounced" : "failed",
      failureReason: sanitizeDeliveryFailure(reason),
      bouncedAt: bounced ? now : undefined,
      deliveryLeaseExpiredAt: unverified ? now : undefined,
      updatedAt: now,
    });
    // A bounce is an address that must never be tried again.
    if (bounced) {
      await addSuppression(ctx, siteId, "email", message.toEmail, "bounce");
    }
    return { recorded: true };
  },
});

/**
 * Resolve an ambiguous provider outcome only after the tenant checks Gmail's
 * Sent folder. Neither resolution restores the same draft to `approved`.
 */
export const resolveUnverifiedDelivery = mutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    resolution: v.union(
      v.literal("confirmed_sent"),
      v.literal("confirmed_not_sent"),
    ),
  },
  handler: async (ctx, { siteId, messageId, resolution }) => {
    await requireSiteOwner(ctx, siteId);
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) {
      throw new Error("Message not found for site");
    }
    if (message.status !== "delivery_unverified") {
      throw new Error("Only an unverified delivery outcome can be reviewed");
    }
    const now = Date.now();
    if (resolution === "confirmed_not_sent") {
      await ctx.db.patch(messageId, {
        status: "failed",
        deliveryReviewedAt: now,
        deliveryReviewResolution: resolution,
        failureReason:
          "The tenant reviewed Gmail and confirmed that the message was not sent. Run a fresh authority scan before generating and approving a new draft.",
        updatedAt: now,
      });
      return { status: "failed" as const };
    }

    // This is deliberately not labelled as a provider-verified `sent` row.
    // It participates in cooldown and pacing because the tenant confirmed the
    // message in Gmail's Sent folder, while retaining the honest evidence gap.
    await ctx.db.patch(messageId, {
      status: "delivery_reviewed_sent",
      sentAt: message.deliveryClaimedAt ?? now,
      deliveryReviewedAt: now,
      deliveryReviewResolution: resolution,
      failureReason:
        "The tenant confirmed this message in Gmail's Sent folder; no provider receipt was captured by Pentra.",
      updatedAt: now,
    });
    if (message.inboxId) {
      const inbox = await ctx.db.get(message.inboxId);
      if (inbox && inbox.siteId === siteId) {
        const today = utcDayKey(now);
        const current = inbox.sentTodayDay === today ? (inbox.sentToday ?? 0) : 0;
        await ctx.db.patch(inbox._id, {
          sentToday: current + 1,
          sentTodayDay: today,
          lastSentAt: now,
          updatedAt: now,
        });
      }
    }
    const opportunity = await ctx.db.get(message.opportunityId);
    if (opportunity && opportunity.siteId === siteId) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: now,
        updatedAt: now,
      });
    }
    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", siteId).eq("email", message.toEmail),
      )
      .unique();
    if (contact) {
      await ctx.db.patch(contact._id, { lastContactedAt: now, updatedAt: now });
    }
    return { status: "delivery_reviewed_sent" as const };
  },
});

export const recordReply = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    unsubscribe: v.optional(v.boolean()),
  },
  handler: async () => {
    // Legacy callers supplied only booleans and could not prove which Gmail
    // message was observed. All automated inbound transitions now require the
    // leased, provider-bound, hashed receipt accepted by recordInboundReceipt.
    throw new Error(
      "Legacy reply recording is disabled; use the verified Gmail inbound sync",
    );
  },
});

// ── Signed receiving-only relay receipts ──

export const createInboundRelayDsnCanary = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    aliasHash: v.string(),
    outboundMessageIdHash: v.string(),
    testRecipientHash: v.string(),
    relayDomain: v.string(),
    senderDomain: v.string(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    relayConfigurationHash: v.string(),
    adapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    attemptId: v.string(),
    deliveryLeaseExpiresAt: v.number(),
    dnsEvidence: dnsEvidenceValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [site, inbox, existingCanaries] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
        .take(2),
    ]);
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const relayDomain = normalizeInboundRelayDomain(args.relayDomain);
    const expectedDsnRoutingTarget = await inboundRelayDsnRoutingTarget({
      siteId: String(args.siteId),
      inboxId: String(args.inboxId),
      generation: inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1,
      relayDomain: runtimeConfig.domain,
      secret: runtimeConfig.dsnTargetSecret,
    });
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      (site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch ||
      normalizeDomain(inbox.senderDomain ?? "") !==
        normalizeDomain(args.senderDomain) ||
      !configurationHash ||
      configurationHash !== args.relayConfigurationHash ||
      relayDomain !== normalizeInboundRelayDomain(runtimeConfig.domain) ||
      args.adapterVersion !== runtimeConfig.adapterVersion ||
      args.retentionPolicyHash !== runtimeConfig.retentionPolicyHash ||
      !expectedDsnRoutingTarget ||
      args.dsnRoutingTargetHash !== expectedDsnRoutingTarget.hash ||
      args.dsnRoutingTargetVersion !== expectedDsnRoutingTarget.version ||
      args.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      args.dsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.outboundMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.testRecipientHash) ||
      args.testRecipientHash === inboundRelayEmailHash(inbox.fromEmail) ||
      !Number.isSafeInteger(args.issuedAt) ||
      Math.abs(now - args.issuedAt) > 60_000 ||
      args.expiresAt - args.issuedAt !==
        OUTREACH_INBOUND_RELAY_CANARY_TTL_MS ||
      !/^[a-z0-9-]{20,100}$/i.test(args.attemptId) ||
      args.deliveryLeaseExpiresAt - args.issuedAt !==
        OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS ||
      existingCanaries.length > 1
    ) {
      throw new Error("Inbound relay canary crossed a tenant or configuration boundary");
    }
    const senderIssues = senderClaimIssues({
      siteDomain: site.domain,
      provider: inbox.provider,
      status: inbox.status,
      fromEmail: inbox.fromEmail,
      fromName: inbox.fromName,
      physicalMailingAddress: inbox.physicalMailingAddress,
      complianceConfirmedAt: inbox.complianceConfirmedAt,
      verifiedAt: inbox.verifiedAt,
      oauthScopes: inbox.oauthScopes,
      hasCredential: Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken),
      senderDomain: inbox.senderDomain,
    });
    const dnsIssues = liveDnsEvidenceIssues({
      checkedAt: args.dnsEvidence.checkedAt,
      now,
      senderDomain: args.dnsEvidence.senderDomain,
      expectedSenderDomain: inbox.senderDomain,
      dkimSelector: args.dnsEvidence.dkimSelector,
      expectedDkimSelector: inbox.dkimSelector,
      spf: args.dnsEvidence.spf,
      dkim: args.dnsEvidence.dkim,
      dmarc: args.dnsEvidence.dmarc,
    });
    const allowedScopes = new Set([
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    const grantedScopes = inbox.oauthScopes?.split(/\s+/).filter(Boolean) ?? [];
    if (
      senderIssues.length > 0 ||
      dnsIssues.length > 0 ||
      !grantedScopes.includes("https://www.googleapis.com/auth/gmail.send") ||
      !grantedScopes.every((scope) => allowedScopes.has(scope))
    ) {
      throw new Error("The Gmail sender is not ready for a routing canary");
    }
    const existing = existingCanaries[0];
    if (inboundRelayDsnRoutingReady({
      inbox,
      now,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      runtimeConfig,
    })) {
      throw new Error(
        "Bounce routing is already verified for the current inbox configuration",
      );
    }
    if (
      existing &&
      existing.issuedAt + OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS > now
    ) {
      throw new Error(
        "A Gmail routing canary has already been attempted for this inbox today",
      );
    }
    if (existing && !existing.verifiedAt && existing.expiresAt > now) {
      throw new Error("A current inbound relay canary challenge is already pending");
    }
    const record = {
      siteId: args.siteId,
      inboxId: args.inboxId,
      aliasHash: args.aliasHash,
      outboundMessageIdHash: args.outboundMessageIdHash,
      testRecipientHash: args.testRecipientHash,
      relayDomain: relayDomain!,
      senderDomain: normalizeDomain(args.senderDomain),
      rolloutEpoch: args.rolloutEpoch,
      inboxConfigurationVersion: args.inboxConfigurationVersion,
      relayConfigurationHash: args.relayConfigurationHash,
      adapterVersion: args.adapterVersion,
      retentionPolicyHash: args.retentionPolicyHash,
      dsnRoutingTargetHash: args.dsnRoutingTargetHash,
      dsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      dsnRoutingTargetGeneration: args.dsnRoutingTargetGeneration,
      issuedAt: args.issuedAt,
      expiresAt: args.expiresAt,
      deliveryStatus: "claimed",
      deliveryAttemptId: args.attemptId,
      deliveryClaimedAt: args.issuedAt,
      deliveryLeaseExpiresAt: args.deliveryLeaseExpiresAt,
      providerMessageIdHash: undefined,
      deliveryFinalizedAt: undefined,
      verifiedAt: undefined,
      eventKey: undefined,
      payloadHash: undefined,
      evidenceHash: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { canaryId: existing._id, created: false as const };
    }
    const canaryId = await ctx.db.insert(
      "outreach_inbound_relay_canaries",
      record,
    );
    return { canaryId, created: true as const };
  },
});

export const finalizeInboundRelayDsnCanaryDelivery = internalMutation({
  args: {
    canaryId: v.id("outreach_inbound_relay_canaries"),
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    inboxConfigurationVersion: v.number(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("unverified"),
      v.literal("failed"),
    ),
    providerMessageIdHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [canary, inbox] = await Promise.all([
      ctx.db.get(args.canaryId),
      ctx.db.get(args.inboxId),
    ]);
    if (
      canary?.verifiedAt &&
      canary.siteId === args.siteId &&
      canary.inboxId === args.inboxId &&
      canary.deliveryAttemptId === args.attemptId
    ) {
      return { recorded: false as const, dsnVerified: true as const };
    }
    if (
      !canary ||
      canary.siteId !== args.siteId ||
      canary.inboxId !== args.inboxId ||
      canary.deliveryStatus !== "claimed" ||
      canary.deliveryAttemptId !== args.attemptId ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      (args.outcome === "accepted") !==
        Boolean(args.providerMessageIdHash) ||
      (args.providerMessageIdHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerMessageIdHash))
    ) {
      throw new Error("Inbound relay canary delivery lost its exact claim");
    }
    await ctx.db.patch(canary._id, {
      deliveryStatus: args.outcome,
      deliveryLeaseExpiresAt: undefined,
      providerMessageIdHash: args.providerMessageIdHash,
      deliveryFinalizedAt: now,
      ...(args.outcome === "failed" ? { expiresAt: now } : {}),
    });
    return { recorded: true as const };
  },
});

export const getInboundRelayDsnCanaryCandidate = internalQuery({
  args: {
    aliasHash: v.string(),
    aliasDomain: v.string(),
  },
  handler: async (ctx, { aliasHash, aliasDomain }) => {
    const now = Date.now();
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const configuredDomain = normalizeInboundRelayDomain(runtimeConfig.domain);
    if (
      !configurationHash ||
      !configuredDomain ||
      normalizeInboundRelayDomain(aliasDomain) !== configuredDomain ||
      !/^[a-f0-9]{64}$/.test(aliasHash)
    ) return null;
    const canaries = await ctx.db
      .query("outreach_inbound_relay_canaries")
      .withIndex("by_alias_hash", (q) => q.eq("aliasHash", aliasHash))
      .take(2);
    if (canaries.length !== 1) return null;
    const canary = canaries[0];
    const [site, inbox] = await Promise.all([
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.inboxId),
    ]);
    if (
      canary.verifiedAt ||
      !["claimed", "accepted", "unverified"].includes(
        canary.deliveryStatus,
      ) ||
      canary.expiresAt <= now ||
      canary.relayDomain !== configuredDomain ||
      canary.relayConfigurationHash !== configurationHash ||
      canary.adapterVersion !== runtimeConfig.adapterVersion ||
      canary.retentionPolicyHash !== runtimeConfig.retentionPolicyHash ||
      canary.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      canary.dsnRoutingTargetGeneration !==
        (inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(canary.dsnRoutingTargetHash ?? "") ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      (site.autopilotRolloutEpoch ?? 0) !== canary.rolloutEpoch ||
      !inbox ||
      inbox.siteId !== canary.siteId ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !==
        canary.inboxConfigurationVersion ||
      normalizeDomain(inbox.senderDomain ?? "") !== canary.senderDomain
    ) return null;
    return {
      canaryId: canary._id,
      siteId: canary.siteId,
      inboxId: canary.inboxId,
      aliasHash: canary.aliasHash,
      aliasDomain: canary.relayDomain,
      testRecipientHash: canary.testRecipientHash,
      outboundRfcMessageIdHash: canary.outboundMessageIdHash,
      issuedAt: canary.issuedAt,
      expiresAt: canary.expiresAt,
      rolloutEpoch: canary.rolloutEpoch,
      inboxConfigurationVersion: canary.inboxConfigurationVersion,
      senderDomain: canary.senderDomain,
      relayConfigurationHash: canary.relayConfigurationHash,
      adapterVersion: canary.adapterVersion,
      retentionPolicyHash: canary.retentionPolicyHash,
      dsnRoutingTargetHash: canary.dsnRoutingTargetHash!,
      dsnRoutingTargetVersion: canary.dsnRoutingTargetVersion!,
      dsnRoutingTargetGeneration: canary.dsnRoutingTargetGeneration!,
    };
  },
});

/** The only operation that can seal bounce routing. Callers cannot attest to
 * readiness: they must present digests from a signed hard-DSN webhook bound to
 * the active one-time challenge. */
export const recordInboundRelayDsnCanaryReceipt = internalMutation({
  args: {
    canaryId: v.id("outreach_inbound_relay_canaries"),
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    aliasHash: v.string(),
    aliasDomain: v.string(),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    inboundMessageIdHash: v.string(),
    fromEmail: v.string(),
    receivedAt: v.number(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    senderDomain: v.string(),
    relayConfigurationHash: v.string(),
    adapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [canary, site, inbox] = await Promise.all([
      ctx.db.get(args.canaryId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (canary?.verifiedAt) {
      if (
        canary.eventKey === args.eventKey &&
        canary.payloadHash === args.payloadHash
      ) return { recorded: false as const, replay: true as const };
      throw new Error("Inbound relay canary was already sealed by different evidence");
    }
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const configuredDomain = normalizeInboundRelayDomain(runtimeConfig.domain);
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const expectedDsnRoutingTarget = inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(args.siteId),
          inboxId: String(args.inboxId),
          generation:
            inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: runtimeConfig.domain,
          secret: runtimeConfig.dsnTargetSecret,
        })
      : null;
    if (
      !canary ||
      canary.siteId !== args.siteId ||
      canary.inboxId !== args.inboxId ||
      canary.aliasHash !== args.aliasHash ||
      canary.relayDomain !== configuredDomain ||
      canary.relayDomain !== normalizeInboundRelayDomain(args.aliasDomain) ||
      canary.rolloutEpoch !== args.rolloutEpoch ||
      canary.inboxConfigurationVersion !== args.inboxConfigurationVersion ||
      canary.senderDomain !== normalizeDomain(args.senderDomain) ||
      canary.relayConfigurationHash !== args.relayConfigurationHash ||
      canary.adapterVersion !== args.adapterVersion ||
      canary.retentionPolicyHash !== args.retentionPolicyHash ||
      canary.dsnRoutingTargetHash !== args.dsnRoutingTargetHash ||
      canary.dsnRoutingTargetVersion !== args.dsnRoutingTargetVersion ||
      canary.dsnRoutingTargetGeneration !==
        args.dsnRoutingTargetGeneration ||
      !["claimed", "accepted", "unverified"].includes(
        canary.deliveryStatus,
      ) ||
      !configurationHash ||
      configurationHash !== args.relayConfigurationHash ||
      runtimeConfig.adapterVersion !== args.adapterVersion ||
      runtimeConfig.retentionPolicyHash !== args.retentionPolicyHash ||
      !expectedDsnRoutingTarget ||
      expectedDsnRoutingTarget.hash !== args.dsnRoutingTargetHash ||
      expectedDsnRoutingTarget.version !== args.dsnRoutingTargetVersion ||
      args.dsnRoutingTargetGeneration !==
        (inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      canary.expiresAt <= now ||
      args.receivedAt < canary.issuedAt - 60_000 ||
      args.receivedAt > canary.expiresAt ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      (site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      normalizeDomain(inbox.senderDomain ?? "") !== normalizeDomain(args.senderDomain) ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.eventKey) ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(args.inboundMessageIdHash) ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(fromEmail)
    ) {
      throw new Error("Inbound relay canary receipt crossed a tenant or configuration boundary");
    }
    await ctx.db.patch(canary._id, {
      verifiedAt: now,
      deliveryStatus: "dsn_verified",
      deliveryLeaseExpiresAt: undefined,
      eventKey: args.eventKey,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
    });
    await ctx.db.patch(inbox._id, {
      inboundRelayDsnRoutingVerifiedAt: now,
      inboundRelayDsnRoutingConfigurationVersion:
        args.inboxConfigurationVersion,
      inboundRelayDsnRoutingRolloutEpoch: args.rolloutEpoch,
      inboundRelayDsnRoutingSenderDomain: normalizeDomain(args.senderDomain),
      inboundRelayDsnRoutingRelayConfigurationHash:
        args.relayConfigurationHash,
      inboundRelayDsnRoutingEvidenceHash: args.evidenceHash,
      inboundRelayDsnRoutingAdapterVersion: args.adapterVersion,
      inboundRelayDsnRoutingRetentionPolicyHash: args.retentionPolicyHash,
      inboundRelayDsnRoutingTargetHash: args.dsnRoutingTargetHash,
      inboundRelayDsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      inboundRelayDsnRoutingTargetGeneration:
        args.dsnRoutingTargetGeneration,
      inboundLastCompletedAt: now,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true as const };
  },
});

const inboundRelayKindValidator = v.union(
  v.literal("reply"),
  v.literal("unsubscribe"),
  v.literal("bounce"),
  v.literal("ignored"),
);

const inboundRelayIgnoredReasons = new Set([
  "automatic_message",
  "invalid_sender",
  "missing_reply_proof",
  "recipient_mismatch",
  "sender_authentication_failed",
  "soft_or_invalid_dsn",
  "timestamp_mismatch",
]);

/** Resolve an unguessable per-message alias to one bodyless candidate. This
 * query is internal-only and returns no draft body or mailbox credential. */
export const getInboundRelayCandidate = internalQuery({
  args: {
    aliasHash: v.string(),
    aliasDomain: v.string(),
  },
  handler: async (ctx, { aliasHash, aliasDomain }) => {
    const configuredDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    if (
      !inboundRelayConfigured(inboundRelayRuntimeConfig()) ||
      !configuredDomain ||
      normalizeInboundRelayDomain(aliasDomain) !== configuredDomain ||
      !/^[a-f0-9]{64}$/.test(aliasHash)
    ) {
      return null;
    }
    const messages = await ctx.db
      .query("outreach_messages")
      .withIndex("by_relay_alias_hash", (q) =>
        q.eq("inboundRelayAliasHash", aliasHash)
      )
      .take(2);
    if (messages.length !== 1) return null;
    const message = messages[0];
    const settlementBoundaryAt =
      message.deliveryClaimedAt ?? message.sentAt;
    const chronologyAt = message.sentAt ?? message.deliveryClaimedAt;
    const [site, inbox] = await Promise.all([
      ctx.db.get(message.siteId),
      message.inboxId ? ctx.db.get(message.inboxId) : null,
    ]);
    if (
      !site ||
      !(await relaySettlementAuthorized(ctx, site, settlementBoundaryAt)) ||
      !inbox ||
      inbox.siteId !== message.siteId ||
      message.inboundRelayAliasDomain !== configuredDomain ||
      message.inboundRelayInboxConfigurationVersion === undefined ||
      message.inboundRelayRolloutEpoch === undefined ||
      !message.inboundRelaySenderDomain ||
      message.inboundRelaySenderDomain !==
        normalizeDomain(message.inboundRelaySenderDomain) ||
      !/^[a-f0-9]{64}$/.test(
        message.inboundRelayOutboundMessageIdHash ?? "",
      ) ||
      !/^[a-f0-9]{64}$/.test(
        message.inboundRelayDsnRoutingTargetHash ?? "",
      ) ||
      message.inboundRelayDsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      !Number.isSafeInteger(
        message.inboundRelayDsnRoutingTargetGeneration,
      ) ||
      ![
        "sending",
        "delivery_unverified",
        "sent",
        "delivery_reviewed_sent",
        "replied",
        "bounced",
      ].includes(
        message.status,
      )
    ) {
      return null;
    }
    if (
      message.status === "sending" &&
      (message.deliveryLeaseExpiresAt ?? 0) > Date.now()
    ) {
      return {
        state: "pending" as const,
        siteId: message.siteId,
        inboxId: inbox._id,
        messageId: message._id,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: chronologyAt!,
        outboundRfcMessageIdHash:
          message.inboundRelayOutboundMessageIdHash!,
        dsnRoutingTargetHash:
          message.inboundRelayDsnRoutingTargetHash!,
        dsnRoutingTargetVersion:
          message.inboundRelayDsnRoutingTargetVersion!,
        dsnRoutingTargetGeneration:
          message.inboundRelayDsnRoutingTargetGeneration!,
        aliasHash,
        aliasDomain: configuredDomain,
        rolloutEpoch: message.inboundRelayRolloutEpoch,
        inboxConfigurationVersion:
          message.inboundRelayInboxConfigurationVersion,
        senderDomain: message.inboundRelaySenderDomain,
      };
    }
    return {
      state:
        ["sending", "delivery_unverified"].includes(message.status)
          ? "ambiguous"
          : "settled",
      siteId: message.siteId,
      inboxId: inbox._id,
      messageId: message._id,
      toEmail: message.toEmail,
      toDomain: message.toDomain,
      sentAt: chronologyAt!,
      outboundRfcMessageIdHash:
        message.inboundRelayOutboundMessageIdHash!,
      dsnRoutingTargetHash: message.inboundRelayDsnRoutingTargetHash!,
      dsnRoutingTargetVersion:
        message.inboundRelayDsnRoutingTargetVersion!,
      dsnRoutingTargetGeneration:
        message.inboundRelayDsnRoutingTargetGeneration!,
      aliasHash,
      aliasDomain: configuredDomain,
      rolloutEpoch: message.inboundRelayRolloutEpoch,
      inboxConfigurationVersion:
        message.inboundRelayInboxConfigurationVersion,
      senderDomain: message.inboundRelaySenderDomain,
    };
  },
});

/** Atomically deduplicate and settle one signed relay event. The raw subject
 * and body never cross this mutation boundary. */
export const recordInboundRelayReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    aliasHash: v.string(),
    aliasDomain: v.string(),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    inboundMessageId: v.string(),
    outboundMessageIdHash: v.string(),
    kind: inboundRelayKindValidator,
    reason: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    receivedAt: v.number(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    senderDomain: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const priorEvent = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventKey))
      .unique();
    if (priorEvent) {
      if (priorEvent.payloadHash !== args.payloadHash) {
        throw new Error("Inbound relay event identifier was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }

    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    const configuredDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    if (
      !inboundRelayConfigured(inboundRelayRuntimeConfig()) ||
      !configuredDomain ||
      normalizeInboundRelayDomain(args.aliasDomain) !== configuredDomain ||
      !site ||
      !(await relaySettlementAuthorized(
        ctx,
        site,
        message?.deliveryClaimedAt ?? message?.sentAt,
      )) ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      ![
        "delivery_unverified",
        "sent",
        "delivery_reviewed_sent",
        "replied",
        "bounced",
      ].includes(
        message.status,
      ) && !(
        message.status === "sending" &&
        (message.deliveryLeaseExpiresAt ?? 0) <= now
      ) ||
      message.inboundRelayAliasHash !== args.aliasHash ||
      message.inboundRelayAliasDomain !== configuredDomain ||
      message.inboundRelayOutboundMessageIdHash !==
        args.outboundMessageIdHash ||
      message.inboundRelayRolloutEpoch !== args.rolloutEpoch ||
      message.inboundRelayInboxConfigurationVersion !==
        args.inboxConfigurationVersion ||
      message.inboundRelaySenderDomain !== normalizeDomain(args.senderDomain) ||
      message.inboundRelayDsnRoutingTargetHash !==
        args.dsnRoutingTargetHash ||
      message.inboundRelayDsnRoutingTargetVersion !==
        args.dsnRoutingTargetVersion ||
      message.inboundRelayDsnRoutingTargetGeneration !==
        args.dsnRoutingTargetGeneration ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.eventKey) ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(args.outboundMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.dsnRoutingTargetHash) ||
      args.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      !Number.isSafeInteger(args.dsnRoutingTargetGeneration) ||
      !normalizeRfcMessageId(args.inboundMessageId) ||
      !Number.isSafeInteger(args.receivedAt) ||
      args.receivedAt <
        (message.sentAt ?? message.deliveryClaimedAt ?? 0) - 60_000 ||
      args.receivedAt > now + 5 * 60 * 1000 ||
      (args.kind === "ignored" &&
        (!args.reason || !inboundRelayIgnoredReasons.has(args.reason))) ||
      (args.kind !== "ignored" && args.reason !== undefined)
    ) {
      throw new Error("Inbound relay receipt crossed a tenant or delivery boundary");
    }

    const normalizedFrom = args.fromEmail?.trim().toLowerCase();
    if (
      normalizedFrom &&
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(normalizedFrom)
    ) {
      throw new Error("Inbound relay sender is invalid");
    }
    if (args.kind !== "ignored" && !normalizedFrom) {
      throw new Error("A classified inbound relay receipt requires a sender");
    }
    if (
      args.kind === "unsubscribe" &&
      normalizedFrom !== message.toEmail.trim().toLowerCase()
    ) {
      throw new Error("Only the exact recipient can issue a permanent opt-out");
    }

    // Ignored/ambiguous mail has no state transition and is intentionally not
    // persisted. A leaked alias therefore cannot create unbounded audit rows.
    // The five-minute signed-envelope window remains the retry bound.
    if (args.kind === "ignored") {
      return { recorded: false as const, ignored: true as const };
    }

    const priorMessageReceipt = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_message_inbound_id", (q) =>
        q.eq("messageId", args.messageId).eq(
          "inboundMessageId",
          normalizeRfcMessageId(args.inboundMessageId),
        )
      )
      .unique();
    if (priorMessageReceipt) {
      if (priorMessageReceipt.payloadHash !== args.payloadHash) {
        throw new Error("Inbound message identifier was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }

    const priorKinds = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_site_message", (q) =>
        q.eq("siteId", args.siteId).eq("messageId", args.messageId)
      )
      .take(4);
    if (priorKinds.some((receipt) => receipt.kind === args.kind)) {
      return { recorded: false as const, duplicateKind: true as const };
    }

    const inboundProvesAmbiguousDelivery = [
      "sending",
      "delivery_unverified",
    ].includes(message.status);
    if (inboundProvesAmbiguousDelivery) {
      const deliveredAt = message.deliveryClaimedAt ?? args.receivedAt;
      const today = utcDayKey(now);
      const current = inbox.sentTodayDay === today ? (inbox.sentToday ?? 0) : 0;
      await ctx.db.patch(inbox._id, {
        ...(utcDayKey(deliveredAt) === today
          ? { sentToday: current + 1, sentTodayDay: today }
          : {}),
        lastSentAt: Math.max(inbox.lastSentAt ?? 0, deliveredAt),
        status: inbox.status === "connected" ? "warming" : inbox.status,
        updatedAt: now,
      });
      const opportunity = await ctx.db.get(message.opportunityId);
      if (opportunity && opportunity.siteId === args.siteId) {
        await ctx.db.patch(opportunity._id, {
          status: "contacted",
          contactedAt: deliveredAt,
          updatedAt: now,
        });
      }
      const contact = await ctx.db
        .query("outreach_contacts")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", args.siteId).eq("email", message.toEmail)
        )
        .unique();
      if (contact) {
        await ctx.db.patch(contact._id, {
          lastContactedAt: deliveredAt,
          updatedAt: now,
        });
      }
      await ctx.db.patch(message._id, {
        status: "delivery_reviewed_sent",
        sentAt: deliveredAt,
        deliveryReviewedAt: now,
        deliveryReviewResolution: "inbound_relay_proof",
        failureReason:
          "An authenticated inbound relay receipt proved delivery after Gmail's direct receipt was ambiguous.",
        updatedAt: now,
      });
    }

    {
      const shouldPromote = shouldPromoteOutreachInbound({
        existingKind: message.inboundReceiptKind as
          | "reply"
          | "unsubscribe"
          | "bounce"
          | undefined,
        existingAt: message.inboundReceiptAt,
        nextKind: args.kind,
        nextAt: args.receivedAt,
      });
      if (args.kind === "unsubscribe") {
        await addSuppression(ctx, args.siteId, "domain", message.toDomain, "unsubscribe");
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "unsubscribe");
      } else if (args.kind === "bounce") {
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "bounce");
      }
      await ctx.db.patch(message._id, {
        inboundCheckedAt: now,
        ...(shouldPromote
          ? {
              status: args.kind === "bounce" ? "bounced" : "replied",
              repliedAt:
                args.kind === "bounce" ? message.repliedAt : args.receivedAt,
              bouncedAt:
                args.kind === "bounce" ? args.receivedAt : message.bouncedAt,
              inboundReceiptHash: args.evidenceHash,
              inboundReceiptKind: args.kind,
              inboundReceiptAt: args.receivedAt,
              inboundReceiptFrom: normalizedFrom,
            }
          : {}),
        updatedAt: now,
      });
    }

    await ctx.db.insert("outreach_inbound_relay_receipts", {
      siteId: args.siteId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      eventKey: args.eventKey,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
      aliasHash: args.aliasHash,
      inboundMessageId: normalizeRfcMessageId(args.inboundMessageId),
      outboundMessageIdHash: args.outboundMessageIdHash,
      kind: args.kind,
      reason: undefined,
      fromEmail: normalizedFrom,
      receivedAt: args.receivedAt,
      rolloutEpoch: args.rolloutEpoch,
      inboxConfigurationVersion: args.inboxConfigurationVersion,
      senderDomain: normalizeDomain(args.senderDomain),
      dsnRoutingTargetHash: args.dsnRoutingTargetHash,
      dsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      dsnRoutingTargetGeneration: args.dsnRoutingTargetGeneration,
      processedAt: now,
    });
    await ctx.db.patch(inbox._id, {
      inboundLastCompletedAt: now,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true as const, kind: args.kind };
  },
});

// ── Legacy Gmail readonly inbound receipts ──

const inboundKindValidator = v.union(
  v.literal("reply"),
  v.literal("unsubscribe"),
  v.literal("bounce"),
);

function validProviderReceiptId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,200}$/.test(value);
}

/**
 * Atomically lease a bounded Gmail inbox scan. This is the sole boundary that
 * releases a tenant credential to the Node action, and it re-reads canonical
 * account/site authorization before doing so.
 */
export const claimInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    attemptId: v.string(),
  },
  handler: async (ctx, { siteId, attemptId }) => {
    const now = Date.now();
    if (!/^[a-z0-9-]{20,100}$/i.test(attemptId)) {
      throw new Error("Inbound sync attempt identifier is invalid");
    }
    const site = await ctx.db.get(siteId);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { claimed: false as const, reason: "Tenant is unavailable." };
    }
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) {
      return { claimed: false as const, reason: "Exactly one outreach inbox is required." };
    }
    const inbox = inboxes[0];
    if (
      inbox.provider !== "gmail" ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
      ["disconnected", "suspended"].includes(inbox.status)
    ) {
      return {
        claimed: false as const,
        reason: "Reconnect Gmail with reply monitoring before syncing inbound mail.",
      };
    }
    if (
      inbox.inboundSyncLeaseId &&
      (inbox.inboundSyncLeaseExpiresAt ?? 0) > now
    ) {
      return { claimed: false as const, reason: "An inbound Gmail sync is already running." };
    }

    const policy = await outreachSettlementPolicy(ctx, site);
    if (policy.maximumDeliveryBoundaryAt === 0) {
      return { claimed: false as const, reason: "Tenant is unavailable." };
    }
    const [settleableRows, missingThreadRows] = await Promise.all([
      legacyUnboundMessages(ctx, inbox._id, {
        limit: 1,
        maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
      }),
      legacyUnboundMessagesMissingThread(
        ctx,
        inbox._id,
        policy.maximumDeliveryBoundaryAt,
      ),
    ]);
    if (
      !settleableRows[0] ||
      !policy.allows(
        settleableRows[0].deliveryClaimedAt ?? settleableRows[0].sentAt,
      )
    ) {
      return { claimed: false as const, reason: "No delivered outreach needs monitoring." };
    }
    const candidates = missingThreadRows
      .filter((message) => policy.allows(
        message.deliveryClaimedAt ?? message.sentAt,
      ))
      .map((message) => ({
        messageId: message._id,
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: message.sentAt!,
      }));
    const syncWindowStartedAt = inbox.inboundSyncWindowStartedAt ?? now;
    const searchAfter = Math.max(
      now - OUTREACH_INBOUND_LOOKBACK_MS,
      (inbox.inboundLastScannedAt ?? now - OUTREACH_INBOUND_LOOKBACK_MS) -
        OUTREACH_INBOUND_OVERLAP_MS,
    );
    await ctx.db.patch(inbox._id, {
      inboundSyncLeaseId: attemptId,
      inboundSyncLeaseExpiresAt: now + OUTREACH_INBOUND_LEASE_MS,
      inboundSyncWindowStartedAt: syncWindowStartedAt,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return {
      claimed: true as const,
      attemptId,
      inbox,
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      pageToken: inbox.inboundSyncPageToken,
      syncWindowStartedAt,
      searchAfter,
      candidates,
    };
  },
});

export const bindInboundProviderThread = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerMessageId: v.string(),
    providerThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    if (!(await relaySettlementAuthorized(
      ctx,
      site,
      message?.deliveryClaimedAt ?? message?.sentAt,
    ))) {
      throw new Error("Site not found");
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= Date.now() ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      message.inboundRelayAliasHash !== undefined ||
      message.providerMessageId !== args.providerMessageId ||
      !validProviderReceiptId(args.providerThreadId)
    ) {
      throw new Error("Inbound thread binding crossed a tenant or delivery boundary");
    }
    if (message.providerThreadId && message.providerThreadId !== args.providerThreadId) {
      throw new Error("Gmail thread identity changed for a sealed delivery receipt");
    }
    await ctx.db.patch(message._id, {
      providerThreadId: args.providerThreadId,
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

export const getInboundCandidatesForEvidence = internalQuery({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerThreadId: v.string(),
    failedRecipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const inbox = await ctx.db.get(args.inboxId);
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= Date.now() ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return [];
    }
    const byId = new Map<string, Doc<"outreach_messages">>();
    if (validProviderReceiptId(args.providerThreadId)) {
      const threaded = await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_provider_thread", (q) =>
          q.eq("siteId", args.siteId).eq("providerThreadId", args.providerThreadId)
        )
        .take(10);
      for (const message of threaded) byId.set(message._id, message);
    }
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return [...byId.values()]
      .filter(
        (message) =>
          Boolean(
            message.siteId === args.siteId &&
            message.inboxId === args.inboxId &&
            !message.inboundRelayAliasHash &&
            ["sent", "delivery_reviewed_sent", "replied", "bounced"].includes(
              message.status,
            ) &&
            (message.sentAt ?? 0) >= cutoff,
          ),
      )
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
      .slice(0, 20)
      .map((message) => ({
        messageId: message._id,
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: message.sentAt!,
      }));
  },
});

export const recordInboundReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerMessageId: v.string(),
    providerThreadId: v.string(),
    kind: inboundKindValidator,
    fromEmail: v.string(),
    receivedAt: v.number(),
    evidenceHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    if (!(await relaySettlementAuthorized(
      ctx,
      site,
      message?.deliveryClaimedAt ?? message?.sentAt,
    ))) {
      throw new Error("Site not found");
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= now ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false as const, reason: "inbound_lease_lost" as const };
    }
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      message.inboundRelayAliasHash !== undefined ||
      !["sent", "delivery_reviewed_sent", "replied", "bounced"].includes(message.status)
    ) {
      throw new Error("Inbound receipt crossed a tenant or delivery boundary");
    }
    const fromEmail = args.fromEmail.trim().toLowerCase();
    if (
      !validProviderReceiptId(args.providerMessageId) ||
      !validProviderReceiptId(args.providerThreadId) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(fromEmail) ||
      !Number.isFinite(args.receivedAt) ||
      args.receivedAt < (message.sentAt ?? 0) - 60_000 ||
      args.receivedAt > now + 5 * 60 * 1000
    ) {
      throw new Error("Inbound Gmail receipt is invalid");
    }
    if (args.kind === "unsubscribe" && fromEmail !== message.toEmail) {
      throw new Error("Only the exact recipient can issue a permanent opt-out");
    }
    if (
      message.providerThreadId &&
      args.kind !== "bounce" &&
      message.providerThreadId !== args.providerThreadId
    ) {
      throw new Error("Inbound reply does not belong to the sealed Gmail thread");
    }
    if (message.inboundReceiptProviderMessageId === args.providerMessageId) {
      return { recorded: false as const, reason: "already_recorded" as const };
    }

    const shouldPromote = shouldPromoteOutreachInbound({
      existingKind: message.inboundReceiptKind as
        | "reply"
        | "unsubscribe"
        | "bounce"
        | undefined,
      existingAt: message.inboundReceiptAt,
      nextKind: args.kind,
      nextAt: args.receivedAt,
    });
    if (args.kind === "unsubscribe") {
      await addSuppression(ctx, args.siteId, "domain", message.toDomain, "unsubscribe");
      await addSuppression(ctx, args.siteId, "email", message.toEmail, "unsubscribe");
    } else if (args.kind === "bounce") {
      await addSuppression(ctx, args.siteId, "email", message.toEmail, "bounce");
    }

    await ctx.db.patch(message._id, {
      ...(message.providerThreadId || args.kind === "bounce"
        ? {}
        : { providerThreadId: args.providerThreadId }),
      inboundCheckedAt: now,
      ...(shouldPromote
        ? {
            status: args.kind === "bounce" ? "bounced" : "replied",
            repliedAt: args.kind === "bounce" ? message.repliedAt : args.receivedAt,
            bouncedAt: args.kind === "bounce" ? args.receivedAt : message.bouncedAt,
            inboundReceiptProviderMessageId: args.providerMessageId,
            inboundReceiptHash: args.evidenceHash,
            inboundReceiptKind: args.kind,
            inboundReceiptAt: args.receivedAt,
            inboundReceiptFrom: fromEmail,
          }
        : {}),
      updatedAt: now,
    });
    return { recorded: true as const, kind: args.kind };
  },
});

export const completeInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    syncWindowStartedAt: v.number(),
    nextPageToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { recorded: false };
    }
    const now = Date.now();
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= now ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion ||
      inbox.inboundSyncWindowStartedAt !== args.syncWindowStartedAt
    ) {
      return { recorded: false };
    }
    const safePageToken = args.nextPageToken
      ?.replace(/[^a-zA-Z0-9_\-=]/g, "")
      .slice(0, 500);
    await ctx.db.patch(inbox._id, {
      inboundSyncPageToken: safePageToken,
      inboundSyncWindowStartedAt: safePageToken
        ? args.syncWindowStartedAt
        : undefined,
      inboundLastScannedAt: safePageToken
        ? inbox.inboundLastScannedAt
        : args.syncWindowStartedAt,
      inboundLastCompletedAt: now,
      inboundSyncLeaseId: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true, complete: !safePageToken };
  },
});

export const failInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { recorded: false };
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    const allowed = new Set([
      "gmail_authorization_unavailable",
      "gmail_read_failed",
      "gmail_response_invalid",
      "inbound_sync_deadline",
      "inbound_receipt_failed",
    ]);
    await ctx.db.patch(inbox._id, {
      inboundSyncLeaseId: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundLastError: allowed.has(args.reason)
        ? args.reason
        : "gmail_read_failed",
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

// ── Suppression ──

async function addSuppression(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  kind: "domain" | "email",
  rawValue: string,
  reason: string,
) {
  const value =
    kind === "domain"
      ? normalizeDomain(rawValue)
      : String(rawValue || "").trim().toLowerCase();
  if (!value) return;
  const existing = await ctx.db
    .query("outreach_suppressions")
    .withIndex("by_site_value", (q) => q.eq("siteId", siteId).eq("value", value))
    .unique();
  if (!existing) {
    await ctx.db.insert("outreach_suppressions", {
      siteId,
      kind,
      value,
      reason,
      createdAt: Date.now(),
    });
  }

  // Suppression is not merely a claim-time guard. Remove every bounded pre-send
  // row that already targets the opted-out address/domain so the dashboard and
  // approval queue immediately reflect the permanent decision. A message that
  // already owns a sending lease is never mutated here.
  const queued = kind === "domain"
    ? await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_domain", (q) =>
          q.eq("siteId", siteId).eq("toDomain", value)
        )
        .take(200)
    : await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", siteId).eq("toEmail", value)
        )
        .take(200);
  const timestamp = Date.now();
  for (const message of queued) {
    if (!["draft", "blocked", "approved"].includes(message.status)) continue;
    await ctx.db.patch(message._id, {
      status: "skipped",
      blockedReason: `${value} is permanently suppressed (${reason}).`,
      updatedAt: timestamp,
    });
  }
}

export const suppress = mutation({
  args: {
    siteId: v.id("sites"),
    kind: v.string(),
    value: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, kind, value, reason }) => {
    await requireSiteOwner(ctx, siteId);
    if (kind !== "domain" && kind !== "email") {
      throw new Error(`Unsupported suppression kind "${kind}"`);
    }
    await addSuppression(ctx, siteId, kind, value, reason ?? "manual");
    return { suppressed: true };
  },
});

export const suppressInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    kind: v.string(),
    value: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { siteId, kind, value, reason }) => {
    if (kind !== "domain" && kind !== "email") {
      throw new Error(`Unsupported suppression kind "${kind}"`);
    }
    await addSuppression(ctx, siteId, kind, value, reason);
  },
});

export const listSuppressions = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    await requireSiteOwner(ctx, siteId);
    return ctx.db
      .query("outreach_suppressions")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 100, 500)));
  },
});

export const getSuppressionsInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const rows = await ctx.db
      .query("outreach_suppressions")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    return {
      domains: rows.filter((r) => r.kind === "domain").map((r) => r.value),
      emails: rows.filter((r) => r.kind === "email").map((r) => r.value),
    };
  },
});

// ── Contacts and prior-contact history ──

export const upsertContact = internalMutation({
  args: {
    siteId: v.id("sites"),
    domain: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    discoveredFromUrl: v.string(),
    discoveryMethod: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    const email = args.email.trim().toLowerCase();
    const domain = normalizeDomain(args.domain);
    const now = Date.now();
    const existing = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) => q.eq("siteId", args.siteId).eq("email", email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name ?? existing.name,
        role: args.role ?? existing.role,
        discoveredFromUrl: args.discoveredFromUrl,
        discoveryMethod: args.discoveryMethod,
        verifiedAt: now,
        updatedAt: now,
      });
      return { contactId: existing._id, created: false };
    }
    const contactId = await ctx.db.insert("outreach_contacts", {
      siteId: args.siteId,
      domain,
      email,
      name: args.name,
      role: args.role,
      discoveredFromUrl: args.discoveredFromUrl,
      discoveryMethod: args.discoveryMethod,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { contactId, created: true };
  },
});

/**
 * When each domain was last contacted for this tenant. Derived from actual
 * sent messages rather than a separate counter so the cooldown can never
 * disagree with the send log.
 */
export const getContactHistory = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return [];
    const cutoff = Date.now() - DOMAIN_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const sent = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "sent"))
      .collect();
    const reviewedSent = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_reviewed_sent"),
      )
      .collect();
    const replied = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "replied"))
      .collect();
    const latest = new Map<string, number>();
    for (const message of [...sent, ...reviewedSent, ...replied]) {
      const at = message.sentAt ?? 0;
      if (at < cutoff) continue;
      const current = latest.get(message.toDomain) ?? 0;
      if (at > current) latest.set(message.toDomain, at);
    }
    return Array.from(latest.entries()).map(([domain, lastContactedAt]) => ({
      domain,
      lastContactedAt,
    }));
  },
});
