/** P289 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md step 4 and holes 1-3): code decides what stays, never a second AI judge and
 * never the customer. A sentence that states a fact is kept only when the source it cites ([n], or the citations of its own
 * paragraph or list item) backs it; anything else is deleted before the article is checked again:
 *  - a number its cited source doesn't state (uncited: any number at all, except a worked example's illustrations and
 *    the business's own confirmed facts);
 *  - beside a number, a company or product its cited source doesn't name (the rebate credited to Austin Energy when Texas
 *    Gas Service pays it);
 *  - a cause or mechanism ("because", "so", "which means", "leads to") whose terms its cited source doesn't share (batch 2's
 *    "low specific heat, so it stores a lot of heat"); advice in the imperative is exempt;
 *  - a passage said again (the later copy), a reader sent elsewhere ("ask your plumber"), and what the claims check found.
 * An FAQ answer left with nothing goes with its question; a table row with a figure no source states goes with the figure.
 * Deletion is coherence-safe (lib/coherentDeletion): a sentence that can't be removed cleanly is held, and the article's
 * own checks still see it. */
import { deleteSentencesCoherently, LIST_PREFIX, SENTENCE_SPLIT } from "./coherentDeletion.ts";
import { DEFLECTION, exampleSections, illustrativeNumbers, namesOutsideSources, numberStated, prose, repeatedPassages, SOURCES_HEADING, statedNumbers, words } from "./articlePlanChecks.ts";

export type BackingSource = { text: string };
export type BackingInput = {
  /** In citation order: [1] is sources[0]. */
  sources: readonly BackingSource[];
  /** The business's confirmed facts (their numbers and names need no citation). */
  profile: string;
  /** Names that need no source: the business, its product, the search's own words. */
  allowedNames: readonly string[];
  topic?: string;
  /** Sentences the claims check found wrong by established knowledge. */
  wrongClaims?: readonly string[];
};
export type BackingRemoval = { sentence: string; reason: "number" | "name" | "cause" | "repeat" | "referral" | "claim" | "table" };

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\](?:\([^)\n]*\))?/g;
const citations = (text: string) => [...text.matchAll(CITATION)].flatMap((m) => m[1].split(/\s*,\s*/).map(Number)).filter((n) => n > 0);
const lower = (value: string) => value.toLowerCase().replace(/[‘’]/g, "'");

/** "because", "so", "which means", "leads to": a claim about why or what follows (hole 1). "since" before a date is time. */
export const CAUSAL = /\b(?:because|due to|therefore|thus|hence|as a result|which means|this means|that means|so that|leads? to|led to|results? in|resulting in|caused by)\b|,\s*so\s+(?!far\b|much\b|many\b|long\b)|\bsince\s+(?!\d|then\b|last\b|early\b|the\s+\d)/i;
const IMPERATIVE = new Set(("add adjust allow apply ask avoid budget build buy call check choose clean click compare confirm consider copy create " +
  "decide define delete do document download drain dry enable expect export file find fix flush follow gather get give go have heat " +
  "hire import include install keep label leave let limit list look make mark match measure move note open order pay pick place plan " +
  "post preheat prepare print pull put read record reduce remove replace request reset review rinse run save schedule search season " +
  "see select send set share sign skip sort start stop store switch take tell test try turn update upload use verify wait wash watch " +
  "wipe write reconcile book price mask redact log ship emit pin cap charge sell offer track lower raise treat count look start " +
  "begin finish bring carry hold mount vent size rate quote insist require attach lift slide drag rest cool let leave dont " +
  "never avoid ask expect plan watch skip keep").split(" "));
