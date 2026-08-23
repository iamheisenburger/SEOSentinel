"use node";

import { safeFetchPublicText } from "./safeOutbound.ts";
import { verifyLivePublicationPage } from "./publicationLive.ts";

/**
 * Fetch and prove the exact tenant article that an authority email proposes as
 * a replacement. The pinned transport rejects non-HTTPS/private destinations,
 * non-2xx responses and cross-host redirects. The publication verifier then
 * rejects a catch-all/soft-404 page that does not contain the article title.
 */
export async function fetchLiveAuthorityTarget(input: {
  targetUrl: string;
  title: string;
  timeoutMs?: number;
}): Promise<{ receiptUrl: string }> {
  const expected = new URL(input.targetUrl);
  const fetched = await safeFetchPublicText(expected.href, {
    expectedHost: expected.hostname,
    sameHostRedirects: true,
    maxRedirects: 3,
    maxBytes: 1_000_000,
    timeoutMs: input.timeoutMs ?? 12_000,
    allowedContentTypes: [
      /^text\/html(?:;|$)/i,
      /^application\/xhtml\+xml(?:;|$)/i,
    ],
    headers: {
      "User-Agent": "Pentra/1.0 (authority target verifier)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Encoding": "identity",
    },
  });
  verifyLivePublicationPage({
    expectedUrl: expected.href,
    fetchedUrl: fetched.url,
    html: fetched.text,
    title: input.title,
  });
  return { receiptUrl: fetched.url };
}
