/** Pentra Answers (Nov 2026): the engine's pure core. Pentra asks the AI assistants the questions a business's buyers ask,
 * keeps every answer as proof, and judges each one the same way everywhere: did it name the business, did it cite the
 * business's site, which competitors did it name, which sources did it use. Nothing here calls a provider or a database. */

export type AnswerAssistant = "chatgpt" | "perplexity" | "gemini" | "google_ai_mode" | "google_ai_overview";
export const ANSWER_ASSISTANTS: readonly AnswerAssistant[] = ["chatgpt", "perplexity", "gemini", "google_ai_mode", "google_ai_overview"];
export const ANSWER_ASSISTANT_NAMES: Record<AnswerAssistant, string> = {
  chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", google_ai_mode: "Google AI Mode", google_ai_overview: "Google AI Overviews",
};
export const isAnswerAssistant = (value: string): value is AnswerAssistant => (ANSWER_ASSISTANTS as readonly string[]).includes(value);

/** treg endpoints (measured success rates, Nov 8 2026): cloro runs the question through ChatGPT's and Gemini's live web
 * interfaces and Google's AI Mode and results page (97.5-99.5%); Perplexity answers through its own API (100%). Copilot has
 * no provider, so Pentra never claims it. The ChatGPT endpoint the weekly diagnosis used (crawl4ai) succeeded 3.9%. */
export const ANSWER_ENDPOINTS: Record<AnswerAssistant, string> = {
  chatgpt: "cloro.ai-search.chatgpt.scrape",
  perplexity: "perplexity.web.answer.fast",
  gemini: "cloro.ai-search.gemini.scrape",
  google_ai_mode: "cloro.google.serp.ai_mode",
  google_ai_overview: "cloro.google.serp.organic",
};
/** A call's price bound, charged when a call's cost is unknown (never assumed free). Perplexity settles at its usage. */
export const ANSWER_CALL_MAX_MICRO_USD = 15_000;
/** What one question costs across the five assistants, used to hold spend before a batch is sent. */
export const ANSWER_CALL_ESTIMATE_MICRO_USD: Record<AnswerAssistant, number> = {
  chatgpt: 2_800, perplexity: 10_000, gemini: 2_400, google_ai_mode: 2_400, google_ai_overview: 2_800,
};

export function assistantRequest(assistant: AnswerAssistant, question: string, country: string): { endpoint: string; body: Record<string, unknown> } {
  const endpoint = ANSWER_ENDPOINTS[assistant];
  switch (assistant) {
    case "chatgpt": return { endpoint, body: { prompt: question, country, include: { markdown: true } } };
    case "perplexity": return { endpoint, body: { preset: "fast", input: question, max_steps: 1, max_output_tokens: 512 } };
    case "gemini": return { endpoint, body: { prompt: question, country } };
    case "google_ai_mode": return { endpoint, body: { prompt: question, gl: country } };
    case "google_ai_overview": return { endpoint, body: { query: question, gl: country, pages: 1, include: { aioverview: true } } };
  }
}

export type AnswerSource = { url: string; title?: string };
export type ParsedAnswer = { kind: "answer"; text: string; sources: AnswerSource[] } | { kind: "none"; reason: string };

/** A source address as people would open it: tracking parameters assistants add ("utm_source=chatgpt.com") removed. */
export function cleanSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^srsltid$|^gclid$|^fbclid$/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    const out = url.toString();
    return out.length > 600 ? null : out.replace(/\?$/, "");
  } catch { return null; }
}
const providerHost = (url: string) => /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|vertexaisearch\.cloud\.google\.com|cloro\.dev|bing\.com\/ck)$/i
  .test(hostOf(url));

