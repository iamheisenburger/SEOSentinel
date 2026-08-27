"use node";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  smartleadRuntimeIssues,
  type SmartleadCanaryKind,
} from "./smartlead.ts";

export type SmartleadProviderBinding = {
  clientId: number;
  mailboxId: number;
  campaignId?: number;
  leadId?: number;
  webhookId?: number;
};

export type SmartleadNodeConfig = {
  apiKey: string;
  encryptionKey: Buffer;
  webhookUrl: string;
};

const CANARY_EMAIL_ENV: Record<SmartleadCanaryKind, string> = {
  delivery: "SMARTLEAD_CANARY_DELIVERY_EMAIL",
  reply: "SMARTLEAD_CANARY_REPLY_EMAIL",
  bounce: "SMARTLEAD_CANARY_BOUNCE_EMAIL",
  unsubscribe: "SMARTLEAD_CANARY_UNSUBSCRIBE_EMAIL",
};

export function smartleadCanaryTarget(kind: SmartleadCanaryKind): string | null {
  const value = process.env[CANARY_EMAIL_ENV[kind]]?.trim().toLowerCase() ?? "";
  return /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,63}$/i.test(value) ? value : null;
}

export function smartleadNodeConfig(): SmartleadNodeConfig | null {
  const apiKey = process.env.SMARTLEAD_API_KEY?.trim() ?? "";
  const rawKey = process.env.SMARTLEAD_BINDING_ENCRYPTION_KEY?.trim() ?? "";
  const webhookUrl = process.env.SMARTLEAD_WEBHOOK_URL?.trim() ?? "";
  let encryptionKey = Buffer.alloc(0);
  try {
    encryptionKey = /^[a-f0-9]{64}$/i.test(rawKey)
      ? Buffer.from(rawKey, "hex")
      : Buffer.from(rawKey, "base64");
  } catch {
    encryptionKey = Buffer.alloc(0);
  }
  let parsedWebhook: URL | null = null;
  try { parsedWebhook = new URL(webhookUrl); } catch { parsedWebhook = null; }
  if (
    smartleadRuntimeIssues({
      apiKey,
      webhookSecret: process.env.SMARTLEAD_WEBHOOK_SECRET,
      smartSendersAccess: process.env.SMARTLEAD_SMART_SENDERS_ACCESS,
    }).length > 0 || encryptionKey.length !== 32 ||
    !parsedWebhook || parsedWebhook.protocol !== "https:" ||
    parsedWebhook.username || parsedWebhook.password || parsedWebhook.search ||
    parsedWebhook.hash || !parsedWebhook.pathname.endsWith("/webhooks/smartlead")
  ) return null;
  return { apiKey, encryptionKey, webhookUrl: parsedWebhook.toString() };
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function smartleadRecords(value: unknown): Record<string, unknown>[] {
  const container = record(value);
  const data = container && "data" in container ? container.data : value;
  if (Array.isArray(data)) {
    return data.map(record).filter((row): row is Record<string, unknown> => Boolean(row));
  }
  const nested = record(data);
  const candidates = nested?.leads ?? nested?.campaigns ?? nested?.data;
  return Array.isArray(candidates)
    ? candidates.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
}

export function smartleadPositiveInteger(value: unknown): number | null {
  return positiveInteger(value);
}

export function encryptSmartleadProviderBinding(
  config: SmartleadNodeConfig,
  binding: SmartleadProviderBinding,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(binding), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptSmartleadProviderBinding(
  config: SmartleadNodeConfig,
  encrypted: string | undefined,
): SmartleadProviderBinding | null {
  if (!encrypted) return null;
  const [version, ivValue, ciphertextValue, tagValue] = encrypted.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue || !tagValue) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      config.encryptionKey,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = record(JSON.parse(plaintext));
    const clientId = positiveInteger(parsed?.clientId);
    const mailboxId = positiveInteger(parsed?.mailboxId);
    const campaignId = positiveInteger(parsed?.campaignId) ?? undefined;
    const leadId = positiveInteger(parsed?.leadId) ?? undefined;
    const webhookId = positiveInteger(parsed?.webhookId) ?? undefined;
    return clientId && mailboxId
      ? { clientId, mailboxId, campaignId, leadId, webhookId }
      : null;
  } catch {
    return null;
  }
}

export async function smartleadCoreRequest(args: {
  config: SmartleadNodeConfig;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const url = new URL(args.path, "https://server.smartlead.ai");
  url.searchParams.set("api_key", args.config.apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: args.method ?? "GET",
      headers: args.body ? { "Content-Type": "application/json" } : undefined,
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 256 * 1024) {
      return { ok: false, status: 502, json: null };
    }
    const text = await response.text();
    if (text.length > 256 * 1024) return { ok: false, status: 502, json: null };
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timeout);
  }
}
