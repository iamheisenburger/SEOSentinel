export type AutopilotAlertView = {
  kind: string;
  updatedAt?: number;
};

export type AutopilotHealthView = {
  status?: string;
  updatedAt?: number;
};

const NON_BLOCKING_ALERT_KINDS = new Set([
  "topic_replenishment",
  "topic_horizon_replenishment",
]);

// These incidents are real when raised, but a later healthy health receipt is
// stronger evidence that the scheduler/content path recovered. Keeping them
// active after that receipt made the customer dashboard contradict the
// operator view and present historical failures as current blockers.
const RECOVERED_BY_HEALTHY_RECEIPT_KINDS = new Set([
  "article_provider_funding_unavailable",
  "buffer_empty",
  "buffer_low",
  "job_failed",
  "job_lease_exhausted",
  "job_retry_exhausted",
  "missed_publication_sla",
  "quality_quarantined",
  "scheduler_stale",
  "topic_replenishment_exhausted",
]);

function isRunFailure(kind: string): boolean {
  return kind.endsWith("_run_failed");
}

export function isInformationalAutopilotAlert(kind: string): boolean {
  return NON_BLOCKING_ALERT_KINDS.has(kind);
}

export function isRecoveredByHealthyAutopilotReceipt(kind: string): boolean {
  return (
    NON_BLOCKING_ALERT_KINDS.has(kind) ||
    RECOVERED_BY_HEALTHY_RECEIPT_KINDS.has(kind) ||
    isRunFailure(kind)
  );
}

export function healthyReceiptSupersedesAlert(
  alert: AutopilotAlertView,
  health: AutopilotHealthView | null | undefined,
): boolean {
  if (health?.status !== "healthy") return false;
  if (!isRecoveredByHealthyAutopilotReceipt(alert.kind)) return false;
  return (health.updatedAt ?? 0) >= (alert.updatedAt ?? Number.POSITIVE_INFINITY);
}

export function autopilotAlertRequiresAttention(
  alert: AutopilotAlertView,
  health: AutopilotHealthView | null | undefined,
): boolean {
  if (isInformationalAutopilotAlert(alert.kind)) return false;
  return !healthyReceiptSupersedesAlert(alert, health);
}

export function autopilotHealthRequiresAttention(status?: string): boolean {
  return Boolean(status && status !== "healthy" && status !== "recovering");
}

export function dashboardAutopilotRequiresAttention(args: {
  health: AutopilotHealthView | null | undefined;
  alerts: AutopilotAlertView[];
}): boolean {
  if (autopilotHealthRequiresAttention(args.health?.status)) return true;
  return args.alerts.some((alert) =>
    autopilotAlertRequiresAttention(alert, args.health),
  );
}
