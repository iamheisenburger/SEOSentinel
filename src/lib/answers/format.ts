/** Pentra Answers: how recorded data is written on screen. Timestamps are UTC as recorded; counts always carry
 * their denominator; nothing is rounded into a percentage or a score. Pure, so tests and the harness share it. */
import { ASSISTANTS, type AssistantId } from "../product-facts.ts";
import type { IndexNow, PageStatus } from "./types.ts";
import type { PillKind } from "../../components/ui/status-pill.tsx";

export function isAssistantId(value: string): value is AssistantId {
  return ASSISTANTS.some((assistant) => assistant.id === value);
}

/** Answers from an assistant Pentra no longer asks are still shown, under their raw id. */
export function assistantLabel(value: string): string {
  return ASSISTANTS.find((assistant) => assistant.id === value)?.name ?? value;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-07 14:32 UTC", the stamp every recorded answer carries. */
export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 7" (UTC), for axis ticks and short labels. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Nov 7, 14:32 UTC". */
export function shortStamp(ms: number): string {
  const d = new Date(ms);
  return `${shortDate(ms)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "just now", "12 min ago", "3h ago", "2 days ago", then the date. */
export function timeAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return shortDate(ms);
}

/** "in 4h", "in 2 days" (for the next scheduled measurement). */
export function timeUntil(ms: number, now: number): string {
  const diff = Math.max(0, ms - now);
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "within the hour";
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)} days`;
}

/** Elapsed time, honestly: "48s", "6m 12s", "1h 04m". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const num = (n: number) => n.toLocaleString("en-US");

/** "A, B and C". */
export function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const COUNTRIES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", IN: "India",
  BR: "Brazil", JP: "Japan", ES: "Spain", IT: "Italy", NL: "Netherlands", SE: "Sweden", SG: "Singapore", AE: "United Arab Emirates",
  MX: "Mexico", IE: "Ireland", NZ: "New Zealand", ZA: "South Africa",
};

/** The countries the backend's country codes cover (convex/lib/aiAnswers.ts countryCode). */
export const COUNTRY_OPTIONS: readonly { code: string; name: string }[] = Object.entries(COUNTRIES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => (a.code === "US" ? -1 : b.code === "US" ? 1 : a.name.localeCompare(b.name)));

export function countryName(code: string | null | undefined): string {
  if (!code) return "Not set";
  return COUNTRIES[code.toUpperCase()] ?? code.toUpperCase();
}

const INTENTS: Record<string, string> = {
  recommendation: "Recommendation",
  how_to: "How to",
  comparison: "Comparison",
  cost: "Cost",
  problem: "Problem",
  local: "Local",
};
export const intentLabel = (intent: string) => INTENTS[intent] ?? intent.replace(/_/g, " ");

export function hostOf(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
}

/** A published URL without its protocol, for display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export const PAGE_STATUS: Record<PageStatus, { label: string; pill: PillKind }> = {
  writing: { label: "Writing", pill: "indexing" },
  draft: { label: "Draft", pill: "draft" },
  not_written: { label: "Not written", pill: "none" },
  publishing: { label: "Publishing", pill: "indexing" },
  published: { label: "Published", pill: "published" },
  publish_failed: { label: "Publish failed", pill: "failed" },
  retired: { label: "Replaced by a rewrite", pill: "neutral" },
};

export function pageStatus(status: string): { label: string; pill: PillKind } {
  return PAGE_STATUS[status as PageStatus] ?? { label: status, pill: "neutral" };
}

export type IndexingState = { label: string; detail: string; pill: PillKind };

/**
 * What happened after publishing, stated from the page's own record: checked live, then sent to IndexNow and
 * Google's sitemap (convex/actions/answerPublish.ts verifyAndIndex). Nothing here claims the page is in a search index.
 */
export function indexingState(page: { status: string; publishedUrl: string | null; indexNow: IndexNow | null; issues: string[];
  googleSitemapAt?: number | null; publishedAt?: number | null }, now?: number): IndexingState | null {
  if (page.status !== "published" || !page.publishedUrl) return null;
  const notLive = page.issues.find((issue) => issue.startsWith("Not live yet"));
  if (notLive) return { label: "Not live yet", detail: notLive, pill: "failed" };
  const status = page.indexNow?.status ?? null;
  const sitemap = page.googleSitemapAt ? ` Sitemap sent to Google ${shortDate(page.googleSitemapAt)}.` : "";
  if (status === "submitted") return { label: "Submitted", detail: `Live, and sent to IndexNow ${shortDate(page.indexNow!.at)}.${sitemap}`, pill: "published" };
  if (status === "key_committed") return { label: "Key placed", detail: `Live. Pentra added its IndexNow key to your site; the next page is submitted with it.${sitemap}`, pill: "neutral" };
  if (status === "key_not_placed") return { label: "Live", detail: `Live. Pentra couldn't add its IndexNow key to your repository, so this page relies on Google and your sitemap.${sitemap}`, pill: "neutral" };
  if (status === "unreachable") return { label: "Live", detail: `Live. IndexNow didn't respond, so this page relies on Google and your sitemap.${sitemap}`, pill: "neutral" };
  if (status && status.startsWith("refused_")) return { label: "Live", detail: `Live. IndexNow refused the submission (${status.slice(8)}).${sitemap}`, pill: "neutral" };
  if (page.googleSitemapAt) return { label: "Live", detail: sitemap.trim(), pill: "published" };
  // Pentra checks a page for about two hours after publishing; with no "not live" note after that, it went live.
  if (now !== undefined && page.publishedAt && now - page.publishedAt > 2.5 * 3_600_000) {
    return { label: "Live", detail: "Live. Search engines find it through your site's sitemap; with Search Console connected, Pentra also sends the sitemap to Google.", pill: "neutral" };
  }
  return { label: "Checking", detail: "Pentra is checking the page is live before it tells search engines. Sites that rebuild can take a few minutes.", pill: "indexing" };
}

export function hostedStatusLabel(status: string | undefined): { label: string; pill: PillKind } {
  if (status === "live") return { label: "Live", pill: "published" };
  if (status === "error") return { label: "Needs attention", pill: "failed" };
  return { label: "Waiting for DNS", pill: "indexing" };
}

/** The publishing methods of the site's own connection, as the legacy Settings section names them. */
export const PUBLISH_METHOD_LABELS: Record<string, string> = {
  github: "GitHub",
  wordpress: "WordPress",
  webflow: "Webflow",
  shopify: "Shopify",
  ghost: "Ghost",
  webhook: "Signed webhook",
  manual: "Not connected",
};
