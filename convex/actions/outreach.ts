"use node";

/**
 * Authority outreach execution.
 *
 * Publishing alone does not move a site that has no referring domains, so this
 * is the half of Pentra that asks other sites for a link. Because it sends
 * real email from a tenant's own address, every step here is evidence-bound:
 *
 *  - a contact address must have been observed on a real public page;
 *  - a draft must be grounded in an already-verified opportunity;
 *  - a send must pass suppression, cooldown, warm-up and compliance;
 *  - a link is only "acquired" when the exact live link has been seen.
 *
 * When any of those cannot be satisfied the message is stored as blocked with
 * the reason attached, rather than skipped silently.
 */

import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { safeFetchPublicText, validatePublicHttpsUrl } from "../lib/safeOutbound";
import {
  contactDiscoveryUrls,
  extractContactCandidates,
  isSameOrganisationHost,
  selectBestContact,
} from "../lib/outreachContacts";
import {
  draftFollowUp,
  draftOutreachMessage,
  outreachThreadKey,
} from "../lib/outreachDrafting";
import {
  contactEligibility,
  normalizeDomain,
  outreachComplianceIssues,
  outreachSendDecision,
} from "../lib/outreachPacing";
import {
  authorityEvidenceReceipt,
  hasExactAnchorHref,
  hasExactAuthorityLink,
  hasExactUnlinkedMention,
} from "../lib/linkReceipts";
import {
  OUTREACH_OPPORTUNITY_EVIDENCE_MAX_AGE_MS as OUTREACH_OPPORTUNITY_MAX_AGE_MS,
  autonomousGmailCredentialIssues,
  autonomousOutreachTransportIssues,
  gmailHttpFailureDisposition,
} from "../lib/outreachDelivery";
import { autonomousOutreachRuntimeEnabled } from "../lib/outreachAutonomy";
import { verifiedAuthorityTarget } from "../lib/publicationLive";
import { fetchLiveAuthorityTarget } from "../lib/outreachTargetLive";
import {
  createOutreachPreparationBudget,
  haltOutreachPreparationWhenRuntimeSpent,
  reserveOutreachPreparationFetch,
  summarizeOutreachPreparationBudget,
  type OutreachPreparationBudget,
  type OutreachPreparationBudgetSummary,
  type OutreachPreparationStopReason,
} from "../lib/outreachPreparationBudget";
import { isSeoGrowthActuationEligible } from "../lib/seoGrowth";
import {
  OUTREACH_INBOUND_MAX_MESSAGE_BYTES,
  OUTREACH_INBOUND_MAX_PAGES,
  OUTREACH_INBOUND_MAX_RESULTS,
  OUTREACH_INBOUND_TOTAL_DEADLINE_MS,
  classifyOutreachInbound,
  emailAddressFromHeader,
  outreachInboundReceipt,
  type OutreachInboundCandidate,
  type OutreachInboundEvidence,
} from "../lib/outreachInbound";
import {
  OUTREACH_IMAP_LOOKBACK_MS,
  OUTREACH_IMAP_MAX_MESSAGE_BYTES,
  OUTREACH_IMAP_MAX_RESULTS,
  classifyImapEvidence,
  imapEventKey,
  imapEvidenceHash,
  type ImapCandidate,
  type ImapEvidence,
} from "../lib/outreachImap";
import {
  OUTREACH_INBOUND_RELAY_CANARY_TTL_MS,
  OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS,
  inboundRelayDsnRoutingTarget,
  inboundRelayAliasAddress,
  inboundRelayAliasHash,
  inboundRelayConfigurationHash,
  inboundRelayConfigured,
  inboundRelayDsnRoutingReady,
  inboundRelayEmailHash,
  inboundRelayMessageIdHash,
  inboundRelayOutboundMessageId,
  inboundRelayOutboundMessageIdForAttempt,
} from "../lib/outreachInboundRelay";
import {
  MANAGED_SES_PLATFORM_SENDER_DOMAIN,
  MANAGED_SES_TRANSPORT,
  callManagedSesAdapter,
  managedSesAdapterConfiguration,
  managedSesInboxReceiptCurrent,
  parseManagedSesResourceReceipt,
  parseManagedSesSendReceipt,
} from "../lib/managedSes";
import {
  SMARTLEAD_MANAGED_TRANSPORT,
} from "../lib/smartlead";
import {
  classifySmtpFailure,
  imapConfigIssues,
  imapPresetForSmtpHost,
  smtpConfigIssues,
  smtpTransportOptions,
} from "../lib/outreachSmtp";
import {
  decryptOutreachCredentials,
  encryptOutreachCredentials,
  outreachCredentialBinding,
  outreachCredentialKeyConfig,
} from "../lib/outreachCredentialEncryption";

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

function managedSesRuntimeConfig() {
  return managedSesAdapterConfiguration({
    endpoint: process.env.MANAGED_SES_ADAPTER_URL,
    adapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
    signingSecret: process.env.MANAGED_SES_ADAPTER_HMAC_SECRET,
    nextVerificationSecret:
      process.env.MANAGED_SES_ADAPTER_HMAC_SECRET_NEXT,
  });
}

function managedSesNonce(): string {
  return randomBytes(32).toString("base64url");
}

async function requireOwnedSite(ctx: ActionCtx, siteId: Id<"sites">) {
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  const identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's outreach");
  }
  return site;
}

/**
 * Find a published contact address for one domain.
 *
 * A complete search can return `not_found`, which is a normal outcome and
 * must leave the opportunity un-contacted. Budget exhaustion is distinct so
 * a partially searched domain is never misreported. Nothing here constructs
 * an address from a pattern.
 */
type PublishedContact = {
  email: string;
  role?: string;
  method: string;
  foundOn: string;
};

type BudgetedPublicFetch<T> =
  | { status: "ok"; value: T }
  | { status: "failed" }
  | { status: "budget_exhausted"; reason: OutreachPreparationStopReason };

async function runPublicFetchWithinBudget<T>(args: {
  budget: OutreachPreparationBudget;
  preferredTimeoutMs: number;
  execute: (timeoutMs: number) => Promise<T>;
}): Promise<BudgetedPublicFetch<T>> {
  const timeoutMs = reserveOutreachPreparationFetch(
    args.budget,
    args.preferredTimeoutMs,
  );
  if (timeoutMs === null) {
    return {
      status: "budget_exhausted",
      reason: args.budget.stopReason ?? "runtime_budget_exhausted",
    };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // The transport has its own socket timeout. This outer deadline also
    // bounds DNS resolution, which otherwise has no caller-controlled timer.
    const value = await Promise.race([
      args.execute(Math.max(1, timeoutMs - 100)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Outreach preparation fetch timed out")),
          timeoutMs,
        );
      }),
    ]);
    return { status: "ok", value };
  } catch {
    if (haltOutreachPreparationWhenRuntimeSpent(args.budget)) {
      return {
        status: "budget_exhausted",
        reason: args.budget.stopReason ?? "runtime_budget_exhausted",
      };
    }
    return { status: "failed" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function discoverContact(args: {
  sourceUrl: string;
  sourceDomain: string;
  budget: OutreachPreparationBudget;
}): Promise<
  | { status: "found"; contact: PublishedContact }
  | { status: "not_found" }
  | { status: "budget_exhausted"; reason: OutreachPreparationStopReason }
> {
  const domain = normalizeDomain(args.sourceDomain);
  const urls = contactDiscoveryUrls({ sourceUrl: args.sourceUrl, siteDomain: domain });
  for (const url of urls) {
    const fetched = await runPublicFetchWithinBudget({
      budget: args.budget,
      preferredTimeoutMs: 10_000,
      execute: (timeoutMs) => safeFetchPublicText(url, {
          maxBytes: 500_000,
          timeoutMs,
        }),
    });
    if (fetched.status === "budget_exhausted") return fetched;
    if (fetched.status === "failed") {
      // A page that cannot be fetched simply yields no contact. Outreach is
      // never worth breaking a run for.
      continue;
    }
    const finalHost = new URL(fetched.value.url).hostname;
    if (!isSameOrganisationHost(finalHost, domain)) {
      // A redirect to an unrelated organisation cannot prove that the
      // target site published this address.
      continue;
    }
    const best = selectBestContact(
      extractContactCandidates({
        html: fetched.value.text,
        siteDomain: domain,
      }),
    );
    if (best) {
      return {
        status: "found",
        contact: {
          email: best.email,
          role: best.role,
          method: best.discoveryMethod,
          foundOn: fetched.value.url,
        },
      };
    }
  }
  return { status: "not_found" };
}

type PrepareCounts = {
  considered: number;
  drafted: number;
  blocked: number;
  skipped: number;
  reasons: Record<string, number>;
};

type PrepareResult = PrepareCounts & OutreachPreparationBudgetSummary;

async function prepareHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  site: {
    domain: string;
    siteName?: string;
    urlStructure?: string;
    publishMethod?: string;
  },
  limit: number,
): Promise<PrepareResult> {
  const budget = createOutreachPreparationBudget({ requestedLimit: limit });
  const result: PrepareCounts = {
    considered: 0,
    drafted: 0,
    blocked: 0,
    skipped: 0,
    reasons: {},
  };
  const note = (reason: string) => {
    result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
  };

  const [opportunityRows, inbox] = await Promise.all([
    // The extra row proves whether the bounded result left queue work behind.
    ctx.runQuery(internal.seoAuthority.listVerifiedInternal, {
      siteId,
      limit: budget.opportunityLimit + 1,
    }),
    ctx.runQuery(internal.outreach.getInboxInternal, { siteId }),
  ]);
  if (
    inbox?.mode === "live" &&
    !autonomousOutreachRuntimeEnabled(
      process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
    )
  ) {
    return {
      ...result,
      ...summarizeOutreachPreparationBudget({
        budget,
        considered: 0,
        offered: 0,
        hasMore: opportunityRows.length > 0,
        unsettledCurrent: false,
      }),
    };
  }
  if (inbox) {
    const durability = await ctx.runMutation(
      internal.outreach.ensureOutreachDurabilityMigrationInternal,
      { siteId },
    );
    if (!durability.complete) {
      return {
        ...result,
        ...summarizeOutreachPreparationBudget({
          budget,
          considered: 0,
          offered: 0,
          hasMore: opportunityRows.length > 0,
          unsettledCurrent: false,
        }),
      };
    }
  }
  if (
    inbox?.mode === "live" &&
    inbox.autonomyReconciliationStatus !== "complete"
  ) {
    if (
      typeof inbox._id === "string" &&
      typeof inbox.autonomyReconciliationGeneration === "number"
    ) {
      await ctx.runMutation(
        internal.outreach.migrateOutreachDurabilityInternal,
        {
          siteId,
          inboxId: inbox._id,
          generation: inbox.autonomyReconciliationGeneration,
        },
      );
    }
    return {
      ...result,
      ...summarizeOutreachPreparationBudget({
        budget,
        considered: 0,
        offered: 0,
        hasMore: opportunityRows.length > 0,
        unsettledCurrent: false,
      }),
    };
  }
  const hasMore = opportunityRows.length > budget.opportunityLimit;
  const opportunities = opportunityRows.slice(0, budget.opportunityLimit);

  const brandName = site.siteName || normalizeDomain(site.domain).split(".")[0];
  const senderName = inbox?.fromName || brandName;
  const now = Date.now();
  const liveTargetChecks = new Map<
    string,
    Promise<BudgetedPublicFetch<{ receiptUrl: string }>>
  >();
  let haltedMidOpportunity = false;

  for (const opportunity of opportunities) {
    if (haltOutreachPreparationWhenRuntimeSpent(budget)) break;
    result.considered++;

    if (
      !Number.isFinite(opportunity.verifiedAt) ||
      now - opportunity.verifiedAt > OUTREACH_OPPORTUNITY_MAX_AGE_MS
    ) {
      result.skipped++;
      note("Opportunity evidence is older than seven days and must be reverified before outreach.");
      continue;
    }

    const lastContactedAt = await ctx.runQuery(
      internal.outreach.getContactCooldownInternal,
      { siteId, domain: opportunity.sourceDomain },
    );
    const eligibility = contactEligibility({
      sourceDomain: opportunity.sourceDomain,
      now,
      history: lastContactedAt
        ? [{ domain: opportunity.sourceDomain, lastContactedAt }]
        : undefined,
    });
    if (!eligibility.eligible) {
      result.skipped++;
      note(eligibility.reason);
      continue;
    }
    if (inbox && await ctx.runQuery(
      internal.outreach.isSuppressedInternal,
      {
        siteId,
        kind: "domain",
        value: opportunity.sourceDomain,
      },
    )) {
      result.skipped++;
      note(
        "This recipient domain is permanently suppressed for the current tenant brand.",
      );
      continue;
    }

    if (opportunity.type === "broken_link") {
      const article = opportunity.articleId
        ? await ctx.runQuery(internal.articles.getInternal, {
            articleId: opportunity.articleId,
          })
        : null;
      const target = article
        ? verifiedAuthorityTarget({ site, article, now: Date.now() })
        : null;
      if (!target || target.targetUrl !== opportunity.targetUrl) {
        result.skipped++;
        note(
          "The replacement article no longer has a current exact public publication receipt.",
        );
        continue;
      }
      let liveCheck = liveTargetChecks.get(target.targetUrl);
      if (!liveCheck) {
        liveCheck = runPublicFetchWithinBudget({
          budget,
          preferredTimeoutMs: 12_000,
          execute: (timeoutMs) => fetchLiveAuthorityTarget({
            targetUrl: target.targetUrl,
            title: target.title,
            timeoutMs,
          }),
        });
        liveTargetChecks.set(target.targetUrl, liveCheck);
      }
      const live = await liveCheck;
      if (live.status === "budget_exhausted") {
        haltedMidOpportunity = true;
        break;
      }
      if (live.status === "failed") {
        result.skipped++;
        note(
          "The replacement article is not currently available at its exact verified public URL.",
        );
        continue;
      }
    }

    const contactResult = await discoverContact({
      sourceUrl: opportunity.sourceUrl,
      sourceDomain: opportunity.sourceDomain,
      budget,
    });
    if (contactResult.status === "budget_exhausted") {
      haltedMidOpportunity = true;
      break;
    }
    const contact = contactResult.status === "found"
      ? contactResult.contact
      : null;
    if (
      inbox &&
      contact &&
      await ctx.runQuery(
      internal.outreach.isSuppressedInternal,
        { siteId, kind: "email", value: contact.email },
      )
    ) {
      result.skipped++;
      note(
        "This recipient address is permanently suppressed for the current tenant brand.",
      );
      continue;
    }

    // For a broken-link opportunity the stored context is the dead URL.
    const draftEvidence = {
      type: opportunity.type,
      sourceUrl: opportunity.sourceUrl,
      sourceDomain: opportunity.sourceDomain,
      targetUrl: opportunity.targetUrl,
      brokenUrl: opportunity.type === "broken_link" ? opportunity.context : undefined,
      anchorText: opportunity.type === "broken_link" ? opportunity.anchorText : undefined,
      context: opportunity.type === "unlinked_mention" ? opportunity.context : undefined,
      brandName,
      senderName,
      physicalMailingAddress: inbox?.physicalMailingAddress,
    };
    const draft = draftOutreachMessage(draftEvidence);
    if (!draft) {
      result.skipped++;
      note("Evidence was not specific enough to write a truthful message.");
      continue;
    }

    if (contact) {
      await ctx.runMutation(internal.outreach.upsertContact, {
        siteId,
        domain: opportunity.sourceDomain,
        email: contact.email,
        role: contact.role,
        discoveredFromUrl: contact.foundOn,
        discoveryMethod: contact.method,
      });
    }

    const toEmail = contact?.email ?? "";
    const providerPlannedSequence =
      inbox?.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT
        ? [
            { sequenceStep: 0, subject: draft.subject, body: draft.body, delayDays: 0 },
            ...[1, 2].flatMap((sequenceStep) => {
              const followUp = draftFollowUp({ evidence: draftEvidence, sequenceStep });
              return followUp
                ? [{
                    sequenceStep,
                    subject: followUp.subject,
                    body: followUp.body,
                    delayDays: sequenceStep === 1 ? 4 : 5,
                  }]
                : [];
            }),
          ]
        : undefined;
    const complianceIssues = outreachComplianceIssues({
      body: draft.body,
      toEmail,
      fromEmail: inbox?.fromEmail,
      brandName,
      physicalMailingAddress: inbox?.physicalMailingAddress,
    });
    const blockedReason = !contact
      ? `No contact address is published on ${normalizeDomain(opportunity.sourceDomain)}.`
      : !inbox
        ? "No outreach inbox is connected for this site."
        : undefined;
    const status = blockedReason || complianceIssues.length > 0 ? "blocked" : "draft";

    const stored = await ctx.runMutation(internal.outreach.insertDraft, {
      siteId,
      inboxId: inbox?._id,
      inboxConfigurationVersion: inbox?.configurationVersion ?? 0,
      opportunityEvidenceHash: opportunity.evidenceHash,
      opportunitySourceUrl: opportunity.sourceUrl,
      opportunityTargetUrl: opportunity.targetUrl,
      opportunityId: opportunity._id,
      toEmail,
      toDomain: opportunity.sourceDomain,
      subject: draft.subject,
      body: draft.body,
      providerPlannedSequence,
      status,
      sequenceStep: 0,
      threadKey: outreachThreadKey(siteId, opportunity.sourceDomain),
      complianceIssues: complianceIssues.length > 0 ? complianceIssues : undefined,
      blockedReason,
    });

    if (stored.status === "paused") {
      result.skipped++;
      note("Authority autopilot was paused before this draft could be stored.");
      continue;
    }
    if (stored.status === "stale_evidence") {
      result.skipped++;
      note("Authority evidence changed before the draft could be stored; it will be reconsidered from the fresh receipt.");
      continue;
    }

    // The stored status is authoritative: the mutation may hold a message
    // behind another one already in flight to the same domain.
    if (stored.status === "blocked") {
      result.blocked++;
      note(blockedReason ?? complianceIssues[0] ?? "Held behind an in-flight message.");
      continue;
    }
    if (stored.alreadyExisted && stored.status !== "draft") {
      result.skipped++;
      note("A message for this opportunity already exists.");
      continue;
    }
    result.drafted++;
  }

  return {
    ...result,
    ...summarizeOutreachPreparationBudget({
      budget,
      considered: result.considered,
      offered: opportunities.length,
      hasMore,
      unsettledCurrent: haltedMidOpportunity,
    }),
  };
}

/**
 * Turn verified authority opportunities into reviewable drafts. Never sends.
 */
export const prepareOutreach = action({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }): Promise<PrepareResult> => {
    const site = await requireOwnedSite(ctx, siteId);
    return prepareHandler(ctx, siteId, site, limit ?? 25);
  },
});

