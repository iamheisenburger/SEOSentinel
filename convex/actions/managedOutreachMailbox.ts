"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
} from "../lib/managedOutreachMailbox.ts";
import {
  MANAGED_SES_PLATFORM_RELAY_DOMAIN,
  callManagedSesAdapter,
  managedSesAdapterConfiguration,
  managedSesDispositionAuthorization,
  managedSesInboundCanaryRelayReceipt,
  managedSesSha256Hex,
  parseManagedSesResourceReceipt,
  parseManagedSesSendReceipt,
} from "../lib/managedSes.ts";
import {
  SMARTLEAD_ADAPTER_VERSION,
  SMARTLEAD_MANAGED_TRANSPORT,
  smartleadRuntimeIssues,
} from "../lib/smartlead.ts";
import { sha256Hex } from "../lib/publicationArtifact.ts";

function adapterConfig() {
  return managedSesAdapterConfiguration({
    endpoint: process.env.MANAGED_SES_ADAPTER_URL,
    adapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
    signingSecret: process.env.MANAGED_SES_ADAPTER_HMAC_SECRET,
    nextVerificationSecret:
      process.env.MANAGED_SES_ADAPTER_HMAC_SECRET_NEXT,
  });
}

function nonce(): string {
  return randomBytes(32).toString("base64url");
}

async function txtRecords(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join("").trim());
  } catch {
    return [];
  }
}

async function hasCname(name: string): Promise<boolean> {
  try { return (await resolveCname(name)).length > 0; } catch { return false; }
}

/** Public DNS proof only. Provider assertions are insufficient for sender
 * authentication; the exact observed SPF, DMARC and bounded DKIM selector
 * evidence is hashed and the raw records are deliberately not persisted. */
async function smartleadDnsAuthenticationReceipt(
  domain: string,
): Promise<string | undefined> {
  const selectors = [
    "default", "google", "selector1", "selector2", "s1", "s2",
    "k1", "k2", "dkim", "mail",
  ];
  const [spf, dmarc, ...dkim] = await Promise.all([
    txtRecords(domain),
    txtRecords(`_dmarc.${domain}`),
    ...selectors.map(async (selector) => {
      const name = `${selector}._domainkey.${domain}`;
      const [txt, cname] = await Promise.all([txtRecords(name), hasCname(name)]);
      return { selector, txt, cname };
    }),
  ]);
  const spfEvidence = spf.filter((value) => /^v=spf1\b/i.test(value)).sort();
  const dmarcEvidence = dmarc.filter((value) => /^v=dmarc1\b/i.test(value)).sort();
  const dkimEvidence = dkim.filter((entry) =>
    entry.cname || entry.txt.some((value) => /^v=dkim1\b/i.test(value))
  ).map((entry) => ({
    selector: entry.selector,
    cname: entry.cname,
    txt: entry.txt.filter((value) => /^v=dkim1\b/i.test(value)).sort(),
  }));
  if (!spfEvidence.length || !dmarcEvidence.length || !dkimEvidence.length) {
    return undefined;
  }
  return sha256Hex(JSON.stringify({
    version: 1,
    domain,
    spfEvidence,
    dmarcEvidence,
    dkimEvidence,
  }));
}

type SmartleadConfig = {
  apiKey: string;
  vendorId: string;
  clientEmailDomain: string;
  encryptionKey: Buffer;
};

function smartleadConfig(): SmartleadConfig | null {
  const apiKey = process.env.SMARTLEAD_API_KEY?.trim() ?? "";
  const vendorId = process.env.SMARTLEAD_SMART_SENDERS_VENDOR_ID?.trim() ?? "";
  const clientEmailDomain = process.env.SMARTLEAD_CLIENT_EMAIL_DOMAIN
    ?.trim().toLowerCase() ?? "";
  const rawKey = process.env.SMARTLEAD_BINDING_ENCRYPTION_KEY?.trim() ?? "";
  let encryptionKey = Buffer.alloc(0);
  let webhookUrl: URL | null = null;
  try {
    webhookUrl = new URL(process.env.SMARTLEAD_WEBHOOK_URL?.trim() ?? "");
  } catch {
    webhookUrl = null;
  }
  try {
    encryptionKey = /^[a-f0-9]{64}$/i.test(rawKey)
      ? Buffer.from(rawKey, "hex")
      : Buffer.from(rawKey, "base64");
  } catch {
    encryptionKey = Buffer.alloc(0);
  }
  if (
    smartleadRuntimeIssues({
      apiKey,
      webhookSecret: process.env.SMARTLEAD_WEBHOOK_SECRET,
      smartSendersAccess: process.env.SMARTLEAD_SMART_SENDERS_ACCESS,
    }).length > 0 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(vendorId) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      clientEmailDomain,
    ) ||
    encryptionKey.length !== 32
    || !webhookUrl || webhookUrl.protocol !== "https:" ||
    !webhookUrl.pathname.endsWith("/webhooks/smartlead")
  ) return null;
  return { apiKey, vendorId, clientEmailDomain, encryptionKey };
}

