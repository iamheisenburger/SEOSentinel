/**
 * One reviewed recovery for the expected-click migration's historical-topic
 * dedupe incident. This is deliberately an exact terminal signature rather
 * than a general failed-plan retry policy: every other terminal plan remains
 * terminal and requires its own diagnosis.
 */
export const EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION = 1;

export const EXPECTED_CLICK_ZERO_INSERT_TERMINAL_ERROR =
  "Terminal planner outcome (terminal_planner): Verified topic enrichment failed; refusing to save raw autopilot topics: Verified planning produced no new scheduler-eligible topics; refusing to report a false replenishment success.";

export function isExpectedClickZeroInsertTerminalError(
  error: string | undefined,
): boolean {
  return error === EXPECTED_CLICK_ZERO_INSERT_TERMINAL_ERROR;
}
