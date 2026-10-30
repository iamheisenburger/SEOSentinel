/** P256 (Oct 30 2026): a new user's first draft showed "Fact-check score is 78; strict minimum is 85." and "Editorial
 * quality score is 62; strict minimum is 85." Customers read what Pentra's checks found and what to do about it, in
 * plain words: never a score, a threshold or a check's internal name. The checks themselves are unchanged. */

/** Statements the checks could not match to a source: summarised once, from the fact check's own list. */
const UNSOURCED = /^(?:Fact-check score is \d+; strict minimum is 85\.|Strict publication requires a completed claim-to-evidence audit\.|Claim-to-evidence ledger is empty\.|Claim ledger entry \d+ |Evidence-required paragraph \d+ |\d+ quantified outcome or operational claim\(s\) lack an inline citation\.)/;
export const UNSOURCED_NOTE = "Some statements aren't backed by a source yet. Check them, or edit them out, before you publish.";

const PLAIN: [RegExp, string | ((match: RegExpExecArray) => string)][] = [
  [UNSOURCED, UNSOURCED_NOTE],
  [/^Editorial quality score is \d+(?:\.\d+)?; strict minimum is 85\.$/, "Pentra's editor flagged a few passages to back up with a source or word more carefully."],
  [/^Strict publication requires a completed fact check\.$/, "The fact check hasn't finished for this version yet."],
  [/^Strict publication requires a completed people-first editorial review\.$/, "The editor's read-through hasn't finished for this version yet."],
  [/^Strict publication requires a completed media-quality review\.$/, "The image check hasn't finished for this version yet."],
  [/^Strict publication requires at least one internal link/, "Pentra adds links to your other pages before it publishes."],
  [/^Meta description is missing\.$/, "Add a search description: the sentence shown under your link on Google."],
  [/^Meta description is too short/, "The search description (the sentence shown under your link on Google) is too short. Make it one full sentence of about 110 to 155 characters."],
  [/^Meta description is \d+ characters; maximum is 160\.$/, "The search description is too long. Keep it under 160 characters."],
  [/^Meta description (?:must end as a complete sentence|ends with a dangling or incomplete phrase)\.$/, "The search description should be one complete sentence."],
  [/^Meta title is missing\.$/, "Add a search title: the headline shown on Google."],
  [/^Meta title is \d+ characters; maximum is 65\.$/, "The search title is too long. Keep it under 65 characters."],
  [/^Meta title introduces unsupported year/, "The search title names a year the article doesn't support."],
  [/^Article title is missing\.$/, "Add a title."],
  [/^Article body is missing\.$/, "The article has no text yet."],
  [/^Article is too thin/, "The article is shorter than Pentra publishes. Add a section or two."],
  [/^Article is overlong for its format/, "The article is longer than this kind of article needs. Trim repeated or off-topic parts."],
  [/^A product-specific section requires validated first-party product evidence\.$/, "The section about your product says something your business details don't confirm."],
  [/^Quantified outcome claims require at least two/, "Numbers about results need a second source, or softer wording."],
  [/^Title or meta description makes a quantified outcome claim/, "The title or search description promises a number the article can't back up."],
  [/^Title or meta description uses unsupported promotional language\.$/, "The title or search description uses hype words. Describe what the article covers instead."],
  [/^Reader-visible defect: \d+ cited sentence\(s\) state a number their source does not contain, e\.g\. «(.+)»\.$/,
    match => `A number isn't in the source it cites: «${match[1]}». Correct it or remove it.`],
  [/^Reader-visible defect: \d+ sentence\(s\) about the product state a number the confirmed business profile does not contain, e\.g\. «(.+)»\.$/,
    match => `A number about your product isn't in your business details: «${match[1]}». Correct it, or add it to your business details.`],
];

/** Words that only Pentra's checks use: a note that still contains one after mapping is shown in general terms. */
const INTERNAL = /\bscore\b|strict|minimum is|ledger|audit|evidence|excerpt|snapshot|allowlist|deterministic|\bgate\b|\bunit \d/i;

