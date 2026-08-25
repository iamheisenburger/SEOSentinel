import { inboundRelayConfigurationHash } from "./outreachInboundRelay.ts";

export const MANAGED_SES_PROTOCOL_VERSION = 1;
export const MANAGED_SES_TRANSPORT = "managed_ses" as const;
export const MANAGED_SES_PLATFORM_SENDER_DOMAIN = "mail.pentra.dev";
export const MANAGED_SES_PLATFORM_RELAY_DOMAIN = "reply.pentra.dev";
export const MANAGED_SES_EVENT_CANARY_VALID_MS =
  30 * 24 * 60 * 60 * 1000;
export const MANAGED_SES_INBOUND_CANARY_VALID_MS =
  30 * 24 * 60 * 60 * 1000;
export const MANAGED_SES_EVENT_CANARY_TTL_MS = 24 * 60 * 60 * 1000;
export const MANAGED_SES_AMBIGUOUS_DISPOSITION_MS =
  72 * 60 * 60 * 1000;
export const MANAGED_SES_GLOBAL_DAILY_ATTEMPT_CAP = 300;
export const MANAGED_SES_GLOBAL_MIN_ATTEMPT_INTERVAL_MS = 60 * 1000;
export const MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP = 30;
export const MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS = 30 * 60 * 1000;
export const MANAGED_SES_MAILBOX_DAILY_ATTEMPT_CAP = 30;
export const MANAGED_SES_MAILBOX_MIN_ATTEMPT_INTERVAL_MS = 30 * 60 * 1000;
export const MANAGED_SES_EVENT_CANARY_MAX_ATTEMPTS_PER_CYCLE = 10;
export const MANAGED_SES_EVENT_CANARY_MAX_ROLLING_ATTEMPTS = 20;

const OPAQUE_KEY = /^[A-Za-z0-9_-]{32,96}$/;
const ADAPTER_VERSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const EVENT_TYPES = new Set([
  "sent",
  "delivered",
  "bounced",
  "complaint",
  "delayed",
  "rejected",
  "rendering_failed",
]);

export function managedSesIdentityTupleMatchesEstablished(args: {
  establishedProviderMessageIdDigest?: string;
  establishedRfcMessageIdDigest?: string;
  establishedThreadReceipt?: string;
  providerMessageIdDigest?: string;
  rfcMessageIdDigest?: string;
  threadReceipt?: string;
}): boolean {
  return Boolean(
    (!args.establishedProviderMessageIdDigest ||
      args.providerMessageIdDigest ===
        args.establishedProviderMessageIdDigest) &&
    (!args.establishedRfcMessageIdDigest ||
      args.rfcMessageIdDigest === args.establishedRfcMessageIdDigest) &&
    (!args.establishedThreadReceipt ||
      args.threadReceipt === args.establishedThreadReceipt),
  );
}

export function managedSesEventCanaryClaimDecision(args: {
  currentCycleAttemptCount: number;
  rollingAttemptCount: number;
  liveStatuses: Array<"claimed" | "accepted" | "unverified" | "delivered">;
}):
  | { state: "create"; attemptOrdinal: number }
  | { state: "attempt_exists" | "already_verified" | "attempt_limit" } {
  if (
    !Number.isSafeInteger(args.currentCycleAttemptCount) ||
    args.currentCycleAttemptCount < 0 ||
    args.currentCycleAttemptCount >=
      MANAGED_SES_EVENT_CANARY_MAX_ATTEMPTS_PER_CYCLE ||
    !Number.isSafeInteger(args.rollingAttemptCount) ||
    args.rollingAttemptCount < 0 ||
    args.rollingAttemptCount >
      MANAGED_SES_EVENT_CANARY_MAX_ROLLING_ATTEMPTS
  ) return { state: "attempt_limit" };
  if (args.liveStatuses.includes("delivered")) {
    return { state: "already_verified" };
  }
  if (args.liveStatuses.length > 0) return { state: "attempt_exists" };
  return { state: "create", attemptOrdinal: args.currentCycleAttemptCount };
}

export function managedSesPacingBoundaryTransition(args: {
  kind: "delivery" | "canary";
  reserved: boolean;
  nextEligibleAt?: number;
}):
  | "cross_external_boundary"
  | "defer_delivery"
  | "discard_canary_and_retry"
  | "invalid_binding" {
  if (args.reserved) return "cross_external_boundary";
  if (!Number.isFinite(args.nextEligibleAt)) return "invalid_binding";
  return args.kind === "delivery"
    ? "defer_delivery"
    : "discard_canary_and_retry";
}

