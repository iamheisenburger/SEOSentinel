/** AI answers, measured (Nov 2026): the fifth thing traffic needs. The questions a buyer asks an AI assistant when choosing
 * what the business sells go, unchanged week to week, to ChatGPT, Gemini and Google AI Mode (through treg); each answer
 * counts when it names the business or cites its site. The diagnosis's "ai" factor is this measurement, never a guess. */
import { BUYER_FIT_MODEL } from "./topicFit.ts";

export const AI_QUESTIONS_TOOL = "submit_buyer_questions";
export const AI_QUESTIONS_MODEL = BUYER_FIT_MODEL;
export const AI_QUESTIONS_MAX_TOKENS = 1200;
export const AI_QUESTION_COUNT = 5;
export type AiAssistant = "chatgpt" | "gemini" | "google_ai_mode";
export const AI_ASSISTANTS: readonly AiAssistant[] = ["chatgpt", "gemini", "google_ai_mode"];
export const AI_ASSISTANT_NAMES: Record<AiAssistant, string> = { chatgpt: "ChatGPT", gemini: "Gemini", google_ai_mode: "Google AI Mode" };
/** treg's endpoint for each assistant: crawl4ai for ChatGPT as a logged-out visitor sees it, cloro for Gemini and Google AI
 * Mode (crawl4ai's AI Mode answers only short searches; a buyer's question came back "no direct answer", Nov 5 2026). */
export const AI_ASSISTANT_ENDPOINTS: Record<AiAssistant, string> = {
  chatgpt: "crawl4ai.ai-search.chatgpt.scrape", gemini: "cloro.ai-search.gemini.scrape", google_ai_mode: "cloro.google.serp.ai_mode" };

/** A market as the two-letter country code the assistants' providers take ("United States" is US, never "UN"). */
export function countryCode(country: string | null | undefined): string {
  const key = (country ?? "").trim().toLowerCase();
  if (/^[a-z]{2}$/.test(key)) return key === "uk" ? "GB" : key.toUpperCase();
  const names: Record<string, string> = { "united states": "US", usa: "US", "united states of america": "US", america: "US",
    "united kingdom": "GB", "great britain": "GB", england: "GB", canada: "CA", australia: "AU", germany: "DE", france: "FR", india: "IN",
    brazil: "BR", japan: "JP", spain: "ES", italy: "IT", netherlands: "NL", sweden: "SE", singapore: "SG", "united arab emirates": "AE",
    uae: "AE", mexico: "MX", ireland: "IE", "new zealand": "NZ", "south africa": "ZA" };
  return names[key] ?? "US";
}

export type Business = { name: string; domain: string; summary?: string; audience?: string; features?: string[]; problems?: string[]; country?: string | null };
export type AiAnswerCheck = { question: string; assistant: AiAssistant; answered: boolean; named: boolean; cited: boolean;
  /** Phase 5 (Nov 2026): the sites the answer cited (hosts, without "www."), so Pentra knows where buyers' answers come from. */
  sources?: string[];
  /** Phase 4 (P368): the pages it cited (at most 8), so the ones that list the site's competitors can be approached. */
  pages?: string[];
  /** Phase 5 (P369): the rivals the answer names (the business's competitors and the sites on its page one). */
  rivals?: string[];
  /** Why no answer came back (an HTTP status, "timeout", "no answer"), when none did. */
  error?: string };

/** The cited sites of an answer: hosts, once each, the business's own left out, at most ten. */
export function citedHosts(sources: readonly string[], business: Pick<Business, "domain">): string[] {
  const own = business.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const hosts = sources.flatMap((source) => { try { return [new URL(source).hostname.toLowerCase().replace(/^www\./, "")]; } catch { return []; } })
    .filter((host) => host && host !== own && !host.endsWith(`.${own}`) && !/(^|\.)google\.[a-z.]+$|(^|\.)vertexaisearch\.cloud\.google\.com$/.test(host));
  return [...new Set(hosts)].slice(0, 10);
}

/** Phase 5: the sites the assistants cite most across the week's answers (how many answers cite each): where the business
 * needs to be listed or mentioned for buyers' AI answers to name it. */
