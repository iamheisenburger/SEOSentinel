import type { Doc } from "../_generated/dataModel";
import { autonomousGmailCredentialIssues } from "./outreachDelivery.ts";
import {
  inboundRelayConfigured,
  inboundRelayDsnRoutingReady,
  type InboundRelayRuntimeConfig,
} from "./outreachInboundRelay.ts";
import {
  MANAGED_SES_PLATFORM_SENDER_DOMAIN,
  MANAGED_SES_TRANSPORT,
  managedSesInboxReceiptCurrent,
} from "./managedSes.ts";
import {
  normalizeDomain,
  outreachSenderReadinessIssues,
} from "./outreachPacing.ts";

export const MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION = 1;
export const MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION = 1;
export const MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION = 1;
export const MANAGED_OUTREACH_MAILBOX_LEASE_MS = 2 * 60 * 1000;
export const MANAGED_OUTREACH_MAILBOX_ACCOUNT_DELETION_QUIESCENCE_MS =
  20 * 60 * 1000;

export const MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE =
  "managed_outreach_mailbox_adapter_unavailable";
export const MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED =
  "managed_outreach_mailbox_adapter_contract_not_implemented";
export const MANAGED_OUTREACH_MAILBOX_ADAPTER_RETRY =
  "managed_outreach_mailbox_adapter_retry";
export const MANAGED_OUTREACH_MAILBOX_PROVIDER_BLOCKED =
  "managed_outreach_mailbox_provider_blocked";

export function managedSesSuccessorHandoffDecision<ResourceId extends string>(
  args: {
    successorAlreadyInstalled: boolean;
    eligibleResourceIds: ResourceId[];
  },
):
  | { state: "none" }
  | { state: "retain_one"; resourceId: ResourceId }
  | { state: "ambiguous" } {
  if (args.successorAlreadyInstalled || args.eligibleResourceIds.length === 0) {
    return { state: "none" };
  }
  if (args.eligibleResourceIds.length !== 1) return { state: "ambiguous" };
  return { state: "retain_one", resourceId: args.eligibleResourceIds[0] };
}

export function managedSesRotationCandidateEligible(args: {
  differentGeneration: boolean;
  resourceRequestMatches: boolean;
  siteMatches: boolean;
  ownerMatches: boolean;
  domainMatches: boolean;
  domainRevisionMatches: boolean;
  contractMatches: boolean;
  resourceReleased: boolean;
  tombstoneMatches: boolean;
  inboxIdentityMatches: boolean;
  inboxProvenanceCleared: boolean;
  noPendingWork: boolean;
}): boolean {
  return Object.values(args).every(Boolean);
}

export type ManagedOutreachMailboxProfile = {
  fromName: string;
  physicalMailingAddress: string;
  attestationVersion: number;
  senderIdentityAndAddressAttestedAt: number;
  dedicatedSenderIdentityAttestedAt: number;
  deliveryEventCanaryAuthorizedAt: number;
  canaryConsentVersion: number;
};

export type ManagedOutreachMailboxAdapterConfiguration = {
  endpoint: string;
  adapterVersion: string;
};

/**
 * This validates only the operator-controlled adapter locator. It deliberately
 * does not accept credentials: an eventual adapter authentication mechanism
 * must be server-owned and implemented together with the transport. Until
 * then, the Node action remains a fail-closed contract stub.
 */
export function managedOutreachMailboxAdapterConfiguration(args: {
  endpoint?: string;
  adapterVersion?: string;
}): ManagedOutreachMailboxAdapterConfiguration | null {
  const endpoint = args.endpoint?.trim();
  const adapterVersion = args.adapterVersion?.trim();
  if (!endpoint || !adapterVersion) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return null;
  } catch {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(adapterVersion)) {
    return null;
  }
  return { endpoint, adapterVersion };
}

/** Passive dispatcher revisions never mint mailbox resources. */
export function nextManagedOutreachMailboxGeneration(args: {
  previousGeneration?: number;
  previousMode?: "connect_existing" | "managed";
  nextMode: "connect_existing" | "managed";
  hardReset: boolean;
}): number {
  const previous = Number.isSafeInteger(args.previousGeneration) &&
      (args.previousGeneration ?? 0) > 0
    ? args.previousGeneration!
    : 0;
  if (previous === 0) return 1;
  return args.hardReset || args.previousMode !== args.nextMode
    ? previous + 1
    : previous;
}

