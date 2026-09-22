/** Match the publisher's pre-write authorization in customer-facing controls.
 * This is not approval and never authorizes an external write itself. */
export function manualPublicationBlocker(site: { autopilotEnabled?: boolean; autopilotRolloutMode?: string } | null | undefined) {
  if (!site) return "Loading publishing readiness.";
  return !site.autopilotEnabled || site.autopilotRolloutMode !== "live"
    ? "Publishing is not active for this website. Open Settings to check preparation and activation. Your approved article is retained."
    : null;
}
