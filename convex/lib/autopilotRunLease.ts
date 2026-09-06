import type { Doc } from "../_generated/dataModel";

// One Node action has a ten-minute ceiling. An acknowledged, durable handoff
// gets its own action window; neither a job heartbeat nor a live lease does.
export const ORDINARY_RUN_INTERRUPTION_GRACE_MS = 12 * 60 * 1000;

export function ordinaryArticleReviewInterruptionDeadline(
  run: Pick<Doc<"autopilot_runs">, "siteId" | "jobId" | "articleId" | "startedAt" | "claimNonce">,
  job: Doc<"jobs"> | null,
  observedAt: number,
): number | null {
  const payload = job?.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown> : {};
  const handoffAt = payload.reviewCheckpointScheduledAt;
  if (
    run.claimNonce !== undefined || !run.jobId || !run.articleId ||
    !job || job._id !== run.jobId || job.siteId !== run.siteId ||
    job.type !== "article" || job.articleId !== run.articleId ||
    payload.articleId !== run.articleId || payload.reviewCheckpointVersion !== 1 ||
    !Number.isSafeInteger(run.startedAt) || (run.startedAt ?? 0) <= 0 ||
    typeof handoffAt !== "number" || !Number.isSafeInteger(handoffAt) ||
    handoffAt < run.startedAt! || handoffAt > observedAt
  ) return null;
  const deadline = handoffAt + ORDINARY_RUN_INTERRUPTION_GRACE_MS;
  return Number.isSafeInteger(deadline) ? deadline : null;
}