/** Every source-like object ({url|link|href, title|label|name}) under a value, in order, once each. */
function collectSources(value: unknown, out: AnswerSource[] = [], seen = new Set<string>(), depth = 0): AnswerSource[] {
  if (depth > 8 || value === null || value === undefined) return out;
  if (Array.isArray(value)) { for (const item of value) collectSources(item, out, seen, depth + 1); return out; }
  if (typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  const rawUrl = [record.url, record.link, record.href, record.uri].find((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
  if (rawUrl) {
    const url = cleanSourceUrl(rawUrl);
    if (url && !seen.has(url) && !providerHost(url)) {
      seen.add(url);
      const title = [record.title, record.label, record.name, record.source].find((t): t is string => typeof t === "string" && t.trim().length > 0);
      out.push(title ? { url, title: title.trim().slice(0, 200) } : { url });
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "html" || key === "raw" || key === "rawResponse") continue;
    if (typeof child === "object" && child !== null) collectSources(child, out, seen, depth + 1);
  }
  return out;
}

/** The AI Overview inside a parsed Google results page: the object under a key like "aiOverview" / "ai_overview". */
function findAiOverview(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || !value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^ai[_-]?overview$/i.test(key) && child && typeof child === "object") return child as Record<string, unknown>;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === "object" && !Array.isArray(child)) { const found = findAiOverview(child, depth + 1); if (found) return found; }
  }
  return null;
}
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    for (const key of ["text", "markdown", "content", "snippet", "answer"]) { const t = textOf(r[key]); if (t) return t; }
  }
  return "";
}

/** The answer text and its sources from each provider's reply (treg relays the provider's own body). `none` when the
 * assistant gave no answer for this question (Google shows an AI Overview for only some searches): not an error, and not
 * counted as an answer. `null` when the reply can't be read at all. */
export function parseAssistantReply(assistant: AnswerAssistant, payload: unknown): ParsedAnswer | null {
  if (!payload || typeof payload !== "object") return null;
  if (assistant === "perplexity") {
    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) return null;
    const parts: string[] = [];
    for (const item of output) {
      const content = (item as { content?: unknown })?.content;
      if (Array.isArray(content)) for (const c of content) {
        const t = (c as { type?: unknown; text?: unknown });
        if (typeof t.text === "string" && (t.type === undefined || t.type === "output_text" || t.type === "text")) parts.push(t.text);
      }
    }
    const text = parts.join("\n").trim();
    const sources = collectSources([output, (payload as Record<string, unknown>).search_results, (payload as Record<string, unknown>).citations]);
    return text ? { kind: "answer", text, sources: sources.slice(0, 20) } : { kind: "none", reason: "no answer" };
  }
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  if (assistant === "google_ai_overview") {
    const overview = findAiOverview(result);
    const text = overview ? textOf(overview).trim() : "";
    if (!text) return { kind: "none", reason: "Google showed no AI Overview for this search" };
    return { kind: "answer", text, sources: collectSources(overview).slice(0, 20) };
  }
  const r = result as { text?: unknown; markdown?: unknown; sources?: unknown; citationPills?: unknown };
  const text = (typeof r.text === "string" && r.text.trim() ? r.text : typeof r.markdown === "string" ? r.markdown : "").trim();
  if (!text) return { kind: "none", reason: "no answer" };
  return { kind: "answer", text, sources: collectSources([r.sources, r.citationPills]).slice(0, 20) };
}

// ── Who an answer names and cites ──

export const hostOf = (value: string): string => {
  const raw = value.trim().toLowerCase();
  try { return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); }
  catch { return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, ""); }
};
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Brand = { name: string; domain?: string };
export type BrandMatcher = { name: string; domain: string | null; test: (text: string) => number };

/** Where a brand is first named in a text (-1 when it isn't): by its address, or by its name. A one-word name that is also
 * an everyday word ("Instantly", "Apollo") must be written capitalised; "LeadPilot" also matches "Lead Pilot". */
