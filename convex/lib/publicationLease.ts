export const PUBLICATION_LEASE_MS = 15 * 60 * 1000;
export const MAX_PUBLICATION_ATTEMPTS = 3;

/** A destination that is down or rate limiting before any write keeps being
 * retried for about a day (30 min, 1 h, 2 h, then every 4 h) instead of
 * failing the slot after fifteen minutes. Every retry re-reads the destination
 * before writing, as the first attempts do. */
export const MAX_TRANSIENT_PUBLICATION_ATTEMPTS = 10;

/** The destination was unreachable (HTTP 429/5xx) while Pentra was only
 * reading it, before any write was attempted. A failed write keeps the
 * three-attempt limit: each of those is a real write attempt. */
const READ_PHASE_PUBLICATION_FAILURE = /GitHub repo unavailable|Failed to read sealed GitHub branch|Failed to verify the existing GitHub destination|Failed to confirm the current sealed GitHub branch|WordPress connection check failed|WordPress idempotency lookup failed/i;
export function transientPublicationError(error: string) {
  return READ_PHASE_PUBLICATION_FAILURE.test(error) && /\(HTTP (?:429|5\d\d)\)|\((?:429|5\d\d)\)/.test(error);
}

export function nextPublicationRetry(previousAttempts: number, transient = false): {
  attempts: number;
  willRetry: boolean;
  retryDelayMs: number;
} {
  const attempts = Math.max(0, previousAttempts) + 1;
  if (!transient || attempts < MAX_PUBLICATION_ATTEMPTS) {
    return {
      attempts,
      willRetry: attempts < MAX_PUBLICATION_ATTEMPTS || (transient && attempts < MAX_TRANSIENT_PUBLICATION_ATTEMPTS),
      retryDelayMs: attempts * 5 * 60 * 1000,
    };
  }
  return {
    attempts,
    willRetry: attempts < MAX_TRANSIENT_PUBLICATION_ATTEMPTS,
    retryDelayMs: Math.min(4 * 3_600_000, 30 * 60_000 * 2 ** (attempts - MAX_PUBLICATION_ATTEMPTS)),
  };
}

export type PublicationLeaseState = {
  status: string;
  auditedContentHash?: string;
  publishedContentHash?: string;
  publicationLeaseHash?: string;
  publicationLeaseOwner?: string;
  publicationLeaseStartedAt?: number;
};

export function acquirePublicationLease(
  state: PublicationLeaseState,
  args: { expectedContentHash: string; leaseOwner: string; now: number },
): { alreadyPublished: boolean; patch?: {
  publicationLeaseHash: string;
  publicationLeaseOwner: string;
  publicationLeaseStartedAt: number;
} } {
  if (state.status === "published") {
    if (state.publishedContentHash === args.expectedContentHash) {
      return { alreadyPublished: true };
    }
    throw new Error("Article is already published with a different artifact hash");
  }
  if (state.auditedContentHash !== args.expectedContentHash) {
    throw new Error("Publication artifact no longer matches its completed audit");
  }
  const leaseIsActive =
    !!state.publicationLeaseHash &&
    !!state.publicationLeaseStartedAt &&
    args.now - state.publicationLeaseStartedAt < PUBLICATION_LEASE_MS;
  if (leaseIsActive) {
    throw new Error("Publication is already in progress for this article");
  }
  return {
    alreadyPublished: false,
    patch: {
      publicationLeaseHash: args.expectedContentHash,
      publicationLeaseOwner: args.leaseOwner,
      publicationLeaseStartedAt: args.now,
    },
  };
}

export function ownsPublicationLease(
  state: PublicationLeaseState,
  args: { expectedContentHash: string; leaseOwner: string },
): boolean {
  return (
    state.publicationLeaseHash === args.expectedContentHash &&
    state.publicationLeaseOwner === args.leaseOwner
  );
}

/** Pure concurrency contract for an explicit reviewed disposition. A stale
 * attempt timestamp is never enough while a newer recovery owns the workflow:
 * both the exact workflow lease and site lease must be expired, or neither
 * lease may exist. */
export function reviewedAmbiguityDispositionAllowed(args: {
  attemptedAt?: number;
  receiptPresent: boolean;
  dispositionAt?: number;
  workflowLeaseOwner?: string;
  workflowLeaseStartedAt?: number;
  siteLeaseOwner?: string;
  siteLeaseExpiresAt?: number;
  now: number;
  leaseMs: number;
}): boolean {
  if (
    !args.attemptedAt ||
    args.receiptPresent ||
    args.dispositionAt ||
    args.attemptedAt + args.leaseMs > args.now
  ) {
    return false;
  }
  if (!args.workflowLeaseOwner) {
    return !args.siteLeaseOwner;
  }
  return Boolean(
    args.siteLeaseOwner === args.workflowLeaseOwner &&
    args.workflowLeaseStartedAt &&
    args.workflowLeaseStartedAt + args.leaseMs <= args.now &&
    args.siteLeaseExpiresAt !== undefined &&
    args.siteLeaseExpiresAt <= args.now,
  );
}
