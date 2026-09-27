import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { contentIssue } from "./lib/contentCustomer";

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
  readyForNextSlots: number;
  strandedReady: number;
  destinationVerified: boolean;
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
  if (!input.destinationVerified) problems.push("publishing connection needs re-verification");
  for (const failure of input.unresolvedFailures.slice(0, 2)) problems.push(`unresolved: ${failure}`);
  return { status: problems.length ? "attention" : "ok", problems, nudge };
}

export const healthPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { cursor, now }) => {
    const page = await ctx.db.query("sites").paginate({ cursor, numItems: 25 });
    const sites: SiteHealth[] = [];
    for (const site of page.page) {
      if (site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" || !site.contentSchedule) continue;
      const schedule = site.contentSchedule;
      if (!site.autopilotEnabled && !schedule.active) continue;
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
      const verdict = describeSiteHealth({
        now, schedule, autopilotEnabled: Boolean(site.autopilotEnabled), approvalRequired: Boolean(site.approvalRequired),
        lastPublishedAt, readyForNextSlots, strandedReady,
        failedAtSlot: failedAtSlot && !covered ? contentIssue(failedAtSlot.contentWork!.failure) ?? failedAtSlot.contentWork!.failure ?? "failed" : null,
        unresolvedFailures: [...new Set(unresolved)], destinationVerified,
      });
      sites.push({ siteId: site._id, domain: site.canonicalDomain ?? site.domain, ...verdict, lastPublishedAt, nextDeadlineAt,
        readyForNextSlots, strandedReady, destinationVerified });
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, sites };
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

export function formatHealthReport(sites: SiteHealth[], now: number) {
  const attention = sites.filter(s => s.status === "attention");
  const lines = [`Pentra Autopilot health, ${utc(now)}`,
    `${sites.length} Autopilot site(s): ${sites.length - attention.length} OK, ${attention.length} need attention.`];
  for (const s of [...attention, ...sites.filter(x => x.status === "ok")].slice(0, 20)) {
    lines.push("");
    lines.push(`${s.status === "ok" ? "OK" : "ATTENTION"} ${s.domain}`);
    lines.push(`last published ${utc(s.lastPublishedAt)}; next due ${utc(s.nextDeadlineAt)}; ${s.readyForNextSlots} ready`);
    for (const p of s.problems) lines.push(`- ${p}`);
  }
  if (sites.length > 20) lines.push("", `(${sites.length - 20} more not shown)`);
  return lines.join("\n").slice(0, 3900);
}

type HealthRunResult = { checked: number; attention: number; nudged: number; notified: boolean };

export const runContentHealth = internalAction({
  args: { notify: v.optional(v.union(v.literal("always"), v.literal("problems"), v.literal("never"))) },
  handler: async (ctx, { notify }): Promise<HealthRunResult> => {
    const now = Date.now();
    const all: SiteHealth[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 40; pages++) {
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
          body: JSON.stringify({ chat_id: chatId, text: formatHealthReport(all, now), disable_web_page_preview: true }),
        });
        notified = response.ok;
      } catch { notified = false; }
    }
    return { checked: all.length, attention, nudged, notified };
  },
});
