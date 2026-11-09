/** Pentra Answers (Nov 2026): the answer page, as a pure contract. One page answers one buyer question so an assistant can
 * quote it: the direct answer first, real substance, the business presented honestly where it truly fits (only its
 * confirmed facts), every outside claim cited, and every fact listed with where it came from. */
import { readerVisibleIssues } from "./articleQuality.ts";
import { rebuildSourcesSection } from "./backedFacts.ts";
import { sha256Hex } from "./publicationArtifact.ts";
import { answerSlug, brandMatcher, hostOf, type Brand } from "./answerEngine.ts";
import { toolOnlyInstruction } from "./toolChoice.ts";
import { htmlToText, looksLikeMarkup } from "./pageText.ts";

/** Opus 5.5 writes the pages and the questions (Arshad, Nov 8 2026: the premium plan gets the best writer). Thinking is
 * always on (adaptive, effort medium) and counts toward max_tokens and output tokens; forced tool_choice is refused, so the
 * call uses "auto" with the tool as its only option (lib/toolChoice.ts). */
export const ANSWER_WRITER_MODEL = "claude-opus-5-5";
export const ANSWER_WRITER_PRICE = { inputUsdPerMillion: 4, outputUsdPerMillion: 20 };
export const ANSWER_WRITER_MAX_TOKENS = 16_000;
export const ANSWER_PAGE_TOOL = "submit_answer_page";
/** Held before a page is written: a draft and at most one revision, each at most ~30K tokens in and 16K out ($0.44);
 * a page usually costs ~$0.30. */
export const ANSWER_PAGE_HOLD_MICRO_USD = 1_100_000;
export const ANSWER_PAGE_MIN_WORDS = 450;
export const ANSWER_PAGE_FLOOR_WORDS = 350;
export const ANSWER_PAGE_MAX_WORDS = 1_600;
/** How much of each source the writer reads (and the checks compare numbers against): its text, not its HTML. */
export const ANSWER_SOURCE_EXCERPT_CHARS = 6_000;
/** The quote the sources box shows: the passage the page relied on. */
export const ANSWER_SOURCE_QUOTE_CHARS = 360;

export const writerCostMicroUsd = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * ANSWER_WRITER_PRICE.inputUsdPerMillion +
    Math.max(0, usage?.output_tokens ?? 0) * ANSWER_WRITER_PRICE.outputUsdPerMillion);

export type PageSource = { n: number; url: string; title?: string; excerpt: string; contentHash: string; retrievedAt: number };
export type AnswerLandscape = Array<{ assistant: string; excerpt: string; named: boolean; competitorsNamed: readonly string[] }>;

export function pageSource(n: number, url: string, title: string | undefined, text: string, retrievedAt: number): PageSource {
  // A source is always its words: raw HTML (Cowork's test 2 showed "<!DOCTYPE html>…" as a quote) is turned into text.
  const readable = looksLikeMarkup(text) ? htmlToText(text) : text;
  const excerpt = readable.replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, ANSWER_SOURCE_EXCERPT_CHARS);
  return { n, url, ...(title ? { title } : {}), excerpt, contentHash: sha256Hex(excerpt), retrievedAt };
}

