import {
  accountDeletionKey,
  accountDeletionRequestedForKey,
} from "./accountDeletion.ts";
import { normalizeDomain } from "./outreachPacing.ts";
import { sha256Hex } from "./publicationArtifact.ts";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { utcDayKey } from "./outreachPacing.ts";
import { outreachOrganisationDomain } from "./outreachContacts.ts";

export const OUTREACH_SENDER_REPUTATION_RETENTION_MS =
  90 * 24 * 60 * 60 * 1000;
export const OUTREACH_ACCOUNT_TENANT_SCOPE_KEY = sha256Hex(
  "pentra-outreach-account-tenant-scope:v1",
);

/**
 * Stable, PII-minimized scope for outreach compliance and reputation state.
 *
 * v1 deliberately uses a conservative account-wide tenant scope rather than
 * a mutable site id, primary domain, or replaceable secondary sending domain.
 * A STOP or cooldown therefore survives site deletion, recreation, and domain
 * edits. Separate customer accounts remain cryptographically isolated. The
 * conservative account scope also prevents one owner from contacting the same
 * recipient again through another brand they control.
 */
export function outreachTenantScope(args: {
  userId: string;
  tenantDomain: string;
}): { accountKey: string; tenantDomainKey: string } | null {
  if (!args.userId) return null;
  return {
    accountKey: accountDeletionKey(args.userId),
    tenantDomainKey: OUTREACH_ACCOUNT_TENANT_SCOPE_KEY,
  };
}

export function outreachRecipientDomainKey(value: string): string {
  const domain = outreachOrganisationDomain(value);
  return domain
    ? sha256Hex(`pentra-outreach-recipient-domain:v1:${domain}`)
    : "";
}

export function outreachSenderDomainKey(value: string): string {
  const domain = normalizeDomain(value);
  return domain
    ? sha256Hex(`pentra-outreach-sender-domain:v1:${domain}`)
    : "";
}

export function outreachMailboxKey(value: string): string {
  const email = String(value || "").trim().toLowerCase();
  return email && email.includes("@")
    ? sha256Hex(`pentra-outreach-mailbox:v1:${email}`)
    : "";
}

export function outreachContactReceiptIdentity(args: {
  userId: string;
  tenantDomain: string;
  recipientDomain: string;
}): {
  accountKey: string;
  tenantDomainKey: string;
  recipientDomainKey: string;
} | null {
  const scope = outreachTenantScope(args);
  const recipientDomainKey = outreachRecipientDomainKey(args.recipientDomain);
  return scope && recipientDomainKey ? { ...scope, recipientDomainKey } : null;
}

export function outreachContactReceiptIdentityForAccount(args: {
  accountKey: string;
  recipientDomain: string;
}): {
  accountKey: string;
  tenantDomainKey: string;
  recipientDomainKey: string;
} | null {
  const recipientDomainKey = outreachRecipientDomainKey(args.recipientDomain);
  return args.accountKey && recipientDomainKey
    ? {
        accountKey: args.accountKey,
        tenantDomainKey: OUTREACH_ACCOUNT_TENANT_SCOPE_KEY,
        recipientDomainKey,
      }
    : null;
}

export function outreachPacingReceiptIdentity(args: {
  userId: string;
  tenantDomain: string;
  senderDomain: string;
}): {
  accountKey?: string;
  tenantDomainKey?: string;
  senderDomainKey: string;
} | null {
  const scope = outreachTenantScope(args);
  const senderDomainKey = outreachSenderDomainKey(args.senderDomain);
  return senderDomainKey ? { ...(scope ?? {}), senderDomainKey } : null;
}

type ReadCtx = QueryCtx | MutationCtx;

export type DurablePacingState = {
  mailboxKey: string;
  warmupStartedAt: number;
  sentToday: number;
  sentTodayDay: string;
  lastSentAt?: number;
  updatedAt: number;
};

