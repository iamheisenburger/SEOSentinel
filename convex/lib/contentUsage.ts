/** P98, owner decision (Oct 19 2026): a customer's monthly article allowance
 * counts delivered articles, not attempts. A content job that ended without
 * delivering anything (held back by review, rejected before drafting, failed
 * or declined) gives its article back; work still in progress keeps its
 * place so concurrent starts stay bounded, and a job whose publication was
 * attempted keeps counting (its external write may have happened). Every AI
 * spending cap is unchanged: spend is what bounds repeated attempts.
 * Owner sites since Oct 5: 83 of 91 drafts were held back, so a free account
 * could use its three articles without receiving one. */
export function contentJobUsesAllowance(job: {
  status?: string;
  publicationAttempts?: number;
  contentWork?: { stage?: string; failure?: string; publishedAt?: number; verifiedAt?: number } | null;
}): boolean {
  const cw = job.contentWork;
  if (!cw) return true;
  const ended = job.status === "failed" || cw.stage === "failed";
  if (!ended) return true;
  // An owner's edit retires the draft it replaces; the article lives on in the edit.
  if (cw.failure === "owner_edited_draft") return true;
  return Boolean(cw.publishedAt || cw.verifiedAt || (job.publicationAttempts ?? 0) > 0);
}
