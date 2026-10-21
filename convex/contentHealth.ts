import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { contentIssue } from "./lib/contentCustomer";
import { eligiblePlannedTopics, fallbackTopicProposals, topicResearchDueAt } from "./contentWork";
import { healthFingerprint, opsEmailConfigured, sendOpsEmail } from "./lib/opsEmail";
import { missedSlotCause } from "./lib/customerNotices";
import { slotOutcomes } from "./lib/slotOutcomes";

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
/** P126: an Autopilot article this late gets its owner an email saying why. */
export const CUSTOMER_LATE_EMAIL_MS = 6 * 3_600_000;
/** A topic runway shorter than this is flagged when research will not refill it. */
export const TOPIC_RUNWAY_ALERT_MS = 3 * 86_400_000;

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
  /** What the last keyword research saw (seeds, found, why candidates were skipped). */
  lastResearch?: NonNullable<Doc<"sites">["contentSchedule"]>["topicsResearchReceipt"] | null;
  researchDueAt: number | null;
  nudge: boolean;
  /** For the owner's late-article email (P126): the due slot's failure code, and whether the owner paused or reviews first. */
  failure?: string | null;
  paused?: boolean;
  reviewFirst?: boolean;
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
  // Its runway is the articles already ready plus the topics left (one per
  // slot). It needs attention only when research will not refill it in time:
  // the next research comes after the runway ends, research is a slot and more
  // overdue with under 3 days left, or no research is scheduled with under 3
  // days left (Oct 20 2026: "1 topic left" read as an emergency while two ready
  // articles and research due the next day covered every slot).
  if (!s.paused && typeof input.plannedTopics === "number") {
    const due = input.researchDueAt ?? null;
    const research = due === null ? "" : due <= input.now ? "; keyword research is due now" : `; keyword research next runs ${utc(due)}`;
    const slots = input.readyForNextSlots + input.plannedTopics;
    const runwayEnd = s.nextDeadlineAt + Math.max(0, slots - 1) * s.intervalMs;
    const short = runwayEnd - input.now < TOPIC_RUNWAY_ALERT_MS;
    if (input.plannedTopics === 0 && due !== null && due <= input.now) nudge = true;
    if (slots === 0) problems.push(`no topics left to write${research}`);
    else if (due === null ? short : due > runwayEnd || (short && input.now - due > s.intervalMs + 6 * 3_600_000)) {
      problems.push(`topics run out after ${utc(runwayEnd)}${due === null ? " and no keyword research is scheduled"
        : due > runwayEnd ? ", before the next keyword research" : ""}${research}`);
    }
  }
  if (!input.destinationVerified) problems.push("publishing connection needs re-verification");
  for (const failure of input.unresolvedFailures.slice(0, 2)) problems.push(`unresolved: ${failure}`);
  return { status: problems.length ? "attention" : "ok", problems, nudge };
}

/** `topics: false` skips the topic inventory (each site's whole topic, page and
 * article list, about 4 MB for an owner site): the six-hourly watch only needs
 * delivery state; the daily check and an operator's single-site check count topics. */