export function durablePacingReceiptOwnership(args: {
  existingAccountKey?: string;
  existingTenantDomainKey?: string;
  incomingAccountKey: string;
  incomingTenantDomainKey: string;
}): {
  accountKey?: string;
  tenantDomainKey?: string;
  preservesExistingOwner: boolean;
} {
  // An undefined account key is deliberate after verified account deletion:
  // the globally hashed reputation state stays reserved through retention
  // without linking it to the deleted user. Historical migration/materialize
  // callers must not adopt either that unlinked row or another account's row;
  // only the explicit, preflighted OAuth connect protocol may establish an
  // owner.
  const preservesExistingOwner =
    args.existingAccountKey !== args.incomingAccountKey;
  return preservesExistingOwner
    ? {
        accountKey: args.existingAccountKey,
        tenantDomainKey: args.existingTenantDomainKey,
        preservesExistingOwner: true,
      }
    : {
        accountKey: args.incomingAccountKey,
        tenantDomainKey: args.incomingTenantDomainKey,
        preservesExistingOwner: false,
      };
}

/** Merge a possibly newer global sender receipt into the inbox snapshot used
 * by both the action preflight and the serializable send claim. Domain-level
 * count/spacing always take the maximum. Mailbox warm-up is inherited only by
 * the exact same mailbox, so rotating aliases cannot borrow mature warm-up. */
export function effectiveDurablePacingState(args: {
  now: number;
  fromEmail: string;
  inboxWarmupStartedAt?: number;
  inboxSentToday?: number;
  inboxSentTodayDay?: string;
  inboxLastSentAt?: number;
  durable?: DurablePacingState;
}): {
  warmupStartedAt?: number;
  sentToday: number;
  sentTodayDay: string;
  lastSentAt?: number;
} {
  const today = utcDayKey(args.now);
  const inboxToday = args.inboxSentTodayDay === today
    ? args.inboxSentToday ?? 0
    : 0;
  const durableToday = args.durable?.sentTodayDay === today
    ? args.durable.sentToday
    : 0;
  const sameMailbox = Boolean(
    args.durable &&
      args.durable.mailboxKey === outreachMailboxKey(args.fromEmail),
  );
  const warmupCandidates = [
    args.inboxWarmupStartedAt,
    sameMailbox ? args.durable?.warmupStartedAt : undefined,
  ].filter((value): value is number =>
    Number.isFinite(value) && (value ?? 0) > 0
  );
  const lastSentAt = Math.max(
    args.inboxLastSentAt ?? 0,
    args.durable?.lastSentAt ?? 0,
  );
  return {
    warmupStartedAt: warmupCandidates.length > 0
      ? Math.min(...warmupCandidates)
      : undefined,
    sentToday: Math.max(inboxToday, durableToday),
    sentTodayDay: today,
    lastSentAt: lastSentAt > 0 ? lastSentAt : undefined,
  };
}

/** Monotonic merge used by direct, reviewed, relay-proven and legacy receipt
 * materialization. A late receipt can add to its own current day, but can
 * never rewind a newer UTC day, mailbox lineage, count or last-send time. */
export function mergeDurablePacingState(args: {
  existing?: DurablePacingState;
  mailboxKey: string;
  inboxWarmupStartedAt?: number;
  inboxSentToday: number;
  inboxSentTodayDay: string;
  deliveredAt: number;
  increment: boolean;
}): DurablePacingState {
  const day = utcDayKey(args.deliveredAt);
  const inboxDayCount = args.inboxSentTodayDay === day
    ? args.inboxSentToday
    : 0;
  const existing = args.existing;
  if (!existing) {
    return {
      mailboxKey: args.mailboxKey,
      warmupStartedAt: args.inboxWarmupStartedAt ?? args.deliveredAt,
      sentToday: inboxDayCount + (args.increment ? 1 : 0),
      sentTodayDay: day,
      lastSentAt: args.deliveredAt,
      updatedAt: args.deliveredAt,
    };
  }
  const sameDay = existing.sentTodayDay === day;
  const newerDay = day > existing.sentTodayDay;
  const mayAdvanceMailbox = args.deliveredAt >= existing.updatedAt;
  return {
    mailboxKey: mayAdvanceMailbox ? args.mailboxKey : existing.mailboxKey,
    warmupStartedAt: !mayAdvanceMailbox
      ? existing.warmupStartedAt
      : existing.mailboxKey === args.mailboxKey
        ? Math.min(
            existing.warmupStartedAt,
            args.inboxWarmupStartedAt ?? args.deliveredAt,
          )
        : args.inboxWarmupStartedAt ?? args.deliveredAt,
    sentToday: sameDay
      ? Math.max(existing.sentToday, inboxDayCount) + (args.increment ? 1 : 0)
      : newerDay
        ? inboxDayCount + (args.increment ? 1 : 0)
        : existing.sentToday,
    sentTodayDay: newerDay ? day : existing.sentTodayDay,
    lastSentAt: Math.max(existing.lastSentAt ?? 0, args.deliveredAt),
    updatedAt: Math.max(existing.updatedAt, args.deliveredAt),
  };
}

