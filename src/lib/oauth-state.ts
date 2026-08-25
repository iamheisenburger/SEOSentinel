import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type OAuthProvider = "github" | "gsc" | "gmail_outreach";

const STATE_VERSION = 1;
const STATE_TTL_MS = 10 * 60 * 1000;

type OAuthStatePayload = {
  v: number;
  provider: OAuthProvider;
  siteId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
  expectedCanonicalDomain?: string;
  expectedDomainRevision?: number;
  expectedGscConnectionRevision?: number;
};

function stateSecret(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET?.trim() ||
    process.env.PENTRA_INTERNAL_SECRET?.trim();
  if (!secret) throw new Error("OAuth state signing secret is not configured");
  return secret;
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", stateSecret())
    .update(`pentra-oauth-state:${encodedPayload}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function createOAuthState(args: {
  provider: OAuthProvider;
  siteId: string;
  userId: string;
  now?: number;
  nonce?: string;
  expectedCanonicalDomain?: string;
  expectedDomainRevision?: number;
  expectedGscConnectionRevision?: number;
}): string {
  if (
    (args.expectedCanonicalDomain === undefined) !==
      (args.expectedDomainRevision === undefined) ||
    (args.expectedCanonicalDomain === undefined) !==
      (args.expectedGscConnectionRevision === undefined) ||
    (args.expectedCanonicalDomain !== undefined && args.provider !== "gsc")
  ) {
    throw new Error("Canonical-domain OAuth state is valid only for GSC");
  }
  const now = args.now ?? Date.now();
  const payload: OAuthStatePayload = {
    v: STATE_VERSION,
    provider: args.provider,
    siteId: args.siteId,
    userId: args.userId,
    nonce: args.nonce ?? randomUUID(),
    expiresAt: now + STATE_TTL_MS,
    ...(args.expectedCanonicalDomain !== undefined
      ? { expectedCanonicalDomain: args.expectedCanonicalDomain }
      : {}),
    ...(args.expectedDomainRevision !== undefined
      ? { expectedDomainRevision: args.expectedDomainRevision }
      : {}),
    ...(args.expectedGscConnectionRevision !== undefined
      ? {
        expectedGscConnectionRevision:
          args.expectedGscConnectionRevision,
      }
      : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyOAuthState(
  state: string,
  args: {
    provider: OAuthProvider;
    userId: string;
    now?: number;
  },
): {
  siteId: string;
  expectedCanonicalDomain?: string;
  expectedDomainRevision?: number;
  expectedGscConnectionRevision?: number;
} | null {
  if (!state || state.length > 2_048) return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEqual(parts[1], signature(parts[0]))) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const now = args.now ?? Date.now();
  if (
    payload.v !== STATE_VERSION ||
    payload.provider !== args.provider ||
    payload.userId !== args.userId ||
    typeof payload.siteId !== "string" ||
    payload.siteId.length < 1 ||
    payload.siteId.length > 200 ||
    typeof payload.nonce !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.nonce) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= now ||
    payload.expiresAt > now + STATE_TTL_MS
  ) {
    return null;
  }
  const hasExpectedDomain = payload.expectedCanonicalDomain !== undefined;
  const hasExpectedRevision = payload.expectedDomainRevision !== undefined;
  const hasExpectedConnectionRevision =
    payload.expectedGscConnectionRevision !== undefined;
  if (
    hasExpectedDomain !== hasExpectedRevision ||
    hasExpectedDomain !== hasExpectedConnectionRevision ||
    (hasExpectedDomain && payload.provider !== "gsc") ||
    (hasExpectedDomain &&
      (
        typeof payload.expectedCanonicalDomain !== "string" ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i.test(
          payload.expectedCanonicalDomain,
        ) ||
        !Number.isSafeInteger(payload.expectedDomainRevision) ||
        payload.expectedDomainRevision! < 0 ||
        !Number.isSafeInteger(payload.expectedGscConnectionRevision) ||
        payload.expectedGscConnectionRevision! < 0
      ))
  ) {
    return null;
  }
  return {
    siteId: payload.siteId,
    ...(hasExpectedDomain
      ? {
          expectedCanonicalDomain: payload.expectedCanonicalDomain,
          expectedDomainRevision: payload.expectedDomainRevision,
          expectedGscConnectionRevision:
            payload.expectedGscConnectionRevision,
        }
      : {}),
  };
}
