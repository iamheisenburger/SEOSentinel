/** Phase 2 (Nov 2026): whether Autopilot may write a topic, from what its checks stored (convex/lib/pageOne.ts runs the
 * checks). Kept apart from pageOne.ts so the dashboard reads the same rule without the domain parser. Pure. */

/** Pentra's rule for every new engine (Arshad, Nov 5 2026): built for any site, run only on pentra.dev and LeadPilot until
 * it gets results there, then on every customer. Other sites keep today's topic choice. */
export const TOPIC_CHOICE_ROLLOUT_DOMAINS: readonly string[] = ["pentra.dev", "leadpilot.chat"];
/** P372 (Nov 6 2026, Arshad): every site added from NEW_SYSTEM_START on runs the whole new system too (sites.ts marks it
 * `newSystemAt` when it is created). Sites added before keep what they signed up for until their owner is asked. */
export const NEW_SYSTEM_START = Date.UTC(2026, 10, 6, 3);
export function topicChoiceRollout(domain: string | undefined, newSystemAt?: number | null): boolean {
  if (typeof newSystemAt === "number") return true;
  const bare = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:].*$/, "");
  return TOPIC_CHOICE_ROLLOUT_DOMAINS.includes(bare);
}

export const PAGE_ONE_CHECK_VERSION = 1;
/** A verdict stands this long; then the search is checked again (page one and the site's authority both move). */
export const PAGE_ONE_FRESH_MS = 45 * 86_400_000;
/** A search the site already appears for at this average position or better: Google already ranks it near page one. */
export const PROVEN_POSITION = 20;

/** What a topic keeps of its page-one check. */
export type PageOneVerdict = { version: number; checkedAt: number; rankable: boolean; reason: string; siteAuthority: number | null;
  reachable: number; measured: number; results: number; medianAuthority: number | null };


export type PageOneTopic = { pageOne?: PageOneVerdict; searchConsolePosition?: number; notes?: string; ownerChosenAt?: number };

/** The average position Search Console reported when the topic came from it (stored since Phase 2; older topics carry it
 * in their note: "... at average position 16.3, with no article of its own"). */
export function searchConsolePosition(t: PageOneTopic): number | null {
  if (typeof t.searchConsolePosition === "number" && Number.isFinite(t.searchConsolePosition)) return t.searchConsolePosition;
  const match = /^Search Console: .*? at average position (\d+(?:\.\d+)?)/.exec(t.notes ?? "");
  return match ? Number(match[1]) : null;
}

export type PageOneStatus = "proven" | "winnable" | "unwinnable" | "unchecked";
/** Whether the site can win this search: proven by Search Console, winnable or not on a fresh page-one check, or unchecked
 * (never checked, checked under older rules, or stale). */
export function pageOneStatus(t: PageOneTopic, now: number): PageOneStatus {
  const position = searchConsolePosition(t);
  if (position !== null && position <= PROVEN_POSITION) return "proven";
  const v = t.pageOne;
  if (!v || v.version !== PAGE_ONE_CHECK_VERSION || now - v.checkedAt > PAGE_ONE_FRESH_MS) return "unchecked";
  return v.rankable ? "winnable" : "unwinnable";
}

export const winnableStatus = (status: PageOneStatus) => status === "proven" || status === "winnable";

/** A brake is read for two days: the daily sweep sets or clears it again each day. */
export const GROUP_BRAKE_FRESH_MS = 2 * 86_400_000;
export type WritableTopic = PageOneTopic & { buyerFit?: { eligible: boolean }; groupBrake?: { braked: boolean; checkedAt: number } };
/** A topic Autopilot may write on a rollout site: kept by the buyer-fit model (word matching alone no longer admits one),
 * winnable (proven by Search Console or on a fresh page-one check), and not held by the brake. The dashboard's "Coming up
 * next" reads the same rule. */
export function topicWritable(t: WritableTopic, now: number): boolean {
  return t.buyerFit?.eligible === true && winnableStatus(pageOneStatus(t, now)) && !(t.groupBrake?.braked === true && now - t.groupBrake.checkedAt <= GROUP_BRAKE_FRESH_MS);
}