export async function readDurableContactReceipt(
  ctx: ReadCtx,
  site: Doc<"sites">,
  recipientDomain: string,
) {
  if (!site.userId) return null;
  const identity = outreachContactReceiptIdentity({
    userId: site.userId,
    tenantDomain: site.domain,
    recipientDomain,
  });
  if (!identity) return null;
  return ctx.db
    .query("outreach_tenant_contact_receipts")
    .withIndex("by_account_tenant_recipient", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("recipientDomainKey", identity.recipientDomainKey)
    )
    .first();
}

export async function recordDurableContactReceipt(
  ctx: MutationCtx,
  site: Doc<"sites">,
  recipientDomain: string,
  contactedAt: number,
  expectedAttemptId?: string,
): Promise<void> {
  if (!site.userId || !Number.isFinite(contactedAt) || contactedAt <= 0) return;
  return recordDurableContactReceiptForAccount(
    ctx,
    accountDeletionKey(site.userId),
    recipientDomain,
    contactedAt,
    expectedAttemptId,
  );
}

export async function recordDurableContactReceiptForAccount(
  ctx: MutationCtx,
  accountKey: string,
  recipientDomain: string,
  contactedAt: number,
  expectedAttemptId?: string,
): Promise<void> {
  if (!accountKey || !Number.isFinite(contactedAt) || contactedAt <= 0) return;
  if (await accountDeletionRequestedForKey(ctx, accountKey)) return;
  const identity = outreachContactReceiptIdentityForAccount({
    accountKey,
    recipientDomain,
  });
  if (!identity) return;
  const existing = await ctx.db
    .query("outreach_tenant_contact_receipts")
    .withIndex("by_account_tenant_recipient", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("recipientDomainKey", identity.recipientDomainKey)
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      lastContactedAt: Math.max(existing.lastContactedAt ?? 0, contactedAt),
      ...(expectedAttemptId &&
          existing.reservationAttemptId === expectedAttemptId
        ? {
            reservationAttemptId: undefined,
            reservationExpiresAt: undefined,
          }
        : {}),
      updatedAt: Math.max(existing.updatedAt, contactedAt),
    });
    return;
  }
  await ctx.db.insert("outreach_tenant_contact_receipts", {
    ...identity,
    lastContactedAt: contactedAt,
    createdAt: contactedAt,
    updatedAt: contactedAt,
  });
}

/** Serializable account-wide recipient-domain claim. The indexed read and
 * write make two sites in the same account conflict before either provider
 * boundary can execute. */
