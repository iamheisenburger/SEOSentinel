import { sha256Hex } from "./publicationArtifact.ts";
import { requestsOutreachOptOut } from "./outreachInbound.ts";

export const SMARTLEAD_ADAPTER_VERSION = "smartlead-managed-v1";
export const SMARTLEAD_MANAGED_TRANSPORT = "smartlead_managed" as const;
export const SMARTLEAD_WEBHOOK_MAX_BYTES = 64 * 1024;
export const SMARTLEAD_MAX_SEQUENCE_STEP = 2;
export const SMARTLEAD_MINIMUM_WARMUP_MS = 14 * 24 * 60 * 60 * 1000;
export const SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP = Object.freeze({
  EMAIL_SENT: true,
  EMAIL_REPLY: true,
  EMAIL_BOUNCE: true,
  LEAD_UNSUBSCRIBED: true,
});

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,199}$/;
const OPERATION_PATTERN = /^[a-f0-9]{64}$/;

export type SmartleadWebhookKind = "sent" | "reply" | "bounce" | "unsubscribe";
export type SmartleadCanaryKind = "delivery" | "reply" | "bounce" | "unsubscribe";
export type SmartleadWebhookEvent = {
  requestId: string;
  campaignBindingHash: string;
  recipientHash: string;
  kind: SmartleadWebhookKind;
  observedAt: number;
  payloadHash: string;
  evidenceHash: string;
  sequenceStep?: number;
  stopRequest?: boolean;
};

export function smartleadRuntimeIssues(args: {
  apiKey?: string;
  webhookSecret?: string;
  smartSendersAccess?: string | boolean;
}): string[] {
  const issues: string[] = [];
  if ((args.apiKey?.trim().length ?? 0) < 20) issues.push("smartlead_api_key_unavailable");
  if ((args.webhookSecret?.trim().length ?? 0) < 32) issues.push("smartlead_webhook_secret_unavailable");
  if (args.smartSendersAccess !== true && args.smartSendersAccess !== "true") {
    issues.push("smart_senders_paid_api_access_unverified");
  }
  return issues;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Verify Smartlead's X-Smartlead-Signature over the exact raw body. */
export async function verifySmartleadWebhookSignature(args: {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  secret?: string;
}): Promise<boolean> {
  const secret = args.secret?.trim();
  const supplied = String(args.signatureHeader ?? "").trim().toLowerCase();
  const suppliedHex = supplied.startsWith("sha256=")
    ? supplied.slice("sha256=".length)
    : supplied;
  if (!secret || secret.length < 32 || !/^[a-f0-9]{64}$/.test(suppliedHex)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    Uint8Array.from(args.rawBody).buffer,
  );
  return timingSafeEqual(hex(digest), suppliedHex);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown, maximum = 240): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  const normalized = value.trim();
  return normalized || null;
}

function eventKind(value: unknown): SmartleadWebhookKind | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["SENT", "EMAIL_SENT", "FIRST_EMAIL_SENT"].includes(normalized)) return "sent";
  if (["REPLIED", "EMAIL_REPLY", "EMAIL_REPLIED", "LEAD_REPLIED"].includes(normalized)) return "reply";
  if (["BOUNCED", "EMAIL_BOUNCE", "EMAIL_BOUNCED", "LEAD_BOUNCED"].includes(normalized)) return "bounce";
  if (["UNSUBSCRIBED", "LEAD_UNSUBSCRIBED", "EMAIL_UNSUBSCRIBED"].includes(normalized)) return "unsubscribe";
  return null;
}

/** Parse only the settlement envelope; reply bodies and addresses are dropped. */
export function parseSmartleadWebhookEvent(args: {
  rawText: string;
  requestIdHeader: string | null;
  now: number;
}): SmartleadWebhookEvent | null {
  let payload: Record<string, unknown> | null = null;
  try { payload = object(JSON.parse(args.rawText)); } catch { return null; }
  if (!payload) return null;
  const rawEventType = payload.event_type ?? payload.event;
  const initialKind = eventKind(rawEventType);
  if (!initialKind) return null;
  const reply = object(payload.reply);
  const stopRequest = initialKind === "reply" && requestsOutreachOptOut(String(
    payload.reply_body ?? payload.preview_text ?? reply?.body ?? payload.message ?? "",
  ));
  const kind = stopRequest ? "unsubscribe" : initialKind;
  const campaignId = Number(payload.campaign_id);
  const lead = object(payload.lead);
  const recipient = string(
    payload.lead_email ?? payload.to_email ?? lead?.email,
    320,
  )?.toLowerCase();
  if (
    !Number.isSafeInteger(campaignId) || campaignId <= 0 ||
    !recipient || !/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,63}$/i.test(recipient)
  ) return null;
  const campaignBindingHash = smartleadCampaignBindingHash(campaignId);
  const recipientHash = sha256Hex(recipient);
  const rawTimestamp = string(
    payload.timestamp ?? payload.time_sent ?? payload.time_replied ??
      payload.time_bounced ?? payload.time_unsubscribed,
    80,
  );
  const observedAt = rawTimestamp ? Date.parse(rawTimestamp) : NaN;
  if (
    !Number.isFinite(observedAt) || observedAt < 0 ||
    observedAt > args.now + 5 * 60 * 1000
  ) return null;
  const payloadHash = sha256Hex(args.rawText);
  const rawSequenceNumber = Number(
    payload.sequence_number ?? payload.sequenceNumber ?? payload.seq_number,
  );
  const sequenceStep = Number.isSafeInteger(rawSequenceNumber) &&
      rawSequenceNumber >= 1 && rawSequenceNumber <= SMARTLEAD_MAX_SEQUENCE_STEP + 1
    ? rawSequenceNumber - 1
    : undefined;
  const suppliedRequestId = string(args.requestIdHeader, 200);
  const providerMessageId = string(
    payload.message_id ?? reply?.message_id ?? object(payload.email)?.message_id,
    300,
  );
  const requestId = suppliedRequestId && ID_PATTERN.test(suppliedRequestId)
    ? suppliedRequestId
    : `sl-${sha256Hex(JSON.stringify({
        campaignBindingHash,
        recipientHash,
        kind,
        observedAt,
        sequenceStep,
        providerMessageId: providerMessageId ?? payloadHash,
      }))}`;
  return {
    requestId,
    campaignBindingHash,
    recipientHash,
    kind,
    observedAt,
    payloadHash,
    sequenceStep,
    stopRequest: stopRequest || undefined,
    evidenceHash: sha256Hex(JSON.stringify({
      version: SMARTLEAD_ADAPTER_VERSION,
      requestId,
      campaignBindingHash,
      recipientHash,
      kind,
      observedAt,
      payloadHash,
      sequenceStep,
      stopRequest: stopRequest || undefined,
    })),
  };
}