export function plainReviewNote(issue: string): string {
  for (const [pattern, plain] of PLAIN) {
    const match = pattern.exec(issue.trim());
    if (match) return typeof plain === "string" ? plain : plain(match);
  }
  const pipeline = /^Reader-visible defect: pipeline text "(.+)" must not appear in an article\.$/.exec(issue);
  if (pipeline) return `Text meant for Pentra, not readers, appears in the article ("${pipeline[1]}"). Remove it.`;
  const visible = /^Reader-visible defect: (.+)$/.exec(issue);
  if (visible && !INTERNAL.test(visible[1])) return visible[1][0].toUpperCase() + visible[1].slice(1);
  if (visible) return "A sentence a reader would see needs fixing before it publishes.";
  if (/^(?:Article contains|Every inline image|Featured image|Invalid|Inline citation|Raw HTML)/.test(issue) || INTERNAL.test(issue)) {
    return "A formatting or source detail needs fixing before it publishes. Edit the draft or ask Pentra for a new one.";
  }
  return issue;
}

/** Plain notes for a list of check results, once each, in their order. */
export function plainReviewNotes(issues: readonly string[]): string[] {
  return [...new Set(issues.map(plainReviewNote))];
}

/** True when an issue is one of the "not backed by a source" checks the sourcing line summarises. */
export const unsourcedIssue = (issue: string) => UNSOURCED.test(issue.trim());

/** The one line on what backs a draft and what isn't sourced yet. */
export function sourcingLine(sources: readonly { url: string }[], unsourced: number): string {
  const hosts = [...new Set(sources.map(source => { try { return new URL(source.url).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))];
  const backed = !sources.length ? "No outside source backs this draft yet."
    : `Backed by ${sources.length} source${sources.length === 1 ? "" : "s"} (${hosts.slice(0, 3).join(", ")}${hosts.length > 3 ? ", …" : ""}).`;
  const open = unsourced > 0 ? ` ${unsourced} statement${unsourced === 1 ? " isn't" : "s aren't"} matched to a source yet: check ${unsourced === 1 ? "it" : "them"}, or edit ${unsourced === 1 ? "it" : "them"} out, before you publish.`
    : " Some statements aren't matched to a source yet: check them, or edit them out, before you publish.";
  return backed + open;
}

export const HANDED_BACK_DRAFT = "Your draft is ready to read. Open it to see what to check before it publishes. Nothing was published.";

/** Where an owner's own draft stands, in plain words; null leaves a terminal failure to its own message (contentIssue).
 * Cowork's fresh account read "This draft didn't pass Pentra's quality review" on its first article while Pentra was
 * still revising it, and the finished draft read as a failure. A draft with text is a draft to read. */
export function ownerDraftNote(stage: string, failure: string | undefined, hasArticle: boolean): string | null {
  if (stage === "prepare" || stage === "review") return "Pentra is researching and writing this draft. It's usually ready to read within a few minutes.";
  if (stage === "review_failed") return "Pentra is revising this draft before you read it.";
  if (stage === "ready") return "Your draft is ready to read. Approve it when you're happy with it.";
  if (stage === "publish" || stage === "verify") return "Publishing your approved draft.";
  if (stage === "verified") return "Published and live on your site.";
  if (stage === "failed" && failure === "bounded_content_quality_exhausted") return hasArticle ? HANDED_BACK_DRAFT
    : "Pentra couldn't finish this draft. Nothing was published, and it doesn't count toward your monthly articles.";
  return null;
}

/** An owner's draft that has text to read: ready, or handed back with what to check. */
export const ownerDraftReadable = (stage: string, failure: string | undefined, hasArticle: boolean) =>
  hasArticle && (stage === "ready" || (stage === "failed" && failure === "bounded_content_quality_exhausted"));