export async function reserveDurableContactClaim(
  ctx: MutationCtx,
  site: Doc<"sites">,
  recipientDomain: string,
  attemptId: string,
  now: number,
  leaseExpiresAt: number,
  cooldownMs: number,
): Promise<{ reserved: boolean; lastContactedAt?: number }> {
  if (!site.userId) return { reserved: false };
  const identity = outreachContactReceiptIdentity({
    userId: site.userId,
    tenantDomain: site.domain,
    recipientDomain,
  });
  if (!identity) return { reserved: false };
  if (await accountDeletionRequestedForKey(ctx, identity.accountKey)) {
    return { reserved: false };
  }
  const existing = await ctx.db
    .query("outreach_tenant_contact_receipts")
    .withIndex("by_account_tenant_recipient", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("recipientDomainKey", identity.recipientDomainKey)
    )
    .first();
  if (
    existing &&
    ((existing.lastContactedAt ?? 0) >= now - cooldownMs ||
      (existing.reservationExpiresAt ?? 0) > now)
  ) {
    return { reserved: false, lastContactedAt: existing.lastContactedAt };
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      reservationAttemptId: attemptId,
      reservationExpiresAt: leaseExpiresAt,
      updatedAt: Math.max(existing.updatedAt, now),
    });
  } else {
    await ctx.db.insert("outreach_tenant_contact_receipts", {
      ...identity,
      reservationAttemptId: attemptId,
      reservationExpiresAt: leaseExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { reserved: true };
}

export async function releaseDurableContactClaim(
  ctx: MutationCtx,
  site: Doc<"sites">,
  recipientDomain: string,
  attemptId: string,
  now: number,
): Promise<void> {
  if (!site.userId) return;
  return releaseDurableContactClaimForAccount(
    ctx,
    accountDeletionKey(site.userId),
    recipientDomain,
    attemptId,
    now,
  );
}

export async function releaseDurableContactClaimForAccount(
  ctx: MutationCtx,
  accountKey: string,
  recipientDomain: string,
  attemptId: string,
  now: number,
): Promise<void> {
  if (await accountDeletionRequestedForKey(ctx, accountKey)) return;
  const identity = outreachContactReceiptIdentityForAccount({
    accountKey,
    recipientDomain,
  });
  if (!identity) return;
  const existing = await ctx.db
    .query("outreach_tenant_contact_receipts")
    .withIndex("by_account_tenant_recipient", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("recipientDomainKey", identity.recipientDomainKey)
    )
    .first();
  if (!existing || existing.reservationAttemptId !== attemptId) return;
  await ctx.db.patch(existing._id, {
    reservationAttemptId: undefined,
    reservationExpiresAt: undefined,
    updatedAt: Math.max(existing.updatedAt, now),
  });
}

export async function readDurablePacingReceipt(
  ctx: ReadCtx,
  site: Doc<"sites">,
  senderDomain: string,
) {
  const identity = outreachPacingReceiptIdentity({
    userId: site.userId ?? "",
    tenantDomain: site.domain,
    senderDomain,
  });
  if (!identity) return null;
  return ctx.db
    .query("outreach_sender_pacing_receipts")
    .withIndex("by_sender", (q) =>
      q.eq("senderDomainKey", identity.senderDomainKey)
    )
    .first();
}

export async function adoptDurablePacingReceiptOwner(
  ctx: MutationCtx,
  site: Doc<"sites">,
  senderDomain: string,
): Promise<void> {
  if (!site.userId) return;
  const identity = outreachPacingReceiptIdentity({
    userId: site.userId,
    tenantDomain: site.domain,
    senderDomain,
  });
  if (!identity?.accountKey || !identity.tenantDomainKey) return;
  const existing = await ctx.db
    .query("outreach_sender_pacing_receipts")
    .withIndex("by_sender", (q) =>
      q.eq("senderDomainKey", identity.senderDomainKey)
    )
    .first();
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    accountKey: identity.accountKey,
    tenantDomainKey: identity.tenantDomainKey,
    updatedAt: Math.max(existing.updatedAt, Date.now()),
  });
}

/** Record one accepted send without permitting duplicate settlement to lower
 * or reset aggregate pacing. The caller is responsible for proving that the
 * message has not already been counted. */
export async function recordDurablePacingReceipt(
  ctx: MutationCtx,
  site: Doc<"sites">,
  inbox: Doc<"outreach_inboxes">,
  deliveredAt: number,
  increment = true,
): Promise<void> {
  if (!site.userId || !Number.isFinite(deliveredAt) || deliveredAt <= 0) return;
  return recordDurablePacingReceiptForAccount(
    ctx,
    accountDeletionKey(site.userId),
    inbox,
    deliveredAt,
    increment,
  );
}

