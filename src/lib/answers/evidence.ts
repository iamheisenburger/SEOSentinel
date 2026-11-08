/**
 * Pentra Answers: one recorded answer (a Check) turned into the EvidenceCard's shape. The business's name is marked
 * as "you" and each competitor the answer named as a rival, the way the engine matched them (convex/lib/answerEngine.ts
 * brandMatcher: words joined by an optional space or hyphen, whole words only, any case). Pure.
 */
import type { AnswerBlock, EvidenceAnswer, EvidenceOutcome, EvidenceSource, Segment } from "../../components/ui/evidence-card.tsx";
import type { AssistantId } from "../product-facts.ts";
import { countryName, isAssistantId, utcStamp } from "./format.ts";
import type { Check, CheckWithText } from "./types.ts";

export type Business = { name: string; domain: string };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word, any-case pattern for a brand name ("KettlewoodDecks" also matches "Kettlewood Decks"). */
export function brandPattern(name: string): string | null {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.join("").length < 3) return null;
  // As the engine joins them (convex/lib/answerEngine.ts brandMatcher): up to three non-letters between words, so
  // "Deck & Fence", "Lowe's" and "Hub-Spot" match the way they were counted.
  return `(?<![A-Za-z0-9])${words.map(escapeRegex).join("[^A-Za-z0-9]{0,3}")}(?![A-Za-z0-9])`;
}

type Mark = { start: number; end: number; kind: "you" | "rival" | "cite"; n?: number };

function findMarks(text: string, business: Business, rivals: readonly string[]): Mark[] {
  const marks: Mark[] = [];
  const add = (pattern: string | null, kind: Mark["kind"], flags = "gi") => {
    if (!pattern) return;
    for (const match of text.matchAll(new RegExp(pattern, flags))) {
      if (match.index === undefined || !match[0]) continue;
      marks.push({ start: match.index, end: match.index + match[0].length, kind });
    }
  };
  add(brandPattern(business.name), "you");
  const domain = business.domain.trim().toLowerCase().replace(/^www\./, "");
  if (domain) add(`(?<![A-Za-z0-9.-])(?:www\\.)?${escapeRegex(domain)}(?![A-Za-z0-9-])`, "you");
  for (const rival of rivals) add(brandPattern(rival), "rival");
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    if (match.index !== undefined) marks.push({ start: match.index, end: match.index + match[0].length, kind: "cite", n: Number(match[1]) });
  }
  // Earliest first; at the same place the business wins, then the longer match. Overlaps are dropped.
  marks.sort((a, b) => a.start - b.start || Number(b.kind === "you") - Number(a.kind === "you") || b.end - a.end);
  const kept: Mark[] = [];
  for (const mark of marks) {
    const last = kept[kept.length - 1];
    if (last && mark.start < last.end) continue;
    kept.push(mark);
  }
  return kept;
}

/** Plain text with the business, rivals and citation markers marked. */
export function highlight(text: string, business: Business, rivals: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const mark of findMarks(text, business, rivals)) {
    if (mark.start > at) segments.push(text.slice(at, mark.start));
    const value = text.slice(mark.start, mark.end);
    segments.push(mark.kind === "you" ? { you: value } : mark.kind === "rival" ? { rival: value } : { cite: mark.n! });
    at = mark.end;
  }
  if (at < text.length) segments.push(text.slice(at));
  return segments;
}

/** Markdown an assistant wrote, read as plain sentences: links keep their words, emphasis and headings lose their marks. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A full answer's text in paragraphs and lists, as the assistant laid it out. */
export function textToBlocks(text: string, business: Business, rivals: readonly string[]): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ p: highlight(plainInline(paragraph.join(" ")), business, rivals) });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) {
      const items = list.items.map((item) => highlight(plainInline(item), business, rivals));
      blocks.push(list.kind === "ol" ? { ol: items } : { ul: items });
    }
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) { flushParagraph(); flushList(); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d{1,3}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const kind = numbered ? "ol" : "ul";
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    if (/^#{1,6}\s/.test(line)) { flushParagraph(); paragraph.push(line); flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ p: [""] }];
}

function shortList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

/** The outcome strip: what this answer shows about the business, in the engine's own terms. */
export function checkOutcomes(check: Pick<Check, "status" | "assistant" | "named" | "cited" | "position" | "brandsNamed" | "competitorsNamed" | "citedPageUrls">): EvidenceOutcome[] {
  if (check.status === "error") return [{ kind: "none", label: "No answer recorded" }];
  if (check.status === "no_answer") return [{ kind: "none", label: check.assistant === "google_ai_overview" ? "No AI Overview shown" : "No answer given" }];
  const outcomes: EvidenceOutcome[] = [];
  if (check.named) {
    outcomes.push({ kind: "named", label: check.position ? `Named you · position ${check.position} of ${Math.max(check.position, check.brandsNamed)}` : "Named you" });
  } else if (check.competitorsNamed.length) {
    outcomes.push({ kind: "rival", label: `Not mentioned · named ${shortList(check.competitorsNamed)}` });
  } else {
    outcomes.push({ kind: "none", label: "Not mentioned" });
  }
  if (check.cited) {
    outcomes.push({ kind: "cited", label: check.citedPageUrls.length > 1 ? `Cited ${check.citedPageUrls.length} of your pages` : "Cited your page" });
  }
  return outcomes;
}

function sourceTitle(url: string, title?: string): string {
  if (title?.trim()) return title.trim();
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    return path || "Home page";
  } catch {
    return url;
  }
}

export function checkSources(check: Pick<Check, "sources">): EvidenceSource[] {
  return check.sources.map((source) => ({ domain: source.domain, title: sourceTitle(source.url, source.title), url: source.url, yours: source.own }));
}

const STATUS_TEXT: Record<string, (check: Check) => string> = {
  error: (check) => `This answer failed${check.error ? `: ${check.error.charAt(0).toLowerCase()}${check.error.slice(1).replace(/\.?$/, ".")}` : "."} Failed answers are listed, never counted.`,
  no_answer: (check) => check.assistant === "google_ai_overview"
    ? "Google showed no AI Overview for this search. Listed, never counted as an answer."
    : "The assistant gave no answer. Listed, never counted.",
};

/**
 * One check as an EvidenceCard answer. With `text` (from `answerText`), the full answer as the assistant laid it out;
 * otherwise the recorded excerpt around the first mention.
 */
export function checkToEvidence(check: Check | CheckWithText, business: Business, options: { full?: boolean } = {}): EvidenceAnswer {
  const fullText = options.full && "text" in check && check.text ? check.text : null;
  const describe = STATUS_TEXT[check.status];
  const answer: AnswerBlock[] = describe
    ? [{ p: [describe(check)] }]
    : fullText
      ? textToBlocks(fullText, business, check.competitorsNamed)
      : [{ p: highlight(plainInline(check.excerpt), business, check.competitorsNamed) }];
  return {
    id: check.checkId,
    assistant: (isAssistantId(check.assistant) ? check.assistant : "chatgpt") as AssistantId,
    askedAt: utcStamp(check.askedAt),
    question: check.question,
    answer,
    outcomes: checkOutcomes(check),
    sources: checkSources(check),
    locale: countryName(check.country),
  };
}
