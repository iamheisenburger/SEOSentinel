import type { Doc } from "../_generated/dataModel";
import { publicationDestinationBlockers } from "./autopilotReadiness.ts";
import { autonomousGmailCredentialIssues } from "./outreachDelivery.ts";
import { normalizedOneSetupDomain } from "./oneSetup.ts";

export const GSC_CANONICAL_RECEIPT_FRESH_MS = 72 * 60 * 60 * 1000;

type DomainBoundGscSite = Doc<"sites"> & {
  // These fields are owned by the canonical-domain transition contract. They
  // remain optional here so this additive receipt patch cherry-picks cleanly;
  // revision-zero legacy rows are accepted only when the property itself is an
  // exact whole-site match for the current canonical domain.
  canonicalDomainRevision?: number;
  gscCanonicalDomain?: string;
  gscDomainRevision?: number;
};

function gscPropertyDomain(property: string): string | null {
  const value = property.trim();
  if (/^sc-domain:/i.test(value)) {
    return normalizedOneSetupDomain(value.replace(/^sc-domain:/i, ""));
  }
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) return null;
    return normalizedOneSetupDomain(url.hostname);
  } catch {
    return null;
  }
}

export function canonicalGscBindingCurrent(site: DomainBoundGscSite): boolean {
  const currentDomain = site.canonicalDomain ??
    normalizedOneSetupDomain(site.domain);
  if (!currentDomain || !site.gscProperty) return false;
  if (gscPropertyDomain(site.gscProperty) !== currentDomain) return false;
  const currentRevision = site.canonicalDomainRevision ?? 0;
  if (
    currentRevision === 0 &&
    site.gscDomainRevision === undefined &&
    site.gscCanonicalDomain === undefined
  ) return true;
  return site.gscDomainRevision === currentRevision &&
    site.gscCanonicalDomain === currentDomain;
}

export function canonicalGscReceiptMutationFenceCurrent(args: {
  site: DomainBoundGscSite;
  expectedCanonicalDomain: string;
  expectedDomainRevision: number;
  expectedGscProperty: string;
  expectedReceiptRevision: number;
}): boolean {
  const currentDomain = args.site.canonicalDomain ??
    normalizedOneSetupDomain(args.site.domain);
  return currentDomain === args.expectedCanonicalDomain &&
    (args.site.canonicalDomainRevision ?? 0) === args.expectedDomainRevision &&
    args.site.gscProperty === args.expectedGscProperty &&
    (args.site.gscReceiptRevision ?? 0) === args.expectedReceiptRevision &&
    canonicalGscBindingCurrent(args.site);
}

export function hardGscOAuthFailure(args: {
  status: number;
  errorCode: string;
}): boolean {
  return args.status === 401 || args.status === 403 ||
    (args.status === 400 &&
      ["invalid_grant", "invalid_client", "unauthorized_client"]
        .includes(args.errorCode));
}

export function oneSetupPublisherReceiptVerified(
  site: Doc<"sites">,
): boolean {
  return publicationDestinationBlockers(site).length === 0;
}

export function oneSetupSearchMeasurementReceiptVerified(
  site: DomainBoundGscSite,
  timestamp = Date.now(),
): boolean {
  const verifiedAt = site.gscReceiptVerifiedAt ?? 0;
  return Boolean(
    site.gscAccessToken &&
      site.gscRefreshToken &&
      site.gscProperty &&
      site.gscReceiptStatus === "verified" &&
      Number.isSafeInteger(site.gscReceiptRevision) &&
      (site.gscReceiptRevision ?? 0) > 0 &&
      verifiedAt > 0 &&
      verifiedAt <= timestamp + 5 * 60 * 1000 &&
      timestamp - verifiedAt <= GSC_CANONICAL_RECEIPT_FRESH_MS &&
      verifiedAt > (site.gscReceiptRevokedAt ?? 0) &&
      canonicalGscBindingCurrent(site),
  );
}

export function oneSetupOutreachMailboxReceiptVerified(args: {
  inboxes: readonly Doc<"outreach_inboxes">[];
  ownerAccountKey: string;
}): boolean {
  const inbox = args.inboxes.length === 1 ? args.inboxes[0] : null;
  return Boolean(
    inbox &&
      inbox.credentialOwnerAccountKey === args.ownerAccountKey &&
      ["warming", "active"].includes(inbox.status) &&
      inbox.verifiedAt &&
      inbox.spfVerifiedAt &&
      inbox.dkimVerifiedAt &&
      inbox.dmarcVerifiedAt &&
      inbox.complianceConfirmedAt &&
      autonomousGmailCredentialIssues({
        oauthScopes: inbox.oauthScopes,
        hasRefreshToken: Boolean(inbox.oauthRefreshToken),
      }).length === 0,
  );
}

export function oneSetupCanonicalReceiptBlockers(args: {
  site: Doc<"sites">;
  inboxes: readonly Doc<"outreach_inboxes">[];
  ownerAccountKey: string;
}): string[] {
  const blockers: string[] = [];
  if (!oneSetupPublisherReceiptVerified(args.site)) {
    blockers.push("one_setup_publisher_receipt_missing");
  }
  if (!oneSetupSearchMeasurementReceiptVerified(args.site)) {
    blockers.push("one_setup_search_measurement_receipt_missing");
  }
  if (!oneSetupOutreachMailboxReceiptVerified(args)) {
    blockers.push("one_setup_outreach_mailbox_receipt_missing");
  }
  return blockers;
}
