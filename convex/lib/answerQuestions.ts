/** Pentra Answers (Nov 2026): the buyer questions. One model call writes the questions real buyers type into AI assistants
 * before they know which company to pick; Pentra asks the assistants exactly these, week after week. Pure. */
import { ANSWER_QUESTION_INTENTS, cleanQuestion, questionKey, type Brand } from "./answerEngine.ts";
import { toolOnlyInstruction } from "./toolChoice.ts";

/** The same model and price as the page writer (lib/answerPages.ts ANSWER_WRITER_MODEL): the questions decide what Pentra
 * measures. Two attempts at most ~6K tokens in and 16K out ($0.35 each). */
export const QUESTION_MODEL = "claude-opus-5-5";
export const QUESTION_TOOL = "submit_buyer_questions";
export const QUESTION_MAX_TOKENS = 16_000;
export const QUESTION_HOLD_MICRO_USD = 700_000;

export type QuestionBusiness = Brand & { domain: string; summary: string; audience: string; features: readonly string[]; problems: readonly string[];
  usage: string; pricing: string; market: string; siteType: string; language: string; competitors: readonly Brand[] };

export function questionsRequest(business: QuestionBusiness, count: number, existing: readonly string[]) {
  const competitorNames = business.competitors.map((c) => c.name).filter(Boolean).slice(0, 6);
  const system = [
    "You write the questions real buyers type into AI assistants (ChatGPT, Perplexity, Gemini, Google's AI) when they need what a business offers, before they know which company to choose.",
    "Rules:",
    "- Each question is one plain sentence a real buyer would type, ending with a question mark. Use the words buyers use, not marketing language.",
    "- Be specific about the need, the kind of product or service, and who it is for (their role, size, trade or situation).",
    `- Never name any business, brand or product: not the business itself (${business.name}, ${business.domain})${competitorNames.length ? `, not its competitors (${competitorNames.join(", ")})` : ""}, not anyone else. Ask the way a buyer who doesn't know the options yet would.`,
    `- Mix the intents: recommendation ("What's the best ... for ...?", "Which ... should I use ...?"), how_to (the problems it solves: "How do I ...?"), cost ("How much does ... cost ...?"), comparison (kinds of solution against each other, never named companies), problem (the pain in the buyer's words), and local (only if the business serves a place: include the place).`,
    "- No definitions, no job or career questions, no questions only an existing customer would ask, no duplicates of the questions already tracked.",
    `- Write in the language of the market (${business.language || "en"}).`,
    toolOnlyInstruction(QUESTION_TOOL),
  ].join("\n");
  const userMessage = [
    `Business: ${business.name} (${business.domain})${business.siteType ? `, ${business.siteType}` : ""}`,
    business.summary ? `What it sells: ${business.summary}` : "",
    business.audience ? `Who buys it: ${business.audience}` : "",
    business.features.length ? `What it does: ${business.features.slice(0, 10).join("; ")}` : "",
    business.problems.length ? `Problems and questions its customers have: ${business.problems.slice(0, 10).join("; ")}` : "",
    business.usage ? `How customers use it: ${business.usage}` : "",
    business.pricing ? `Pricing: ${business.pricing.slice(0, 400)}` : "",
    business.market ? `Market: ${business.market}` : "",
    existing.length ? `Already tracked (don't repeat):\n${existing.slice(0, 60).map((q) => `- ${q}`).join("\n")}` : "",
    `Write ${count} questions.`,
  ].filter(Boolean).join("\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["questions"],
    properties: { questions: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["question", "intent"],
      properties: { question: { type: "string" as const }, intent: { type: "string" as const, enum: [...ANSWER_QUESTION_INTENTS] } } } } },
  };
  return { system, userMessage, inputSchema };
}

/** The reply's questions, cleaned and once each (by their words), none naming the business, none already tracked. */
export function parseQuestions(raw: unknown, business: Brand & { domain: string; competitors?: readonly Brand[] }, existing: readonly string[], max: number):
  Array<{ question: string; intent: string }> {
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  const seen = new Set(existing.map(questionKey));
  const out: Array<{ question: string; intent: string }> = [];
  for (const item of list) {
    const q = item as { question?: unknown; intent?: unknown };
    if (typeof q.question !== "string") continue;
    const question = cleanQuestion(q.question, business, business.competitors ?? []);
    if (!question) continue;
    const key = questionKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question, intent: typeof q.intent === "string" && (ANSWER_QUESTION_INTENTS as readonly string[]).includes(q.intent) ? q.intent : "problem" });
    if (out.length >= max) break;
  }
  return out;
}