export function managedSesCombinedPacingDecision(
  decisions: Array<{
    allowed: boolean;
    reason: string;
    nextEligibleAt?: number;
  }>,
): { allowed: true } | {
  allowed: false;
  reason: string;
  nextEligibleAt?: number;
} {
  const denied = decisions.filter((decision) => !decision.allowed);
  if (denied.length === 0) return { allowed: true };
  const finiteNextTimes = denied
    .map((decision) => decision.nextEligibleAt)
    .filter((value): value is number => Number.isFinite(value));
  return {
    allowed: false,
    reason: denied.map((decision) => decision.reason).join(","),
    nextEligibleAt: finiteNextTimes.length > 0
      ? Math.max(...finiteNextTimes)
      : undefined,
  };
}

function normalizeManagedSesDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export type ManagedSesAdapterConfiguration = {
  endpoint: string;
  adapterVersion: string;
  signingSecret: string;
  verificationSecrets: string[];
};

export function managedSesAdapterConfiguration(args: {
  endpoint?: string;
  adapterVersion?: string;
  signingSecret?: string;
  nextVerificationSecret?: string;
}): ManagedSesAdapterConfiguration | null {
  const endpoint = args.endpoint?.trim();
  const adapterVersion = args.adapterVersion?.trim();
  const signingSecret = args.signingSecret?.trim();
  const nextVerificationSecret = args.nextVerificationSecret?.trim();
  if (
    !endpoint ||
    !adapterVersion ||
    !ADAPTER_VERSION.test(adapterVersion) ||
    !signingSecret ||
    signingSecret.length < 32 ||
    (nextVerificationSecret !== undefined &&
      nextVerificationSecret.length > 0 &&
      nextVerificationSecret.length < 32)
  ) return null;
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    ) return null;
    return {
      endpoint: url.origin,
      adapterVersion,
      signingSecret,
      verificationSecrets: [signingSecret, nextVerificationSecret]
        .filter((value): value is string => Boolean(value))
        .filter((value, index, values) => values.indexOf(value) === index),
    };
  } catch {
    return null;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function managedSesDeterministicJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalValue(value));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function webCryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!HEX_64.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}

export async function managedSesSha256Hex(
  value: string | Uint8Array,
): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", webCryptoBuffer(bytes)),
    ),
  );
}

async function hmacHex(secret: string, material: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(material),
  )));
}

async function verifyHmac(
  secret: string,
  material: string,
  signature: string,
): Promise<boolean> {
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    webCryptoBuffer(signatureBytes),
    new TextEncoder().encode(material),
  );
}

async function requestMaterial(args: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
}): Promise<string> {
  return [
    "v1",
    args.method.toUpperCase(),
    args.path,
    args.timestamp,
    args.nonce,
    await managedSesSha256Hex(args.body),
  ].join("\n");
}

async function responseMaterial(args: {
  nonce: string;
  timestamp: string;
  body: Uint8Array;
}): Promise<string> {
  return [
    "v1",
    "response",
    args.nonce,
    args.timestamp,
    await managedSesSha256Hex(args.body),
  ].join("\n");
}

export type ManagedSesAdapterResult =
  | {
      authenticated: true;
      ok: true;
      status: number;
      receipt: Record<string, unknown>;
    }
  | {
      authenticated: true;
      ok: false;
      status: number;
      code: string;
      retryAfterSeconds?: number;
    }
  | {
      authenticated: false;
      ok: false;
      status?: number;
      code: "adapter_unavailable" | "adapter_response_invalid";
    };

