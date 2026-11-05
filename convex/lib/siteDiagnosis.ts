/** Site diagnosis (Nov 5 2026): why a site gets the Google and AI-answer traffic it gets, from its own data, for ANY site.
 *
 * Traffic needs five things at once, and they multiply: searches the site can win, pages good enough to rank, enough
 * authority to compete, a reason to click once it ranks, and being named in AI answers. The diagnosis scores each one
 * from measured symptoms (never from the site's identity), names the evidence, and says what Pentra does about it. The
 * same function runs at onboarding (its first run) and every week after.
 *
 * Inputs are whatever is known: Search Console rows (empty for a new site or one that hasn't connected it), the site's
 * authority, the strength of the sites on its page one, its pages as crawled, and the AI-answer checks. A factor with no
 * data is "unknown", never guessed.
 */
import { isBrandedSearchQuery } from "./searchPerformance.ts";
import { organicCtrAtPosition } from "./expectedClickPortfolio.ts";

export type GscRow = { date: string; query: string; page?: string; clicks: number; impressions: number; position: number };
export type CrawledPage = { url: string; canonical?: string | null; images?: number; words?: number; loadMs?: number };
export type DiagnosisInput = {
  domain: string;
  gsc: readonly GscRow[];
  authority?: { domainRank: number; referringDomains?: number } | null;
  /** Median authority of the sites on page one for the site's main searches, when measured. */
  pageOneMedianRank?: number | null;
  pages?: readonly CrawledPage[];
  aiAnswers?: { asked: number; named: number } | null;
  /** Days of Search Console history to judge (default 28, ending at its newest date). */
  windowDays?: number;
};
export type Factor = "searches" | "pages" | "authority" | "clicks" | "ai";
export type FactorState = "ok" | "weak" | "failing" | "unknown";
export type Finding = { factor: Factor; severity: "high" | "medium" | "low"; problem: string; evidence: string; action: string; items?: string[] };
export type Diagnosis = {
  siteType: "new" | "struggling" | "strong";
  window: { from: string; to: string } | null;
  totals: { impressions: number; clicks: number; brandedClicks: number; pageOneImpressions: number; pageOneClicks: number; expectedPageOneClicks: number; beyondPageTwoShare: number };
  factors: Record<Factor, FactorState>;
  findings: Finding[];
};

