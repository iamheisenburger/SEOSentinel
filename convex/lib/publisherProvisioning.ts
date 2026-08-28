import type { Doc } from "../_generated/dataModel";
import { accountDeletionKey } from "./accountDeletion.ts";
import {
  publicationAdapterConfigHash,
  publicationDeliveryConfig,
  requireSafeGitHubDefaultBranch,
  safeGitHubRepositoryPart,
  sha256Hex,
} from "./publicationArtifact.ts";
import { PUBLICATION_ADAPTER_VERSION } from "./publicationReceipts.ts";
import { normalizedOneSetupDomain } from "./oneSetup.ts";

export const PUBLISHER_DESTINATION_RECEIPT_VERSION = 1;
export const PUBLISHER_DESTINATION_RECEIPT_FRESH_MS = 72 * 60 * 60 * 1000;
export const PUBLISHER_AUTOPUBLISH_CONSENT_VERSION = 1;
export const PUBLISHER_AUTOPUBLISH_CONSENT_TEXT =
  "I authorize Pentra to publish quality-gated articles to my verified publishing destination without asking for approval on each article. I can switch to assisted review or disconnect publishing at any time.";
export const PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH = sha256Hex(
  `pentra:publisher-autopublish-consent:v${PUBLISHER_AUTOPUBLISH_CONSENT_VERSION}:${PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}`,
);

export type SupportedPublisherMethod = "github" | "wordpress" | "webhook";

export type PublisherDestinationReceipt = {
  version: number;
  status: "verified" | "revoked";
  method: SupportedPublisherMethod;
  destinationId: string;
  ownerAccountKey: string;
  canonicalDomain: string;
  domainRevision: number;
  configHash: string;
  connectionGeneration: number;
  adapterVersion: string;
  verifiedAt: number;
  revokedAt?: number;
};

export function publisherDestinationReceiptExactlyMatches(
  actual: PublisherDestinationReceipt,
  expected: PublisherDestinationReceipt,
): boolean {
  return actual.version === expected.version &&
    actual.status === expected.status &&
    actual.method === expected.method &&
    actual.destinationId === expected.destinationId &&
    actual.ownerAccountKey === expected.ownerAccountKey &&
    actual.canonicalDomain === expected.canonicalDomain &&
    actual.domainRevision === expected.domainRevision &&
    actual.configHash === expected.configHash &&
    actual.connectionGeneration === expected.connectionGeneration &&
    actual.adapterVersion === expected.adapterVersion &&
    actual.verifiedAt === expected.verifiedAt &&
    actual.revokedAt === expected.revokedAt;
}

export type PublisherAutopublishConsent = {
  version: number;
  policyHash: string;
  acceptedAt: number;
  ownerAccountKey: string;
  canonicalDomain: string;
  domainRevision: number;
};

type PublisherSite = Pick<
  Doc<"sites">,
  | "userId"
  | "domain"
  | "canonicalDomain"
  | "canonicalDomainRevision"
  | "publishMethod"
  | "repoOwner"
  | "repoName"
  | "repoDefaultBranch"
  | "githubToken"
  | "wpUrl"
  | "wpUsername"
  | "wpAppPassword"
  | "webhookUrl"
  | "webhookSecret"
  | "urlStructure"
  | "publisherConnectionGeneration"
  | "publisherDestinationReceipt"
>;

type PublisherRequest = Pick<
  Doc<"managed_provisioning_requests">,
  | "automationMode"
  | "ownerAccountKey"
  | "domainSnapshot"
  | "domainRevisionSnapshot"
  | "publisherAutopublishConsent"
>;