export async function callManagedSesAdapter(args: {
  config: ManagedSesAdapterConfiguration;
  route:
    | "provision"
    | "status"
    | "send"
    | "inbound-canary"
    | "disposition"
    | "release";
  nonce: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<ManagedSesAdapterResult> {
  if (!OPAQUE_KEY.test(args.nonce)) {
    return { authenticated: false, ok: false, code: "adapter_response_invalid" };
  }
  const path = `/v1/${args.route}`;
  const bodyText = managedSesDeterministicJson({
    version: MANAGED_SES_PROTOCOL_VERSION,
    ...args.payload,
  });
  const body = new TextEncoder().encode(bodyText);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacHex(
    args.config.signingSecret,
    await requestMaterial({
      method: "POST",
      path,
      timestamp,
      nonce: args.nonce,
      body,
    }),
  );
  let response: Response;
  try {
    response = await fetch(`${args.config.endpoint}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Pentra-Timestamp": timestamp,
        "X-Pentra-Nonce": args.nonce,
        "X-Pentra-Signature": signature,
        "X-Pentra-Adapter-Version": args.config.adapterVersion,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch {
    return { authenticated: false, ok: false, code: "adapter_unavailable" };
  }
  let responseBytes: Uint8Array;
  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 16 * 1024) {
      return {
        authenticated: false,
        ok: false,
        status: response.status,
        code: "adapter_response_invalid",
      };
    }
    responseBytes = new Uint8Array(buffer);
  } catch {
    return {
      authenticated: false,
      ok: false,
      status: response.status,
      code: "adapter_response_invalid",
    };
  }
  const responseTimestamp =
    response.headers.get("x-pentra-response-timestamp") ?? "";
  const responseSignature =
    response.headers.get("x-pentra-response-signature") ?? "";
  const responseVersion =
    response.headers.get("x-pentra-adapter-version") ?? "";
  const responseTime = Number(responseTimestamp);
  if (
    responseVersion !== args.config.adapterVersion ||
    !/^\d{10,12}$/.test(responseTimestamp) ||
    !Number.isSafeInteger(responseTime) ||
    Math.abs(Math.floor(Date.now() / 1000) - responseTime) > 5 * 60 ||
    !HEX_64.test(responseSignature)
  ) {
    return {
      authenticated: false,
      ok: false,
      status: response.status,
      code: "adapter_response_invalid",
    };
  }
  const material = await responseMaterial({
    nonce: args.nonce,
    timestamp: responseTimestamp,
    body: responseBytes,
  });
  let authenticated = false;
  for (const secret of args.config.verificationSecrets) {
    authenticated = await verifyHmac(secret, material, responseSignature) ||
      authenticated;
  }
  if (!authenticated) {
    return {
      authenticated: false,
      ok: false,
      status: response.status,
      code: "adapter_response_invalid",
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      responseBytes,
    ));
  } catch {
    payload = null;
  }
  if (
    !plainObject(payload) ||
    payload.version !== MANAGED_SES_PROTOCOL_VERSION ||
    typeof payload.ok !== "boolean"
  ) {
    return {
      authenticated: false,
      ok: false,
      status: response.status,
      code: "adapter_response_invalid",
    };
  }
  if (payload.ok === true && response.ok && plainObject(payload.receipt)) {
    return {
      authenticated: true,
      ok: true,
      status: response.status,
      receipt: payload.receipt,
    };
  }
  if (payload.ok === false && typeof payload.code === "string" &&
      /^[a-z][a-z0-9_]{1,63}$/.test(payload.code)) {
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      authenticated: true,
      ok: false,
      status: response.status,
      code: payload.code,
      ...(Number.isSafeInteger(retryAfter) && retryAfter >= 1 &&
          retryAfter <= 900
        ? { retryAfterSeconds: retryAfter }
        : {}),
    };
  }
  return {
    authenticated: false,
    ok: false,
    status: response.status,
    code: "adapter_response_invalid",
  };
}

type ManagedSesBoundResourceReceipt = {
  state: "provisioning" | "ready" | "blocked" | "releasing" | "released";
  operationKey: string;
  generation: number;
  adapterVersion: string;
  updatedAt: number;
  fromEmail?: string;
  verifiedAt?: number;
  resourceReceipt?: string;
  eventCanaryRequired?: true;
  inboundCanaryRequired?: true;
  inboundCanary?: ManagedSesInboundCanaryReceipt;
  code?: string;
  nextEligibleAt?: number;
};

export type ManagedSesResourceReceipt =
  | { state: "missing" }
  | ManagedSesBoundResourceReceipt;

export type ManagedSesInboundCanaryReceipt = {
  operationKey: string;
  inboxBinding: string;
  relayConfigurationHash: string;
  retentionPolicyHash: string;
  classifications: ["reply", "stop"];
  verifiedAt: number;
  inboundCanaryReceipt: string;
};

export function parseManagedSesInboundCanaryReceipt(
  value: Record<string, unknown>,
): ManagedSesInboundCanaryReceipt | null {
  if (
    typeof value.operationKey !== "string" ||
    !OPAQUE_KEY.test(value.operationKey) ||
    typeof value.inboxBinding !== "string" ||
    !HEX_64.test(value.inboxBinding) ||
    typeof value.relayConfigurationHash !== "string" ||
    !HEX_64.test(value.relayConfigurationHash) ||
    typeof value.retentionPolicyHash !== "string" ||
    !HEX_64.test(value.retentionPolicyHash) ||
    !Array.isArray(value.classifications) ||
    value.classifications.length !== 2 ||
    value.classifications[0] !== "reply" ||
    value.classifications[1] !== "stop" ||
    !Number.isSafeInteger(value.verifiedAt) ||
    Number(value.verifiedAt) <= 0 ||
    typeof value.inboundCanaryReceipt !== "string" ||
    !HEX_64.test(value.inboundCanaryReceipt)
  ) return null;
  return value as ManagedSesInboundCanaryReceipt;
}

export type ManagedSesInboundCanaryActivationReceipt = {
  operationKey: string;
  generation: number;
  adapterVersion: string;
  updatedAt: number;
  inboundCanary: ManagedSesInboundCanaryReceipt;
};

export function parseManagedSesInboundCanaryActivationReceipt(
  value: Record<string, unknown>,
): ManagedSesInboundCanaryActivationReceipt | null {
  if (
    typeof value.operationKey !== "string" ||
    !OPAQUE_KEY.test(value.operationKey) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION.test(value.adapterVersion) ||
    !Number.isSafeInteger(value.updatedAt) ||
    Number(value.updatedAt) <= 0 ||
    !plainObject(value.inboundCanary)
  ) return null;
  const inboundCanary = parseManagedSesInboundCanaryReceipt(
    value.inboundCanary,
  );
  if (!inboundCanary) return null;
  return { ...value, inboundCanary } as
    ManagedSesInboundCanaryActivationReceipt;
}

export function parseManagedSesResourceReceipt(
  value: Record<string, unknown>,
): ManagedSesResourceReceipt | null {
  const state = value.state;
  if (state === "missing") {
    return Object.keys(value).length === 1
      ? { state: "missing" }
      : null;
  }
  if (![
    "provisioning",
    "ready",
    "blocked",
    "releasing",
    "released",
  ].includes(String(state))) return null;
  if (
    typeof value.operationKey !== "string" ||
    !OPAQUE_KEY.test(value.operationKey) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION.test(value.adapterVersion) ||
    !Number.isSafeInteger(value.updatedAt) ||
    Number(value.updatedAt) <= 0
  ) return null;
  if (state === "ready") {
    const email = String(value.fromEmail ?? "").trim().toLowerCase();
    const senderDomain = normalizeManagedSesDomain(email.split("@")[1] ?? "");
    if (
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,63}$/i.test(email) ||
      senderDomain !== MANAGED_SES_PLATFORM_SENDER_DOMAIN ||
      !Number.isSafeInteger(value.verifiedAt) ||
      Number(value.verifiedAt) <= 0 ||
      typeof value.resourceReceipt !== "string" ||
      !HEX_64.test(value.resourceReceipt) ||
      value.eventCanaryRequired !== true ||
      value.inboundCanaryRequired !== true
    ) return null;
  }
  if (
    value.inboundCanary !== undefined &&
    (!plainObject(value.inboundCanary) ||
      !parseManagedSesInboundCanaryReceipt(value.inboundCanary))
  ) return null;
  if (
    value.code !== undefined &&
    (typeof value.code !== "string" ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(value.code))
  ) return null;
  return value as ManagedSesResourceReceipt;
}

type ManagedSesBoundSendReceipt = {
  state:
    | "external_attempted"
    | "submitted"
    | "event_confirmed"
    | "event_confirmed_after_disposition"
    | "quarantined_no_replay"
    | "quarantined_integrity"
    | "terminal_rejected";
  operationKey: string;
  resourceOperationKey: string;
  generation: number;
  adapterVersion: string;
  sequenceStep: number;
  purpose: "outreach" | "rfc_message_id_canary" | "inbound_relay_canary";
  updatedAt: number;
  providerMessageIdDigest?: string;
  rfcMessageIdDigest?: string;
  threadReceipt?: string;
  noReplay?: true;
  code?: string;
  terminalDeliveryEvent?: {
    eventType: "bounced" | "complaint" | "rejected" | "rendering_failed";
    occurredAt: string;
    eventReceipt: string;
  };
};

export type ManagedSesSendReceipt =
  | { state: "missing" }
  | ManagedSesBoundSendReceipt;

export function parseManagedSesSendReceipt(
  value: Record<string, unknown>,
): ManagedSesSendReceipt | null {
  const state = String(value.state ?? "");
  if (state === "missing") {
    return Object.keys(value).length === 1
      ? { state: "missing" }
      : null;
  }
  if (![
    "external_attempted",
    "submitted",
    "event_confirmed",
    "event_confirmed_after_disposition",
    "quarantined_no_replay",
    "quarantined_integrity",
    "terminal_rejected",
  ].includes(state)) return null;
  if (
    typeof value.operationKey !== "string" ||
    !OPAQUE_KEY.test(value.operationKey) ||
    typeof value.resourceOperationKey !== "string" ||
    !OPAQUE_KEY.test(value.resourceOperationKey) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION.test(value.adapterVersion) ||
    !Number.isSafeInteger(value.sequenceStep) ||
    Number(value.sequenceStep) < 0 ||
    Number(value.sequenceStep) > 2 ||
    ![
      "outreach",
      "rfc_message_id_canary",
      "inbound_relay_canary",
    ].includes(String(value.purpose)) ||
    !Number.isSafeInteger(value.updatedAt) ||
    Number(value.updatedAt) <= 0
  ) return null;
  if (
    state === "quarantined_integrity" &&
    (value.noReplay !== true ||
      value.code !== "provider_receipt_mismatch" ||
      typeof value.providerMessageIdDigest !== "string" ||
      !HEX_64.test(value.providerMessageIdDigest) ||
      typeof value.rfcMessageIdDigest !== "string" ||
      !HEX_64.test(value.rfcMessageIdDigest) ||
      typeof value.threadReceipt !== "string" ||
      !OPAQUE_KEY.test(value.threadReceipt))
  ) return null;
  const accepted = [
    "submitted",
    "event_confirmed",
    "event_confirmed_after_disposition",
  ].includes(state);
  if (
    accepted &&
    (typeof value.providerMessageIdDigest !== "string" ||
      !HEX_64.test(value.providerMessageIdDigest) ||
      typeof value.rfcMessageIdDigest !== "string" ||
      !HEX_64.test(value.rfcMessageIdDigest) ||
      typeof value.threadReceipt !== "string" ||
      !OPAQUE_KEY.test(value.threadReceipt))
  ) return null;
  if (
    value.providerMessageIdDigest !== undefined &&
    (typeof value.providerMessageIdDigest !== "string" ||
      !HEX_64.test(value.providerMessageIdDigest))
  ) return null;
  if (
    value.rfcMessageIdDigest !== undefined &&
    (typeof value.rfcMessageIdDigest !== "string" ||
      !HEX_64.test(value.rfcMessageIdDigest))
  ) return null;
  if (
    value.threadReceipt !== undefined &&
    (typeof value.threadReceipt !== "string" ||
      !OPAQUE_KEY.test(value.threadReceipt))
  ) return null;
  if (value.terminalDeliveryEvent !== undefined) {
    if (
      !["event_confirmed", "event_confirmed_after_disposition"].includes(
        state,
      ) ||
      !plainObject(value.terminalDeliveryEvent) ||
      Object.keys(value.terminalDeliveryEvent).sort().join(",") !==
        "eventReceipt,eventType,occurredAt" ||
      ![
        "bounced",
        "complaint",
        "rejected",
        "rendering_failed",
      ].includes(String(value.terminalDeliveryEvent.eventType)) ||
      typeof value.terminalDeliveryEvent.occurredAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
        value.terminalDeliveryEvent.occurredAt,
      ) ||
      !Number.isFinite(Date.parse(value.terminalDeliveryEvent.occurredAt)) ||
      typeof value.terminalDeliveryEvent.eventReceipt !== "string" ||
      !HEX_64.test(value.terminalDeliveryEvent.eventReceipt)
    ) return null;
  }
  return value as ManagedSesSendReceipt;
}

export type ManagedSesEventPayload = {
  version: 1;
  adapterVersion: string;
  operationKey: string;
  resourceOperationKey: string;
  generation: number;
  sequenceStep: number;
  purpose: "outreach" | "rfc_message_id_canary" | "inbound_relay_canary";
  eventType: "sent" | "delivered" | "bounced" | "complaint" | "delayed" | "rejected" | "rendering_failed";
  occurredAt: string;
  providerMessageIdDigest: string;
  rfcMessageIdDigest: string;
  threadReceipt: string;
  eventReceipt: string;
};

export function parseManagedSesEventPayload(
  text: string,
): ManagedSesEventPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !plainObject(value) ||
    value.version !== MANAGED_SES_PROTOCOL_VERSION ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION.test(value.adapterVersion) ||
    typeof value.operationKey !== "string" ||
    !OPAQUE_KEY.test(value.operationKey) ||
    typeof value.resourceOperationKey !== "string" ||
    !OPAQUE_KEY.test(value.resourceOperationKey) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    !Number.isSafeInteger(value.sequenceStep) ||
    Number(value.sequenceStep) < 0 ||
    Number(value.sequenceStep) > 2 ||
    ![
      "outreach",
      "rfc_message_id_canary",
      "inbound_relay_canary",
    ].includes(String(value.purpose)) ||
    typeof value.eventType !== "string" ||
    !EVENT_TYPES.has(value.eventType) ||
    typeof value.occurredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      value.occurredAt,
    ) ||
    typeof value.providerMessageIdDigest !== "string" ||
    !HEX_64.test(value.providerMessageIdDigest) ||
    typeof value.rfcMessageIdDigest !== "string" ||
    !HEX_64.test(value.rfcMessageIdDigest) ||
    typeof value.threadReceipt !== "string" ||
    !OPAQUE_KEY.test(value.threadReceipt) ||
    typeof value.eventReceipt !== "string" ||
    !HEX_64.test(value.eventReceipt)
  ) return null;
  return value as ManagedSesEventPayload;
}

export async function verifyManagedSesWebhookSignature(args: {
  rawBody: Uint8Array;
  path: string;
  timestampHeader: string | null;
  nonceHeader: string | null;
  signatureHeader: string | null;
  secrets: Array<string | undefined>;
  now: number;
}): Promise<boolean> {
  const timestamp = args.timestampHeader ?? "";
  const nonce = args.nonceHeader ?? "";
  const signature = args.signatureHeader ?? "";
  const timestampSeconds = Number(timestamp);
  if (
    !/^\d{10,12}$/.test(timestamp) ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(args.now / 1000) - timestampSeconds) > 5 * 60 ||
    !OPAQUE_KEY.test(nonce) ||
    !HEX_64.test(signature)
  ) return false;
  const material = await requestMaterial({
    method: "POST",
    path: args.path,
    timestamp,
    nonce,
    body: args.rawBody,
  });
  let valid = false;
  for (const secret of args.secrets) {
    if (!secret || secret.trim().length < 32) continue;
    valid = await verifyHmac(secret.trim(), material, signature) || valid;
  }
  return valid;
}

export async function managedSesSignedResponse(args: {
  body: Uint8Array;
  nonce: string;
  secret: string;
  timestamp?: number;
}): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(
    Math.floor((args.timestamp ?? Date.now()) / 1000),
  );
  return {
    timestamp,
    signature: await hmacHex(
      args.secret,
      await responseMaterial({ nonce: args.nonce, timestamp, body: args.body }),
    ),
  };
}

export async function managedSesDispositionAuthorization(args: {
  secret: string;
  operationKey: string;
  resourceOperationKey: string;
  generation: number;
  authorizedAtSeconds: number;
}): Promise<string | null> {
  if (
    args.secret.trim().length < 32 ||
    !OPAQUE_KEY.test(args.operationKey) ||
    !OPAQUE_KEY.test(args.resourceOperationKey) ||
    !Number.isSafeInteger(args.generation) ||
    args.generation < 1 ||
    !Number.isSafeInteger(args.authorizedAtSeconds)
  ) return null;
  return hmacHex(args.secret.trim(), [
    "v1",
    "disposition",
    "quarantine_no_replay",
    args.operationKey,
    args.resourceOperationKey,
    String(args.generation),
    String(args.authorizedAtSeconds),
  ].join("\n"));
}

export async function managedSesInboundCanaryRelayReceipt(args: {
  secret?: string;
  operationKey: string;
  resourceOperationKey: string;
  generation: number;
  adapterVersion: string;
  inboxBinding: string;
  relayConfigurationHash: string;
  retentionPolicyHash: string;
  verifiedAtSeconds: number;
}): Promise<string | null> {
  const secret = args.secret?.trim();
  if (
    !secret ||
    secret.length < 32 ||
    !OPAQUE_KEY.test(args.operationKey) ||
    !OPAQUE_KEY.test(args.resourceOperationKey) ||
    !Number.isSafeInteger(args.generation) ||
    args.generation < 1 ||
    !ADAPTER_VERSION.test(args.adapterVersion) ||
    !HEX_64.test(args.inboxBinding) ||
    !HEX_64.test(args.relayConfigurationHash) ||
    !HEX_64.test(args.retentionPolicyHash) ||
    !Number.isSafeInteger(args.verifiedAtSeconds) ||
    args.verifiedAtSeconds <= 0
  ) return null;
  return hmacHex(secret, [
    "v1",
    "inbound-relay-canary",
    "reply+stop",
    args.adapterVersion,
    args.resourceOperationKey,
    String(args.generation),
    args.operationKey,
    args.inboxBinding,
    args.relayConfigurationHash,
    args.retentionPolicyHash,
    String(args.verifiedAtSeconds),
  ].join("\n"));
}

export function managedSesInboundCanaryCurrent(args: {
  verifiedAt?: number;
  receipt?: string;
  operationKey?: string;
  inboxBinding?: string;
  adapterVersion?: string;
  relayConfigurationHash?: string;
  retentionPolicyHash?: string;
  expectedRelayConfigurationHash?: string;
  expectedRetentionPolicyHash?: string;
  expectedAdapterVersion?: string;
  now: number;
}): boolean {
  return Boolean(
    Number.isFinite(args.verifiedAt) &&
    args.verifiedAt! > 0 &&
    args.verifiedAt! <= args.now + 5 * 60 * 1000 &&
    args.now - args.verifiedAt! <= MANAGED_SES_INBOUND_CANARY_VALID_MS &&
    HEX_64.test(args.receipt ?? "") &&
    OPAQUE_KEY.test(args.operationKey ?? "") &&
    HEX_64.test(args.inboxBinding ?? "") &&
    HEX_64.test(args.relayConfigurationHash ?? "") &&
    args.relayConfigurationHash === args.expectedRelayConfigurationHash &&
    HEX_64.test(args.retentionPolicyHash ?? "") &&
    args.retentionPolicyHash === args.expectedRetentionPolicyHash &&
    ADAPTER_VERSION.test(args.adapterVersion ?? "") &&
    args.adapterVersion === args.expectedAdapterVersion
  );
}

export function managedSesEventCanaryCurrent(args: {
  verifiedAt?: number;
  eventReceipt?: string;
  operationKey?: string;
  providerMessageIdDigest?: string;
  adapterVersion?: string;
  expectedAdapterVersion?: string;
  now: number;
}): boolean {
  return Boolean(
    Number.isFinite(args.verifiedAt) &&
    args.verifiedAt! > 0 &&
    args.verifiedAt! <= args.now + 5 * 60 * 1000 &&
    args.now - args.verifiedAt! <= MANAGED_SES_EVENT_CANARY_VALID_MS &&
    HEX_64.test(args.eventReceipt ?? "") &&
    OPAQUE_KEY.test(args.operationKey ?? "") &&
    HEX_64.test(args.providerMessageIdDigest ?? "") &&
    ADAPTER_VERSION.test(args.adapterVersion ?? "") &&
    args.adapterVersion === args.expectedAdapterVersion
  );
}

export function managedSesInboxReceiptCurrent(args: {
  inbox: Record<string, unknown> | null | undefined;
  now: number;
  expectedAdapterVersion?: string;
}): boolean {
  const inbox = args.inbox;
  const relayConfigurationHash = inboundRelayConfigurationHash({
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
    retentionAudited:
      process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  });
  const retentionPolicyHash =
    process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH;
  return Boolean(
    inbox &&
    inbox.provider === MANAGED_SES_TRANSPORT &&
    inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
    inbox.credentialSource === "managed_adapter" &&
    typeof inbox.managedTransportOperationKey === "string" &&
    OPAQUE_KEY.test(inbox.managedTransportOperationKey) &&
    Number.isSafeInteger(inbox.managedTransportGeneration) &&
    Number(inbox.managedTransportGeneration) >= 1 &&
    typeof inbox.managedTransportAdapterVersion === "string" &&
    inbox.managedTransportAdapterVersion === args.expectedAdapterVersion &&
    typeof inbox.managedTransportResourceReceipt === "string" &&
    HEX_64.test(inbox.managedTransportResourceReceipt) &&
    Number.isFinite(inbox.managedTransportResourceVerifiedAt) &&
    Number(inbox.managedTransportResourceVerifiedAt) > 0 &&
    managedSesEventCanaryCurrent({
      verifiedAt: Number(inbox.managedTransportEventCanaryVerifiedAt),
      eventReceipt:
        typeof inbox.managedTransportEventCanaryReceipt === "string"
          ? inbox.managedTransportEventCanaryReceipt
          : undefined,
      operationKey:
        typeof inbox.managedTransportEventCanaryOperationKey === "string"
          ? inbox.managedTransportEventCanaryOperationKey
          : undefined,
      providerMessageIdDigest:
        typeof inbox.managedTransportEventProviderMessageIdDigest === "string"
          ? inbox.managedTransportEventProviderMessageIdDigest
          : undefined,
      adapterVersion:
        typeof inbox.managedTransportAdapterVersion === "string"
          ? inbox.managedTransportAdapterVersion
          : undefined,
      expectedAdapterVersion: args.expectedAdapterVersion,
      now: args.now,
    }) &&
    managedSesInboundCanaryCurrent({
      verifiedAt: Number(inbox.managedTransportInboundCanaryVerifiedAt),
      receipt:
        typeof inbox.managedTransportInboundCanaryReceipt === "string"
          ? inbox.managedTransportInboundCanaryReceipt
          : undefined,
      operationKey:
        typeof inbox.managedTransportInboundCanaryOperationKey === "string"
          ? inbox.managedTransportInboundCanaryOperationKey
          : undefined,
      inboxBinding:
        typeof inbox.managedTransportInboundCanaryInboxBinding === "string"
          ? inbox.managedTransportInboundCanaryInboxBinding
          : undefined,
      adapterVersion:
        typeof inbox.managedTransportInboundCanaryAdapterVersion === "string"
          ? inbox.managedTransportInboundCanaryAdapterVersion
          : undefined,
      relayConfigurationHash:
        typeof inbox.managedTransportInboundCanaryRelayConfigurationHash ===
            "string"
          ? inbox.managedTransportInboundCanaryRelayConfigurationHash
          : undefined,
      retentionPolicyHash:
        typeof inbox.managedTransportInboundCanaryRetentionPolicyHash ===
            "string"
          ? inbox.managedTransportInboundCanaryRetentionPolicyHash
          : undefined,
      expectedRelayConfigurationHash: relayConfigurationHash ?? undefined,
      expectedRetentionPolicyHash: retentionPolicyHash,
      expectedAdapterVersion: args.expectedAdapterVersion,
      now: args.now,
    })
  );
}

export function managedSesGlobalPacingDecision(args: {
  attemptedToday?: number;
  attemptedTodayDay?: string;
  lastAttemptAt?: number;
  now: number;
}): { allowed: boolean; reason: string; nextEligibleAt?: number } {
  const day = new Date(args.now).toISOString().slice(0, 10);
  const attemptedToday = args.attemptedTodayDay === day
    ? Math.max(0, Math.floor(args.attemptedToday ?? 0))
    : 0;
  if (attemptedToday >= MANAGED_SES_GLOBAL_DAILY_ATTEMPT_CAP) {
    const date = new Date(args.now);
    return {
      allowed: false,
      reason: "Managed sender global daily cap reached.",
      nextEligibleAt: Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + 1,
      ),
    };
  }
  if (
    Number.isFinite(args.lastAttemptAt) &&
    args.now - args.lastAttemptAt! < MANAGED_SES_GLOBAL_MIN_ATTEMPT_INTERVAL_MS
  ) {
    return {
      allowed: false,
      reason: "Managed sender global pacing is active.",
      nextEligibleAt:
        args.lastAttemptAt! + MANAGED_SES_GLOBAL_MIN_ATTEMPT_INTERVAL_MS,
    };
  }
  return { allowed: true, reason: "Managed sender global pacing permits one attempt." };
}

export function managedSesScopedPacingDecision(args: {
  attemptedToday?: number;
  attemptedTodayDay?: string;
  lastAttemptAt?: number;
  now: number;
  dailyCap: number;
  minimumIntervalMs: number;
  scope: "account" | "mailbox";
}): { allowed: boolean; reason: string; nextEligibleAt?: number } {
  const day = new Date(args.now).toISOString().slice(0, 10);
  const attemptedToday = args.attemptedTodayDay === day
    ? Math.max(0, Math.floor(args.attemptedToday ?? 0))
    : 0;
  if (attemptedToday >= args.dailyCap) {
    const date = new Date(args.now);
    return {
      allowed: false,
      reason: `managed_ses_${args.scope}_daily_attempt_cap`,
      nextEligibleAt: Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + 1,
      ),
    };
  }
  if (
    Number.isFinite(args.lastAttemptAt) &&
    args.now - args.lastAttemptAt! < args.minimumIntervalMs
  ) {
    return {
      allowed: false,
      reason: `managed_ses_${args.scope}_minimum_attempt_interval`,
      nextEligibleAt: args.lastAttemptAt! + args.minimumIntervalMs,
    };
  }
  return { allowed: true, reason: "managed_ses_pacing_allowed" };
}
