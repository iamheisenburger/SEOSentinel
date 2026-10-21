/** One automatic slot's outcome: published within the grace hour of its
 * deadline, published later, or not published at all. A slot is its
 * deadline: a replacement article for a failed one counts once, by the best
 * outcome of the jobs that held that deadline. Pure. */
export function slotOutcomes(jobs: Array<{ deadlineAt: number; publishedAt?: number }>, now: number, graceMs: number) {
  const best = new Map<number, "on_time" | "late" | "missed">();
  const rank = { missed: 0, late: 1, on_time: 2 } as const;
  for (const job of jobs) {
    if (job.deadlineAt > now - graceMs) continue; // not due yet (or still inside its grace hour)
    const outcome = typeof job.publishedAt !== "number" ? "missed" as const
      : job.publishedAt <= job.deadlineAt + graceMs ? "on_time" as const : "late" as const;
    const previous = best.get(job.deadlineAt);
    if (!previous || rank[outcome] > rank[previous]) best.set(job.deadlineAt, outcome);
  }
  const counts = { due: best.size, onTime: 0, late: 0, missed: 0 };
  for (const outcome of best.values()) counts[outcome === "on_time" ? "onTime" : outcome] += 1;
  return counts;
}