export function smartleadCampaignBindingHash(campaignId: number): string {
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    throw new Error("Invalid Smartlead campaign id");
  }
  return sha256Hex(`${SMARTLEAD_ADAPTER_VERSION}:campaign:${campaignId}`);
}

export function smartleadOperationKey(args: {
  siteId: string;
  inboxGeneration: number;
  campaignGeneration: number;
  messageId: string;
  sequenceStep: number;
}): string {
  if (!Number.isInteger(args.sequenceStep) || args.sequenceStep < 0 || args.sequenceStep > SMARTLEAD_MAX_SEQUENCE_STEP) {
    throw new Error("Smartlead sequence step must be between zero and two");
  }
  return sha256Hex(JSON.stringify({ version: SMARTLEAD_ADAPTER_VERSION, ...args }));
}

export function smartleadCanaryOperationKey(args: {
  siteId: string;
  resourceOperationKey: string;
  generation: number;
  kind: SmartleadCanaryKind;
  targetHash: string;
}): string {
  if (
    !OPERATION_PATTERN.test(args.resourceOperationKey) ||
    !OPERATION_PATTERN.test(args.targetHash) ||
    !Number.isSafeInteger(args.generation) || args.generation < 1 ||
    !["delivery", "reply", "bounce", "unsubscribe"].includes(args.kind)
  ) {
    throw new Error("Invalid Smartlead controlled-canary binding");
  }
  return sha256Hex(JSON.stringify({
    version: SMARTLEAD_ADAPTER_VERSION,
    purpose: "controlled_canary",
    ...args,
  }));
}

export function smartleadLeadCustomFields(args: {
  operationKey: string;
  subject: string;
  body: string;
}): Record<string, string> {
  if (!OPERATION_PATTERN.test(args.operationKey)) throw new Error("Invalid operation key");
  if (!args.subject.trim() || args.subject.length > 240) throw new Error("Invalid outreach subject");
  if (!args.body.trim() || args.body.length > 20_000) throw new Error("Invalid outreach body");
  return {
    pentra_operation_key: args.operationKey,
    pentra_subject: args.subject,
    pentra_body: args.body,
  };
}

export type SmartleadSequenceCopy = {
  subject: string;
  body: string;
};

/** Exact, bounded copy passed through generic campaign templates. Smartlead
 * receives no freedom to rewrite Pentra's policy-approved recipient copy. */
export function smartleadSequenceCustomFields(args: {
  operationKey: string;
  messages: SmartleadSequenceCopy[];
}): Record<string, string> {
  if (!OPERATION_PATTERN.test(args.operationKey)) {
    throw new Error("Invalid operation key");
  }
  if (args.messages.length < 1 || args.messages.length > 3) {
    throw new Error("Smartlead sequence must contain one to three messages");
  }
  return args.messages.reduce<Record<string, string>>((fields, message, index) => {
    if (!message.subject.trim() || message.subject.length > 240) {
      throw new Error("Invalid outreach subject");
    }
    if (!message.body.trim() || message.body.length > 20_000) {
      throw new Error("Invalid outreach body");
    }
    fields[`pentra_subject_${index}`] = message.subject;
    fields[`pentra_body_${index}`] = message.body;
    return fields;
  }, { pentra_operation_key: args.operationKey });
}

export function smartleadManagedInboxIssues(args: {
  inbox: Record<string, unknown> | null | undefined;
  now: number;
}): string[] {
  const inbox = args.inbox;
  const issues: string[] = [];
  if (
    inbox?.provider !== "smartlead" ||
    inbox.managedTransportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
    inbox.credentialSource !== "managed_adapter" ||
    inbox.managedTransportAdapterVersion !== SMARTLEAD_ADAPTER_VERSION ||
    typeof inbox.managedTransportOperationKey !== "string" ||
    !OPERATION_PATTERN.test(inbox.managedTransportOperationKey) ||
    !Number.isSafeInteger(inbox.managedTransportGeneration) ||
    typeof inbox.managedTransportResourceReceipt !== "string" ||
    !OPERATION_PATTERN.test(inbox.managedTransportResourceReceipt)
  ) issues.push("smartlead_inbox_binding_invalid");
  if (inbox?.status !== "active") issues.push("smartlead_inbox_not_active");
  if (
    typeof inbox?.warmupStartedAt !== "number" ||
    inbox.warmupStartedAt + SMARTLEAD_MINIMUM_WARMUP_MS > args.now
  ) issues.push("smartlead_mailbox_warming");
  return issues;
}