export function managedOutreachMailboxLeaseIsCurrent(args: {
  expectedLeaseToken: string;
  actualLeaseToken?: string;
  leaseExpiresAt?: number;
  timestamp: number;
}): boolean {
  return Boolean(
    args.expectedLeaseToken &&
      args.expectedLeaseToken === args.actualLeaseToken &&
      (args.leaseExpiresAt ?? 0) > args.timestamp,
  );
}

/** A lost delivery-event canary remains an immutable no-replay ambiguity
 * receipt through its exact challenge deadline. Once that deadline passes,
 * no provider write can still be in flight and the row no longer prevents
 * transport deprovisioning. */
export function managedOutreachMailboxCanaryReleasePending(args: {
  deliveryStatus: string;
  deliveryLeaseExpiresAt?: number;
  expiresAt: number;
  timestamp: number;
}): boolean {
  if (!["claimed", "accepted", "unverified"].includes(args.deliveryStatus)) {
    return false;
  }
  const liveLease = args.deliveryStatus === "claimed" &&
    (args.deliveryLeaseExpiresAt ?? 0) > args.timestamp;
  return liveLease || args.expiresAt > args.timestamp;
}

/** Verified privacy deletion is the sole bounded override for an ambiguous
 * outbound message. It is valid only while the exact account-deletion receipt
 * still owns this site and only after the global external-write quiescence. */
export function managedOutreachMailboxVerifiedDeletionSettled(args: {
  timestamp: number;
  accountDeletionRequestedAt?: number;
  siteUserId?: string;
  receiptUserId?: string;
  receiptStatus?: string;
  resourceOwnerMatches: boolean;
}): boolean {
  return Boolean(
    args.resourceOwnerMatches &&
      args.siteUserId &&
      args.receiptUserId === args.siteUserId &&
      ["revoking", "purging", "scrubbing_receipts"].includes(
        args.receiptStatus ?? "",
      ) &&
      Number.isFinite(args.accountDeletionRequestedAt) &&
      args.timestamp >=
        args.accountDeletionRequestedAt! +
          MANAGED_OUTREACH_MAILBOX_ACCOUNT_DELETION_QUIESCENCE_MS,
  );
}

/**
 * Common serializable fence for provision, install, and progress receipts.
 * Every mutable request/site identity participates; deletion always wins.
 */
export function managedOutreachMailboxRequestFenceIssues(args: {
  siteActive: boolean;
  requestMode: "connect_existing" | "managed";
  requestOwnerAccountKey: string;
  currentOwnerAccountKey?: string;
  requestDomainSnapshot: string;
  currentDomainSnapshot: string | null;
  requestDomainRevisionSnapshot?: number;
  currentDomainRevision: number;
  expectedConfigurationRevision: number;
  actualConfigurationRevision?: number;
  expectedGeneration: number;
  actualGeneration?: number;
  expectedContractVersion: number;
  actualContractVersion: number;
}): string[] {
  const issues: string[] = [];
  if (!args.siteActive) issues.push("site_inactive_or_deleting");
  if (args.requestMode !== "managed") issues.push("request_not_managed");
  if (
    !args.currentOwnerAccountKey ||
    args.requestOwnerAccountKey !== args.currentOwnerAccountKey
  ) issues.push("owner_changed");
  if (
    !args.currentDomainSnapshot ||
    args.requestDomainSnapshot !== args.currentDomainSnapshot ||
    args.requestDomainRevisionSnapshot !== args.currentDomainRevision
  ) issues.push("domain_changed");
  if (
    args.expectedConfigurationRevision !== args.actualConfigurationRevision
  ) issues.push("configuration_changed");
  if (args.expectedGeneration !== args.actualGeneration) {
    issues.push("generation_changed");
  }
  if (args.expectedContractVersion !== args.actualContractVersion) {
    issues.push("contract_changed");
  }
  return issues;
}

export function managedOutreachMailboxProfileIssues(
  profile: Partial<ManagedOutreachMailboxProfile> | null | undefined,
): string[] {
  const issues: string[] = [];
  const fromName = profile?.fromName?.trim() ?? "";
  const address = profile?.physicalMailingAddress?.trim() ?? "";
  if (fromName.length < 2 || fromName.length > 100) {
    issues.push("sender_name_invalid");
  }
  if (address.length < 15 || address.length > 300) {
    issues.push("physical_mailing_address_invalid");
  }
  if (
    profile?.attestationVersion !==
      MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION ||
    !Number.isFinite(profile.senderIdentityAndAddressAttestedAt) ||
    (profile.senderIdentityAndAddressAttestedAt ?? 0) <= 0 ||
    !Number.isFinite(profile.dedicatedSenderIdentityAttestedAt) ||
    (profile.dedicatedSenderIdentityAttestedAt ?? 0) <= 0
  ) issues.push("sender_attestation_missing");
  if (
    profile?.canaryConsentVersion !==
      MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION ||
    !Number.isFinite(profile.deliveryEventCanaryAuthorizedAt) ||
    (profile.deliveryEventCanaryAuthorizedAt ?? 0) <= 0
  ) issues.push("delivery_event_canary_authorization_missing");
  return issues;
}