export const prepareOutreachInternal = internalAction({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }): Promise<PrepareResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    if (!isSeoGrowthActuationEligible(site)) {
      throw new Error("SEO growth actuation is not enabled for this tenant rollout");
    }
    return prepareHandler(ctx, siteId, site, limit ?? 25);
  },
});

// ── Delivery ──

function rfc822(args: {
  fromName?: string;
  fromEmail: string;
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  toEmail: string;
  subject: string;
  body: string;
}): string | null {
  const safeEmail = (value: string | undefined) => {
    const email = String(value || "").trim().toLowerCase();
    return /^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(email)
      ? email
      : null;
  };
  const fromEmail = safeEmail(args.fromEmail);
  const toEmail = safeEmail(args.toEmail);
  if (!fromEmail || !toEmail) return null;
  const fromName = String(args.fromName || "")
    .replace(/[\r\n<>\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const subject = String(args.subject || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!subject) return null;
  const replyTo = safeEmail(args.replyTo);
  const messageId = String(args.messageId ?? "").trim().toLowerCase();
  if (messageId && !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)) return null;
  const inReplyTo = String(args.inReplyTo ?? "").trim().toLowerCase();
  if (inReplyTo && !/^<[^<>\s]+@[^<>\s]+>$/.test(inReplyTo)) return null;
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    messageId ? `Message-ID: ${messageId}` : "",
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
    inReplyTo ? `References: ${inReplyTo}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${args.body}`;
}

type GoogleTokenRefresh =
  | { ok: true; accessToken: string }
  | { ok: false; hardAuthFailure: boolean };

async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenRefresh> {
  // Gmail refresh tokens are bound to the dedicated outreach OAuth client;
  // using the GSC client here would fail and would also defeat scope isolation.
  const clientId = process.env.OUTREACH_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.OUTREACH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, hardAuthFailure: true };
  }
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, hardAuthFailure: false };
  }
  if (!res.ok) {
    let error = "";
    try {
      const body = await res.json();
      error = typeof body?.error === "string" ? body.error : "";
    } catch {
      error = "";
    }
    return {
      ok: false,
      hardAuthFailure:
        [400, 401, 403].includes(res.status) &&
        ["invalid_grant", "invalid_client", "unauthorized_client"]
          .includes(error),
    };
  }
  const data = await res.json();
  return typeof data.access_token === "string"
    ? { ok: true, accessToken: data.access_token }
    : { ok: false, hardAuthFailure: false };
}

type DeliveryOutcome = {
  ok: boolean;
  providerMessageId?: string;
  providerThreadId?: string;
  rfcMessageIdDigest?: string;
  managedSesThreadReceipt?: string;
  error?: string;
  /** A hard rejection: the address is dead and must be suppressed. */
  bounced?: boolean;
  /** The provider rejected the account itself; stop sending entirely. */
  suspend?: boolean;
  /** No provider receipt proves whether Gmail accepted the message. */
  unverified?: boolean;
  /** The exact claim was safely terminalized before any provider call. */
  preBoundaryTerminalized?: boolean;
  /** Reputation pacing preserved the approved row for an exact later wake. */
  preBoundaryDeferred?: boolean;
  deferredUntil?: number;
  /** A signed semantic terminal event won; it already settled state. */
  terminalEventSettled?: boolean;
  /** Terminal integrity quarantine remains no-replay without blocking fleet. */
  preserveContactClaim?: boolean;
  /** Smartlead accepted the exact lead into a provider-managed sequence;
   * only a later signed webhook may call it sent. */
  providerQueued?: boolean;
};

