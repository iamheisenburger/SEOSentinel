/** Pentra Answers (Nov 2026): the answer page, as a pure contract. One page answers one buyer question so an assistant can
 * quote it: the direct answer first, real substance, the business presented honestly where it truly fits (only its
 * confirmed facts), every outside claim cited, and every fact listed with where it came from. */
import { readerVisibleIssues } from "./articleQuality.ts";
import { rebuildSourcesSection } from "./backedFacts.ts";
import { sha256Hex } from "./publicationArtifact.ts";
import { answerSlug, brandMatcher } from "./answerEngine.ts";
import { toolOnlyInstruction } from "./toolChoice.ts";

/** Opus 5.5 writes the pages and the questions (Arshad, Nov 8 2026: the premium plan gets the best writer). Thinking is
 * always on (adaptive, effort medium) and counts toward max_tokens and output tokens; forced tool_choice is refused, so the
 * call uses "auto" with the tool as its only option (lib/toolChoice.ts). */
export const ANSWER_WRITER_MODEL = "claude-opus-5-5";
export const ANSWER_WRITER_PRICE = { inputUsdPerMillion: 4, outputUsdPerMillion: 20 };
export const ANSWER_WRITER_MAX_TOKENS = 16_000;
export const ANSWER_PAGE_TOOL = "submit_answer_page";
/** Held before a page is written: a draft and at most one revision, each at most ~30K tokens in and 16K out ($0.44);
 * a page usually costs ~$0.30. */
export const ANSWER_PAGE_HOLD_MICRO_USD = 900_000;
export const ANSWER_PAGE_MIN_WORDS = 450;
export const ANSWER_PAGE_FLOOR_WORDS = 350;
export const ANSWER_PAGE_MAX_WORDS = 1_600;
export const ANSWER_SOURCE_EXCERPT_CHARS = 2_800;

export const writerCostMicroUsd = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * ANSWER_WRITER_PRICE.inputUsdPerMillion +
    Math.max(0, usage?.output_tokens ?? 0) * ANSWER_WRITER_PRICE.outputUsdPerMillion);

export type PageSource = { n: number; url: string; title?: string; excerpt: string; contentHash: string; retrievedAt: number };
export type AnswerLandscape = Array<{ assistant: string; excerpt: string; named: boolean; competitorsNamed: readonly string[] }>;

export function pageSource(n: number, url: string, title: string | undefined, text: string, retrievedAt: number): PageSource {
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, ANSWER_SOURCE_EXCERPT_CHARS);
  return { n, url, ...(title ? { title } : {}), excerpt, contentHash: sha256Hex(excerpt), retrievedAt };
}

export function answerPageRequest(args: { question: string; businessName: string; productEvidence: string; market: string; language: string;
  landscape: AnswerLandscape; sources: readonly PageSource[]; mayName: readonly string[]; revision?: { markdown: string; issues: readonly string[] } }) {
  const system = [
    `You write one answer page for ${args.businessName}'s website. It answers a single question that buyers ask AI assistants (ChatGPT, Perplexity, Gemini, Google), so that an assistant can quote it and a buyer can trust it.`,
    "Rules:",
    "1. The first paragraph answers the question directly in two or three sentences (at most 60 words): the answer a buyer needs, no preamble.",
    "2. Then the substance: what matters, how to do it, what it costs, what to watch out for. Be specific and practical. Use numbers only from the business facts or the numbered sources.",
    `3. Present ${args.businessName} honestly as a solution where it truly fits: what it does, who it is for, what it costs, using ONLY the business facts given. Include one section whose heading says how ${args.businessName} handles this. Be fair: say plainly when another kind of option fits a buyer better. Never invent features, prices, customers, results, reviews, quotes or personal experience. When the configured facts and the crawled live pages disagree (a price, an offer, a guarantee, a number), trust the live pages and leave the conflicting claim out.`,
    "4. Every statistic or claim that comes from outside the business facts carries a citation marker like [2] matching the numbered sources. If no source supports a claim, leave the claim out.",
    `5. Name other companies only when the question asks about them, and then only with facts from the sources. Allowed names: ${args.mayName.length ? args.mayName.join(", ") : "none"}.`,
    "6. Subheadings are the buyer's follow-up questions in plain words. Short paragraphs. End with a short FAQ: three or four questions, each answered in one to three sentences.",
    `7. Length: ${ANSWER_PAGE_MIN_WORDS}-1100 words in the body. Plain, confident English (or the market's language if it isn't English: ${args.language}). No filler, no hype words, no "in today's fast-paced world".`,
    "8. Do not write the page title as a heading in the body, and do not add a Sources section: the page adds both.",
    "9. In `facts`, list every factual statement the page makes, each with where it comes from: \"business\" (the business facts) or \"source\" with its number.",
    toolOnlyInstruction(ANSWER_PAGE_TOOL),
  ].join("\n");
  const userMessage = [
    `Question: ${args.question}`,
    `Market: ${args.market || "not stated"}. Language: ${args.language || "en"}.`,
    `Business facts (the only facts about ${args.businessName} you may state):\n${args.productEvidence}`,
    args.landscape.length
      ? `What AI assistants answer today (to see what is missing; never copy):\n${args.landscape.slice(0, 5).map((a) =>
        `- ${a.assistant}${a.named ? ` (names ${args.businessName})` : ""}${a.competitorsNamed.length ? ` (names ${a.competitorsNamed.join(", ")})` : ""}: ${a.excerpt.slice(0, 700)}`).join("\n")}`
      : "",
    args.sources.length
      ? `Numbered sources (cite as [n]):\n${args.sources.map((s) => `[${s.n}] ${s.title ?? s.url} — ${s.url}\n${s.excerpt}`).join("\n\n")}`
      : "No outside sources were readable: state only the business facts and general, unquantified guidance.",
    args.revision ? `Your previous draft had these problems. Fix every one and resubmit the whole page:\n${args.revision.issues.map((i) => `- ${i}`).join("\n")}\n\nPrevious draft:\n${args.revision.markdown}` : "",
  ].filter(Boolean).join("\n\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["title", "metaDescription", "markdown", "facts"],
    properties: {
      title: { type: "string" as const, description: "At most 70 characters: the question or a direct rephrasing of it." },
      metaDescription: { type: "string" as const, description: "At most 155 characters: the direct answer." },
      markdown: { type: "string" as const, description: "The page body in Markdown, without a title heading or Sources section." },
      facts: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["text", "source"],
        properties: { text: { type: "string" as const }, source: { type: "string" as const, enum: ["business", "source"] },
          sourceNumber: { type: "integer" as const } } } },
    },
  };
  return { system, userMessage, inputSchema };
}

