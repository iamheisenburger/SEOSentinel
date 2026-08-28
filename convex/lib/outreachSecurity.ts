/**
 * Client-safe projection of an outreach inbox.
 *
 * A mailbox credential is the single most damaging thing this product stores:
 * it can send mail as the customer. The projection is therefore an explicit
 * allow-list rather than a deny-list, so a credential field added to the table
 * later cannot leak by default.
 */

import {
  DEFAULT_DAILY_SEND_CAP,
  utcDayKey,
  warmupDailyCap,
} from "./outreachPacing.ts";
import { autonomousOutreachConsentActive } from "./outreachAutonomy.ts";

export type StoredInbox = Record<string, unknown> | null | undefined;

export type InboundMonitoringMode =
  | "imap"
  | "signed_relay"
  | "legacy_gmail"
  | "unavailable";

/**
 * One fail-closed decision shared by the owner projection and both outreach
 * fleets. In particular, a verified SMTP inbox is not IMAP-ready unless its
 * encrypted credential envelope and exact TLS endpoint are still present.
 */
export function inboundMonitoringCapability(
  inbox: StoredInbox,
  options: {
    relayReady?: boolean;
    legacyDrainRequired?: boolean;
  } = {},
): {
  ready: boolean;
  mode: InboundMonitoringMode;
  imapReady: boolean;
  legacyGmailReadReady: boolean;
} {
  const active = Boolean(
    inbox && !["disconnected", "suspended"].includes(
      String(inbox.status ?? ""),
    ),
  );
  const encryptedSmtpCredentialReady = Boolean(
    inbox?.credentialCiphertext &&
      inbox.credentialKeyId &&
      inbox.credentialEncryptionVersion &&
      inbox.credentialBindingHash &&
      inbox.smtpPassword === undefined,
  );
  const imapReady = Boolean(
    active &&
      inbox?.provider === "smtp" &&
      encryptedSmtpCredentialReady &&
      inbox.imapVerifiedAt &&
      typeof inbox.imapHost === "string" &&
      inbox.imapHost.trim() &&
      inbox.imapPort === 993 &&
      typeof inbox.imapUsername === "string" &&
      inbox.imapUsername.trim(),
  );
  const legacyGmailReadReady = Boolean(
    active &&
      inbox?.provider === "gmail" &&
      String(inbox.oauthScopes ?? "")
        .split(/\s+/)
        .includes("https://www.googleapis.com/auth/gmail.readonly") &&
      (inbox.oauthRefreshToken || inbox.oauthAccessToken),
  );
  const relayReady = active && options.relayReady === true;
  const mode: InboundMonitoringMode = imapReady
    ? "imap"
    : options.legacyDrainRequired && legacyGmailReadReady
      ? "legacy_gmail"
      : relayReady
        ? "signed_relay"
        : legacyGmailReadReady
          ? "legacy_gmail"
          : "unavailable";
  return {
    ready: imapReady || relayReady || legacyGmailReadReady,
    mode,
    imapReady,
    legacyGmailReadReady,
  };
}

/** A disconnected identity is reusable only after its tenant is fully live
 * and has no unresolved external delivery boundary. Deletion keeps the
 * identity reserved until the inbox row itself is purged. */
export function outboundIdentityReservationActive(args: {
  inboxStatus?: string;
  siteExists: boolean;
  siteDeletionPending?: boolean;
  accountDeletionPending?: boolean;
  hasSendingDelivery?: boolean;
  hasUnverifiedDelivery?: boolean;
}): boolean {
  if (args.inboxStatus !== "disconnected") return true;
  return !args.siteExists ||
    Boolean(
      args.siteDeletionPending ||
        args.accountDeletionPending ||
        args.hasSendingDelivery ||
        args.hasUnverifiedDelivery,
    );
}

export function reconnectPacingState(args: {
  reconnectsSameMailbox: boolean;
  preservesSenderReputation: boolean;
  now: number;
  existingWarmupStartedAt?: number;
  existingSentToday?: number;
  existingSentTodayDay?: string;
  existingLastSentAt?: number;
}): {
  warmupStartedAt: number;
  sentToday: number;
  sentTodayDay: string;
  lastSentAt?: number;
} {
  if (!args.preservesSenderReputation) {
    return {
      warmupStartedAt: args.now,
      sentToday: 0,
      sentTodayDay: utcDayKey(args.now),
      lastSentAt: undefined,
    };
  }
  return {
    // Mailbox reputation is address-specific even when the sending domain's
    // aggregate cap/spacing must carry across aliases.
    warmupStartedAt: args.reconnectsSameMailbox
      ? args.existingWarmupStartedAt ?? args.now
      : args.now,
    sentToday:
      args.existingSentTodayDay === utcDayKey(args.now)
        ? args.existingSentToday ?? 0
        : 0,
    sentTodayDay: utcDayKey(args.now),
    lastSentAt: args.existingLastSentAt,
  };
}

export function resolveGmailReconnectProfile(args: {
  requestedFromName?: string;
  existingFromName?: string;
  physicalMailingAddress?: string;
  complianceConfirmedAt?: number;
}): { fromName?: string; complianceReady: boolean } {
  const requestedFromName = args.requestedFromName?.trim();
  const existingFromName = args.existingFromName?.trim();
  const fromName = requestedFromName || existingFromName || undefined;
  return {
    fromName,
    complianceReady: Boolean(
      fromName &&
      args.physicalMailingAddress?.trim() &&
      args.complianceConfirmedAt,
    ),
  };
}

