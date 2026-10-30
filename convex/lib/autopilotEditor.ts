/**
 * Rule 2a, the Autopilot editor policy (owner decision, Oct 19 2026).
 *
 * On a site that chose Autopilot and consented to automatic publication, a
 * Pentra-written article is never cut sentence by sentence (those deletions
 * left the numbering gaps, "three X" lists with two items and stranded
 * references that went live), and the reviewers' scores are notes, never a
 * veto. What blocks is objective (readerVisibleIssues and the strict gate's
 * safety, rendering, length and evidence-for-numbers checks). Fact-check
 * findings a source or the confirmed profile can settle get one bounded
 * rewrite that corrects them; they never block on their own.
 */
import { searchAsksForProducts } from "./sourceQuality.ts";
export function autopilotPublicationConsented(site: {
  serviceMode?: string; autopilotEnabled?: boolean; approvalRequired?: boolean;
  contentSchedule?: { ownerReviewedOnly?: boolean; autopilotSelectedAt?: number; autopublishConsentAt?: number } | null;
} | null | undefined): boolean {
  return Boolean(site && site.serviceMode === "growth_first" && site.autopilotEnabled && !site.approvalRequired &&
    site.contentSchedule && !site.contentSchedule.ownerReviewedOnly && site.contentSchedule.autopilotSelectedAt &&
    site.contentSchedule.autopublishConsentAt);
}

/** Fact-check findings a preserved source or the confirmed profile can
 * settle: the sentence cites a source, states a number, names the product, or
 * quotes or cites a person (P258, Arshad's cost rule: the one check looks for
 * made-up statistics, wrong product facts and invented people or quotes).
 * A general statement without any of these is advice or opinion under rule 2a. */
export function checkableFactCheckFindings(findings: readonly string[], productName: string): string[] {
  const product = productName.trim();
  const named = product.length >= 2
    ? new RegExp(`\\b${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    : null;
  return [...new Set(findings.map((finding) => finding.trim()).filter(Boolean))].filter((finding) =>
    /\[\d+(?:\s*,\s*\d+)*\]/.test(finding) || /\d/.test(finding.replace(/https?:\/\/\S+/g, " ")) || (named?.test(finding) ?? false) ||
    /[“"][^”"]{8,}[”"]/.test(finding) || /\b(?:said|says|told|according to|wrote|writes)\b/i.test(finding));
}

/** Gate message that sends a first review with checkable findings through
 * its one bounded rewrite. Never waivable; it is only raised on a first review. */
export function autopilotEditPassIssue(count: number): string {
  return `Autopilot edit pass: ${count} fact-check finding(s) to verify against the sources and the business profile.`;
}

/** Sentences that name the company behind a cited vendor page although the
 * search does not name it (V1: another company is named only when the search
 * names it). P162, Oct 22 2026: a LeadPilot draft on lead scoring for
 * marketing teams kept one source, Salesforce's help page, and named
 * Salesforce three times, with its edition list. Sources, Related reading
 * and link targets are not prose. At most six sentences. */
export function unsearchedCompanyMentions(markdown: string, companies: readonly (string | null)[],
  context: { search: string; title?: string; business: readonly string[] }): Array<{ company: string; sentence: string }> {
  // P231: a search for a kind of product asks for the products by name (the business's competitors stay banned).
  if (searchAsksForProducts(context.search)) return [];
  const words = new Set(`${context.search} ${context.title ?? ""}`.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const own = new Set(context.business.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean));
  const named = [...new Set(companies.filter((company): company is string => Boolean(company)))]
    .filter((company) => !words.has(company) && !own.has(company));
  if (named.length === 0) return [];
  const prose = markdown.split(/^#{2,3}\s+(?:Sources|References|Related reading)\s*$/im)[0]
    .replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ");
  const mentions: Array<{ company: string; sentence: string }> = [];
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
    const company = named.find((name) => new RegExp(`\\b${name}\\b`, "i").test(sentence));
    if (company && sentence.trim()) mentions.push({ company, sentence: sentence.trim() });
  }
  return mentions.slice(0, 6);
}

/** Gate message that sends a first review naming such companies through the
 * one bounded rewrite. Never waivable; only raised on a first review. */
export function autopilotCompanyNameIssue(count: number): string {
  return `Autopilot edit pass: ${count} sentence(s) name a company the search does not name.`;
}

/** The rewrite instruction for one such sentence. */
export function autopilotCompanyNameNote(company: string, sentence: string): string {
  const name = company.replace(/^./, (c) => c.toUpperCase());
  return `Rewrite without naming ${name}, which the search does not name: «${sentence.replace(/[«»]/g, "")}». ` +
    "Keep the fact and its citation, leave the company and its plans, editions and prices out, and keep the paragraph complete.";
}

/** The rewrite instruction for one checkable finding. */
export function autopilotVerificationNote(sentence: string): string {
  return `Verify against the preserved sources and the business profile: «${sentence.replace(/[«»]/g, "")}». ` +
    "If a source or the profile contradicts it, correct it to match. If it states a specific number or fact nothing supports, " +
    "rewrite it without that specific. Otherwise keep it as it is. Keep the paragraph, list or step it belongs to complete.";
}
