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
): Record<string, unknown> | null {
  if (!inbox) return null;
  const dailySendCap =
    typeof inbox.dailySendCap === "number" ? inbox.dailySendCap : DEFAULT_DAILY_SEND_CAP;
  const warmupStartedAt =
    typeof inbox.warmupStartedAt === "number" ? inbox.warmupStartedAt : undefined;
  const sentTodayDay = typeof inbox.sentTodayDay === "string" ? inbox.sentTodayDay : undefined;
  const oauthScopes = typeof inbox.oauthScopes === "string" ? inbox.oauthScopes : "";
  const credentialsPresent = Boolean(
    inbox.oauthAccessToken || inbox.oauthRefreshToken || inbox.smtpPassword || inbox.apiKey,
  );
  const legacyGmailReadReady = Boolean(
    inbox.provider === "gmail" &&
    credentialsPresent &&
    !["disconnected", "suspended"].includes(String(inbox.status ?? "")) &&
    oauthScopes
      .split(/\s+/)
      .includes("https://www.googleapis.com/auth/gmail.readonly"),
  );
  const relayReady = Boolean(
    relayConfigured &&
    relayDsnRoutingReady &&
    inbox.provider === "gmail" &&
    !["disconnected", "suspended"].includes(String(inbox.status ?? "")),
  );
  const safeDsnRoutingTarget = Boolean(
    inbox.provider === "gmail" &&
    credentialsPresent &&
    !["disconnected", "suspended"].includes(String(inbox.status ?? "")) &&
    typeof relayDsnRoutingTargetAddress === "string" &&
    /^dsn-[a-f0-9]{48}@[a-z0-9.-]+$/i.test(relayDsnRoutingTargetAddress)
  )
    ? relayDsnRoutingTargetAddress!.toLowerCase()
    : undefined;
  const inboundMonitoringReady = relayReady || legacyGmailReadReady;

  return {
    _id: inbox._id,
    siteId: inbox.siteId,
    provider: inbox.provider,
    fromEmail: inbox.fromEmail,
    fromName: inbox.fromName,
    replyToEmail: inbox.replyToEmail,
    physicalMailingAddress: inbox.physicalMailingAddress,
    complianceConfirmedAt: inbox.complianceConfirmedAt,
    status: inbox.status,
    mode: inbox.mode,
    autonomousDeliveryReleaseAvailable,
    autonomousDeliveryEnabled:
      autonomousDeliveryReleaseAvailable &&
      autonomousOutreachConsentActive(inbox, autonomousConsentOwnerId),
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
    inboundMonitoringMode: legacyDrainRequired && legacyGmailReadReady
      ? "legacy_gmail"
      : relayReady
      ? "signed_relay"
      : legacyGmailReadReady
        ? "legacy_gmail"
        : "unavailable",
    inboundLastScannedAt: inbox.inboundLastScannedAt,
    inboundLastCompletedAt: inbox.inboundLastCompletedAt,
    inboundLastError: inbox.inboundLastError,
    // The tenant needs to know a credential exists, never what it is.
    credentialsPresent,
  };
}
