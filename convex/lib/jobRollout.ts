import { siteExecutionActive } from "./planSiteAllowance.ts";

export type JobRolloutState = {
  payload?: unknown;
  rolloutEpoch?: number;
};

export type SiteRolloutState = {
  autopilotEnabled?: boolean;
  autopilotRolloutMode?: string;
  autopilotRolloutEpoch?: number;
  deletionStatus?: string;
  planParkedAt?: number;
};

export function isManualJobPayload(payload: unknown): boolean {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).manual === true,
  );
}

export function autonomousRolloutActive(site: SiteRolloutState | null): boolean {
  return Boolean(
    siteExecutionActive(site) &&
      site.autopilotEnabled &&
      (site.autopilotRolloutMode === "warm" ||
        site.autopilotRolloutMode === "live"),
  );
}

export function jobAuthorizedForExecution(
  site: SiteRolloutState | null,
  job: JobRolloutState,
): boolean {
  if (!siteExecutionActive(site)) return false;
  if (isManualJobPayload(job.payload)) return true;
  return (
    autonomousRolloutActive(site) &&
    job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0)
  );
}

export function shouldCancelForEpochTransition(job: JobRolloutState): boolean {
  return !isManualJobPayload(job.payload);
}
