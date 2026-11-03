/** Deleting sentences from a finished article without breaking what is left.
 *
 * Pentra repairs evidence defects by deleting the exact sentences a review
 * could not verify: it costs nothing and can never add a claim. Done blindly,
 * a deletion leaves scars the next review rejects as material defects (Oct 15
 * 2026, LeadPilot): a numbered list skipping step 2, a paragraph whose opening
 * sentence is gone ("The engine replies..." with no engine introduced), a
 * quotation cut in half, a "This means..." pointing at nothing. Those drafts
 * scored 52-62 and never published.
 *
 * v3.1 (Cowork's batch 6 order): the deletion unit is the WHOLE paragraph or
 * list item, never a sentence inside it — rewriting the remainder of a
 * paragraph whose other half was deleted is what orphaned batch 6's steps and
 * definitions ("Add one if it doesn't"). A line with any flagged sentence goes
 * whole, under the same holds as before (numbered steps, bold labels, FAQ
 * question pairing), and a ":" paragraph whose introduced block went with it,
 * or a heading left with nothing under it, goes too. Headings, tables, code,
 * comments and source rows are never edited. */

export const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z*”’\[“‘])/;
export const LIST_PREFIX = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)?)/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/;
/** A sentence opening like this depends on the sentence or block before it. */
const LEANS_ON_PREVIOUS = /^(?:\*\*[^*]{1,80}\*\*[:.]?\s*)?[““’‘(]?(?:this|that|these|those|it|its|it’s|they|they’re|their|them|such|both|another|also|however|but|and|or|so|then|thus|therefore|instead|otherwise|still|yet|meanwhile|likewise|similarly|in that case|as a result|for example|for instance|in other words|that’s|here’s why|even so|at that point|from there)\b/i;
/** A bold label that numbers a step of a sequence: its block is never dropped. */
const NUMBERED_BOLD_LABEL = /^\s*(?:\*\*|__)\s*(?:(?:step|phase|stage|part|day|week|module|lesson|tip|mistake|reason|way|method|option)\s*#?\d+|\d+[.):])/i;
/** A heading that is one step of a sequence: dropping its section leaves a gap. */
const NUMBERED_HEADING = /^\s*#{1,6}\s+(?:(?:step|phase|stage|part|day|week|module|lesson|tip|mistake|reason|way|method|option)\s*#?\d+|\d+[.):]\s)/i;

export type CoherentDeletion = { markdown: string; removed: string[]; held: string[] };

function editable(line: string) {
  return Boolean(line.trim()) && !/^\s*(?:#|\||<!--)/.test(line) && !/^\s*[-*]\s+https?:\/\//i.test(line);
}

/** The body of the next prose line after `index` within the same section, if any. */
function nextProseBody(lines: string[], index: number, fence: boolean[]) {
  for (let j = index + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    if (fence[j] || /^\s*#/.test(lines[j])) return undefined;
    return lines[j].slice(lines[j].match(LIST_PREFIX)?.[0].length ?? 0);
  }
  return undefined;
}

/** The block answers the question on the line before it (an FAQ written as a
 * bold question, Oct 16 2026: "**Is there a free way to try it?**" was left
 * with no answer). Deleting the answer strands the question. */
function answersPreviousQuestion(lines: string[], index: number) {
  for (let j = index - 1; j >= 0; j--) {
    if (!lines[j].trim()) continue;
    if (headingLevel(lines[j])) return false;
    return /\?\s*(?:\*\*|__|\*|_)?\s*$/.test(lines[j]);
  }
  return false;
}

/** The last remaining item of a list that a "...as follows:" line introduces. */
function lastItemOfIntroducedList(lines: string[], index: number) {
  if (!/^\s*[-*+]\s+/.test(lines[index])) return false;
  let j = index - 1;
  for (; j >= 0; j--) {
    if (!lines[j].trim()) continue;
    if (/^\s*[-*+]\s+/.test(lines[j])) return false;
    break;
  }
  for (let k = index + 1; k < lines.length; k++) {
    if (!lines[k].trim()) continue;
    if (/^\s*[-*+]\s+/.test(lines[k])) return false;
    break;
  }
  return j >= 0 && /:\s*$/.test(lines[j]);
}

function previousContentLine(lines: string[], index: number) {
  for (let j = index - 1; j >= 0; j--) if (lines[j].trim()) return j;
  return -1;
}

const headingLevel = (line: string) => /^\s*(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/** True when `index` is the only remaining content line between its headings. */
function onlyContentInSection(lines: string[], index: number) {
  for (let j = index - 1; j >= 0 && !headingLevel(lines[j]); j--) if (lines[j].trim()) return false;
  for (let j = index + 1; j < lines.length && !headingLevel(lines[j]); j++) if (lines[j].trim()) return false;
  return true;
}

/**
 * Delete the sentences `drop` selects wherever that leaves coherent prose.
 * `skipLine` marks further lines that must never be edited (for example
 * bibliography rows). Returns the exact markdown unchanged when nothing was
 * removed.
 */
export function deleteSentencesCoherently(
  markdown: string,
  drop: (sentence: string) => boolean,
  options: { skipLine?: (line: string) => boolean; dropStrandedQuestion?: boolean } = {},
): CoherentDeletion {
  const lines = markdown.split("\n");
  const fence: boolean[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fence.push(true); inside = !inside; continue; }
    fence.push(inside);
  }
  const removedAt: string[][] = [], heldAt: string[][] = [];
  // Last to first: a deletion never changes what an earlier line leans on,
  // and a block whose follower was itself deleted is judged against what remains.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (fence[i] || !editable(line) || options.skipLine?.(line)) continue;
    const prefix = line.match(LIST_PREFIX)?.[0] ?? "";
    const segments = line.slice(prefix.length).split(SENTENCE_SPLIT);
    const flagged = segments.map((sentence) => drop(sentence));
    if (!flagged.some(Boolean)) continue;
    const flaggedText = segments.filter((_, k) => flagged[k]).map((s) => s.trim());
    const hold = () => { heldAt[i] = flaggedText; };
    // v3.1: the whole paragraph or list item goes (never a sentence inside it), under the same holds as a full block.
    if (!flagged.every(Boolean) && (ORDERED_ITEM.test(line) || NUMBERED_BOLD_LABEL.test(line.slice(prefix.length)))) { hold(); continue; }
    // A whole block goes only when nothing depends on it: never the last content under a heading, never a block the next
    // one refers back to.
    const next = nextProseBody(lines, i, fence);
    // P289 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md hole 3): an FAQ answer left with nothing goes with its question.
    const question = options.dropStrandedQuestion && answersPreviousQuestion(lines, i) && !ORDERED_ITEM.test(line) &&
      !(next !== undefined && LEANS_ON_PREVIOUS.test(next)) ? previousContentLine(lines, i) : -1;
    if (question >= 0) { lines[question] = ""; lines[i] = ""; removedAt[i] = flaggedText; continue; }
    if (flagged.every(Boolean) && (ORDERED_ITEM.test(line) || NUMBERED_BOLD_LABEL.test(line.slice(prefix.length)) ||
      (next !== undefined && LEANS_ON_PREVIOUS.test(next)) || lastItemOfIntroducedList(lines, i) ||
      answersPreviousQuestion(lines, i))) { hold(); continue; }
    if (onlyContentInSection(lines, i)) {
      // The section's only content: the section goes with it (heading
      // included, unless subsections follow), except a numbered step or
      // the article's introduction.
      let h = i - 1;
      while (h >= 0 && !headingLevel(lines[h])) h--;
      let n = i + 1;
      while (n < lines.length && !headingLevel(lines[n])) n++;
      const subsections = h >= 0 && n < lines.length && headingLevel(lines[n]) > headingLevel(lines[h]);
      const introduction = h < 0 && lines.some((other, k) => k !== i && other.trim());
      if (introduction || (h >= 0 && NUMBERED_HEADING.test(lines[h]) && !subsections)) { hold(); continue; }
      if (h >= 0 && !subsections) lines[h] = "";
    }
    lines[i] = "";
    removedAt[i] = flaggedText;
  }
  // v3.1 cascades: a ":" paragraph whose introduced list or table went with it, and a heading left with nothing under it.
  if (removedAt.some((x) => x)) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].trim();
      if (!text || headingLevel(lines[i]) || /^\s*(?:\||```)/.test(lines[i]) || !/:\s*$/.test(text)) continue;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || headingLevel(lines[j]) || fence[j]) lines[i] = "";
    }
    for (let i = 0; i < lines.length; i++) {
      const h = headingLevel(lines[i]);
      if (!h || h === 1) continue;
      let j = i + 1, empty = true;
      for (; j < lines.length; j++) {
        const level = headingLevel(lines[j]);
        if (level && level <= h) break;
        if (lines[j].trim()) { empty = false; break; }
      }
      if (empty) lines[i] = "";
    }
  }
  // Reported in document order.
  const removed = removedAt.flatMap((x) => x ?? []), held = heldAt.flatMap((x) => x ?? []);
  if (!removed.length) return { markdown, removed, held };
  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, ""), removed, held };
}
