import { sha256Hex } from "./publicationArtifact.ts";
import {
  emailAddressFromHeader,
  normalizeOutreachEmail,
  requestsOutreachOptOut,
  type OutreachInboundKind,
} from "./outreachInbound.ts";

export const OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES = 64 * 1024;
export const OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const OUTREACH_INBOUND_RELAY_VERSION = 1;
export const OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION = 1;
export const OUTREACH_INBOUND_RELAY_CANARY_TTL_MS = 30 * 60 * 1000;
export const OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS = 2 * 60 * 1000;
export const OUTREACH_INBOUND_RELAY_CANARY_VALID_MS = 30 * 24 * 60 * 60 * 1000;
// A hard-bounce probe intentionally sends to a controlled rejecting address.
// Keep a durable one-per-inbox daily boundary even after failure, ambiguity or
// configuration rotation so direct action calls cannot become a reputation or
// provider-cost escape hatch.
export const OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const EVENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,199}$/;
const ALIAS_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,64}$/;
const RFC_MESSAGE_ID_PATTERN = /^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{8,180}@[a-z0-9.-]{1,190}>$/i;

export type InboundRelayPayload = {
  version: 1;
  adapterVersion: string;
  retentionPolicyHash: string;
  eventId: string;
  receivedAt: number;
  recipient: string;
  from: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  subject: string;
  text: string;
  autoSubmitted?: string;
  authentication: {
    verdict: "pass";
    method: "dmarc" | "dkim" | "spf";
    alignedFrom: string;
  };
  dsn?: {
    action: "failed";
    status: string;
    finalRecipient: string;
    originalRecipient?: string;
    originalMessageId: string;
    routingRecipientHash: string;
    source: "message/delivery-status";
  };
};

export type InboundRelayCandidate = {
  messageId: string;
  toEmail: string;
  toDomain: string;
  sentAt: number;
  outboundRfcMessageIdHash: string;
  dsnRoutingTargetHash: string;
  dsnRoutingTargetVersion: number;
  dsnRoutingTargetGeneration: number;
};

export type InboundRelayCanaryCandidate = {
  testRecipientHash: string;
  outboundRfcMessageIdHash: string;
  issuedAt: number;
  expiresAt: number;
  dsnRoutingTargetHash: string;
  dsnRoutingTargetVersion: number;
  dsnRoutingTargetGeneration: number;
};

export type InboundRelayClassification =
  | { kind: OutreachInboundKind; fromEmail: string }
  | {
      kind: "ignored";
      reason:
        | "automatic_message"
        | "invalid_sender"
        | "missing_reply_proof"
        | "recipient_mismatch"
        | "sender_authentication_failed"
        | "soft_or_invalid_dsn"
        | "timestamp_mismatch";
      fromEmail?: string;
    };

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(
  value: unknown,
  maximum: number,
  options: { required?: boolean } = {},
): string | null {
  if (typeof value !== "string") return options.required ? null : "";
  if (value.length > maximum) return null;
  const result = value.trim();
  if (options.required && !result) return null;
  return result;
}

