export const ONE_SETUP_CONTRACT_VERSION = 1;

export type OneSetupMode = "connect_existing" | "managed";
export type OneSetupAutomationMode = "assisted" | "full";
export type OneSetupCapability =
  | "publisher"
  | "search_measurement"
  | "outreach_mailbox";
export type OneSetupProgressState =
  | "owner_action_required"
  | "requested"
  | "in_progress"
  | "ready"
  | "blocked";
export type OneSetupReadinessState =
  | "ready"
  | "queued"
  | "in_progress"
  | "action_required"
  | "blocked";

export type OneSetupCapabilityProgress = {
  mode: OneSetupMode;
  state: OneSetupProgressState;
};

export type OneSetupActionOwner = "owner" | "operator";

export const MANAGED_PROVISIONING_LEASE_MS = 2 * 60 * 1000;
export const MANAGED_PROVISIONING_RECONCILE_MS = 15 * 60 * 1000;
export const MANAGED_PROVIDER_PROGRESS_STALE_MS = 30 * 60 * 1000;

export function normalizedOneSetupDomain(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export type ManagedProvisioningDecision = {
  state: OneSetupProgressState;
  blockedReasonCode?: string;
  actionRequiredBy?: OneSetupActionOwner;
};

/**
 * Reconciliation is deliberately provider-neutral and fail-closed. A
 * capability becomes ready only from its canonical connection receipt. In
 * the absence of an installed managed adapter, the dispatcher names the
 * exact human boundary instead of leaving a request looking indefinitely
 * queued.
 */
export function managedProvisioningDecision(args: {
  capability: OneSetupCapability;
  mode: OneSetupMode;
  canonicalReceiptVerified: boolean;
  currentProgress?: {
    state: OneSetupProgressState;
    blockedReasonCode?: string;
    actionRequiredBy?: OneSetupActionOwner;
    updatedAt: number;
  };
  timestamp?: number;
}): ManagedProvisioningDecision {
  if (args.canonicalReceiptVerified) return { state: "ready" };
  if (args.mode === "connect_existing") {
    return {
      state: "owner_action_required",
      blockedReasonCode: `${args.capability}_connection_required`,
      actionRequiredBy: "owner",
    };
  }
  if (
    args.currentProgress?.state === "blocked" &&
    args.currentProgress.blockedReasonCode &&
    args.currentProgress.actionRequiredBy
  ) {
    return {
      state: "blocked",
      blockedReasonCode: args.currentProgress.blockedReasonCode,
      actionRequiredBy: args.currentProgress.actionRequiredBy,
    };
  }
  if (
    args.currentProgress?.state === "in_progress" &&
    args.currentProgress.updatedAt > 0 &&
    args.currentProgress.updatedAt <= (args.timestamp ?? 0) + 5_000 &&
    (args.timestamp ?? 0) - args.currentProgress.updatedAt <=
      MANAGED_PROVIDER_PROGRESS_STALE_MS
  ) {
    return { state: "in_progress" };
  }
  if (args.capability === "search_measurement") {
    return {
      state: "blocked",
      blockedReasonCode: "search_console_oauth_consent_required",
      actionRequiredBy: "owner",
    };
  }
  if (args.capability === "publisher") {
    return {
      state: "blocked",
      blockedReasonCode: "managed_publisher_adapter_unavailable",
      actionRequiredBy: "operator",
    };
  }
  return {
    state: "blocked",
    blockedReasonCode: "managed_outreach_mailbox_adapter_unavailable",
    actionRequiredBy: "operator",
  };
}

export function managedProvisioningRetryAt(timestamp: number): number {
  return timestamp + MANAGED_PROVISIONING_RECONCILE_MS;
}

const ONE_SETUP_ACTION_COPY: Record<string, string> = {
  publisher_connection_required:
    "Connect and verify a supported publishing destination in site settings.",
  search_measurement_connection_required:
    "Connect and authorize Google Search Console in site settings.",
  outreach_mailbox_connection_required:
    "Connect and verify a dedicated outreach mailbox in site settings.",
  search_console_oauth_consent_required:
    "Authorize Google Search Console. Google requires the website owner to grant OAuth consent.",
  managed_publisher_adapter_unavailable:
    "Pentra operations must provision a supported publishing adapter; no verified destination receipt exists yet.",
  managed_outreach_mailbox_adapter_unavailable:
    "Pentra operations must provision and verify a dedicated outreach mailbox; provider, DNS, and sender receipts are still absent.",
};

export function oneSetupActionMessage(
  reasonCode: string | undefined,
): string | undefined {
  if (!reasonCode) return undefined;
  return ONE_SETUP_ACTION_COPY[reasonCode] ??
    `Resolve the managed setup blocker: ${reasonCode}.`;
}

export function managedProvisioningLeaseIsCurrent(args: {
  expectedRevision: number;
  actualRevision: number;
  expectedLeaseToken: string;
  actualLeaseToken?: string;
  leaseExpiresAt?: number;
  timestamp: number;
}): boolean {
  return args.expectedRevision === args.actualRevision &&
    args.expectedLeaseToken === args.actualLeaseToken &&
    (args.leaseExpiresAt ?? 0) > args.timestamp;
}

export function managedProvisioningIdentityIsCurrent(args: {
  siteActive: boolean;
  requestOwnerAccountKey: string;
  currentOwnerAccountKey?: string;
  requestDomainSnapshot: string;
  currentDomainSnapshot: string | null;
  requestContractVersion: number;
}): boolean {
  return args.siteActive &&
    Boolean(args.currentOwnerAccountKey) &&
    args.requestOwnerAccountKey === args.currentOwnerAccountKey &&
    args.requestDomainSnapshot === args.currentDomainSnapshot &&
    args.requestContractVersion === ONE_SETUP_CONTRACT_VERSION;
}

export function initialOneSetupProgress(
  mode: OneSetupMode,
): OneSetupProgressState {
  return mode === "managed" ? "requested" : "owner_action_required";
}

export function aggregateOneSetupRequestState(
  capabilities: readonly OneSetupCapabilityProgress[],
): OneSetupProgressState {
  if (capabilities.some((capability) => capability.state === "blocked")) {
    return "blocked";
  }
  if (capabilities.every((capability) => capability.state === "ready")) {
    return "ready";
  }
  if (capabilities.some((capability) => capability.state === "in_progress")) {
    return "in_progress";
  }
  if (capabilities.some((capability) => capability.state === "requested")) {
    return "requested";
  }
  return "owner_action_required";
}

/**
 * A provisioning worker's state is progress, never proof that an integration
 * is usable. Only a separately verified connection receipt can return ready.
 */
export function oneSetupCapabilityReadiness(args: {
  connectionVerified: boolean;
  progress: OneSetupCapabilityProgress;
}): OneSetupReadinessState {
  if (args.connectionVerified) return "ready";
  if (args.progress.state === "blocked") return "blocked";
  if (args.progress.mode === "connect_existing") return "action_required";
  if (args.progress.state === "in_progress" || args.progress.state === "ready") {
    return "in_progress";
  }
  return "queued";
}

export function aggregateOneSetupReadiness(
  stages: readonly OneSetupReadinessState[],
): {
  status: "ready" | "in_progress" | "action_required" | "blocked";
  readyCount: number;
  totalCount: number;
  percent: number;
} {
  const totalCount = stages.length;
  const readyCount = stages.filter((stage) => stage === "ready").length;
  const status = stages.some((stage) => stage === "blocked")
    ? "blocked"
    : readyCount === totalCount && totalCount > 0
      ? "ready"
      : stages.some((stage) => stage === "action_required")
        ? "action_required"
        : "in_progress";
  return {
    status,
    readyCount,
    totalCount,
    percent: totalCount === 0 ? 0 : Math.round((readyCount / totalCount) * 100),
  };
}