type LiveDnsEvidence = {
  senderDomain: string;
  dkimSelector: string;
  checkedAt: number;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

const DNS_TIMEOUT_MS = 5_000;

async function boundedDns<T>(operation: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function liveDnsEvidence(inbox: {
  provider?: string;
  senderDomain?: string;
  dkimSelector?: string;
}): Promise<LiveDnsEvidence> {
  const senderDomain = String(inbox.senderDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const dkimSelector = String(inbox.dkimSelector ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const dkimHost = `${dkimSelector}._domainkey.${senderDomain}`;
  const txt = async (host: string) => {
    const records = await boundedDns(resolveTxt(host));
    return records?.map((parts) => parts.join("")) ?? [];
  };
  const [rootTxt, dmarcTxt, dkimTxt, dkimCname] = await Promise.all([
    txt(senderDomain),
    txt(`_dmarc.${senderDomain}`),
    txt(dkimHost),
    boundedDns(resolveCname(dkimHost)),
  ]);
  return {
    senderDomain,
    dkimSelector,
    checkedAt: Date.now(),
    spf: rootTxt.some((value) => {
      const normalized = value.toLowerCase();
      if (!normalized.startsWith("v=spf1")) return false;
      return inbox.provider === "smtp"
        ? /\s(?:include:|redirect=|a(?=\s|:)|mx(?=\s|:)|ip4:|ip6:)/.test(
            normalized,
          )
        : normalized.includes("include:_spf.google.com") ||
          normalized.includes("redirect=_spf.google.com");
    }),
    dkim: dkimTxt.some((value) => {
      const normalized = value.replace(/\s+/g, "").toLowerCase();
      return normalized.includes("v=dkim1") || normalized.includes("p=");
    }) || Boolean(dkimCname?.length),
    dmarc: dmarcTxt.some((value) => /^v=dmarc1\s*;/i.test(value.trim())),
  };
}

/** Owner-triggered SMTP socket and sender-authentication verification. It
 * never sends a message and never returns provider diagnostics or secrets. */
type SmtpInboxVerificationResult = {
  connected: true;
  senderAuthenticationReady: boolean;
  checkedAt: number;
};

export const verifySmtpInbox = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SmtpInboxVerificationResult> => {
    await requireOwnedSite(ctx, siteId);
    const inbox: Doc<"outreach_inboxes"> | null = await ctx.runQuery(
      internal.outreach.getInboxInternal,
      {
      siteId,
      },
    );
    if (!inbox || inbox.provider !== "smtp") {
      throw new Error("No SMTP mailbox is configured for this site");
    }
    const secrets = await decryptedMailboxSecrets(siteId, inbox);
    const legacyImapPreset = imapPresetForSmtpHost(inbox.smtpHost);
    const imapHost = inbox.imapHost ?? legacyImapPreset?.host;
    const imapPort = inbox.imapPort ?? legacyImapPreset?.port;
    const imapUsername = inbox.imapUsername ?? inbox.smtpUsername;
    const issues = smtpConfigIssues({
      host: inbox.smtpHost,
      port: inbox.smtpPort,
      username: inbox.smtpUsername,
      password: secrets.smtpPassword,
      fromEmail: inbox.fromEmail,
    });
    const imapIssues = imapConfigIssues({
      host: imapHost,
      port: imapPort,
      username: imapUsername,
      password: secrets.imapPassword,
    });
    if (issues.length || imapIssues.length) {
      throw new Error("SMTP/IMAP credentials are incomplete");
    }
    const transport = nodemailer.createTransport({
      ...smtpTransportOptions({
        host: inbox.smtpHost,
        port: inbox.smtpPort,
        username: inbox.smtpUsername,
        password: secrets.smtpPassword,
        fromEmail: inbox.fromEmail,
      }),
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.verify();
    } catch (error) {
      const failure = classifySmtpFailure(
        error instanceof Error ? error.message : "unknown",
      );
      await ctx.runMutation(internal.outreach.recordInboxError, {
        inboxId: inbox._id,
        siteId,
        error: failure.operatorMessage,
        suspend: failure.reason === "authentication_failed" ||
          failure.reason === "tls_failed",
        expectedConfigurationVersion: inbox.configurationVersion ?? 0,
      });
      throw new Error(failure.operatorMessage);
    } finally {
      transport.close();
    }
    const imap = new ImapFlow({
      host: imapHost!,
      port: imapPort!,
      secure: true,
      auth: { user: imapUsername!, pass: secrets.imapPassword },
      logger: false,
      socketTimeout: 20_000,
      greetingTimeout: 10_000,
    });
    try {
      await imap.connect();
    } catch {
      await ctx.runMutation(internal.outreach.recordInboxError, {
        inboxId: inbox._id,
        siteId,
        error:
          "The mailbox rejected the IMAP connection. Confirm IMAP is enabled and use an app password.",
        suspend: true,
        expectedConfigurationVersion: inbox.configurationVersion ?? 0,
      });
      throw new Error(
        "The mailbox rejected the IMAP connection. Confirm IMAP is enabled and use an app password.",
      );
    } finally {
      if (imap.usable) await imap.logout().catch(() => undefined);
    }
    const dns = await liveDnsEvidence(inbox);
    const currentCredentialKey = outreachCredentialKeyConfig(process.env);
    const migration = (
      !inbox.credentialCiphertext ||
      inbox.credentialKeyId !== currentCredentialKey.keyId
    )
      ? await (async () => {
          const binding = outreachCredentialBinding({
            siteId: String(siteId),
            configurationVersion: inbox.configurationVersion ?? 0,
            fromEmail: inbox.fromEmail,
            smtpHost: inbox.smtpHost!,
            smtpPort: inbox.smtpPort!,
            smtpUsername: inbox.smtpUsername!,
            imapHost: imapHost!,
            imapPort: imapPort!,
            imapUsername: imapUsername!,
          });
          return encryptOutreachCredentials({
            secrets,
            binding,
            key: currentCredentialKey,
          });
        })()
      : undefined;
    const settled: { recorded: boolean; ready?: boolean } = await ctx.runMutation(
      internal.outreach.settleSmtpVerificationInternal,
      {
        siteId,
        inboxId: inbox._id,
        expectedConfigurationVersion: inbox.configurationVersion ?? 0,
        checkedAt: dns.checkedAt,
        spfVerified: dns.spf,
        dkimVerified: dns.dkim,
        dmarcVerified: dns.dmarc,
        imapHost: imapHost!,
        imapPort: imapPort!,
        imapUsername: imapUsername!,
        credentialMigration: migration,
      },
    );
    if (!settled.recorded) {
      throw new Error("SMTP configuration changed during verification");
    }
    return {
      connected: true,
      senderAuthenticationReady: Boolean(settled.ready),
      checkedAt: dns.checkedAt,
    };
  },
});

async function liveOpportunityEvidence(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  release: "approved" | "automatic",
): Promise<{
  status: "ready";
  messageId: Id<"outreach_messages">;
  opportunityId: Id<"seo_authority_opportunities">;
  evidenceHash: string;
  checkedAt: number;
  contactEmail: string;
  contactReceiptUrl: string;
  contactCheckedAt: number;
  targetReceiptUrl?: string;
  targetCheckedAt?: number;
} | {
  status: "permanent_invalid";
  messageId: Id<"outreach_messages">;
  opportunityId: Id<"seo_authority_opportunities">;
  evidenceHash: string;
  reason: "source_changed" | "target_missing" | "contact_changed";
} | null> {
  const pending = await ctx.runQuery(
    internal.outreach.getApprovedDeliveryEvidenceInternal,
    { siteId, release },
  );
  if (!pending) return null;
  if ("permanentInvalidReason" in pending) {
    return {
      status: "permanent_invalid",
      messageId: pending.messageId,
      opportunityId: pending.opportunityId,
      evidenceHash: pending.evidenceHash,
      reason: pending.permanentInvalidReason,
    };
  }
  const permanentInvalid = (
    reason: "source_changed" | "target_missing" | "contact_changed",
  ) => ({
    status: "permanent_invalid" as const,
    messageId: pending.messageId,
    opportunityId: pending.opportunityId,
    evidenceHash: pending.evidenceHash,
    reason,
  });
  try {
    const requested = await validatePublicHttpsUrl(pending.sourceUrl);
    const fetched = await safeFetchPublicText(requested.href, {
      maxBytes: 1_000_000,
      timeoutMs: 12_000,
    });
    const finalHost = new URL(fetched.url).hostname;
    if (!isSameOrganisationHost(finalHost, requested.hostname)) {
      return permanentInvalid("source_changed");
    }
    const evidenceMatches = pending.type === "broken_link"
      ? hasExactAnchorHref({
          html: fetched.text,
          sourceUrl: fetched.url,
          targetUrl: pending.context,
          expectedAnchorText: pending.anchorText,
        })
      : pending.type === "unlinked_mention"
        ? hasExactUnlinkedMention({
            html: fetched.text,
            sourceUrl: fetched.url,
            targetUrl: pending.targetUrl,
            context: pending.context,
          })
        : false;
    if (!evidenceMatches) return permanentInvalid("source_changed");

    let targetReceiptUrl: string | undefined;
    let targetCheckedAt: number | undefined;
    if (pending.type === "broken_link") {
      if (!pending.targetTitle) return permanentInvalid("target_missing");
      const targetReceipt = await fetchLiveAuthorityTarget({
        targetUrl: pending.targetUrl,
        title: pending.targetTitle,
      });
      targetReceiptUrl = targetReceipt.receiptUrl;
      targetCheckedAt = Date.now();
    }

    const contactRequest = await validatePublicHttpsUrl(
      pending.contactDiscoveredFromUrl,
    );
    const contactPage = await safeFetchPublicText(contactRequest.href, {
      maxBytes: 500_000,
      timeoutMs: 10_000,
    });
    const contactFinalHost = new URL(contactPage.url).hostname;
    if (
      !isSameOrganisationHost(contactFinalHost, pending.sourceDomain) ||
      !extractContactCandidates({
        html: contactPage.text,
        siteDomain: pending.sourceDomain,
      }).some((candidate) => candidate.email === pending.toEmail)
    ) {
      return permanentInvalid("contact_changed");
    }
    const checkedAt = Date.now();
    return {
      status: "ready",
      messageId: pending.messageId,
      opportunityId: pending.opportunityId,
      evidenceHash: createHash("sha256").update(authorityEvidenceReceipt({
        type: pending.type,
        sourceUrl: fetched.url,
        targetUrl: pending.targetUrl,
        context: pending.context,
        anchorText: pending.anchorText,
      })).digest("hex"),
      checkedAt,
      contactEmail: pending.toEmail,
      contactReceiptUrl: contactPage.url,
      contactCheckedAt: checkedAt,
      targetReceiptUrl,
      targetCheckedAt,
    };
  } catch {
    return null;
  }
}

type DeliveryInbox = {
  provider: string;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  oauthRefreshToken?: string;
  oauthAccessToken?: string;
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  credentialCiphertext?: string;
  credentialKeyId?: string;
  credentialEncryptionVersion?: number;
  credentialBindingHash?: string;
  configurationVersion?: number;
  imapHost?: string;
  imapPort?: number;
  imapUsername?: string;
};

function credentialBindingForInbox(
  siteId: Id<"sites">,
  inbox: Doc<"outreach_inboxes">,
): string {
  if (
    !inbox.smtpHost || !inbox.smtpPort || !inbox.smtpUsername ||
    !inbox.imapHost || !inbox.imapPort || !inbox.imapUsername
  ) throw new Error("SMTP/IMAP configuration is incomplete");
  return outreachCredentialBinding({
    siteId: String(siteId),
    configurationVersion: inbox.configurationVersion ?? 0,
    fromEmail: inbox.fromEmail,
    smtpHost: inbox.smtpHost,
    smtpPort: inbox.smtpPort,
    smtpUsername: inbox.smtpUsername,
    imapHost: inbox.imapHost,
    imapPort: inbox.imapPort,
    imapUsername: inbox.imapUsername,
  });
}

async function decryptedMailboxSecrets(
  siteId: Id<"sites">,
  inbox: Doc<"outreach_inboxes">,
): Promise<{ smtpPassword: string; imapPassword: string }> {
  if (
    inbox.credentialCiphertext && inbox.credentialKeyId &&
    inbox.credentialEncryptionVersion && inbox.credentialBindingHash
  ) {
    return decryptOutreachCredentials({
      encrypted: {
        credentialCiphertext: inbox.credentialCiphertext,
        credentialKeyId: inbox.credentialKeyId,
        credentialEncryptionVersion: inbox.credentialEncryptionVersion,
        credentialBindingHash: inbox.credentialBindingHash,
      },
      binding: credentialBindingForInbox(siteId, inbox),
      key: outreachCredentialKeyConfig(process.env, inbox.credentialKeyId),
    });
  }
  if (inbox.smtpPassword) {
    // Additive migration only. This fallback never appears in a public
    // projection and is removed after the first successful dual-socket check.
    return {
      smtpPassword: inbox.smtpPassword,
      imapPassword: inbox.smtpPassword,
    };
  }
  throw new Error("Mailbox credentials are unavailable");
}

async function prepareGmailAccessToken(
  inbox: DeliveryInbox,
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; suspend: boolean }
> {
  const refreshed = inbox.oauthRefreshToken
    ? await refreshGoogleAccessToken(inbox.oauthRefreshToken)
    : null;
  const accessToken = refreshed?.ok
    ? refreshed.accessToken
    : inbox.oauthRefreshToken
      ? undefined
      : inbox.oauthAccessToken;
  return accessToken
    ? { ok: true, accessToken }
    : {
        ok: false,
        suspend: Boolean(refreshed?.ok === false && refreshed.hardAuthFailure),
      };
}

async function deliver(
  inbox: DeliveryInbox,
  message: {
    toEmail: string;
    subject: string;
    body: string;
    replyTo?: string;
    outboundRfcMessageId?: string;
    providerThreadId?: string;
    inReplyToRfcMessageId?: string;
  },
  preparedGmailAccessToken?: string,
): Promise<DeliveryOutcome> {
  if (inbox.provider === "gmail") {
    const prepared = preparedGmailAccessToken
      ? { ok: true as const, accessToken: preparedGmailAccessToken }
      : await prepareGmailAccessToken(inbox);
    if (!prepared.ok) {
      return {
        ok: false,
        error: "Gmail access token unavailable",
        suspend: prepared.suspend,
      };
    }
    const accessToken = prepared.accessToken;
    const messageBody = rfc822({
        fromName: inbox.fromName,
        fromEmail: inbox.fromEmail,
        replyTo: message.replyTo ?? inbox.replyToEmail,
        messageId: message.outboundRfcMessageId,
        inReplyTo: message.inReplyToRfcMessageId,
        toEmail: message.toEmail,
        subject: message.subject,
        body: message.body,
      });
    if (!messageBody) {
      return { ok: false, error: "Message headers failed validation" };
    }
    const raw = Buffer.from(messageBody)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    let res: Response;
    try {
      res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw,
            ...(message.providerThreadId
              ? { threadId: message.providerThreadId }
              : {}),
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      return {
        ok: false,
        error: "Gmail delivery timeout",
        unverified: true,
      };
    }
    const text = await res.text();
    if (!res.ok) {
      const disposition = gmailHttpFailureDisposition(res.status);
      return {
        ok: false,
        // Provider bodies can contain account-specific diagnostics. Persist a
        // stable status only; never copy a third-party response into tenant
        // records, logs, or the dashboard.
        error: `Gmail delivery failed with HTTP ${res.status}`,
        suspend: disposition.suspend,
        unverified: disposition.unverified,
      };
    }
    let providerMessageId: string | undefined;
    let providerThreadId: string | undefined;
    try {
      const receipt = JSON.parse(text);
      providerMessageId = receipt?.id;
      providerThreadId = receipt?.threadId;
    } catch {
      providerMessageId = undefined;
    }
    if (!providerMessageId) {
      return {
        ok: false,
        error: "Gmail response missing delivery receipt",
        unverified: true,
      };
    }
    return { ok: true, providerMessageId, providerThreadId };
  }

  if (inbox.provider === "smtp") {
    const issues = smtpConfigIssues({
      host: inbox.smtpHost,
      port: inbox.smtpPort,
      username: inbox.smtpUsername,
      password: inbox.smtpPassword,
      fromEmail: inbox.fromEmail,
    });
    if (issues.length) {
      return { ok: false, error: "SMTP credentials are incomplete", suspend: true };
    }
    const transport = nodemailer.createTransport({
      ...smtpTransportOptions({
        host: inbox.smtpHost,
        port: inbox.smtpPort,
        username: inbox.smtpUsername,
        password: inbox.smtpPassword,
        fromEmail: inbox.fromEmail,
      }),
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      const info = await transport.sendMail({
        from: inbox.fromName
          ? { name: inbox.fromName, address: inbox.fromEmail }
          : inbox.fromEmail,
        to: message.toEmail,
        replyTo: message.replyTo ?? inbox.replyToEmail,
        subject: message.subject,
        text: message.body,
        messageId: message.outboundRfcMessageId,
        inReplyTo: message.inReplyToRfcMessageId,
        references: message.inReplyToRfcMessageId,
      });
      const accepted = Array.isArray(info.accepted) && info.accepted.length > 0;
      if (!accepted || !info.messageId) {
        return {
          ok: false,
          error: "SMTP response missing an accepted delivery receipt",
          unverified: true,
        };
      }
      return {
        ok: true,
        providerMessageId: createHash("sha256")
          .update(String(info.messageId))
          .digest("hex"),
      };
    } catch (error) {
      const failure = classifySmtpFailure(
        error instanceof Error ? error.message : "unknown",
      );
      return {
        ok: false,
        error: failure.operatorMessage,
        bounced: failure.reason === "recipient_rejected",
        suspend: failure.reason === "authentication_failed" ||
          failure.reason === "tls_failed",
        unverified: failure.reason === "connection_failed" ||
          failure.reason === "rate_limited" || failure.reason === "unknown",
      };
    } finally {
      transport.close();
    }
  }

  return { ok: false, error: `No transport for provider "${inbox.provider}"` };
}

type SendResult = { sent: number; failed: number; stopped?: string };

async function sendHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  release: "approved" | "automatic",
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0 };
  let inboxSnapshot;
  try {
    inboxSnapshot = await ctx.runQuery(internal.outreach.getInboxInternal, { siteId });
  } catch {
    return {
      ...result,
      stopped: "Exactly one outreach inbox must be connected for this tenant.",
    };
  }
  if (!inboxSnapshot) {
    return { ...result, stopped: "No outreach inbox is connected for this tenant." };
  }
  const durability = await ctx.runMutation(
    internal.outreach.ensureOutreachDurabilityMigrationInternal,
    { siteId },
  );
  if (!durability.complete) {
    return {
      ...result,
      stopped:
        "Account-wide legacy suppression and contact history is still being reconciled. Nothing was sent.",
    };
  }

  const managedSes = inboxSnapshot.provider === MANAGED_SES_TRANSPORT;
  const smartleadManaged =
    inboxSnapshot.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT;
  const smtp = inboxSnapshot.provider === "smtp";
  const managedSesConfig = managedSes ? managedSesRuntimeConfig() : null;
  if (
    managedSes &&
    (!managedSesConfig ||
      inboxSnapshot.managedTransportAdapterVersion !==
        managedSesConfig.adapterVersion)
  ) {
    return {
      ...result,
      stopped:
        "The signed managed sender adapter is unavailable or its version no longer matches this inbox. Nothing was sent.",
    };
  }
  const relayDomain = process.env.OUTREACH_INBOUND_RELAY_DOMAIN;
  const relayConfigured = inboundRelayConfigured(inboundRelayRuntimeConfig());
  const relayReady = smartleadManaged
    ? true
    : managedSes
    ? relayConfigured && managedSesInboxReceiptCurrent({
        inbox: inboxSnapshot,
        now: Date.now(),
        expectedAdapterVersion: managedSesConfig!.adapterVersion,
      })
    : relayConfigured && inboundRelayDsnRoutingReady({
        inbox: inboxSnapshot,
        now: Date.now(),
        rolloutEpoch: inboxSnapshot.siteRolloutEpoch ?? 0,
        runtimeConfig: inboundRelayRuntimeConfig(),
      });
  const legacyGmailReadReady = Boolean(
    inboxSnapshot.provider === "gmail" &&
    inboxSnapshot.oauthScopes?.split(/\s+/).includes(
      "https://www.googleapis.com/auth/gmail.readonly",
    ),
  );
  const imapReady = Boolean(
    smtp && inboxSnapshot.imapVerifiedAt &&
      inboxSnapshot.credentialCiphertext &&
      !["disconnected", "suspended"].includes(inboxSnapshot.status),
  );
  if (!relayReady && !legacyGmailReadReady && !imapReady) {
    return {
      ...result,
      stopped:
        smtp
          ? "The IMAP reply, bounce, and STOP monitor is not verified. Nothing was sent."
          : relayConfigured
          ? "The signed inbound relay has not passed a current hard-bounce routing canary for this inbox. Nothing was sent."
          : "The signed inbound relay is not configured, so replies and opt-outs cannot be handled safely. Nothing was sent.",
    };
  }
  if (
    release === "automatic" &&
      (smtp || !inboxSnapshot.automaticDeliveryAuthorized ||
      autonomousOutreachTransportIssues({
        inbox: inboxSnapshot,
        now: Date.now(),
        managedSesAdapterVersion: managedSesConfig?.adapterVersion,
      }).length > 0)
  ) {
    return {
      ...result,
      stopped:
        "The current tenant consent, rollout, or exact outbound transport authorization does not permit automatic delivery.",
    };
  }
  const pacingPreflight = outreachSendDecision({
    inbox: inboxSnapshot,
    now: Date.now(),
    release,
  });
  if (!pacingPreflight.allowed) {
    return { ...result, stopped: pacingPreflight.reason };
  }

  let preparedSmtpSecrets:
    | { smtpPassword: string; imapPassword: string }
    | undefined;
  if (smtp) {
    try {
      preparedSmtpSecrets = await decryptedMailboxSecrets(siteId, inboxSnapshot);
    } catch {
      return {
        ...result,
        stopped:
          "The encrypted SMTP/IMAP credential cannot be opened. Reconnect the mailbox; nothing was sent.",
      };
    }
  }

  const attemptId = randomUUID();
  const usesInboundRelay = relayReady && !smartleadManaged && !imapReady;
  const imapOutboundRfcMessageId = imapReady
    ? `<${randomBytes(24).toString("hex")}@${normalizeDomain(
        inboxSnapshot.senderDomain ?? inboxSnapshot.fromEmail.split("@")[1] ?? "",
      )}>`
    : undefined;
  const relayAliasToken = usesInboundRelay
    ? randomBytes(24).toString("base64url")
    : undefined;
  const dsnRoutingTarget = usesInboundRelay
    ? await inboundRelayDsnRoutingTarget({
        siteId: String(siteId),
        inboxId: String(inboxSnapshot._id),
        generation:
          inboxSnapshot.inboundRelayDsnRoutingTargetGeneration ?? 1,
        relayDomain,
        secret: inboundRelayRuntimeConfig().dsnTargetSecret,
      })
    : null;
  const relayAlias = relayAliasToken && relayDomain
    ? inboundRelayAliasAddress(relayAliasToken, relayDomain)
    : null;
  const outboundRfcMessageId = usesInboundRelay
    ? await inboundRelayOutboundMessageIdForAttempt({
        siteId: String(siteId),
        inboxId: String(inboxSnapshot._id),
        deliveryAttemptId: attemptId,
        senderDomain: inboxSnapshot.senderDomain ?? "",
        secret: inboundRelayRuntimeConfig().dsnTargetSecret,
      })
    : null;
  const relayBinding = relayAlias && outboundRfcMessageId && dsnRoutingTarget
    ? {
        aliasAddress: relayAlias,
        aliasHash: inboundRelayAliasHash(relayAlias),
        aliasDomain: relayDomain!,
        outboundRfcMessageId,
        dsnRoutingTargetHash: dsnRoutingTarget.hash,
        dsnRoutingTargetVersion: dsnRoutingTarget.version,
        dsnRoutingTargetGeneration:
          inboxSnapshot.inboundRelayDsnRoutingTargetGeneration ?? 1,
      }
    : undefined;
  if (usesInboundRelay && !relayBinding) {
    return {
      ...result,
      stopped: "The signed inbound relay configuration is invalid. Nothing was sent.",
    };
  }

  // Resolve the sender's DNS immediately before the serializable claim. The
  // mutation rejects evidence older than one minute and reloads every tenant,
  // sender, message, opportunity, suppression and pacing record itself.
  const [dnsEvidence, opportunityEvidenceResult] = await Promise.all([
    managedSes || smartleadManaged
      ? Promise.resolve({
          senderDomain: smartleadManaged
            ? inboxSnapshot.senderDomain ?? ""
            : MANAGED_SES_PLATFORM_SENDER_DOMAIN,
          dkimSelector: inboxSnapshot.dkimSelector ??
            (smartleadManaged ? "smartlead" : "managed-ses"),
          checkedAt: Date.now(),
          spf: true,
          dkim: true,
          dmarc: true,
        })
      : liveDnsEvidence(inboxSnapshot),
    liveOpportunityEvidence(ctx, siteId, release),
  ]);
  if (!opportunityEvidenceResult) {
    return {
      ...result,
      stopped:
        "The approved source evidence, replacement page, or published contact could not be reverified. Run a fresh authority scan before sending.",
    };
  }
  if (opportunityEvidenceResult.status === "permanent_invalid") {
    await ctx.runMutation(
      internal.outreach.retireInvalidApprovedDeliveryEvidenceInternal,
      {
        siteId,
        messageId: opportunityEvidenceResult.messageId,
        opportunityId: opportunityEvidenceResult.opportunityId,
        evidenceHash: opportunityEvidenceResult.evidenceHash,
        reason: opportunityEvidenceResult.reason,
      },
    );
    return {
      ...result,
      stopped:
        "The oldest approved authority evidence became permanently invalid and was retired; the next eligible message can proceed on the next run.",
    };
  }
  const opportunityEvidence = {
    messageId: opportunityEvidenceResult.messageId,
    opportunityId: opportunityEvidenceResult.opportunityId,
    evidenceHash: opportunityEvidenceResult.evidenceHash,
    checkedAt: opportunityEvidenceResult.checkedAt,
    contactEmail: opportunityEvidenceResult.contactEmail,
    contactReceiptUrl: opportunityEvidenceResult.contactReceiptUrl,
    contactCheckedAt: opportunityEvidenceResult.contactCheckedAt,
    targetReceiptUrl: opportunityEvidenceResult.targetReceiptUrl,
    targetCheckedAt: opportunityEvidenceResult.targetCheckedAt,
  };
  let managedSesClaimReceipt:
    | {
        resourceOperationKey: string;
        generation: number;
        adapterVersion: string;
        resourceReceipt: string;
        providerVerifiedAt: number;
        unsubscribeTokenHash: string;
      }
    | undefined;
  let managedSesUnsubscribeUrl: string | undefined;
  if (managedSes) {
    const resourceOperationKey =
      inboxSnapshot.managedTransportOperationKey ?? "";
    const generation = inboxSnapshot.managedTransportGeneration;
    if (
      !managedSesConfig ||
      !resourceOperationKey ||
      !Number.isSafeInteger(generation)
    ) {
      return {
        ...result,
        stopped: "The managed sender binding is invalid. Nothing was sent.",
      };
    }
    const status = await callManagedSesAdapter({
      config: managedSesConfig,
      route: "status",
      nonce: managedSesNonce(),
      payload: {
        kind: "resource",
        operationKey: resourceOperationKey,
        adapterVersion: managedSesConfig.adapterVersion,
      },
      timeoutMs: 30_000,
    });
    const receipt = status.authenticated && status.ok
      ? parseManagedSesResourceReceipt(status.receipt)
      : null;
    const providerVerifiedAt =
      receipt?.state === "ready" ? receipt.verifiedAt! * 1_000 : 0;
    if (
      !receipt ||
      receipt.state !== "ready" ||
      receipt.operationKey !== resourceOperationKey ||
      receipt.generation !== generation ||
      receipt.adapterVersion !== managedSesConfig.adapterVersion ||
      receipt.fromEmail !== inboxSnapshot.fromEmail ||
      receipt.resourceReceipt !==
        inboxSnapshot.managedTransportResourceReceipt ||
      providerVerifiedAt <= 0 ||
      providerVerifiedAt > Date.now() + 5 * 60 * 1000 ||
      Date.now() - providerVerifiedAt > 5 * 60 * 1000
    ) {
      return {
        ...result,
        stopped:
          "The managed sender did not return a current exact signed readiness receipt. Nothing was sent.",
      };
    }
    const unsubscribeToken = randomBytes(32).toString("base64url");
    managedSesUnsubscribeUrl =
      `https://pentra.dev/unsubscribe/${unsubscribeToken}`;
    managedSesClaimReceipt = {
      resourceOperationKey,
      generation: generation!,
      adapterVersion: managedSesConfig.adapterVersion,
      resourceReceipt: receipt.resourceReceipt!,
      providerVerifiedAt,
      unsubscribeTokenHash: createHash("sha256")
        .update(unsubscribeToken)
        .digest("hex"),
    };
  }
  let claim;
  try {
    claim = await ctx.runMutation(internal.outreach.claimApprovedDelivery, {
      siteId,
      attemptId,
      release,
      dnsEvidence,
      opportunityEvidence,
      inboundRelay: relayBinding,
      imapBinding: imapOutboundRfcMessageId
        ? {
            outboundMessageIdHash:
              inboundRelayMessageIdHash(imapOutboundRfcMessageId),
          }
        : undefined,
      managedSesReceipt: managedSesClaimReceipt,
    });
  } catch {
    return {
      ...result,
      stopped: "Pentra could not establish a safe delivery claim. Nothing was sent.",
    };
  }
  if (!claim.claimed) return { ...result, stopped: claim.reason };

  const managedSesParent = managedSes && claim.message.sequenceStep > 0 &&
      claim.message.managedSesParentOperationKey &&
      claim.message.managedSesParentThreadReceipt
    ? {
        operationId: claim.message.managedSesParentOperationKey,
        threadReceipt: claim.message.managedSesParentThreadReceipt,
      }
    : undefined;
  const deliveryBoundaryBinding = {
    siteId,
    messageId: claim.message._id,
    attemptId,
    release,
    expectedParentMessageId: claim.message.parentMessageId,
    expectedProviderThreadId: claim.message.deliveryExpectedThreadId,
    expectedInReplyToRfcMessageIdHash:
      claim.message.inReplyToRfcMessageIdHash,
    expectedManagedParentOperationKey:
      claim.message.managedSesParentOperationKey,
    expectedManagedParentThreadReceipt:
      claim.message.managedSesParentThreadReceipt,
  };
  let outcome: DeliveryOutcome;
  try {
    if (managedSes) {
      if (
        !managedSesConfig ||
        !managedSesClaimReceipt ||
        !managedSesUnsubscribeUrl ||
        !relayBinding?.aliasAddress ||
        (claim.message.sequenceStep > 0 && !managedSesParent)
      ) {
        outcome = {
          ok: false,
          error: "Managed sender binding unavailable",
          unverified: true,
        };
      } else {
        const boundary = await ctx.runMutation(
          internal.outreach.markManagedSesDeliveryExternalBoundary,
          deliveryBoundaryBinding,
        );
        if (!boundary.marked) {
          outcome = {
            ok: false,
            error: "deferred" in boundary && boundary.deferred
              ? "Managed sender pacing deferred delivery"
              : boundary.externalAttempted
                ? "Managed sender boundary was already crossed"
                : "Managed sender authorization changed before delivery",
            unverified: boundary.externalAttempted,
            preBoundaryTerminalized:
              "terminalized" in boundary && boundary.terminalized,
            preBoundaryDeferred:
              "deferred" in boundary && boundary.deferred,
            deferredUntil:
              "nextEligibleAt" in boundary
                ? boundary.nextEligibleAt
                : undefined,
          };
        } else {
          const response = await callManagedSesAdapter({
            config: managedSesConfig,
            route: "send",
            nonce: managedSesNonce(),
            payload: {
              purpose: "outreach",
              operationKey: attemptId,
              resourceOperationKey:
                managedSesClaimReceipt.resourceOperationKey,
              generation: managedSesClaimReceipt.generation,
              adapterVersion: managedSesClaimReceipt.adapterVersion,
              sequenceStep: claim.message.sequenceStep,
              ...(managedSesParent ? { parent: managedSesParent } : {}),
              toEmail: claim.message.toEmail,
              displayName: claim.inbox.fromName,
              subject: claim.message.subject,
              text: claim.message.body,
              replyTo: relayBinding.aliasAddress,
              unsubscribeUrl: managedSesUnsubscribeUrl,
            },
            timeoutMs: 30_000,
          });
          const receipt = response.authenticated && response.ok
            ? parseManagedSesSendReceipt(response.receipt)
            : null;
          if (
            receipt &&
            receipt.state !== "missing" &&
            receipt.operationKey === attemptId &&
            receipt.resourceOperationKey ===
              managedSesClaimReceipt.resourceOperationKey &&
            receipt.generation === managedSesClaimReceipt.generation &&
            receipt.adapterVersion === managedSesClaimReceipt.adapterVersion &&
            receipt.sequenceStep === claim.message.sequenceStep &&
            receipt.purpose === "outreach" &&
            receipt.updatedAt <= Math.floor(Date.now() / 1_000) + 5 * 60 &&
            receipt.terminalDeliveryEvent &&
            receipt.providerMessageIdDigest &&
            receipt.rfcMessageIdDigest &&
            receipt.threadReceipt
          ) {
            await ctx.runMutation(
              internal.outreach.recordManagedSesDeliveryEvent,
              {
                adapterVersion: receipt.adapterVersion,
                operationKey: receipt.operationKey,
                resourceOperationKey: receipt.resourceOperationKey,
                generation: receipt.generation,
                sequenceStep: receipt.sequenceStep,
                purpose: receipt.purpose,
                eventType: receipt.terminalDeliveryEvent.eventType,
                occurredAt: Date.parse(
                  receipt.terminalDeliveryEvent.occurredAt,
                ),
                providerMessageIdDigest: receipt.providerMessageIdDigest,
                rfcMessageIdDigest: receipt.rfcMessageIdDigest,
                threadReceipt: receipt.threadReceipt,
                eventReceipt: receipt.terminalDeliveryEvent.eventReceipt,
              },
            );
            outcome = {
              ok: false,
              error: "The managed sender returned a signed terminal delivery event",
              terminalEventSettled: true,
            };
          } else if (
            receipt &&
            receipt.state !== "missing" &&
            receipt.operationKey === attemptId &&
            receipt.resourceOperationKey ===
              managedSesClaimReceipt.resourceOperationKey &&
            receipt.generation === managedSesClaimReceipt.generation &&
            receipt.adapterVersion === managedSesClaimReceipt.adapterVersion &&
            receipt.sequenceStep === claim.message.sequenceStep &&
            receipt.purpose === "outreach" &&
            receipt.updatedAt <= Math.floor(Date.now() / 1_000) + 5 * 60 &&
            receipt.state === "submitted" &&
            !receipt.terminalDeliveryEvent &&
            receipt.providerMessageIdDigest
          ) {
            outcome = {
              ok: true,
              providerMessageId: receipt.providerMessageIdDigest,
              rfcMessageIdDigest: receipt.rfcMessageIdDigest,
              managedSesThreadReceipt: receipt.threadReceipt,
            };
          } else if (
            ["terminal_rejected", "quarantined_integrity"].includes(
              receipt?.state ?? "",
            ) &&
            receipt?.state !== "missing" &&
            receipt?.operationKey === attemptId &&
            receipt.resourceOperationKey ===
              managedSesClaimReceipt.resourceOperationKey &&
            receipt.generation === managedSesClaimReceipt.generation &&
            receipt.adapterVersion === managedSesClaimReceipt.adapterVersion &&
            receipt.sequenceStep === claim.message.sequenceStep &&
            receipt.purpose === "outreach"
          ) {
            outcome = {
              ok: false,
              error: receipt?.state === "quarantined_integrity"
                ? "Managed sender quarantined a no-replay integrity mismatch"
                : "Managed sender rejected the delivery",
              preserveContactClaim:
                receipt?.state === "quarantined_integrity",
            };
          } else {
            // The application claim and provider transport both enforce an
            // immutable operation key. Any missing or mismatched response is an
            // ambiguous external attempt and must never be replayed.
            outcome = {
              ok: false,
              error: "Managed sender receipt is unverified",
              unverified: true,
            };
          }
        }
      }
    } else if (smartleadManaged) {
      const boundary = await ctx.runMutation(
        internal.outreach.markSmartleadDeliveryExternalBoundary,
        deliveryBoundaryBinding,
      );
      if (!boundary.marked) {
        outcome = {
          ok: false,
          error: boundary.externalAttempted
            ? "Smartlead delivery boundary was already crossed"
            : "Smartlead delivery authorization changed before enrollment",
          unverified: boundary.externalAttempted,
          preBoundaryTerminalized:
            "terminalized" in boundary && boundary.terminalized,
        };
      } else {
        const submitted = await ctx.runAction(
          internal.actions.smartlead.submitSequence,
          {
            siteId,
            messageId: claim.message._id,
            attemptId,
          },
        );
        outcome = submitted.ok
          ? { ok: true, providerQueued: true }
          : {
              ok: false,
              error: "Smartlead sequence receipt is unverified",
              unverified: submitted.ambiguous,
            };
      }
    } else {
      // Credential preparation may happen before the final serializable
      // authorization fence, but no message leaves Pentra until that exact
      // boundary. A concurrent reply/STOP/unsubscribe therefore wins.
      const smtpSecrets = preparedSmtpSecrets;
      const prepared = smtp
        ? { ok: true as const, accessToken: undefined }
        : await prepareGmailAccessToken(claim.inbox);
      if (!prepared.ok) {
        outcome = {
          ok: false,
          error: "Gmail access token unavailable",
          suspend: prepared.suspend,
        };
      } else {
        const boundary = await ctx.runMutation(
          smtp
            ? internal.outreach.markSmtpDeliveryExternalBoundary
            : internal.outreach.markGmailDeliveryExternalBoundary,
          deliveryBoundaryBinding,
        );
        if (!boundary.marked) {
          outcome = {
            ok: false,
            error: boundary.externalAttempted
              ? `${smtp ? "SMTP" : "Gmail"} delivery boundary was already crossed`
              : `${smtp ? "SMTP" : "Gmail"} delivery authorization changed before delivery`,
            unverified: boundary.externalAttempted,
            preBoundaryTerminalized:
              "terminalized" in boundary && boundary.terminalized,
          };
        } else {
          outcome = await deliver({
            ...claim.inbox,
            ...(smtpSecrets
              ? { smtpPassword: smtpSecrets.smtpPassword }
              : {}),
          }, {
            toEmail: claim.message.toEmail,
            subject: claim.message.subject,
            body: claim.message.body,
            replyTo: relayBinding?.aliasAddress,
            outboundRfcMessageId:
              relayBinding?.outboundRfcMessageId ?? imapOutboundRfcMessageId,
            providerThreadId: claim.deliveryThreadId,
            inReplyToRfcMessageId: claim.deliveryInReplyToRfcMessageId,
          }, prepared.accessToken);
        }
      }
    }
  } catch {
    outcome = {
      ok: false,
      error: managedSes
        ? "Managed sender delivery outcome is ambiguous"
        : smartleadManaged
          ? "Smartlead delivery outcome is ambiguous"
        : `${smtp ? "SMTP" : "Gmail"} delivery timeout`,
      unverified: true,
    };
  }
  if (outcome.terminalEventSettled) {
    return {
      sent: 0,
      failed: 1,
      stopped:
        "A signed terminal managed-sender event settled this attempt; it was not counted as sent and no follow-up was queued.",
    };
  }
  if (outcome.providerQueued) {
    return {
      sent: 0,
      failed: 0,
      stopped:
        "Smartlead accepted the exact recipient sequence. Pentra will count delivery only after a signed sent event.",
    };
  }
  if (outcome.ok) {
    try {
      const completed = managedSes
        ? await ctx.runMutation(
            internal.outreach.completeManagedSesDeliveryAttempt,
            {
              siteId,
              messageId: claim.message._id,
              attemptId,
              providerMessageIdDigest: outcome.providerMessageId!,
              rfcMessageIdDigest: outcome.rfcMessageIdDigest!,
              threadReceipt: outcome.managedSesThreadReceipt!,
            },
          )
        : await ctx.runMutation(
            internal.outreach.completeDeliveryAttempt,
            {
              siteId,
              messageId: claim.message._id,
              attemptId,
              providerMessageId: outcome.providerMessageId,
              providerThreadId: outcome.providerThreadId,
              outboundRfcMessageId: relayBinding?.outboundRfcMessageId,
            },
          );
      if (completed.recorded) return { sent: 1, failed: 0 };
      if (managedSes && "terminal" in completed && completed.terminal) {
        return {
          sent: 0,
          failed: 1,
          stopped:
            "A signed terminal managed-sender event settled this attempt before the synchronous receipt.",
        };
      }
    } catch {
      // The provider accepted the message but Pentra could not seal the receipt. This
      // is ambiguous and must never become a retryable approved draft.
      try {
        await ctx.runMutation(internal.outreach.failDeliveryAttempt, {
          siteId,
          messageId: claim.message._id,
          attemptId,
              reason: managedSes
            ? "Managed sender receipt finalization failed"
            : `${smtp ? "SMTP" : "Gmail"} receipt finalization failed`,
          unverified: true,
        });
      } catch {
        // The lease itself remains the durable recovery path. Its expiry is
        // converted to delivery_unverified by the next owner release attempt.
      }
    }
    return {
      sent: 0,
      failed: 1,
      stopped: managedSes
        ? "The managed sender accepted the request but Pentra could not seal its signed receipt; the attempt will not be replayed."
        : smartleadManaged
          ? "Smartlead accepted an external operation but Pentra could not seal its exact receipt; it will be reconciled and not replayed."
        : `${smtp ? "SMTP" : "Gmail"} accepted the request but the receipt is unverified; manual review is required.`,
    };
  }

  if (outcome.preBoundaryTerminalized) {
    return {
      sent: 0,
      failed: 0,
      stopped:
        "Delivery authorization changed before the provider boundary; no provider attempt was made.",
    };
  }
  if (outcome.preBoundaryDeferred) {
    return {
      sent: 0,
      failed: 0,
      stopped: outcome.deferredUntil
        ? "Managed sender reputation pacing deferred this approved message to its exact next eligible window; no provider attempt was made."
        : "Managed sender reputation pacing deferred this approved message; no provider attempt was made.",
    };
  }
  result.failed = 1;
  let failed;
  try {
    if (smartleadManaged && outcome.unverified) {
      const ambiguous = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        {
          siteId,
          messageId: claim.message._id,
          attemptId,
          phase: "ambiguous",
        },
      );
      return {
        ...result,
        stopped: ambiguous.recorded
          ? "Smartlead acknowledgement is ambiguous. The operation is quarantined for exact reconciliation and will not be replayed."
          : "Pentra could not seal the Smartlead ambiguity; the delivery lease remains the no-replay recovery fence.",
      };
    }
    failed = await ctx.runMutation(internal.outreach.failDeliveryAttempt, {
      siteId,
      messageId: claim.message._id,
      attemptId,
      reason: outcome.error ?? "Unknown delivery failure",
      bounced: outcome.bounced,
      unverified: outcome.unverified,
      preserveContactClaim: outcome.preserveContactClaim,
    });
  } catch {
    return {
      ...result,
      stopped: "Pentra could not seal the delivery outcome; manual review is required.",
    };
  }
  if (!failed.recorded) {
    return {
      ...result,
      stopped: "The delivery attempt lost its lease; manual review is required.",
    };
  }
  if (outcome.suspend) {
    try {
      await ctx.runMutation(internal.outreach.recordInboxError, {
        siteId,
        inboxId: claim.inbox._id,
        expectedConfigurationVersion: claim.inbox.configurationVersion ?? 0,
        error: outcome.error ?? "Provider rejected the account",
        suspend: true,
      });
    } catch {
      // The per-message failure is already sealed. Avoid returning provider or
      // credential details when the inbox-status update itself fails.
    }
    return { ...result, stopped: "Provider rejected the inbox; sending suspended." };
  }
  if (outcome.unverified) {
    return {
      ...result,
      stopped: managedSes
        ? "The managed sender did not return a verified receipt; this operation is quarantined and will not be replayed."
        : `${smtp ? "SMTP" : "Gmail"} did not return a verified receipt; manual review is required.`,
    };
  }
  return result;
}

/**
 * Send drafts that this tenant explicitly approved, subject to verified-inbox
 * readiness, spacing, warm-up, daily cap and suppression. Approval mode blocks
 * background delivery; this owner-triggered release is the single exception.
 */
export const sendApprovedOutreach = action({
  args: { siteId: v.id("sites"), max: v.optional(v.number()) },
  handler: async (ctx, { siteId }): Promise<SendResult> => {
    await requireOwnedSite(ctx, siteId);
    // Deliberately one owner-approved message per click/action. This public
    // action cannot release tenant-autopilot messages; those use the internal
    // fleet action and a separate atomic authorization path.
    return sendHandler(ctx, siteId, "approved");
  },
});

/** Owner-triggered OAuth proof that sends exactly one message back to the
 * connected mailbox. This does not contact a prospect, change readiness, or
 * bypass the secondary-domain, DNS, inbound-relay, consent, or pacing gates
 * used by real outreach. */
export const sendGmailConnectionSelfTest = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireOwnedSite(ctx, siteId);
    const inbox = await ctx.runQuery(internal.outreach.getInboxInternal, {
      siteId,
    });
    if (
      !inbox ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status)
    ) {
      throw new Error("A connected Gmail inbox is required");
    }
    if (
      autonomousGmailCredentialIssues({
        oauthScopes: inbox.oauthScopes,
        hasRefreshToken: Boolean(inbox.oauthRefreshToken),
      }).length > 0
    ) {
      throw new Error("Reconnect Gmail with the exact send-only permission");
    }
    const outcome = await deliver(inbox, {
      toEmail: inbox.fromEmail,
      subject: "Pentra Gmail connection test",
      body:
        "Pentra successfully used the Gmail send-only permission to send this owner-triggered message back to the connected mailbox. No prospect was contacted, and this test does not enable outreach delivery.",
    });
    if (!outcome.ok) {
      throw new Error(
        outcome.unverified
          ? "Gmail did not return a conclusive self-test receipt. Do not retry immediately."
          : "Gmail did not accept the connection self-test.",
      );
    }
    return {
      accepted: true as const,
      message:
        "Gmail accepted the same-mailbox connection test. Prospect outreach remains subject to Pentra's separate readiness gates.",
    };
  },
});

