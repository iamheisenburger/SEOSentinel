/** Site diagnosis (Nov 5 2026): why a site gets the Google and AI-answer traffic it gets, from its own data, for ANY site.
 *
 * Traffic needs five things at once, and they multiply: searches the site can win, pages good enough to rank, enough
 * authority to compete, a reason to click once it ranks, and being named in AI answers. The diagnosis scores each one
 * from measured symptoms (never from the site's identity), names the evidence, says what Pentra does about it, and lists
 * the actions page by page. The same function runs at onboarding (its first run) and every week after.
 *
 * Inputs are whatever is known: Search Console rows (empty for a new site or one that hasn't connected it), the site's
 * authority, the strength of the sites on its page one, its pages as crawled (redirects recorded, never followed),
 * Google's index verdict per page, what each search's reader is after, and the AI-answer checks. A factor with no data is
 * "unknown", never guessed.
 */
import { isBrandedSearchQuery } from "./searchPerformance.ts";
import { organicCtrAtPosition } from "./expectedClickPortfolio.ts";
import { duplicatePairs, planMerges, type Merge, type PageSearches } from "./duplicatePages.ts";

export type GscRow = { date: string; query: string; page?: string; clicks: number; impressions: number; position: number };
export type CrawledPage = {
  url: string;
  /** The address's own HTTP status (redirects are recorded, not followed). */
  status?: number;
  /** Where a redirect sends it (absolute URL), for a 3xx status. */
  location?: string | null;
  canonical?: string | null;
  title?: string | null;
  /** Whether it has a meta description, and how many main headings (H1) it has. */
  description?: boolean;
  h1?: number;
  words?: number;
  images?: number;
  /** The addresses on the same site it links to (normalized). */
  links?: string[];
  noindex?: boolean;
  structuredData?: boolean;
  loadMs?: number;
  /** A page Pentra published (an article), as opposed to the site's own pages. */
  article?: boolean;
  /** An address taken down on purpose (a retired article): answering "not found" is what it should do. */
  removed?: boolean;
  /** Google's verdict from Search Console's URL Inspection ("PASS", "NEUTRAL", "FAIL"), when inspected. */
  indexVerdict?: string | null;
  coverageState?: string | null;
  publishedAt?: number | null;
};
/** Google's mobile speed test (PageSpeed Insights) for one page: its performance score (0-100) and how long the main
 * content takes to appear. Measured by Google, never by one fetch from Pentra's server. */
export type SpeedCheck = { url: string; score: number | null; lcpMs: number | null };
/** Who a search's reader is, judged against what the business sells (see searchIntent.ts). */
export type IntentLabel = "buyer" | "learner" | "job_seeker" | "developer" | "other_product" | "navigational" | "unrelated";
export type QueryIntent = { query: string; label: IntentLabel; reason?: string };
/** One search's page one, measured: the median authority of the sites ranking there. */
export type PageOneCheck = { query: string; medianRank: number | null; reachable?: number; results?: number;
  domains?: { domain: string; rank: number | null }[] };
export type DiagnosisInput = {
  domain: string;
  gsc: readonly GscRow[];
  authority?: { domainRank: number; referringDomains?: number } | null;
  /** Median authority of the sites on page one for the site's main searches, when measured (else derived from pageOne). */
  pageOneMedianRank?: number | null;
  pageOne?: readonly PageOneCheck[];
  pages?: readonly CrawledPage[];
  /** Whether every published article was crawled (links into a page are only counted then). */
  crawlComplete?: boolean;
  /** The addresses the site's sitemap lists, when it was read. */
  sitemap?: { found: boolean; urls: readonly string[] } | null;
  /** Google's mobile speed test for a few of the site's pages, when it answered. */
  speed?: readonly SpeedCheck[];
  intents?: readonly QueryIntent[];
  /** When buyer questions were asked but too few came back to judge: how many were asked and answered. */
  aiAttempt?: { questions: number; answered: number } | null;
  /** Buyer questions put to the AI assistants (convex/lib/aiAnswers.ts): answers given, and how many named the business. */
  aiAnswers?: { asked: number; named: number; cited?: number; byAssistant?: readonly { assistant: string; asked: number; named: number }[];
    /** Phase 5: the sites the assistants cite most (how many answers cite each). */
    citedSites?: readonly { site: string; answers: number }[]; namedInstead?: readonly { name: string; answers: number }[] } | null;
  /** Days of Search Console history to judge (default 28, ending at its newest date). */
  windowDays?: number;
  now?: number;
};
export type Factor = "searches" | "pages" | "authority" | "clicks" | "ai";
export type FactorState = "ok" | "weak" | "failing" | "unknown";
export type Finding = { factor: Factor; severity: "high" | "medium" | "low"; problem: string; evidence: string; action: string; items?: string[] };
export type PageAction = { url: string; actions: string[] };
export type Diagnosis = {
  siteType: "new" | "struggling" | "strong";
  window: { from: string; to: string } | null;
  totals: { impressions: number; clicks: number; brandedClicks: number; pageOneImpressions: number; pageOneClicks: number; expectedPageOneClicks: number;
    beyondPageTwoShare: number; nonBuyerPageOneShare: number | null };
  factors: Record<Factor, FactorState>;
  findings: Finding[];
  pageActions: PageAction[];
  /** Duplicate articles to merge now, each into the stronger page (convex/lib/duplicatePages.ts). */
  merges: Merge[];
  summary: string;
};

