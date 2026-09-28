import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { contentIssue } from "./lib/contentCustomer";
import { eligiblePlannedTopics, fallbackTopicProposals, topicResearchDueAt } from "./contentWork";

/**
 * Daily Autopilot health check.
 *
 * Autopilot is fail-closed: when something does not match it stops instead of
 * guessing. That keeps bad articles off a customer's site, but a stop nobody
 * sees is an outage. This check looks at every Autopilot site the same way an
 * operator would, nudges the scheduler for anything it can repair on its own
 * (a stranded reviewed article, an overdue slot), and reports the rest to the
 * operator's Telegram chat the same day. It never publishes, spends, retries a
 * provider call or changes a schedule itself.
 */

export const HEALTH_OVERDUE_GRACE_MS = 60 * 60_000;

export type SiteHealth = {
  siteId: Id<"sites">;
  domain: string;
  status: "ok" | "attention";
  problems: string[];
  lastPublishedAt: number | null;
  nextDeadlineAt: number | null;
  intervalMs: number | null;
  readyForNextSlots: number;
  strandedReady: number;
  destinationVerified: boolean;
  /** Searched keywords Autopilot can still write (null when unknown). */
  topicsLeft: number | null;
  /** Every planned topic it can still write, searched or not. */
  plannedTopics: number | null;
  lastResearchAt: number | null;
  lastResearchAdded: number | null;
  researchDueAt: number | null;
  nudge: boolean;
};

export function describeSiteHealth(input: {
  now: number;
  schedule: { nextDeadlineAt: number; intervalMs: number; paused?: boolean; active?: boolean; ownerReviewedOnly?: boolean } | null;
  autopilotEnabled: boolean;
  approvalRequired: boolean;
  lastPublishedAt: number | null;
  readyForNextSlots: number;
  strandedReady: number;
  failedAtSlot: string | null;
  unresolvedFailures: string[];
  destinationVerified: boolean;
  topicsLeft?: number | null;
  plannedTopics?: number | null;
  researchDueAt?: number | null;
}): { status: "ok" | "attention"; problems: string[]; nudge: boolean } {
  const problems: string[] = [];
  let nudge = false;
  const s = input.schedule;
  if (!s || !input.autopilotEnabled) return { status: "ok", problems: ["Autopilot is off"], nudge: false };
  if (s.paused) problems.push("Autopilot is paused");
  if (input.approvalRequired || s.ownerReviewedOnly) problems.push("waiting for owner approval");
  const overdue = input.now - s.nextDeadlineAt;
  if (overdue > HEALTH_OVERDUE_GRACE_MS) {
    problems.push(`next article is ${Math.round(overdue / 3_600_000)}h overdue`);
    nudge = true;
  }
  if (input.lastPublishedAt !== null && input.now - input.lastPublishedAt > s.intervalMs + 6 * 3_600_000 && !s.paused) {
    problems.push(`nothing published for ${Math.round((input.now - input.lastPublishedAt) / 3_600_000)}h`);
  }
  if (input.strandedReady > 0) {
    problems.push(`${input.strandedReady} reviewed article(s) behind the schedule (moved to the next slot automatically)`);
    nudge = true;
  }
  const untilNext = s.nextDeadlineAt - input.now;
  if (!s.paused && input.readyForNextSlots === 0 && untilNext < 3 * 3_600_000) {
    problems.push("no reviewed article ready for the next slot");
    nudge = true;
  }
  if (input.failedAtSlot) problems.push(`the due slot failed: ${input.failedAtSlot}`);
  // Topic supply: a site that runs out of keywords silently misses slots.
  if (!s.paused && typeof input.plannedTopics === "number") {
    const due = input.researchDueAt ?? null;
    const research = due === null ? "" : due <= input.now ? "; keyword research is due now" : `; keyword research next runs ${utc(due)}`;
    const dayOfSlots = Math.max(1, Math.round(86_400_000 / s.intervalMs));
    if (input.plannedTopics === 0) {
      problems.push(`no topics left to write${research}`);
      if (due !== null && due <= input.now) nudge = true;
    } else if (input.plannedTopics < dayOfSlots && (due === null || due > input.now + 12 * 3_600_000)) {
      problems.push(`only ${input.plannedTopics} topic(s) left, less than a day of slots${research}`);
    }
  }
  if (!input.destinationVerified) problems.push("publishing connection needs re-verification");
  for (const failure of input.unresolvedFailures.slice(0, 2)) problems.push(`unresolved: ${failure}`);
  return { status: problems.length ? "attention" : "ok", problems, nudge };
}