/** Fleet-only release. The atomic claim revalidates the exact tenant consent,
 * current rollout, due message, sender DNS, live source/contact evidence,
 * signed inbound relay, suppression, pacing and delivery lease. */
export const sendAutomaticOutreachInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SendResult> =>
    sendHandler(ctx, siteId, "automatic"),
});

/** Explicitly owner-trigger one fixed-recipient customer-mailbox hard-DSN canary. This is
 * separate from prospect delivery and has no cron/fleet caller. The transport's
 * send receipt never seals readiness; only the later signed structured DSN can. */
export const sendInboundRelayDsnCanary = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireOwnedSite(ctx, siteId);
    const inbox = await ctx.runQuery(internal.outreach.getInboxInternal, { siteId });
    if (!inbox || !["gmail", "smtp"].includes(inbox.provider)) {
      throw new Error("A verified customer-managed outreach inbox is required");
    }
    const runtimeConfig = inboundRelayRuntimeConfig();
    const relayDomain = process.env.OUTREACH_INBOUND_RELAY_DOMAIN;
    const relayConfigurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const testRecipient = emailAddressFromHeader(
      process.env.OUTREACH_INBOUND_RELAY_CANARY_RECIPIENT,
    );
    if (!relayDomain || !relayConfigurationHash || !testRecipient) {
      throw new Error("The audited inbound relay canary is not configured");
    }
    const aliasToken = randomBytes(24).toString("base64url");
    const messageToken = randomBytes(24).toString("base64url");
    const replyToAlias = inboundRelayAliasAddress(aliasToken, relayDomain);
    const outboundRfcMessageId = inboundRelayOutboundMessageId({
      token: messageToken,
      senderDomain: inbox.senderDomain ?? "",
    });
    if (!replyToAlias || !outboundRfcMessageId) {
      throw new Error("The inbound relay canary binding is invalid");
    }
    const dsnRoutingTarget = await inboundRelayDsnRoutingTarget({
      siteId: String(siteId),
      inboxId: String(inbox._id),
      generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
      relayDomain,
      secret: runtimeConfig.dsnTargetSecret,
    });
    if (!dsnRoutingTarget) {
      throw new Error("The per-inbox DSN routing target is unavailable");
    }
    const issuedAt = Date.now();
    const expiresAt = issuedAt + OUTREACH_INBOUND_RELAY_CANARY_TTL_MS;
    const attemptId = randomUUID();
    const dnsEvidence = await liveDnsEvidence(inbox);
    const challenge = await ctx.runMutation(
      internal.outreach.createInboundRelayDsnCanary,
      {
      siteId,
      inboxId: inbox._id,
      aliasHash: inboundRelayAliasHash(replyToAlias),
      outboundMessageIdHash: inboundRelayMessageIdHash(outboundRfcMessageId),
      testRecipientHash: inboundRelayEmailHash(testRecipient),
      relayDomain,
      senderDomain: inbox.senderDomain ?? "",
      rolloutEpoch: inbox.siteRolloutEpoch ?? 0,
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      relayConfigurationHash,
      adapterVersion: runtimeConfig.adapterVersion ?? "",
      retentionPolicyHash: runtimeConfig.retentionPolicyHash ?? "",
      dsnRoutingTargetHash: dsnRoutingTarget.hash,
      dsnRoutingTargetVersion: dsnRoutingTarget.version,
      dsnRoutingTargetGeneration:
        inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
      issuedAt,
      expiresAt,
      attemptId,
      deliveryLeaseExpiresAt:
        issuedAt + OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS,
      dnsEvidence,
      },
    );
    const canaryInbox = inbox.provider === "smtp"
      ? {
          ...inbox,
          smtpPassword: (await decryptedMailboxSecrets(siteId, inbox)).smtpPassword,
        }
      : inbox;
    const outcome = await deliver(canaryInbox, {
      toEmail: testRecipient,
      subject: "Pentra hard-bounce routing canary",
      body:
        "This owner-triggered delivery is a Pentra routing canary. The fixed controlled recipient is expected to reject it so the resulting structured DSN can verify inbound compliance handling.",
      replyTo: replyToAlias,
      outboundRfcMessageId,
    });
    try {
      await ctx.runMutation(
        internal.outreach.finalizeInboundRelayDsnCanaryDelivery,
        {
          canaryId: challenge.canaryId,
          siteId,
          inboxId: inbox._id,
          attemptId,
          inboxConfigurationVersion: inbox.configurationVersion ?? 0,
          outcome: outcome.ok
            ? "accepted"
            : outcome.unverified
              ? "unverified"
              : "failed",
          providerMessageIdHash: outcome.ok
            ? createHash("sha256").update(outcome.providerMessageId!).digest("hex")
            : undefined,
        },
      );
    } catch {
      return {
        accepted: false as const,
        verified: false as const,
        retryAfter: expiresAt,
        reason:
          "Pentra could not seal the mailbox canary outcome. Outreach remains blocked and this challenge will not be retried automatically.",
      };
    }
    if (!outcome.ok) {
      if (outcome.suspend) {
        try {
          await ctx.runMutation(internal.outreach.recordInboxError, {
            siteId,
            inboxId: inbox._id,
            expectedConfigurationVersion: inbox.configurationVersion ?? 0,
            error: outcome.error ?? "Provider rejected the canary send",
            suspend: true,
          });
        } catch {
          // The challenge remains fail-closed and expires without a receipt.
        }
      }
      return {
        accepted: false as const,
        verified: false as const,
        retryAfter: expiresAt,
        reason: outcome.unverified
          ? "The mailbox canary outcome is ambiguous; Pentra will wait for the signed DSN and will not send another canary before this challenge expires."
          : "The mailbox did not accept the fixed-recipient canary.",
      };
    }
    return {
      accepted: true as const,
      verified: false as const,
      expiresAt,
      message:
        "The mailbox accepted the canary. Outreach remains blocked until the receiving-only adapter returns the exact signed structured hard-DSN.",
    };
  },
});

