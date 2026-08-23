import { sha256Hex } from "./publicationArtifact.ts";

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