async function siteHealthFor(ctx: QueryCtx, site: Doc<"sites">, now: number): Promise<SiteHealth | null> {
  if (site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" || !site.contentSchedule) return null;
  const schedule = site.contentSchedule;
  if (!site.autopilotEnabled && !schedule.active) return null;
  const nextDeadlineAt = schedule.nextDeadlineAt;
  const upcoming = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", site._id)
    .gte("contentWork.deadlineAt", nextDeadlineAt)).take(50);
  const behind = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", site._id)
    .lt("contentWork.deadlineAt", nextDeadlineAt)).order("desc").take(50);
  const automatic = (j: Doc<"jobs">) => Boolean(j.contentWork && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined && !j.contentWork.operation);
  const readyForNextSlots = upcoming.filter(j => automatic(j) && j.status === "done" && j.contentWork!.stage === "ready").length;
  const strandedReady = behind.filter(j => automatic(j) && j.status === "done" && j.contentWork!.stage === "ready").length;
  const failedAtSlot = upcoming.find(j => automatic(j) && j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === nextDeadlineAt);
  const covered = upcoming.some(j => automatic(j) && !["failed", "verified"].includes(j.contentWork!.stage) && j.contentWork!.deadlineAt === nextDeadlineAt);
  // Failures within the last two days that still hold money or need an operator.
  const unresolved = [...upcoming, ...behind].filter(j => automatic(j) && j.status === "failed" && j.contentWork!.stage === "failed" &&
    j.updatedAt > now - 2 * 86_400_000 && (j.contentWork!.failure ?? "") === "content_provider_credit_unavailable")
    .map(j => contentIssue(j.contentWork!.failure) ?? j.contentWork!.failure ?? "failed");
  const published = await ctx.db.query("articles").withIndex("by_site_status_created", q => q.eq("siteId", site._id).eq("status", "published"))
    .order("desc").take(5);
  const lastPublishedAt = published.reduce<number | null>((max, a) => typeof a.publishedAt === "number" && (max === null || a.publishedAt > max) ? a.publishedAt : max, null);
  const destinationVerified = publisherDestinationReceiptVerified({ site, timestamp: now });
  let topicsLeft: number | null = null, plannedTopics: number | null = null;
  try {
    const inventory = await eligiblePlannedTopics(ctx, site);
    // The owner's confirmed questions and features are written when no keyword is left.
    plannedTopics = inventory.planned.length + fallbackTopicProposals(site, inventory).length;
    topicsLeft = inventory.planned.filter(inventory.searched).length;
  } catch { /* an incomplete inventory is reported as unknown */ }
  const researchDueAt = schedule.autopilotSelectedAt ? topicResearchDueAt(schedule) : null;
  const verdict = describeSiteHealth({
    now, schedule, autopilotEnabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
    lastPublishedAt, readyForNextSlots, strandedReady,
    failedAtSlot: failedAtSlot && !covered ? contentIssue(failedAtSlot.contentWork!.failure) ?? failedAtSlot.contentWork!.failure ?? "failed" : null,
    unresolvedFailures: [...new Set(unresolved)], destinationVerified, topicsLeft, plannedTopics, researchDueAt,
  });
  return { siteId: site._id, domain: site.canonicalDomain ?? site.domain, ...verdict, lastPublishedAt, nextDeadlineAt, intervalMs: schedule.intervalMs,
    readyForNextSlots, strandedReady, destinationVerified, topicsLeft, plannedTopics,
    lastResearchAt: schedule.topicsReplenishedAt ?? null, lastResearchAdded: schedule.topicsReplenishAdded ?? null, researchDueAt };
}

export const healthPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { cursor, now }) => {
    // Few sites per page: each one reads its topic, page and article inventory.
    const page = await ctx.db.query("sites").paginate({ cursor, numItems: 5 });
    const sites: SiteHealth[] = [];
    for (const site of page.page) {
      const health = await siteHealthFor(ctx, site, now);
      if (health) sites.push(health);
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, sites };
  },
});