export function answerPageRequest(args: { question: string; businessName: string; productEvidence: string; market: string; language: string;
  landscape: AnswerLandscape; sources: readonly PageSource[]; competitorNames: readonly string[]; revision?: { markdown: string; issues: readonly string[] } }) {
  const system = [
    `You write one answer page for ${args.businessName}'s website. It answers a single question that buyers ask AI assistants (ChatGPT, Perplexity, Gemini, Google), so that an assistant can quote it and a buyer can trust it.`,
    "Rules:",
    "1. The first paragraph answers the question directly in two or three sentences (at most 60 words): the answer a buyer needs, no preamble.",
    "2. Then the substance: what matters, how to do it, what it costs, what to watch out for. Be specific and practical. Use numbers only from the business facts or the numbered sources.",
    `3. Present ${args.businessName} as the answer where its facts show it fits: what it offers for this, who it is for, what it costs, using ONLY the business facts and its own crawled pages. Include one section whose heading says how ${args.businessName} handles this. Never invent features, prices, customers, results, reviews, quotes or personal experience. When the configured facts and the crawled live pages disagree (a price, an offer, a guarantee, a number), trust the live pages and leave the conflicting claim out.`,
    `3b. Every fact about ${args.businessName} (what it offers, how it works, where it is, its prices, plans, policies, data handling, staff) comes from the business facts below and nowhere else. The assistants' answers and the numbered sources are often wrong or out of date about ${args.businessName}: never take a fact about ${args.businessName} from them, and never put a source's citation marker on a sentence about ${args.businessName}.`,
    `4. Never say or imply that ${args.businessName} does not offer, do or include something unless its own pages say so in those words. If its pages don't mention something, say nothing about it. Never write that its site or pages don't mention, list or say something, and never write that something couldn't be found, confirmed or verified: leave it out.`,
    `5. Never name, link to or recommend another business, never give another business's phone number, address or website, and never send the reader to one${args.competitorNames.length ? ` (in particular: ${args.competitorNames.join(", ")})` : ""}. Where a buyer needs something ${args.businessName} doesn't show it offers, describe the kind of help to look for in general terms only. Product or brand names the business facts themselves use (a treatment, tool or partner of ${args.businessName}) are fine. The only links in the body are ${args.businessName}'s own pages.`,
    "5b. Every statistic or claim that comes from outside the business facts carries a citation marker like [2] matching the numbered sources. If no source supports a claim, leave the claim out.",
    "6. Subheadings are the buyer's follow-up questions in plain words. Short paragraphs. End with a short FAQ: three or four questions, each answered in one to three sentences.",
    `7. Length: ${ANSWER_PAGE_MIN_WORDS}-1100 words in the body. Plain, confident English (or the market's language if it isn't English: ${args.language}). No filler, no hype words, no "in today's fast-paced world".`,
    "8. Do not write the page title as a heading in the body, and do not add a Sources section: the page adds both.",
    "9. In `facts`, list every factual statement the page makes, each with where it comes from: \"business\" (the business facts) or \"source\" with its number.",
    `10. In \`fit\`, say whether ${args.businessName}'s facts and pages show it offers what the question asks: \"strong\" (clearly), \"partial\" (some of it), or \"none\" (they don't show it). With \"none\", submit a short page and say why in \`fitReason\`: it won't be published.`,
    toolOnlyInstruction(ANSWER_PAGE_TOOL),
  ].join("\n");
  const userMessage = [
    `Question: ${args.question}`,
    `Market: ${args.market || "not stated"}. Language: ${args.language || "en"}.`,
    `Business facts: ${args.businessName}'s confirmed profile and its own pages, read today (the only facts about ${args.businessName} you may state):\n${args.productEvidence}`,
    args.landscape.length
      ? `What AI assistants answer today (to see what is missing; never copy, and never trust what they say about ${args.businessName}):\n${args.landscape.slice(0, 5).map((a) =>
        `- ${a.assistant}${a.named ? ` (names ${args.businessName})` : ""}${a.competitorsNamed.length ? ` (names ${a.competitorsNamed.join(", ")})` : ""}: ${a.excerpt.slice(0, 700)}`).join("\n")}`
      : "",
    args.sources.length
      ? `Numbered sources (cite as [n]):\n${args.sources.map((s) => `[${s.n}] ${s.title ?? s.url} — ${s.url}\n${s.excerpt}`).join("\n\n")}`
      : "No outside sources were readable: state only the business facts and general, unquantified guidance.",
    args.revision ? `Your previous draft had these problems. Fix every one and resubmit the whole page:\n${args.revision.issues.map((i) => `- ${i}`).join("\n")}\n\nPrevious draft:\n${args.revision.markdown}` : "",
  ].filter(Boolean).join("\n\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["title", "metaDescription", "markdown", "facts", "fit"],
    properties: {
      fit: { type: "string" as const, enum: ["strong", "partial", "none"] },
      fitReason: { type: "string" as const },
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

export type DraftPage = { title: string; metaDescription: string; markdown: string; facts: Array<{ text: string; source: string; url?: string }>;
  fit: "strong" | "partial" | "none"; fitReason?: string };

const words = (markdown: string) => markdown.replace(/[#>*_`|[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
export const pageWords = words;

/** The writer's reply as a page in the sources' own numbering (checks and a revision read it that way), the title kept
 * short, facts tied to their source addresses. `null` when the reply isn't a page. finalizeDraftPage numbers it for readers. */
export function parseDraftPage(raw: unknown, sources: readonly PageSource[]): DraftPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; metaDescription?: unknown; markdown?: unknown; facts?: unknown; fit?: unknown; fitReason?: unknown };
  if (typeof r.title !== "string" || typeof r.markdown !== "string" || typeof r.metaDescription !== "string") return null;
  const markdown = r.markdown.replace(/^#\s+[^\n]*\n+/, "").replace(/\n#{1,3}\s*Sources\s*\n[\s\S]*$/i, "").trim();
  const fit = r.fit === "none" || r.fit === "partial" ? r.fit : "strong";
  const byNumber = new Map(sources.map((s) => [s.n, s.url]));
  const facts = (Array.isArray(r.facts) ? r.facts : []).flatMap((f) => {
    const fact = f as { text?: unknown; source?: unknown; sourceNumber?: unknown };
    if (typeof fact.text !== "string" || !fact.text.trim()) return [];
    const source = fact.source === "source" ? "source" : "business";
    const url = source === "source" && typeof fact.sourceNumber === "number" ? byNumber.get(fact.sourceNumber) : undefined;
    return [{ text: fact.text.trim().slice(0, 300), source, ...(url ? { url } : {}) }];
  }).slice(0, 60);
  return { title: r.title.trim().replace(/\s+/g, " ").slice(0, 90), metaDescription: r.metaDescription.trim().replace(/\s+/g, " ").slice(0, 170), markdown, facts,
    fit, ...(typeof r.fitReason === "string" && r.fitReason.trim() ? { fitReason: r.fitReason.trim().slice(0, 300) } : {}) };
}

/** The page as readers get it: its citations numbered 1, 2, 3 in order of first use (no gaps, no source 1 missing), and a
 * Sources section listing exactly the sources it cites. Returns those sources, renumbered, to store with the page. */
export function finalizeDraftPage(page: DraftPage, sources: readonly PageSource[]): { page: DraftPage; sources: PageSource[] } {
  const known = new Map(sources.map((s) => [s.n, s]));
  const order: number[] = [];
  for (const m of page.markdown.matchAll(/\[(\d+)\]/g)) { const n = Number(m[1]); if (known.has(n) && !order.includes(n)) order.push(n); }
  const renumber = new Map(order.map((n, i) => [n, i + 1]));
  let markdown = page.markdown.replace(/\[(\d+)\]/g, (all, d: string) => renumber.has(Number(d)) ? `[${renumber.get(Number(d))}]` : all);
  const cited = order.map((n, i) => ({ ...known.get(n)!, n: i + 1 }));
  if (cited.length) {
    markdown = rebuildSourcesSection(`${markdown}\n\n## Sources\n\n1. placeholder`, cited.map((s) => ({ url: s.url, ...(s.title ? { title: s.title } : {}) })));
    markdown = markdown.replace(/\n## Sources\n\n1\. placeholder$/, "").trim();
  }
  return { page: { ...page, markdown }, sources: cited };
}

// ── Sentences a page must never print (Cowork's test 2, Nov 9 2026) ──

/** A page's prose sentences, as written (headings and the Sources section left out). */
export function pageSentences(markdown: string): string[] {
  const body = markdown.replace(/\n#{1,3}\s*Sources\s*\n[\s\S]*$/i, "");
  return body.split("\n").filter((line) => line.trim() && !/^\s*#/.test(line))
    .flatMap((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").split(/(?<=[.!?])\s+(?=[A-Z0-9"“(*])/))
    .map((s) => s.trim()).filter((s) => s.length > 3);
}

/** Text about the page's own research, never the buyer's answer: "Fathom's site doesn't mention weekly emails" (its features
 * page did), "this couldn't be confirmed". Leaving a thing out is right; saying the site lacks it is a false claim. */
const SITE_SILENCE = [
  /\b(?:web\s*site|site|homepage|home page|pages?|materials|listing)\s+(?:does\s*n[o']t|do\s*n[o']t|did\s*n[o']t|does not|do not|did not|never)\s+(?:explicitly\s+|clearly\s+|currently\s+)?(?:mention|say|list|show|state|specify|publish|include|describe|detail|confirm|indicate|address|cover)\b/i,
  /\b(?:does\s*n['’]t|does not|do not|don['’]t)\s+(?:explicitly\s+|publicly\s+)?(?:mention|list|publish|state|specify|advertise|disclose)\b[^.!?]{0,80}\b(?:on|in)\s+(?:its|their|the)\s+(?:own\s+)?(?:web\s*site|site|pages?|homepage)\b/i,
  /\b(?:is|are|was|were)\s+not\s+(?:mentioned|listed|stated|specified|shown|published|confirmed|detailed|disclosed)\b|\b(?:is|are|was|were)n['’]t\s+(?:mentioned|listed|stated|specified|shown|published|confirmed|detailed|disclosed)\b/i,
  /\bno\s+(?:mention|indication|information)\s+(?:of|about|on)\b|\b(?:could|can)(?:\s*not|n['’]t)\s+(?:find|confirm|verify)\b|\b(?:was|were)\s+unable\s+to\s+(?:find|confirm|verify)\b/i,
];
export const siteSilenceSentences = (markdown: string) => pageSentences(markdown).filter((s) => SITE_SILENCE.some((re) => re.test(s)));

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b|\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g;
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
/** Sentences that print a phone number the business's own facts don't have: another business's number (test 2's sources
 * box showed "Call Bristol Heights Dental at (208) 938-9912"). */
export function foreignPhoneSentences(markdown: string, productEvidence: string): string[] {
  const own = new Set([...productEvidence.matchAll(PHONE)].map((m) => digits(m[0])));
  return pageSentences(markdown).filter((s) => [...s.matchAll(PHONE)].some((m) => digits(m[0]).length >= 10 && !own.has(digits(m[0]))));
}

/** Hosts the body links to that are neither the business's own site nor in its facts (its configured booking link). */
export function outsideLinkHosts(markdown: string, businessDomain: string, productEvidence: string): string[] {
  const own = hostOf(businessDomain);
  const allowed = new Set([own, ...[...productEvidence.matchAll(/https?:\/\/[^\s)"'\]]+/g)].map((m) => hostOf(m[0]))]);
  const body = markdown.replace(/\n#{1,3}\s*Sources\s*\n[\s\S]*$/i, "");
  return [...new Set([...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)\]]+)/g)]
    .map((m) => hostOf(m[1] ?? m[2])).filter((h) => h && !allowed.has(h) && !h.endsWith(`.${own}`)))];
}

/** The body with links to those hosts turned into their words. */
export function unlinkHosts(markdown: string, hosts: readonly string[]): string {
  if (!hosts.length) return markdown;
  const banned = (url: string) => hosts.includes(hostOf(url));
  return markdown.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (all, words: string, url: string) => banned(url) ? words : all)
    .replace(/(?<![(\w])https?:\/\/[^\s)\]]+/g, (url) => banned(url) ? "" : url);
}

/** Sentences about the business that carry a source's citation marker: facts about it come only from its own pages. */
export function businessCitedSentences(markdown: string, business: Brand): string[] {
  const matcher = brandMatcher(business);
  if (!matcher) return [];
  return pageSentences(markdown).filter((s) => /\[\d+\]/.test(s) && matcher.test(s.replace(/\[\d+\]/g, "")) >= 0);
}

const flexible = (sentence: string) => sentence.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
/** The page with these sentences taken out (the edit pass: what is wrong about the business never goes out). A sentence
 * not found as written is reported, never guessed at. */
export function removeSentences(markdown: string, sentences: readonly string[]): { markdown: string; removed: string[]; missed: string[] } {
  let out = markdown;
  const removed: string[] = [], missed: string[] = [];
  for (const sentence of [...new Set(sentences.map((s) => s.trim()).filter((s) => s.length > 3))]) {
    const re = new RegExp(`[ \\t]*${flexible(sentence)}`);
    if (re.test(out)) { out = out.replace(re, ""); removed.push(sentence); } else missed.push(sentence);
  }
  out = out.split("\n").filter((line) => !/^\s*(?:[-*+]|\d+\.)\s*$/.test(line)).join("\n")
    .replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { markdown: out, removed, missed };
}

/** After the writer's one revision (the edit pass, rule 2a): sentences the business's own pages contradict or don't
 * support, sentences about what its site "doesn't mention", other businesses' phone numbers and sentences about the
 * business cited to someone else's page are removed; links out become plain words. */
export function editedDraft(draft: DraftPage, args: { businessName: string; businessDomain: string; productEvidence: string;
  ownProblems: ReadonlyArray<{ sentence: string }> }): DraftPage {
  const hosts = outsideLinkHosts(draft.markdown, args.businessDomain, args.productEvidence);
  const unlinked = unlinkHosts(draft.markdown, hosts);
  const wrong = [...args.ownProblems.map((p) => unlinkHosts(p.sentence, hosts)), ...siteSilenceSentences(unlinked), ...foreignPhoneSentences(unlinked, args.productEvidence),
    ...businessCitedSentences(unlinked, { name: args.businessName, domain: args.businessDomain })];
  const { markdown, removed } = removeSentences(unlinked, wrong);
  // A fact goes with the sentence that stated it: most of its words are in a removed sentence.
  const wordsOf = (s: string) => s.toLowerCase().replace(/\[\d+\]/g, " ").split(/[^a-z0-9%$]+/).filter((w) => w.length > 2);
  const gone = removed.map((s) => new Set(wordsOf(s)));
  const facts = draft.facts.filter((f) => {
    const words = wordsOf(f.text);
    return !words.length || !gone.some((set) => words.filter((w) => set.has(w)).length / words.length >= 0.7);
  });
  return { ...draft, markdown, facts };
}

/** The passage of a source a page relied on, for the sources box: the sentence that shares most with the page's sentences
 * citing it (numbers count most), with its neighbour when there is room. */
export function citedPassage(sourceText: string, citing: readonly string[], max = ANSWER_SOURCE_QUOTE_CHARS): string {
  const clean = (looksLikeMarkup(sourceText) ? htmlToText(sourceText) : sourceText).trim();
  if (!clean) return "";
  // Lines first (a heading is never glued to the sentence under it), then sentences.
  const sentences = clean.split(/\n+/).flatMap((line) => line.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)).map((s) => s.trim()).filter(Boolean);
  const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/\[\d+\]/g, " ").split(/[^a-z0-9%$.]+/).filter((w) => w.length > 3));
  const numbersOf = (s: string) => new Set((s.replace(/\[\d+\]/g, " ").match(/\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/[,.]$/, "")));
  const wanted = wordsOf(citing.join(" ")), numbers = numbersOf(citing.join(" "));
  let best = 0, bestScore = -1;
  sentences.forEach((s, i) => {
    if (s.length < 25) return;
    const w = wordsOf(s), n = numbersOf(s);
    const score = [...w].filter((x) => wanted.has(x)).length + 3 * [...n].filter((x) => numbers.has(x)).length;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  let passage = sentences[best] ?? clean;
  if (passage.length < max * 0.6 && sentences[best + 1] && passage.length + sentences[best + 1].length < max) passage = `${passage} ${sentences[best + 1]}`;
  return passage.length > max ? `${passage.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : passage;
}

/** What stops a page from going out, objectively (rule 2a): pipeline text, a number its cited source doesn't contain, a
 * product number the business facts don't contain, a citation to no source; plus the page's own contract: long enough to
 * help, names the business, answers first. `blocking` must be empty to publish; `notes` are shown, never block. */
export function checkDraftPage(page: DraftPage, args: { businessName: string; businessDomain: string; sources: readonly PageSource[];
  productEvidence: string; competitors?: readonly Brand[] }): { blocking: string[]; notes: string[] } {
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
  // A page on the business's own site never sends a buyer to a competitor: no competitor named, linked or cited.
  for (const rival of args.competitors ?? []) {
    const m = brandMatcher(rival, { caseSensitiveSingleWord: true });
    if (m && m.test(page.markdown) >= 0) blocking.push(`The page names ${rival.name}, a competitor. Remove it: pages never send buyers to a competitor.`);
    const host = rival.domain ? hostOf(rival.domain) : "";
    const linked = host && ([...page.markdown.matchAll(/https?:\/\/[^\s)\]]+/g)].some((u) => { const h = hostOf(u[0]); return h === host || h.endsWith(`.${host}`); })
      || args.sources.some((s) => { const h = hostOf(s.url); return h === host || h.endsWith(`.${host}`); }));
    if (linked) blocking.push(`The page links to ${host}, a competitor's site. Remove the link.`);
  }
  // Cowork's test 2: what a business's site "doesn't mention", another business's phone number, links out, and facts about
  // the business taken from someone else's page. The writer fixes them once; whatever is left is taken out (writePage).
  for (const s of siteSilenceSentences(page.markdown)) blocking.push(`Remove "${s.slice(0, 160)}": never say what ${args.businessName}'s site doesn't mention or what couldn't be confirmed; leave out what its facts don't cover.`);
  for (const s of foreignPhoneSentences(page.markdown, args.productEvidence)) blocking.push(`Remove "${s.slice(0, 160)}": it gives a phone number that isn't ${args.businessName}'s.`);
  for (const host of outsideLinkHosts(page.markdown, args.businessDomain, args.productEvidence)) blocking.push(`Remove the link to ${host}: the body links only to ${args.businessName}'s own pages (sources are cited by number).`);
  for (const s of businessCitedSentences(page.markdown, { name: args.businessName, domain: args.businessDomain })) {
    blocking.push(`"${s.slice(0, 160)}" states something about ${args.businessName} with a source's citation: facts about ${args.businessName} come only from its own pages. Keep the claim only if the business facts say it, without the citation; otherwise remove it.`);
  }
  const firstParagraph = page.markdown.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#")) ?? "";
  if (words(firstParagraph) > 90) notes.push("The first paragraph is long; the direct answer should come in two or three sentences.");
  if (!/^#{2,3}\s/m.test(page.markdown)) notes.push("The page has no subheadings.");
  return { blocking: [...new Set(blocking)], notes };
}

// ── Two reading checks by a second model (Sonnet 5.5): which sources may be used, and what the page says about the
// business that its own pages don't (Cowork's test 2: a competing dentist as a source; "EU servers only" against the
// business's own "stored in the US"). Both feed the writer's one revision; neither ever blocks a page on its own. ──

export const PAGE_CHECK_MODEL = "claude-sonnet-5-5";
export const PAGE_CHECK_PRICE = { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
export const PAGE_CHECK_MAX_TOKENS = 8_000;
export const pageCheckCostMicroUsd = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * PAGE_CHECK_PRICE.inputUsdPerMillion + Math.max(0, usage?.output_tokens ?? 0) * PAGE_CHECK_PRICE.outputUsdPerMillion);

export const SOURCE_KINDS_TOOL = "submit_source_kinds";
export type SourceCandidate = { n: number; url: string; title?: string; text: string };

/** Which pages the assistants cite may be a source on this business's own page: references (a health authority, a
 * standards body, a government page, an encyclopedia, a news or research article, a neutral explainer), never a business
 * that sells what this business sells (a competing practice's service page), and never a listing of such businesses. */
export function sourceKindsRequest(args: { businessName: string; sells: string; market: string; candidates: readonly SourceCandidate[] }) {
  const system = [
    `You sort web pages for an answer page on ${args.businessName}'s own website. ${args.businessName}: ${args.sells || "see its name"}${args.market ? ` (market: ${args.market})` : ""}.`,
    "For each numbered page, decide its kind:",
    `- "reference": published by a government, health authority, university, professional or standards body, encyclopedia, news outlet, research journal, or a neutral explainer that does not sell what ${args.businessName} sells.`,
    `- "seller": published by any business that sells or provides what ${args.businessName} sells (a competing practice, clinic, store, agency or software product), including its blog and guides.`,
    `- "listing": a directory, review site, ranking or "best of" list of such businesses.`,
    "- \"other\": anything else (a forum thread, a social post, a page with no readable content).",
    "Judge by who publishes the page and what it sells, from its address, title and text. When unsure between reference and seller, choose seller.",
    toolOnlyInstruction(SOURCE_KINDS_TOOL),
  ].join("\n");
  const userMessage = args.candidates.map((c) => `[${c.n}] ${c.title ?? ""} — ${c.url}\n${c.text.replace(/\s+/g, " ").slice(0, 900)}`).join("\n\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["pages"],
    properties: { pages: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["n", "kind"],
      properties: { n: { type: "integer" as const }, kind: { type: "string" as const, enum: ["reference", "seller", "listing", "other"] }, publisher: { type: "string" as const } } } } },
  };
  return { system, userMessage, inputSchema };
}

/** The numbers of the pages that may be sources. `null` when the reply can't be read (the caller falls back). */
export function parseSourceKinds(raw: unknown, candidates: readonly SourceCandidate[]): number[] | null {
  const pages = raw && typeof raw === "object" ? (raw as { pages?: unknown }).pages : null;
  if (!Array.isArray(pages)) return null;
  const known = new Set(candidates.map((c) => c.n));
  const kinds = new Map<number, string>();
  for (const p of pages) {
    const page = p as { n?: unknown; kind?: unknown };
    if (typeof page.n === "number" && known.has(page.n) && typeof page.kind === "string") kinds.set(page.n, page.kind);
  }
  // A page the reply left out is not a reference.
  return candidates.filter((c) => kinds.get(c.n) === "reference").map((c) => c.n);
}

/** Without the sorting call: only pages from public institutions and reference works (never a business's site). */
export function referenceByAddress(url: string): boolean {
  return /(?:^|\.)(?:gov|mil|edu|int)(?:\.[a-z]{2})?$|(?:^|\.)(?:ac|gov|nhs)\.[a-z]{2}$|(?:^|\.)(?:wikipedia\.org|who\.int|europa\.eu|nih\.gov|cdc\.gov|mayoclinic\.org|clevelandclinic\.org|britannica\.com|ada\.org|mouthhealthy\.org)$/i
    .test(hostOf(url));
}

export const OWN_FACTS_TOOL = "submit_business_claims";
export type OwnFactsProblem = { sentence: string; verdict: "contradicted" | "unsupported"; ownPagesSay?: string };

/** The page's statements about the business checked against the business's own pages and confirmed profile. */
export function ownFactsRequest(args: { businessName: string; productEvidence: string; markdown: string }) {
  const system = [
    `You check an answer page written for ${args.businessName}'s website against ${args.businessName}'s own pages and confirmed profile (below).`,
    `Find every sentence in the page that states something about ${args.businessName} itself (what it offers or doesn't offer, how its service or product works, where it is, its prices, plans, policies, guarantees, data handling, staff, hours, results) that the own pages do not support, or that they contradict.`,
    `"Supported" means the own pages or profile say it, in any words. A sentence saying ${args.businessName} does NOT offer or do something is unsupported unless the own pages say so explicitly. Sentences about the topic in general, not about ${args.businessName}, are out of scope: ignore them.`,
    "Quote each sentence exactly as it appears in the page, character for character, including any citation markers. Mark it `contradicted` (quote what the own pages say instead in `ownPagesSay`) or `unsupported`.",
    "If every statement about the business is supported, return an empty list.",
    toolOnlyInstruction(OWN_FACTS_TOOL),
  ].join("\n");
  const userMessage = `${args.businessName}'s own pages and profile:\n${args.productEvidence.slice(0, 60_000)}\n\nThe page:\n${args.markdown}`;
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["problems"],
    properties: { problems: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["sentence", "verdict"],
      properties: { sentence: { type: "string" as const }, verdict: { type: "string" as const, enum: ["contradicted", "unsupported"] }, ownPagesSay: { type: "string" as const } } } } },
  };
  return { system, userMessage, inputSchema };
}

export function parseOwnFacts(raw: unknown): OwnFactsProblem[] | null {
  const list = raw && typeof raw === "object" ? (raw as { problems?: unknown }).problems : null;
  if (!Array.isArray(list)) return null;
  return list.flatMap((p) => {
    const item = p as { sentence?: unknown; verdict?: unknown; ownPagesSay?: unknown };
    if (typeof item.sentence !== "string" || item.sentence.trim().length < 4) return [];
    const verdict = item.verdict === "contradicted" ? "contradicted" as const : "unsupported" as const;
    return [{ sentence: item.sentence.trim().slice(0, 600), verdict, ...(typeof item.ownPagesSay === "string" && item.ownPagesSay.trim() ? { ownPagesSay: item.ownPagesSay.trim().slice(0, 300) } : {}) }];
  }).slice(0, 20);
}

/** The revision's instruction for one problem. */
export const ownFactsIssue = (businessName: string, p: OwnFactsProblem) => p.verdict === "contradicted"
  ? `"${p.sentence.slice(0, 200)}" contradicts ${businessName}'s own pages${p.ownPagesSay ? `, which say: "${p.ownPagesSay.slice(0, 200)}"` : ""}. Correct it to what its pages say, or remove it.`
  : `"${p.sentence.slice(0, 200)}" isn't supported by ${businessName}'s own pages. Remove it, or say only what the business facts say.`;

/** A unique address for a page on its site. */
export function uniqueSlug(question: string, taken: ReadonlySet<string>): string {
  const base = answerSlug(question);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

export const pageContentHash = (page: { title: string; metaDescription: string; markdown: string }) =>
  sha256Hex(`${page.title}\n${page.metaDescription}\n${page.markdown}`);
