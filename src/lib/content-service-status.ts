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

type FundingState = { status: string; monthlyLimitMicroUsd?: number | null; settledActualMicroUsd?: number | null;
  heldCeilingMicroUsd?: number | null; requestedMicroUsd?: number | null; monthlyResetAt?: number; dailyResetAt?: number };
const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;
const day = (at: number, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(at);
const clock = (at: number, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);

/** Plain, truthful reason new articles can't start: real dollars, the real limit, when it lifts. */
export function fundingMessage(funding: FundingState, zone = "UTC") {
  if (funding.status !== "blocked") return "Pentra can't start new articles right now. Your published articles are not affected.";
  const limit = funding.monthlyLimitMicroUsd ?? null, spent = funding.settledActualMicroUsd ?? null, held = funding.heldCeilingMicroUsd ?? null;
  const requested = funding.requestedMicroUsd ?? 0;
  if (limit === null || spent === null || held === null) return "Pentra can't start new articles right now. Your published articles are not affected.";
  if (limit - spent - held >= requested && funding.dailyResetAt) {
    return `Today's spending limit is reached, so the next article starts after ${clock(funding.dailyResetAt, zone)}. Nothing is lost.`;
  }
  const inProgress = held > 0 ? ` and ${dollars(held)} set aside for articles in progress` : "";
  const resets = funding.monthlyResetAt ? ` or on ${day(funding.monthlyResetAt, zone)}` : "";
  return `This month's article budget is used: ${dollars(spent)} spent${inProgress}, of ${dollars(limit)}. New articles start again as set-aside money is released${resets}. For more each month, upgrade in Plans & billing.`;
}