export function normalizeInboundRelayDomain(value: string | undefined): string | null {
  const domain = String(value ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (
    domain.length < 4 ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    return null;
  }
  return domain;
}

export function inboundRelayConfigured(args: {
  domain?: string;
  secrets?: Array<string | undefined>;
  dsnTargetSecret?: string;
  adapterVersion?: string;
  retentionPolicyHash?: string;
  retentionAudited?: string | boolean;
}): boolean {
  return Boolean(
    normalizeInboundRelayDomain(args.domain) &&
    args.secrets?.some((secret) => (secret?.trim().length ?? 0) >= 32) &&
    (args.dsnTargetSecret?.trim().length ?? 0) >= 32 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(
      String(args.adapterVersion ?? ""),
    ) &&
    /^[a-f0-9]{64}$/.test(String(args.retentionPolicyHash ?? "")) &&
    (args.retentionAudited === true || args.retentionAudited === "true"),
  );
}

/** A digest of every relay property whose rotation invalidates a canary. The
 * HMAC secrets themselves never cross the function boundary or enter the DB. */
export function inboundRelayConfigurationHash(args: {
  domain?: string;
  secrets?: Array<string | undefined>;
  dsnTargetSecret?: string;
  adapterVersion?: string;
  retentionPolicyHash?: string;
  retentionAudited?: string | boolean;
}): string | null {
  if (!inboundRelayConfigured(args)) return null;
  return sha256Hex(JSON.stringify({
    version: OUTREACH_INBOUND_RELAY_VERSION,
    dsnRoutingTargetVersion: OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
    domain: normalizeInboundRelayDomain(args.domain),
    secretDigests: (args.secrets ?? []).map((secret) =>
      secret?.trim() ? sha256Hex(secret.trim()) : ""
    ),
    dsnTargetSecretDigest: sha256Hex(args.dsnTargetSecret!.trim()),
    adapterVersion: args.adapterVersion,
    retentionPolicyHash: args.retentionPolicyHash,
  }));
}

export function inboundRelayDsnRoutingReady(args: {
  inbox: Record<string, unknown> | null | undefined;
  now: number;
  rolloutEpoch: number;
  runtimeConfig: Parameters<typeof inboundRelayConfigurationHash>[0];
}): boolean {
  const configurationHash = inboundRelayConfigurationHash(args.runtimeConfig);
  const inbox = args.inbox;
  const verifiedAt = Number(inbox?.inboundRelayDsnRoutingVerifiedAt);
  const senderDomain = normalizeInboundRelayDomain(
    typeof inbox?.senderDomain === "string" ? inbox.senderDomain : undefined,
  );
  return Boolean(
    inbox &&
    configurationHash &&
    Number.isFinite(verifiedAt) &&
    verifiedAt <= args.now + OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS &&
    args.now - verifiedAt <= OUTREACH_INBOUND_RELAY_CANARY_VALID_MS &&
    inbox.inboundRelayDsnRoutingConfigurationVersion ===
      (typeof inbox.configurationVersion === "number"
        ? inbox.configurationVersion
        : 0) &&
    inbox.inboundRelayDsnRoutingRolloutEpoch === args.rolloutEpoch &&
    inbox.inboundRelayDsnRoutingSenderDomain === senderDomain &&
    inbox.inboundRelayDsnRoutingRelayConfigurationHash === configurationHash &&
    inbox.inboundRelayDsnRoutingAdapterVersion ===
      args.runtimeConfig.adapterVersion &&
    inbox.inboundRelayDsnRoutingRetentionPolicyHash ===
      args.runtimeConfig.retentionPolicyHash &&
    inbox.inboundRelayDsnRoutingTargetVersion ===
      OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION &&
    Number.isSafeInteger(inbox.inboundRelayDsnRoutingTargetGeneration) &&
    Number(inbox.inboundRelayDsnRoutingTargetGeneration) >= 1 &&
    typeof inbox.inboundRelayDsnRoutingTargetHash === "string" &&
    /^[a-f0-9]{64}$/.test(inbox.inboundRelayDsnRoutingTargetHash) &&
    typeof inbox.inboundRelayDsnRoutingEvidenceHash === "string" &&
    /^[a-f0-9]{64}$/.test(inbox.inboundRelayDsnRoutingEvidenceHash)
  );
}

/** Derive the current Workspace DSN routing address without persisting its
 * secret local part. The server-only derivation key is purpose-separated from
 * outbound Message-ID derivation; every tenant/inbox/generation fence is
 * included in the canonical input. Routine
 * sender-profile, plan-epoch and relay-signing changes therefore do not force
 * a Workspace administrator to replace the route. A changed mailbox or an
 * explicit owner rotation advances the persisted non-secret generation.
 * The receiving adapter still treats this alias only as an authenticated
 * intake lane, never as a tenant selector. */
export async function inboundRelayDsnRoutingTarget(args: {
  siteId: string;
  inboxId: string;
  generation: number;
  relayDomain?: string;
  secret?: string;
}): Promise<{
  address: string;
  hash: string;
  version: number;
} | null> {
  const domain = normalizeInboundRelayDomain(args.relayDomain);
  const secret = args.secret?.trim();
  const siteId = String(args.siteId ?? "");
  const inboxId = String(args.inboxId ?? "");
  if (
    !domain ||
    !secret ||
    secret.length < 32 ||
    !siteId ||
    siteId.length > 200 ||
    !inboxId ||
    inboxId.length > 200 ||
    !Number.isSafeInteger(args.generation) ||
    args.generation < 1
  ) {
    return null;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const binding = new TextEncoder().encode(JSON.stringify({
      version: OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
      purpose: "workspace_dsn_routing",
      relayDomain: domain,
      siteId,
      inboxId,
      generation: args.generation,
    }));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, binding));
    // 24 bytes / 192 bits remains computationally unguessable while keeping
    // `dsn-<token>` below SMTP's 64-octet local-part ceiling.
    const token = Array.from(digest.slice(0, 24), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const address = `dsn-${token}@${domain}`;
    return {
      address,
      hash: inboundRelayAliasHash(address),
      version: OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
    };
  } catch {
    return null;
  }
}

