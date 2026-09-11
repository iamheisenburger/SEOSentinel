import type { SiteActivityCount, SiteJobActivity } from "../../convex/lib/siteJobActivity.ts";

function lowerBound(count: SiteActivityCount) {
  return count.status === "complete" ? count.count : count.lowerBound;
}
function label(count: SiteActivityCount, kind: string) {
  return `${count.status === "complete" ? count.count : `≥${count.lowerBound}`} ${kind}`;
}

/** Convex responses are bound again at the view boundary. A retained response
 * from a previous selection is loading, never that site's activity or zero. */
export function dashboardActivityView(siteId: string | undefined, data: SiteJobActivity | undefined) {
  if (!siteId || !data || data.siteId !== siteId) {
    return { state: "loading" as const, label: siteId ? "Checking activity…" : "Select a site",
      detail: siteId ? "Loading this site's activity…" : "Select a site to view activity.",
      recent: undefined };
  }
  const running = lowerBound(data.running), pending = lowerBound(data.pending);
  const exactZero = data.running.status === "complete" && data.running.count === 0 &&
    data.pending.status === "complete" && data.pending.count === 0 &&
    !data.recent.jobs.some(job => job.status === "unknown");
  const state = running > 0 ? "running" as const : pending > 0 ? "queued" as const :
    exactZero ? "idle" as const : "unknown" as const;
  return { state, label: state === "idle" ? "Idle" : state === "unknown" ? "Activity count incomplete" : [
      ...(running > 0 ? [label(data.running, "running")] : []),
      ...(pending > 0 ? [label(data.pending, "queued")] : []),
    ].join(" · "),
    detail: `${label(data.running, "running")}; ${label(data.pending, "queued")}.`,
    recent: data.recent };
}
