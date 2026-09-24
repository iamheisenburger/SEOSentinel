type ServiceState = {
  serviceMode?: string; enabled?: boolean; bindingCurrent?: boolean; entitlement?: boolean; approvalRequired?: boolean;
  schedule?: { paused: boolean; active: boolean; ownerReviewedOnly?: boolean; autopilotSelected?: boolean } | null; ready?: number; complete?: boolean;
  autopilot?: { selectable?: boolean } | null;
  work?: ReadonlyArray<{ stage: string; retiredAt?: number; systemFailure?: boolean; creditRetry?: unknown; parked?: boolean }>;
};

/** One customer-facing interpretation for sidebar, overview and settings.
 * It never authorizes execution; server guards still own every transition. */
export function contentServiceStatus(state: ServiceState | null | undefined) {
  const work = state?.work?.filter(w => w.retiredAt === undefined) ?? [];
  const systemFailure = work.some(w => w.systemFailure);
  const paused = Boolean(state?.schedule?.paused);
  const status = !state ? "loading" : state.serviceMode !== "growth_first" ? "legacy"
    : state.bindingCurrent === false ? "changed" : state.schedule?.ownerReviewedOnly ? "owner_reviewed" : systemFailure ? "failed" : paused ? "paused"
    : work.some(w => w.stage === "failed" && !w.creditRetry && !w.parked) ? "failed"
    : state.schedule?.active ? "active" : (state.ready ?? 0) >= 2 ? "ready" : "preparing";
  const label = { loading: "Checking delivery status", legacy: state?.enabled !== false ? "Autopilot on" : "Manual",
    changed: "Stopped — review changed setup", failed: paused ? "Delivery paused" : "Delivery needs attention", paused: "Paused",
    owner_reviewed: "Owner-reviewed drafts", active: "Schedule active", ready: "Ready — schedule not active", preparing: "Preparing — not active" }[status];
  // Sites set up through the Autopilot / Review-first choice get plain labels.
  const simple = Boolean(state?.autopilot?.selectable && (state?.schedule?.autopilotSelected || state?.schedule?.ownerReviewedOnly));
  const simpleLabel = { loading: label, legacy: label, changed: "Setup changed — check settings", failed: "Needs your review",
    paused: "Paused", owner_reviewed: "Review first", active: "Autopilot on", ready: "Autopilot starting", preparing: "Autopilot starting" }[status];
  const operable = !!state && !state.schedule?.ownerReviewedOnly && state.bindingCurrent !== false && !!state.entitlement && !state.approvalRequired && status !== "failed";
  return { status, label: simple ? simpleLabel : label, systemFailure,
    canPause: !!state?.schedule && !paused && !state.schedule.ownerReviewedOnly,
    canResume: operable && paused,
    canRetry: operable && !paused && (work.some(w => w.creditRetry) ||
      (!state.schedule?.active && !work.some(w => ["prepare", "review", "publish", "verify", "failed"].includes(w.stage)))),
  };
}