/** One named site, for an operator checking their own site. */
export const siteHealth = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    return site ? await siteHealthFor(ctx, site, Date.now()) : null;
  },
});

export const nudgeSite = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await ctx.scheduler.runAfter(0, internal.autopilot.dispatchSiteFollowup, {
      siteId, trigger: "content_work", reason: "content_health_check",
    });
  },
});

function utc(ms: number | null) {
  if (ms === null) return "never";
  return new Date(ms).toISOString().slice(5, 16).replace("T", " ") + " UTC";
}
function runwayDays(s: SiteHealth) {
  if (!s.plannedTopics || s.nextDeadlineAt === null) return "0 days";
  const interval = s.intervalMs ?? 86_400_000;
  const days = s.plannedTopics * interval / 86_400_000;
  return days < 1 ? `${Math.round(days * 24)}h` : `${Math.round(days * 10) / 10} days`;
}

/** Detailed lines only for the operator's listed domains
 * (PENTRA_OPS_REPORT_DOMAINS, comma separated); every other tenant appears
 * only in the counts, so a report never lists customers' sites. */
export function formatHealthReport(sites: SiteHealth[], now: number, detailDomains: string[] = []) {
  const attention = sites.filter(s => s.status === "attention");
  const listed = new Set(detailDomains.map(d => d.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean));
  const detailed = sites.filter(s => listed.has(s.domain.toLowerCase().replace(/^www\./, "")));
  const others = sites.filter(s => !detailed.includes(s));
  const lines = [`Pentra Autopilot health, ${utc(now)}`,
    `${sites.length} Autopilot site(s): ${sites.length - attention.length} OK, ${attention.length} need attention.`];
  if (others.length) lines.push(`Customer sites: ${others.length - others.filter(s => s.status === "attention").length} OK, ${others.filter(s => s.status === "attention").length} need attention.`);
  for (const s of [...detailed.filter(x => x.status === "attention"), ...detailed.filter(x => x.status === "ok")].slice(0, 20)) {
    lines.push("");
    lines.push(`${s.status === "ok" ? "OK" : "ATTENTION"} ${s.domain}`);
    lines.push(`last published ${utc(s.lastPublishedAt)}; next due ${utc(s.nextDeadlineAt)}; ${s.readyForNextSlots} ready`);
    if (s.plannedTopics !== null) lines.push(`topics left ${s.plannedTopics} (${s.topicsLeft ?? 0} with search demand; about ${
      runwayDays(s)} of slots); last keyword research ${utc(s.lastResearchAt)}${s.lastResearchAdded !== null ? ` (+${s.lastResearchAdded})` : ""}`);
    for (const p of s.problems) lines.push(`- ${p}`);
  }
  if (detailed.length > 20) lines.push("", `(${detailed.length - 20} more not shown)`);
  return lines.join("\n").slice(0, 3900);
}

type HealthRunResult = { checked: number; attention: number; nudged: number; notified: boolean };

export const runContentHealth = internalAction({
  args: { notify: v.optional(v.union(v.literal("always"), v.literal("problems"), v.literal("never"))) },
  handler: async (ctx, { notify }): Promise<HealthRunResult> => {
    const now = Date.now();
    const all: SiteHealth[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 200; pages++) {
      const page: { isDone: boolean; continueCursor: string; sites: SiteHealth[] } =
        await ctx.runQuery(internal.contentHealth.healthPage, { cursor, now });
      all.push(...page.sites);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    let nudged = 0;
    for (const site of all) if (site.nudge) { await ctx.runMutation(internal.contentHealth.nudgeSite, { siteId: site.siteId }); nudged++; }
    const attention = all.filter(s => s.status === "attention").length;
    const mode = notify ?? "problems";
    let notified = false;
    const token = process.env.PENTRA_OPS_TELEGRAM_BOT_TOKEN, chatId = process.env.PENTRA_OPS_TELEGRAM_CHAT_ID;
    if (token && chatId && (mode === "always" || (mode === "problems" && attention > 0))) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, disable_web_page_preview: true,
            text: formatHealthReport(all, now, (process.env.PENTRA_OPS_REPORT_DOMAINS ?? "").split(",")) }),
        });
        notified = response.ok;
      } catch { notified = false; }
    }
    return { checked: all.length, attention, nudged, notified };
  },
});
