/**
 * Exact backlink receipt verification.
 *
 * A textual `href=` match is not a backlink. It can occur in a comment,
 * script, `data-href` attribute, or unrelated element. These helpers inspect
 * actual anchor start tags, resolve relative URLs against the fetched page,
 * and only accept an exact canonical target. Links explicitly marked
 * nofollow, sponsored, or ugc do not count as acquired authority.
 */

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function canonicalLinkUrl(value: string, base?: string): string | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return null;
  }
}

export type AnchorReceipt = {
  href: string;
  rel: string[];
  text: string;
};

function normalizeAnchorText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeVisibleText(value: string): string {
  return normalizeAnchorText(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " "),
  );
}

function sameOrganisationHost(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/^www\./, "");
  const b = right.toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function extractAnchorReceipts(
  html: string,
  sourceUrl: string,
): AnchorReceipt[] {
  const withoutExecutableOrCommentedMarkup = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const receipts: AnchorReceipt[] = [];
  for (const match of withoutExecutableOrCommentedMarkup.matchAll(
    /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi,
  )) {
    const tag = `<a${match[1]}>`;
    // Quoted hrefs only. Malformed/unquoted markup is deliberately not strong
    // enough evidence for an acquired-link receipt.
    const hrefMatch = tag.match(/(?:^|\s)href\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const href = canonicalLinkUrl(decodeHtml(hrefMatch[2]), sourceUrl);
    if (!href) continue;
    const relMatch = tag.match(/(?:^|\s)rel\s*=\s*(["'])(.*?)\1/i);
    const rel = relMatch
      ? decodeHtml(relMatch[2]).toLowerCase().split(/\s+/).filter(Boolean)
      : [];
    receipts.push({ href, rel, text: normalizeAnchorText(match[2]) });
  }
  return receipts;
}

/**
 * Prove that the fetched page contains a real anchor whose canonical href is
 * exactly the candidate URL. Optional provider anchor text is corroborating
 * evidence; a visible-text match without the href can never pass.
 */
export function hasExactAnchorHref(args: {
  html: string;
  sourceUrl: string;
  targetUrl: string;
  expectedAnchorText?: string;
}): boolean {
  const target = canonicalLinkUrl(args.targetUrl);
  if (!target) return false;
  const expected = normalizeAnchorText(args.expectedAnchorText ?? "");
  return extractAnchorReceipts(args.html, args.sourceUrl).some((anchor) => {
    if (anchor.href !== target) return false;
    if (!expected) return true;
    if (!anchor.text) return false;
    return (
      anchor.text === expected ||
      anchor.text.includes(expected) ||
      expected.includes(anchor.text)
    );
  });
}

/**
 * Revalidate an unlinked mention without hashing unrelated page chrome. The
 * exact quoted context must still exist and no real anchor may point at the
 * tenant's site.
 */
export function hasExactUnlinkedMention(args: {
  html: string;
  sourceUrl: string;
  targetUrl: string;
  context: string;
}): boolean {
  const context = normalizeVisibleText(args.context);
  const pageText = normalizeVisibleText(args.html);
  if (!context || !pageText.includes(context)) return false;
  const target = canonicalLinkUrl(args.targetUrl);
  if (!target) return false;
  const targetHost = new URL(target).hostname;
  return !extractAnchorReceipts(args.html, args.sourceUrl).some((anchor) =>
    sameOrganisationHost(new URL(anchor.href).hostname, targetHost),
  );
}

/** Stable, evidence-specific receipt input. Unrelated page changes do not alter it. */
export function authorityEvidenceReceipt(args: {
  type: string;
  sourceUrl: string;
  targetUrl: string;
  context: string;
  anchorText?: string;
}): string {
  const sourceUrl = canonicalLinkUrl(args.sourceUrl);
  const targetUrl = canonicalLinkUrl(args.targetUrl);
  if (!sourceUrl || !targetUrl) {
    throw new Error("Authority evidence URLs must be canonical HTTP(S) URLs");
  }
  return JSON.stringify({
    version: 1,
    type: args.type,
    sourceUrl,
    targetUrl,
    context: normalizeVisibleText(args.context),
    anchorText: normalizeVisibleText(args.anchorText ?? ""),
  });
}

export function hasExactAuthorityLink(args: {
  html: string;
  sourceUrl: string;
  targetUrl: string;
}): boolean {
  if (!hasExactAnchorHref(args)) return false;
  const target = canonicalLinkUrl(args.targetUrl);
  return extractAnchorReceipts(args.html, args.sourceUrl).some(
    (anchor) =>
      anchor.href === target &&
      !anchor.rel.some((value) =>
        ["nofollow", "sponsored", "ugc"].includes(value),
      ),
  );
}