function normalizedEndpoint(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null;
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function supportedPublisherMethod(
  value: string | undefined,
): SupportedPublisherMethod | null {
  return value === "github" || value === "wordpress" || value === "webhook"
    ? value
    : null;
}

export function publisherConnectionComplete(site: PublisherSite): boolean {
  const method = supportedPublisherMethod(site.publishMethod ?? "github");
  if (method === "github") {
    try {
      return Boolean(
        safeGitHubRepositoryPart(site.repoOwner, "owner") &&
          safeGitHubRepositoryPart(site.repoName, "repository name") &&
          requireSafeGitHubDefaultBranch(site.repoDefaultBranch) &&
          site.githubToken?.trim(),
      );
    } catch {
      return false;
    }
  }
  if (method === "wordpress") {
    return Boolean(
      normalizedEndpoint(site.wpUrl) &&
        site.wpUsername?.trim() &&
        site.wpAppPassword?.trim(),
    );
  }
  if (method === "webhook") {
    return Boolean(
      normalizedEndpoint(site.webhookUrl) && site.webhookSecret?.trim(),
    );
  }
  return false;
}

export function publisherDestinationId(
  site: PublisherSite,
): string | undefined {
  const method = supportedPublisherMethod(site.publishMethod ?? "github");
  if (method === "github") {
    try {
      const owner = safeGitHubRepositoryPart(site.repoOwner, "owner");
      const repository = safeGitHubRepositoryPart(
        site.repoName,
        "repository name",
      );
      const branch = requireSafeGitHubDefaultBranch(site.repoDefaultBranch);
      return owner && repository
        ? `github:${owner.toLowerCase()}/${repository.toLowerCase()}@${branch}`
        : undefined;
    } catch {
      return undefined;
    }
  }
  const endpoint = method === "wordpress"
    ? normalizedEndpoint(site.wpUrl)
    : method === "webhook"
      ? normalizedEndpoint(site.webhookUrl)
      : null;
  return method && endpoint ? `${method}:${endpoint}` : undefined;
}

/**
 * This seal includes credentials only through a one-way digest. The stored
 * hash is itself server-only because a stable credential fingerprint should
 * never be exposed through a tenant projection.
 */
export function publisherDestinationConfigHash(
  site: PublisherSite,
): string | undefined {
  const method = supportedPublisherMethod(site.publishMethod ?? "github");
  const canonicalDomain = site.canonicalDomain ??
    normalizedOneSetupDomain(site.domain);
  const domainRevision = site.canonicalDomainRevision ?? 0;
  const connectionGeneration = site.publisherConnectionGeneration ?? 0;
  const destinationId = publisherDestinationId(site);
  if (
    !method ||
    !canonicalDomain ||
    !destinationId ||
    !Number.isSafeInteger(domainRevision) ||
    domainRevision < 0 ||
    !Number.isSafeInteger(connectionGeneration) ||
    connectionGeneration < 0
  ) return undefined;

  let urlStructure: string;
  try {
    urlStructure = publicationDeliveryConfig({
      domain: canonicalDomain,
      publishMethod: method,
      urlStructure: site.urlStructure,
      repoOwner: site.repoOwner,
      repoName: site.repoName,
      repoDefaultBranch: site.repoDefaultBranch,
      wpUrl: site.wpUrl,
      webhookUrl: site.webhookUrl,
    }).urlStructure;
  } catch {
    return undefined;
  }

  let credentialHash: string | undefined;
  let adapterConfigHash: string | undefined;
  if (method === "github") {
    const credential = site.githubToken?.trim();
    if (!credential) return undefined;
    credentialHash = sha256Hex(credential);
  } else {
    adapterConfigHash = publicationAdapterConfigHash(site);
    if (!adapterConfigHash) return undefined;
  }
  return sha256Hex(JSON.stringify({
    receiptVersion: PUBLISHER_DESTINATION_RECEIPT_VERSION,
    adapterVersion: PUBLICATION_ADAPTER_VERSION,
    method,
    destinationId,
    canonicalDomain,
    domainRevision,
    connectionGeneration,
    urlStructure,
    credentialHash,
    adapterConfigHash,
  }));
}

export function expectedPublisherDestinationReceipt(args: {
  site: PublisherSite;
  ownerAccountKey: string;
  verifiedAt: number;
}): PublisherDestinationReceipt | null {
  const method = supportedPublisherMethod(args.site.publishMethod ?? "github");
  const destinationId = publisherDestinationId(args.site);
  const configHash = publisherDestinationConfigHash(args.site);
  const canonicalDomain = args.site.canonicalDomain ??
    normalizedOneSetupDomain(args.site.domain);
  if (
    !method ||
    !destinationId ||
    !configHash ||
    !canonicalDomain ||
    !publisherConnectionComplete(args.site)
  ) return null;
  return {
    version: PUBLISHER_DESTINATION_RECEIPT_VERSION,
    status: "verified",
    method,
    destinationId,
    ownerAccountKey: args.ownerAccountKey,
    canonicalDomain,
    domainRevision: args.site.canonicalDomainRevision ?? 0,
    configHash,
    connectionGeneration: args.site.publisherConnectionGeneration ?? 0,
    adapterVersion: PUBLICATION_ADAPTER_VERSION,
    verifiedAt: args.verifiedAt,
  };
}

export function publisherDestinationReceiptVerified(args: {
  site: PublisherSite;
  ownerAccountKey?: string;
  timestamp?: number;
}): boolean {
  const timestamp = args.timestamp ?? Date.now();
  const ownerAccountKey = args.ownerAccountKey ??
    (args.site.userId ? accountDeletionKey(args.site.userId) : undefined);
  if (!ownerAccountKey) return false;
  const expected = expectedPublisherDestinationReceipt({
    site: args.site,
    ownerAccountKey,
    verifiedAt: 1,
  });
  const receipt = args.site.publisherDestinationReceipt;
  const verifiedAt = receipt?.verifiedAt ?? 0;
  return Boolean(
    expected &&
      receipt &&
      receipt.version === expected.version &&
      receipt.status === "verified" &&
      receipt.method === expected.method &&
      receipt.destinationId === expected.destinationId &&
      receipt.ownerAccountKey === expected.ownerAccountKey &&
      receipt.canonicalDomain === expected.canonicalDomain &&
      receipt.domainRevision === expected.domainRevision &&
      receipt.configHash === expected.configHash &&
      receipt.connectionGeneration === expected.connectionGeneration &&
      receipt.adapterVersion === expected.adapterVersion &&
      Number.isFinite(verifiedAt) &&
      verifiedAt > 0 &&
      verifiedAt <= timestamp + 5 * 60 * 1000 &&
      timestamp - verifiedAt <= PUBLISHER_DESTINATION_RECEIPT_FRESH_MS &&
      verifiedAt > (receipt.revokedAt ?? 0),
  );
}

export function publisherAutopublishConsentReceipt(args: {
  ownerAccountKey: string;
  canonicalDomain: string;
  domainRevision: number;
  acceptedAt: number;
}): PublisherAutopublishConsent {
  return {
    version: PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
    policyHash: PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH,
    acceptedAt: args.acceptedAt,
    ownerAccountKey: args.ownerAccountKey,
    canonicalDomain: args.canonicalDomain,
    domainRevision: args.domainRevision,
  };
}

export function publisherAutopublishConsentCurrent(args: {
  request: PublisherRequest;
  timestamp?: number;
}): boolean {
  if (args.request.automationMode !== "full") return true;
  return publisherStandingAutopublishConsentCurrent(args);
}

/** Validate the standing receipt even when the stored setup mode says
 * assisted. Runtime callers use this to prevent a later site-setting edit from
 * silently turning assisted review into unattended publication. */
export function publisherStandingAutopublishConsentCurrent(args: {
  request: PublisherRequest;
  timestamp?: number;
}): boolean {
  const receipt = args.request.publisherAutopublishConsent;
  const acceptedAt = receipt?.acceptedAt ?? 0;
  const timestamp = args.timestamp ?? Date.now();
  return Boolean(
    receipt &&
      receipt.version === PUBLISHER_AUTOPUBLISH_CONSENT_VERSION &&
      receipt.policyHash === PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH &&
      receipt.ownerAccountKey === args.request.ownerAccountKey &&
      receipt.canonicalDomain === args.request.domainSnapshot &&
      receipt.domainRevision === (args.request.domainRevisionSnapshot ?? 0) &&
      Number.isFinite(acceptedAt) &&
      acceptedAt > 0 &&
      acceptedAt <= timestamp + 5 * 60 * 1000,
  );
}