export function inboundRelayAliasAddress(token: string, relayDomain: string): string | null {
  const domain = normalizeInboundRelayDomain(relayDomain);
  if (!domain || !ALIAS_TOKEN_PATTERN.test(token)) return null;
  return `reply-${token.toLowerCase()}@${domain}`;
}

export function inboundRelayAliasHash(aliasAddress: string): string {
  return sha256Hex(normalizeOutreachEmail(aliasAddress));
}

export function inboundRelayEmailHash(value: string | undefined): string {
  const normalized = emailAddressFromHeader(value);
  return normalized ? sha256Hex(normalized) : "";
}

export function inboundRelayOutboundMessageId(args: {
  token: string;
  senderDomain: string;
}): string | null {
  const senderDomain = normalizeInboundRelayDomain(args.senderDomain);
  if (!senderDomain || !ALIAS_TOKEN_PATTERN.test(args.token)) return null;
  return `<pentra.${args.token.toLowerCase()}@${senderDomain}>`;
}

/** Reconstruct an outbound RFC Message-ID only at the provider boundary.
 * The database retains its SHA-256 digest and the already-persisted delivery
 * attempt ID, never this raw identifier. Purpose-separated HMAC input makes a
 * later follow-up deterministic without turning the identifier into a bearer
 * capability or reusing the independently random reply alias. */
export async function inboundRelayOutboundMessageIdForAttempt(args: {
  siteId: string;
  inboxId: string;
  deliveryAttemptId: string;
  senderDomain: string;
  secret?: string;
}): Promise<string | null> {
  const siteId = String(args.siteId ?? "");
  const inboxId = String(args.inboxId ?? "");
  const deliveryAttemptId = String(args.deliveryAttemptId ?? "");
  const senderDomain = normalizeInboundRelayDomain(args.senderDomain);
  const secret = args.secret?.trim();
  if (
    !siteId || siteId.length > 200 ||
    !inboxId || inboxId.length > 200 ||
    !deliveryAttemptId || deliveryAttemptId.length > 200 ||
    !senderDomain ||
    !secret || secret.length < 32
  ) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const binding = new TextEncoder().encode(JSON.stringify({
      version: 1,
      purpose: "outreach_outbound_message_id",
      siteId,
      inboxId,
      deliveryAttemptId,
      senderDomain,
    }));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, binding));
    const token = Array.from(digest.slice(0, 24), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return inboundRelayOutboundMessageId({ token, senderDomain });
  } catch {
    return null;
  }
}

export function inboundRelayMessageIdHash(value: string | undefined): string {
  const normalized = normalizeRfcMessageId(value);
  return normalized ? sha256Hex(normalized) : "";
}

export function normalizeRfcMessageId(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  const bracketed = raw.match(/<[^<>\s]+@[^<>\s]+>/)?.[0] ?? raw;
  const normalized = bracketed.toLowerCase();
  return RFC_MESSAGE_ID_PATTERN.test(normalized) ? normalized : "";
}

