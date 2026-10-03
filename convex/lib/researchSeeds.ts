/** Seeds for Autopilot keyword research. Pure and tenant-generic: every seed
 * is one of the site's own keywords, a search it already appears for, or a
 * phrase from its confirmed profile. */

export const normalizeResearchKeyword = (keyword: string) => keyword.trim().toLowerCase().replace(/\s+/g, " ");

/** Words a search phrase does not start or end with. Profile sentences split
 * into clauses leave such edges ("to engage visitors 24", "lost leads visitors
 * who don t"); they are fragments, not searches. */
const SEED_EDGE_WORDS = new Set([
  "a", "an", "the", "to", "of", "for", "with", "and", "or", "in", "on", "at", "by", "from", "about", "into", "than",
  "that", "this", "these", "those", "who", "which", "whose", "your", "our", "their", "its", "is", "are", "be", "can",
  "will", "don", "doesn", "isn", "aren", "won", "didn", "outside", "without", "while", "when", "where", "so",
]);

/** A profile phrase that reads like something people type into a search box:
 * two to five words, no dangling edge word, no bare number ("24", "7") and no
 * contraction stub ("don t"). */
export function searchLikePhrase(phrase: string, maxWords = 5) {
  const words = normalizeResearchKeyword(phrase).split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= maxWords && phrase.length <= 60 &&
    !SEED_EDGE_WORDS.has(words[0]) && !SEED_EDGE_WORDS.has(words[words.length - 1]) &&
    words.every(word => !/^\d+$/.test(word) && (word.length > 1 || word === "a"));
}

/** A real search (a keyword with measured demand, or a Search Console query):
 * kept as typed, only bounded in length. */
export function searchSeedLength(keyword: string) {
  const words = normalizeResearchKeyword(keyword).split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 6 && keyword.length <= 80;
}

/**
 * The seeds for one research run, best first:
 * 1. searches people demonstrably make: this site's keywords with measured
 *    search demand and the Search Console searches it is shown for;
 * 2. the owner's own product phrases;
 * 3. phrases from the profile text, only to fill what 1 and 2 leave open
 *    (a new site has no search data yet).
 * Every run starts further along each list, so the same seeds (which return
 * the same keywords) are not asked twice in a row, and the list of real
 * searches grows as the site publishes.
 */
export function researchSeedsForRound(input: { demand: string[]; owner: string[]; profile: string[]; round: number }, size = 15) {
  const unique = (list: string[]) => [...new Set(list.map(normalizeResearchKeyword).filter(Boolean))];
  const demand = unique(input.demand);
  const owner = unique(input.owner).filter(k => !demand.includes(k));
  const profile = unique(input.profile).filter(k => !demand.includes(k) && !owner.includes(k));
  const turn = Math.max(0, Math.floor(input.round) - 1);
  const windowOf = (list: string[], take: number) => {
    const n = Math.min(Math.max(0, take), list.length);
    if (n === 0) return [];
    const start = (turn * n) % list.length;
    return Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);
  };
  const fromDemand = windowOf(demand, 10);
  const fromOwner = windowOf(owner, Math.max(5, size - fromDemand.length));
  const fromProfile = windowOf(profile, size - fromDemand.length - fromOwner.length);
  // Two real searches, then one owner phrase: the first sources discovery asks
  // (a handful of seeds each) get both kinds.
  const seeds: string[] = [];
  for (let d = 0, o = 0; d < fromDemand.length || o < fromOwner.length;) {
    for (let k = 0; k < 2 && d < fromDemand.length; k++) seeds.push(fromDemand[d++]);
    if (o < fromOwner.length) seeds.push(fromOwner[o++]);
  }
  return [...new Set([...seeds, ...fromProfile])].slice(0, size);
}
