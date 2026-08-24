import { normalizeDomain, outreachSenderReadinessIssues } from "./outreachPacing.ts";

/** Long enough for one bounded Gmail request, short enough to surface uncertainty. */
export const OUTREACH_DELIVERY_LEASE_MS = 2 * 60 * 1000;

/** DNS is resolved immediately before the atomic claim, not trusted from OAuth day. */
export const OUTREACH_LIVE_DNS_EVIDENCE_MAX_AGE_MS = 60 * 1000;

/** A previously observed link opportunity cannot authorise an indefinite send. */
export const OUTREACH_OPPORTUNITY_EVIDENCE_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;

/** The source page is fetched immediately before the serializable send claim. */
export const OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS = 60 * 1000;
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_AUTONOMOUS_ALLOWED_SCOPES = new Set([
  GMAIL_SEND_SCOPE,
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
]);

export function autonomousGmailCredentialIssues(args: {
  oauthScopes?: string;
  hasRefreshToken: boolean;
}): string[] {
  const scopes = String(args.oauthScopes ?? "").split(/\s+/).filter(Boolean);
  const issues: string[] = [];
  if (
    !scopes.includes(GMAIL_SEND_SCOPE) ||
    !scopes.every((scope) => GMAIL_AUTONOMOUS_ALLOWED_SCOPES.has(scope))
  ) {
    issues.push(
      "Autonomous outreach requires the exact send-only Gmail authorization.",
    );
  }
  if (!args.hasRefreshToken) {
    issues.push(
      "Autonomous outreach requires durable offline Gmail access; reconnect the inbox.",
    );
  }
  return issues;
}

export type DeliveryLeaseState =
  | "available"
  | "in_flight"
  | "expired_unverified";

export type OutreachDeletionGateState =
  | "ready"
  | "in_flight"
  | "expired_unverified"
  | "manual_review";

export type OutreachDeletionGateDecision<MessageId extends string = string> = {
  state: OutreachDeletionGateState;
  expiredMessageIds: MessageId[];
};

export function deliveryLeaseState(args: {
  status: string;
  leaseExpiresAt?: number;
  attemptId?: string;
  now: number;
}): DeliveryLeaseState {
  if (args.status !== "sending") return "available";
  if (
    args.attemptId &&
    args.leaseExpiresAt &&
    args.leaseExpiresAt > args.now
  ) {
    return "in_flight";
  }
  return "expired_unverified";
}

/**
 * Decide whether tenant deletion can cross the Gmail delivery boundary.
 *
 * A live claim wins over every other state: the deletion transaction must do
 * nothing so the action can seal its provider receipt. Once all live claims
 * are gone, expired claims are surfaced as delivery_unverified and deletion
 * remains deferred until the owner records what happened in Gmail. This
 * deliberately has no branch that restores an expired message to approved.
 */
export function outreachDeletionGate<MessageId extends string>(args: {
  sending: Array<{
    messageId: MessageId;
    status: string;
    attemptId?: string;
    leaseExpiresAt?: number;
  }>;
  unresolvedDeliveryCount: number;
  now: number;
}): OutreachDeletionGateDecision<MessageId> {
  const states = args.sending.map((message) => ({
    messageId: message.messageId,
    state: deliveryLeaseState({
      status: message.status,
      attemptId: message.attemptId,
      leaseExpiresAt: message.leaseExpiresAt,
      now: args.now,
    }),
  }));
  if (states.some((message) => message.state === "in_flight")) {
    return { state: "in_flight", expiredMessageIds: [] };
  }
  const expiredMessageIds = states
    .filter((message) => message.state === "expired_unverified")
    .map((message) => message.messageId);
  if (expiredMessageIds.length > 0) {
    return { state: "expired_unverified", expiredMessageIds };
  }
  if (args.unresolvedDeliveryCount > 0) {
    return { state: "manual_review", expiredMessageIds: [] };
  }
  return { state: "ready", expiredMessageIds: [] };
}

export function approvalMatchesInbox(args: {
  messageInboxId?: string;
  approvedInboxId?: string;
  approvedInboxConfigurationVersion?: number;
  inboxId: string;
  inboxConfigurationVersion?: number;
}): boolean {
  return Boolean(
    args.messageInboxId === args.inboxId &&
      args.approvedInboxId === args.inboxId &&
      args.approvedInboxConfigurationVersion !== undefined &&
      args.approvedInboxConfigurationVersion ===
        (args.inboxConfigurationVersion ?? 0),
  );
}

