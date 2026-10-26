import type { Doc } from "../_generated/dataModel";
import { contentWords, exactReplacement, preserveWordPressReviewedText } from "./contentSelection.ts";
import { readerVisibleDefects } from "./articleQuality.ts";
import { renderSafePublicationHtml } from "./safeMarkdownHtml.ts";
import { isApiCmsMethod } from "./cmsDestinations.ts";
import { canonicalBlogHref, consolidates } from "./pentraConsolidation.ts";

export type CorrectiveInput = {
  kind: "factual_correction" | "technical_repair" | "reader_text_repair" | "related_reading_titles";
  before: string; reason: string; field?: "siteSummary" | "productUsage";
  targetUrl?: string;
  /** reader_text_repair: the exact paragraph written in place of the process
   * wording ("" removes the paragraph); related_reading_titles: the exact
   * repaired list. Stored as the patch's `after`. */
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
/** P176 (Oct 24 2026): Pentra's Related reading list used to cut a linked
 * article's title at the 8-word anchor cap ("What Is an AI Sales Agent? How
 * It", on 9 LeadPilot pages). This repair only completes those titles: the
 * same links in the same order, each changed link text extending its cut
 * words into the whole title, and nothing else on the page. No model runs. */
const RELATED_ENTRY = /^- \[([^\]\n]+)\]\(([^)\s]+)\)$/;
const titleWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
/** P221 (Oct 26 2026): the old engine also dropped a title's leading question or filler word before cutting it
 * ("Makes a B2B Qualified Lead—And How to Spot" for "What Makes a B2B Qualified Lead—And How to Spot One Before Sales
 * Wastes Time"). Only such a word may be missing in front. */
const DROPPED_LEADING_WORDS = new Set(["what", "how", "why", "when", "where", "which", "who", "is", "are", "do", "does", "can", "the", "a", "an"]);
/** A link text cut from a title: its words are the title's first words, and fewer (or, P221, the title's words after
 * a dropped leading question or filler word, at least three of them). */
export function cutOfTitle(text: string, title: string): boolean {
  const a = titleWords(text), t = titleWords(title);
  const from = (start: number) => a.length > 0 && start + a.length <= t.length && a.length < t.length && a.every((word, i) => t[start + i] === word);
  return from(0) || (a.length >= 3 && DROPPED_LEADING_WORDS.has(t[0] ?? "") && from(1));
}
/** P218 (Oct 26 2026): on a site with consolidated pages (pentra.dev), a Related reading link to a page that now
 * redirects goes to the page it leads to, under that page's title; an entry that then repeats an earlier one, or leads
 * to the page itself, goes. Every other site keeps the exact list of links. */
export type RelatedReadingSite = { domain?: string; selfHref?: string };
/** A page's own address on its site ("/blog/slug"), for an entry that would lead back to it. */
export const pagePath = (page: { url?: string }) => {
  try { return page.url ? new URL(page.url).pathname.replace(/\/+$/, "") : undefined; } catch { return undefined; }
};
const relatedFinal = (site: RelatedReadingSite | undefined, href: string) =>
  consolidates(site?.domain) ? canonicalBlogHref(site!.domain!, href) : href;
const dropsEntry = (site: RelatedReadingSite | undefined, final: string, kept: Set<string>) =>
  consolidates(site?.domain) && (final === site?.selfHref || kept.has(final));