export async function recordDurablePacingReceiptForAccount(
  ctx: MutationCtx,
  accountKey: string,
  inbox: Doc<"outreach_inboxes">,
  deliveredAt: number,
  increment = true,
): Promise<void> {
  if (!accountKey || !Number.isFinite(deliveredAt) || deliveredAt <= 0) return;
  if (await accountDeletionRequestedForKey(ctx, accountKey)) {
    await recordUnlinkedDurablePacingReceipt(
      ctx,
      inbox,
      deliveredAt,
      increment,
    );
    return;
  }
  const senderDomainKey = outreachSenderDomainKey(
    inbox.senderDomain ?? inbox.fromEmail.split("@")[1] ?? "",
  );
  const identity = senderDomainKey
    ? {
        accountKey,
        tenantDomainKey: OUTREACH_ACCOUNT_TENANT_SCOPE_KEY,
        senderDomainKey,
      }
    : null;
  const mailboxKey = outreachMailboxKey(inbox.fromEmail);
  if (!identity || !mailboxKey) return;
  const existing = await ctx.db
    .query("outreach_sender_pacing_receipts")
    .withIndex("by_sender", (q) =>
      q.eq("senderDomainKey", identity.senderDomainKey)
    )
    .first();
  const merged = mergeDurablePacingState({
    existing: existing ?? undefined,
    mailboxKey,
    inboxWarmupStartedAt: inbox.warmupStartedAt,
    inboxSentToday: inbox.sentToday ?? 0,
    inboxSentTodayDay: inbox.sentTodayDay ?? "",
    deliveredAt,
    increment,
  });
  if (existing) {
    // Migration and deletion may discover old sends after another account has
    // legitimately adopted this globally unique sender. Historical evidence
    // may only raise monotonic pacing; ownership/mailbox lineage can move only
    // through the explicit OAuth connect/adoption protocol.
    const ownership = durablePacingReceiptOwnership({
      existingAccountKey: existing.accountKey,
      existingTenantDomainKey: existing.tenantDomainKey,
      incomingAccountKey: identity.accountKey!,
      incomingTenantDomainKey: identity.tenantDomainKey!,
    });
    await ctx.db.patch(existing._id, {
      accountKey: ownership.accountKey,
      tenantDomainKey: ownership.tenantDomainKey,
      ...merged,
      ...(ownership.preservesExistingOwner
        ? {
            mailboxKey: existing.mailboxKey,
            warmupStartedAt: existing.warmupStartedAt,
          }
        : {}),
      retainUntil: Math.max(
        existing.retainUntil ?? 0,
        deliveredAt + OUTREACH_SENDER_REPUTATION_RETENTION_MS,
      ),
      updatedAt: Math.max(existing.updatedAt, deliveredAt),
    });
    return;
  }
  await ctx.db.insert("outreach_sender_pacing_receipts", {
    ...identity,
    ...merged,
    retainUntil: deliveredAt + OUTREACH_SENDER_REPUTATION_RETENTION_MS,
    createdAt: deliveredAt,
  });
}

/**
 * Preserve only the globally hashed sender-reputation fence while a verified
 * full-account deletion scrubs an additive-rollout inbox whose historical
 * account owner cannot be proven. The row deliberately has no account or
 * tenant linkage. Historical deletion may raise domain count/spacing, but it
 * can never adopt, relink, or replace an existing mailbox owner/lineage.
 */
export async function recordUnlinkedDurablePacingReceipt(
  ctx: MutationCtx,
  inbox: Doc<"outreach_inboxes">,
  deliveredAt: number,
  increment = false,
): Promise<void> {
  if (!Number.isFinite(deliveredAt) || deliveredAt <= 0) return;
  const senderDomainKey = outreachSenderDomainKey(
    inbox.senderDomain ?? inbox.fromEmail.split("@")[1] ?? "",
  );
  const mailboxKey = outreachMailboxKey(inbox.fromEmail);
  if (!senderDomainKey || !mailboxKey) return;
  const existing = await ctx.db
    .query("outreach_sender_pacing_receipts")
    .withIndex("by_sender", (q) => q.eq("senderDomainKey", senderDomainKey))
    .first();
  const merged = mergeDurablePacingState({
    existing: existing ?? undefined,
    mailboxKey,
    inboxWarmupStartedAt: inbox.warmupStartedAt,
    inboxSentToday: inbox.sentToday ?? 0,
    inboxSentTodayDay: inbox.sentTodayDay ?? "",
    deliveredAt,
    increment,
  });
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...merged,
      // Deletion-time discovery is not an ownership-transfer protocol.
      accountKey: existing.accountKey,
      tenantDomainKey: existing.tenantDomainKey,
      mailboxKey: existing.mailboxKey,
      warmupStartedAt: existing.warmupStartedAt,
      retainUntil: Math.max(
        existing.retainUntil ?? 0,
        deliveredAt + OUTREACH_SENDER_REPUTATION_RETENTION_MS,
      ),
      updatedAt: Math.max(existing.updatedAt, deliveredAt),
    });
    return;
  }
  await ctx.db.insert("outreach_sender_pacing_receipts", {
    senderDomainKey,
    ...merged,
    retainUntil: deliveredAt + OUTREACH_SENDER_REPUTATION_RETENTION_MS,
    createdAt: deliveredAt,
  });
}
