/**
 * Rule 2a, the Autopilot editor policy (owner decision, Oct 19 2026).
 *
 * On a site that chose Autopilot and consented to automatic publication, a
 * Pentra-written article is never cut sentence by sentence (those deletions
 * left the numbering gaps, "three X" lists with two items and stranded
 * references that went live), and the reviewers' scores are notes, never a
 * veto. What blocks is objective (readerVisibleIssues and the strict gate's
 * safety, rendering, length and evidence-for-numbers checks). Fact-check
 * findings a source or the confirmed profile can settle get one bounded
 * rewrite that corrects them; they never block on their own.
 */
export function autopilotPublicationConsented(site: {
  serviceMode?: string; autopilotEnabled?: boolean; approvalRequired?: boolean;
  contentSchedule?: { ownerReviewedOnly?: boolean; autopilotSelectedAt?: number; autopublishConsentAt?: number } | null;
} | null | undefined): boolean {
  return Boolean(site && site.serviceMode === "growth_first" && site.autopilotEnabled && !site.approvalRequired &&
    site.contentSchedule && !site.contentSchedule.ownerReviewedOnly && site.contentSchedule.autopilotSelectedAt &&
    site.contentSchedule.autopublishConsentAt);
}

/** Fact-check findings a preserved source or the confirmed profile can
 * settle: the sentence cites a source, states a number, or names the product.
 * A general statement without any of these is advice or opinion under rule 2a. */
export function checkableFactCheckFindings(findings: readonly string[], productName: string): string[] {
  const product = productName.trim();
  const named = product.length >= 2
    ? new RegExp(`\\b${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    : null;
  return [...new Set(findings.map((finding) => finding.trim()).filter(Boolean))].filter((finding) =>
    /\[\d+(?:\s*,\s*\d+)*\]/.test(finding) || /\d/.test(finding.replace(/https?:\/\/\S+/g, " ")) || (named?.test(finding) ?? false));
}

/** Gate message that sends a first review with checkable findings through
 * its one bounded rewrite. Never waivable; it is only raised on a first review. */
export function autopilotEditPassIssue(count: number): string {
  return `Autopilot edit pass: ${count} fact-check finding(s) to verify against the sources and the business profile.`;
}

/** The rewrite instruction for one checkable finding. */
export function autopilotVerificationNote(sentence: string): string {
  return `Verify against the preserved sources and the business profile: «${sentence.replace(/[«»]/g, "")}». ` +
    "If a source or the profile contradicts it, correct it to match. If it states a specific number or fact nothing supports, " +
    "rewrite it without that specific. Otherwise keep it as it is. Keep the paragraph, list or step it belongs to complete.";
}
