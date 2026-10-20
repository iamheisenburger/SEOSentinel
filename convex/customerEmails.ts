import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { firstArticleEmail, plausibleEmail, sendCustomerEmail } from "./lib/customerEmail";
import { accountDeletionKey } from "./lib/accountDeletion";

/** D4 (P125, Oct 20 2026): service emails to a site's owner about their own
 * site, from hello@pentra.dev. The address is Clerk's verified primary email,
 * recorded when the owner opens the dashboard (pentra.dev's plan sync), and
 * every email can be turned off in Settings. Each kind is decided once per
 * key and logged, so a retry or a second verification never sends twice. */

const RETRY_MS = 15 * 60_000, MAX_ATTEMPTS = 2;

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
  if (!earlier) await ctx.scheduler.runAfter(0, internal.customerEmails.sendFirstArticle, { logId });
}

export const firstArticleContext = internalQuery({ args: { logId: v.id("customer_emails") }, handler: async (ctx, { logId }) => {
  const log = await ctx.db.get(logId);
  if (!log || log.status !== "pending" || !log.articleId) return null;
  const [site, article] = await Promise.all([ctx.db.get(log.siteId), ctx.db.get(log.articleId)]);
  if (!site || site.deletionStatus || !article || article.status !== "published" || !article.publicUrl) return null;
  const contact = site.userId ? await ctx.db.query("account_contacts").withIndex("by_user", q => q.eq("userId", site.userId!)).first() : null;
  return { attempts: log.attempts, domain: site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), title: article.title, url: article.publicUrl,
    nextAt: site.contentSchedule?.nextDeadlineAt ?? null, intervalMs: site.contentSchedule?.intervalMs ?? null,
    timeZone: site.contentSchedule?.timezone, searchConsole: Boolean(site.gscRefreshToken && site.gscProperty),
    contact: contact ? { email: contact.email, emailUpdates: contact.emailUpdates } : null };
} });

export const markEmail = internalMutation({ args: { logId: v.id("customer_emails"), status: v.union(v.literal("pending"), v.literal("sent"),
  v.literal("skipped"), v.literal("failed")), reason: v.optional(v.string()), attempts: v.number() },
  handler: async (ctx, { logId, status, reason, attempts }) => {
    await ctx.db.patch(logId, { status, attempts, updatedAt: Date.now(), ...(reason ? { reason } : { reason: undefined }) });
  } });

/** Send the first-article email (one retry 15 minutes later if Resend refuses it). */
export const sendFirstArticle = internalAction({ args: { logId: v.id("customer_emails") }, handler: async (ctx, { logId }): Promise<{ status: string }> => {
  const context = await ctx.runQuery(internal.customerEmails.firstArticleContext, { logId });
  if (!context) {
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "skipped", reason: "article_or_site_gone", attempts: 0 });
    return { status: "skipped" };
  }
  if (!context.contact || !context.contact.emailUpdates) {
    const reason = context.contact ? "updates_off" : "no_contact";
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "skipped", reason, attempts: context.attempts });
    return { status: "skipped" };
  }
  const message = firstArticleEmail(context);
  const sent = await sendCustomerEmail({ to: context.contact.email, ...message });
  const attempts = context.attempts + 1;
  if (sent.sent) {
    await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: "sent", attempts });
    return { status: "sent" };
  }
  const retry = attempts < MAX_ATTEMPTS;
  await ctx.runMutation(internal.customerEmails.markEmail, { logId, status: retry ? "pending" : "failed", reason: sent.error ?? "send_failed", attempts });
  if (retry) await ctx.scheduler.runAfter(RETRY_MS, internal.customerEmails.sendFirstArticle, { logId });
  return { status: retry ? "retrying" : "failed" };
} });
