import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_PUBLICATION_ATTEMPTS } from "./publicationLease.ts";
import { isSealedReady } from "./autopilotBuffer.ts";
import { takeCurrentDomainArticleSummariesByStatus } from "./siteDomainBinding.ts";

export const PUBLICATION_HISTORY_LIMIT = 100;
// Highest supported target is 12. Keep 25 usable rows (the existing projection
// allowance), inspecting up to 50 oldest candidates to step over closed work.
export const PUBLICATION_BUFFER_READ_LIMIT = 25;
export const PUBLICATION_BUFFER_CANDIDATE_LIMIT = 50;
export const PUBLICATION_BUFFER_HISTORY_ROW_BUDGET = 128;
export type PublicationDeliveryBlocker = {
  reason: "publication_deferral_terminal" | "publication_attempts_exhausted" |
    "publication_history_incomplete" | "publication_history_binding_mismatch" |
    "publication_buffer_scan_incomplete";
  jobId?: Id<"jobs">;
};

/** The job receipt, not a fresh queue row, owns the retry ceiling. Historical
 * failed deliveries have an article ID but may lack an immutable hash receipt.
 * Such an exhausted article stays closed: a changed timestamp/configuration
 * is not proof of new reviewed work. A distinct article has distinct history. */
export async function publicationDeliveryBlocker(
  ctx: Pick<QueryCtx, "db">,
  siteId: Id<"sites">,
  article: Pick<Doc<"articles">, "_id" | "siteId" | "auditedContentHash" | "publicationConfigHash">,
  budget?: { remainingRows: number },
): Promise<PublicationDeliveryBlocker | undefined> {
  if (article.siteId !== siteId) return { reason: "publication_history_binding_mismatch" };
  // One sentinel beyond the remaining budget distinguishes zero history from
  // incomplete history. It permits a later clean artifact even after an earlier
  // artifact saturates the pass, without reading another hundred-job payload.
  const limit = Math.min(PUBLICATION_HISTORY_LIMIT + 1, (budget?.remainingRows ?? PUBLICATION_HISTORY_LIMIT) + 1);
  const jobs = await ctx.db.query("jobs")
    .withIndex("by_site_article", q => q.eq("siteId", siteId).eq("articleId", article._id).eq("status", "failed"))
    .take(limit);
  if (budget) budget.remainingRows = Math.max(0, budget.remainingRows - jobs.length);
  if (jobs.length > PUBLICATION_HISTORY_LIMIT) return { reason: "publication_history_incomplete" };
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    if (payload.articleId !== undefined && payload.articleId !== article._id) {
      return { reason: "publication_history_binding_mismatch", jobId: job._id };
    }
    if ((job.publicationAttempts ?? 0) >= MAX_PUBLICATION_ATTEMPTS) {
      return { reason: "publication_attempts_exhausted", jobId: job._id };
    }
    if (job.publicationDeferral?.boundary.contentHash === article.auditedContentHash &&
      job.publicationDeferral?.boundary.configHash === article.publicationConfigHash) {
      return { reason: "publication_deferral_terminal", jobId: job._id };
    }
  }
  if (jobs.length === limit) return { reason: "publication_history_incomplete" };
}

export type PublicationBufferSummary = Doc<"article_summaries"> & {
  publicationDeliveryBlocker?: PublicationDeliveryBlocker;
};

export async function readPublicationBufferSummaries(ctx: Pick<QueryCtx, "db">, site: Doc<"sites">) {
  const rows = await takeCurrentDomainArticleSummariesByStatus(ctx, site, "ready", PUBLICATION_BUFFER_CANDIDATE_LIMIT + 1, "asc");
  return publicationBufferSummaries(ctx, site._id, rows);
}

/** Read-only projection. At most 50 exact-site/article/failed index reads,
 * 128 history rows plus at most one overflow sentinel per candidate (normal
 * ready buffer: zero failed jobs). No scans,
 * pagination loop, cross-site article-ID fallback, or article-body reads. A
 * saturated history closes only its artifact, never the next valid candidate. */
export async function publicationBufferSummaries(
  ctx: Pick<QueryCtx, "db">, siteId: Id<"sites">, rows: Doc<"article_summaries">[],
): Promise<PublicationBufferSummary[]> {
  const result: PublicationBufferSummary[] = [];
  const budget = { remainingRows: PUBLICATION_BUFFER_HISTORY_ROW_BUDGET };
  let usable = 0;
  for (const [index, row] of rows.entries()) {
    if (usable >= PUBLICATION_BUFFER_READ_LIMIT) break;
    if (index >= PUBLICATION_BUFFER_CANDIDATE_LIMIT) {
      result.push({ ...row, publicationDeliveryBlocker: { reason: "publication_buffer_scan_incomplete" } });
      break;
    }
    if (!isSealedReady(row)) { result.push(row); continue; }
    const blocker = await publicationDeliveryBlocker(ctx, siteId, { ...row, _id: row.articleId }, budget);
    result.push(blocker ? { ...row, publicationDeliveryBlocker: blocker } : row);
    if (!blocker) usable++;
  }
  return result;
}
