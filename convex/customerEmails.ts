import { internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { plausibleEmail, sendCustomerEmail } from "./lib/customerEmail";
import { addWebsiteEmail, draftReadyEmail, firstArticleEmail, missedSlotEmail, monthlyReportEmail, monthWindow, reportMonth, setupReminderEmail, type MissedSlotCause,
  type MonthlyImprovement, type MonthlySearch, type SetupStep } from "./lib/customerNotices";
import { contentConnectionComplete, pasteDestination } from "./lib/contentSelection";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { publicationDestinationBlockers } from "./lib/autopilotReadiness";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { midContentSetup } from "./lib/contentSetupPath";
import { collectCurrentDomainPublishedSummariesSince, gscConnectionMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { publishedArticlePageUrl } from "./lib/searchPerformance";
import { isCompleteGscDateRange } from "./lib/gscSearchAnalytics";
import { takeCurrentGscPageRows } from "./lib/currentGscRows";
import { accountDeletionKey } from "./lib/accountDeletion";

/** D4 (P125, Oct 20 2026): service emails to a site's owner about their own
 * site, from hello@pentra.dev. The address is Clerk's verified primary email,
 * recorded when the owner opens the dashboard (pentra.dev's plan sync), and
 * every email can be turned off in Settings. Each kind is decided once per
 * key and logged, so a retry or a second verification never sends twice. */

const RETRY_MS = 15 * 60_000, MAX_ATTEMPTS = 2;
/** At most one late-article email a site a day, however many slots slip. */
const MISSED_SLOT_EMAIL_SPACING_MS = 24 * 3_600_000;
/** Monthly reports: sites per page, and the gap between sends (Resend allows a few a second). */
const REPORT_PAGE = 20, REPORT_SPACING_MS = 1_500, REPORT_GSC_ROW_LIMIT = 12_000;
const missedSlotCauses = v.union(v.literal("connection"), v.literal("plan"), v.literal("writing_service"), v.literal("internal"),
  v.literal("checks"), v.literal("no_topics"), v.literal("preparing"));

/** The owner's verified address, from pentra.dev's plan sync. No write when unchanged. */
export const recordContact = internalMutation({ args: { userId: v.string(), email: v.string() }, handler: async (ctx, args) => {
  const email = plausibleEmail(args.email);
  if (!email) return { recorded: false };
  // A deleted (or deleting) account is never given an address again.
  if (await ctx.db.query("account_deletion_receipts").withIndex("by_account_key", q => q.eq("accountKey", accountDeletionKey(args.userId))).first()) {
    return { recorded: false };
  }
  const existing = await ctx.db.query("account_contacts").withIndex("by_user", q => q.eq("userId", args.userId)).first();
  if (existing?.email === email) return { recorded: false };
  if (existing) await ctx.db.patch(existing._id, { email, updatedAt: Date.now() });
  else await ctx.db.insert("account_contacts", { userId: args.userId, email, emailUpdates: true, updatedAt: Date.now() });
  return { recorded: true };
} });

/** Settings: where Pentra's emails go, and whether they're on. */
export const mine = query({ args: {}, handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const contact = await ctx.db.query("account_contacts").withIndex("by_user", q => q.eq("userId", identity.subject)).first();
  return contact ? { email: contact.email, emailUpdates: contact.emailUpdates } : null;
} });

export const setEmailUpdates = mutation({ args: { enabled: v.boolean() }, handler: async (ctx, { enabled }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in first");
  const contact = await ctx.db.query("account_contacts").withIndex("by_user", q => q.eq("userId", identity.subject)).first();
  if (!contact) return { saved: false };
  await ctx.db.patch(contact._id, { emailUpdates: enabled, updatedAt: Date.now() });
  return { saved: true };
} });

/** Called when one of Pentra's new articles is verified live: the site's
 * first published article gets the owner an email, once. A site that already
 * had published articles (every site before D4) is recorded as skipped. */
export async function noteFirstArticleLive(ctx: MutationCtx, site: Doc<"sites">, article: Doc<"articles">, now: number) {
  const logged = await ctx.db.query("customer_emails")
    .withIndex("by_site_kind_key", q => q.eq("siteId", site._id).eq("kind", "first_article").eq("key", "first")).first();
  if (logged) return;
  const earlier = await ctx.db.query("articles").withIndex("by_site", q => q.eq("siteId", site._id))
    .filter(q => q.and(q.eq(q.field("status"), "published"), q.neq(q.field("_id"), article._id))).first();
  const logId = await ctx.db.insert("customer_emails", { siteId: site._id, kind: "first_article", key: "first",
    status: earlier ? "skipped" : "pending", ...(earlier ? { reason: "not_first_article" } : {}), articleId: article._id,
    attempts: 0, createdAt: now, updatedAt: now });
  if (!earlier) await ctx.scheduler.runAfter(0, internal.customerEmails.send, { logId });
}

/** P210 (Oct 26 2026): an article the owner asked for is done (ready to publish, or handed back with the checks' notes).
 * The owner gets one email half an hour later if it is still waiting for them (re-decided at send time). A draft the
 * owner edited and resubmitted sends nothing more: they are already working on it. */
const DRAFT_READY_DELAY_MS = 30 * 60_000;
export async function noteDraftReady(ctx: MutationCtx, job: Doc<"jobs">, now: number) {
  const request = job.contentWork?.ownerRequest;
  if (!request || request.sourceArticleId || !job.siteId || !job.articleId) return;
  const key = String(job._id);
  if (await ctx.db.query("customer_emails").withIndex("by_site_kind_key", q => q.eq("siteId", job.siteId!).eq("kind", "draft_ready").eq("key", key)).first()) return;
  const logId = await ctx.db.insert("customer_emails", { siteId: job.siteId, kind: "draft_ready", key, status: "pending", articleId: job.articleId,
    attempts: 0, createdAt: now, updatedAt: now });
  await ctx.scheduler.runAfter(DRAFT_READY_DELAY_MS, internal.customerEmails.send, { logId });
}

/** P126: content health found an Autopilot slot 6h+ late. The owner hears why,
 * once per slot and at most once a day per site. */
export const noteMissedSlot = internalMutation({ args: { siteId: v.id("sites"), deadlineAt: v.number(), cause: missedSlotCauses },
  handler: async (ctx, { siteId, deadlineAt, cause }) => {
    const key = String(deadlineAt), now = Date.now();
    const sameSlot = await ctx.db.query("customer_emails")
      .withIndex("by_site_kind_key", q => q.eq("siteId", siteId).eq("kind", "missed_slot").eq("key", key)).first();
    if (sameSlot) return { noted: false };
    const latest = await ctx.db.query("customer_emails")
      .withIndex("by_site_kind_key", q => q.eq("siteId", siteId).eq("kind", "missed_slot")).order("desc").first();
    if (latest && now - latest.createdAt < MISSED_SLOT_EMAIL_SPACING_MS) return { noted: false };
    const logId = await ctx.db.insert("customer_emails", { siteId, kind: "missed_slot", key, status: "pending", cause, attempts: 0,
      createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.customerEmails.send, { logId });
    return { noted: true };
  } });

/** P127: on the 3rd of each month (Google's data for the month is complete by
 * then) every content-service site's owner gets last month's report, once.
 * Paged over sites; the sends are spaced out. */
export const monthlyReports = internalMutation({ args: { cursor: v.optional(v.union(v.string(), v.null())), month: v.optional(v.string()),
  offset: v.optional(v.number()) }, handler: async (ctx, args) => {
  const now = Date.now(), month = args.month ?? reportMonth(now).key;
  const page = await ctx.db.query("sites").paginate({ cursor: args.cursor ?? null, numItems: REPORT_PAGE });
  let offset = args.offset ?? 0, noted = 0;
  for (const site of page.page) {
    if (site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" || !site.contentSchedule) continue;
    const logged = await ctx.db.query("customer_emails")
      .withIndex("by_site_kind_key", q => q.eq("siteId", site._id).eq("kind", "monthly_report").eq("key", month)).first();
    if (logged) continue;
    const logId = await ctx.db.insert("customer_emails", { siteId: site._id, kind: "monthly_report", key: month, status: "pending", attempts: 0,
      createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(offset * REPORT_SPACING_MS, internal.customerEmails.send, { logId });
    offset++; noted++;
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.customerEmails.monthlyReports, { cursor: page.continueCursor, month, offset });
  return { noted };
} });

/** P196 (Oct 25 2026): a site added 20 to 72 hours ago that Pentra hasn't
 * started for gets one email naming what's left (decided again at send time).
 * The first two real signups never started, and nothing told them why. */
const SETUP_REMINDER_AFTER_MS = 20 * 3_600_000, SETUP_REMINDER_UNTIL_MS = 72 * 3_600_000, SETUP_REMINDER_SPACING_MS = 1_500;
export const noteSetupReminders = internalMutation({ args: {}, handler: async (ctx) => {
  const now = Date.now();
  const sites = await ctx.db.query("sites").withIndex("by_creation_time", q => q.gte("_creationTime", now - SETUP_REMINDER_UNTIL_MS)
    .lte("_creationTime", now - SETUP_REMINDER_AFTER_MS)).take(200);
  let noted = 0;
  for (const site of sites) {
    if (!site.userId || site.deletionStatus || site.accountDeletionRequestedAt || site.planParkedAt) continue;
    if (await setupStarted(ctx, site)) continue;
    const logged = await ctx.db.query("customer_emails")
      .withIndex("by_site_kind_key", q => q.eq("siteId", site._id).eq("kind", "setup_reminder").eq("key", "first")).first();
    if (logged) continue;
    const logId = await ctx.db.insert("customer_emails", { siteId: site._id, kind: "setup_reminder", key: "first", status: "pending",
      attempts: 0, createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(noted * SETUP_REMINDER_SPACING_MS, internal.customerEmails.send, { logId });
    noted++;
  }
  return { noted };
} });

/** Pentra has started for a site once its owner pressed Start (either way of
 * publishing) or asked for a draft. A site set up through the content service
 * starts only that way: an article from the older queue (one real signup made
 * one without pressing Start) doesn't count (P197). A site on the older flow
 * has started once it has any article. */
async function setupStarted(ctx: QueryCtx | MutationCtx, site: Doc<"sites">) {
  if ((site.serviceMode === "growth_first" && site.contentSchedule) || site.contentSchedule?.autopilotSelectedAt) return true;
  const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", site._id)).take(20);
  if (jobs.some(job => job.contentWork !== undefined)) return true;
  if (midContentSetup(site)) return false;
  if ((await ctx.db.query("articles").withIndex("by_site", q => q.eq("siteId", site._id)).take(1)).length > 0) return true;
  return jobs.some(job => job.type === "article");
}

/** The first thing a site still needs, in the order the setup panel asks for it. */
async function setupStep(ctx: QueryCtx, site: Doc<"sites">): Promise<SetupStep> {
  let website = false;
  try {
    website = pasteDestination(site) ||
      (contentConnectionComplete(site) && publisherDestinationReceiptVerified({ site }) && publicationDestinationBlockers(site).length === 0);
  } catch { /* an incomplete destination is the website step */ }
  // P200: GitHub connected with no repository chosen is its own step.
  if (!website) return (site.publishMethod ?? "github") === "github" && site.githubToken && !(site.repoOwner && site.repoName) ? "repository" : "website";
  const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
  if (entitlement?.status !== "completed" || !(await siteExecutionAuthorized(ctx, site))) return "plan";
  return "start";
}

/** P202 (Oct 26 2026): an account that signed up 20 to 72 hours ago (its
 * contact was recorded when it first opened the dashboard) and has no site gets
 * one email asking it to add its website, decided again at send time. */
export const noteAddWebsiteReminders = internalMutation({ args: {}, handler: async (ctx) => {
  const now = Date.now();
  const contacts = await ctx.db.query("account_contacts").withIndex("by_creation_time", q => q.gte("_creationTime", now - SETUP_REMINDER_UNTIL_MS)
    .lte("_creationTime", now - SETUP_REMINDER_AFTER_MS)).take(200);
  let noted = 0;
  for (const contact of contacts) {
    if (contact.addWebsiteReminder || !contact.emailUpdates) continue;
    // Any site, even one being deleted: the account has been through setup.
    if (await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", contact.userId)).first()) continue;
    if (await ctx.db.query("account_deletion_receipts").withIndex("by_account_key", q => q.eq("accountKey", accountDeletionKey(contact.userId))).first()) continue;
    await ctx.db.patch(contact._id, { addWebsiteReminder: { notedAt: now, status: "pending", attempts: 0 } });
    await ctx.scheduler.runAfter(noted * SETUP_REMINDER_SPACING_MS, internal.customerEmails.sendAddWebsite, { contactId: contact._id });
    noted++;
  }
  return { noted };
} });

/** The pending "add your website" email for one account, decided again now. */
export const addWebsiteContext = internalQuery({ args: { contactId: v.id("account_contacts") }, handler: async (ctx, { contactId }) => {
  const contact = await ctx.db.get(contactId);
  if (!contact?.addWebsiteReminder || contact.addWebsiteReminder.status !== "pending") return null;
  const hasSite = Boolean(await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", contact.userId)).first());
  return { attempts: contact.addWebsiteReminder.attempts, email: contact.email, emailUpdates: contact.emailUpdates,
    message: hasSite ? null : addWebsiteEmail() };
} });

export const markAddWebsite = internalMutation({ args: { contactId: v.id("account_contacts"), status: v.union(v.literal("pending"), v.literal("sent"),
  v.literal("skipped"), v.literal("failed")), reason: v.optional(v.string()), attempts: v.number() },
  handler: async (ctx, { contactId, status, reason, attempts }) => {
    const contact = await ctx.db.get(contactId);
    if (!contact?.addWebsiteReminder) return;
    await ctx.db.patch(contactId, { addWebsiteReminder: { notedAt: contact.addWebsiteReminder.notedAt, status, attempts, ...(reason ? { reason } : {}) } });
  } });

/** Send one decided "add your website" email (one retry 15 minutes later if Resend refuses it). */
export const sendAddWebsite = internalAction({ args: { contactId: v.id("account_contacts") }, handler: async (ctx, { contactId }): Promise<{ status: string }> => {
  const context = await ctx.runQuery(internal.customerEmails.addWebsiteContext, { contactId });
  if (!context) return { status: "not_pending" };
  if (!context.message || !context.emailUpdates) {
    await ctx.runMutation(internal.customerEmails.markAddWebsite, { contactId, status: "skipped",
      reason: context.message ? "updates_off" : "no_longer_true", attempts: context.attempts });
    return { status: "skipped" };
  }
  const sent = await sendCustomerEmail({ to: context.email, ...context.message });
  const attempts = context.attempts + 1;
  if (sent.sent) {
    await ctx.runMutation(internal.customerEmails.markAddWebsite, { contactId, status: "sent", attempts });
    return { status: "sent" };
  }
  const retry = attempts < MAX_ATTEMPTS;
  await ctx.runMutation(internal.customerEmails.markAddWebsite, { contactId, status: retry ? "pending" : "failed", reason: sent.error ?? "send_failed", attempts });
  if (retry) await ctx.scheduler.runAfter(RETRY_MS, internal.customerEmails.sendAddWebsite, { contactId });
  return { status: retry ? "retrying" : "failed" };
} });

/** One pending email, with its message, the owner's address and the attempts so far. */
export const noticeContext = internalQuery({ args: { logId: v.id("customer_emails") }, handler: async (ctx, { logId }) => {
  const log = await ctx.db.get(logId);
  if (!log || log.status !== "pending") return null;
  const site = await ctx.db.get(log.siteId);
  if (!site || site.deletionStatus || site.accountDeletionRequestedAt) return null;
  const contact = site.userId ? await ctx.db.query("account_contacts").withIndex("by_user", q => q.eq("userId", site.userId!)).first() : null;
  const domain = site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), timeZone = site.contentSchedule?.timezone;
  let message: { subject: string; text: string } | null = null, skipReason = "no_longer_true";
  if (log.kind === "first_article" && log.articleId) {
    const article = await ctx.db.get(log.articleId);
    if (article?.status === "published" && article.publicUrl) message = firstArticleEmail({ domain, title: article.title, url: article.publicUrl,
      nextAt: site.contentSchedule?.nextDeadlineAt ?? null, intervalMs: site.contentSchedule?.intervalMs ?? null, timeZone,
      searchConsole: Boolean(site.gscRefreshToken && site.gscProperty) });
  } else if (log.kind === "monthly_report") {
    // What Pentra did last month, and Google's numbers when the whole month is in.
    const window = monthWindow(log.key);
    const published = (await collectCurrentDomainPublishedSummariesSince(ctx, site, window.startMs))
      .filter(a => typeof a.publishedAt === "number" && a.publishedAt < window.endMs).sort((a, b) => a.publishedAt! - b.publishedAt!)
      .map(a => ({ title: a.title, url: a.publicUrl ?? publishedArticlePageUrl(site.domain, site.urlStructure, a.slug) }));
    const improveJobs = (await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", site._id).eq("contentWork.stage", "verified"))
      .order("desc").take(100)).filter(j => j.contentWork?.intent === "improve" && (j.contentWork.verifiedAt ?? 0) >= window.startMs &&
        (j.contentWork.verifiedAt ?? 0) < window.endMs);
    // Autopilot's own improvements by page; the owner's corrections, edits and rollbacks are counted apart.
    const improved: MonthlyImprovement[] = [];
    let corrected = 0;
    for (const job of improveJobs) {
      if (job.contentWork!.ownerRequest || job.contentWork!.operation) { corrected++; continue; }
      const page = job.contentWork!.targetPageId ? await ctx.db.get(job.contentWork!.targetPageId) : null;
      if (!page || page.siteId !== site._id) continue;
      improved.push({ title: page.editable?.title ?? page.title ?? page.url, url: page.url, opportunity: job.contentWork!.opportunity });
    }
    let search: MonthlySearch = "not_connected";
    if (gscConnectionMatchesCurrentDomain(site) && site.gscReceiptStatus !== "revoked") {
      if (!isCompleteGscDateRange(site.gscDateEpochs ?? [], window.startDate, window.endDate)) search = "incomplete";
      else {
        const rows = await takeCurrentGscPageRows(ctx, site, REPORT_GSC_ROW_LIMIT, { startDate: window.startDate, endDate: window.endDate });
        if (rows.exhausted) search = "see_dashboard";
        else {
          const impressions = rows.rows.reduce((n, r) => n + r.impressions, 0);
          search = { clicks: rows.rows.reduce((n, r) => n + r.clicks, 0), impressions,
            position: impressions > 0 ? Math.round(rows.rows.reduce((n, r) => n + r.weightedPosition, 0) / impressions * 10) / 10 : null,
            pagesSeen: new Set(rows.rows.filter(r => r.impressions > 0).map(r => r.page)).size };
        }
      }
    }
    message = monthlyReportEmail({ domain, month: window, published, improved, corrected, search, intervalMs: site.contentSchedule?.paused ? null : site.contentSchedule?.intervalMs ?? null,
      // Only a slot still ahead is announced (an overdue one is reported by the late-article email).
      nextAt: site.contentSchedule && !site.contentSchedule.paused && site.contentSchedule.nextDeadlineAt > Date.now()
        ? site.contentSchedule.nextDeadlineAt : null, timeZone });
    if (!message) skipReason = "nothing_to_report";
  } else if (log.kind === "setup_reminder") {
    // Started since it was noted: nothing is left to tell.
    if (site.userId && !(await setupStarted(ctx, site))) message = setupReminderEmail({ domain, step: await setupStep(ctx, site) });
  } else if (log.kind === "draft_ready") {
    // Still waiting for the owner: not published, discarded or replaced by their own edit since.
    const jobId = ctx.db.normalizeId("jobs", log.key);
    const job = jobId ? await ctx.db.get(jobId) : null, cw = job?.contentWork;
    const article = job?.articleId ? await ctx.db.get(job.articleId) : null;
    const waiting = cw?.stage === "ready" || (cw?.stage === "failed" && cw.failure === "bounded_content_quality_exhausted");
    if (job && cw?.ownerRequest && job.siteId === site._id && cw.retiredAt === undefined && waiting && article?.siteId === site._id &&
      ["ready", "review"].includes(article.status ?? "") && !article.publicationAttemptedAt) {
      message = draftReadyEmail({ domain, title: article.title, articleId: article._id, notes: cw.stage === "failed", paste: pasteDestination(site) });
    }
  } else if (log.kind === "missed_slot" && log.cause) {
    // A slot that has since been published or skipped past needs no email.
    if (site.contentSchedule && site.contentSchedule.nextDeadlineAt === Number(log.key) && !site.contentSchedule.paused) {
      message = missedSlotEmail({ domain, deadlineAt: Number(log.key), timeZone, cause: log.cause as MissedSlotCause });
    }
  }
  return { attempts: log.attempts, message, skipReason, contact: contact ? { email: contact.email, emailUpdates: contact.emailUpdates } : null };
} });

export const markEmail = internalMutation({ args: { logId: v.id("customer_emails"), status: v.union(v.literal("pending"), v.literal("sent"),
  v.literal("skipped"), v.literal("failed")), reason: v.optional(v.string()), attempts: v.number() },
  handler: async (ctx, { logId, status, reason, attempts }) => {
    await ctx.db.patch(logId, { status, attempts, updatedAt: Date.now(), ...(reason ? { reason } : { reason: undefined }) });
  } });

/** Send one decided email (one retry 15 minutes later if Resend refuses it). */
async function sendNotice(ctx: ActionCtx, logId: Id<"customer_emails">): Promise<{ status: string }> {
  const context = await ctx.runQuery(internal.customerEmails.noticeContext, { logId });
  if (!context) return { status: "not_pending" };
  if (!context.message) {
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "skipped", reason: context.skipReason, attempts: context.attempts });
    return { status: "skipped" };
  }
  if (!context.contact || !context.contact.emailUpdates) {
    const reason = context.contact ? "updates_off" : "no_contact";
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "skipped", reason, attempts: context.attempts });
    return { status: "skipped" };
  }
  const sent = await sendCustomerEmail({ to: context.contact.email, ...context.message });
  const attempts = context.attempts + 1;
  if (sent.sent) {
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "sent", attempts });
    return { status: "sent" };
  }
  const retry = attempts < MAX_ATTEMPTS;
  await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: retry ? "pending" : "failed", reason: sent.error ?? "send_failed", attempts });
  if (retry) await ctx.scheduler.runAfter(RETRY_MS, internal.customerEmails.send, { logId });
  return { status: retry ? "retrying" : "failed" };
}

export const send = internalAction({ args: { logId: v.id("customer_emails") }, handler: async (ctx, { logId }) => sendNotice(ctx, logId) });
/** P125's name for the same send, kept for anything it already scheduled. */
export const sendFirstArticle = internalAction({ args: { logId: v.id("customer_emails") }, handler: async (ctx, { logId }) => sendNotice(ctx, logId) });
