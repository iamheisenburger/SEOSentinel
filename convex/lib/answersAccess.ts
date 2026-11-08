/** Pentra Answers (Nov 2026): who gets what, and what Pentra may spend for them. Pure. */
import { hostOf } from "./answerEngine.ts";

/** Pentra's own sites run Answers by code (Arshad, Nov 8 2026), never billed. */
export const ANSWERS_OWNER_DOMAINS: readonly string[] = ["pentra.dev", "leadpilot.chat", "dawnlist.io"];
/** The Clerk feature on the single paid plan ("Pentra", $249/month or $2,490/year). */
export const ANSWERS_PLAN_FEATURE = "pentra_answers";
export const ANSWERS_PLAN = { name: "Pentra", monthlyUsd: 249, annualUsd: 2490, slug: "pentra" } as const;

export type AnswersAccess = "owner" | "paid" | "free";

export function isAnswersOwnerDomain(domain: string | undefined | null): boolean {
  const host = hostOf(domain ?? "");
  return ANSWERS_OWNER_DOMAINS.includes(host);
}
type SiteLike = { domain: string; answers?: { enabled: boolean } | null; deletionStatus?: unknown };
/** A site runs Pentra Answers when it was set up for it (every new account) or is one of Pentra's own sites. Existing
 * article customers keep their service until they choose to switch. */
export function answersEnabled(site: SiteLike | null | undefined): boolean {
  if (!site || site.deletionStatus) return false;
  return site.answers?.enabled === true || isAnswersOwnerDomain(site.domain);
}
export function answersAccess(site: SiteLike, planFeatures: readonly string[]): AnswersAccess {
  if (isAnswersOwnerDomain(site.domain)) return "owner";
  return planFeatures.includes(ANSWERS_PLAN_FEATURE) ? "paid" : "free";
}
/** What each access level includes: the free first hour is one snapshot (questions, asking, the first five drafts); the
 * plan adds publishing, re-asking and the weekly loop. */
export const answersAllows = (access: AnswersAccess) => ({
  snapshot: true,
  drafts: true,
  publish: access !== "free",
  recheck: access !== "free",
  weekly: access !== "free",
});

// ── Spend ──
/** One free snapshot per account: ~30 questions to five assistants (~$0.45) plus the questions and five drafts (~$2.5). */
export const ANSWERS_FREE_ACCOUNT_CAP_MICRO_USD = 4_000_000;
/** A paid or owner site's month: weekly runs, daily rechecks of new pages, ~30 pages written. */
export const ANSWERS_SITE_MONTHLY_CAP_MICRO_USD = 45_000_000;
/** The whole service's daily circuit breaker (env ANSWERS_FLEET_DAILY_MICRO_USD raises it as customers grow). */
export const ANSWERS_FLEET_DAILY_DEFAULT_MICRO_USD = 60_000_000;
export function answersFleetDailyCap(env: string | undefined): number {
  const n = Number(env);
  return Number.isSafeInteger(n) && n > 0 ? n : ANSWERS_FLEET_DAILY_DEFAULT_MICRO_USD;
}

/** Whether a new hold fits: free accounts within their lifetime snapshot budget, paid and owner sites within the month,
 * and everyone within the fleet's day. Settled rows count their actual cost; held rows their hold. */
export function spendFits(args: { access: AnswersAccess; holdMicroUsd: number; accountFreeSpent: number; siteMonthSpent: number;
  fleetDaySpent: number; fleetDailyCap: number }): { ok: true } | { ok: false; reason: string } {
  if (!Number.isSafeInteger(args.holdMicroUsd) || args.holdMicroUsd <= 0) return { ok: false, reason: "invalid_hold" };
  if (args.fleetDaySpent + args.holdMicroUsd > args.fleetDailyCap) return { ok: false, reason: "fleet_daily_cap" };
  if (args.access === "free") {
    return args.accountFreeSpent + args.holdMicroUsd > ANSWERS_FREE_ACCOUNT_CAP_MICRO_USD ? { ok: false, reason: "free_snapshot_budget" } : { ok: true };
  }
  return args.siteMonthSpent + args.holdMicroUsd > ANSWERS_SITE_MONTHLY_CAP_MICRO_USD ? { ok: false, reason: "site_monthly_cap" } : { ok: true };
}
export const spendCounted = (row: { state: string; reservedMicroUsd: number; actualMicroUsd?: number }) =>
  row.state === "released" ? 0 : row.state === "settled" ? Math.max(0, row.actualMicroUsd ?? 0) : row.reservedMicroUsd;

/** A competitor as the owner sees it, from a domain the profile stored ("apollo.io" -> "Apollo"). */
export function competitorFromDomain(domain: string): { name: string; domain: string } | null {
  const host = hostOf(domain);
  if (!host || !/\.[a-z]{2,}$/.test(host)) return null;
  const label = host.split(".").slice(0, -1).filter((p) => p !== "www" && p !== "app" && p !== "get" && p !== "try").pop() ?? host.split(".")[0];
  if (!label || label.length < 2) return null;
  return { name: label[0].toUpperCase() + label.slice(1), domain: host };
}