export function managedOutreachMailboxOperationalIssues(args: {
  siteDomain: string;
  inboxes: readonly Doc<"outreach_inboxes">[];
  resource: Doc<"managed_outreach_mailbox_resources"> | null;
  requestId: string;
  siteId: string;
  ownerAccountKey: string;
  expectedDomainRevision: number;
  expectedConfigurationRevision: number;
  expectedGeneration: number;
  expectedRequestContractVersion: number;
  expectedProfile: Partial<ManagedOutreachMailboxProfile> | null | undefined;
  now: number;
  rolloutEpoch: number;
  runtimeConfig: InboundRelayRuntimeConfig;
}): string[] {
  if (args.inboxes.length !== 1) return ["exactly_one_mailbox_required"];
  const inbox = args.inboxes[0];
  const resource = args.resource;
  if (!resource) return ["managed_resource_receipt_missing"];
  if (
    String(resource.requestId) !== args.requestId ||
    String(resource.siteId) !== args.siteId ||
    resource.ownerAccountKey !== args.ownerAccountKey ||
    resource.domainSnapshot !== normalizeDomain(args.siteDomain) ||
    resource.domainRevisionSnapshot !== args.expectedDomainRevision ||
    resource.requestConfigurationRevision !==
      args.expectedConfigurationRevision ||
    resource.requestContractVersion !== args.expectedRequestContractVersion ||
    resource.generation !== args.expectedGeneration ||
    resource.lifecycleState !== "canonicalized" ||
    resource.releaseState !== "active" ||
    !resource.externalProvisioningAttemptedAt ||
    !resource.externalAllocatedAt ||
    resource.canonicalInboxId !== inbox._id ||
    inbox.credentialSource !== "managed_adapter" ||
    inbox.managedTransportOperationKey !== resource.operationKey ||
    inbox.managedTransportGeneration !== resource.generation ||
    inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
    !/^[a-f0-9]{64}$/.test(resource.operationKey) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(
      resource.adapterVersion ?? "",
    )
  ) return ["managed_resource_receipt_invalid"];
  if (managedOutreachMailboxProfileIssues(args.expectedProfile).length > 0) {
    return ["owner_sender_attestation_missing"];
  }
  const expectedProfile = args.expectedProfile as ManagedOutreachMailboxProfile;
  if (inbox.provider === MANAGED_SES_TRANSPORT) {
    const issues: string[] = [];
    const senderDomain = normalizeDomain(inbox.senderDomain ?? "");
    const fromDomain = normalizeDomain(inbox.fromEmail.split("@")[1] ?? "");
    if (
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
      resource.resourceReceipt !== inbox.managedTransportResourceReceipt ||
      resource.externalVerifiedAt !==
        inbox.managedTransportResourceVerifiedAt ||
      !managedSesInboxReceiptCurrent({
        inbox,
        now: args.now,
        expectedAdapterVersion: resource.adapterVersion,
      })
    ) issues.push("managed_ses_signed_receipt_missing_or_stale");
    if (
      !senderDomain ||
      senderDomain !== fromDomain ||
      senderDomain !== MANAGED_SES_PLATFORM_SENDER_DOMAIN
    ) issues.push("managed_ses_sender_binding_invalid");
    if (inbox.credentialOwnerAccountKey !== args.ownerAccountKey) {
      issues.push("credential_owner_mismatch");
    }
    if (inbox.fromName?.trim() !== expectedProfile.fromName) {
      issues.push("sender_identity_mismatch");
    }
    if (
      inbox.physicalMailingAddress?.trim() !==
        expectedProfile.physicalMailingAddress
    ) issues.push("physical_mailing_address_mismatch");
    if (
      !inbox.complianceConfirmedAt ||
      inbox.complianceConfirmedAt <
        expectedProfile.senderIdentityAndAddressAttestedAt
    ) issues.push("compliance_receipt_missing_or_stale");
    if (!inbox.verifiedAt || !["warming", "active"].includes(inbox.status)) {
      issues.push("mailbox_not_operational");
    }
    if (!inboundRelayConfigured(args.runtimeConfig)) {
      issues.push("signed_reply_stop_relay_unavailable");
    }
    return [...new Set(issues)];
  }
  const issues = outreachSenderReadinessIssues({
    siteDomain: args.siteDomain,
    provider: inbox.provider,
    fromEmail: inbox.fromEmail,
  }).map(() => "gmail_secondary_domain_required");
  if (inbox.credentialOwnerAccountKey !== args.ownerAccountKey) {
    issues.push("credential_owner_mismatch");
  }
  if (inbox.provider !== "gmail") issues.push("gmail_provider_required");
  const senderDomain = normalizeDomain(inbox.senderDomain ?? "");
  const fromDomain = normalizeDomain(inbox.fromEmail.split("@")[1] ?? "");
  if (!senderDomain || senderDomain !== fromDomain) {
    issues.push("sender_domain_mismatch");
  }
  if (inbox.fromName?.trim() !== expectedProfile.fromName) {
    issues.push("sender_identity_mismatch");
  }
  if (
    inbox.physicalMailingAddress?.trim() !==
      expectedProfile.physicalMailingAddress
  ) issues.push("physical_mailing_address_mismatch");
  if (
    !inbox.complianceConfirmedAt ||
    inbox.complianceConfirmedAt <
      expectedProfile.senderIdentityAndAddressAttestedAt
  ) issues.push("compliance_receipt_missing_or_stale");
  if (!inbox.verifiedAt || !["warming", "active"].includes(inbox.status)) {
    issues.push("mailbox_not_operational");
  }
  if (!inbox.spfVerifiedAt || !inbox.dkimVerifiedAt || !inbox.dmarcVerifiedAt) {
    issues.push("stored_dns_receipt_missing");
  }
  if (autonomousGmailCredentialIssues({
    oauthScopes: inbox.oauthScopes,
    hasRefreshToken: Boolean(inbox.oauthRefreshToken),
  }).length > 0) issues.push("gmail_refresh_scope_invalid");
  if (!inboundRelayDsnRoutingReady({
    inbox,
    now: args.now,
    rolloutEpoch: args.rolloutEpoch,
    runtimeConfig: args.runtimeConfig,
  }) || (inbox.inboundRelayDsnRoutingVerifiedAt ?? 0) <
      expectedProfile.deliveryEventCanaryAuthorizedAt) {
    issues.push("signed_dsn_canary_missing_or_unauthorized");
  }
  return [...new Set(issues)];
}

