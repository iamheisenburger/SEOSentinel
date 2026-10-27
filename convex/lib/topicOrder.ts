/**
 * P212 (Oct 26 2026): the order Autopilot writes planned topics in, shared by
 * the topic chooser (contentWork.ts eligiblePlannedTopics) and the dashboard's
 * "Coming up next". The card sorted by stored priority while Autopilot wrote
 * searched, winnable keywords first, so it named topics that would not be
 * written next. Pure.
 */
import { preSerpWinnability } from "./winnableDiscovery.ts";
import { clickPotential } from "./clickPotential.ts";

export type OrderedTopic = { ownerChosenAt?: number; searchVolume?: number; keywordDifficulty?: number;
  keywordDifficultyMeasured?: boolean; priority?: number; primaryKeyword?: string };
/** The site's reach (keyword difficulty ceiling) and measured authority, when fresh. */
export type TopicOrderSite = { difficultyCeiling: number; authority: number | null };

/** A search people measurably make that the site can reach. */
export const searchedWithin = (t: OrderedTopic, difficultyCeiling: number) =>
  (t.searchVolume ?? 0) > 0 && (t.keywordDifficulty ?? 0) <= difficultyCeiling;

/** A search past the site's reach is never written: the winnability model scores it zero, so its page cannot rank
 * (P113). Search Console searches carry no difficulty: the site is already shown for them. An owner's own search is
 * written whatever Pentra's checks say (C4, P158). */
export const withinReach = (t: OrderedTopic, difficultyCeiling: number) =>
  t.ownerChosenAt !== undefined || !((t.searchVolume ?? 0) > 0 && (t.keywordDifficulty ?? 0) > difficultyCeiling);

export function compareTopics(site: TopicOrderSite) {
  const searched = (t: OrderedTopic) => searchedWithin(t, site.difficultyCeiling);
  // Among searched keywords, a young site wins easy ones first: difficulty
  // weighs more than raw volume (e.g. 100 searches at difficulty 10 beats
  // 1,000 searches at difficulty 40).
  // P228: a definition Google answers on its results page (convex/lib/clickPotential.ts) waits behind searches people
  // open a page for: it counts at 0.4 of its chance of winning, and 15 points less without measured authority.
  const clicks = (t: OrderedTopic) => clickPotential(t.primaryKeyword);
  const opportunity = (t: OrderedTopic) => Math.log10(1 + (t.searchVolume ?? 0)) * 12 - (t.keywordDifficulty ?? 0) * 0.8 -
    (clicks(t) < 1 ? 15 : 0);
  // With measured authority, searched keywords are ordered by the chance this
  // site can actually win them (Pentra's winnability model): a young domain
  // writes the easy searches first instead of ones only an incumbent ranks
  // for. The ordering drops nothing; only the reach ceiling does.
  const winnability = (t: OrderedTopic) => site.authority === null ? 0 : preSerpWinnability({ tenantAuthority: site.authority,
    keywordDifficulty: t.keywordDifficulty, keywordDifficultyMeasured: t.keywordDifficultyMeasured, monthlySearches: t.searchVolume }) * clicks(t);
  const owner = (t: OrderedTopic) => t.ownerChosenAt !== undefined;
  // The owner's searches come first, oldest first; then keywords people measurably search for; within each group the
  // stored priority orders the work.
  return (a: OrderedTopic, b: OrderedTopic) => Number(owner(b)) - Number(owner(a)) || (a.ownerChosenAt ?? 0) - (b.ownerChosenAt ?? 0) ||
    Number(searched(b)) - Number(searched(a)) ||
    (searched(a) && searched(b) ? winnability(b) - winnability(a) || opportunity(b) - opportunity(a) : 0) || (b.priority ?? 0) - (a.priority ?? 0);
}
