import { sha256Hex } from "./publicationArtifact.ts";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Stable, non-reversible account key used by deletion tombstones. Keeping the
 * derivation in one module ensures every execution boundary consults the same
 * permanent lifecycle fence without retaining the provider's raw user ID.
 */
export function accountDeletionKey(userId: string): string {
  return sha256Hex(`pentra-account-deletion:v1:${userId}`);
}

export function accountDeletionTombstoneUserId(accountKey: string): string {
  return `deleted_${accountKey}`;
}

/** Permanent account lifecycle fence addressed only by the one-way key. */
export async function accountDeletionRequestedForKey(
  ctx: QueryCtx | MutationCtx,
  accountKey: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(accountKey)) return true;
  const receipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) => q.eq("accountKey", accountKey))
    .unique();
  return Boolean(receipt);
}