export function managedOutreachMailboxOperationallyReady(
  args: Parameters<typeof managedOutreachMailboxOperationalIssues>[0],
): boolean {
  return managedOutreachMailboxOperationalIssues(args).length === 0;
}

export function managedOutreachMailboxReleaseSealed(args: {
  externalProvisioningAttemptedAt?: number;
  externalAllocatedAt?: number;
  hasCanonicalInbox?: boolean;
  releaseState: string;
  tombstoneState?: string;
}): boolean {
  if (
    !args.externalProvisioningAttemptedAt &&
    !args.externalAllocatedAt &&
    !args.hasCanonicalInbox
  ) {
    return args.releaseState === "released" &&
      args.tombstoneState === "not_required";
  }
  return args.releaseState === "released" &&
    args.tombstoneState === "released";
}

export type ManagedOutreachMailboxProvisionOperation = {
  contractVersion: number;
  transport: "managed_ses";
  operationKey: string;
  generation: number;
  configurationRevision: number;
  // A real adapter must reject/abort provider work after this absolute
  // deadline. Release additionally waits through a late-result grace window.
  externalDeadlineAt: number;
  tenantDomain: string;
  senderProfile: {
    fromName: string;
    physicalMailingAddress: string;
  };
  attestations: {
    profileVersion: number;
    senderIdentityAndAddressAttestedAt: number;
    dedicatedSenderIdentityAttestedAt: number;
    canaryConsentVersion: number;
    deliveryEventCanaryAuthorizedAt: number;
  };
  requirements: {
    idempotentOperationKey: true;
    doNotCommitAfterExternalDeadline: true;
    tenantIsolatedSenderIdentity: true;
    tenantBoundSendingAuthority: true;
    dedicatedSenderIdentity: true;
    scopedOutboundAuthority: true;
    spfDkimDmarc: true;
    signedDeliveryEventCanary: true;
  };
};

export type ManagedOutreachMailboxReleaseOperation = {
  contractVersion: number;
  transport: "managed_ses";
  operationKey: string;
  generation: number;
  provisioningAdapterVersion?: string;
  releaseReason: string;
  requirements: {
    reconcileProvisioningStatusByOperationKey: true;
    releaseWinsLateProvision: true;
  };
};
