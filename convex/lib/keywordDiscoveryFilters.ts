import { keywordDifficultyCeiling } from "./autopilotBuffer.ts";

export type KeywordDiscoveryFilter =
  | [string, ">=" | "<=", number]
  | [KeywordDiscoveryFilter, "and" | "or", KeywordDiscoveryFilter];

/** Apply the planner's existing ceiling before the provider limits a sorted
 * Labs response. Filtering only after receipt cannot recover low-volume rows
 * hidden behind hundreds of high-difficulty head terms. Google Ads remains a
 * separate, unmeasured discovery source and still requires exact KD enrichment.
 * This is query selection, not a substitute for the final evidence gates. */
export function keywordDiscoveryLabsFilters(
  maximumDifficulty?: number,
  prefix: "" | "keyword_data." = "",
): KeywordDiscoveryFilter {
  const volume = `${prefix}keyword_info.search_volume`;
  const difficulty = `${prefix}keyword_properties.keyword_difficulty`;
  const demand: KeywordDiscoveryFilter = [volume, ">=", 10];
  if (maximumDifficulty === undefined) return demand;
  if (!Number.isFinite(maximumDifficulty) || maximumDifficulty < 0 || maximumDifficulty > 100) {
    throw new Error("Keyword discovery difficulty ceiling must be between 0 and 100");
  }
  return [demand, "and", [
    [difficulty, "<=", maximumDifficulty],
    "or",
    [
      [volume, ">=", 1_000],
      "and",
      [difficulty, "<=", Math.min(100, keywordDifficultyCeiling(maximumDifficulty, 1_000))],
    ],
  ]];
}