export function opportunityEvidenceIsFresh(args: {
  verifiedAt?: number;
  now: number;
}): boolean {
  return Boolean(
    Number.isFinite(args.verifiedAt) &&
      args.verifiedAt! <= args.now + 5_000 &&
      args.now - args.verifiedAt! <=
        OUTREACH_OPPORTUNITY_EVIDENCE_MAX_AGE_MS,
  );
}

export function liveDnsEvidenceIssues(args: {
  checkedAt: number;
  now: number;
  senderDomain: string;
  expectedSenderDomain?: string;
  dkimSelector: string;
  expectedDkimSelector?: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
}): string[] {
  const issues: string[] = [];
  if (
    !Number.isFinite(args.checkedAt) ||
    args.checkedAt > args.now + 5_000 ||
    args.now - args.checkedAt > OUTREACH_LIVE_DNS_EVIDENCE_MAX_AGE_MS
  ) {
    issues.push("Live DNS evidence is missing or stale.");
  }
  if (
    normalizeDomain(args.senderDomain) !==
    normalizeDomain(args.expectedSenderDomain ?? "")
  ) {
    issues.push("Live DNS evidence does not match the current sender domain.");
  }
  if (
    args.dkimSelector.trim().toLowerCase() !==
    String(args.expectedDkimSelector ?? "").trim().toLowerCase()
  ) {
    issues.push("Live DNS evidence does not match the current DKIM selector.");
  }
  if (!args.spf || !args.dkim || !args.dmarc) {
    issues.push("SPF, DKIM and DMARC must all pass a live check before delivery.");
  }
  return issues;
}

export function senderClaimIssues(args: {
  siteDomain: string;
  provider: string;
  status: string;
  fromEmail: string;
  fromName?: string;
  physicalMailingAddress?: string;
  complianceConfirmedAt?: number;
  verifiedAt?: number;
  oauthScopes?: string;
  hasCredential: boolean;
  senderDomain?: string;
}): string[] {
  const issues = outreachSenderReadinessIssues({
    siteDomain: args.siteDomain,
    provider: args.provider,
    fromEmail: args.fromEmail,
  });
  const fromDomain = normalizeDomain(args.fromEmail.split("@")[1] ?? "");
  if (!args.senderDomain || normalizeDomain(args.senderDomain) !== fromDomain) {
    issues.push("The connected sender identity does not match its verified domain.");
  }
  if (!["warming", "active"].includes(args.status) || !args.verifiedAt) {
    issues.push("The current inbox is not verified for delivery.");
  }
  if (!args.fromName?.trim() || !args.physicalMailingAddress?.trim()) {
    issues.push("The current sender name and physical mailing address are required.");
  }
  if (!args.complianceConfirmedAt) {
    issues.push("The current sender compliance profile has not been confirmed.");
  }
  if (
    !args.oauthScopes
      ?.split(/\s+/)
      .includes("https://www.googleapis.com/auth/gmail.send") ||
    !args.hasCredential
  ) {
    issues.push("The current Gmail authorization cannot send mail.");
  }
  return issues;
}

/** Persist only stable operator-facing categories, never provider bodies/tokens. */
export function sanitizeDeliveryFailure(reason: unknown): string {
  const value = String(reason ?? "").toLowerCase();
  if (value.includes("header")) return "Message headers failed validation.";
  if (value.includes("token") || value.includes("credential") || value.includes("oauth")) {
    return "The Gmail authorization is unavailable; reconnect the inbox before review.";
  }
  const http = value.match(/http\s+(\d{3})/);
  if (http) return `Gmail delivery failed with HTTP ${http[1]}.`;
  if (value.includes("timeout") || value.includes("abort")) {
    return "Gmail did not confirm delivery before the request timeout; manual review is required.";
  }
  return "Gmail delivery failed without a verified receipt; manual review is required.";
}

/** Gmail can return a 5xx after accepting a request at an internal boundary.
 * Treat every server-side response as ambiguous: quarantine the exact claim
 * and require review instead of ever replaying it. */
export function gmailHttpFailureDisposition(status: number): {
  unverified: boolean;
  suspend: boolean;
} {
  return {
    unverified:
      [408, 409, 425, 429].includes(status) ||
      (Number.isInteger(status) && status >= 500 && status <= 599),
    suspend: status === 401 || status === 403,
  };
}