async function siteHealthFor(ctx: QueryCtx, site: Doc<"sites">, now: number, topics = true): Promise<SiteHealth | null> {
  if (site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" || !site.contentSchedule) return null;
  const schedule = site.contentSchedule;
  if (!site.autopilotEnabled && !schedule.active) return null;
  const nextDeadlineAt = schedule.nextDeadlineAt;
  const upcoming = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", site._id)
    .gte("contentWork.deadlineAt", nextDeadlineAt)).take(50);
  // Past work matters only when it is ready (stranded) or a recent failure, so
  // each is read through its stage index instead of the 50 latest past jobs with
  // their provider checkpoints (K2, Oct 19 2026: ~5 MB per site per health run).
  const behind = [
    ...(await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", site._id).eq("contentWork.stage", "ready")).take(50)),
    ...(await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", site._id).eq("contentWork.stage", "failed")).order("desc").take(20)),
  ].filter(j => j.contentWork!.deadlineAt < nextDeadlineAt);
  const automatic = (j: Doc<"jobs">) => Boolean(j.contentWork && !j.contentWork.ownerRequest && j.contentWork.retiredAt === undefined && !j.contentWork.operation);
  const readyForNextSlots = upcoming.filter(j => automatic(j) && j.status === "done" && j.contentWork!.stage === "ready").length;
  const strandedReady = behind.filter(j => automatic(j) && j.status === "done" && j.contentWork!.stage === "ready").length;
  const failedAtSlot = upcoming.find(j => automatic(j) && j.contentWork!.stage === "failed" && j.contentWork!.deadlineAt === nextDeadlineAt);
  const covered = upcoming.some(j => automatic(j) && !["failed", "verified"].includes(j.contentWork!.stage) && j.contentWork!.deadlineAt === nextDeadlineAt);
  // Failures within the last two days that still hold money or need an operator.
  const unresolved = [...upcoming, ...behind].filter(j => automatic(j) && j.status === "failed" && j.contentWork!.stage === "failed" &&
    j.updatedAt > now - 2 * 86_400_000 && ["content_provider_credit_unavailable", "content_provider_request_rejected"].includes(j.contentWork!.failure ?? ""))
    .map(j => contentIssue(j.contentWork!.failure) ?? j.contentWork!.failure ?? "failed");
  // Summaries carry publishedAt at a few KB each, not the full articles.
  const published = await ctx.db.query("article_summaries").withIndex("by_site_status_created", q => q.eq("siteId", site._id).eq("status", "published"))
    .order("desc").take(5);
  const lastPublishedAt = published.reduce<number | null>((max, a) => typeof a.publishedAt === "number" && (max === null || a.publishedAt > max) ? a.publishedAt : max, null);
  const destinationVerified = publisherDestinationReceiptVerified({ site, timestamp: now });
  let topicsLeft: number | null = null, plannedTopics: number | null = null;
  if (topics) try {
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
    failure: failedAtSlot && !covered ? failedAtSlot.contentWork!.failure ?? "failed" : null, paused: Boolean(schedule.paused),
    reviewFirst: Boolean(site.approvalRequired || schedule.ownerReviewedOnly),
    readyForNextSlots, strandedReady, destinationVerified, topicsLeft, plannedTopics,
    lastResearchAt: schedule.topicsReplenishedAt ?? null, lastResearchAdded: schedule.topicsReplenishAdded ?? null,
    lastResearch: schedule.topicsResearchReceipt ?? null, researchDueAt };
}

export const healthPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), now: v.number(), topics: v.optional(v.boolean()) },
  handler: async (ctx, { cursor, now, topics }) => {
    // Few sites per page: each one reads its topic, page and article inventory.
    const page = await ctx.db.query("sites").paginate({ cursor, numItems: 5 });
    const sites: SiteHealth[] = [];
    for (const site of page.page) {
      const health = await siteHealthFor(ctx, site, now, topics ?? true);
      if (health) sites.push(health);
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, sites };
  },
});

/** Fleet-wide slot keeping over the last seven days (V4: "every slot on time,
 * for every customer"), a page of sites at a time. Counts only: no site, domain
 * or article leaves this query. Owner-requested and retired work are not slots. */
export const fleetSlotCounts = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { cursor, now }) => {
    const page = await ctx.db.query("sites").paginate({ cursor, numItems: 10 });
    const totals = { autopilotSites: 0, due: 0, onTime: 0, late: 0, missed: 0 };
    for (const site of page.page) {
      if (site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" || !site.autopilotEnabled ||
        !site.contentSchedule?.autopilotSelectedAt) continue;
      totals.autopilotSites += 1;
      const jobs = (await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", site._id)
        .gte("contentWork.deadlineAt", now - 7 * 86_400_000).lte("contentWork.deadlineAt", now)).take(200))
        .filter(job => job.contentWork && !job.contentWork.ownerRequest && !job.contentWork.operation &&
          (job.contentWork.retiredAt === undefined || job.contentWork.failure === "duplicate_intent" || job.contentWork.failure === "reader_visible_defect"))
        .map(job => ({ deadlineAt: job.contentWork!.deadlineAt, publishedAt: job.contentWork!.publishedAt }));
      const counts = slotOutcomes(jobs, now, HEALTH_OVERDUE_GRACE_MS);
      totals.due += counts.due; totals.onTime += counts.onTime; totals.late += counts.late; totals.missed += counts.missed;
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, totals };
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
/** Slots covered: articles already ready plus topics left, one per slot. */
function runwayDays(s: SiteHealth) {
  const slots = s.readyForNextSlots + (s.plannedTopics ?? 0);
  if (!slots || s.nextDeadlineAt === null) return "0 days";
  const interval = s.intervalMs ?? 86_400_000;
  const days = slots * interval / 86_400_000;
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
    if (s.plannedTopics !== null) lines.push(`topics left ${s.plannedTopics} (${s.topicsLeft ?? 0} with search demand); with ${s.readyForNextSlots} ready, about ${
      runwayDays(s)} of slots covered; last keyword research ${utc(s.lastResearchAt)}${s.lastResearchAdded !== null ? ` (+${s.lastResearchAdded})` : ""}; next ${utc(s.researchDueAt)}`);
    for (const p of s.problems) lines.push(`- ${p}`);
  }
  if (detailed.length > 20) lines.push("", `(${detailed.length - 20} more not shown)`);
  return lines.join("\n").slice(0, 3900);
}