export function sanitizeInboxForClient(
  inbox: StoredInbox,
  now: number,
  relayConfigured = false,
  relayDsnRoutingReady = false,
  legacyDrainRequired = false,
  relayDsnRoutingTargetAddress?: string,
  autonomousDeliveryReleaseAvailable = false,
  autonomousConsentOwnerId?: string,
  autonomousExecutionReady = false,
): Record<string, unknown> | null {
  if (!inbox) return null;
  const dailySendCap =
    typeof inbox.dailySendCap === "number" ? inbox.dailySendCap : DEFAULT_DAILY_SEND_CAP;
  const warmupStartedAt =
    typeof inbox.warmupStartedAt === "number" ? inbox.warmupStartedAt : undefined;
  const sentTodayDay = typeof inbox.sentTodayDay === "string" ? inbox.sentTodayDay : undefined;
  const oauthScopes = typeof inbox.oauthScopes === "string" ? inbox.oauthScopes : "";
  const credentialsPresent = Boolean(
    inbox.oauthAccessToken || inbox.oauthRefreshToken || inbox.smtpPassword ||
      inbox.credentialCiphertext || inbox.apiKey,
  );
  const relayReady = Boolean(
    relayConfigured &&
    relayDsnRoutingReady &&
    ["gmail", "smtp"].includes(String(inbox.provider ?? "")) &&
    !["disconnected", "suspended"].includes(String(inbox.status ?? "")),
  );
  const inboundCapability = inboundMonitoringCapability(inbox, {
    relayReady,
    legacyDrainRequired,
  });
  const safeDsnRoutingTarget = Boolean(
    ["gmail", "smtp"].includes(String(inbox.provider ?? "")) &&
    credentialsPresent &&
    !["disconnected", "suspended"].includes(String(inbox.status ?? "")) &&
    typeof relayDsnRoutingTargetAddress === "string" &&
    /^dsn-[a-f0-9]{48}@[a-z0-9.-]+$/i.test(relayDsnRoutingTargetAddress)
  )
    ? relayDsnRoutingTargetAddress!.toLowerCase()
    : undefined;
  const inboundMonitoringReady = inboundCapability.ready;
  const storedAutonomyConsentActive = autonomousOutreachConsentActive(
    inbox,
    autonomousConsentOwnerId,
  );

  return {
    _id: inbox._id,
    siteId: inbox.siteId,
    provider: inbox.provider,
    managedTransportKind: inbox.managedTransportKind,
    fromEmail: inbox.fromEmail,
    fromName: inbox.fromName,
    replyToEmail: inbox.replyToEmail,
    physicalMailingAddress: inbox.physicalMailingAddress,
    complianceConfirmedAt: inbox.complianceConfirmedAt,
    status: inbox.status,
    mode: inbox.mode,
    configurationVersion:
      typeof inbox.configurationVersion === "number"
        ? inbox.configurationVersion
        : 0,
    autonomousDeliveryReleaseAvailable,
    autonomousConsentActive: storedAutonomyConsentActive,
    autonomousDeliveryEnabled:
      autonomousDeliveryReleaseAvailable &&
      storedAutonomyConsentActive &&
      autonomousExecutionReady,
    autonomyConsentVersion: inbox.autonomyConsentVersion,
    autonomyConsentPolicyHash: inbox.autonomyConsentPolicyHash,
    autonomyConsentAcceptedAt: inbox.autonomyConsentAcceptedAt,
    dailySendCap,
    effectiveDailyCap: warmupDailyCap({ warmupStartedAt, now, targetCap: dailySendCap }),
    warmupStartedAt,
    // A counter from a previous day says nothing about today's headroom.
    sentToday:
      sentTodayDay === utcDayKey(now) && typeof inbox.sentToday === "number"
        ? inbox.sentToday
        : 0,
    verifiedAt: inbox.verifiedAt,
    imapVerifiedAt: inbox.imapVerifiedAt,
    imapLastPolledAt: inbox.imapLastPolledAt,
    imapNextPollAt: inbox.imapNextPollAt,
    imapLastError: inbox.imapLastError,
    senderDomain: inbox.senderDomain,
    dkimSelector: inbox.dkimSelector,
    dnsCheckedAt: inbox.dnsCheckedAt,
    spfVerifiedAt: inbox.spfVerifiedAt,
    dkimVerifiedAt: inbox.dkimVerifiedAt,
    dmarcVerifiedAt: inbox.dmarcVerifiedAt,
    lastError: inbox.lastError,
    inboundMonitoringReady,
    inboundRelayConfigured: relayConfigured,
    inboundRelayDsnRoutingReady: relayDsnRoutingReady,
    // This is a capability address and is returned only by the owner-scoped
    // inbox query. Its digest/version, never its plaintext, is persisted.
    inboundRelayDsnRoutingTargetAddress:
      safeDsnRoutingTarget,
    inboundRelayDsnRoutingTargetReady: Boolean(
      safeDsnRoutingTarget && relayDsnRoutingReady,
    ),
    inboundRelayDsnRoutingVerifiedAt:
      inbox.inboundRelayDsnRoutingVerifiedAt,
    inboundMonitoringMode: inboundCapability.mode,
    inboundLastScannedAt: inbox.inboundLastScannedAt,
    inboundLastCompletedAt: inbox.inboundLastCompletedAt,
    inboundLastError: inbox.inboundLastError,
    // The tenant needs to know a credential exists, never what it is.
    credentialsPresent,
  };
}