export function topCitedSites(checks: readonly AiAnswerCheck[], limit = 5): Array<{ site: string; answers: number }> {
  const counts = new Map<string, number>();
  for (const check of checks) if (check.answered) for (const host of new Set(check.sources ?? [])) counts.set(host, (counts.get(host) ?? 0) + 1);
  return [...counts].map(([site, answers]) => ({ site, answers })).filter((s) => s.answers >= 2)
    .sort((a, b) => b.answers - a.answers || a.site.localeCompare(b.site)).slice(0, limit);
}
/** The AI-answer factor is judged only on at least this many answers; fewer is "not measured", never a verdict. */
export const AI_MIN_ANSWERS = 5;

/** One cheap model call writes the buyer questions, from what the business sells and the searches buyers already make. */
export function aiQuestionsRequest(business: Business, buyerSearches: readonly string[]) {
  const system = "You write the questions a buyer asks an AI assistant (ChatGPT, Gemini, Google's AI Mode) when choosing a product or " +
    "service like the one described. Each question is something a real buyer would type before they know which company to pick: " +
    "it names the need, the kind of product and who it's for, never this business or any other company. No definitions, no job or " +
    "career questions, no questions only an existing customer would ask. Plain English, one sentence, ending with a question mark.";
  const userMessage = [
    `Business: ${business.name} (${business.domain})`,
    business.summary ? `What it sells: ${business.summary}` : "",
    business.audience ? `Who buys it: ${business.audience}` : "",
    business.features?.length ? `What it does: ${business.features.slice(0, 8).join("; ")}` : "",
    business.problems?.length ? `Problems it solves: ${business.problems.slice(0, 6).join("; ")}` : "",
    business.country ? `Market: ${business.country}` : "",
    buyerSearches.length ? `Searches buyers already make: ${buyerSearches.slice(0, 15).join("; ")}` : "",
    `Write ${AI_QUESTION_COUNT} questions.`,
  ].filter(Boolean).join("\n");
  const inputSchema = { type: "object" as const, additionalProperties: false, required: ["questions"],
    properties: { questions: { type: "array" as const, items: { type: "string" as const } } } };
  return { system, userMessage, inputSchema };
}

/** The questions a reply gives, cleaned: real questions, never naming the business, no repeats, at most five. */
export function parseAiQuestions(raw: unknown, business: Pick<Business, "name" | "domain">): string[] {
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const question = item.replace(/\s+/g, " ").trim();
    if (question.length < 15 || question.length > 220 || !question.endsWith("?") || mentionsBusiness(question, business)) continue;
    if (!out.some((q) => q.toLowerCase() === question.toLowerCase())) out.push(question);
    if (out.length >= AI_QUESTION_COUNT) break;
  }
  return out;
}

/** "LeadPilot" also matches "Lead Pilot"; "pentra" matches only the whole word. */
function brandPattern(name: string): RegExp | null {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.join("").length < 3) return null;
  return new RegExp(`\\b${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]?")}\\b`, "i");
}

const bareHost = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");

export function mentionsBusiness(text: string, business: Pick<Business, "name" | "domain">): boolean {
  const host = bareHost(business.domain);
  if (host && text.toLowerCase().includes(host)) return true;
  const pattern = brandPattern(business.name);
  return pattern ? pattern.test(text) : false;
}

/** Whether one answer names the business (in its words) or cites its site (among its sources). */
export function judgeAnswer(answer: { text: string; sources: readonly string[] }, business: Pick<Business, "name" | "domain">): { named: boolean; cited: boolean } {
  const host = bareHost(business.domain);
  const cited = answer.sources.some((url) => { const h = bareHost(url); return h === host || h.endsWith(`.${host}`); });
  return { named: mentionsBusiness(answer.text, business) || cited, cited };
}