/** Below this many non-branded impressions in the window, Google hasn't formed a view of the site yet: a new site. */
export const NEW_SITE_IMPRESSIONS = 200;
/** A site already earning this many non-branded clicks a week is doing well: the job is good to great. */
export const STRONG_WEEKLY_CLICKS = 25;
/** A published page Google hasn't indexed after this long has a problem, not a delay. */
export const INDEX_GRACE_DAYS = 14;
/** An article Google hasn't shown once after this long isn't going to be found as it is. */
export const UNSEEN_AFTER_DAYS = 21;
/** Articles are merged only once both are this old: a newer page's rankings haven't settled. */
export const MERGE_SETTLED_DAYS = 21;
const DAY_MS = 86_400_000;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";
const LABEL_WORDS: Record<IntentLabel, string> = { buyer: "buyers", learner: "people looking up a definition or explanation", job_seeker: "job seekers",
  developer: "developers", other_product: "users of another company's product", navigational: "people looking for another brand", unrelated: "unrelated searches" };

export function diagnoseSite(input: DiagnosisInput): Diagnosis {
  const findings: Finding[] = [];
  const factors: Record<Factor, FactorState> = { searches: "unknown", pages: "unknown", authority: "unknown", clicks: "unknown", ai: "unknown" };
  const actions = new Map<string, Set<string>>();
  const act = (url: string, action: string) => { const key = normalize(url); const set = actions.get(key) ?? new Set<string>(); set.add(action); actions.set(key, set); };
  const add = (f: Finding, state: FactorState) => {
    findings.push(f);
    const rank = { unknown: 0, ok: 1, weak: 2, failing: 3 } as const;
    if (rank[state] > rank[factors[f.factor]]) factors[f.factor] = state;
  };
  /** A finding that's worth fixing but doesn't change how its factor is judged. */
  const note = (f: Finding) => add(f, factors[f.factor]);
  const now = input.now ?? Date.now();

  // ── The Search Console window ──
  const dates = [...new Set(input.gsc.map((r) => r.date))].sort();
  const to = dates.at(-1) ?? null;
  const days = input.windowDays ?? 28;
  const from = to ? new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10) : null;
  const rows = to && from ? input.gsc.filter((r) => r.date >= from && r.date <= to) : [];
  const branded = (q: string) => isBrandedSearchQuery(q, input.domain);
  const open = rows.filter((r) => !branded(r.query));
  const brandedClicks = rows.filter((r) => branded(r.query)).reduce((s, r) => s + r.clicks, 0);
  const impressions = open.reduce((s, r) => s + r.impressions, 0), clicks = open.reduce((s, r) => s + r.clicks, 0);
  /** Every page Google showed in the window, for any search (its own name included). */
  const shownPages = new Set(rows.flatMap((r) => (r.page && r.impressions > 0 ? [normalize(r.page)] : [])));

  // Per search and per page (a page's address normalized, so www and a trailing slash are one page).
  type Tally = { impressions: number; weighted: number };
  type QueryAgg = Tally & { clicks: number; pages: Map<string, number> };
  type PageAgg = Tally & { url: string; clicks: number; queries: Map<string, Tally> };
  const byQuery = new Map<string, QueryAgg>(), byPage = new Map<string, PageAgg>();
  for (const r of open) {
    const q = byQuery.get(r.query) ?? { impressions: 0, clicks: 0, weighted: 0, pages: new Map<string, number>() };
    q.impressions += r.impressions; q.clicks += r.clicks; q.weighted += r.position * r.impressions;
    byQuery.set(r.query, q);
    if (!r.page) continue;
    const key = normalize(r.page);
    q.pages.set(key, (q.pages.get(key) ?? 0) + r.impressions);
    const p = byPage.get(key) ?? { url: r.page, impressions: 0, clicks: 0, weighted: 0, queries: new Map<string, Tally>() };
    p.impressions += r.impressions; p.clicks += r.clicks; p.weighted += r.position * r.impressions;
    const pq = p.queries.get(r.query) ?? { impressions: 0, weighted: 0 };
    pq.impressions += r.impressions; pq.weighted += r.position * r.impressions;
    p.queries.set(r.query, pq);
    byPage.set(key, p);
  }
  const position = (a: Tally) => (a.impressions ? a.weighted / a.impressions : 0);
  const queries = [...byQuery].map(([query, a]) => ({ query, ...a, position: position(a) })).sort((a, b) => b.impressions - a.impressions);
  const pageOne = queries.filter((q) => q.position <= 10);
  const pageOneImpressions = pageOne.reduce((s, q) => s + q.impressions, 0);
  const pageOneClicks = pageOne.reduce((s, q) => s + q.clicks, 0);
  const expectedPageOneClicks = pageOne.reduce((s, q) => s + q.impressions * organicCtrAtPosition(q.position), 0);
  const beyond = queries.filter((q) => q.position > 20).reduce((s, q) => s + q.impressions, 0);
  const beyondPageTwoShare = impressions ? beyond / impressions : 0;
  const weeklyClicks = clicks / (days / 7);
  const siteType: Diagnosis["siteType"] = impressions < NEW_SITE_IMPRESSIONS ? "new" : weeklyClicks >= STRONG_WEEKLY_CLICKS ? "strong" : "struggling";

  // The pages as crawled, by address. Redirects are recorded, never followed blindly.
  const crawled = input.pages ?? [];
  const crawledAt = new Map(crawled.map((p) => [normalize(p.url), p]));
  const isRedirect = (p: CrawledPage) => p.status !== undefined && p.status >= 300 && p.status < 400 && Boolean(p.location);
  const searchPages: PageSearches[] = [...byPage.values()].map((p) => ({ url: p.url, clicks: p.clicks, impressions: p.impressions,
    queries: new Map([...p.queries].map(([query, a]) => [query, { impressions: a.impressions, position: position(a) }])) }));

  // Who the readers are, where their intent was judged.
  const intentOf = new Map((input.intents ?? []).map((i) => [i.query.toLowerCase(), i]));
  const judgedPageOne = pageOne.filter((q) => intentOf.has(q.query.toLowerCase()));
  const judgedImpressions = judgedPageOne.reduce((s, q) => s + q.impressions, 0);
  const nonBuyer = judgedPageOne.filter((q) => intentOf.get(q.query.toLowerCase())!.label !== "buyer");
  const nonBuyerPageOneShare = judgedImpressions >= 50 ? nonBuyer.reduce((s, q) => s + q.impressions, 0) / judgedImpressions : null;

  // Duplicate articles to merge: both published by Pentra, both still serving, both settled.
  const settledBefore = (to ? Date.parse(`${to}T00:00:00Z`) : now) - MERGE_SETTLED_DAYS * DAY_MS;
  const mayMerge = (url: string) => {
    const page = crawledAt.get(normalize(url));
    return Boolean(page?.article && page.status === 200 && !page.noindex && page.publishedAt && page.publishedAt <= settledBefore);
  };
  const merges = input.gsc.length && siteType !== "new" ? planMerges(searchPages, mayMerge) : [];

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
          action: "Retitle the pages whose readers could buy; stop writing for readers who won't",
          items: pageOne.filter((q) => q.clicks === 0).slice(0, 8).map((q) => `${q.query} (position ${r1(q.position)}, ${q.impressions} impressions, 0 clicks)`) },
          ratio < 0.25 ? "failing" : "weak");
      } else factors.clicks = "ok";
      // Page by page: a page shown on page one that earns far fewer clicks than its position should.
      for (const a of byPage.values()) {
        const pos = position(a);
        if (pos > 10 || a.impressions < 50) continue;
        if (a.clicks < 0.25 * a.impressions * organicCtrAtPosition(pos)) act(a.url, "Retitle and rewrite the description to earn the click (or stop pointing it at readers who won't buy)");
      }
    }
    if (nonBuyerPageOneShare !== null && nonBuyerPageOneShare >= 0.5) {
      const byLabel = new Map<IntentLabel, number>();
      for (const q of nonBuyer) { const l = intentOf.get(q.query.toLowerCase())!.label; byLabel.set(l, (byLabel.get(l) ?? 0) + q.impressions); }
      add({ factor: "clicks", severity: nonBuyerPageOneShare >= 0.75 ? "high" : "medium", problem: "Its page-one rankings reach people who won't buy",
        evidence: `${pct(nonBuyerPageOneShare)} of its page-one impressions come from ${[...byLabel].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${LABEL_WORDS[l]} (${n})`).join(", ")}`,
        action: "Aim new pages at searches buyers make; stop writing for these readers",
        items: nonBuyer.slice(0, 8).map((q) => `${q.query}: ${LABEL_WORDS[intentOf.get(q.query.toLowerCase())!.label]} (position ${r1(q.position)}, ${q.impressions} impressions)`) },
        nonBuyerPageOneShare >= 0.75 ? "failing" : "weak");
    }

    // 2. Pages: its own pages shown for the same searches (Search Console's overlap, not titles), and pages just off
    // page one. A page that already redirects is merged; it no longer competes.
    const pairs = duplicatePairs(searchPages.filter((p) => { const c = crawledAt.get(normalize(p.url)); return !c || !isRedirect(c); }));
    if (pairs.length) {
      add({ factor: "pages", severity: pairs.length >= 5 ? "high" : "medium", problem: "Its own pages compete for the same searches",
        evidence: `${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"} of its pages are shown for the same searches`,
        action: "Merge each duplicate into the stronger page with a permanent redirect",
        items: pairs.slice(0, 8).map((p) => `${path(p.a.url)} and ${path(p.b.url)}: ${pct(Math.min(1, p.overlap))} overlap (e.g. "${p.searches[0]}")`) },
        pairs.length >= 5 ? "failing" : "weak");
      for (const p of pairs) {
        act(p.a.url, `Shown for the same searches as ${path(p.b.url)} (e.g. "${p.searches[0]}")`);
        act(p.b.url, `Shown for the same searches as ${path(p.a.url)} (e.g. "${p.searches[0]}")`);
      }
    }
    for (const m of merges) {
      act(m.from, `Merge into ${path(m.to)} with a permanent redirect: ${path(m.to)} ranks higher for the same searches`);
      act(m.to, `Keeps the searches of ${path(m.from)}, which merges into it`);
    }
    // A page that now redirects (merged) is no longer a page to improve.
    const redirected = (url: string) => { const page = crawledAt.get(normalize(url)); return Boolean(page && isRedirect(page)); };
    const nearPageOne = [...byPage.values()].map((a) => ({ page: a.url, impressions: a.impressions, position: position(a) }))
      .filter((p) => p.position > 10 && p.position <= 20 && p.impressions >= 50 && !redirected(p.page))
      .sort((a, b) => b.impressions - a.impressions);
    if (nearPageOne.length) {
      for (const p of nearPageOne) act(p.page, "Improve it: it sits just off page one");
      add({ factor: "pages", severity: "low", problem: "Pages close to page one", evidence: `${nearPageOne.length} pages sit at positions 11 to 20`,
        action: "Improve these first: a page at position 12 can reach page one, a new page on a weak site usually can't",
        items: nearPageOne.slice(0, 8).map((p) => `${path(p.page)} (position ${r1(p.position)}, ${p.impressions} impressions)`) }, factors.pages === "unknown" ? "ok" : factors.pages);
    }
  }

  // 2. Pages, as crawled: a redirect is fine; a chain, a dead end, or a ranked page sent to a page about something else is not.
  if (crawled.length) {
    const redirects = crawled.filter(isRedirect);
    const live = crawled.filter((p) => !isRedirect(p));

    const chains = redirects.filter((p) => { const next = crawledAt.get(normalize(p.location!)); return next ? isRedirect(next) : false; });
    if (chains.length) {
      for (const p of chains) act(p.url, "Point its redirect straight at the final page");
      add({ factor: "pages", severity: "medium", problem: "Redirect chains", evidence: `${chains.length} redirects lead to another redirect`,
        action: "Point every redirect straight at the final page", items: chains.slice(0, 8).map((p) => `${path(p.url)} → ${path(p.location!)} → …`) }, "weak");
    }
    const deadEnds = redirects.filter((p) => { const next = crawledAt.get(normalize(p.location!)); return next ? (next.status ?? 200) >= 400 : false; });
    // A page Google ranked that now redirects to a page about something else loses what it ranked for. It matters as much
    // as the ranking was worth: page one or two is a real loss, position 40 was worth little.
    const mismatched = redirects.flatMap((p) => {
      const ranked = byPage.get(normalize(p.url));
      if (!ranked || ranked.impressions < 30) return [];
      const top = [...ranked.queries].sort((a, b) => b[1].impressions - a[1].impressions)[0]?.[0];
      const target = crawledAt.get(normalize(p.location!));
      if (!top || !target?.title) return [];
      return sharesTopic(top, target.title) ? [] : [{ p, top, impressions: ranked.impressions, position: position(ranked), title: target.title }];
    });
    if (mismatched.length) {
      const valuable = mismatched.filter((m) => m.position <= 20);
      for (const m of mismatched) act(m.p.url, `Redirect it to a page about "${m.top}", or bring the original page back`);
      add({ factor: "pages", severity: valuable.length ? "high" : "low", problem: "Ranked pages redirect to a page about something else",
        evidence: `${mismatched.length} pages Google showed now send readers to an article on another topic (${valuable.length} of them ranked on page 1 or 2)`,
        action: "Redirect each to a page that answers the same search, or bring the original page back",
        items: mismatched.slice(0, 8).map((m) => `${path(m.p.url)} (top search "${m.top}", position ${r1(m.position)}, ${m.impressions} impressions) → "${m.title}"`) },
        valuable.length ? "failing" : "weak");
    }
    // An address taken down on purpose answers "not found" as it should (Nov 2026: pentra.dev's eight retired articles,
    // removed for invented quotes, were reported as broken).
    const broken = [...live.filter((p) => !p.removed && ((p.status ?? 200) >= 400 || p.status === 0)), ...deadEnds];
    if (broken.length) {
      for (const p of broken) act(p.url, "Fix it: the address doesn't load");
      add({ factor: "pages", severity: "high", problem: "Published pages that don't load", evidence: `${broken.length} published addresses end in an error`,
        action: "Bring each back, or redirect it to the page that replaced it", items: broken.slice(0, 8).map((p) => `${path(p.url)} (HTTP ${p.status ?? "?"})`) }, "failing");
    }
    const loads = live.filter((p) => (p.status ?? 200) < 300);
    // The pages meant to rank: the articles, the home page, any page Google shows for a search, and (with no Search
    // Console yet, as at onboarding) every page the owner's sitemap lists. A support page, a policy or a verification
    // file is not judged as content (Nov 2026: /support and a 56-word verification page were flagged thin).
    const home = normalize(`https://${input.domain}/`);
    const listedInSitemap = new Set((input.sitemap?.urls ?? []).map(normalize));
    const ok = loads.filter((p) => { const key = normalize(p.url);
      return p.article || key === home || byPage.has(key) || (!input.gsc.length && listedInSitemap.has(key)); });
    const pointing = ok.filter((p) => p.canonical && normalize(p.canonical) !== normalize(p.url));
    if (pointing.length) {
      for (const p of pointing) act(p.url, "Make it name itself as the real page, or redirect it");
      add({ factor: "pages", severity: "high", problem: "Pages name a different page as the real one",
        evidence: `${pointing.length} of ${ok.length} pages that load tell Google another address is the real one`,
        action: "A page names itself; a page that moved gets a permanent redirect, never a copy",
        items: pointing.slice(0, 8).map((p) => `${path(p.url)} → ${path(String(p.canonical))}`) }, "failing");
    }
    const hidden = ok.filter((p) => p.noindex);
    if (hidden.length) {
      for (const p of hidden) act(p.url, "Remove its noindex");
      add({ factor: "pages", severity: "high", problem: "Published pages tell Google not to index them", evidence: `${hidden.length} pages carry noindex`,
        action: "Remove noindex from every page meant to rank", items: hidden.slice(0, 8).map((p) => path(p.url)) }, "failing");
    }
    const settled = ok.filter((p) => p.indexVerdict && (p.publishedAt ?? 0) < now - INDEX_GRACE_DAYS * DAY_MS);
    const unindexed = settled.filter((p) => p.indexVerdict !== "PASS");
    if (unindexed.length) {
      const share = unindexed.length / settled.length;
      for (const p of unindexed) act(p.url, "Get it indexed: improve or merge it, and link to it from related pages");
      add({ factor: "pages", severity: share >= 0.3 ? "high" : "medium", problem: "Published pages Google hasn't indexed",
        evidence: `${unindexed.length} of ${settled.length} inspected pages older than ${INDEX_GRACE_DAYS} days aren't indexed`,
        action: "Make each worth indexing (more than page one already says), link to it from related pages, or merge it into a stronger page",
        items: unindexed.slice(0, 8).map((p) => `${path(p.url)} (${p.coverageState ?? p.indexVerdict})`) }, share >= 0.3 ? "failing" : "weak");
    }
    // Index coverage from the other side: articles old enough to have been found that Google never showed once.
    if (input.gsc.length && to) {
      const foundBy = Date.parse(`${to}T00:00:00Z`) - UNSEEN_AFTER_DAYS * DAY_MS;
      const old = ok.filter((p) => p.article && p.publishedAt && p.publishedAt <= foundBy);
      const unseen = old.filter((p) => !shownPages.has(normalize(p.url)));
      if (unseen.length) {
        const share = unseen.length / old.length;
        const notIndexed = unseen.filter((p) => p.indexVerdict && p.indexVerdict !== "PASS").length;
        for (const p of unseen) act(p.url, "Google never shows it: merge it into a stronger page or rewrite it for a search the site can win");
        add({ factor: "pages", severity: share >= 0.5 ? "high" : share >= 0.25 ? "medium" : "low", problem: "Articles Google never shows",
          evidence: `${unseen.length} of ${old.length} articles older than ${UNSEEN_AFTER_DAYS} days got no impressions in ${days} days${notIndexed ? ` (${notIndexed} of them aren't indexed)` : ""}`,
          action: "Fold each into a stronger page on its topic, or rewrite it for a search the site can win; stop publishing pages like them",
          items: unseen.slice(0, 8).map((p) => `${path(p.url)}${p.coverageState ? ` (${p.coverageState})` : ""}`) },
          share >= 0.5 ? "failing" : share >= 0.25 ? "weak" : factors.pages);
      }
    }
    // Links between articles: an article no other article links to is hard for Google (and readers) to reach. Counted
    // only when every published article was read, so a link from an unread page is never missed.
    const articles = ok.filter((p) => p.article);
    if (input.crawlComplete && articles.length >= 3 && articles.every((p) => p.links !== undefined)) {
      const linked = new Set<string>();
      for (const p of articles) for (const link of p.links ?? []) if (link !== normalize(p.url)) linked.add(link);
      const orphans = articles.filter((p) => !linked.has(normalize(p.url)));
      if (orphans.length) {
        for (const p of orphans) act(p.url, "Link to it from the related articles");
        add({ factor: "pages", severity: orphans.length / articles.length >= 0.3 ? "medium" : "low", problem: "Articles no other article links to",
          evidence: `${orphans.length} of ${articles.length} articles have no link from another article`,
          action: "Link every article from the related articles in its topic", items: orphans.slice(0, 8).map((p) => path(p.url)) }, "weak");
      }
    }
    const bare = ok.filter((p) => p.images === 0);
    if (bare.length) {
      for (const p of bare) act(p.url, "Add real images");
      add({ factor: "pages", severity: bare.length / ok.length >= 0.5 ? "medium" : "low", problem: "Pages without images",
        evidence: `${bare.length} of ${ok.length} pages checked have no images`, action: "Every article gets real images: screenshots, diagrams, photos" }, "weak");
    }
    const thin = ok.filter((p) => p.words !== undefined && p.words < 300);
    if (thin.length) {
      for (const p of thin) act(p.url, "Expand it: too little to rank");
      add({ factor: "pages", severity: "medium", problem: "Thin pages", evidence: `${thin.length} pages have under 300 words`, action: "Expand or merge them",
        items: thin.slice(0, 8).map((p) => `${path(p.url)} (${p.words} words)`) }, "weak");
    }
    // Speed as Google measures it on a phone (one fetch from Pentra's server measured the network, not the page).
    const timed = (input.speed ?? []).filter((c) => c.score !== null || c.lcpMs !== null);
    const slow = timed.filter((c) => (c.score !== null && c.score < 50) || (c.lcpMs !== null && c.lcpMs > 4000));
    if (slow.length) {
      for (const c of slow) act(c.url, "Make it load faster on phones");
      add({ factor: "pages", severity: "medium", problem: "Slow pages", evidence: `${slow.length} of ${timed.length} pages Google's mobile speed test checked are slow`,
        action: "Make the main content appear within 2.5 seconds on a phone: lighter images and scripts, cached pages",
        items: slow.map((c) => `${path(c.url)} (speed score ${c.score ?? "?"}/100, main content in ${c.lcpMs !== null ? `${r1(c.lcpMs / 1000)}s` : "?"})`) }, "weak");
    }
    const unstructured = ok.filter((p) => p.structuredData === false);
    if (unstructured.length) add({ factor: "pages", severity: "low", problem: "Pages without structured data", evidence: `${unstructured.length} of ${ok.length} pages have none`,
      action: "Add Article and FAQ structured data: Google's rich results and AI answers read it" }, "weak");
    const undescribed = ok.filter((p) => p.description === false);
    if (undescribed.length) {
      for (const p of undescribed) act(p.url, "Write a meta description that earns the click");
      note({ factor: "clicks", severity: "low", problem: "Pages without a meta description", evidence: `${undescribed.length} of ${ok.length} pages have none, so Google writes its own snippet`,
        action: "Give every page a description that says why to click" });
    }
    const headless = ok.filter((p) => p.h1 === 0);
    if (headless.length) {
      for (const p of headless) act(p.url, "Give it one main heading (H1)");
      note({ factor: "pages", severity: "low", problem: "Pages without a main heading", evidence: `${headless.length} of ${ok.length} pages have no H1`,
        action: "One H1 per page, naming its topic" });
    }
    if (input.sitemap) {
      if (!input.sitemap.found) {
        add({ factor: "pages", severity: "medium", problem: "No sitemap", evidence: "Nothing at /sitemap.xml or in robots.txt",
          action: "Publish a sitemap that lists every article, so Google finds new ones quickly" }, "weak");
      } else {
        const listed = new Set(input.sitemap.urls.map(normalize));
        const unlisted = ok.filter((p) => p.article && !listed.has(normalize(p.url)));
        if (unlisted.length) {
          for (const p of unlisted) act(p.url, "Add it to the sitemap");
          add({ factor: "pages", severity: "medium", problem: "Articles missing from the sitemap", evidence: `${unlisted.length} of ${articles.length} articles aren't in the sitemap`,
            action: "List every article in the sitemap", items: unlisted.slice(0, 8).map((p) => path(p.url)) }, "weak");
        }
        const stale = crawled.filter((p) => listed.has(normalize(p.url)) && (isRedirect(p) || (p.status ?? 200) >= 400 || p.status === 0));
        if (stale.length) {
          for (const p of stale) act(p.url, "Take it out of the sitemap: it doesn't load as a page");
          note({ factor: "pages", severity: "low", problem: "The sitemap lists addresses that redirect or fail", evidence: `${stale.length} sitemap addresses aren't pages`,
            action: "List only the pages themselves", items: stale.slice(0, 8).map((p) => `${path(p.url)} (HTTP ${p.status ?? "?"})`) });
        }
      }
    }
    if (factors.pages === "unknown") factors.pages = "ok";
  }

  // 3. Authority: nobody links to the site, or page one belongs to far stronger sites.
  const measured = (input.pageOne ?? []).map((c) => c.medianRank).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
  const pageOneMedian = input.pageOneMedianRank ?? (measured.length ? measured[Math.floor(measured.length / 2)] : null);
  if (input.authority) {
    const { domainRank, referringDomains } = input.authority;
    const gap = pageOneMedian != null ? pageOneMedian - domainRank : null;
    const evidence = `Domain rank ${domainRank} of 100${referringDomains != null ? `, ${referringDomains} sites link to it` : ""}${gap != null ? `; page one's median for its main searches is ${pageOneMedian}` : ""}`;
    if (domainRank < 10 || (gap != null && gap >= 30)) add({ factor: "authority", severity: "high", problem: "Too little authority to compete", evidence,
      action: "Earn links every week (sites linking to competitors, lists that leave it out, mentions without a link); until then, only searches where page one has weak sites" }, "failing");
    else if (domainRank < 25 || (gap != null && gap >= 15)) add({ factor: "authority", severity: "medium", problem: "Low authority", evidence, action: "Earn links every week" }, "weak");
    else factors.authority = "ok";
  } else add({ factor: "authority", severity: "medium", problem: "Authority not measured", evidence: "No backlink data yet", action: "Measure it before choosing searches" }, "unknown");

  // 5. AI answers: are the AI assistants naming the business when buyers ask?
  if (input.aiAnswers && input.aiAnswers.asked > 0) {
    const share = input.aiAnswers.named / input.aiAnswers.asked;
    const names: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", google_ai_mode: "Google AI Mode" };
    const split = (input.aiAnswers.byAssistant ?? []).map((a) => `${names[a.assistant] ?? a.assistant} ${a.named} of ${a.asked}`).join(", ");
    if (share < 0.2) add({ factor: "ai", severity: share === 0 ? "high" : "medium", problem: "AI assistants don't name it",
      evidence: `Named in ${input.aiAnswers.named} of ${input.aiAnswers.asked} answers to buyer questions${split ? ` (${split})` : ""}` +
        ((input.aiAnswers.namedInstead ?? []).length ? `; named instead: ${input.aiAnswers.namedInstead!.map((r) => `${r.name} (${r.answers})`).join(", ")}` : ""),
      action: (input.aiAnswers.citedSites ?? []).length
        ? `Get listed or mentioned on the sites the assistants cite most for these questions (${input.aiAnswers.citedSites!.map((s) => `${s.site}, ${s.answers} answers`).join("; ")}); publish pages that answer those questions`
        : "Get listed on the pages the assistants cite; publish pages that answer those questions" }, share === 0 ? "failing" : "weak");
    else factors.ai = "ok";
  } else add({ factor: "ai", severity: "medium", problem: "AI answers not measured",
    evidence: input.aiAttempt ? `Only ${input.aiAttempt.answered} of ${input.aiAttempt.questions} buyer questions got an answer this week, too few to judge`
      : "Nobody has asked the AI assistants the buyer questions yet",
    action: "Ask ChatGPT, Gemini and Google AI Mode the buyer questions every week" }, "unknown");

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const pageActions = [...actions].map(([url, set]) => ({ url: crawledAt.get(url)?.url ?? byPage.get(url)?.url ?? `https://${url}`, actions: [...set] }))
    .sort((a, b) => b.actions.length - a.actions.length);
  const totals = { impressions, clicks, brandedClicks, pageOneImpressions, pageOneClicks, expectedPageOneClicks: Math.round(expectedPageOneClicks),
    beyondPageTwoShare: Math.round(beyondPageTwoShare * 100) / 100, nonBuyerPageOneShare: nonBuyerPageOneShare === null ? null : Math.round(nonBuyerPageOneShare * 100) / 100 };
  return { siteType, window: from && to ? { from, to } : null, totals, factors, findings, pageActions, merges, summary: summarize(siteType, totals, findings, days) };
}