/** Below this many non-branded impressions in the window, Google hasn't formed a view of the site yet: a new site. */
export const NEW_SITE_IMPRESSIONS = 200;
/** A site already earning this many non-branded clicks a week is doing well: the job is good to great. */
export const STRONG_WEEKLY_CLICKS = 25;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function diagnoseSite(input: DiagnosisInput): Diagnosis {
  const findings: Finding[] = [];
  const factors: Record<Factor, FactorState> = { searches: "unknown", pages: "unknown", authority: "unknown", clicks: "unknown", ai: "unknown" };
  const add = (f: Finding, state: FactorState) => {
    findings.push(f);
    const rank = { unknown: 0, ok: 1, weak: 2, failing: 3 } as const;
    if (rank[state] > rank[factors[f.factor]]) factors[f.factor] = state;
  };

  // ── The Search Console window ──
  const dates = [...new Set(input.gsc.map((r) => r.date))].sort();
  const to = dates.at(-1) ?? null;
  const days = input.windowDays ?? 28;
  const from = to ? new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10) : null;
  const rows = to && from ? input.gsc.filter((r) => r.date >= from && r.date <= to) : [];
  const branded = (q: string) => isBrandedSearchQuery(q, input.domain);
  const open = rows.filter((r) => !branded(r.query));
  const brandedClicks = rows.filter((r) => branded(r.query)).reduce((s, r) => s + r.clicks, 0);
  const sum = (rs: readonly GscRow[], k: "clicks" | "impressions") => rs.reduce((s, r) => s + r[k], 0);
  const impressions = sum(open, "impressions"), clicks = sum(open, "clicks");

  // Per search: impressions, clicks and impression-weighted position over the window.
  type Agg = { impressions: number; clicks: number; weighted: number; pages: Map<string, number> };
  const byQuery = new Map<string, Agg>();
  const byPage = new Map<string, Agg>();
  for (const r of open) {
    const q = byQuery.get(r.query) ?? { impressions: 0, clicks: 0, weighted: 0, pages: new Map() };
    q.impressions += r.impressions; q.clicks += r.clicks; q.weighted += r.position * r.impressions;
    if (r.page) q.pages.set(r.page, (q.pages.get(r.page) ?? 0) + r.impressions);
    byQuery.set(r.query, q);
    if (r.page) {
      const p = byPage.get(r.page) ?? { impressions: 0, clicks: 0, weighted: 0, pages: new Map() };
      p.impressions += r.impressions; p.clicks += r.clicks; p.weighted += r.position * r.impressions;
      byPage.set(r.page, p);
    }
  }
  const position = (a: Agg) => (a.impressions ? a.weighted / a.impressions : 0);
  const queries = [...byQuery].map(([query, a]) => ({ query, ...a, position: position(a) })).sort((a, b) => b.impressions - a.impressions);
  const pageOne = queries.filter((q) => q.position <= 10);
  const pageOneImpressions = pageOne.reduce((s, q) => s + q.impressions, 0);
  const pageOneClicks = pageOne.reduce((s, q) => s + q.clicks, 0);
  const expectedPageOneClicks = pageOne.reduce((s, q) => s + q.impressions * organicCtrAtPosition(q.position), 0);
  const beyond = queries.filter((q) => q.position > 20).reduce((s, q) => s + q.impressions, 0);
  const beyondPageTwoShare = impressions ? beyond / impressions : 0;
  const weeklyClicks = clicks / (days / 7);
  const siteType: Diagnosis["siteType"] = impressions < NEW_SITE_IMPRESSIONS ? "new" : weeklyClicks >= STRONG_WEEKLY_CLICKS ? "strong" : "struggling";

  if (!input.gsc.length) {
    add({ factor: "searches", severity: "medium", problem: "Search Console isn't connected", evidence: "No data on what Google already shows the site for",
      action: "Ask the owner to connect it; meanwhile choose searches from the real page one and the site's authority" }, "unknown");
  } else if (siteType === "new") {
    add({ factor: "searches", severity: "medium", problem: "Google barely shows the site yet", evidence: `${impressions} non-branded impressions in ${days} days`,
      action: "Only very easy searches, built into one topic cluster at a time, while links build authority" }, "weak");
  } else {
    // 1. Searches it can't win: most of what Google shows it for is beyond page two, where nobody looks.
    if (beyondPageTwoShare >= 0.4) {
      add({ factor: "searches", severity: beyondPageTwoShare >= 0.6 ? "high" : "medium", problem: "It writes for searches it can't win",
        evidence: `${pct(beyondPageTwoShare)} of its non-branded impressions are past page 2`,
        action: "Choose only searches whose page one it can reach at its authority; stop new articles on these",
        items: queries.filter((q) => q.position > 20).slice(0, 8).map((q) => `${q.query} (position ${r1(q.position)}, ${q.impressions} impressions)`) },
        beyondPageTwoShare >= 0.6 ? "failing" : "weak");
    } else factors.searches = "ok";

    // 4. Clicks: it ranks on page one but people don't click (wrong readers, or titles that don't earn the click).
    if (pageOneImpressions >= 100) {
      const ratio = expectedPageOneClicks ? pageOneClicks / expectedPageOneClicks : 1;
      if (ratio < 0.5) {
        add({ factor: "clicks", severity: ratio < 0.25 ? "high" : "medium", problem: "It ranks on page one, but almost nobody clicks",
          evidence: `${pageOneClicks} clicks from ${pageOneImpressions} page-one impressions (about ${Math.round(expectedPageOneClicks)} expected at those positions)`,
          action: "Check whether those searchers could buy; rewrite titles and descriptions that don't earn the click; stop writing for readers who won't buy",
          items: pageOne.filter((q) => q.clicks === 0).slice(0, 8).map((q) => `${q.query} (position ${r1(q.position)}, ${q.impressions} impressions, 0 clicks)`) },
          ratio < 0.25 ? "failing" : "weak");
      } else factors.clicks = "ok";
    }

    // 2. Pages: several pages competing for one search, and pages just off page one.
    const competing = queries.filter((q) => [...q.pages.values()].filter((n) => n >= 10).length >= 2);
    if (competing.length) {
      add({ factor: "pages", severity: competing.length >= 5 ? "high" : "medium", problem: "Its own pages compete for the same searches",
        evidence: `${competing.length} searches show two or more of its pages`, action: "Merge each set into one page, with a permanent redirect from the others",
        items: competing.slice(0, 8).map((q) => `${q.query}: ${[...q.pages.keys()].slice(0, 3).map((p) => p.replace(/^https?:\/\/[^/]+/, "")).join(", ")}`) },
        competing.length >= 5 ? "failing" : "weak");
    }
    const nearPageOne = [...byPage].map(([page, a]) => ({ page, ...a, position: position(a) })).filter((p) => p.position > 10 && p.position <= 20 && p.impressions >= 50)
      .sort((a, b) => b.impressions - a.impressions);
    if (nearPageOne.length) {
      add({ factor: "pages", severity: "low", problem: "Pages close to page one", evidence: `${nearPageOne.length} pages sit at positions 11 to 20`,
        action: "Improve these first: a page at position 12 can reach page one, a new page on a weak site usually can't",
        items: nearPageOne.slice(0, 8).map((p) => `${p.page.replace(/^https?:\/\/[^/]+/, "")} (position ${r1(p.position)}, ${p.impressions} impressions)`) }, factors.pages === "unknown" ? "ok" : factors.pages);
    }
  }

  // 2. Pages, as crawled: pages that point Google elsewhere, pages without images, slow pages.
  if (input.pages?.length) {
    const moved = input.pages.filter((p) => p.canonical && normalize(p.canonical) !== normalize(p.url));
    if (moved.length) add({ factor: "pages", severity: "high", problem: "Pages point Google to a different page",
      evidence: `${moved.length} of ${input.pages.length} pages checked name another page as the real one`, action: "Keep addresses stable; a moved page gets a permanent redirect, never a copy",
      items: moved.slice(0, 8).map((p) => `${p.url.replace(/^https?:\/\/[^/]+/, "")} → ${String(p.canonical).replace(/^https?:\/\/[^/]+/, "")}`) }, "failing");
    const bare = input.pages.filter((p) => p.images === 0);
    if (bare.length) add({ factor: "pages", severity: bare.length / input.pages.length >= 0.5 ? "medium" : "low", problem: "Pages without images",
      evidence: `${bare.length} of ${input.pages.length} pages checked have no images`, action: "Every article gets real images: screenshots, diagrams, photos" }, "weak");
    const slow = input.pages.filter((p) => (p.loadMs ?? 0) > 2000);
    if (slow.length) add({ factor: "pages", severity: "medium", problem: "Slow pages", evidence: `${slow.length} of ${input.pages.length} pages took over 2 seconds to load`,
      action: "Serve articles as static, cached pages" }, "weak");
    if (factors.pages === "unknown") factors.pages = "ok";
  }

  // 3. Authority: nobody links to the site, or page one belongs to far stronger sites.
  if (input.authority) {
    const { domainRank, referringDomains } = input.authority;
    const gap = input.pageOneMedianRank != null ? input.pageOneMedianRank - domainRank : null;
    const evidence = `Domain rank ${domainRank} of 100${referringDomains != null ? `, ${referringDomains} sites link to it` : ""}${gap != null ? `; page one's median is ${input.pageOneMedianRank}` : ""}`;
    if (domainRank < 10 || (gap != null && gap >= 30)) add({ factor: "authority", severity: "high", problem: "Too little authority to compete", evidence,
      action: "Earn links every week (sites linking to competitors, lists that leave it out, mentions without a link); until then, only searches where page one has weak sites" }, "failing");
    else if (domainRank < 25 || (gap != null && gap >= 15)) add({ factor: "authority", severity: "medium", problem: "Low authority", evidence, action: "Earn links every week" }, "weak");
    else factors.authority = "ok";
  } else add({ factor: "authority", severity: "medium", problem: "Authority not measured", evidence: "No backlink data yet", action: "Measure it before choosing searches" }, "unknown");

  // 5. AI answers: are the AI assistants naming the business when buyers ask?
  if (input.aiAnswers && input.aiAnswers.asked > 0) {
    const share = input.aiAnswers.named / input.aiAnswers.asked;
    if (share < 0.2) add({ factor: "ai", severity: share === 0 ? "high" : "medium", problem: "AI assistants don't name it",
      evidence: `Named in ${input.aiAnswers.named} of ${input.aiAnswers.asked} buyer questions`, action: "Get listed on the pages the assistants cite; publish pages that answer those questions" }, share === 0 ? "failing" : "weak");
    else factors.ai = "ok";
  } else add({ factor: "ai", severity: "medium", problem: "AI answers not measured", evidence: "Nobody has asked the AI assistants the buyer questions yet",
    action: "Ask ChatGPT, Gemini and Google AI Mode the buyer questions every week" }, "unknown");

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { siteType, window: from && to ? { from, to } : null,
    totals: { impressions, clicks, brandedClicks, pageOneImpressions, pageOneClicks, expectedPageOneClicks: Math.round(expectedPageOneClicks), beyondPageTwoShare: Math.round(beyondPageTwoShare * 100) / 100 },
    factors, findings };
}

function normalize(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}