type HealthRunResult = { checked: number; attention: number; nudged: number; notified: boolean; emailed?: boolean };

export const alertState = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => await ctx.db.query("ops_alert_state").withIndex("by_key", q => q.eq("key", key)).first(),
});
export const recordAlertSent = internalMutation({
  args: { key: v.string(), fingerprint: v.string(), sentAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("ops_alert_state").withIndex("by_key", q => q.eq("key", args.key)).first();
    if (row) await ctx.db.patch(row._id, { fingerprint: args.fingerprint, sentAt: args.sentAt });
    else await ctx.db.insert("ops_alert_state", args);
  },
});
/** A5: the operator's email (Telegram belongs to the X reply system). The
 * daily run always reports; the six-hourly watch emails a problem when it is
 * new or changed, and again only after a day. */
const HEALTH_EMAIL_REPEAT_MS = 86_400_000;

export const runContentHealth = internalAction({
  args: { notify: v.optional(v.union(v.literal("always"), v.literal("problems"), v.literal("never"))) },
  handler: async (ctx, { notify }): Promise<HealthRunResult> => {
    const now = Date.now();
    const all: SiteHealth[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 200; pages++) {
      const page: { isDone: boolean; continueCursor: string; sites: SiteHealth[] } =
        await ctx.runQuery(internal.contentHealth.healthPage, { cursor, now, topics: (notify ?? "problems") === "always" });
      all.push(...page.sites);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    let nudged = 0;
    for (const site of all) if (site.nudge) { await ctx.runMutation(internal.contentHealth.nudgeSite, { siteId: site.siteId }); nudged++; }
    // P126: the owner of an Autopilot site whose article is 6h+ late hears why
    // (once per slot, at most once a day per site; never when they paused it or
    // review every article first).
    if ((notify ?? "problems") !== "never") for (const site of all) {
      if (site.paused || site.reviewFirst || site.nextDeadlineAt === null || now - site.nextDeadlineAt < CUSTOMER_LATE_EMAIL_MS) continue;
      try {
        await ctx.runMutation(internal.customerEmails.noteMissedSlot, { siteId: site.siteId, deadlineAt: site.nextDeadlineAt,
          cause: missedSlotCause({ destinationVerified: site.destinationVerified, plannedTopics: site.plannedTopics, failure: site.failure ?? null }) });
      } catch (error) { console.warn(`Late-article email not decided for ${site.siteId}: ${error instanceof Error ? error.message : "unknown"}`); }
    }
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
    let emailed = false;
    if (opsEmailConfigured() && mode !== "never") {
      const fingerprint = healthFingerprint(all);
      const last = await ctx.runQuery(internal.contentHealth.alertState, { key: "content_health" });
      const due = mode === "always" || (attention > 0 &&
        (!last || last.fingerprint !== fingerprint || now - last.sentAt >= HEALTH_EMAIL_REPEAT_MS));
      if (due) {
        const result = await sendOpsEmail(attention > 0 ? `Pentra: ${attention} Autopilot site(s) need attention` : "Pentra: every Autopilot site OK",
          formatHealthReport(all, now, (process.env.PENTRA_OPS_REPORT_DOMAINS ?? "").split(",")));
        emailed = result.sent;
        if (result.sent) await ctx.runMutation(internal.contentHealth.recordAlertSent, { key: "content_health", fingerprint, sentAt: now });
        else console.warn(`Pentra health email not sent: ${result.error}`);
      }
    }
    return { checked: all.length, attention, nudged, notified, emailed };
  },
});