/** The diagnosis in plain words: where the site stands, its three biggest problems, and what Pentra does next. */
export function summarize(siteType: Diagnosis["siteType"], totals: Diagnosis["totals"], findings: readonly Finding[], days = 28): string {
  const standing = siteType === "new" ? "Google barely shows this site yet, so the work starts with easy searches and links."
    : siteType === "strong" ? `This site already earns ${totals.clicks} clicks from searches in ${days} days; the work is pushing more pages onto page one.`
      : `This site got ${totals.clicks} clicks from ${totals.impressions} search impressions in ${days} days (searches for its own name aside).`;
  const top = findings.filter((f) => f.severity === "high").slice(0, 3);
  const problems = (top.length ? top : findings.slice(0, 3)).map((f) => `${f.problem}: ${f.evidence}.`);
  const next = [...new Set((top.length ? top : findings.slice(0, 3)).map((f) => f.action))];
  return [standing, problems.length ? `Biggest problems. ${problems.join(" ")}` : "", next.length ? `What Pentra does next. ${next.map((a) => `${a}.`).join(" ")}` : ""]
    .filter(Boolean).join("\n");
}

const STOP = new Set("the a an and or of for to in on at by with from your you how what why when which is are can do does best top guide vs".split(" "));
const stem = (w: string) => w.replace(/(?:ing|ers|er|es|s)$/, "");
/** Whether a page title is about a search's topic: it carries more than half of the search's content words (crudely
 * stemmed). "best free seo tools" and "Free AI Tools for SEO Optimization" share a topic; "keyword clustering" and
 * "Keywords for Research" don't. */
export function sharesTopic(search: string, title: string): boolean {
  const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
  const a = words(search), b = words(title);
  if (!a.size) return true;
  return [...a].filter((w) => b.has(w)).length / a.size > 0.5;
}

export function normalize(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}