function relatedTitlesRepair(markdown: string, before: string, replacement: string, site?: RelatedReadingSite): string {
  const blocks = markdown.split(/\n\s*\n/).map(block => block.trim()), at = blocks.indexOf(before);
  if (at < 1 || !/^##\s+Related reading$/i.test(blocks[at - 1])) throw new Error("Only Pentra's Related reading list is repaired this way");
  const was = before.split("\n").map(line => RELATED_ENTRY.exec(line)), now = replacement.split("\n").map(line => RELATED_ENTRY.exec(line));
  if (was.some(entry => !entry) || now.some(entry => !entry)) throw new Error("A Related reading repair keeps the exact list of links");
  let changed = 0, next = 0;
  const kept = new Set<string>();
  for (const entry of was) {
    const [, oldText, href] = entry!, final = relatedFinal(site, href);
    // Each entry stays (its cut title completed, or pointed at the page it now leads to), or goes only when it
    // repeats an earlier entry or leads to the page itself (P218, consolidated sites only).
    const repaired = now[next];
    if (!repaired || (repaired[2] !== href && repaired[2] !== final)) {
      if (dropsEntry(site, final, kept)) { changed++; continue; }
      if (!repaired) throw new Error("A Related reading repair keeps the exact list of links");
      throw new Error("A Related reading repair cannot change a link");
    }
    next++;
    const [, newText, newHref] = repaired;
    kept.add(final);
    if (newHref !== href) {
      if (!newText.trim() || titleWords(newText).length > 16 || newText.length > 120 || /[\[\](){}<>]/.test(newText)) {
        throw new Error("A link pointed at the page it now leads to is named by that page's title");
      }
      changed++;
      continue;
    }
    if (newText === oldText) continue;
    if (!cutOfTitle(oldText, newText) || titleWords(newText).length > 16 || newText.length > 120 || /[\[\](){}<>]/.test(newText)) {
      throw new Error("A Related reading repair only completes a cut title");
    }
    changed++;
  }
  if (next !== now.length || now.length === 0) throw new Error("A Related reading repair keeps the exact list of links");
  if (changed === 0) throw new Error("This Related reading list has no cut title to complete");
  const nextMarkdown = exactReplacement(markdown, before, replacement);
  const previous = new Set(readerVisibleDefects(markdown));
  if (readerVisibleDefects(nextMarkdown).some((defect) => !previous.has(defect))) throw new Error("The repair would leave another reader-visible defect on the page");
  return replacement;
}
/** The links of a page's Related reading list (the list the repair may touch),
 * or none when the page has no such list or it holds anything but links. */
export function relatedReadingHrefs(markdown: string): string[] {
  const blocks = markdown.split(/\n\s*\n/).map(block => block.trim());
  const at = blocks.findIndex(block => /^##\s+Related reading$/i.test(block));
  const lines = at >= 0 && blocks[at + 1] ? blocks[at + 1].split("\n") : [];
  return lines.every(line => RELATED_ENTRY.test(line)) ? lines.map(line => RELATED_ENTRY.exec(line)![2]) : [];
}
/** The repair of a page's Related reading list from the live titles of the
 * articles it links (href to title): each entry cut from its linked title gets
 * the whole title (`wholeTitle`, relatedReadingTitle). Null when none is cut. */
export function relatedReadingRepairProposal(markdown: string, titleByHref: Map<string, string>, wholeTitle: (title: string) => string | null,
  site?: RelatedReadingSite) {
  const blocks = markdown.split(/\n\s*\n/).map(block => block.trim());
  const at = blocks.findIndex(block => /^##\s+Related reading$/i.test(block));
  const before = at >= 0 ? blocks[at + 1] : undefined;
  if (!before) return null;
  const lines = before.split("\n");
  if (lines.some(line => !RELATED_ENTRY.test(line))) return null;
  let changed = false;
  const kept = new Set<string>(), repaired: string[] = [];
  for (const line of lines) {
    const [, text, href] = RELATED_ENTRY.exec(line)!, final = relatedFinal(site, href);
    if (dropsEntry(site, final, kept)) { changed = true; continue; }
    const title = titleByHref.get(final), whole = title ? wholeTitle(title) : null;
    if (final !== href) {
      // A link to a consolidated page needs the page it leads to by name; without its title the list waits.
      if (!whole) return null;
      kept.add(final); repaired.push(`- [${whole}](${final})`); changed = true;
      continue;
    }
    kept.add(final);
    if (!whole || whole === text || !cutOfTitle(text, whole)) { repaired.push(line); continue; }
    changed = true;
    repaired.push(`- [${whole}](${href})`);
  }
  return changed && repaired.length > 0 ? { before, replacement: repaired.join("\n") } : null;
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
  } else if (input.kind === "related_reading_titles") {
    if (input.field || input.targetUrl || input.replacement === undefined) throw new Error("A Related reading repair takes only the exact repaired list");
    if (e.kind !== "github") throw new Error("A Related reading repair maps only to a GitHub Markdown source");
    after = relatedTitlesRepair(e.markdown, before, input.replacement, { domain: site?.domain, selfHref: pagePath(page) });
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
  // Hosted platforms hold the exact HTML Pentra rendered, so paragraphs map through the same renderer.
  const pairs = e.kind === "github" ? [[before, after]] : isApiCmsMethod(e.kind) ? [[renderSafePublicationHtml(before), after === "" ? "" : renderSafePublicationHtml(after)]] : [false, true].flatMap(rel => {
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

/** When Autopilot may request its next Related reading repair (P176): an
 * Autopilot site publishing to GitHub, nothing paused or under owner review,
 * the next slot at least six hours away (a repair never delays an article),
 * 30 minutes after its last repair, and a new pass over the site's pages a week
 * after the last one ended (a day, when it had to leave a page with unfinished
 * work for later: P180). A pass in progress continues. */
/** P222 (Oct 26 2026): a repair is a commit, and each commit is a deploy on the owner's hosting: Vercel's Hobby plan
 * allows 100 a day across the account, pentra.dev's repository feeds two projects (two deploys a push), and two
 * 30-minute repair chains plus the day's ships used them up at 11:51Z (LeadPilot's repair could not go live). Two
 * hours apart leaves room for publications, which come first. */
export const RELATED_REPAIR_SLOT_LEAD_MS = 6 * 3_600_000, RELATED_REPAIR_SPACING_MS = 2 * 3_600_000, RELATED_REPAIR_REST_MS = 7 * 86_400_000,
  RELATED_REPAIR_RETRY_MS = 86_400_000;
/** P220 (Oct 26 2026): the rules the link repair runs by. A change to them (2, P218: links to consolidated pages)
 * makes every page due once more: a pass records the rules it started under, and a site whose last finished pass
 * ran under earlier rules runs a fresh one, instead of resting a week with pages passed under the old rules. */
export const RELATED_REPAIR_VERSION = 3; // 3: P221 (a title cut after a dropped leading question word)
export function relatedRepairAllowed(site: Doc<"sites">, now: number): boolean {
  const s = site.contentSchedule;
  return Boolean(s && site.serviceMode === "growth_first" && site.autopilotEnabled && s.autopilotSelectedAt && s.autopublishConsentAt &&
    !s.paused && !s.ownerReviewedOnly && !site.approvalRequired && (site.publishMethod ?? "github") === "github" &&
    !site.deletionStatus && !site.accountDeletionRequestedAt && !site.publicationLeaseOwner &&
    s.nextDeadlineAt - now >= RELATED_REPAIR_SLOT_LEAD_MS &&
    (s.relatedRepairAt === undefined || now - s.relatedRepairAt >= RELATED_REPAIR_SPACING_MS) &&
    (Boolean(s.relatedRepairCursor) || s.relatedRepairCleanAt === undefined || now - s.relatedRepairCleanAt >= RELATED_REPAIR_REST_MS ||
      (s.relatedRepairRetryAt !== undefined && now >= s.relatedRepairRetryAt) || (s.relatedRepairCleanVersion ?? 1) < RELATED_REPAIR_VERSION));
}

export function verifyCorrectivePatch(site: Doc<"sites">, page: Doc<"pages">, patch: CorrectivePatch) {
  const expected = planCorrectiveChange(site, page, { kind: patch.kind, before: patch.before, reason: patch.reason,
    ...(patch.field ? { field: patch.field } : {}), ...(patch.targetUrl ? { targetUrl: patch.targetUrl } : {}),
    ...(patch.kind === "reader_text_repair" || patch.kind === "related_reading_titles" ? { replacement: patch.after } : {}) });
  for (const key of ["after", "sourceBefore", "sourceAfter", "brokenUrl"] as const) if (expected[key] !== patch[key]) throw new Error("Correction lost its exact owner/source evidence");
  return exactReplacement(page.editable!.markdown, patch.before, patch.after);
}