const ADVICE_OPENING = /^(?:a (?:simple|good|practical|safe|quick) way|the (?:simplest|easiest|safest|quickest) way|one (?:way|option)|it helps to|it pays to|you can|you should|you'll want to)\b/i;
const STOP = new Set(("about above after again against also among another because before being below between both cause causes could does " +
  "doing down during each either enough every from further have having here into itself just less made make makes many more most much " +
  "must need needs only other over same should since some such than that their them then there these they this those through under " +
  "until very what when where which while will with within without would your yours means result results leads lead").split(" "));
/** A cause's direction ("low" or "high", "more" or "less"): its source must say the same one (batch 2's backwards physics). */
const POLARITY = /\b(?:low|lower|lowest|high|higher|highest|more|less|fewer|increases?|increased|decreases?|decreased|better|worse|faster|slower|cheaper|stronger|weaker|hotter|colder|cooler|warmer|longer|shorter|heavier|lighter|larger|smaller|bigger)\b/gi;
const stem = (word: string) => word.replace(/(?:ing|ed|es|s)$/, "");
const contentWords = (text: string) => [...new Set(lower(text).match(/[a-z][a-z'-]{3,}/g) ?? [])].filter((w) => !STOP.has(w)).map(stem);

function imperative(sentence: string): boolean {
  const first = /^[^A-Za-z]*([A-Za-z]+)/.exec(sentence.replace(/^\s*(?:\*\*[^*]{1,80}\*\*[:.]?\s*)/, ""))?.[1] ?? "";
  return IMPERATIVE.has(first.toLowerCase());
}
/** Advice: an imperative, conditional advice ("If you ..., reconcile ..."), a "simple way" opening, or a reason whose
 * consequence is an instruction ("..., so check whether ..."). */
function advice(sentence: string): boolean {
  const text = prose(sentence).replace(/^\s*[A-Z][^:.]{0,40}:\s*/, "").trim();
  if (imperative(text) || ADVICE_OPENING.test(text)) return true;
  // Conditional advice: after any comma of an "If/When ..." opening, an instruction ("If you run ..., such as ..., reconcile more often").
  if (/^(?:if|when|before|after|while|once|for|unless|because|since)\b/i.test(text)) {
    for (const m of text.matchAll(/,\s*/g)) {
      const rest = text.slice(m.index! + m[0].length);
      if (m.index! < 220 && (imperative(rest) || ADVICE_OPENING.test(rest))) return true;
    }
  }
  const consequence = /(?:,\s*so|\bso that|\btherefore|\bthus|\bwhich means)\s+(?:you\s+(?:can\s+|should\s+)?)?([a-z']+)/i.exec(text);
  return Boolean(consequence && IMPERATIVE.has(consequence[1].toLowerCase().replace(/'/g, "")));
}

/** Capitalised names in a sentence: not its first word unless that word is clearly a name (a possessive, inner capitals or
 * digits, or followed by another capitalised word); months, days and ordinary sentence words are not names. */
const NOT_NAMES = new Set(("I A An The This That These Those It Its Your You We Our They Their He She Each Every Some Most Many Any All No Not " +
  "If When While Where What Why How Which Who For In On At By With Without After Before During From Into Over Under Both Either Neither " +
  "January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday " +
  "Saturday Sunday Step Steps Note Tip Example FAQ Q A Yes No Also But And Or So Then Than Once").split(" "));
export function namedEntities(sentence: string): string[] {
  const text = prose(sentence).replace(/\s+/g, " ").trim();
  const words = text.split(" ");
  const names: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].replace(/^[("“'‘]+|[)"”'’.,;:!?]+$/g, "");
    if (!/^[A-Z]/.test(raw) || NOT_NAMES.has(raw)) continue;
    const startOfSentence = i === 0 || /[.!?:]$/.test(words[i - 1]);
    const strong = /['’]s$/.test(raw) || /[a-z][A-Z]|\d/.test(raw) || /^[A-Z]{2,}$/.test(raw) ||
      (i + 1 < words.length && /^[A-Z][a-z]/.test(words[i + 1]) && !NOT_NAMES.has(words[i + 1].replace(/[^A-Za-z]/g, "")));
    if (startOfSentence && !strong) continue;
    names.push(raw.replace(/['’]s$/, ""));
  }
  return [...new Set(names)];
}

const HYPOTHETICAL = /\b(?:hypothetical|for illustration|illustrative|imagine|suppose|say you|for instance, say)\b/i;
const ARITHMETIC = /\d[\d,.]*\s*[÷×*/+−–-]\s*\$?\d[\d,.]*\s*=\s*\$?\d/;
function backedNumbers(sentence: string, quote: string, profile: string, illustrative: ReadonlySet<number>): string[] {
  // A ratio ("a 1:1 session") and an inline enumerator ("(1) confirm ..., (2) match ...") are not quantities; a sentence that
  // calls itself hypothetical, and arithmetic over its own figures, are illustrations.
  if (HYPOTHETICAL.test(sentence) || ARITHMETIC.test(sentence)) return [];
  return statedNumbers(prose(sentence).replace(/\b\d+:\d+\b/g, " ").replace(/\(\d{1,2}\)/g, " ")).filter((n) => !numberStated(n, quote) && !numberStated(n, profile) && !illustrative.has(Number.parseFloat(n)));
}

/** The sentences of each editable line, split exactly as the deletion splits them. */
function lineSegments(line: string): string[] {
  const prefix = line.match(LIST_PREFIX)?.[0] ?? "";
  return line.slice(prefix.length).split(SENTENCE_SPLIT).map((segment) => segment.trim()).filter(Boolean);
}
/** Each line's citations (a paragraph or list item backs its own sentences when they carry none). */
function lineCitations(markdown: string): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const line of markdown.split("\n")) {
    const found = citations(line);
    if (found.length) for (const segment of lineSegments(line)) map.set(segment, found);
  }
  return map;
}

/** Table rows whose figures no source states; the whole table when most of its rows are (a reference table with gaps would
 * mislead). A worked example's tables are illustrations and stay. */
function withoutUnbackedRows(markdown: string, haystack: string, illustrative: ReadonlySet<number>): { markdown: string; removed: string[] } {
  const lines = markdown.split("\n"), removed: string[] = [];
  const examples = exampleSections(markdown).filter((body) => body.trim());
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence || !/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue;
    // A table: header at i, separator at i + 1, body rows after.
    let end = i + 2;
    while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
    if (examples.some((body) => body.includes(lines[i]) && body.includes(lines[end - 1]))) { i = end - 1; continue; }
    const unbacked: number[] = [];
    for (let r = i + 2; r < end; r++) {
      const numbers = statedNumbers(lines[r].replace(/\|/g, " . ").replace(/\b\d+:\d+\b/g, " "))
        .filter((n) => !numberStated(n, haystack) && !illustrative.has(Number.parseFloat(n)));
      if (numbers.length) unbacked.push(r);
    }
    const rows = end - (i + 2);
    const drop = unbacked.length * 2 > rows ? Array.from({ length: end - i }, (_, k) => i + k) : unbacked;
    for (const r of drop) { if (r >= i + 2) removed.push(lines[r].trim()); lines[r] = "\u0000"; }
    if (rows > 0 && unbacked.length === rows) { lines[i] = "\u0000"; lines[i + 1] = "\u0000"; }
    i = end - 1;
  }
  return { markdown: lines.filter((line) => line !== "\u0000").join("\n"), removed };
}

export function backedFactsOnly(article: string, input: BackingInput): { markdown: string; removed: BackingRemoval[]; held: string[] } {
  // The Sources list is a bibliography, never edited.
  const split = SOURCES_HEADING.exec(article), markdown = split ? article.slice(0, split.index) : article, tail = split ? article.slice(split.index) : "";
  const examples = exampleSections(markdown).filter((body) => body.trim());
  const inExample = (sentence: string) => examples.some((body) => body.includes(sentence.trim()));
  const illustrative = illustrativeNumbers(markdown);
  const all = input.sources.map((s) => s.text).join("\n");
  const quoteFor = (numbers: number[]) => numbers.map((n) => input.sources[n - 1]?.text ?? "").join("\n");
  const allowed = [input.profile, ...input.allowedNames].map(lower).join("\n");
  const removed: BackingRemoval[] = [];

  // Tables first: their rows are never prose sentences.
  const table = withoutUnbackedRows(markdown, `${all}\n${input.profile}`, illustrative);
  removed.push(...table.removed.map((sentence) => ({ sentence, reason: "table" as const })));
  const text = table.markdown;

  // The later copies of a passage said again (the first stays).
  const repeated = repeatedPassages(text, 6, input.topic ?? "").map((r) => r.phrase);
  let fence = false;
  const segmentsInOrder = text.split("\n").flatMap((line) => {
    if (/^\s*```/.test(line)) { fence = !fence; return []; }
    return fence || /^\s*(?:#|\|)/.test(line) ? [] : lineSegments(line);
  });
  const seenPhrase = new Set<string>(), laterCopies = new Map<string, number>();
  for (const segment of segmentsInOrder) {
    const plain = ` ${words(prose(segment)).join(" ")} `;
    const later = repeated.filter((phrase) => plain.includes(` ${phrase} `)).some((phrase) => {
      if (seenPhrase.has(phrase)) return true;
      seenPhrase.add(phrase); return false;
    });
    if (later) laterCopies.set(segment, (laterCopies.get(segment) ?? 0) + 1);
  }
  const wrong = (input.wrongClaims ?? []).map((s) => lower(prose(s)).replace(/\s+/g, " ").trim()).filter((s) => s.length >= 12);
  const blockCitations = lineCitations(text);
  // A person or company the sources, the business details and the search never name ("According to Jane Doe, ..."): a named
  // claim with nothing behind it.
  const invented = namesOutsideSources(text, { sources: input.sources.map((s) => ({ url: "", text: s.text })), profile: input.profile,
    productName: input.allowedNames[0] ?? "" }, input.allowedNames).map((f) => lower(f.line ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const reasonFor = (segment: string): BackingRemoval["reason"] | null => {
    const sentence = segment.trim(), plain = lower(prose(sentence)).replace(/\s+/g, " ").trim();
    if (!plain || /\?\s*(?:\*\*|__)?$/.test(sentence)) return null;
    if (wrong.some((claim) => plain.includes(claim) || (plain.length >= 24 && claim.includes(plain)))) return "claim";
    // A list option's own entry is never dropped as a repeat (its template wording repeats; the option doesn't).
    if (laterCopies.get(sentence) && !/^\s*(?:\*\*|__)[^*_]{1,80}(?:\*\*|__)/.test(sentence)) {
      laterCopies.set(sentence, laterCopies.get(sentence)! - 1); return "repeat";
    }
    if (DEFLECTION.test(prose(sentence))) return "referral";
    if (invented.some((line) => plain === line || plain.includes(line) || (plain.length >= 24 && line.includes(plain)))) return "name";
    if (inExample(sentence)) return null;
    const own = citations(sentence), cited = own.length ? own : blockCitations.get(sentence) ?? [];
    const quote = cited.length ? quoteFor(cited) : "";
    const numbers = backedNumbers(sentence, cited.length ? quote : "", input.profile, illustrative);
    if (numbers.length) return "number";
    if (statedNumbers(prose(sentence)).length && cited.length) {
      const named = namedEntities(sentence).filter((name) => !allowed.includes(lower(name)) && !lower(quote).includes(lower(name)));
      if (named.length) return "name";
    }
    // The business's own facts are its confirmed details (checked as product facts), not a cause to source.
    const aboutBusiness = input.allowedNames.some((name) => name.trim().length >= 3 && plain.includes(lower(name.trim())) &&
      input.profile && lower(input.profile).includes(lower(name.trim())));
    if (CAUSAL.test(prose(sentence)) && !advice(sentence) && !aboutBusiness && !HYPOTHETICAL.test(sentence) && !ARITHMETIC.test(sentence)) {
      if (!cited.length) return "cause";
      // Inline code is the most specific evidence a sentence has (`logger.debug()`, `genReqId`): its words count too.
      const said = prose(sentence.replace(/`([^`\n]+)`/g, " $1 ")).replace(CITATION, " "), source = lower(quote);
      const terms = contentWords(said);
      if (terms.filter((w) => source.includes(w)).length < Math.min(3, terms.length)) return "cause";
      // A direction word used as a verb ("lower the level") is an action, not a claim.
      const directions = [...said.matchAll(POLARITY)].filter((m) => !/^\s+(?:the|your|its|a|an|it|them)\b/i.test(said.slice(m.index! + m[0].length)) &&
        !/\b(?:to|you|will|can|should)\s+$/i.test(said.slice(0, m.index))).map((m) => lower(m[0]));
      if ([...new Set(directions)].some((word) => !new RegExp(`\\b${word}\\b`).test(source))) return "cause";
    }
    return null;
  };
  const reasons = new Map<string, BackingRemoval["reason"]>();
  const result = deleteSentencesCoherently(text, (segment) => {
    const reason = reasonFor(segment);
    if (reason) reasons.set(segment.trim(), reason);
    return reason !== null;
  }, { dropStrandedQuestion: true });
  removed.push(...result.removed.map((sentence) => ({ sentence, reason: reasons.get(sentence.trim()) ?? "number" })));
  return { markdown: `${result.markdown}${tail}`, removed, held: result.held };
}
