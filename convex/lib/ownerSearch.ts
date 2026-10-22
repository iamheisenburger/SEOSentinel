/** C4 (P158, Oct 22 2026): searches an owner adds to their content plan from
 * the dashboard. Autopilot writes them next; Pentra measures each one's demand,
 * difficulty and buyer fit, and those are notes for the owner, never reasons
 * to skip it. Only a listed competitor or a search one of the site's pages
 * already answers is refused. */

/** Above every researched topic (research priorities stop at 90). */
export const OWNER_SEARCH_PRIORITY = 100;
/** Searches waiting at once; Autopilot writes them before anything else. */
export const OWNER_SEARCH_MAX_WAITING = 10;
/** One exact demand request and one difficulty request (DataForSEO) plus one
 * buyer-fit call, reserved before they run and settled at their real cost. */
export const OWNER_SEARCH_MEASURE_MICRO_USD = 150_000;
export const OWNER_SEARCH_NOTES = "Chosen by the owner, so it is written next. Its measured demand, difficulty and buyer-fit verdict are notes, not reasons to skip it. Use only supported business facts.";

/** The search as people type it: lower case, single spaces, two to eight
 * words of letters, digits and ordinary punctuation; never a URL. Null when
 * the text is not a search. */
export function ownerSearchKeyword(search: string): string | null {
  const keyword = search.normalize("NFKC").toLowerCase().replace(/[“”"«»]/g, " ").replace(/\s+/g, " ").trim().replace(/[?!.,;:]+$/, "");
  if (keyword.length < 3 || keyword.length > 80 || /https?:|www\.|\//.test(keyword)) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &+'’.-]*$/u.test(keyword)) return null;
  const words = keyword.split(" ").length;
  return words >= 2 && words <= 8 ? keyword : null;
}

/** The article the search asks for: "x vs y", "x alternatives" and "compare x"
 * are comparisons, "best x" and "top x" lists, "how to x" a how-to. Anything
 * else keeps the default, which the search results may still refine. */
export function ownerSearchArticleType(keyword: string): { articleType?: "comparison" | "listicle" | "how-to" | "checklist"; intent: "commercial" | "informational" } {
  if (/\b(vs|versus|alternatives?|compare|compared|comparison)\b/.test(keyword)) return { articleType: "comparison", intent: "commercial" };
  if (/^(\d+ )?(best|top)\b(?! (practices?|of)\b)/.test(keyword)) return { articleType: "listicle", intent: "commercial" };
  if (/^how (to|do|can|should)\b/.test(keyword)) return { articleType: "how-to", intent: "informational" };
  if (/\bchecklist\b/.test(keyword)) return { articleType: "checklist", intent: "informational" };
  return { intent: "informational" };
}
