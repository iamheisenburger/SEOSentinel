import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { outreachMailboxKey } from "./outreachDurability";
import { normalizeDomain, utcDayKey } from "./outreachPacing";
import { sha256Hex } from "./publicationArtifact";
import {
  MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
  MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
  MANAGED_SES_MAILBOX_DAILY_ATTEMPT_CAP,
  MANAGED_SES_MAILBOX_MIN_ATTEMPT_INTERVAL_MS,
  MANAGED_SES_PLATFORM_SENDER_DOMAIN,
  MANAGED_SES_TRANSPORT,
  managedSesCombinedPacingDecision,
  managedSesGlobalPacingDecision,
  managedSesScopedPacingDecision,
} from "./managedSes";

export async function reserveManagedSesPacingAttempt(
  ctx: MutationCtx,
  args: {
    inbox: Doc<"outreach_inboxes">;
    accountKey: string;
    now: number;
  },
): Promise<{ reserved: boolean; reason?: string; nextEligibleAt?: number }> {
  const senderDomain = normalizeDomain(args.inbox.senderDomain ?? "");
  const resourceOperationKey = args.inbox.managedTransportOperationKey ?? "";
  const mailboxKey = outreachMailboxKey(args.inbox.fromEmail);
  if (
    args.inbox.provider !== MANAGED_SES_TRANSPORT ||
    senderDomain !== MANAGED_SES_PLATFORM_SENDER_DOMAIN ||
    !/^[a-f0-9]{64}$/.test(resourceOperationKey) ||
    !mailboxKey
  ) return { reserved: false, reason: "managed_sender_binding_invalid" };
  const senderDomainKey = sha256Hex(`managed-ses-domain:v1:${senderDomain}`);
  const globalScopeKey = sha256Hex(
    `managed-ses-pacing:v1:global:${senderDomainKey}`,
  );
  const accountScopeKey = sha256Hex(
    `managed-ses-pacing:v1:account:${args.accountKey}`,
  );
  const mailboxScopeKey = sha256Hex(
    `managed-ses-pacing:v1:mailbox:${args.accountKey}:${mailboxKey}:${resourceOperationKey}`,
  );
  const [global, account, mailbox] = await Promise.all([
    ctx.db.query("managed_ses_pacing_receipts")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", globalScopeKey))
      .unique(),
    ctx.db.query("managed_ses_pacing_receipts")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", accountScopeKey))
      .unique(),
    ctx.db.query("managed_ses_pacing_receipts")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", mailboxScopeKey))
      .unique(),
  ]);
  const decisions = [
    managedSesGlobalPacingDecision({
      attemptedToday: global?.attemptedToday,
      attemptedTodayDay: global?.attemptedTodayDay,
      lastAttemptAt: global?.lastAttemptAt,
      now: args.now,
    }),
    managedSesScopedPacingDecision({
      attemptedToday: account?.attemptedToday,
      attemptedTodayDay: account?.attemptedTodayDay,
      lastAttemptAt: account?.lastAttemptAt,
      now: args.now,
      dailyCap: MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
      minimumIntervalMs: MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
      scope: "account",
    }),
    managedSesScopedPacingDecision({
      attemptedToday: mailbox?.attemptedToday,
      attemptedTodayDay: mailbox?.attemptedTodayDay,
      lastAttemptAt: mailbox?.lastAttemptAt,
      now: args.now,
      dailyCap: MANAGED_SES_MAILBOX_DAILY_ATTEMPT_CAP,
      minimumIntervalMs: MANAGED_SES_MAILBOX_MIN_ATTEMPT_INTERVAL_MS,
      scope: "mailbox",
    }),
  ];
  const combined = managedSesCombinedPacingDecision(decisions);
  if (!combined.allowed) {
    return {
      reserved: false,
      reason: combined.reason,
      nextEligibleAt: combined.nextEligibleAt,
    };
  }
  const day = utcDayKey(args.now);
  const retainUntil = args.now + 90 * 24 * 60 * 60 * 1000;
  const upsert = async (
    existing: Doc<"managed_ses_pacing_receipts"> | null,
    record: {
      scopeKey: string;
      scope: "global_domain" | "tenant_account" | "tenant_mailbox";
      accountKey?: string;
      mailboxKey?: string;
      resourceOperationKeyDigest?: string;
    },
  ) => {
    const attemptedToday = existing?.attemptedTodayDay === day
      ? existing.attemptedToday + 1
      : 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        attemptedToday,
        attemptedTodayDay: day,
        lastAttemptAt: args.now,
        retainUntil: Math.max(existing.retainUntil, retainUntil),
        updatedAt: args.now,
      });
    } else {
      await ctx.db.insert("managed_ses_pacing_receipts", {
        ...record,
        senderDomainKey,
        attemptedToday,
        attemptedTodayDay: day,
        lastAttemptAt: args.now,
        retainUntil,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
  };
  await upsert(global, { scopeKey: globalScopeKey, scope: "global_domain" });
  await upsert(account, {
    scopeKey: accountScopeKey,
    scope: "tenant_account",
    accountKey: args.accountKey,
  });
  await upsert(mailbox, {
    scopeKey: mailboxScopeKey,
    scope: "tenant_mailbox",
    accountKey: args.accountKey,
    mailboxKey,
    resourceOperationKeyDigest: sha256Hex(resourceOperationKey),
  });
  return { reserved: true };
}
