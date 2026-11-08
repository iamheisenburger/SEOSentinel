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
export function brandMatcher(brand: Brand, options: { caseSensitiveSingleWord?: boolean } = {}): BrandMatcher | null {
  const domain = brand.domain ? hostOf(brand.domain) : null;
  const words = brand.name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.join("").toLowerCase();
  let pattern: RegExp | null = null;
  if (joined.length >= 3) {
    const body = words.map((w) => escapeRegex(w)).join("[\\s.-]?");
    const single = words.length === 1 && /^[A-Za-z]+$/.test(words[0]) && words[0] === words[0][0].toUpperCase() + words[0].slice(1).toLowerCase();
    pattern = single && options.caseSensitiveSingleWord
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
  competitorsNamed: string[];
  /** The business's own pages among the sources. */
  citedPageUrls: string[];
  sources: Array<{ url: string; title?: string; domain: string; own: boolean }>;
  excerpt: string;
};

/** One answer, judged. "Named" means the answer's words name the business or it cites the business's site; "cited" means
 * one of its sources is on the business's site (or its hosted answers address). */
export function judgeAnswer(answer: { text: string; sources: readonly AnswerSource[] }, business: Brand & { domain: string; extraHosts?: string[] },
  competitors: readonly Brand[]): AnswerJudgement {
  const ownHosts = [hostOf(business.domain), ...(business.extraHosts ?? []).map(hostOf)].filter(Boolean);
  const isOwn = (url: string) => { const h = hostOf(url); return ownHosts.some((own) => h === own || h.endsWith(`.${own}`)); };
  const sources = answer.sources.map((s) => ({ url: s.url, ...(s.title ? { title: s.title } : {}), domain: hostOf(s.url), own: isOwn(s.url) }));
  const citedPageUrls = sources.filter((s) => s.own).map((s) => s.url);
  const businessMatcher = brandMatcher(business);
  const businessAt = businessMatcher ? businessMatcher.test(answer.text) : -1;
  const own = hostOf(business.domain);
  const rivals = competitors.map((c) => brandMatcher(c, { caseSensitiveSingleWord: true }))
    .filter((m): m is BrandMatcher => m !== null && (!m.domain || (m.domain !== own && !m.domain.endsWith(`.${own}`))));
  const seenRival = new Set<string>();
  const rivalHits = rivals.map((m) => ({ name: m.name, at: m.test(answer.text) })).filter((r) => r.at >= 0)
    .filter((r) => { const k = r.name.toLowerCase(); if (seenRival.has(k)) return false; seenRival.add(k); return true; })
    .sort((a, b) => a.at - b.at);
  const order = [...(businessAt >= 0 ? [{ name: "__business__", at: businessAt }] : []), ...rivalHits].sort((a, b) => a.at - b.at);
  const position = businessAt >= 0 ? order.findIndex((o) => o.name === "__business__") + 1 : null;
  const cited = citedPageUrls.length > 0;
  return {
    named: businessAt >= 0 || cited, cited, position, brandsNamed: order.length,
    competitorsNamed: rivalHits.map((r) => r.name).slice(0, 12), citedPageUrls: citedPageUrls.slice(0, 10), sources: sources.slice(0, 20),
    excerpt: excerptAround(answer.text, businessAt >= 0 ? businessAt : rivalHits[0]?.at ?? 0),
  };
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
  sources: ReadonlyArray<{ domain: string; own: boolean }> };

/** A run's counts: answers are only the ones an assistant gave (no-answers and errors are listed, never counted as "not
 * named"); every count keeps its denominator. */
export function runTotals(checks: readonly CheckSummary[]) {
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
  const reasons: string[] = [];
  let score = 50;
  if (named === 0) { score += 15; reasons.push(`Not named in any of ${answered.length} answers.`); }
  else reasons.push(`Named in ${named} of ${answered.length} answers.`);
  if (rivalAnswers > 0) { score += 10; reasons.push(`Competitors are named in ${rivalAnswers} of ${answered.length}: buyers get a recommendation here.`); }
  const preciseDomains = new Set(precise.map((s) => s.domain)).size;
  const bigSitesOnly = domains.length > 0 && entrenched.length / domains.length >= 0.7;
  // Large sites answer broad questions whatever their page titles say, so a missing exact page is no opening there.
  if (bigSitesOnly) { score -= 25; reasons.push("The answers lean on large sites only."); }
  else {
    if (preciseDomains <= 1) { score += 15; reasons.push(preciseDomains === 0 ? "No cited page answers this exact question." : "Only one cited page answers this exact question."); }
    else if (preciseDomains >= 4) { score -= 10; reasons.push(`${preciseDomains} cited pages already answer it directly.`); }
    if (domains.length > 0 && entrenched.length / domains.length <= 0.3) { score += 5; reasons.push("The answers cite small and mid-size sites, which a precise page can join."); }
  }
  if (words.length >= 6) { score += 5; reasons.push("It is a specific question, so fewer pages compete for it."); }
  score = Math.max(0, Math.min(100, score));
  return { score, status: score >= 55 ? "winnable" : "monitoring", reasons: reasons.slice(0, 4) };
}

// ── Questions and pages ──

export const questionKey = (question: string) => question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const ANSWER_QUESTION_INTENTS = ["recommendation", "how_to", "comparison", "cost", "problem", "local"] as const;
export type AnswerQuestionIntent = typeof ANSWER_QUESTION_INTENTS[number];

/** A question as Pentra keeps it: one sentence, a real question, plain, not naming the business itself. */
export function cleanQuestion(raw: string, business: Brand & { domain: string }): string | null {
  const question = raw.replace(/\s+/g, " ").trim().replace(/\s+\?$/, "?");
  if (question.length < 12 || question.length > 200 || !question.endsWith("?")) return null;
  const matcher = brandMatcher(business);
  if (matcher && matcher.test(question) >= 0) return null;
  return question[0].toUpperCase() + question.slice(1);
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