export function parseInboundRelayPayload(rawBody: string): InboundRelayPayload | null {
  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!plainObject(input) || input.version !== OUTREACH_INBOUND_RELAY_VERSION) return null;

  const eventId = boundedString(input.eventId, 200, { required: true });
  const adapterVersion = boundedString(input.adapterVersion, 80, { required: true });
  const retentionPolicyHash = boundedString(
    input.retentionPolicyHash,
    64,
    { required: true },
  );
  const recipient = boundedString(input.recipient, 320, { required: true });
  const from = boundedString(input.from, 500, { required: true });
  const messageId = boundedString(input.messageId, 220, { required: true });
  const inReplyTo = boundedString(input.inReplyTo, 220);
  const subject = boundedString(input.subject, 500) ?? null;
  const text = boundedString(input.text, 50_000) ?? null;
  const autoSubmitted = boundedString(input.autoSubmitted, 100);
  if (
    !eventId ||
    !EVENT_ID_PATTERN.test(eventId) ||
    !adapterVersion ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(adapterVersion) ||
    !retentionPolicyHash ||
    !/^[a-f0-9]{64}$/.test(retentionPolicyHash) ||
    !recipient ||
    !from ||
    !messageId ||
    !normalizeRfcMessageId(messageId) ||
    subject === null ||
    text === null ||
    typeof input.receivedAt !== "number" ||
    !Number.isSafeInteger(input.receivedAt) ||
    input.receivedAt <= 0 ||
    (input.references !== undefined && !Array.isArray(input.references))
  ) {
    return null;
  }
  const references = (input.references ?? []) as unknown[];
  if (
    references.length > 20 ||
    !references.every((value) => typeof value === "string" && value.length <= 220)
  ) {
    return null;
  }

  if (!plainObject(input.authentication)) return null;
  const alignedFrom = boundedString(
    input.authentication.alignedFrom,
    320,
    { required: true },
  );
  if (
    input.authentication.verdict !== "pass" ||
    !["dmarc", "dkim", "spf"].includes(String(input.authentication.method)) ||
    !alignedFrom ||
    !emailAddressFromHeader(alignedFrom)
  ) {
    return null;
  }

  let dsn: InboundRelayPayload["dsn"];
  if (input.dsn !== undefined) {
    if (!plainObject(input.dsn)) return null;
    const status = boundedString(input.dsn.status, 30, { required: true });
    const finalRecipient = boundedString(input.dsn.finalRecipient, 320, { required: true });
    const originalRecipient = boundedString(input.dsn.originalRecipient, 320);
    const originalMessageId = boundedString(
      input.dsn.originalMessageId,
      220,
      { required: true },
    );
    const routingRecipientHash = boundedString(
      input.dsn.routingRecipientHash,
      64,
      { required: true },
    );
    if (
      input.dsn.action !== "failed" ||
      input.dsn.source !== "message/delivery-status" ||
      !status ||
      !finalRecipient ||
      !originalMessageId ||
      !normalizeRfcMessageId(originalMessageId) ||
      !routingRecipientHash ||
      !/^[a-f0-9]{64}$/.test(routingRecipientHash)
    ) return null;
    dsn = {
      action: "failed",
      status,
      finalRecipient,
      ...(originalRecipient ? { originalRecipient } : {}),
      originalMessageId: normalizeRfcMessageId(originalMessageId),
      routingRecipientHash,
      source: "message/delivery-status",
    };
  }

  return {
    version: 1,
    adapterVersion,
    retentionPolicyHash,
    eventId,
    receivedAt: input.receivedAt,
    recipient: normalizeOutreachEmail(recipient),
    from,
    messageId: normalizeRfcMessageId(messageId),
    ...(inReplyTo ? { inReplyTo: normalizeRfcMessageId(inReplyTo) } : {}),
    references: references
      .map((value) => normalizeRfcMessageId(String(value)))
      .filter(Boolean),
    subject,
    text,
    ...(autoSubmitted ? { autoSubmitted } : {}),
    authentication: {
      verdict: "pass",
      method: input.authentication.method as "dmarc" | "dkim" | "spf",
      alignedFrom: emailAddressFromHeader(alignedFrom),
    },
    ...(dsn ? { dsn } : {}),
  };
}

