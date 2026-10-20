import type { Doc } from "../_generated/dataModel";
import { contentWords, exactReplacement, preserveWordPressReviewedText } from "./contentSelection.ts";
import { readerVisibleDefects } from "./articleQuality.ts";
import { renderSafePublicationHtml } from "./safeMarkdownHtml.ts";

export type CorrectiveInput = {
  kind: "factual_correction" | "technical_repair" | "reader_text_repair";
  before: string; reason: string; field?: "siteSummary" | "productUsage";
  targetUrl?: string;
  /** reader_text_repair only: the exact paragraph written in place of the
   * process wording ("" removes the paragraph). Stored as the patch's `after`. */
  replacement?: string;
};
export type CorrectivePatch = Omit<CorrectiveInput, "replacement"> & {
  after: string; sourceBefore: string; sourceAfter: string; brokenUrl?: string;
};
const pipelineText = (markdown: string) => readerVisibleDefects(markdown).filter((defect) => defect.includes(": pipeline text "));
const otherDefects = (markdown: string) => readerVisibleDefects(markdown).filter((defect) => !defect.includes(": pipeline text "));
const tokens = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);

/** C1b (Oct 19 2026): pages published before rule 2a can carry pipeline text
 * ("The excerpt is truncated, so this article relies only on that one
 * statement."). A person writes the replacement; this check proves it only
 * removes process wording: the original paragraph must contain pipeline text
 * and the replacement none, it is not longer, it adds no number, citation or
 * link, and the page gains no other reader-visible defect. No model runs. */
function readerTextRepair(markdown: string, before: string, replacement: string): string {
  if (pipelineText(before).length === 0) throw new Error("This paragraph has no pipeline text to repair");
  if (replacement !== replacement.trim() || /\n/.test(replacement) || /^\s*(?:#|[-*+]\s|\d+[.)]\s|>|\|)/.test(replacement)) {
    throw new Error("The replacement must be one plain paragraph");
  }
  if (replacement && pipelineText(replacement).length > 0) throw new Error("The replacement still contains pipeline text");
  if (replacement.length > before.length) throw new Error("A wording repair cannot add content");
  for (const pattern of [/\d[\d,.]*%?/g, /\[(\d+)\]/g, /\]\(([^)\s]+)\)/g, /(https?:\/\/[^\s)]+)/g]) {
    const allowed = new Set(tokens(before, pattern));
    if (tokens(replacement, pattern).some((token) => !allowed.has(token))) throw new Error("A wording repair cannot add a number, citation or link");
  }
  const next = exactReplacement(markdown, before, replacement);
  const previous = new Set(otherDefects(markdown));
  if (otherDefects(next).some((defect) => !previous.has(defect))) throw new Error("The repair would leave another reader-visible defect on the page");
  return replacement;
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (s: string) => !/[\n\[\]`#*<>|{}]|https?:/i.test(s);

/** Deterministic owner corrections only. No model decides facts, paid audit
 * scores are not fabricated, and the rest of the retained page is immutable. */
export function planCorrectiveChange(site: Doc<"sites">, page: Doc<"pages">, input: CorrectiveInput): CorrectivePatch {
  const e = page.editable, { before } = input;
  if (!e?.active || before !== before.trim() || contentWords(before) > 100 || before.length < 15 ||
    !e.markdown.split(/\n\s*\n/).some(p => p.trim() === before) || input.reason.trim().length < 12 || input.reason.length > 400) {
    throw new Error("Correction requires one exact bounded paragraph and an owner-confirmed reason");
  }
  let after: string, brokenUrl: string | undefined;
  const html = (paragraph: string, withRel: boolean) => {
    const match = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/.exec(paragraph);
    if (!match) return `<p>${escape(paragraph)}</p>`;
    const at = match.index;
    return `<p>${escape(paragraph.slice(0, at))}<a ${withRel ? 'rel="nofollow noopener noreferrer" ' : ''}href="${escape(match[2])}">${escape(match[1])}</a>${escape(paragraph.slice(at + match[0].length))}</p>`;
  };
  if (input.kind === "factual_correction") {
    if (!input.field || input.targetUrl || !plain(before) || /\b(?:pricing|price|checkout|legal|privacy|terms|founder)\b|[$€£]/i.test(before)) throw new Error("Protected or unsupported factual correction");
    after = site[input.field] ?? "";
    if (after.length < 15 || contentWords(after) > 100 || !plain(after) || /\b(?:pricing|price|checkout|legal|privacy|terms|founder)\b|[$€£]/i.test(after)) throw new Error("Correction needs an exact supported unprotected quote from the confirmed business profile");
  } else if (input.kind === "reader_text_repair") {
    if (input.field || input.targetUrl || input.replacement === undefined) throw new Error("A wording repair takes only the exact replacement paragraph");
    after = readerTextRepair(e.markdown, before, input.replacement);
  } else {
    if (input.field || !input.targetUrl) throw new Error("Technical correction requires a verified same-site destination");
    const links = [...before.matchAll(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g)];
    if (links.length !== 1 || !plain(before.replace(links[0][0], "")) || !plain(links[0][1])) throw new Error("Unsupported link paragraph layout");
    brokenUrl = links[0][2];
    for (const address of [brokenUrl, input.targetUrl]) {
      const url = new URL(address), origin = new URL(page.url).origin;
      if (url.origin !== origin || url.protocol !== "https:" || url.search || url.hash || url.username || url.password) throw new Error("Correction destinations must be exact same-site public URLs");
    }
    after = exactReplacement(before, `](${brokenUrl})`, `](${input.targetUrl})`);
  }
  exactReplacement(e.markdown, before, after);
  // Ghost holds the exact HTML Pentra rendered, so its paragraphs map through the same renderer.
  const pairs = e.kind === "github" ? [[before, after]] : e.kind === "ghost" ? [[renderSafePublicationHtml(before), after === "" ? "" : renderSafePublicationHtml(after)]] : [false, true].flatMap(rel => {
    // A removed paragraph removes its whole <p> element, never leaving an empty one.
    const old = html(before, rel), next = after === "" ? "" : html(after, rel);
    return [[old, preserveWordPressReviewedText(next)], [preserveWordPressReviewedText(old), preserveWordPressReviewedText(next)]];
  });
  const pair = pairs.find(([old]) => e.sourceContent.includes(old) && e.sourceContent.indexOf(old) === e.sourceContent.lastIndexOf(old));
  if (!pair) throw new Error("Correction cannot safely map this layout to its exact current source");
  exactReplacement(e.sourceContent, pair[0], pair[1]);
  const { replacement: _replacement, ...stored } = input;
  void _replacement;
  return { ...stored, after, sourceBefore: pair[0], sourceAfter: pair[1], ...(brokenUrl ? { brokenUrl } : {}) };
}

export function verifyCorrectivePatch(site: Doc<"sites">, page: Doc<"pages">, patch: CorrectivePatch) {
  const expected = planCorrectiveChange(site, page, { kind: patch.kind, before: patch.before, reason: patch.reason,
    ...(patch.field ? { field: patch.field } : {}), ...(patch.targetUrl ? { targetUrl: patch.targetUrl } : {}),
    ...(patch.kind === "reader_text_repair" ? { replacement: patch.after } : {}) });
  for (const key of ["after", "sourceBefore", "sourceAfter", "brokenUrl"] as const) if (expected[key] !== patch[key]) throw new Error("Correction lost its exact owner/source evidence");
  return exactReplacement(page.editable!.markdown, patch.before, patch.after);
}
