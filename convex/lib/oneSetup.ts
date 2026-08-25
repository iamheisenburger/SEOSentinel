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