function automaticInbound(payload: InboundRelayPayload): boolean {
  const autoSubmitted = String(payload.autoSubmitted ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  return /\b(?:automatic reply|auto(?:matic)?[- ]reply|out of office|away from the office)\b/i.test(
    payload.subject,
  );
}

function daemonSender(fromEmail: string): boolean {
  const local = normalizeOutreachEmail(fromEmail).split("@")[0] ?? "";
  return /^(?:mailer-daemon|postmaster|mail-daemon|maildelivery-subsystem)$/.test(local);
}

export function classifyInboundRelay(args: {
  payload: InboundRelayPayload;
  candidate: InboundRelayCandidate;
  now: number;
}): InboundRelayClassification {
  const { payload, candidate, now } = args;
  const fromEmail = emailAddressFromHeader(payload.from);
  const authenticatedFrom = emailAddressFromHeader(
    payload.authentication.alignedFrom,
  );
  if (
    !Number.isFinite(candidate.sentAt) ||
    payload.receivedAt < candidate.sentAt - 60_000 ||
    payload.receivedAt > now + OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS
  ) {
    return { kind: "ignored", reason: "timestamp_mismatch", ...(fromEmail ? { fromEmail } : {}) };
  }

  if (payload.dsn) {
    const failedRecipients = [
      payload.dsn.finalRecipient,
      payload.dsn.originalRecipient,
    ]
      .map((value) => emailAddressFromHeader(value))
      .filter(Boolean);
    if (
      !fromEmail ||
      authenticatedFrom !== fromEmail ||
      !daemonSender(fromEmail) ||
      inboundRelayMessageIdHash(payload.dsn.originalMessageId) !==
        candidate.outboundRfcMessageIdHash ||
      payload.dsn.routingRecipientHash !== candidate.dsnRoutingTargetHash ||
      !/^5\.\d{1,3}\.\d{1,3}$/.test(payload.dsn.status) ||
      !failedRecipients.includes(normalizeOutreachEmail(candidate.toEmail))
    ) {
      return { kind: "ignored", reason: "soft_or_invalid_dsn", ...(fromEmail ? { fromEmail } : {}) };
    }
    return { kind: "bounce", fromEmail };
  }

  if (!fromEmail) return { kind: "ignored", reason: "invalid_sender" };
  if (!authenticatedFrom || authenticatedFrom !== fromEmail) {
    return {
      kind: "ignored",
      reason: "sender_authentication_failed",
      fromEmail,
    };
  }
  if (automaticInbound(payload)) {
    return { kind: "ignored", reason: "automatic_message", fromEmail };
  }
  const outboundIdHash = candidate.outboundRfcMessageIdHash;
  const hasReplyProof = Boolean(
    /^[a-f0-9]{64}$/.test(outboundIdHash) &&
    [payload.inReplyTo, ...payload.references]
      .map((value) => inboundRelayMessageIdHash(value))
      .includes(outboundIdHash),
  );
  if (!hasReplyProof) {
    return { kind: "ignored", reason: "missing_reply_proof", fromEmail };
  }

  const exactRecipient = fromEmail === normalizeOutreachEmail(candidate.toEmail);
  const fromDomain = fromEmail.split("@")[1] ?? "";
  const sameDomain = fromDomain === String(candidate.toDomain).trim().toLowerCase();
  if (!exactRecipient && !sameDomain) {
    return { kind: "ignored", reason: "recipient_mismatch", fromEmail };
  }
  // A different person at the same organization may prove an ordinary reply,
  // but only the exact original recipient can issue a permanent STOP/domain
  // suppression for this message.
  const optOut = requestsOutreachOptOut(payload.text);
  return {
    kind: optOut && exactRecipient ? "unsubscribe" : "reply",
    fromEmail,
  };
}

/** A canary accepts only a real, structured hard DSN that encloses the exact
 * independently-random Message-ID and exact controlled failure recipient. */
export function classifyInboundRelayDsnCanary(args: {
  payload: InboundRelayPayload;
  candidate: InboundRelayCanaryCandidate;
  now: number;
}): { fromEmail: string } | null {
  const { payload, candidate, now } = args;
  const dsn = payload.dsn;
  const fromEmail = emailAddressFromHeader(payload.from);
  const authenticatedFrom = emailAddressFromHeader(
    payload.authentication.alignedFrom,
  );
  const failedRecipients = dsn
    ? [dsn.finalRecipient, dsn.originalRecipient]
        .map((value) => inboundRelayEmailHash(value))
        .filter(Boolean)
    : [];
  if (
    !dsn ||
    !fromEmail ||
    authenticatedFrom !== fromEmail ||
    !daemonSender(fromEmail) ||
    inboundRelayMessageIdHash(dsn.originalMessageId) !==
      candidate.outboundRfcMessageIdHash ||
    dsn.routingRecipientHash !== candidate.dsnRoutingTargetHash ||
    !/^5\.\d{1,3}\.\d{1,3}$/.test(dsn.status) ||
    !failedRecipients.includes(candidate.testRecipientHash) ||
    !Number.isSafeInteger(payload.receivedAt) ||
    payload.receivedAt < candidate.issuedAt - 60_000 ||
    payload.receivedAt > candidate.expiresAt ||
    payload.receivedAt > now + OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS ||
    now > candidate.expiresAt + OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS
  ) {
    return null;
  }
  return { fromEmail };
}

export function inboundRelayEventKey(eventId: string): string {
  return sha256Hex(`outreach_inbound_relay:v1:${eventId}`);
}

export function inboundRelayEvidenceReceipt(args: {
  eventKey: string;
  siteId: string;
  messageId: string;
  inboundMessageId: string;
  outboundMessageIdHash: string;
  aliasHash: string;
  kind: OutreachInboundKind | "ignored";
  fromEmail?: string;
  receivedAt: number;
  subjectDigest: string;
  bodyDigest: string;
  dsnRoutingTargetHash?: string;
}): string {
  return JSON.stringify({
    version: 1,
    eventKey: args.eventKey,
    siteId: args.siteId,
    messageId: args.messageId,
    inboundMessageId: normalizeRfcMessageId(args.inboundMessageId),
    outboundMessageIdHash: args.outboundMessageIdHash,
    aliasHash: args.aliasHash,
    kind: args.kind,
    fromEmail: normalizeOutreachEmail(args.fromEmail),
    receivedAt: args.receivedAt,
    subjectDigest: args.subjectDigest,
    bodyDigest: args.bodyDigest,
    ...(args.dsnRoutingTargetHash
      ? { dsnRoutingTargetHash: args.dsnRoutingTargetHash }
      : {}),
  });
}

export function inboundRelayCanaryEvidenceReceipt(args: {
  eventKey: string;
  siteId: string;
  inboxId: string;
  canaryId: string;
  aliasHash: string;
  inboundMessageId: string;
  outboundMessageIdHash: string;
  dsnRoutingTargetHash: string;
  dsnRoutingTargetVersion: number;
  dsnRoutingTargetGeneration: number;
  receivedAt: number;
  adapterVersion: string;
  retentionPolicyHash: string;
}): string {
  return JSON.stringify({
    version: 1,
    kind: "dsn_routing_canary",
    eventKey: args.eventKey,
    siteId: args.siteId,
    inboxId: args.inboxId,
    canaryId: args.canaryId,
    aliasHash: args.aliasHash,
    inboundMessageId: normalizeRfcMessageId(args.inboundMessageId),
    outboundMessageIdHash: args.outboundMessageIdHash,
    dsnRoutingTargetHash: args.dsnRoutingTargetHash,
    dsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
    dsnRoutingTargetGeneration: args.dsnRoutingTargetGeneration,
    receivedAt: args.receivedAt,
    adapterVersion: args.adapterVersion,
    retentionPolicyHash: args.retentionPolicyHash,
  });
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

/** Verify the exact raw payload before parsing it. Event ID is included both
 * in the signed envelope and the body, then required to match by the handler. */
export async function verifyInboundRelaySignature(args: {
  rawBody: Uint8Array;
  timestampHeader: string | null;
  eventIdHeader: string | null;
  signatureHeader: string | null;
  secrets: Array<string | undefined>;
  now: number;
}): Promise<boolean> {
  const timestampSeconds = Number(args.timestampHeader);
  const eventId = String(args.eventIdHeader ?? "");
  const signatureValue = String(args.signatureHeader ?? "").replace(/^v1=/, "");
  const signature = hexBytes(signatureValue);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(args.now - timestampSeconds * 1_000) > OUTREACH_INBOUND_RELAY_MAX_CLOCK_SKEW_MS ||
    !EVENT_ID_PATTERN.test(eventId) ||
    !signature
  ) {
    return false;
  }
  const prefix = new TextEncoder().encode(`${timestampSeconds}.${eventId}.`);
  const signed = new Uint8Array(prefix.byteLength + args.rawBody.byteLength);
  signed.set(prefix, 0);
  signed.set(args.rawBody, prefix.byteLength);

  for (const candidate of args.secrets) {
    const secret = candidate?.trim();
    if (!secret || secret.length < 32) continue;
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signatureBuffer = signature.buffer.slice(
        signature.byteOffset,
        signature.byteOffset + signature.byteLength,
      ) as ArrayBuffer;
      const signedBuffer = signed.buffer.slice(
        signed.byteOffset,
        signed.byteOffset + signed.byteLength,
      ) as ArrayBuffer;
      if (await crypto.subtle.verify("HMAC", key, signatureBuffer, signedBuffer)) {
        return true;
      }
    } catch {
      // Try the rotation secret, if any. Invalid configuration fails closed.
    }
  }
  return false;
}
