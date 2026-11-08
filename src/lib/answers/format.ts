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

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n.toLocaleString("en-US")}${suffix}`;
}

/* Geist Sans advances at weight 500 with -0.03em tracking (the headline style), in em, measured in Chromium with the font
 * loaded. Anything else (an internationalised name) counts as wide. */
const ADVANCE: Record<string, number> = {
  a: 0.535, b: 0.569, c: 0.524, d: 0.569, e: 0.537, f: 0.348, g: 0.568, h: 0.552, i: 0.21, j: 0.239, k: 0.534, l: 0.243, m: 0.838,
  n: 0.544, o: 0.549, p: 0.569, q: 0.569, r: 0.332, s: 0.501, t: 0.371, u: 0.556, v: 0.53, w: 0.799, x: 0.539, y: 0.523, z: 0.518,
  "0": 0.645, "1": 0.34, "2": 0.6, "3": 0.595, "4": 0.599, "5": 0.611, "6": 0.606, "7": 0.519, "8": 0.595, "9": 0.608, ".": 0.183, "-": 0.388,
};

/**
 * How wide a domain set in the headline style is, in em, with a 5% margin: the headline sizes it to fit its column
 * whole (`calc(100cqi / em)`), so a long address never breaks mid-word.
 */
export function domainWidthEm(domain: string): number {
  let em = 0;
  for (const char of domain.toLowerCase()) em += ADVANCE[char] ?? 0.85;
  return Math.max(1, em * 1.05);
}

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
export const WAITING_FOR_PAGE = "Waiting for the page to appear on your site";

export function indexingState(page: { status: string; publishedUrl: string | null; indexNow: IndexNow | null; issues: string[];
  googleSitemapAt?: number | null; publishedAt?: number | null; liveAt?: number | null }, now?: number): IndexingState | null {
  if (page.status !== "published" || !page.publishedUrl) return null;
  const notLive = page.issues.find((issue) => issue.startsWith("Not live yet"));
  if (page.liveAt !== undefined) {
    // The backend says when it saw the page live: "Live" only then.
    if (page.liveAt === null) {
      const late = notLive || (now !== undefined && page.publishedAt && now - page.publishedAt > 2 * 3_600_000);
      return late
        ? { label: "Waiting", detail: notLive ? `${WAITING_FOR_PAGE}. ${notLive}` : `${WAITING_FOR_PAGE}. Sites that rebuild after a publish can take a while; Pentra keeps checking.`, pill: "failed" }
        : { label: "Checking", detail: "Pentra is checking the page is live before it tells search engines. Sites that rebuild can take a few minutes.", pill: "indexing" };
    }
    const told = page.indexNow?.status === "submitted" ? ` Sent to IndexNow ${shortDate(page.indexNow.at)}.` : "";
    const sitemap = page.googleSitemapAt ? ` Sitemap sent to Google ${shortDate(page.googleSitemapAt)}.` : "";
    return { label: "Live", detail: `Live since ${shortDate(page.liveAt)}.${told}${sitemap}`, pill: "published" };
  }
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
