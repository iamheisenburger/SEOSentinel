export const ONBOARDING_WORKFLOW = "core_crawl_analysis_v1";
export const ONBOARDING_CACHE_VERSION = 1;
export const ONBOARDING_LEASE_MS = 15 * 60 * 1000;
export const ONBOARDING_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
export const ONBOARDING_SECOND_FAILURE_COOLDOWN_MS = 60 * 60 * 1000;
export const ONBOARDING_REPEATED_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Complete worst-case envelope for the bounded Claude analysis plus optional
// pricing lookup. It is a reservation ceiling, not claimed actual spend.
export const ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD = 250_000;

export type OnboardingClaimCandidate = {
  status: string;
  payload?: unknown;
  result?: unknown;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
  updatedAt: number;
};

export type OnboardingClaimDecision =
  | { status: "cached"; result: unknown }
  | { status: "in_progress"; retryAt: number }
  | { status: "cooling_down"; retryAt: number }
  | { status: "claim" };

export type OnboardingDomainBinding = {
  canonicalDomain: string;
  domainRevision: number;
  legacyFallbackAllowed: boolean;
};

export function onboardingFailureCooldownMs(failureCount: number): number {
  if (failureCount <= 1) return ONBOARDING_FAILURE_COOLDOWN_MS;
  if (failureCount === 2) return ONBOARDING_SECOND_FAILURE_COOLDOWN_MS;
  return ONBOARDING_REPEATED_FAILURE_COOLDOWN_MS;
}

export function onboardingInputFingerprint(domain: string): string {
  const raw = domain.trim();
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.href;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

function isCurrentWorkflow(
  job: OnboardingClaimCandidate,
  inputFingerprint: string,
  binding?: OnboardingDomainBinding,
): boolean {
  if (!job.payload || typeof job.payload !== "object") return false;
  const payload = job.payload as Record<string, unknown>;
  const workflowMatches = (
    payload.workflow === ONBOARDING_WORKFLOW &&
    payload.cacheVersion === ONBOARDING_CACHE_VERSION &&
    payload.inputFingerprint === inputFingerprint
  );
  if (!workflowMatches || !binding) return workflowMatches;
  const receiptDomain = payload.canonicalDomain;
  const receiptRevision = payload.domainRevision;
  if (receiptDomain === undefined && receiptRevision === undefined) {
    return binding.legacyFallbackAllowed;
  }
  return receiptDomain === binding.canonicalDomain &&
    receiptRevision === binding.domainRevision;
}

export function onboardingJobMatchesDomainBinding(
  job: OnboardingClaimCandidate,
  inputFingerprint: string,
  binding: OnboardingDomainBinding,
): boolean {
  return isCurrentWorkflow(job, inputFingerprint, binding);
}

/**
 * Decide whether one provider-backed onboarding pass may start. A successful
 * receipt always wins, an active lease serializes concurrent clicks, and the
 * newest failed receipt enforces a stable retry cooldown.
 */
export function decideOnboardingClaim(
  jobs: readonly OnboardingClaimCandidate[],
  now: number,
  inputFingerprint: string,
  binding?: OnboardingDomainBinding,
): OnboardingClaimDecision {
  const current = jobs.filter((job) =>
    isCurrentWorkflow(job, inputFingerprint, binding)
  );
  const completed = current.find(
    (job) => job.status === "done" && job.result !== undefined,
  );
  if (completed) return { status: "cached", result: completed.result };

  const running = current.find(
    (job) =>
      job.status === "running" && (job.leaseExpiresAt ?? 0) > now,
  );
  if (running) {
    return { status: "in_progress", retryAt: running.leaseExpiresAt! };
  }

  const latestFailure = current
    .filter((job) => job.status === "failed")
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (latestFailure && (latestFailure.nextAttemptAt ?? 0) > now) {
    return {
      status: "cooling_down",
      retryAt: latestFailure.nextAttemptAt!,
    };
  }

  return { status: "claim" };
}
