/** Deleting sentences from a finished article without breaking what is left.
 *
 * Pentra repairs evidence defects by deleting the exact sentences a review
 * could not verify: it costs nothing and can never add a claim. Done blindly,
 * a deletion leaves scars the next review rejects as material defects (Oct 15
 * 2026, LeadPilot): a numbered list skipping step 2, a paragraph whose opening
 * sentence is gone ("The engine replies..." with no engine introduced), a
 * quotation cut in half, a "This means..." pointing at nothing. Those drafts
 * scored 52-62 and never published. Every deletion therefore passes these
 * checks; a sentence that cannot be deleted cleanly is HELD (left exactly as
 * written) so the fail-closed review still sees it and the writer rewrites the
 * passage instead. Headings, tables, code, comments and source rows are never
 * edited. */

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z*"'\[“‘])/;
const LIST_PREFIX = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)?)/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/;
/** A sentence opening like this depends on the sentence or block before it. */
const LEANS_ON_PREVIOUS = /^(?:\*\*[^*]{1,80}\*\*[:.]?\s*)?["“'‘(]?(?:this|that|these|those|it|its|it's|they|they're|their|them|such|both|another|also|however|but|and|or|so|then|thus|therefore|instead|otherwise|still|yet|meanwhile|likewise|similarly|in that case|as a result|for example|for instance|in other words|that's|here's why|even so|at that point|from there)\b/i;
const BOLD_LEAD_IN_ONLY = /^(?:\*\*[^*]+\*\*|__[^_]+__)[:.]?$/;
/** Inside a paragraph, "The engine replies..." right after a deleted sentence
 * usually names something that sentence introduced. */
const DEFINITE_REFERENCE = /^(?:\*\*[^*]{1,80}\*\*[:.]?\s*)?["“'‘(]?the\b/i;
/** A heading that is one step of a sequence: dropping its section leaves a gap. */
const NUMBERED_HEADING = /^\s*#{1,6}\s+(?:(?:step|phase|stage|part|day|week|module|lesson|tip|mistake|reason|way|method|option)\s*#?\d+|\d+[.):]\s)/i;

export type CoherentDeletion = { markdown: string; removed: string[]; held: string[] };

function editable(line: string) {
  return Boolean(line.trim()) && !/^\s*(?:#|\||<!--)/.test(line) && !/^\s*[-*]\s+https?:\/\//i.test(line);
}

function quotesBalanced(text: string) {
  return (text.match(/"/g) ?? []).length % 2 === 0 && (text.match(/“/g) ?? []).length === (text.match(/”/g) ?? []).length;
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
  options: { skipLine?: (line: string) => boolean } = {},
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
    if (flagged.every(Boolean)) {
      // A whole block goes only when nothing depends on it: never a numbered
      // step, never the last content under a heading, never a block the next
      // one refers back to.
      const next = nextProseBody(lines, i, fence);
      if (ORDERED_ITEM.test(line) || (next !== undefined && LEANS_ON_PREVIOUS.test(next)) || lastItemOfIntroducedList(lines, i) ||
        answersPreviousQuestion(lines, i)) { hold(); continue; }
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
      continue;
    }
    // Part of a block: never cut a quotation, never strand a sentence that
    // refers back to (or names something introduced by) a deleted one.
    if (flaggedText.some((s) => !quotesBalanced(s)) ||
      segments.some((s, k) => k > 0 && !flagged[k] && flagged[k - 1] && (LEANS_ON_PREVIOUS.test(s.trim()) || DEFINITE_REFERENCE.test(s.trim())))) { hold(); continue; }
    const kept = segments.filter((_, k) => !flagged[k]).join(" ").trim();
    if (!kept || BOLD_LEAD_IN_ONLY.test(kept)) { hold(); continue; }
    lines[i] = `${prefix}${kept}`;
    removedAt[i] = flaggedText;
  }
  // Reported in document order.
  const removed = removedAt.flatMap((x) => x ?? []), held = heldAt.flatMap((x) => x ?? []);
  if (!removed.length) return { markdown, removed, held };
  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n"), removed, held };
}