export function brandMatcher(brand: Brand, options: { caseSensitiveSingleWord?: boolean; exactCase?: boolean } = {}): BrandMatcher | null {
  const domain = brand.domain ? hostOf(brand.domain) : null;
  const words = brand.name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.join("").toLowerCase();
  let pattern: RegExp | null = null;
  if (joined.length >= 3) {
    // Words may be joined by up to three non-letters: "Deck & Fence", "Lowe's", "Lowe’s", "Hub-Spot".
    const body = words.map((w) => escapeRegex(w)).join("[^A-Za-z0-9]{0,3}");
    const single = words.length === 1 && /^[A-Za-z]+$/.test(words[0]) && words[0] === words[0][0].toUpperCase() + words[0].slice(1).toLowerCase();
    // `exactCase`: a name as an answer wrote it ("Simple Analytics") never matches the everyday words ("simple analytics").
    pattern = options.exactCase
      ? new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`)
      : single && options.caseSensitiveSingleWord
        ? new RegExp(`(?<![A-Za-z0-9])${escapeRegex(words[0][0].toUpperCase())}${escapeRegex(words[0].slice(1))}(?![A-Za-z0-9])`)
        : new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "i");
  }
  if (!pattern && !domain) return null;
  return {
    name: brand.name.trim().slice(0, 80) || domain || "",
    domain,
    test: (text: string) => {
      const lower = text.toLowerCase();
      const at = [domain ? lower.indexOf(domain) : -1, pattern ? text.search(pattern) : -1].filter((i) => i >= 0);
      return at.length ? Math.min(...at) : -1;
    },
  };
}

export type AnswerJudgement = {
  named: boolean; cited: boolean;
  /** The business's place among the brands the answer names, in order of first mention (1 = named first). */
  position: number | null;
  brandsNamed: number;
  /** The businesses counted in `brandsNamed`, in the answer's order (the business itself by its own name). */
  namedOrder: string[];
  competitorsNamed: string[];
  /** The business's own pages among the sources. */
  citedPageUrls: string[];
  sources: Array<{ url: string; title?: string; domain: string; own: boolean }>;
  excerpt: string;
};

/** One answer, judged. "Named" means the answer's words name the business: a recommendation. "Cited" means one of its
 * sources is on the business's site (or its hosted answers address): a page the assistant read, which never counts as
 * named on its own (P396: LeadPilot read "named in 5 of 24" when its words named it once). */
export function judgeAnswer(answer: { text: string; sources: readonly AnswerSource[] }, business: Brand & { domain: string; extraHosts?: string[] },
  competitors: readonly Brand[], context: { question?: string; namedOrder?: readonly string[] } = {}): AnswerJudgement {
  const ownHosts = [hostOf(business.domain), ...(business.extraHosts ?? []).map(hostOf)].filter(Boolean);
  const isOwn = (url: string) => { const h = hostOf(url); return ownHosts.some((own) => h === own || h.endsWith(`.${own}`)); };
  const sources = answer.sources.map((s) => ({ url: s.url, ...(s.title ? { title: s.title } : {}), domain: hostOf(s.url), own: isOwn(s.url) }));
  const citedPageUrls = sources.filter((s) => s.own).map((s) => s.url);
  const businessMatcher = brandMatcher(business);
  const businessAt = businessMatcher ? businessMatcher.test(answer.text) : -1;
  const own = hostOf(business.domain);
  // A competitor the question itself names ("alternatives to X") is the question echoed back, never a recommendation.
  const rivals = competitors.map((c) => brandMatcher(c, { caseSensitiveSingleWord: true }))
    .filter((m): m is BrandMatcher => m !== null && (!m.domain || (m.domain !== own && !m.domain.endsWith(`.${own}`))))
    .filter((m) => !context.question || m.test(context.question) < 0);
  const seenRival = new Set<string>();
  const rivalHits = rivals.map((m) => ({ name: m.name, at: m.test(answer.text) })).filter((r) => r.at >= 0)
    .filter((r) => { const k = r.name.toLowerCase(); if (seenRival.has(k)) return false; seenRival.add(k); return true; })
    .sort((a, b) => a.at - b.at);
  // Every business the answer names (listed by a small model call) and every confirmed competitor it names, each placed
  // where the answer first names it, so the business's place and the total count the same businesses in the answer's own
  // order ("3rd of 7"). A name the question itself asks about is never counted (it is the question echoed back).
  const placement = placeNamed(answer.text, { businessAt, businessName: business.name, isBusiness: (name) => isBusinessName(name, businessMatcher, own),
    names: (context.namedOrder ?? []).slice(0, 30), rivalHits, ...(context.question ? { question: context.question } : {}) });
  const cited = citedPageUrls.length > 0;
  return {
    named: businessAt >= 0, cited, position: placement.position, brandsNamed: placement.order.length, namedOrder: placement.order,
    competitorsNamed: rivalHits.map((r) => r.name).slice(0, 12), citedPageUrls: citedPageUrls.slice(0, 10), sources: sources.slice(0, 20),
    excerpt: excerptAround(answer.text, businessAt >= 0 ? businessAt : rivalHits[0]?.at ?? 0),
  };
}

const isBusinessName = (name: string, businessMatcher: BrandMatcher | null, own: string) =>
  Boolean(businessMatcher && (businessMatcher.test(name) >= 0 || (own !== "" && hostOf(name) === own)));

/** A name the question itself asks about ("alternatives to Google Analytics"): the question echoed, never an option. */
const askedAbout = (name: string, question: string) => (brandMatcher({ name }, { caseSensitiveSingleWord: true })?.test(question) ?? -1) >= 0;

/** Where an answer first names a business: by the name exactly as written ("Simple Analytics", never "simple analytics"),
 * or, for a name listed from this very answer, as the listing wrote it in any case. */
function firstMention(text: string, name: string, listedHere: boolean): number {
  const exact = brandMatcher({ name }, { exactCase: true })?.test(text) ?? -1;
  if (exact >= 0 || !listedHere) return exact;
  return brandMatcher({ name }, { caseSensitiveSingleWord: true })?.test(text) ?? -1;
}

/** The businesses an answer names, in its own order, and the business's place among them: the listed names (the answer's
 * own `names`, and `alsoNames` other answers to the same question were counted with), the confirmed competitors it names,
 * the business itself; never a name the question asks about, never one name twice. */
export function placeNamed(text: string, args: { businessAt: number; businessName: string; isBusiness: (name: string) => boolean;
  names: readonly string[]; alsoNames?: readonly string[]; rivalHits: ReadonlyArray<{ name: string; at: number }>; question?: string }): { position: number | null; order: string[] } {
  const placed: Array<{ name: string; at: number; business: boolean }> = [];
  const add = (name: string, at: number, business: boolean) => {
    if (at < 0 || placed.some((p) => p.at === at || (p.business && business) || p.name.toLowerCase() === name.toLowerCase())) return;
    placed.push({ name, at, business });
  };
  if (args.businessAt >= 0) add(args.businessName, args.businessAt, true);
  const consider = (name: string, listedHere: boolean) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2 || args.isBusiness(clean) || (args.question && askedAbout(clean, args.question))) return;
    add(clean, firstMention(text, clean, listedHere), false);
  };
  for (const name of args.names) consider(name, true);
  for (const name of args.alsoNames ?? []) consider(name, false);
  for (const hit of args.rivalHits) if (!args.question || !askedAbout(hit.name, args.question)) add(hit.name, hit.at, false);
  placed.sort((a, b) => a.at - b.at);
  return { position: args.businessAt < 0 ? null : placed.findIndex((p) => p.business) + 1, order: placed.map((p) => p.name) };
}

/** One answer's place recounted over every business the answers to its question were counted with (Cowork's test 3:
 * Google Analytics counted in one answer and skipped in another answer to the same question). */
export function recountPlacement(text: string, business: Brand & { domain: string }, competitors: readonly Brand[], question: string,
  ownNames: readonly string[], questionNames: readonly string[]): { position: number | null; brandsNamed: number; namedOrder: string[] } {
  const businessMatcher = brandMatcher(business);
  const businessAt = businessMatcher ? businessMatcher.test(text) : -1;
  const own = hostOf(business.domain);
  const rivalHits = competitors.map((c) => brandMatcher(c, { caseSensitiveSingleWord: true }))
    .filter((m): m is BrandMatcher => m !== null && (!m.domain || (m.domain !== own && !m.domain.endsWith(`.${own}`))))
    .map((m) => ({ name: m.name, at: m.test(text) })).filter((r) => r.at >= 0);
  const placement = placeNamed(text, { businessAt, businessName: business.name, isBusiness: (name) => isBusinessName(name, businessMatcher, own),
    names: ownNames, alsoNames: questionNames, rivalHits, question });
  return { position: placement.position, brandsNamed: placement.order.length, namedOrder: placement.order };
}

/** About 600 characters of the answer around a point (the first mention), on word boundaries, marked with ellipses. */
export function excerptAround(text: string, at: number, size = 600): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean;
  const point = Math.max(0, Math.min(clean.length, Math.round(at * (clean.length / Math.max(1, text.length)))));
  let start = Math.max(0, point - Math.round(size * 0.3));
  let end = Math.min(clean.length, start + size);
  start = Math.max(0, end - size);
  if (start > 0) { const space = clean.indexOf(" ", start); start = space > 0 && space < start + 40 ? space + 1 : start; }
  if (end < clean.length) { const space = clean.lastIndexOf(" ", end); end = space > end - 40 ? space : end; }
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}

// ── Totals, honestly counted ──

export type CheckSummary = { assistant: string; status: string; named: boolean; cited: boolean; competitorsNamed: readonly string[];
  /** Every business the answer names, in order (P396: listed for every answer, not only the ones naming the business). */
  businessesNamed?: readonly string[] | null;
  sources: ReadonlyArray<{ domain: string; own: boolean }> };

/** Who the assistants recommend across a set of answers, confirmed competitor or not: each business with the number of
 * answers naming it, most first. The business itself is left out. Names are counted once per answer, case-insensitively,
 * under the spelling seen first. */
export function recommendedInstead(checks: readonly CheckSummary[], business?: Brand, limit = 15): Array<{ name: string; answers: number }> {
  const matcher = business ? brandMatcher(business) : null;
  const own = business?.domain ? hostOf(business.domain) : "";
  const counts = new Map<string, { name: string; answers: number }>();
  for (const c of checks) {
    if (c.status !== "answered") continue;
    const seen = new Set<string>();
    for (const raw of c.businessesNamed ?? []) {
      const name = raw.replace(/\s+/g, " ").trim();
      // One business under its two spellings ("Apollo", "Apollo.io") is counted once (P398).
      const key = name.toLowerCase().replace(/\.(com|io|ai|co|app|net|org)$/, "").replace(/[^a-z0-9]/g, "") || name.toLowerCase();
      if (name.length < 2 || seen.has(key) || isBusinessName(name, matcher, own)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name, answers: 0 };
      entry.answers++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)).slice(0, limit);
}

/** A run's counts: answers are only the ones an assistant gave (no-answers and errors are listed, never counted as "not
 * named"); every count keeps its denominator. */
export function runTotals(checks: readonly CheckSummary[], business?: Brand) {
  const answered = checks.filter((c) => c.status === "answered");
  const byAssistant = ANSWER_ASSISTANTS.map((assistant) => {
    const mine = checks.filter((c) => c.assistant === assistant), got = mine.filter((c) => c.status === "answered");
    return { assistant, asked: mine.length, answered: got.length, named: got.filter((c) => c.named).length, cited: got.filter((c) => c.cited).length };
  }).filter((a) => a.asked > 0);
  const rivalCounts = new Map<string, number>();
  for (const c of answered) for (const name of new Set(c.competitorsNamed)) rivalCounts.set(name, (rivalCounts.get(name) ?? 0) + 1);
  const sourceCounts = new Map<string, number>();
  for (const c of answered) for (const domain of new Set(c.sources.filter((s) => !s.own).map((s) => s.domain))) sourceCounts.set(domain, (sourceCounts.get(domain) ?? 0) + 1);
  return {
    asked: checks.length, answered: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length,
    failed: checks.filter((c) => c.status === "error").length, noAnswer: checks.filter((c) => c.status === "no_answer").length,
    byAssistant,
    competitors: [...rivalCounts].map(([name, named]) => ({ name, named })).sort((a, b) => b.named - a.named || a.name.localeCompare(b.name)).slice(0, 12),
    recommended: recommendedInstead(checks, business),
    topSources: [...sourceCounts].map(([domain, answers]) => ({ domain, answers })).sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain)).slice(0, 15),
  };
}

// ── Which questions the business can win now ──

/** Sites an assistant leans on whatever the question (encyclopedias, forums, video, marketplaces, big publishers). A
 * question answered only from these is hard to enter with one page; one answered from small, partial pages is not. */
const ENTRENCHED = /(^|\.)(wikipedia\.org|reddit\.com|youtube\.com|quora\.com|amazon\.[a-z.]+|linkedin\.com|forbes\.com|g2\.com|capterra\.com|trustpilot\.com|yelp\.com|nytimes\.com|investopedia\.com|hubspot\.com|medium\.com|facebook\.com|tripadvisor\.[a-z.]+|indeed\.com|glassdoor\.com|apple\.com|microsoft\.com)$/i;
const STOP = new Set(["a", "an", "and", "are", "as", "at", "be", "best", "can", "do", "does", "for", "from", "get", "how", "i", "in", "is", "it", "my",
  "of", "on", "or", "should", "the", "to", "what", "when", "where", "which", "who", "why", "with", "you", "your", "me", "there", "that", "this"]);
export const questionWords = (text: string) => [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];

export type QuestionChecks = ReadonlyArray<{ status: string; named: boolean; cited: boolean; competitorsNamed: readonly string[];
  sources: ReadonlyArray<{ domain: string; own: boolean; title?: string }> }>;
export type Opportunity = { score: number; status: "winnable" | "covered" | "monitoring"; reasons: string[] };

/** How much one answer page could change this question's answers, from the answers themselves (never a guess about
 * rankings): it is "covered" when most answers already name the business, "winnable" when they don't and the sources they
 * use are few, partial or small, "monitoring" when they lean on big sites only. Plain reasons go with it. */
export const ANSWERS_WINNABLE_SCORE = 80;

export function questionOpportunity(question: string, checks: QuestionChecks): Opportunity {
  const answered = checks.filter((c) => c.status === "answered");
  if (!answered.length) return { score: 40, status: "monitoring", reasons: ["No assistant answered this yet; it is asked again next run."] };
  const named = answered.filter((c) => c.named).length;
  if (named / answered.length >= 0.5) {
    return { score: 10, status: "covered", reasons: [`Already named in ${named} of ${answered.length} answers.`] };
  }
  const words = questionWords(question);
  const external = answered.flatMap((c) => c.sources.filter((s) => !s.own));
  const domains = [...new Set(external.map((s) => s.domain))];
  const entrenched = domains.filter((d) => ENTRENCHED.test(d));
  const precise = external.filter((s) => {
    if (!s.title) return false;
    const titleWords = new Set(questionWords(s.title));
    return words.length > 0 && words.filter((w) => titleWords.has(w)).length / words.length >= 0.6;
  });
  const rivalAnswers = answered.filter((c) => c.competitorsNamed.length > 0).length;
  // Each reason says what this question's answers show (Cowork's test 3: every winnable question read the same template):
  // who they name instead, and the sites they cite.
  const rivalCounts = new Map<string, number>();
  for (const c of answered) for (const name of new Set(c.competitorsNamed)) rivalCounts.set(name, (rivalCounts.get(name) ?? 0) + 1);
  const rivals = [...rivalCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const domainCounts = new Map<string, number>();
  for (const c of answered) for (const d of new Set(c.sources.filter((s) => !s.own).map((s) => s.domain))) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const cited = [...domainCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
  const citedList = cited.length <= 2 ? cited.join(" and ") : `${cited.slice(0, 2).join(", ")} and ${cited.length - 2} more`;
  const youIn = named === 0 ? "you in none" : `you in ${named}`;
  const reasons: string[] = [];
  let score = 50;
  if (named === 0) score += 15;
  if (rivals.length) {
    reasons.push(`${rivals[0][0]} is named in ${rivals[0][1]} of ${answered.length} answers${rivals[1] ? `, ${rivals[1][0]} in ${rivals[1][1]}` : ""}; ${youIn}.`);
  } else {
    reasons.push(named === 0 ? `None of the ${answered.length} answers names you or a competitor you track.` : `Named in ${named} of ${answered.length} answers; no competitor you track is.`);
  }
  if (rivalAnswers > 0) score += 10;
  const preciseDomains = new Set(precise.map((s) => s.domain)).size;
  const bigSitesOnly = domains.length > 0 && entrenched.length / domains.length >= 0.7;
  // Large sites answer broad questions whatever their page titles say, so a missing exact page is no opening there.
  if (bigSitesOnly) { score -= 25; reasons.push(`The answers lean on large sites only (${citedList}).`); }
  else {
    if (preciseDomains <= 1) {
      score += 15;
      if (domains.length) reasons.push(preciseDomains === 0 ? `They cite ${citedList}; none of those pages answers this exact question.`
        : `They cite ${citedList}; only one page answers this exact question.`);
    } else {
      if (preciseDomains >= 4) score -= 10;
      reasons.push(`They cite ${citedList}; ${preciseDomains} of those pages answer it directly.`);
    }
    if (domains.length > 0 && entrenched.length / domains.length <= 0.3) { score += 5; reasons.push("Those are small and mid-size sites, which a precise page can join."); }
  }
  if (words.length >= 6) { score += 5; reasons.push("It is a specific question, so fewer pages compete for it."); }
  if (!domains.length) { score -= 20; reasons.splice(1, 0, "The answers cite no web pages yet, so there is no page to join."); }
  score = Math.max(0, Math.min(100, score));
  // Winnable means an opening, as the site describes it: no answer names the business yet (test 2 found questions where
  // it was already named marked winnable), the answers cite web pages, and the sources are thin or small (80+).
  return { score, status: score >= ANSWERS_WINNABLE_SCORE && named === 0 && domains.length > 0 && !bigSitesOnly ? "winnable" : "monitoring", reasons: reasons.slice(0, 4) };
}

/** The strongest openings first, at most a third of the answered questions (at least three): "questions you can win now"
 * is a short list worth writing for (test 2: 26 of 30 "winnable" for a local dentist said nothing). The rest stay open
 * and say so. */
export function rankOpportunities<T extends { opportunity: Opportunity }>(items: readonly T[]): T[] {
  const winnable = items.filter((i) => i.opportunity.status === "winnable").sort((a, b) => b.opportunity.score - a.opportunity.score);
  const answeredCount = items.filter((i) => !/^No assistant answered/.test(i.opportunity.reasons[0] ?? "")).length;
  const keep = new Set(winnable.slice(0, Math.max(3, Math.floor(answeredCount / 3))));
  return items.map((i) => i.opportunity.status !== "winnable" || keep.has(i) ? i
    : { ...i, opportunity: { ...i.opportunity, status: "monitoring", reasons: [...i.opportunity.reasons.slice(0, 3), "Open too: Pentra writes for the strongest openings first."] } });
}

// ── Questions and pages ──

export const questionKey = (question: string) => question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const ANSWER_QUESTION_INTENTS = ["recommendation", "how_to", "comparison", "cost", "problem", "local"] as const;
export type AnswerQuestionIntent = typeof ANSWER_QUESTION_INTENTS[number];

/** A question as Pentra keeps it: one sentence, a real question, plain, not naming the business itself. */
export function cleanQuestion(raw: string, business: Brand & { domain: string }, competitors: readonly Brand[] = []): string | null {
  const question = raw.replace(/\s+/g, " ").trim().replace(/\s+\?$/, "?");
  if (question.length < 12 || question.length > 200 || !question.endsWith("?")) return null;
  const matcher = brandMatcher(business);
  if (matcher && matcher.test(question) >= 0) return null;
  if (namesCompetitor(question, competitors)) return null;
  return question[0].toUpperCase() + question.slice(1);
}

/** Whether a question names one of the confirmed competitors (generated questions never do; such a question's answers
 * echo the name, and a page for it would be about the competitor). */
export function namesCompetitor(question: string, competitors: readonly Brand[]): boolean {
  return competitors.some((c) => { const m = brandMatcher(c, { caseSensitiveSingleWord: true }); return m !== null && m.test(question) >= 0; });
}

/** A page address from its question: lowercase words joined by hyphens, filler dropped, at most 70 characters. */
export function answerSlug(question: string): string {
  const words = question.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  const lead = new Set(["what", "whats", "how", "which", "who", "why", "when", "where", "is", "are", "do", "does", "can", "should", "i", "a", "an", "the"]);
  let start = 0;
  while (start < words.length - 3 && lead.has(words[start])) start++;
  let slug = "";
  for (const word of words.slice(start)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 70) break;
    slug = next;
  }
  return slug || "answer";
}

/** The month a spend row counts in ("2026-11"). */
export const spendMonth = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 7);

// ── Every business an answer names ──

export const NAMED_MODEL = "claude-haiku-5-5";
export const NAMED_TOOL = "submit_named_businesses";
export const NAMED_PRICE = { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 };
export const namedCostMicroUsd = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * NAMED_PRICE.inputUsdPerMillion + Math.max(0, usage?.output_tokens ?? 0) * NAMED_PRICE.outputUsdPerMillion);

/** The request that lists, in order, every business an answer offers the buyer: the denominator of "3rd of 7". */
export function namedBusinessesRequest(question: string, answer: string) {
  return {
    system: [
      "You list the businesses an AI assistant's answer offers a buyer as options, in the order the answer presents them.",
      "Include every company, practice, firm, store, clinic, agency, tool or product the buyer could choose, hire or contact, named as such.",
      "Exclude: the assistant itself; websites or publications mentioned only as places to read or look (review sites, directories, news sites, Google Maps, Yelp) unless the answer recommends them as the option; generic kinds of business; people, unless the name is the business itself.",
      "Use each name as written in the answer, once, in order of first appearance. An answer that names no business gets an empty list.",
    ].join("\n"),
    userMessage: `Question: ${question}\n\nAnswer:\n${answer.slice(0, 9000)}`,
    inputSchema: { type: "object" as const, additionalProperties: false, required: ["businesses"],
      properties: { businesses: { type: "array" as const, items: { type: "string" as const }, maxItems: 30 } } },
  };
}

export function parseNamedBusinesses(raw: unknown): string[] | null {
  const list = raw && typeof raw === "object" ? (raw as { businesses?: unknown }).businesses : null;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  return list.flatMap((n) => {
    if (typeof n !== "string") return [];
    const name = n.replace(/\s+/g, " ").trim().slice(0, 80);
    const key = name.toLowerCase();
    if (name.length < 2 || seen.has(key)) return [];
    seen.add(key);
    return [name];
  }).slice(0, 30);
}