const controlledSmtpImapCanaryKindValidator = v.union(
  v.literal("smtp_delivery"),
  v.literal("imap_reply"),
  v.literal("imap_bounce"),
  v.literal("imap_stop"),
);

type ControlledSmtpImapCanaryRunResult = {
  started: boolean;
  reason?: string;
  status?: string;
  nextEligibleAt?: number;
  accepted?: boolean;
  ambiguous?: boolean;
  signalAccepted?: boolean;
  awaitingInbound?: boolean;
  messageId?: Id<"outreach_messages">;
};

type ControlledSmtpImapCanaryReservation =
  | {
      claimed: false;
      reason: string;
      status?: string;
      nextEligibleAt?: number;
      messageId?: Id<"outreach_messages">;
    }
  | {
      claimed: true;
      inbox: Doc<"outreach_inboxes">;
      messageId: Id<"outreach_messages">;
      followupMessageId: Id<"outreach_messages">;
      attemptId: string;
      operationKey: string;
      toEmail: string;
      subject: string;
      body: string;
      leaseExpiresAt: number;
    };

/**
 * Execute one explicitly consented bootstrap-v1 transport canary. Targets are
 * derived in the serializable reservation mutation: the connected mailbox for
 * delivery/reply/STOP, or example.invalid for bounce. No caller can supply a
 * recipient and no prospect delivery is possible through this action.
 */
export const runControlledSmtpImapCanaryInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    kind: controlledSmtpImapCanaryKindValidator,
  },
  handler: async (ctx, { siteId, kind }):
    Promise<ControlledSmtpImapCanaryRunResult> => {
    const inbox = await ctx.runQuery(internal.outreach.getInboxInternal, { siteId });
    if (!inbox || inbox.provider !== "smtp") {
      return { started: false as const, reason: "A verified SMTP mailbox is required." };
    }
    const attemptId = randomUUID();
    const senderDomain = normalizeDomain(
      inbox.senderDomain ?? inbox.fromEmail.split("@")[1] ?? "",
    );
    if (!senderDomain) {
      return { started: false as const, reason: "Sender domain is invalid." };
    }
    const outboundRfcMessageId =
      `<${randomBytes(24).toString("hex")}@${senderDomain}>`;
    const reservation = await ctx.runMutation(
      internal.outreach.reserveControlledSmtpImapCanaryInternal,
      {
        siteId,
        kind,
        attemptId,
        outboundMessageIdHash: inboundRelayMessageIdHash(outboundRfcMessageId),
      },
    ) as ControlledSmtpImapCanaryReservation;
    if (!reservation.claimed) return { started: false as const, ...reservation };

    let secrets: { smtpPassword: string; imapPassword: string };
    try {
      secrets = await decryptedMailboxSecrets(siteId, reservation.inbox);
    } catch {
      await ctx.runMutation(internal.outreach.failDeliveryAttempt, {
        siteId,
        messageId: reservation.messageId,
        attemptId,
        reason: "controlled_canary_credential_unavailable",
      });
      return { started: true as const, accepted: false as const };
    }
    let outcome: DeliveryOutcome;
    try {
      outcome = await deliver({
        ...reservation.inbox,
        smtpPassword: secrets.smtpPassword,
      }, {
        toEmail: reservation.toEmail,
        subject: reservation.subject,
        body: reservation.body,
        outboundRfcMessageId,
      });
    } catch {
      outcome = {
        ok: false,
        error: "controlled_canary_delivery_unverified",
        unverified: true,
      };
    }
    if (!outcome.ok) {
      await ctx.runMutation(internal.outreach.failDeliveryAttempt, {
        siteId,
        messageId: reservation.messageId,
        attemptId,
        reason: outcome.error ?? "controlled_canary_delivery_failed",
        bounced: outcome.bounced,
        unverified: outcome.unverified,
      });
      return {
        started: true as const,
        accepted: false as const,
        ambiguous: Boolean(outcome.unverified),
      };
    }
    const completed = await ctx.runMutation(
      internal.outreach.completeDeliveryAttempt,
      {
        siteId,
        messageId: reservation.messageId,
        attemptId,
        providerMessageId: outcome.providerMessageId,
        outboundRfcMessageId,
      },
    );
    if (!completed.recorded) {
      return { started: true as const, accepted: false as const, ambiguous: true };
    }

    if (kind !== "imap_reply" && kind !== "imap_stop") {
      return {
        started: true as const,
        accepted: true as const,
        messageId: reservation.messageId,
        awaitingInbound: kind === "imap_bounce",
      };
    }
    const signal = await ctx.runMutation(
      internal.outreach.claimControlledSmtpImapSignalInternal,
      {
        siteId,
        messageId: reservation.messageId,
        operationKey: reservation.operationKey,
      },
    );
    if (!signal.claimed) {
      return { started: true as const, accepted: true as const, signalAccepted: false };
    }
    const signalMessageId = `<${randomBytes(24).toString("hex")}@${senderDomain}>`;
    let signalOutcome: DeliveryOutcome;
    try {
      signalOutcome = await deliver({
        ...reservation.inbox,
        smtpPassword: secrets.smtpPassword,
      }, {
        toEmail: reservation.inbox.fromEmail,
        subject: `Re: ${reservation.subject}`,
        body: kind === "imap_stop"
          ? "STOP"
          : "Pentra controlled reply canary. No response is required.",
        outboundRfcMessageId: signalMessageId,
        inReplyToRfcMessageId: outboundRfcMessageId,
      });
    } catch {
      signalOutcome = {
        ok: false,
        error: "controlled_canary_signal_unverified",
        unverified: true,
      };
    }
    await ctx.runMutation(
      internal.outreach.settleControlledSmtpImapSignalInternal,
      {
        siteId,
        messageId: reservation.messageId,
        operationKey: reservation.operationKey,
        accepted: signalOutcome.ok,
        receiptHash: signalOutcome.ok
          ? signalOutcome.providerMessageId
          : undefined,
        ambiguous: Boolean(!signalOutcome.ok && signalOutcome.unverified),
      },
    );
    return {
      started: true as const,
      accepted: true as const,
      signalAccepted: signalOutcome.ok,
      messageId: reservation.messageId,
      awaitingInbound: signalOutcome.ok,
    };
  },
});

