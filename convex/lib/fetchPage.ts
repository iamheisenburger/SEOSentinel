"use node";

import { safeFetchPublicText } from "./safeOutbound";

/** Bounded public-page fetch for site health checks and onboarding prefill.
 * Uses the DNS-pinned public-only fetcher (no private or reserved addresses,
 * every redirect re-validated). Never throws: status 0 means unreachable. */
const PAGE_TYPES = [/^text\/(?:html|plain|xml)(?:;|$)/i, /^application\/(?:xhtml\+xml|xml|rss\+xml)(?:;|$)/i];

export async function fetchPage(url: string): Promise<{ status: number; finalUrl: string; html: string; robots: string | null }> {
  try {
    const page = await safeFetchPublicText(url, { maxRedirects: 3, maxBytes: 1_500_000, timeoutMs: 10_000,
      allowedContentTypes: PAGE_TYPES, headers: { "User-Agent": "PentraSiteHealth/1.0 (+https://pentra.dev)", Accept: "text/html,application/xhtml+xml,application/xml" } });
    return { status: 200, finalUrl: page.url, html: page.text, robots: null };
  } catch (error) {
    const status = Number(/HTTP (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1] ?? 0);
    return { status, finalUrl: url, html: "", robots: null };
  }
}
