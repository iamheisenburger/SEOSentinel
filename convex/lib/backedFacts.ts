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

export type BackingSource = { text: string; url?: string };
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
  /** P295: sentences the reader check (a cited number its source doesn't contain) or the plan check (a number in no source)
   * flags; their number matching differs from step 4's, and a flagged sentence held the whole article (batch 5). */
  unbacked?: readonly string[];
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

const FIND_OUT_YOURSELF = /\b(?:ask (?:your|the|an?|for an?)\s+(?:[\w-]+\s+){0,2}?(?:installer|contractor|plumber|provider|seller|vendor|dealer|technician|accountant|bookkeeper|pro|professional|expert|utility|estimate|quote)s?\b|(?:installer|contractor|plumber|technician)['’]s assessment|check (?:it |this )?(?:in|during) (?:a|the|your) (?:free )?trial|(?:test|try) (?:it|this|them) yourself|get (?:an? )?(?:written )?(?:estimate|quote)s?\b|confirm (?:it |this |that |the [\w-]+ )?with (?:your|the)\b)/i;
const QUANTITY = /(?:[$€£]\s?\d[\d,.]*(?:\s?(?:k|million|billion))?|\d[\d,.]*(?:\s?-\s?\d[\d,.]*)?\s?(?:°\s?[FC]\b|%|percent\b|years?\b|months?\b|weeks?\b|days?\b|hours?\b|minutes?\b|mph\b|psi\b|gpm\b|kwh?\b|btu\b|seer2?\b|hspf2?\b|afue\b|amps?\b|gallons?\b|feet\b|ft\b|inches\b|lbs?\b|pounds?\b))/gi;
/** Later sentences that restate an earlier one: the same quantities (numbers and units), none new, with three or more of its
 * words and half of them, or the same claim (six or more of its words, most of the later sentence's). Option entries (a bold
 * label) and questions stay. P298 (Nov 3 2026): a sentence that adds a figure of its own is a comparison, not a repeat (the
 * cast-iron pan's "$50 that lasts the same 9 years costs about $5.56 per year" beside the ceramic pan's "9 years"). */
function restatements(segments: readonly string[]): Set<string> {
  const seen: { quantities: Set<string>; words: Set<string> }[] = [], later = new Set<string>();
  for (const segment of segments) {
    if (/^\s*(?:\*\*|__)[^*_]{1,80}(?:\*\*|__)/.test(segment) || /\?\s*(?:\*\*|__)?$/.test(segment)) continue;
    const plain = prose(segment);
    const quantities = new Set((plain.match(QUANTITY) ?? []).map((q) => q.toLowerCase().replace(/\s+/g, "").replace(/percent/, "%")));
    const words = new Set(contentWords(plain.replace(QUANTITY, " ")));
    if (words.size < 3) { seen.push({ quantities, words }); continue; }
    const repeats = seen.some((prior) => {
      const shared = [...words].filter((w) => prior.words.has(w)).length;
      const sameFigures = quantities.size > 0 && [...quantities].every((q) => prior.quantities.has(q));
      return (sameFigures && shared >= Math.max(3, 0.5 * words.size)) || (shared >= 6 && shared >= 0.7 * words.size);
    });
    if (repeats) later.add(segment.trim()); else seen.push({ quantities, words });
  }
  return later;
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
  // P295 (fix 3): the same number and unit, or the same claim, said again in other words: the later sentence goes ("below
  // ~40°F" 5 times, the acidic-foods rule 4 times). Fix 4: in a section that promises a figure, a reader sent to someone
  // else or told to find out themselves ("Ask your installer to confirm", "check in a trial", "ask for an estimate").
  const restated = restatements(segmentsInOrder);
  const figureSection = new Set<string>();
  {
    let inFigure = false, fenced = false;
    for (const line of text.split("\n")) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      const heading = /^(#{2,3})\s+(.+)$/.exec(line);
      if (heading) { inFigure = FIGURE_HEADING.test(heading[2]); continue; }
      if (inFigure && !fenced) for (const segment of lineSegments(line)) figureSection.add(segment);
    }
  }
  const flagged = (input.unbacked ?? []).map((s) => lower(prose(s)).replace(/\s+/g, " ").trim()).filter((s) => s.length >= 12);
  const wrong = (input.wrongClaims ?? []).map((s) => lower(prose(s)).replace(/\s+/g, " ").trim()).filter((s) => s.length >= 12);
  const blockCitations = lineCitations(text);
  // v3.1 (batch 6, R8): the local authority's figure wins a unit conflict. Batch 6's sprinkler how-to printed Rain Bird's
  // "regulate to 75–85 psi" beside Colorado's "never over 50 psi": same unit, different values, and the .gov figure must win.
  // When exactly one side of the conflict cites a government or university source, the others' sentences go.
  const CONFLICT_UNITS = /\b(\d[\d,.]*)\s?(psi|cfm|gpm)\b/gi;
  const authorityUrl = (n: number) => /\.gov\b|\.edu\b|\.mil\b/i.test(input.sources[n - 1]?.url ?? "");
  const conflicts = new Map<string, string>();
  {
    const byUnit = new Map<string, { value: string; sentence: string; authority: boolean }[]>();
    for (const segment of segmentsInOrder) {
      CONFLICT_UNITS.lastIndex = 0;
      const m = CONFLICT_UNITS.exec(prose(segment));
      if (!m) continue;
      const own = citations(segment), cited = own.length ? own : blockCitations.get(segment) ?? [];
      const entry = { value: m[1].replace(/,/g, ""), sentence: segment.trim(), authority: cited.some(authorityUrl) };
      const list = byUnit.get(m[2].toLowerCase()) ?? [];
      list.push(entry);
      byUnit.set(m[2].toLowerCase(), list);
    }
    for (const [, entries] of byUnit) {
      const values = [...new Set(entries.map((e) => e.value))];
      const authorities = entries.filter((e) => e.authority);
      // Same unit, different values, and a .gov/.edu figure on exactly one side: the others' sentences go. With no
      // authority in the conflict (or on both sides), every sourced figure stays: the conflict is shown, not picked.
      if (values.length >= 2 && authorities.length >= 1 && authorities.length < entries.length) {
        for (const entry of entries.filter((e) => !e.authority)) conflicts.set(lower(prose(entry.sentence)).replace(/\s+/g, " ").trim(), entry.sentence);
      }
    }
  }
  // A person or company the sources, the business details and the search never name ("According to Jane Doe, ..."): a named
  // claim with nothing behind it.
  const invented = namesOutsideSources(text, { sources: input.sources.map((s) => ({ url: "", text: s.text })), profile: input.profile,
    productName: input.allowedNames[0] ?? "" }, input.allowedNames).map((f) => lower(f.line ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const reasonFor = (segment: string): BackingRemoval["reason"] | null => {
    const sentence = segment.trim(), plain = lower(prose(sentence)).replace(/\s+/g, " ").trim();
    if (!plain || /\?\s*(?:\*\*|__)?$/.test(sentence)) return null;
    if (wrong.some((claim) => plain.includes(claim) || (plain.length >= 24 && claim.includes(plain)))) return "claim";
    if (invented.some((line) => plain === line || plain.includes(line) || (plain.length >= 24 && line.includes(plain)))) return "name";
    if (flagged.some((line) => plain.includes(line) || (plain.length >= 24 && line.includes(plain)))) return "number";
    if (conflicts.has(plain)) return "number";
    // A list option's own entry is never dropped as a repeat (its template wording repeats; the option doesn't).
    if (laterCopies.get(sentence) && !/^\s*(?:\*\*|__)[^*_]{1,80}(?:\*\*|__)/.test(sentence)) {
      laterCopies.set(sentence, laterCopies.get(sentence)! - 1); return "repeat";
    }
    if (DEFLECTION.test(prose(sentence))) return "referral";
    if (figureSection.has(sentence) && FIND_OUT_YOURSELF.test(prose(sentence))) return "referral";
    if (restated.has(sentence) && !inExample(sentence)) return "repeat";
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

/** P294 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md step 2) + v3.1 (batch 6): a planned article that states prices says when they
 * were read, INLINE beside the first price ("$11,712 (as of November 2026)"), never as a line of its own — batch 6's
 * bank-reconciliation article carried one under "Documents you need", a section with no price. A standalone "Prices as of…"
 * line the writer left anywhere is removed first: it is pipeline text. */
const PRICE_TOKEN = /[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*[$€£]?\s?\d[\d,]*(?:\.\d+)?)?/;
const DATED = /\bas of [A-Z][a-z]+ \d{4}\b/i;
const STANDALONE_PRICE_DATE = /^\s*Prices?(?:\s+and\s+(?:fees|prices))?\s+as\s+of\s+[A-Z][a-z]+\s+\d{4}\.?\s*$/;
export function withPriceDate(article: string, readAt: number): string {
  const split = SOURCES_HEADING.exec(article), body = split ? article.slice(0, split.index) : article, tail = split ? article.slice(split.index) : "";
  const lines = body.split("\n").map((line) => STANDALONE_PRICE_DATE.test(line) ? "" : line);
  const stripped = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (DATED.test(stripped)) return `${stripped}${tail}`;
  const month = new Date(readAt).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  // A worked example's amounts are illustrations (batch 7: "(as of November 2026)" landed inside the hypothetical
  // correction "$90.00 ($540.00 − $450.00)"); the date goes beside the first real price.
  const examples = exampleSections(stripped).filter((x) => x.trim());
  const inExample = (line: string) => examples.some((x) => x.includes(line.trim().slice(0, 60)));
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence || !line.trim() || /^\s*(?:#|\||-\s|\d+[.)])/.test(line) || inExample(line)) continue;
    const at = PRICE_TOKEN.exec(line);
    if (!at) continue;
    const end = at.index + at[0].length;
    const dated = `${line.slice(0, end)} (as of ${month})${line.slice(end)}`;
    return `${lines.slice(0, i).concat([dated], lines.slice(i + 1)).join("\n").replace(/\n{3,}/g, "\n\n")}${tail}`;
  }
  return `${stripped}${tail}`;
}

/** v3.1 (batch 6, Cowork's A4, revised after batch 7): citation numbers are STABLE — [n] is always the n-th source of the
 * article's own sources array — and after any deletion the Sources list is rebuilt canonically from that array, so the
 * list never has gaps (batch 6's python article skipped [3]) and never disagrees with the array (batch 7's first run
 * renumbered the body by first use while the stored array kept research order: every shifted citation then failed the
 * cited-number check against the wrong source). */
export function rebuildSourcesSection(markdown: string, sources: readonly { url: string; title?: string }[]): string {
  if (!sources.length) return markdown;
  const split = SOURCES_HEADING.exec(markdown);
  const body = (split ? markdown.slice(0, split.index) : markdown).trimEnd();
  if (!/\[\d+(?:\s*,\s*\d+)*\]/.test(body)) return markdown;
  const name = (source: { url: string; title?: string }) => {
    const title = source.title?.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
    if (title) return title;
    try { return new URL(source.url).hostname.replace(/^www\./, ""); } catch { return source.url; }
  };
  const tail = `## Sources\n\n${sources.map((source, index) => `${index + 1}. [${name(source)}](${source.url})`).join("\n")}`;
  return `${body}\n\n${tail}\n`;
}
/** P295 (Cowork's batch 4, fix 2): a heading that promises a figure (costs, prices, fees, rebates, lifespan, timeline,
 * temperatures) over a section with no figure is an empty promise ("Rebates and incentives" with no rebate): the section
 * goes. A table column that is mostly dashes is missing data: the column goes (the table, when one column is left). */
export const FIGURE_HEADING = /\b(?:costs?|prices?|pricing|fees?|rebates?|incentives?|tax credits?|how much|lifespans?|how long|timeline|temperatures?|heat limits?|savings)\b/i;
/** P305 (batch 9, sprinkler): a heading that promises WHEN ("When to winterize…") over a section with no timing fact (a
 * month, a freeze or frost event, a temperature) is the same empty promise: the section goes. "If you are reading this
 * in early November" is the writer, not a source. */
export const TIMING_HEADING = /\b(?:when to|best time to|timing of|how early|how late|what time of year)\b/i;
const MONTH_OR_EVENT = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b|\bfrost\b|\bfreez/i;
/** "If you are reading this in early November" names a month but is the writer addressing the reader, not a source's
 * timing fact; it does not satisfy a timing heading. */
const READER_NOW = /\b(?:if you|you(?:'re| are)?\s+(?:reading|seeing|viewing)|reading this|at the time of (?:this )?(?:writing|publish))\b/i;
export function withoutUntimedSections(article: string): { markdown: string; removed: string[] } {
  const split = SOURCES_HEADING.exec(article), body = split ? article.slice(0, split.index) : article, tail = split ? article.slice(split.index) : "";
  const lines = body.split("\n");
  const removed: string[] = [];
  const level = (line: string) => /^(#{2,3})\s/.exec(line)?.[1].length ?? 0;
  for (let i = 0; i < lines.length; i++) {
    const h = level(lines[i]);
    if (!h || !TIMING_HEADING.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= h)) end++;
    const content = lines.slice(i + 1, end).filter((line) => line.trim() && !level(line));
    if (!content.some((line) => MONTH_OR_EVENT.test(line) && !READER_NOW.test(line))) {
      removed.push(lines[i].replace(/^#+\s*/, "").trim());
      lines.splice(i, end - i);
      i--;
    }
  }
  return { markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}${tail}`, removed };
}
const EMPTY_CELL = /^\s*(?:—|–|-|n\/a|not (?:covered|stated|listed|published)(?: here)?)?\s*$/i;
export function withoutEmptyFigureSections(article: string): { markdown: string; removed: string[] } {
  const split = SOURCES_HEADING.exec(article), body = split ? article.slice(0, split.index) : article, tail = split ? article.slice(split.index) : "";
  const examples = exampleSections(body).filter((b) => b.trim());
  let lines = body.split("\n");
  const removed: string[] = [];
  const level = (line: string) => /^(#{2,3})\s/.exec(line)?.[1].length ?? 0;
  for (let i = 0; i < lines.length; i++) {
    const h = level(lines[i]);
    if (!h || !FIGURE_HEADING.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= h)) end++;
    const content = lines.slice(i + 1, end).filter((line) => line.trim() && !level(line));
    if (!content.some((line) => /\d/.test(line.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "")))) {
      removed.push(lines[i].replace(/^#+\s*/, "").trim());
      lines = [...lines.slice(0, i), ...lines.slice(end)];
      i--;
    }
  }
  // v3.1 (batch 6, Cowork's A3): never delete a column or a cell. A journal-entry table's debit and credit columns are
  // legitimately half-empty; the payout example's Credit column (with "$2,415 + $85 = $2,500") was deleted and the table
  // stopped balancing. A table that is mostly empty cells is missing data: the whole table goes — unless it is an
  // illustration (a worked example or a "hypothetical" passage), where empty cells are the point.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue;
    let end = i + 2;
    while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|");
    const rows = lines.slice(i + 2, end).map(cells), width = cells(lines[i]).length;
    const drop = Array.from({ length: width }, (_, c) => c > 0 && rows.length > 0 && rows.filter((row) => EMPTY_CELL.test(row[c] ?? "")).length * 3 >= rows.length * 2);
    if (!drop.some(Boolean)) { i = end - 1; continue; }
    let heading = -1, illustrated = false;
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j].trim()) continue;
      if (level(lines[j])) { heading = j; break; }
      if (/\b(?:hypothetical|for illustration|illustrative|imagine|suppose)\b/i.test(lines[j])) illustrated = true;
    }
    for (let j = heading + 1; j < i; j++) if (/\b(?:hypothetical|for illustration|illustrative|imagine|suppose)\b/i.test(lines[j])) illustrated = true;
    if (illustrated || examples.some((body) => body.includes(lines[i]) && body.includes(lines[end - 1]))) { i = end - 1; continue; }
    removed.push(`table: ${lines[i].trim()}`);
    lines.splice(i, end - i);
    i--;
  }
  return { markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}${tail}`, removed };
}

/** P295 (fix 5): the FAQ is the article's last section (before its Sources and Related reading); a step or section that
 * sat after it moves above it. */
const FAQ_SECTION = /^##\s+(?:frequently asked questions|faqs?|common questions)\b.*$/im;
export function withFaqLast(article: string): string {
  const split = SOURCES_HEADING.exec(article), body = split ? article.slice(0, split.index) : article, tail = split ? article.slice(split.index) : "";
  const faq = FAQ_SECTION.exec(body);
  if (!faq) return article;
  const after = body.slice(faq.index + faq[0].length), next = /^##\s/m.exec(after);
  if (!next) return article;
  const faqSection = body.slice(faq.index, faq.index + faq[0].length + next.index).trimEnd();
  const rest = `${body.slice(0, faq.index)}${after.slice(next.index)}`.trimEnd();
  return `${rest}\n\n${faqSection}\n\n${tail}`.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, split ? "" : "\n").replace(/\n\n$/, "\n\n");
}
