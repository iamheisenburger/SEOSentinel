import { siteExecutionActive } from "./planSiteAllowance.ts";
import {
  normalizeCanonicalDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./siteDomainBinding.ts";

export type JobRolloutState = {
  contentWork?: { connectionHash: string; profileHash: string; retiredAt?: number; ownerRequest?: { userId: string } };
  payload?: unknown;
  rolloutEpoch?: number;
  canonicalDomain?: string;
  domainRevision?: number;
};

export type SiteRolloutState = {
  userId?: string;
  serviceMode?: string;
  contentSchedule?: { connectionHash: string; profileHash: string; paused: boolean };
  autopilotEnabled?: boolean;
  autopilotRolloutMode?: string;
  autopilotRolloutEpoch?: number;
  domain?: string;
  canonicalDomain?: string;
  canonicalDomainRevision?: number;
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
  if (job.contentWork?.retiredAt !== undefined) return false;
  if (site.serviceMode === "growth_first") {
    if (!job.contentWork || !site.contentSchedule || (site.contentSchedule.paused && !job.contentWork.ownerRequest) ||
      job.contentWork.connectionHash !== site.contentSchedule.connectionHash ||
      job.contentWork.profileHash !== site.contentSchedule.profileHash) return false;
  } else if (job.contentWork) return false;
  if (job.contentWork?.ownerRequest && (job.contentWork.ownerRequest.userId !== site.userId || !isManualJobPayload(job.payload))) return false;
  const currentDomain = siteCanonicalDomain(site);
  const currentRevision = siteCanonicalDomainRevision(site);
  const hasJobBinding = job.canonicalDomain !== undefined ||
    job.domainRevision !== undefined;
  if (
    !currentDomain ||
    (hasJobBinding
      ? normalizeCanonicalDomain(job.canonicalDomain ?? "") !== currentDomain ||
        job.domainRevision !== currentRevision
      : !siteUsesLegacyDomainReceipts(site))
  ) return false;
  if (isManualJobPayload(job.payload)) return true;
  return (
    autonomousRolloutActive(site) &&
    job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0)
  );
}

export function shouldCancelForEpochTransition(job: JobRolloutState): boolean {
  return !isManualJobPayload(job.payload);
}
