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
/** treg's endpoint for each assistant (crawl4ai: ChatGPT as a logged-out visitor sees it, and Google AI Mode; cloro: Gemini). */
export const AI_ASSISTANT_ENDPOINTS: Record<AiAssistant, string> = {
  chatgpt: "crawl4ai.ai-search.chatgpt.scrape", gemini: "cloro.ai-search.gemini.scrape", google_ai_mode: "crawl4ai.google.serp.ai_mode" };

export type Business = { name: string; domain: string; summary?: string; audience?: string; features?: string[]; problems?: string[]; country?: string | null };
export type AiAnswerCheck = { question: string; assistant: AiAssistant; answered: boolean; named: boolean; cited: boolean };

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
  if (assistant === "gemini") {
    const result = (payload as { success?: unknown; result?: { text?: unknown; markdown?: unknown; sources?: unknown; citationPills?: unknown } } | null)?.result;
    const text = typeof result?.text === "string" ? result.text : typeof result?.markdown === "string" ? result.markdown : "";
    return text ? { text, sources: [...urls(result?.sources), ...urls(result?.citationPills)] } : null;
  }
  const reply = payload as { answered?: unknown; answer?: { text?: unknown; sources?: unknown } } | null;
  const text = reply?.answered !== false && typeof reply?.answer?.text === "string" ? reply.answer.text : "";
  return text ? { text, sources: urls(reply?.answer?.sources) } : null;
}

/** The diagnosis's AI-answer input from the checks: answers that named the business, of the answers given. */
export function aiAnswerTotals(checks: readonly AiAnswerCheck[]) {
  const answered = checks.filter((c) => c.answered);
  const byAssistant = AI_ASSISTANTS.map((assistant) => {
    const mine = answered.filter((c) => c.assistant === assistant);
    return { assistant, asked: mine.length, named: mine.filter((c) => c.named).length };
  }).filter((a) => a.asked > 0);
  return { asked: answered.length, named: answered.filter((c) => c.named).length, cited: answered.filter((c) => c.cited).length, byAssistant };
}