// ── Inbound reply, bounce and opt-out monitoring ──

type GmailHeader = { name?: string; value?: string };
type GmailPayload = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

type InboundSyncResult = {
  checked: number;
  replied: number;
  optedOut: number;
  bounced: number;
  ignored: number;
  partial: boolean;
  stopped?: string;
};

function rfcMessageIdHashes(source: string): string[] {
  const hashes = new Set<string>();
  for (const match of source.matchAll(/<[^<>\s\r\n]{3,250}>/g)) {
    hashes.add(inboundRelayMessageIdHash(match[0]));
  }
  return [...hashes];
}

function dsnFailedRecipients(source: string): string[] {
  const emails = new Set<string>();
  const pattern = /(?:Final|Original)-Recipient:\s*(?:rfc822\s*;\s*)?([^\s<>;]+@[^\s<>;]+)/gi;
  for (const match of source.matchAll(pattern)) {
    const email = match[1]?.trim().toLowerCase();
    if (email && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(email)) emails.add(email);
  }
  return [...emails];
}

async function pollImapHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<InboundSyncResult> {
  const result: InboundSyncResult = {
    checked: 0, replied: 0, optedOut: 0, bounced: 0,
    ignored: 0, partial: false,
  };
  const attemptId = randomUUID();
  const claim = await ctx.runMutation(internal.outreach.claimImapPollInternal, {
    siteId, attemptId,
  });
  if (!claim.claimed) return { ...result, stopped: claim.reason };
  const fail = async (
    reason: "imap_connection_failed" | "imap_parse_failed" |
      "imap_receipt_failed" | "imap_deadline",
  ) => {
    await ctx.runMutation(internal.outreach.failImapPollInternal, {
      siteId, inboxId: claim.inbox._id, attemptId,
      expectedConfigurationVersion: claim.expectedConfigurationVersion,
      reason,
    }).catch(() => undefined);
    return {
      ...result,
      stopped:
        "IMAP reply monitoring failed closed; the mailbox cursor did not advance.",
    };
  };
  let secrets: { smtpPassword: string; imapPassword: string };
  try {
    secrets = await decryptedMailboxSecrets(siteId, claim.inbox);
  } catch {
    return fail("imap_connection_failed");
  }
  const client = new ImapFlow({
    host: claim.inbox.imapHost!, port: claim.inbox.imapPort!, secure: true,
    auth: { user: claim.inbox.imapUsername!, pass: secrets.imapPassword },
    logger: false, socketTimeout: 45_000, greetingTimeout: 10_000,
  });
  const deadlineAt = Date.now() + 60_000;
  let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | undefined;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX", { readOnly: true });
    if (!client.mailbox) throw new Error("imap_parse_failed");
    const uidValidity = client.mailbox.uidValidity.toString();
    const cursorCurrent = claim.uidValidity === uidValidity;
    const search = cursorCurrent && claim.lastUid > 0
      ? await client.search({ uid: `${claim.lastUid + 1}:*` }, { uid: true })
      : await client.search(
          { since: new Date(Date.now() - OUTREACH_IMAP_LOOKBACK_MS) },
          { uid: true },
        );
    const allUids = (Array.isArray(search) ? search : [])
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
      .sort((left, right) => left - right);
    const uids = allUids.slice(0, OUTREACH_IMAP_MAX_RESULTS);
    const candidates = claim.candidates as ImapCandidate[];
    let lastUid = cursorCurrent ? claim.lastUid : 0;
    for (const uid of uids) {
      if (Date.now() >= deadlineAt) throw new Error("imap_deadline");
      const row = await client.fetchOne(
        uid,
        {
          source: { start: 0, maxLength: OUTREACH_IMAP_MAX_MESSAGE_BYTES },
          internalDate: true,
        },
        { uid: true },
      );
      if (row === false || !row.source) throw new Error("imap_parse_failed");
      const raw = row.source.toString("utf8");
      const eventKey = imapEventKey({
        siteId: String(siteId), inboxId: String(claim.inbox._id),
        uidValidity, uid,
      });
      const parsed = await simpleParser(row.source, {
        skipHtmlToText: true,
        skipTextToHtml: true,
        skipImageLinks: true,
        maxHtmlLengthToParse: 64_000,
      });
      const fromEmail = parsed.from?.value[0]?.address?.toLowerCase() ?? "";
      const parsedReceivedAt = parsed.date?.getTime() ?? (
        row.internalDate
          ? new Date(row.internalDate).getTime()
          : Date.now()
      );
      const receivedAt = Number.isSafeInteger(parsedReceivedAt) && parsedReceivedAt > 0
        ? parsedReceivedAt
        : Date.now();
      const inboundMessageIdHash = createHash("sha256")
        .update(parsed.messageId ?? `${uidValidity}:${uid}`)
        .digest("hex");
      const evidence: ImapEvidence = {
        uidValidity, uid, inboundMessageIdHash,
        referencedMessageIdHashes: rfcMessageIdHashes(raw),
        fromEmail,
        subject: parsed.subject ?? "",
        bodyText: parsed.text?.slice(0, 100_000) ?? "",
        mimeTypes: parsed.attachments.map((attachment) => attachment.contentType),
        failedRecipients: dsnFailedRecipients(raw),
        authenticationResults:
          String(parsed.headers.get("authentication-results") ?? ""),
        autoSubmitted: String(parsed.headers.get("auto-submitted") ?? ""),
        receivedAt,
      };
      const match = classifyImapEvidence({
        evidence, candidates, mailboxEmail: claim.inbox.fromEmail,
      });
      const common = {
        siteId, inboxId: claim.inbox._id, attemptId,
        expectedConfigurationVersion: claim.expectedConfigurationVersion,
        eventKey, uidValidity, uid, inboundMessageIdHash, receivedAt,
      };
      if (!match) {
        const evidenceHash = createHash("sha256").update(JSON.stringify({
          version: 1, eventKey, inboundMessageIdHash,
          references: evidence.referencedMessageIdHashes,
          receivedAt,
        })).digest("hex");
        const recorded = await ctx.runMutation(
          internal.outreach.recordImapReceiptInternal,
          { ...common, kind: "ignored", evidenceHash },
        );
        if (!recorded.recorded && recorded.reason !== "already_recorded") {
          throw new Error("imap_receipt_failed");
        }
        result.ignored++;
      } else {
        const fromEmailHash = createHash("sha256").update(fromEmail).digest("hex");
        const evidenceHash = imapEvidenceHash({
          eventKey, messageId: match.candidate.messageId, kind: match.kind,
          inboundMessageIdHash, fromEmailHash, receivedAt,
          subjectHash: createHash("sha256").update(evidence.subject).digest("hex"),
          bodyHash: createHash("sha256").update(evidence.bodyText).digest("hex"),
        });
        const recorded = await ctx.runMutation(
          internal.outreach.recordImapReceiptInternal,
          {
            ...common,
            messageId: match.candidate.messageId as Id<"outreach_messages">,
            kind: match.kind, evidenceHash,
            outboundMessageIdHash: match.candidate.outboundMessageIdHash,
            fromEmail,
          },
        );
        if (!recorded.recorded && recorded.reason !== "already_recorded") {
          throw new Error("imap_receipt_failed");
        }
        if (recorded.recorded) {
          if (match.kind === "reply") result.replied++;
          else if (match.kind === "unsubscribe") result.optedOut++;
          else result.bounced++;
        }
      }
      result.checked++;
      lastUid = uid;
    }
    result.partial = allUids.length > uids.length;
    const completed = await ctx.runMutation(
      internal.outreach.completeImapPollInternal,
      {
        siteId, inboxId: claim.inbox._id, attemptId,
        expectedConfigurationVersion: claim.expectedConfigurationVersion,
        uidValidity, lastUid, partial: result.partial,
      },
    );
    if (!completed.recorded) throw new Error("imap_receipt_failed");
    return result;
  } catch (error) {
    const reason = error instanceof Error && [
      "imap_parse_failed", "imap_receipt_failed", "imap_deadline",
    ].includes(error.message)
      ? error.message as "imap_parse_failed" | "imap_receipt_failed" | "imap_deadline"
      : "imap_connection_failed";
    return fail(reason);
  } finally {
    lock?.release();
    if (client.usable) await client.logout().catch(() => undefined);
  }
}

export const syncImapInbox = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<InboundSyncResult> => {
    await requireOwnedSite(ctx, siteId);
    return pollImapHandler(ctx, siteId);
  },
});

export const syncImapInboxInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<InboundSyncResult> =>
    pollImapHandler(ctx, siteId),
});