function encryptSmartleadBinding(
  config: SmartleadConfig,
  binding: { clientId: number; mailboxId?: number },
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

function decryptSmartleadBinding(
  config: SmartleadConfig,
  encrypted: string | undefined,
): { clientId: number; mailboxId?: number } | null {
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
    const mailboxId = positiveInteger(parsed?.mailboxId) ?? undefined;
    return clientId ? { clientId, mailboxId } : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function smartleadRequest(args: {
  config: SmartleadConfig;
  origin: "core" | "senders";
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const base = args.origin === "senders"
    ? "https://smart-senders.smartlead.ai"
    : "https://server.smartlead.ai";
  const url = new URL(args.path, base);
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

function smartleadData(value: unknown): unknown {
  const envelope = record(value);
  return envelope && "data" in envelope ? envelope.data : value;
}

const provisionArgs = {
  resourceId: v.id("managed_outreach_mailbox_resources"),
  requestId: v.id("managed_provisioning_requests"),
  expectedRequestRevision: v.number(),
  expectedConfigurationRevision: v.number(),
  expectedGeneration: v.number(),
  leaseToken: v.string(),
};

export const provision = internalAction({
  args: provisionArgs,
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runMutation(
      internal.managedOutreachMailbox.getProvisioningOperation,
      args,
    );
    if (!claim) return { accepted: false as const, reason: "fence_changed" };
    if (claim.operation.transport === SMARTLEAD_MANAGED_TRANSPORT) {
      const config = smartleadConfig();
      if (!config || !claim.operation.senderDomainChoice) {
        const receipt = await ctx.runMutation(
          internal.managedOutreachMailbox.recordProvisioningAdapterBlocked,
          {
            ...args,
            reasonCode: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
          },
        );
        return {
          accepted: false as const,
          reason: config
            ? "smartlead_sender_domain_missing"
            : "smartlead_runtime_unavailable",
          recorded: receipt.recorded,
        };
      }
      const configurationHash = sha256Hex(JSON.stringify({
        version: SMARTLEAD_ADAPTER_VERSION,
        operationKey: claim.operation.operationKey,
        generation: claim.operation.generation,
        senderDomain: claim.operation.senderDomainChoice,
        vendorId: config.vendorId,
      }));
      const boundary = await ctx.runMutation(
        internal.managedOutreachMailbox.markProvisioningExternalBoundaryInternal,
        { ...args, adapterVersion: SMARTLEAD_ADAPTER_VERSION },
      );
      if (!boundary.marked) {
        return { accepted: false as const, reason: "fence_changed" };
      }
      const progress = async (reasonCode: string, retryAfterSeconds = 300) =>
        ctx.runMutation(
          internal.managedOutreachMailbox.recordProvisioningAdapterProgress,
          {
            ...args,
            adapterVersion: SMARTLEAD_ADAPTER_VERSION,
            reasonCode,
            retryAfterSeconds,
          },
        );
      const clientEmail = `pentra-${claim.operation.operationKey.slice(0, 24)}@${config.clientEmailDomain}`;
      const clientsResponse = await smartleadRequest({
        config,
        origin: "core",
        path: "/api/v1/client/",
      });
      if (!clientsResponse.ok) {
        await progress("smartlead_client_reconciliation_failed");
        return { accepted: false as const, reason: "smartlead_client_reconciliation_failed" };
      }
      const matchingClients = records(smartleadData(clientsResponse.json)).filter(
        (row) => String(row.email ?? "").trim().toLowerCase() === clientEmail,
      );
      if (matchingClients.length > 1) {
        await progress("smartlead_client_identity_conflict", 900);
        return { accepted: false as const, reason: "smartlead_client_identity_conflict" };
      }
      let clientId = matchingClients.length === 1
        ? positiveInteger(matchingClients[0].id)
        : null;
      if (!clientId) {
        if (claim.operation.providerState.clientRequestedAt) {
          await progress("smartlead_client_ack_ambiguous", 900);
          return { accepted: false as const, reason: "smartlead_client_ack_ambiguous" };
        }
        const marked = await ctx.runMutation(
          internal.managedOutreachMailbox.recordSmartleadProvisioningBoundaryInternal,
          {
            ...args,
            phase: "client",
            configurationHash,
          },
        );
        if (!marked.recorded) {
          return { accepted: false as const, reason: "fence_changed" };
        }
        const created = await smartleadRequest({
          config,
          origin: "core",
          path: "/api/v1/client/save",
          method: "POST",
          body: {
            email: clientEmail,
            name: `Pentra ${claim.operation.operationKey.slice(0, 12)}`,
            permission: ["campaigns", "email_accounts", "leads"],
            is_credit_assigned: false,
          },
        });
        clientId = positiveInteger(record(smartleadData(created.json))?.id);
        if (!created.ok || !clientId) {
          await progress("smartlead_client_ack_ambiguous", 900);
          return { accepted: false as const, reason: "smartlead_client_ack_ambiguous" };
        }
      }
      const clientBinding = encryptSmartleadBinding(config, { clientId });
      const persisted = await ctx.runMutation(
        internal.managedOutreachMailbox.recordSmartleadProvisioningBoundaryInternal,
        {
          ...args,
          phase: "binding",
          encryptedProviderBinding: clientBinding,
          configurationHash,
        },
      );
      if (!persisted.recorded) {
        return { accepted: false as const, reason: "fence_changed" };
      }
      const accountResponse = await smartleadRequest({
        config,
        origin: "core",
        path: `/api/v1/email-accounts/?limit=100&username=${encodeURIComponent(claim.operation.senderDomainChoice)}`,
      });
      if (!accountResponse.ok) {
        await progress("smartlead_mailbox_reconciliation_failed");
        return { accepted: false as const, reason: "smartlead_mailbox_reconciliation_failed" };
      }
      const accounts = records(smartleadData(accountResponse.json)).filter((row) => {
        const email = String(row.from_email ?? row.username ?? "").trim().toLowerCase();
        return email.endsWith(`@${claim.operation.senderDomainChoice}`);
      });
      if (accounts.length > 1) {
        await progress("smartlead_mailbox_identity_conflict", 900);
        return { accepted: false as const, reason: "smartlead_mailbox_identity_conflict" };
      }
      if (accounts.length === 0) {
        if (claim.operation.providerState.mailboxRequestedAt) {
          await progress("smartlead_mailbox_generation_pending", 900);
          return { accepted: false as const, reason: "smartlead_mailbox_generation_pending" };
        }
        const marked = await ctx.runMutation(
          internal.managedOutreachMailbox.recordSmartleadProvisioningBoundaryInternal,
          {
            ...args,
            phase: "mailbox",
            encryptedProviderBinding: clientBinding,
            configurationHash,
          },
        );
        if (!marked.recorded) {
          return { accepted: false as const, reason: "fence_changed" };
        }
        await smartleadRequest({
          config,
          origin: "senders",
          path: "/api/v1/smart-senders/auto-generate-mailboxes",
          method: "POST",
          body: {
            vendor_id: config.vendorId,
            domains: { [claim.operation.senderDomainChoice]: { count: 1 } },
          },
        });
        await progress("smartlead_mailbox_generation_pending", 900);
        return { accepted: false as const, reason: "smartlead_mailbox_generation_pending" };
      }
      const account = accounts[0];
      const mailboxId = positiveInteger(account.id);
      const fromEmail = String(account.from_email ?? "").trim().toLowerCase();
      if (!mailboxId || !fromEmail) {
        await progress("smartlead_mailbox_receipt_invalid", 900);
        return { accepted: false as const, reason: "smartlead_mailbox_receipt_invalid" };
      }
      const assignedClientId = positiveInteger(account.client_id);
      if (assignedClientId && assignedClientId !== clientId) {
        await progress("smartlead_mailbox_client_conflict", 900);
        return { accepted: false as const, reason: "smartlead_mailbox_client_conflict" };
      }
      if (assignedClientId !== clientId) {
        const assignment = await smartleadRequest({
          config,
          origin: "core",
          path: `/api/v1/email-accounts/${mailboxId}`,
          method: "POST",
          body: {
            client_id: clientId,
            from_name: claim.operation.senderProfile.fromName,
            max_email_per_day: 20,
            time_to_wait_in_mins: 15,
          },
        });
        if (!assignment.ok) {
          await progress("smartlead_mailbox_assignment_unverified", 900);
          return { accepted: false as const, reason: "smartlead_mailbox_assignment_unverified" };
        }
      }
      const warmup = record(account.warmup_details);
      const warmupActive = String(warmup?.status ?? "").toUpperCase() === "ACTIVE";
      const warmupReputationScore = Number(
        String(warmup?.warmup_reputation ?? "").replace(/%$/, ""),
      );
      const warmupProviderHealthy = Boolean(
        account.is_smtp_success === true &&
        account.is_imap_success === true &&
        !warmup?.blocked_reason && warmup?.is_warmup_blocked !== true,
      );
      if (!warmupActive) {
        const warmupResponse = await smartleadRequest({
          config,
          origin: "core",
          path: `/api/v1/email-accounts/${mailboxId}/warmup`,
          method: "POST",
          body: {
            warmup_enabled: true,
            total_warmup_per_day: 10,
            daily_rampup: 5,
            reply_rate_percentage: 30,
            auto_adjust_warmup: true,
            is_rampup_enabled: true,
          },
        });
        if (!warmupResponse.ok) {
          await progress("smartlead_warmup_activation_unverified", 900);
          return { accepted: false as const, reason: "smartlead_warmup_activation_unverified" };
        }
      }
      const warmupStartedAt = Date.parse(String(
        warmup?.warmup_created_at ?? warmup?.created_at ?? "",
      ));
      const encryptedProviderBinding = encryptSmartleadBinding(config, {
        clientId,
        mailboxId,
      });
      const senderDomain = fromEmail.split("@")[1] ?? "";
      const domainAuthenticationReceipt =
        await smartleadDnsAuthenticationReceipt(senderDomain);
      return ctx.runMutation(internal.outreach.installSmartleadManagedInboxInternal, {
        ...args,
        siteId: claim.installTarget.siteId,
        fromEmail,
        encryptedProviderBinding,
        configurationHash,
        providerVerifiedAt: Date.now(),
        warmupStartedAt: Number.isFinite(warmupStartedAt)
          ? warmupStartedAt
          : undefined,
        warmupProviderActive: warmupActive,
        warmupProviderHealthy,
        warmupReputationScore: Number.isFinite(warmupReputationScore)
          ? warmupReputationScore
          : undefined,
        domainAuthenticationReceipt,
      });
    }
    const config = adapterConfig();
    if (!config) {
      const receipt = await ctx.runMutation(
        internal.managedOutreachMailbox.recordProvisioningAdapterBlocked,
        {
          ...args,
          reasonCode: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
        },
      );
      return {
        accepted: false as const,
        reason: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
        recorded: receipt.recorded,
      };
    }
    const boundary = await ctx.runMutation(
      internal.managedOutreachMailbox.markProvisioningExternalBoundaryInternal,
      { ...args, adapterVersion: config.adapterVersion },
    );
    if (!boundary.marked) {
      return { accepted: false as const, reason: "fence_changed" };
    }
    const response = await callManagedSesAdapter({
      config,
      route: "provision",
      nonce: nonce(),
      payload: {
        operationKey: claim.operation.operationKey,
        generation: claim.operation.generation,
        adapterVersion: config.adapterVersion,
      },
      timeoutMs: 105_000,
    });
    if (!response.authenticated || !response.ok) {
      const progress = await ctx.runMutation(
        internal.managedOutreachMailbox.recordProvisioningAdapterProgress,
        {
          ...args,
          adapterVersion: config.adapterVersion,
          reasonCode: response.authenticated
            ? response.code
            : response.code,
          retryAfterSeconds: response.authenticated
            ? response.retryAfterSeconds
            : 60,
        },
      );
      return {
        accepted: false as const,
        reason: response.code,
        recorded: progress.recorded,
      };
    }
    const receipt = parseManagedSesResourceReceipt(response.receipt);
    if (
      !receipt ||
      receipt.state === "missing" ||
      receipt.operationKey !== claim.operation.operationKey ||
      receipt.generation !== claim.operation.generation ||
      receipt.adapterVersion !== config.adapterVersion
    ) {
      const progress = await ctx.runMutation(
        internal.managedOutreachMailbox.recordProvisioningAdapterProgress,
        {
          ...args,
          adapterVersion: config.adapterVersion,
          reasonCode: "managed_ses_receipt_invalid",
          retryAfterSeconds: 60,
        },
      );
      return { accepted: false as const, reason: "managed_ses_receipt_invalid", recorded: progress.recorded };
    }
    if (receipt.state === "ready") {
      const providerVerifiedAt = receipt.verifiedAt! * 1_000;
      return ctx.runMutation(internal.outreach.installManagedSesInboxInternal, {
        ...args,
        siteId: claim.installTarget.siteId,
        adapterVersion: config.adapterVersion,
        fromEmail: receipt.fromEmail!,
        resourceReceipt: receipt.resourceReceipt!,
        providerVerifiedAt,
      });
    }
    const progress = await ctx.runMutation(
      internal.managedOutreachMailbox.recordProvisioningAdapterProgress,
      {
        ...args,
        adapterVersion: config.adapterVersion,
        reasonCode: receipt.code ?? `managed_ses_${receipt.state}`,
        retryAfterSeconds: receipt.nextEligibleAt
          ? Math.max(30, receipt.nextEligibleAt - Math.floor(Date.now() / 1000))
          : 60,
      },
    );
    return { accepted: false as const, reason: receipt.state, recorded: progress.recorded };
  },
});

export const sendManagedSesEventCanary = internalAction({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    inboxId: v.id("outreach_inboxes"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const config = adapterConfig();
    const recipient = process.env.MANAGED_SES_EVENT_CANARY_RECIPIENT
      ?.trim().toLowerCase();
    if (
      !config ||
      !recipient ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,63}$/i.test(recipient)
    ) return { accepted: false as const, reason: "managed_ses_canary_unavailable" };
    const recipientHash = await managedSesSha256Hex(recipient);
    const claim = await ctx.runMutation(
      internal.managedOutreachMailbox.claimManagedSesEventCanary,
      { ...args, recipientHash },
    );
    if (!claim.claimed) return { accepted: false as const, reason: claim.reason };
    const boundary = await ctx.runMutation(
      internal.managedOutreachMailbox.markManagedSesEventCanaryExternalBoundary,
      { canaryId: claim.canaryId, operationKey: claim.operationKey },
    );
    if (!boundary.marked) {
      if ("deferred" in boundary && boundary.deferred) {
        return {
          accepted: false as const,
          reason: "managed_ses_canary_pacing_deferred" as const,
          retryAt: boundary.nextEligibleAt,
        };
      }
      await ctx.runMutation(
        internal.managedOutreachMailbox.recordManagedSesEventCanaryAttempt,
        {
          canaryId: claim.canaryId,
          operationKey: claim.operationKey,
          state: boundary.externalAttempted ? "unverified" : "failed",
        },
      );
      if (!boundary.externalAttempted) {
        await ctx.scheduler.runAfter(
          30 * 60 * 1000,
          internal.actions.managedOutreachMailbox.sendManagedSesEventCanary,
          args,
        );
      }
      return {
        accepted: false as const,
        reason: boundary.externalAttempted
          ? "managed_ses_canary_boundary_ambiguous"
          : "managed_ses_canary_boundary_changed",
      };
    }
    const replyTo = `reply-${claim.operationKey.slice(0, 48)}@${MANAGED_SES_PLATFORM_RELAY_DOMAIN}`;
    const response = await callManagedSesAdapter({
      config,
      route: "send",
      nonce: nonce(),
      payload: {
        purpose: "inbound_relay_canary",
        operationKey: claim.operationKey,
        resourceOperationKey: claim.resourceOperationKey,
        generation: claim.generation,
        adapterVersion: claim.adapterVersion,
        inboxBinding: claim.inboxBinding,
        sequenceStep: 0,
        toEmail: recipient,
        displayName: claim.fromName,
        subject: "Pentra managed sender delivery-event verification",
        text: "This non-prospect message verifies Pentra's signed managed delivery event path.",
        replyTo,
        unsubscribeUrl:
          `https://pentra.dev/unsubscribe/canary-${claim.operationKey}`,
      },
      timeoutMs: 30_000,
    });
    let state: "accepted" | "unverified" | "failed" = "unverified";
    let providerMessageIdDigest: string | undefined;
    let rfcMessageIdDigest: string | undefined;
    let threadReceipt: string | undefined;
    if (response.authenticated && response.ok) {
      const receipt = parseManagedSesSendReceipt(response.receipt);
      if (
        receipt &&
        receipt.state !== "missing" &&
        receipt.operationKey === claim.operationKey &&
        receipt.resourceOperationKey === claim.resourceOperationKey &&
        receipt.generation === claim.generation &&
        receipt.adapterVersion === claim.adapterVersion &&
        receipt.sequenceStep === 0 &&
        receipt.purpose === "inbound_relay_canary" &&
        receipt.updatedAt <= Math.floor(Date.now() / 1_000) + 5 * 60
      ) {
        if (["submitted", "event_confirmed", "event_confirmed_after_disposition"].includes(receipt.state)) {
          state = "accepted";
          providerMessageIdDigest = receipt.providerMessageIdDigest;
          rfcMessageIdDigest = receipt.rfcMessageIdDigest;
          threadReceipt = receipt.threadReceipt;
        } else if (
          ["terminal_rejected", "quarantined_integrity"].includes(
            receipt.state,
          )
        ) {
          state = "failed";
        }
      }
    }
    const recorded = await ctx.runMutation(
      internal.managedOutreachMailbox.recordManagedSesEventCanaryAttempt,
      {
        canaryId: claim.canaryId,
        operationKey: claim.operationKey,
        state,
        providerMessageIdDigest,
        rfcMessageIdDigest,
        threadReceipt,
      },
    );
    return { accepted: state === "accepted", state, recorded: recorded.recorded };
  },
});

export const activateManagedSesInboundCanary = internalAction({
  args: { canaryId: v.id("managed_ses_event_canaries") },
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runMutation(
      internal.managedOutreachMailbox.claimManagedSesInboundCanaryActivation,
      args,
    );
    if (!claim.claimed) {
      return { activated: false as const, reason: claim.reason };
    }
    const config = adapterConfig();
    const relayReceipt = await managedSesInboundCanaryRelayReceipt({
      secret: process.env.MANAGED_SES_INBOUND_CANARY_HMAC_SECRET,
      operationKey: claim.operationKey,
      resourceOperationKey: claim.resourceOperationKey,
      generation: claim.generation,
      adapterVersion: claim.adapterVersion,
      inboxBinding: claim.inboxBinding,
      relayConfigurationHash: claim.relayConfigurationHash,
      retentionPolicyHash: claim.retentionPolicyHash,
      verifiedAtSeconds: claim.verifiedAt,
    });
    if (
      !config ||
      config.adapterVersion !== claim.adapterVersion ||
      !relayReceipt
    ) {
      return ctx.runMutation(
        internal.managedOutreachMailbox.recordManagedSesInboundCanaryActivation,
        {
          canaryId: claim.canaryId,
          leaseToken: claim.leaseToken,
          state: "unverified",
        },
      );
    }
    const boundary = await ctx.runMutation(
      internal.managedOutreachMailbox.markManagedSesInboundCanaryActivationBoundary,
      { canaryId: claim.canaryId, leaseToken: claim.leaseToken },
    );
    if (!boundary.marked) {
      return { activated: false as const, reason: "fence_changed" as const };
    }
    const response = await callManagedSesAdapter({
      config,
      route: "inbound-canary",
      nonce: nonce(),
      payload: {
        adapterVersion: claim.adapterVersion,
        operationKey: claim.operationKey,
        resourceOperationKey: claim.resourceOperationKey,
        generation: claim.generation,
        inboxBinding: claim.inboxBinding,
        classifications: ["reply", "stop"],
        verifiedAt: claim.verifiedAt,
        relayConfigurationHash: claim.relayConfigurationHash,
        retentionPolicyHash: claim.retentionPolicyHash,
        relayReceipt,
      },
      timeoutMs: 30_000,
    });
    const receipt = response.authenticated && response.ok
      ? parseManagedSesResourceReceipt(response.receipt)
      : null;
    const inbound = receipt?.state === "ready"
      ? receipt.inboundCanary
      : undefined;
    const exact = Boolean(
      receipt &&
      inbound &&
      receipt.state === "ready" &&
      receipt.operationKey === claim.resourceOperationKey &&
      receipt.generation === claim.generation &&
      receipt.adapterVersion === claim.adapterVersion &&
      receipt.fromEmail === claim.fromEmail &&
      receipt.resourceReceipt === claim.resourceReceipt &&
      receipt.eventCanaryRequired === true &&
      receipt.inboundCanaryRequired === true &&
      receipt.updatedAt <= Math.floor(Date.now() / 1_000) + 5 * 60 &&
      inbound.operationKey === claim.operationKey &&
      inbound.inboxBinding === claim.inboxBinding &&
      inbound.relayConfigurationHash === claim.relayConfigurationHash &&
      inbound.retentionPolicyHash === claim.retentionPolicyHash &&
      inbound.verifiedAt === claim.verifiedAt,
    );
    return ctx.runMutation(
      internal.managedOutreachMailbox.recordManagedSesInboundCanaryActivation,
      exact && receipt?.state === "ready" && inbound
        ? {
            canaryId: claim.canaryId,
            leaseToken: claim.leaseToken,
            state: "verified",
            operationKey: inbound.operationKey,
            resourceOperationKey: receipt.operationKey,
            generation: receipt.generation,
            adapterVersion: receipt.adapterVersion,
            inboxBinding: inbound.inboxBinding,
            relayConfigurationHash: inbound.relayConfigurationHash,
            retentionPolicyHash: inbound.retentionPolicyHash,
            verifiedAt: inbound.verifiedAt,
            inboundCanaryReceipt: inbound.inboundCanaryReceipt,
          }
        : {
            canaryId: claim.canaryId,
            leaseToken: claim.leaseToken,
            state: "unverified",
          },
    );
  },
});

export const disposeManagedSesAmbiguity = internalAction({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runQuery(
      internal.managedOutreachMailbox.getManagedSesDispositionOperation,
      args,
    );
    if (!claim) return { settled: false as const, reason: "fence_changed" };
    const config = adapterConfig();
    const dispositionSecret =
      process.env.MANAGED_SES_DISPOSITION_HMAC_SECRET?.trim();
    const record = (outcome: {
      state: string;
      providerMessageIdDigest?: string;
      rfcMessageIdDigest?: string;
      threadReceipt?: string;
      receiptUpdatedAt?: number;
      retryAfterSeconds?: number;
    }) => ctx.runMutation(
      internal.managedOutreachMailbox.recordManagedSesDispositionOutcome,
      { ...args, ...outcome },
    );
    const settleTerminalDeliveryEvent = (receipt: {
      operationKey: string;
      resourceOperationKey: string;
      generation: number;
      adapterVersion: string;
      sequenceStep: number;
      purpose: "outreach" | "rfc_message_id_canary" |
        "inbound_relay_canary";
      providerMessageIdDigest?: string;
      rfcMessageIdDigest?: string;
      threadReceipt?: string;
      terminalDeliveryEvent?: {
        eventType: "bounced" | "complaint" | "rejected" |
          "rendering_failed";
        occurredAt: string;
        eventReceipt: string;
      };
    }) => {
      const terminal = receipt.terminalDeliveryEvent;
      if (
        !terminal ||
        !receipt.providerMessageIdDigest ||
        !receipt.rfcMessageIdDigest ||
        !receipt.threadReceipt
      ) return null;
      return ctx.runMutation(internal.outreach.recordManagedSesDeliveryEvent, {
        adapterVersion: receipt.adapterVersion,
        operationKey: receipt.operationKey,
        resourceOperationKey: receipt.resourceOperationKey,
        generation: receipt.generation,
        sequenceStep: receipt.sequenceStep,
        purpose: receipt.purpose,
        eventType: terminal.eventType,
        occurredAt: Date.parse(terminal.occurredAt),
        providerMessageIdDigest: receipt.providerMessageIdDigest,
        rfcMessageIdDigest: receipt.rfcMessageIdDigest,
        threadReceipt: receipt.threadReceipt,
        eventReceipt: terminal.eventReceipt,
      });
    };
    if (
      !config ||
      config.adapterVersion !== claim.adapterVersion ||
      !dispositionSecret ||
      dispositionSecret.length < 32
    ) {
      return record({ state: "adapter_unavailable", retryAfterSeconds: 15 * 60 });
    }

    // Reconcile the immutable send operation first. A lost synchronous send
    // response or signed event may already have settled it; disposition is
    // reserved solely for a still-ambiguous external_attempted row.
    const statusResponse = await callManagedSesAdapter({
      config,
      route: "status",
      nonce: nonce(),
      payload: {
        kind: "send",
        operationKey: claim.operationKey,
        resourceOperationKey: claim.resourceOperationKey,
        generation: claim.generation,
        adapterVersion: claim.adapterVersion,
        sequenceStep: claim.sequenceStep,
        purpose: claim.purpose,
      },
      timeoutMs: 30_000,
    });
    const statusReceipt = statusResponse.authenticated && statusResponse.ok
      ? parseManagedSesSendReceipt(statusResponse.receipt)
      : null;
    if (!statusReceipt) {
      return record({
        state: "status_unverified",
        retryAfterSeconds: statusResponse.authenticated && !statusResponse.ok
          ? statusResponse.retryAfterSeconds ?? 120
          : 120,
      });
    }
    const claimIdentityCount = [
      claim.providerMessageIdDigest,
      claim.rfcMessageIdDigest,
      claim.threadReceipt,
    ].filter((value) => value !== undefined).length;
    const statusIdentityCount = statusReceipt.state === "missing"
      ? 0
      : [
          statusReceipt.providerMessageIdDigest,
          statusReceipt.rfcMessageIdDigest,
          statusReceipt.threadReceipt,
        ].filter((value) => value !== undefined).length;
    const missingConflictsWithEstablishedIdentity =
      statusReceipt.state === "missing" && Boolean(
        claim.providerMessageIdDigest ||
        claim.rfcMessageIdDigest ||
        claim.threadReceipt
      );
    if (
      missingConflictsWithEstablishedIdentity ||
      ![0, 3].includes(claimIdentityCount) ||
      ![0, 3].includes(statusIdentityCount)
    ) {
      return record({ state: "identity_mismatch" });
    }
    const statusEnvelopeMatches = statusReceipt.state === "missing" || (
      statusReceipt.operationKey === claim.operationKey &&
      statusReceipt.resourceOperationKey === claim.resourceOperationKey &&
      statusReceipt.generation === claim.generation &&
      statusReceipt.adapterVersion === claim.adapterVersion &&
      statusReceipt.sequenceStep === claim.sequenceStep &&
      statusReceipt.purpose === claim.purpose &&
      statusReceipt.updatedAt <= Math.floor(Date.now() / 1_000) + 5 * 60
    );
    if (!statusEnvelopeMatches) {
      return record({ state: "status_binding_invalid", retryAfterSeconds: 15 * 60 });
    }
    const statusIdentityMatches = statusReceipt.state === "missing" || (
      (!claim.providerMessageIdDigest ||
        claim.providerMessageIdDigest ===
          statusReceipt.providerMessageIdDigest) &&
      (!claim.rfcMessageIdDigest ||
        claim.rfcMessageIdDigest === statusReceipt.rfcMessageIdDigest) &&
      (!claim.threadReceipt ||
        claim.threadReceipt === statusReceipt.threadReceipt)
    );
    if (!statusIdentityMatches) {
      return record({ state: "identity_mismatch" });
    }
    const effectiveProviderMessageIdDigest = statusReceipt.state !== "missing" &&
        statusIdentityCount === 3
      ? statusReceipt.providerMessageIdDigest
      : claim.providerMessageIdDigest;
    const effectiveRfcMessageIdDigest = statusReceipt.state !== "missing" &&
        statusIdentityCount === 3
      ? statusReceipt.rfcMessageIdDigest
      : claim.rfcMessageIdDigest;
    const effectiveThreadReceipt = statusReceipt.state !== "missing" &&
        statusIdentityCount === 3
      ? statusReceipt.threadReceipt
      : claim.threadReceipt;
    if (
      statusReceipt.state !== "missing" &&
      statusReceipt.terminalDeliveryEvent
    ) {
      const terminal = settleTerminalDeliveryEvent(statusReceipt);
      if (!terminal) {
        return record({
          state: "terminal_event_invalid",
          retryAfterSeconds: 15 * 60,
        });
      }
      await terminal;
      return { settled: true as const, semanticEvent: true as const };
    }
    if (statusReceipt.state !== "external_attempted") {
      return record({
        state: statusReceipt.state,
        providerMessageIdDigest: statusReceipt.state === "missing"
          ? undefined
          : statusReceipt.providerMessageIdDigest,
        rfcMessageIdDigest: statusReceipt.state === "missing"
          ? undefined
          : statusReceipt.rfcMessageIdDigest,
        threadReceipt: statusReceipt.state === "missing"
          ? undefined
          : statusReceipt.threadReceipt,
        receiptUpdatedAt: statusReceipt.state === "missing"
          ? undefined
          : statusReceipt.updatedAt,
      });
    }

    const authorizedAt = Math.floor(Date.now() / 1_000);
    const authorizationReceipt = await managedSesDispositionAuthorization({
      secret: dispositionSecret,
      operationKey: claim.operationKey,
      resourceOperationKey: claim.resourceOperationKey,
      generation: claim.generation,
      authorizedAtSeconds: authorizedAt,
    });
    if (!authorizationReceipt) {
      return record({ state: "authorization_unavailable", retryAfterSeconds: 15 * 60 });
    }
    const boundary = await ctx.runMutation(
      internal.managedOutreachMailbox.markManagedSesDispositionExternalBoundary,
      {
        ...args,
        authorizedAt,
        authorizationReceipt,
        providerMessageIdDigest: effectiveProviderMessageIdDigest,
        rfcMessageIdDigest: effectiveRfcMessageIdDigest,
        threadReceipt: effectiveThreadReceipt,
      },
    );
    if (!boundary.marked) {
      return { settled: false as const, reason: "fence_changed" };
    }
    const response = await callManagedSesAdapter({
      config,
      route: "disposition",
      nonce: nonce(),
      payload: {
        operationKey: claim.operationKey,
        resourceOperationKey: claim.resourceOperationKey,
        generation: claim.generation,
        adapterVersion: claim.adapterVersion,
        sequenceStep: claim.sequenceStep,
        purpose: claim.purpose,
        decision: "quarantine_no_replay",
        authorizedAt,
        authorizationReceipt,
      },
      timeoutMs: 30_000,
    });
    const receipt = response.authenticated && response.ok
      ? parseManagedSesSendReceipt(response.receipt)
      : null;
    if (!receipt) {
      return record({
        state: "disposition_unverified",
        retryAfterSeconds: response.authenticated && !response.ok
          ? response.retryAfterSeconds ?? 120
          : 120,
      });
    }
    if (receipt.state === "missing") {
      return record({
        state: effectiveProviderMessageIdDigest ||
            effectiveRfcMessageIdDigest || effectiveThreadReceipt
          ? "identity_mismatch"
          : "disposition_unverified",
        retryAfterSeconds: 120,
      });
    }
    if (![
        "quarantined_no_replay",
        "event_confirmed_after_disposition",
      ].includes(receipt.state) ||
      receipt.operationKey !== claim.operationKey ||
      receipt.resourceOperationKey !== claim.resourceOperationKey ||
      receipt.generation !== claim.generation ||
      receipt.adapterVersion !== claim.adapterVersion ||
      receipt.sequenceStep !== claim.sequenceStep ||
      receipt.purpose !== claim.purpose ||
      receipt.updatedAt > Math.floor(Date.now() / 1_000) + 5 * 60
    ) {
      return record({
        state: "disposition_unverified",
        retryAfterSeconds: response.authenticated && !response.ok
          ? response.retryAfterSeconds ?? 120
          : 120,
      });
    }
    const dispositionIdentityCount = [
      receipt.providerMessageIdDigest,
      receipt.rfcMessageIdDigest,
      receipt.threadReceipt,
    ].filter((value) => value !== undefined).length;
    const effectiveIdentityCount = [
      effectiveProviderMessageIdDigest,
      effectiveRfcMessageIdDigest,
      effectiveThreadReceipt,
    ].filter((value) => value !== undefined).length;
    if (
      ![0, 3].includes(dispositionIdentityCount) ||
      (effectiveIdentityCount > 0 &&
        (dispositionIdentityCount !== 3 ||
          effectiveProviderMessageIdDigest !==
            receipt.providerMessageIdDigest ||
          effectiveRfcMessageIdDigest !== receipt.rfcMessageIdDigest ||
          effectiveThreadReceipt !== receipt.threadReceipt))
    ) {
      return record({ state: "identity_mismatch" });
    }
    if (receipt.terminalDeliveryEvent) {
      const terminal = settleTerminalDeliveryEvent(receipt);
      if (!terminal) {
        return record({
          state: "terminal_event_invalid",
          retryAfterSeconds: 15 * 60,
        });
      }
      await terminal;
      return { settled: true as const, semanticEvent: true as const };
    }
    return record({
      state: receipt.state,
      providerMessageIdDigest: receipt.providerMessageIdDigest,
      rfcMessageIdDigest: receipt.rfcMessageIdDigest,
      threadReceipt: receipt.threadReceipt,
      receiptUpdatedAt: receipt.updatedAt,
    });
  },
});

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
    if (claim.operation.transport === SMARTLEAD_MANAGED_TRANSPORT) {
      const config = smartleadConfig();
      if (!config) {
        const blocked = await ctx.runMutation(
          internal.managedOutreachMailbox.recordReleaseAdapterBlocked,
          { ...args, reasonCode: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE },
        );
        return { accepted: false as const, reason: "smartlead_runtime_unavailable", recorded: blocked.recorded };
      }
      const progress = async (reasonCode: string, retryAfterSeconds = 300) =>
        ctx.runMutation(
          internal.managedOutreachMailbox.recordReleaseAdapterProgress,
          {
            ...args,
            adapterVersion: SMARTLEAD_ADAPTER_VERSION,
            reasonCode,
            retryAfterSeconds,
          },
        );
      let binding = decryptSmartleadBinding(
        config,
        claim.operation.encryptedProviderBinding,
      );
      if (!binding) {
        const clientEmail = `pentra-${claim.operation.operationKey.slice(0, 24)}@${config.clientEmailDomain}`;
        const clients = await smartleadRequest({
          config,
          origin: "core",
          path: "/api/v1/client/",
        });
        if (!clients.ok) {
          await progress("smartlead_release_reconciliation_failed");
          return { accepted: false as const, reason: "smartlead_release_reconciliation_failed" };
        }
        const matches = records(smartleadData(clients.json)).filter(
          (row) => String(row.email ?? "").trim().toLowerCase() === clientEmail,
        );
        if (matches.length > 1) {
          await progress("smartlead_release_identity_conflict", 900);
          return { accepted: false as const, reason: "smartlead_release_identity_conflict" };
        }
        const clientId = positiveInteger(matches[0]?.id);
        if (!clientId) {
          return ctx.runMutation(
            internal.managedOutreachMailbox.recordReleaseCompletedInternal,
            { ...args, adapterVersion: SMARTLEAD_ADAPTER_VERSION },
          );
        }
        binding = { clientId };
      }
      const accountsResponse = await smartleadRequest({
        config,
        origin: "core",
        path: `/api/v1/email-accounts/?limit=100&client_id=${binding.clientId}`,
      });
      if (!accountsResponse.ok) {
        await progress("smartlead_release_reconciliation_failed");
        return { accepted: false as const, reason: "smartlead_release_reconciliation_failed" };
      }
      const accounts = records(smartleadData(accountsResponse.json)).filter((row) => {
        const mailboxId = positiveInteger(row.id);
        if (binding?.mailboxId) return mailboxId === binding.mailboxId;
        const email = String(row.from_email ?? "").trim().toLowerCase();
        return Boolean(
          mailboxId &&
          claim.operation.senderDomainChoice &&
          email.endsWith(`@${claim.operation.senderDomainChoice}`),
        );
      });
      if (accounts.length > 1) {
        await progress("smartlead_release_mailbox_conflict", 900);
        return { accepted: false as const, reason: "smartlead_release_mailbox_conflict" };
      }
      const mailboxId = positiveInteger(accounts[0]?.id);
      if (!mailboxId) {
        return ctx.runMutation(
          internal.managedOutreachMailbox.recordReleaseCompletedInternal,
          { ...args, adapterVersion: SMARTLEAD_ADAPTER_VERSION },
        );
      }
      const deleted = await smartleadRequest({
        config,
        origin: "core",
        path: `/api/v1/email-accounts/${mailboxId}`,
        method: "DELETE",
      });
      const deletedBody = record(deleted.json);
      const definitelyMissing = deleted.status === 404 ||
        deletedBody?.errorCode === "ACCOUNT_NOT_FOUND";
      if (!deleted.ok && !definitelyMissing) {
        await progress("smartlead_release_delete_unverified", 900);
        return { accepted: false as const, reason: "smartlead_release_delete_unverified" };
      }
      return ctx.runMutation(
        internal.managedOutreachMailbox.recordReleaseCompletedInternal,
        { ...args, adapterVersion: SMARTLEAD_ADAPTER_VERSION },
      );
    }
    const config = adapterConfig();
    if (!config) {
      const blocked = await ctx.runMutation(
        internal.managedOutreachMailbox.recordReleaseAdapterBlocked,
        {
          ...args,
          reasonCode: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
        },
      );
      return { accepted: false as const, reason: MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE, recorded: blocked.recorded };
    }
    if (
      claim.operation.provisioningAdapterVersion &&
      claim.operation.provisioningAdapterVersion !== config.adapterVersion
    ) {
      const progress = await ctx.runMutation(
        internal.managedOutreachMailbox.recordReleaseAdapterProgress,
        {
          ...args,
          adapterVersion: config.adapterVersion,
          reasonCode: "managed_ses_adapter_version_mismatch",
          retryAfterSeconds: 15 * 60,
        },
      );
      return { accepted: false as const, reason: "managed_ses_adapter_version_mismatch", recorded: progress.recorded };
    }
    const response = await callManagedSesAdapter({
      config,
      route: "release",
      nonce: nonce(),
      payload: {
        operationKey: claim.operation.operationKey,
        generation: claim.operation.generation,
        adapterVersion: config.adapterVersion,
      },
      timeoutMs: 30_000,
    });
    if (response.authenticated && response.ok) {
      const receipt = parseManagedSesResourceReceipt(response.receipt);
      if (
        receipt &&
        receipt.state !== "missing" &&
        receipt.operationKey === claim.operation.operationKey &&
        receipt.generation === claim.operation.generation &&
        receipt.adapterVersion === config.adapterVersion &&
        receipt.state === "released"
      ) {
        return ctx.runMutation(
          internal.managedOutreachMailbox.recordReleaseCompletedInternal,
          { ...args, adapterVersion: config.adapterVersion },
        );
      }
      const progress = await ctx.runMutation(
        internal.managedOutreachMailbox.recordReleaseAdapterProgress,
        {
          ...args,
          adapterVersion: config.adapterVersion,
          reasonCode: receipt && receipt.state !== "missing"
            ? receipt.code ?? `managed_ses_${receipt.state}`
            : `managed_ses_${receipt?.state ?? "receipt_invalid"}`,
          retryAfterSeconds: receipt && receipt.state !== "missing" &&
              receipt.nextEligibleAt
            ? Math.max(30, receipt.nextEligibleAt - Math.floor(Date.now() / 1000))
            : 120,
        },
      );
      return { accepted: false as const, reason: receipt?.state ?? "receipt_invalid", recorded: progress.recorded };
    }
    const progress = await ctx.runMutation(
      internal.managedOutreachMailbox.recordReleaseAdapterProgress,
      {
        ...args,
        adapterVersion: config.adapterVersion,
        reasonCode: response.code,
        retryAfterSeconds: response.authenticated
          ? response.retryAfterSeconds
          : 120,
      },
    );
    return { accepted: false as const, reason: response.code, recorded: progress.recorded };
  },
});
