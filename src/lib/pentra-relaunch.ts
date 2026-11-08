/** Pentra Answers launched on Nov 8 2026 (P384, 09:58 UTC). pentra.dev's earlier guides were written for the article
 * service: they stay published (published articles are preserved) and carry a note that their product details no longer
 * apply, so no visitor reads an old plan or price as today's offer. */
export const PENTRA_ANSWERS_LAUNCH_AT = Date.UTC(2026, 10, 8, 9, 58);

export function isLegacyPentraGuide(domain: string, createdAt: number): boolean {
  return domain.replace(/^www\./, "").toLowerCase() === "pentra.dev" && createdAt < PENTRA_ANSWERS_LAUNCH_AT;
}

export const LEGACY_GUIDE_NOTICE =
  "Pentra has changed. Since November 8, 2026 it shows a business what ChatGPT, Perplexity, Gemini and Google's AI say about it, " +
  "and writes the pages that get it recommended. This guide was written for Pentra's earlier article service, so what it says " +
  "about Pentra's plans, prices and features no longer applies.";
