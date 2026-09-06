/** Only an actual positive-to-positive schedule edit can retain a verified
 * rollout. The caller still acquires the configuration fence, cancels old
 * autonomous jobs and increments the epoch. This is not authorization to
 * skip destination validation or to enable unattended publication. */
export function retainsRolloutForCadenceEdit(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  const cadence = patch.cadencePerWeek;
  if (typeof cadence !== "number" || !Number.isInteger(cadence) ||
      cadence < 1 || cadence > 21 || cadence === site.cadencePerWeek ||
      typeof site.cadencePerWeek !== "number" || site.cadencePerWeek <= 0 ||
      site.autopilotEnabled !== true ||
      !["warm", "live"].includes(String(site.autopilotRolloutMode)) ||
      site.deletionStatus !== undefined || site.planParkedAt !== undefined ||
      site.accountDeletionRequestedAt !== undefined) return false;
  return Object.entries(patch).every(([key, value]) => {
    if (key === "updatedAt" || key === "cadencePerWeek") return true;
    if (key === "cadenceRequestedPerWeek") return value === cadence;
    return value === site[key];
  });
}
