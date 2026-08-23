/**
 * Outreach message drafting.
 *
 * Deliberately deterministic rather than model-generated. Every sentence a
 * draft can contain is grounded in an already-verified fact about the
 * recipient's own page: the URL, the dead link, the anchor text, the exact
 * mention. A model asked to "personalise" this reliably invents a compliment,
 * a statistic, or a relationship that does not exist, and one invented claim
 * in a cold email is enough to burn a domain's sending reputation.
 *
 * Pure: takes verified evidence in, returns subject and body out.
 */

import { normalizeDomain } from "./outreachPacing.ts";

/** Bump when the message shapes change so sent copy stays auditable. */
export const OUTREACH_DRAFT_VERSION = 1;

export type OutreachDraft = {
  subject: string;
  body: string;
  version: number;
};

export type OutreachEvidence = {
  type: string; // unlinked_mention | broken_link
  sourceUrl: string;
  sourceDomain: string;
  /** Our page being offered as the link target. */
  targetUrl: string;
  /** For broken_link: the dead URL on their page. */
  brokenUrl?: string;
  /** For broken_link: the anchor text of the dead link. */
  anchorText?: string;
  /** For unlinked_mention: the sentence containing the brand mention. */
  context?: string;
  brandName: string;
  senderName: string;
  physicalMailingAddress?: string;
};

const OPT_OUT_LINE =
  "If you would rather not hear from me again, just reply with STOP and I will not contact you.";

/**
 * A signature reading "LeadPilot, LeadPilot" is an obvious template artefact.
 * When no human sender name is configured the brand signs alone.
 */
function signature(senderName: string, brandName: string): string {
  return senderName.toLowerCase() === brandName.toLowerCase()
    ? brandName
    : `${senderName}, ${brandName}`;
}

function senderFooter(evidence: OutreachEvidence): string[] {
  const address = String(evidence.physicalMailingAddress || "").trim();
  return [
    signature(evidence.senderName, evidence.brandName),
    ...(address ? [address] : []),
  ];
}

/**
 * Navigation, cookie banners and menu chrome scraped from a page are not a
 * mention of anything. Quoting them back at a stranger is the single fastest
 * way to look automated, so a mention without real prose is not sendable.
 */
export function isUsableMentionContext(value: string | undefined): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 60) return false;
  const chrome =
    /(skip to (main )?content|cookie|accept all|sign in|log ?in|menu|subscribe to our|all rights reserved|privacy policy)/i;
  if (chrome.test(text)) return false;
  // Nav strips are runs of short capitalised labels rather than sentences.
  const hasSentence = /[a-z]{3,}[^.!?]{20,}[.!?]/.test(text);
  return hasSentence;
}

/**
 * True when the recipient domain is the tenant's own name on a different TLD —
 * a namesake company rather than a site that mentioned us.
 */
export function sharesBrandName(sourceDomain: string, brandName: string): boolean {
  const label = normalizeDomain(sourceDomain).split(".")[0];
  const brand = String(brandName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!label || brand.length < 4) return false;
  return label.replace(/[^a-z0-9]/g, "") === brand;
}

function trimContext(value: string | undefined, max = 180): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function pagePath(url: string): string {
  const withoutScheme = String(url || "").replace(/^https?:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  const path = slash < 0 ? "" : withoutScheme.slice(slash);
  return path && path !== "/" ? path : normalizeDomain(url);
}

/**
 * Stable per site + recipient domain so a second opportunity on the same
 * domain joins the existing thread instead of starting a parallel one.
 */
export function outreachThreadKey(siteId: string, sourceDomain: string): string {
  return `${siteId}:${normalizeDomain(sourceDomain)}`;
}

/**
 * Draft the initial contact for one verified opportunity, or null when the
 * evidence is not specific enough to write a truthful email.
 */
export function draftOutreachMessage(evidence: OutreachEvidence): OutreachDraft | null {
  const senderName = String(evidence.senderName || "").trim();
  const brandName = String(evidence.brandName || "").trim();
  const sourceUrl = String(evidence.sourceUrl || "").trim();
  const targetUrl = String(evidence.targetUrl || "").trim();
  if (!senderName || !brandName || !sourceUrl || !targetUrl) return null;

  if (evidence.type === "broken_link") {
    const brokenUrl = String(evidence.brokenUrl || "").trim();
    if (!brokenUrl) return null;
    const anchor = trimContext(evidence.anchorText, 80);
    const anchorClause = anchor ? ` (the "${anchor}" link)` : "";
    return {
      subject: `Dead link on ${pagePath(sourceUrl)}`,
      version: OUTREACH_DRAFT_VERSION,
      body: [
        `Hi,`,
        ``,
        `I was reading ${sourceUrl} and one of the outbound links${anchorClause} points to ${brokenUrl}, which no longer resolves.`,
        ``,
        `A current page you can assess as a replacement is ${targetUrl}. If it fits what you intended to reference you are welcome to use it, and if not it is still worth removing the dead link.`,
        ``,
        `Thanks,`,
        ...senderFooter(evidence),
        ``,
        OPT_OUT_LINE,
      ].join("\n"),
    };
  }

  if (evidence.type === "unlinked_mention") {
    if (!isUsableMentionContext(evidence.context)) return null;
    // A namesake company is not a prospect: asking a business with our own
    // name to link to us is the clearest possible sign of an unattended bot.
    if (sharesBrandName(evidence.sourceDomain, brandName)) return null;
    const context = trimContext(evidence.context);
    if (!context) return null;
    return {
      subject: `Your ${brandName} mention on ${pagePath(sourceUrl)}`,
      version: OUTREACH_DRAFT_VERSION,
      body: [
        `Hi,`,
        ``,
        `Thanks for mentioning ${brandName} on ${sourceUrl}:`,
        ``,
        `"${context}"`,
        ``,
        `If it is useful for your readers, the page it refers to is ${targetUrl}. Entirely up to you either way, and no follow-up needed if you would rather leave it as is.`,
        ``,
        `Thanks,`,
        ...senderFooter(evidence),
        ``,
        OPT_OUT_LINE,
      ].join("\n"),
    };
  }

  return null;
}

/**
 * Follow-up copy. Short by design: a follow-up that repeats the full pitch
 * reads as a sequence, which is exactly what gets marked as spam.
 */
export function draftFollowUp(args: {
  evidence: OutreachEvidence;
  sequenceStep: number;
}): OutreachDraft | null {
  const initial = draftOutreachMessage(args.evidence);
  if (!initial) return null;
  if (args.sequenceStep !== 1 && args.sequenceStep !== 2) return null;

  const opener =
    args.sequenceStep === 1
      ? `Following up on the note below about ${pagePath(args.evidence.sourceUrl)} in case it got buried.`
      : `Last note from me on this. I will assume it is not a fit and will not follow up again.`;

  return {
    subject: `Re: ${initial.subject}`,
    version: OUTREACH_DRAFT_VERSION,
    body: [
      `Hi,`,
      ``,
      opener,
      ``,
      `Thanks,`,
      ...senderFooter(args.evidence),
      ``,
      OPT_OUT_LINE,
    ].join("\n"),
  };
}