export type DraftPage = { title: string; metaDescription: string; markdown: string; facts: Array<{ text: string; source: string; url?: string }> };

const words = (markdown: string) => markdown.replace(/[#>*_`|[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
export const pageWords = words;

/** The writer's reply as a page: sources section rebuilt from the citations it actually makes, the title kept short, facts
 * tied to their source addresses. `null` when the reply isn't a page. */
export function parseDraftPage(raw: unknown, sources: readonly PageSource[]): DraftPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; metaDescription?: unknown; markdown?: unknown; facts?: unknown };
  if (typeof r.title !== "string" || typeof r.markdown !== "string" || typeof r.metaDescription !== "string") return null;
  let markdown = r.markdown.replace(/^#\s+[^\n]*\n+/, "").replace(/\n#{1,3}\s*Sources\s*\n[\s\S]*$/i, "").trim();
  if (sources.length) markdown = rebuildSourcesSection(`${markdown}\n\n## Sources\n\n1. placeholder`, sources.map((s) => ({ url: s.url, ...(s.title ? { title: s.title } : {}) })));
  markdown = markdown.replace(/\n## Sources\n\n1\. placeholder$/, "").trim();
  const byNumber = new Map(sources.map((s) => [s.n, s.url]));
  const facts = (Array.isArray(r.facts) ? r.facts : []).flatMap((f) => {
    const fact = f as { text?: unknown; source?: unknown; sourceNumber?: unknown };
    if (typeof fact.text !== "string" || !fact.text.trim()) return [];
    const source = fact.source === "source" ? "source" : "business";
    const url = source === "source" && typeof fact.sourceNumber === "number" ? byNumber.get(fact.sourceNumber) : undefined;
    return [{ text: fact.text.trim().slice(0, 300), source, ...(url ? { url } : {}) }];
  }).slice(0, 60);
  return { title: r.title.trim().replace(/\s+/g, " ").slice(0, 90), metaDescription: r.metaDescription.trim().replace(/\s+/g, " ").slice(0, 170), markdown, facts };
}

/** What stops a page from going out, objectively (rule 2a): pipeline text, a number its cited source doesn't contain, a
 * product number the business facts don't contain, a citation to no source; plus the page's own contract: long enough to
 * help, names the business, answers first. `blocking` must be empty to publish; `notes` are shown, never block. */
export function checkDraftPage(page: DraftPage, args: { businessName: string; businessDomain: string; sources: readonly PageSource[];
  productEvidence: string }): { blocking: string[]; notes: string[] } {
  const productEvidenceHash = sha256Hex(args.productEvidence);
  const blocking = readerVisibleIssues({ markdown: page.markdown, sources: args.sources.map((s) => ({ url: s.url, title: s.title, excerpt: s.excerpt,
    contentHash: s.contentHash })), productEvidenceSnapshot: args.productEvidence, productEvidenceHash });
  const notes: string[] = [];
  const count = words(page.markdown);
  if (count < ANSWER_PAGE_FLOOR_WORDS) blocking.push(`The page is ${count} words; an answer page needs at least ${ANSWER_PAGE_MIN_WORDS} to help a buyer.`);
  else if (count < ANSWER_PAGE_MIN_WORDS) notes.push(`The page is ${count} words, a little under the ${ANSWER_PAGE_MIN_WORDS} aimed for.`);
  if (count > ANSWER_PAGE_MAX_WORDS) notes.push(`The page is ${count} words, longer than needed.`);
  const cited = [...page.markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const known = new Set(args.sources.map((s) => s.n));
  const unknown = [...new Set(cited.filter((n) => !known.has(n)))];
  if (unknown.length) blocking.push(`The page cites [${unknown.join("], [")}], which is not one of its sources.`);
  const matcher = brandMatcher({ name: args.businessName, domain: args.businessDomain });
  if (matcher && matcher.test(page.markdown) < 0) blocking.push(`The page never names ${args.businessName}.`);
  const firstParagraph = page.markdown.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#")) ?? "";
  if (words(firstParagraph) > 90) notes.push("The first paragraph is long; the direct answer should come in two or three sentences.");
  if (!/^#{2,3}\s/m.test(page.markdown)) notes.push("The page has no subheadings.");
  return { blocking: [...new Set(blocking)], notes };
}

/** A unique address for a page on its site. */
export function uniqueSlug(question: string, taken: ReadonlySet<string>): string {
  const base = answerSlug(question);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

export const pageContentHash = (page: { title: string; metaDescription: string; markdown: string }) =>
  sha256Hex(`${page.title}\n${page.metaDescription}\n${page.markdown}`);
