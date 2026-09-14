import type { Doc } from "../_generated/dataModel";
import { contentWords, exactReplacement, preserveWordPressReviewedText } from "./contentSelection.ts";

export type CorrectiveInput = {
  kind: "factual_correction" | "technical_repair";
  before: string; reason: string; field?: "siteSummary" | "productUsage";
  targetUrl?: string;
};
export type CorrectivePatch = CorrectiveInput & {
  after: string; sourceBefore: string; sourceAfter: string; brokenUrl?: string;
};
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
  const pairs = e.kind === "github" ? [[before, after]] : [false, true].flatMap(rel => {
    const old = html(before, rel), next = html(after, rel);
    return [[old, preserveWordPressReviewedText(next)], [preserveWordPressReviewedText(old), preserveWordPressReviewedText(next)]];
  });
  const pair = pairs.find(([old]) => e.sourceContent.includes(old) && e.sourceContent.indexOf(old) === e.sourceContent.lastIndexOf(old));
  if (!pair) throw new Error("Correction cannot safely map this layout to its exact current source");
  exactReplacement(e.sourceContent, pair[0], pair[1]);
  return { ...input, after, sourceBefore: pair[0], sourceAfter: pair[1], ...(brokenUrl ? { brokenUrl } : {}) };
}

export function verifyCorrectivePatch(site: Doc<"sites">, page: Doc<"pages">, patch: CorrectivePatch) {
  const expected = planCorrectiveChange(site, page, { kind: patch.kind, before: patch.before, reason: patch.reason,
    ...(patch.field ? { field: patch.field } : {}), ...(patch.targetUrl ? { targetUrl: patch.targetUrl } : {}) });
  for (const key of ["after", "sourceBefore", "sourceAfter", "brokenUrl"] as const) if (expected[key] !== patch[key]) throw new Error("Correction lost its exact owner/source evidence");
  return exactReplacement(page.editable!.markdown, patch.before, patch.after);
}