function gmailHeader(payload: GmailPayload | undefined, name: string): string {
  return payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

function decodeGmailBody(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(
      data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return "";
  }
}

function stripInboundHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function gmailPayloadEvidence(payload: GmailPayload | undefined): {
  bodyText: string;
  mimeTypes: string[];
} {
  const plain: string[] = [];
  const html: string[] = [];
  const delivery: string[] = [];
  const mimeTypes: string[] = [];
  const visit = (part: GmailPayload | undefined) => {
    if (!part) return;
    const mime = String(part.mimeType ?? "").toLowerCase();
    if (mime) mimeTypes.push(mime);
    const decoded = decodeGmailBody(part.body?.data).slice(0, 100_000);
    if (decoded) {
      if (mime === "text/plain") plain.push(decoded);
      else if (mime === "text/html") html.push(stripInboundHtml(decoded));
      else if (mime === "message/delivery-status") delivery.push(decoded);
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  const bodyText = [...plain, ...delivery, ...(plain.length === 0 ? html : [])]
    .join("\n")
    .slice(0, 200_000);
  return { bodyText, mimeTypes: [...new Set(mimeTypes)] };
}

function gmailInboundEvidence(message: GmailMessage): OutreachInboundEvidence | null {
  const providerMessageId = String(message.id ?? "");
  const providerThreadId = String(message.threadId ?? "");
  const receivedAt = Number(message.internalDate);
  if (
    !/^[a-zA-Z0-9_-]{1,200}$/.test(providerMessageId) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(providerThreadId) ||
    !Number.isFinite(receivedAt)
  ) {
    return null;
  }
  const payloadEvidence = gmailPayloadEvidence(message.payload);
  const headerFailedRecipients = gmailHeader(message.payload, "X-Failed-Recipients")
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const bodyAddresses = payloadEvidence.bodyText
    .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi) ?? [];
  const failedRecipients = [...new Set(
    [...headerFailedRecipients, ...bodyAddresses]
      .map((value) => value.toLowerCase())
      .slice(0, 10),
  )];
  return {
    providerMessageId,
    providerThreadId,
    fromEmail: emailAddressFromHeader(gmailHeader(message.payload, "From")),
    subject: gmailHeader(message.payload, "Subject").slice(0, 500),
    autoSubmitted: gmailHeader(message.payload, "Auto-Submitted").slice(0, 100),
    authenticationResults: gmailHeader(
      message.payload,
      "Authentication-Results",
    ).slice(0, 4_000),
    bodyText: payloadEvidence.bodyText,
    mimeTypes: payloadEvidence.mimeTypes,
    failedRecipients,
    receivedAt,
  };
}

async function boundedResponseJson<T>(
  response: Response,
  maximumBytes: number,
): Promise<T | null> {
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function gmailReadJson<T>(args: {
  accessToken: string;
  path: string;
  deadlineAt: number;
  maximumBytes?: number;
}): Promise<T | null> {
  const remaining = args.deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("inbound_sync_deadline");
  let response: Response;
  try {
    response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${args.path}`, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, remaining))),
    });
  } catch {
    return null;
  }
  return boundedResponseJson<T>(
    response,
    args.maximumBytes ?? OUTREACH_INBOUND_MAX_MESSAGE_BYTES,
  );
}

async function syncInboundHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<InboundSyncResult> {
  const result: InboundSyncResult = {
    checked: 0,
    replied: 0,
    optedOut: 0,
    bounced: 0,
    ignored: 0,
    partial: false,
  };
  const attemptId = randomUUID();
  const claim = await ctx.runMutation(internal.outreach.claimInboundSync, {
    siteId,
    attemptId,
  });
  if (!claim.claimed) return { ...result, stopped: claim.reason };

  const fail = async (reason: string, stopped: string) => {
    try {
      await ctx.runMutation(internal.outreach.failInboundSync, {
        siteId,
        inboxId: claim.inbox._id,
        attemptId,
        expectedConfigurationVersion: claim.inboxConfigurationVersion,
        reason,
      });
    } catch {
      // The lease or tenant may have been revoked. No provider write occurred.
    }
    return { ...result, stopped };
  };

  const refreshed = claim.inbox.oauthRefreshToken
    ? await refreshGoogleAccessToken(claim.inbox.oauthRefreshToken)
    : null;
  const accessToken = refreshed?.ok
    ? refreshed.accessToken
    : claim.inbox.oauthRefreshToken
      ? undefined
      : claim.inbox.oauthAccessToken;
  if (!accessToken) {
    return fail(
      "gmail_authorization_unavailable",
      "Gmail reply monitoring authorization is unavailable; reconnect the inbox.",
    );
  }
  const deadlineAt = Date.now() + OUTREACH_INBOUND_TOTAL_DEADLINE_MS;
  const candidates = claim.candidates as OutreachInboundCandidate[];

  // Legacy delivery receipts may predate thread capture. Resolve only a small
  // bounded set from the sealed provider message IDs before reading new mail.
  for (const candidate of candidates.filter(
    (row) => !row.providerThreadId && row.providerMessageId,
  ).slice(0, 10)) {
    const message = await gmailReadJson<GmailMessage>({
      accessToken,
      path: `messages/${encodeURIComponent(candidate.providerMessageId!)}?format=metadata`,
      deadlineAt,
      maximumBytes: 200_000,
    });
    if (!message?.threadId) continue;
    const bound = await ctx.runMutation(internal.outreach.bindInboundProviderThread, {
      siteId,
      inboxId: claim.inbox._id,
      messageId: candidate.messageId as Id<"outreach_messages">,
      attemptId,
      expectedConfigurationVersion: claim.inboxConfigurationVersion,
      providerMessageId: candidate.providerMessageId!,
      providerThreadId: message.threadId,
    });
    if (!bound.recorded) {
      return fail("inbound_receipt_failed", "The Gmail sync lease changed; no inbox cursor advanced.");
    }
    candidate.providerThreadId = message.threadId;
  }

  let pageToken = claim.pageToken;
  let remainingPageToken: string | undefined;
  try {
    for (let page = 0; page < OUTREACH_INBOUND_MAX_PAGES; page++) {
      if (Date.now() >= deadlineAt) throw new Error("inbound_sync_deadline");
      const query = `in:anywhere after:${Math.floor(claim.searchAfter / 1000)} -from:${claim.inbox.fromEmail}`;
      const params = new URLSearchParams({
        q: query,
        maxResults: String(OUTREACH_INBOUND_MAX_RESULTS),
      });
      if (pageToken) params.set("pageToken", pageToken);
      const listing = await gmailReadJson<{
        messages?: Array<{ id?: string; threadId?: string }>;
        nextPageToken?: string;
      }>({
        accessToken,
        path: `messages?${params}`,
        deadlineAt,
        maximumBytes: 250_000,
      });
      if (!listing) throw new Error("gmail_read_failed");

      const evidenceRows: OutreachInboundEvidence[] = [];
      for (const row of listing.messages ?? []) {
        if (!row.id) continue;
        const message = await gmailReadJson<GmailMessage>({
          accessToken,
          path: `messages/${encodeURIComponent(row.id)}?format=full`,
          deadlineAt,
        });
        if (!message) throw new Error("gmail_read_failed");
        const evidence = gmailInboundEvidence(message);
        if (evidence) evidenceRows.push(evidence);
        else result.ignored++;
      }

      // Provider list order is newest-first. Apply receipts chronologically so
      // a later explicit STOP can only strengthen an earlier ordinary reply.
      evidenceRows.sort((a, b) => a.receivedAt - b.receivedAt);
      for (const evidence of evidenceRows) {
        result.checked++;
        const evidenceCandidates = await ctx.runQuery(
          internal.outreach.getInboundCandidatesForEvidence,
          {
            siteId,
            inboxId: claim.inbox._id,
            attemptId,
            expectedConfigurationVersion: claim.inboxConfigurationVersion,
            providerThreadId: evidence.providerThreadId,
            failedRecipients: evidence.failedRecipients ?? [],
          },
        );
        const match = classifyOutreachInbound({
          evidence,
          candidates: evidenceCandidates as OutreachInboundCandidate[],
          senderEmail: claim.inbox.fromEmail,
        });
        if (!match) {
          result.ignored++;
          continue;
        }
        const subjectDigest = createHash("sha256")
          .update(evidence.subject)
          .digest("hex");
        const bodyDigest = createHash("sha256")
          .update(evidence.bodyText)
          .digest("hex");
        const evidenceHash = createHash("sha256")
          .update(outreachInboundReceipt({
            siteId,
            messageId: match.candidate.messageId,
            providerMessageId: evidence.providerMessageId,
            providerThreadId: evidence.providerThreadId,
            kind: match.kind,
            fromEmail: evidence.fromEmail,
            receivedAt: evidence.receivedAt,
            subjectDigest,
            bodyDigest,
          }))
          .digest("hex");
        const recorded = await ctx.runMutation(internal.outreach.recordInboundReceipt, {
          siteId,
          inboxId: claim.inbox._id,
          messageId: match.candidate.messageId as Id<"outreach_messages">,
          attemptId,
          expectedConfigurationVersion: claim.inboxConfigurationVersion,
          providerMessageId: evidence.providerMessageId,
          providerThreadId: evidence.providerThreadId,
          kind: match.kind,
          fromEmail: evidence.fromEmail,
          receivedAt: evidence.receivedAt,
          evidenceHash,
        });
        if (recorded.recorded) {
          if (match.kind === "reply") result.replied++;
          else if (match.kind === "unsubscribe") result.optedOut++;
          else result.bounced++;
        } else if (recorded.reason !== "already_recorded") {
          throw new Error("inbound_receipt_failed");
        }
      }

      pageToken = listing.nextPageToken;
      remainingPageToken = pageToken;
      if (!pageToken) break;
    }
  } catch (error) {
    const code = error instanceof Error && error.message === "inbound_sync_deadline"
      ? "inbound_sync_deadline"
      : error instanceof Error && error.message === "inbound_receipt_failed"
        ? "inbound_receipt_failed"
        : "gmail_read_failed";
    return fail(
      code,
      code === "inbound_sync_deadline"
        ? "The bounded Gmail sync reached its deadline; the cursor did not advance."
        : "Gmail reply monitoring failed closed; the inbox cursor did not advance.",
    );
  }

  const completed = await ctx.runMutation(internal.outreach.completeInboundSync, {
    siteId,
    inboxId: claim.inbox._id,
    attemptId,
    expectedConfigurationVersion: claim.inboxConfigurationVersion,
    syncWindowStartedAt: claim.syncWindowStartedAt,
    nextPageToken: remainingPageToken,
  });
  if (!completed.recorded) {
    return { ...result, stopped: "The Gmail sync lease changed; no inbox cursor advanced." };
  }
  result.partial = !completed.complete;
  return result;
}

export const syncInboundReplies = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<InboundSyncResult> => {
    const [ownership, identity] = await Promise.all([
      ctx.runQuery(internal.outreach.getLegacyInboundOwnership, { siteId }),
      ctx.auth.getUserIdentity(),
    ]);
    if (!ownership?.userId || !identity || identity.subject !== ownership.userId) {
      throw new Error("Not authorized to access this site's outreach");
    }
    return syncInboundHandler(ctx, siteId);
  },
});

export const syncInboundRepliesInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<InboundSyncResult> => {
    // claimInboundSync owns the narrow post-send lifecycle/transition fence;
    // a full growth-authorization preflight would strand parked STOP replies.
    return syncInboundHandler(ctx, siteId);
  },
});

// ── Link receipt verification ──

type VerifyResult = {
  checked: number;
  acquired: number;
  stillMissing: number;
  lost: number;
};

/**
 * The receipt for a link is the exact target URL appearing as an href on the
 * exact page we asked about. Nothing weaker may mark a link acquired: a brand
 * mention, a redirect, or a nofollow reference on some other page is not the
 * link that was requested.
 */
async function pageLinksToTarget(
  sourceUrl: string,
  targetUrl: string,
): Promise<{ found: boolean; receiptUrl?: string }> {
  await validatePublicHttpsUrl(sourceUrl);
  const fetched = await safeFetchPublicText(sourceUrl, {
    maxBytes: 1_000_000,
    timeoutMs: 12_000,
  });
  const requestedHost = new URL(sourceUrl).hostname;
  const finalHost = new URL(fetched.url).hostname;
  if (!isSameOrganisationHost(finalHost, requestedHost)) {
    // A third-party redirect cannot prove that the stored publisher page
    // acquired (or retained) the requested link.
    return { found: false };
  }
  const found = hasExactAuthorityLink({
    html: fetched.text,
    sourceUrl: fetched.url,
    targetUrl,
  });
  return { found, receiptUrl: found ? fetched.url : undefined };
}

async function verifyHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  limit: number,
): Promise<VerifyResult> {
  const result: VerifyResult = { checked: 0, acquired: 0, stillMissing: 0, lost: 0 };

  const [contacted, alreadyAcquired] = await Promise.all([
    ctx.runQuery(internal.seoAuthority.listByStatusInternal, {
      siteId,
      status: "contacted",
      limit,
    }),
    ctx.runQuery(internal.seoAuthority.listByStatusInternal, {
      siteId,
      status: "acquired",
      limit,
    }),
  ]);

  for (const opportunity of contacted) {
    result.checked++;
    try {
      const receipt = await pageLinksToTarget(
        opportunity.sourceUrl,
        opportunity.targetUrl,
      );
      if (receipt.found && receipt.receiptUrl) {
        await ctx.runMutation(internal.seoAuthority.markAcquired, {
          siteId,
          opportunityId: opportunity._id,
          acquiredLinkUrl: receipt.receiptUrl,
        });
        result.acquired++;
      } else {
        result.stillMissing++;
      }
    } catch {
      // An unreachable page is not evidence of a link.
      result.stillMissing++;
    }
  }

  // A link that disappears must stop counting. Only an affirmative fetch that
  // no longer contains the href demotes it; a failed fetch leaves it alone.
  for (const opportunity of alreadyAcquired) {
    result.checked++;
    try {
      const receipt = await pageLinksToTarget(
        opportunity.sourceUrl,
        opportunity.targetUrl,
      );
      if (!receipt.found) {
        await ctx.runMutation(internal.seoAuthority.markAcquiredLinkLost, {
          siteId,
          opportunityId: opportunity._id,
        });
        result.lost++;
      }
    } catch {
      // Leave the acquired status untouched when the page cannot be read.
    }
  }

  return result;
}

export const verifyAcquiredLinks = action({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }): Promise<VerifyResult> => {
    await requireOwnedSite(ctx, siteId);
    return verifyHandler(ctx, siteId, Math.max(1, Math.min(limit ?? 50, 200)));
  },
});

export const verifyAcquiredLinksInternal = internalAction({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }): Promise<VerifyResult> => {
    // Fleet readiness is only a scheduling hint. Re-read the canonical
    // account entitlement immediately before any external page verification.
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    return verifyHandler(
      ctx,
      siteId,
      Math.max(1, Math.min(limit ?? 50, 200)),
    );
  },
});

type ControlledBacklinkCanaryVerificationResult = VerifyResult & {
  opportunityId: Id<"seo_authority_opportunities">;
  verified: boolean;
  acquiredAt?: number;
  acquiredLinkUrl?: string;
};

/**
 * Controlled release coordinator. Reservation proves both domains belong to
 * the same Pentra account; acquisition is then decided exclusively by the
 * ordinary exact-href verifier used for every customer opportunity.
 */
export const verifyControlledBacklinkCanaryInternal = internalAction({
  args: {
    targetSiteId: v.id("sites"),
    sourceSiteId: v.id("sites"),
  },
  handler: async (ctx, { targetSiteId, sourceSiteId }):
    Promise<ControlledBacklinkCanaryVerificationResult> => {
    const opportunity = await ctx.runMutation(
      internal.seoAuthority.reserveControlledBacklinkCanaryInternal,
      { targetSiteId, sourceSiteId },
    ) as Doc<"seo_authority_opportunities"> | null;
    if (!opportunity) throw new Error("Controlled backlink reservation failed");
    const result = await verifyHandler(ctx, targetSiteId, 50);
    const acquired = await ctx.runQuery(
      internal.seoAuthority.listByStatusInternal,
      { siteId: targetSiteId, status: "acquired", limit: 200 },
    ) as Doc<"seo_authority_opportunities">[];
    const settled = acquired.find((row) => row._id === opportunity._id);
    return {
      ...result,
      opportunityId: opportunity._id,
      verified: Boolean(settled),
      acquiredAt: settled?.acquiredAt,
      acquiredLinkUrl: settled?.acquiredLinkUrl,
    };
  },
});

export type { InboundSyncResult, PrepareResult, SendResult, VerifyResult };