/** The answer text and source addresses from each provider's reply (treg relays the provider's own body). */
export function parseAssistantAnswer(assistant: AiAssistant, payload: unknown): { text: string; sources: string[] } | null {
  const urls = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => typeof item === "string" ? [item]
      : item && typeof item === "object" ? [((item as { url?: unknown; link?: unknown; href?: unknown }).url ??
        (item as { link?: unknown }).link ?? (item as { href?: unknown }).href)].filter((u): u is string => typeof u === "string") : []);
  };
  if (assistant === "chatgpt") {
    const row = (payload as { rows?: Array<{ answer_text?: unknown; answer?: unknown; citations?: unknown; sources?: unknown }> } | null)?.rows?.[0];
    const text = typeof row?.answer_text === "string" ? row.answer_text : typeof row?.answer === "string" ? row.answer : "";
    return text ? { text, sources: [...urls(row?.citations), ...urls(row?.sources)] } : null;
  }
  // cloro (Gemini, Google AI Mode): { success, result: { text, markdown, sources } }; crawl4ai's AI Mode shape is read too.
  const result = (payload as { success?: unknown; result?: { text?: unknown; markdown?: unknown; sources?: unknown; citationPills?: unknown } } | null)?.result;
  const cloroText = typeof result?.text === "string" ? result.text : typeof result?.markdown === "string" ? result.markdown : "";
  if (cloroText) return { text: cloroText, sources: [...urls(result?.sources), ...urls(result?.citationPills)] };
  const reply = payload as { answered?: unknown; answer?: { text?: unknown; sources?: unknown } } | null;
  const text = assistant === "google_ai_mode" && reply?.answered !== false && typeof reply?.answer?.text === "string" ? reply.answer.text : "";
  return text ? { text, sources: urls(reply?.answer?.sources) } : null;
}

/** The diagnosis's AI-answer input from the checks: answers that named the business, of the answers given. */
/** Phase 5 (P369): who the assistants name instead of the business: its competitors (from its confirmed profile and the
 * sites on its page one), matched by their address or their name written as a name, capitalised ("Instantly" is a brand,
 * "instantly" an everyday word). */
export type RivalMatcher = { name: string; test: (text: string) => boolean };
export function rivalMatchers(rivals: readonly string[], business: Pick<Business, "domain">): RivalMatcher[] {
  const own = bareHost(business.domain), out = new Map<string, RivalMatcher>();
  for (const raw of rivals) {
    const host = bareHost(raw);
    if (!host || host === own || host.endsWith(`.${own}`)) continue;
    const isHost = /\.[a-z]{2,}$/.test(host);
    const base = (isHost ? host.replace(/\.[a-z.]+$/, "") : host).replace(/[^a-z0-9]+/g, "");
    if (base.length < 3) continue;
    const name = isHost ? host : raw.trim().slice(0, 60);
    // One rival per name: "LeadGenApp" and "leadgenapp.io" are the same company.
    if (out.has(base)) continue;
    const word = new RegExp(`\\b${base[0].toUpperCase()}${[...base.slice(1)].map((c) => /[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c).join("")}\\b`);
    out.set(base, { name, test: (text) => (isHost && text.toLowerCase().includes(host)) || word.test(text) });
  }
  return [...out.values()].slice(0, 20);
}
export const rivalsNamed = (text: string, matchers: readonly RivalMatcher[]) => matchers.filter((m) => m.test(text)).map((m) => m.name).slice(0, 10);
/** The rivals named in two answers or more, most first. */
export function topRivals(checks: readonly AiAnswerCheck[], limit = 5): Array<{ name: string; answers: number }> {
  const counts = new Map<string, number>();
  for (const check of checks) if (check.answered) for (const name of new Set(check.rivals ?? [])) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, answers]) => ({ name, answers }));
}

export function aiAnswerTotals(checks: readonly AiAnswerCheck[]) {
  const answered = checks.filter((c) => c.answered);
  const byAssistant = AI_ASSISTANTS.map((assistant) => {
    const mine = answered.filter((c) => c.assistant === assistant);
    return { assistant, asked: mine.length, named: mine.filter((c) => c.named).length };
  }).filter((a) => a.asked > 0);
  return { asked: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length, byAssistant,
    citedSites: topCitedSites(checks), namedInstead: topRivals(checks) };
}
