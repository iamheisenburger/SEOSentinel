import { publicationInventoryDetail, type PublicationInventory } from "./publicationEligibility.ts";

/** Presentation only. Status precedence, deadlines and admission stay with
 * their existing owners. Tests require every registered health status here. */
export const AUTOPILOT_HEALTH_DETAILS = {
  healthy: "Scheduler, quality buffer, and cadence are healthy.",
  recovering: "Autopilot work is in progress; buffer recovery and delivery are not yet verified.",
  missed: "Publication cadence deadline missed.",
  scheduler_stale: "Natural dispatcher heartbeat is stale.",
  buffer_empty: "No strict-quality sealed article is buffered.",
  buffer_low: "Strict-quality future buffer is below minimum.",
  quality_budget_exhausted: "The bounded generation allowance is exhausted while the quality buffer remains below minimum.",
  quality_quarantined: "The latest candidate was quarantined by the strict quality gate.",
  publication_failed: "The latest external publication attempt failed.",
  job_failed: "The latest content or plan worker failed.",
  job_lease_exhausted: "The worker lease recovery allowance is exhausted; work has not completed.",
  run_failed: "The latest autopilot run failed.",
  run_outcome_unclassified: "The latest autopilot outcome is unrecognized; recovery is not verified.",
  planning_blocked: "New topic planning is blocked by an admission guard; no new plan was admitted.",
  topic_admission_blocked: "The selected topic did not pass article admission.",
  topic_replenishment_exhausted: "The bounded topic-plan window is exhausted; replenishment is waiting for its eligibility deadline.",
  opportunity_space_exhausted: "No currently verified, non-overlapping topic opportunity is available.",
  cadence_failure_cooldown: "Planning recovery is waiting for its recorded failure-cooldown deadline.",
  provider_funding_paused: "Provider funding is unavailable or unverified; paid work is paused.",
  provider_allowance_paused: "The internal provider-spending allowance blocks paid work.",
  quota_reached: "The account's article-generation quota has been reached.",
  site_limit_reached: "This site is outside the account's current site allowance.",
  readiness_blocked: "Required site readiness checks have not passed.",
  readiness_regressed: "A required site readiness check no longer passes.",
  scheduler_state_conflict: "The scheduler could not confirm a consistent state; no successful handoff is verified.",
  migration_pending: "Waiting for the resumable legacy article migration.",
  autopilot_disabled: "Autopilot is disabled; automatic work is not authorized.",
  cadence_paused: "Cadence is intentionally paused; no generation or publication is due.",
  site_parked: "This site is not active under the current account plan.",
  rollout_observe: "Observe mode: automation is intentionally blocked.",
  rollout_conflict: "The current rollout no longer matches the work's authorization.",
  rollout_buffer_ready: "The warm buffer is ready for rollout review; live publishing is not yet authorized.",
  public_url_pending: "Publication was submitted, but its live URL is not yet verified.",
  public_url_failed: "The external article's live URL could not be verified.",
  publication_deferral_exhausted: "The bounded publication-contention wait is exhausted; delivery remains blocked.",
  publication_delivery_terminal: "The article has a terminal publication blocker; delivery is not verified.",
  publication_destination_contended: "The publishing destination is busy; delivery is waiting for a bounded retry.",
  publication_inventory_incomplete: "The publication inventory is incomplete; an exact buffer count is not verified.",
  topic_portfolio_below_goal: "Measured topic demand is below the configured organic-click goal.",
  topic_portfolio_evidence_missing: "The topic portfolio lacks fresh outcome evidence.",
} as const;

export function autopilotHealthDetail(args: {
  status: string;
  inventory?: PublicationInventory;
  publicationMissed?: boolean;
}): string {
  if (args.inventory && args.inventory.status !== "complete") {
    return `${args.publicationMissed ? `${AUTOPILOT_HEALTH_DETAILS.missed} ` : ""}${publicationInventoryDetail(args.inventory)}`;
  }
  // Even contradictory caller context must not manufacture a healthy claim.
  if (args.publicationMissed && args.status === "healthy") return AUTOPILOT_HEALTH_DETAILS.missed;
  const detail = Object.prototype.hasOwnProperty.call(AUTOPILOT_HEALTH_DETAILS, args.status)
    ? AUTOPILOT_HEALTH_DETAILS[args.status as keyof typeof AUTOPILOT_HEALTH_DETAILS]
    : "Automation status is unrecognized; scheduler, buffer and cadence health are not verified.";
  return args.publicationMissed && args.status !== "missed"
    ? `${AUTOPILOT_HEALTH_DETAILS.missed} ${detail}`
    : detail;
}
