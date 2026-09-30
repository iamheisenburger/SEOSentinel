/** Autopilot refresh of Pentra's own older articles that sit on Google's
 * page 2 (the owner's decision, Sep 30 2026): a refresh counts as an article
 * slot, but
 * - at most one of every four automatic slots is a refresh, so paying
 *   customers keep getting mostly new articles;
 * - only an article live for at least 28 days qualifies;
 * - only when Search Console shows a real search it already appears for at
 *   average position 8–30 with at least 10 impressions in the last 28 days;
 * - the same article is refreshed at most once every 60 days.
 * When nothing qualifies, the slot is an ordinary new article. Pure. */

export const REFRESH_MIN_AGE_MS = 28 * 86_400_000;
export const REFRESH_COOLDOWN_MS = 60 * 86_400_000;
export const REFRESH_MIN_IMPRESSIONS = 10;
export const REFRESH_MIN_POSITION = 8;
export const REFRESH_MAX_POSITION = 30;
/** One refresh in every REFRESH_SLOT_SPACING consecutive automatic slots. */
export const REFRESH_SLOT_SPACING = 4;
export const REFRESH_WINDOW_DAYS = 28;
/** A refresh candidate that did not qualify is looked at again the next day. */
export const REFRESH_REVIEW_MS = 86_400_000;

export type RefreshQueryRow = {
  page?: string;
  query: string;
  impressions: number;
  position?: number;
};

export type RefreshOpportunity = {
  query: string;
  impressions: number;
  position: number;
};

/** Impression-weighted average position per search, for one page. */
export function refreshOpportunities(rows: RefreshQueryRow[], pageUrl: string): RefreshOpportunity[] {
  const byQuery = new Map<string, { impressions: number; weighted: number }>();
  for (const row of rows) {
    if (row.page !== pageUrl || !(row.impressions > 0) || typeof row.position !== "number") continue;
    const query = row.query.trim().toLowerCase();
    if (!query) continue;
    const entry = byQuery.get(query) ?? { impressions: 0, weighted: 0 };
    entry.impressions += row.impressions;
    entry.weighted += row.position * row.impressions;
    byQuery.set(query, entry);
  }
  return [...byQuery.entries()]
    .map(([query, entry]) => ({ query, impressions: entry.impressions, position: entry.weighted / entry.impressions }))
    .filter((entry) => entry.impressions >= REFRESH_MIN_IMPRESSIONS &&
      entry.position >= REFRESH_MIN_POSITION && entry.position <= REFRESH_MAX_POSITION)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position || a.query.localeCompare(b.query));
}

export type RefreshSlotJob = {
  contentWork?: {
    intent?: string;
    deadlineAt?: number;
    ownerRequest?: unknown;
    retiredAt?: number;
  };
};

/** True unless one of the previous three automatic slots was already a
 * refresh or improvement (so at most one in four). */
export function refreshSlotAvailable(jobs: RefreshSlotJob[]): boolean {
  const recent = jobs
    .filter((job) => job.contentWork && !job.contentWork.ownerRequest && job.contentWork.retiredAt === undefined &&
      Number.isFinite(job.contentWork.deadlineAt))
    .sort((a, b) => b.contentWork!.deadlineAt! - a.contentWork!.deadlineAt!)
    .slice(0, REFRESH_SLOT_SPACING - 1);
  return !recent.some((job) => job.contentWork!.intent === "improve");
}

export function refreshArticleOldEnough(publishedAt: number | undefined, now: number): boolean {
  return typeof publishedAt === "number" && Number.isFinite(publishedAt) && now - publishedAt >= REFRESH_MIN_AGE_MS;
}

/** A GitHub file is Pentra's own delivery of this article only when its
 * frontmatter says generator "pentra" and carries this article's exact
 * delivery key. Anything else belongs to the owner and is never adopted. */
export function pentraOwnedMarkdown(content: string, deliveryKey: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (!frontmatter) return false;
  const value = (key: string) => {
    const line = frontmatter.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));
    if (!line) return undefined;
    const raw = line.slice(key.length + 1).trim();
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return raw || undefined;
    }
  };
  return value("generator") === "pentra" && value("pentraDeliveryKey") === deliveryKey;
}

/** The last REFRESH_WINDOW_DAYS of Search Console receipts, by the site's
 * newest received date (never the oldest rows first). */
export function refreshWindowStart(receiptDates: string[]): string | undefined {
  const latest = [...receiptDates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
  if (!latest) return undefined;
  const start = new Date(`${latest}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (REFRESH_WINDOW_DAYS - 1));
  return start.toISOString().slice(0, 10);
}

/** Every commit Pentra makes to a customer repository carries one of these
 * messages (publisher.ts). */
const PENTRA_COMMIT_MESSAGE = /^Pentra (?:publish|revise|improve) pentra:\S+\s/;
/** How many commits of one file's history are read; a longer history is
 * treated as not Pentra's alone. */
export const REFRESH_HISTORY_LIMIT = 30;

/** True only when the file's history (newest first, from GitHub's commits API
 * filtered to the path) is complete within the limit and every commit is
 * Pentra's own delivery. One owner commit to the file, however small, means the
 * owner has edited it, and Autopilot never refreshes it. */
export function pentraOnlyFileHistory(commits: unknown): boolean {
  if (!Array.isArray(commits) || commits.length === 0 || commits.length >= REFRESH_HISTORY_LIMIT) return false;
  return commits.every((entry) => {
    const message = (entry as { commit?: { message?: unknown } } | null)?.commit?.message;
    return typeof message === "string" && PENTRA_COMMIT_MESSAGE.test(message);
  });
}

