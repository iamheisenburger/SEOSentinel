/**
 * P228 (Oct 27 2026): which searches people click through on. In the 28 days to Oct 24 LeadPilot ranked in Google's
 * top 20 for 28 searches (772 impressions) and got 1 click. Its titles and descriptions matched the searches; most were
 * definitions Google now answers on the results page itself ("what is a lead sales associate", 89 impressions at
 * position 5.9; "associate lead meaning", 31 at 6.7). A definition or job-description search is worth less than one
 * people must open a page for: Autopilot writes those later and refreshes pages for them last. Nothing is dropped.
 * English wording; a search in another language counts in full. Pure.
 */
const DEFINITION = /^(?:what\s+(?:is|are|does|do)\b|what'?s\b|who\s+(?:is|are)\b|define\b|definition\s+of\b|meaning\s+of\b)|\b(?:meaning|definition|defined|stands?\s+for|job\s+description|salary|salaries|duties|responsibilities|career\s+path)\b/i;
/** Wording that sends people to a page even when the question opens with "what is". */
const NEEDS_A_PAGE = /\b(?:best|top|how\s+to|ways?\s+to|tools?|software|apps?|templates?|examples?|checklists?|vs|versus|alternatives?|pricing|cost|calculator|generator)\b/i;

/** What a click-through on this search is worth, relative to one people open a page for. */
export const ANSWERED_ON_GOOGLE_WEIGHT = 0.4;

export function clickPotential(search: string | undefined): number {
  const text = (search ?? "").trim();
  return text && DEFINITION.test(text) && !NEEDS_A_PAGE.test(text) ? ANSWERED_ON_GOOGLE_WEIGHT : 1;
}
