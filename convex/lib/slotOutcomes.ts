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

/** P230 (Oct 27 2026): why each missed slot was missed, as counts by the last attempt's outcome (its failure code, or
 * the stage it stopped at: "ready" was written and never published). V4 sat at 16 of 17 with the one miss on a
 * customer's site and no way to tell why. Counts only, never a site. Pure. */
export function missedSlotCauses(jobs: Array<{ deadlineAt: number; publishedAt?: number; createdAt?: number; failure?: string; stage?: string }>,
  now: number, graceMs: number) {
  const slots = new Map<number, typeof jobs>();
  for (const job of jobs) if (job.deadlineAt <= now - graceMs) slots.set(job.deadlineAt, [...(slots.get(job.deadlineAt) ?? []), job]);
  const causes: Record<string, number> = {};
  for (const attempts of slots.values()) {
    if (attempts.some(job => typeof job.publishedAt === "number")) continue;
    const last = [...attempts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    const cause = last.failure ?? last.stage ?? "unknown";
    causes[cause] = (causes[cause] ?? 0) + 1;
  }
  return causes;
}
