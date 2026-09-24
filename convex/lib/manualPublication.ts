/** Match the publisher's pre-write authorization in customer-facing controls.
 * This is not approval and never authorizes an external write itself. */
/** Destinations where one exact, owner-approved article can be published
 * without activating an automatic schedule: GitHub, and the conditional
 * WordPress publisher on the growth-first service. */
export function ownerApprovalDestination(site: { publishMethod?: string; serviceMode?: string }) {
  return site.publishMethod === "github" || (site.publishMethod === "wordpress" && site.serviceMode === "growth_first");
}

export function manualPublicationBlocker(site: { publishMethod?: string; serviceMode?: string; autopilotEnabled?: boolean; autopilotRolloutMode?: string } | null | undefined) {
  if (!site) return "Loading publishing readiness.";
  // Owner-approval destinations support exact, authenticated approval separately
  // from activating an autonomous schedule. The backend must seal approval.
  if (ownerApprovalDestination(site)) return null;
  return !site.autopilotEnabled || site.autopilotRolloutMode !== "live"
    ? "Publishing is not active for this website. Open Settings to check preparation and activation. Your approved article is retained."
    : null;
}

type OwnerApproval = { userId: string; artifactHash: string; configHash: string; rolloutEpoch: number; requestedAt: number };
export function ownerPublicationAuthorized(
  site: { userId?: string; publishMethod?: string; serviceMode?: string; autopilotRolloutEpoch?: number },
  article: { status: string; auditedContentHash?: string; publicationConfigHash?: string; publicationOwnerApproval?: OwnerApproval },
) {
  const approval = article.publicationOwnerApproval;
  return Boolean(approval && ownerApprovalDestination(site) && site.userId === approval.userId &&
    ["ready", "published"].includes(article.status) && Number.isSafeInteger(approval.requestedAt) && approval.requestedAt > 0 &&
    approval.artifactHash === article.auditedContentHash && approval.configHash === article.publicationConfigHash &&
    approval.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0));
}
