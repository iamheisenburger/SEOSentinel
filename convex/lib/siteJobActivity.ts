import type { Doc } from "../_generated/dataModel";

export const SITE_ACTIVITY_RECENT_LIMIT = 8;
export const SITE_ACTIVITY_STATUS_LIMIT = 50;
const JOB_TYPES = ["onboarding", "plan", "article", "links", "scheduler"] as const;
const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;

/** No inputs, free-form progress/errors, results or worker capabilities. */
export function siteActivityJob(job: Doc<"jobs">) {
  return {
    _id: job._id,
    type: JOB_TYPES.find(type => type === job.type) ?? "unknown",
    status: JOB_STATUSES.find(status => status === job.status) ?? "unknown",
    createdAt: Number.isFinite(job.createdAt) ? job.createdAt : undefined,
    updatedAt: Number.isFinite(job.updatedAt) ? job.updatedAt : undefined,
  };
}

export type SiteActivityCount = { status: "complete"; count: number } |
  { status: "truncated"; lowerBound: number };

export function siteActivityCount(rows: readonly unknown[]): SiteActivityCount {
  return rows.length <= SITE_ACTIVITY_STATUS_LIMIT
    ? { status: "complete", count: rows.length }
    : { status: "truncated", lowerBound: rows.length };
}

export type SiteJobActivity = {
  siteId: string;
  observedAt: number;
  recent: { status: "complete" | "truncated"; jobs: ReturnType<typeof siteActivityJob>[] };
  running: SiteActivityCount;
  pending: SiteActivityCount;
};
