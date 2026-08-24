import { sha256Hex } from "./publicationArtifact.ts";
import { outreachTenantScope } from "./outreachDurability.ts";
import { outreachOrganisationDomain } from "./outreachContacts.ts";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type OutreachSuppressionKind = "domain" | "email";

function normalizeSuppressionValue(
  kind: OutreachSuppressionKind,
  value: string,
): string {
  return kind === "domain"
    ? outreachOrganisationDomain(value)
    : String(value || "").trim().toLowerCase();
}

/**
 * PII-minimized identity for an account-wide tenant suppression.
 *
 * Deliberately excludes siteId, so an exact STOP survives deletion and
 * recreation of a site inside the same account. The hashes cannot be used by
 * another account and the row stores no recipient address. The conservative
 * account scope means neither a site/domain edit nor another owner-controlled
 * brand can be used to evade a prior STOP.
 */
export function outreachSuppressionScope(args: {
  userId: string;
  tenantDomain: string;
}): {
  accountKey: string;
  tenantDomainKey: string;
} | null {
  return outreachTenantScope(args);
}

export function outreachSuppressionValueKey(
  kind: OutreachSuppressionKind,
  rawValue: string,
): string {
  const value = normalizeSuppressionValue(kind, rawValue);
  return value
    ? sha256Hex(`pentra-outreach-suppression:v1:${kind}:${value}`)
    : "";
}

export function outreachSuppressionTombstoneIdentity(args: {
  userId: string;
  tenantDomain: string;
  kind: OutreachSuppressionKind;
  value: string;
}): {
  accountKey: string;
  tenantDomainKey: string;
  valueKey: string;
} | null {
  const scope = outreachSuppressionScope(args);
  const valueKey = outreachSuppressionValueKey(args.kind, args.value);
  return scope && valueKey ? { ...scope, valueKey } : null;
}

export function outreachSuppressionTombstoneMatches(args: {
  storedAccountKey: string;
  storedTenantDomainKey: string;
  storedKind: string;
  storedValueKey: string;
  userId: string;
  tenantDomain: string;
  kind: OutreachSuppressionKind;
  value: string;
}): boolean {
  const identity = outreachSuppressionTombstoneIdentity(args);
  return Boolean(
    identity &&
      args.storedKind === args.kind &&
      args.storedAccountKey === identity.accountKey &&
      args.storedTenantDomainKey === identity.tenantDomainKey &&
      args.storedValueKey === identity.valueKey,
  );
}

export async function materializeOutreachSuppressionTombstone(
  ctx: MutationCtx,
  site: Doc<"sites">,
  kind: OutreachSuppressionKind,
  value: string,
  reason: string,
  createdAt: number,
): Promise<void> {
  if (!site.userId) return;
  const identity = outreachSuppressionTombstoneIdentity({
    userId: site.userId,
    tenantDomain: site.domain,
    kind,
    value,
  });
  if (!identity) return;
  const existing = await ctx.db
    .query("outreach_sender_suppression_tombstones")
    .withIndex("by_account_tenant_value", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("kind", kind)
        .eq("valueKey", identity.valueKey)
    )
    .first();
  if (existing) return;
  const durableReason = [
    "unsubscribe",
    "bounce",
    "complaint",
    "manual",
  ].includes(reason)
    ? reason
    : "manual";
  await ctx.db.insert("outreach_sender_suppression_tombstones", {
    ...identity,
    kind,
    reason: durableReason,
    createdAt,
  });
}
