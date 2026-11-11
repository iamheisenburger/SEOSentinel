/** Phase 4 (Nov 2026), earned links the Elvix way (convex/lib/linkOutreach.ts). The weekly diagnosis finds the pages that
 * link to a site's page-one competitors but not to it (`record`); convex/actions/linkOutreach.ts reads each page, finds
 * who runs it and writes the email (`prepareContext`, `recordPrepared`), sends from the owner's own mailbox at a measured
 * pace with one follow-up (`sendContext`, `recordSend`), stops at a reply, bounce or opt-out (`recordInbox`), and checks
 * every week whether the link went live (`recordChecks`). The owner chooses the mode: off, find, draft (Pentra writes,
 * the owner presses Send) or send. Nothing is ever sent from a site that hasn't chosen "send" or pressed Send. */
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { publishedArticlePageUrl } from "./lib/searchPerformance";
import { encryptOutreachCredentials, outreachCredentialKeyConfig } from "./lib/outreachCredentialEncryption";
import { imapPresetForSmtpHost, SMTP_PRESETS } from "./lib/outreachSmtp";
import { editorialSite, followUpDue, INBOX_WATCH_DAYS, LINK_FOLLOW_UP_DAYS, LINK_PAGES_PER_WEEK, NOT_AN_EDITOR_NOTE, OUTSIDE_US_UK_NOTE, recipientCountryAllowed, sendAllowedNow,
  sendTimes, UNREAD_BEFORE_SENDING_NOTE } from "./lib/linkOutreach";
import { isContactableAddress, isDeskAddress } from "./lib/outreachContacts";
import { citedPagesFromAnswers, rivalDomainsFromAnswers } from "./lib/linkOpportunities";
import { ConvexError } from "convex/values";
import { onNewSystem } from "./siteDiagnosis";

const DAY = 86_400_000;
const listing = v.object({ url: v.string(), domain: v.string(), title: v.string(), rank: v.number(), linksTo: v.array(v.string()),
  language: v.union(v.string(), v.null()), source: v.union(v.literal("competitor_links"), v.literal("ai_answer")) });
export const mailboxBinding = (siteId: Id<"sites">, email: string) => `link_mailbox:${siteId}:${email.trim().toLowerCase()}`;

/** The owner's own site, where the weekly diagnosis runs (it finds the pages): Pentra's own two sites until the rollout. */
async function ownedSite(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">): Promise<Doc<"sites"> | null> {
  const identity = await ctx.auth.getUserIdentity(), site = await ctx.db.get(siteId);
  return identity && site && site.userId === identity.subject && !site.deletionStatus && onNewSystem(site) ? site : null;
}
const rows = (ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) => ctx.db.query("link_opportunities").withIndex("by_site_domain", (q) => q.eq("siteId", siteId)).take(1000);
const mailboxOf = (ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) => ctx.db.query("link_mailboxes").withIndex("by_site", (q) => q.eq("siteId", siteId)).first();

/** Records the week's pages: one per referring site. A site seen again keeps its row and status (a page not yet read may
 * be replaced by a stronger page on the same site); a new site is added. */
export const record = internalMutation({ args: { siteId: v.id("sites"), pages: v.array(listing) }, handler: async (ctx, { siteId, pages }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus || !site.linkOutreach) return { added: 0 };
  const now = Date.now();
  let added = 0;
  for (const p of pages.slice(0, 100)) {
    const existing = await ctx.db.query("link_opportunities").withIndex("by_site_domain", (q) => q.eq("siteId", siteId).eq("domain", p.domain)).first();
    if (existing) {
      // P398: an AI-cited page set aside only because it linked to no competitor is read again (AI-cited pages no longer need one).
      if (p.source === "ai_answer" && existing.status === "skipped" && existing.note === "it doesn't link to the competitors") {
        await ctx.db.patch(existing._id, { status: "new", note: undefined, source: "ai_answer", url: p.url, seenAt: now });
        added++;
        continue;
      }
      const fresh = existing.status === "new" && (!existing.url || p.rank > existing.rank);
      await ctx.db.patch(existing._id, { seenAt: now, ...(fresh ? { url: p.url, title: p.title, rank: p.rank, linksTo: p.linksTo.slice(0, 5) } : {}) });
      continue;
    }
    await ctx.db.insert("link_opportunities", { siteId, domain: p.domain.slice(0, 200), url: p.url.slice(0, 600), title: p.title.slice(0, 200), rank: p.rank,
      linksTo: p.linksTo.slice(0, 5), source: p.source, status: "new", foundAt: now, seenAt: now });
    added++;
  }
  return { added };
} });

/** What the weekly preparation needs: the site, its live articles (what it can suggest), the sender's name, the pages
 * to read this week (strongest first), and the contacted pages whose link is due a weekly check. */
export const prepareContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus || !site.userId || !site.linkOutreach) return null;
  const all = await rows(ctx, siteId), now = Date.now();
  const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published")).order("desc").take(300))
    .filter((row) => articleMatchesCurrentDomain(site, row));
  const articles = summaries.flatMap((row) => {
    let url: string | null = row.publicUrl?.startsWith("https://") ? row.publicUrl : null;
    try { url ??= publishedArticlePageUrl(site.domain, site.urlStructure, row.slug); } catch { url = null; }
    return url ? [{ url, title: row.title }] : [];
  });
  const mailbox = await mailboxOf(ctx, siteId);
  const domain = site.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return { mode: site.linkOutreach, domain, name: site.siteName ?? domain, summary: site.siteSummary ?? site.niche ?? "", language: site.language ?? "en",
    homeUrl: `https://${domain}/`, articles, senderName: mailbox?.senderName ?? site.siteName ?? domain, userId: site.userId,
    suppressed: [...new Set(all.filter((o) => o.optedOutAt || o.bouncedAt).flatMap((o) => o.contact ? [o.contact.email] : []))],
    // The pages AI assistants cite come first (being listed there also gets the site named in those answers), then by strength.
    fresh: all.filter((o) => o.status === "new" && o.url && recipientCountryAllowed(o.domain) && editorialSite(o.domain))
      .sort((a, b) => Number(b.source === "ai_answer") - Number(a.source === "ai_answer") || b.rank - a.rank).slice(0, LINK_PAGES_PER_WEEK)
      .map((o) => ({ id: o._id, url: o.url!, domain: o.domain, title: o.title ?? "", linksTo: o.linksTo, source: o.source ?? "competitor_links" })),
    toCheck: all.filter((o) => ["sent", "replied", "won"].includes(o.status) && o.url && now - (o.checkedAt ?? 0) >= 6 * DAY)
      .slice(0, 40).map((o) => ({ id: o._id, url: o.url!, status: o.status })) };
} });

const prepared = v.object({ id: v.id("link_opportunities"), status: v.union(v.literal("ready"), v.literal("skipped"), v.literal("no_contact"), v.literal("won")),
  title: v.optional(v.string()), linksTo: v.optional(v.array(v.string())), kind: v.optional(v.union(v.literal("list"), v.literal("resource"))),
  contact: v.optional(v.object({ email: v.string(), source: v.string() })),
  target: v.optional(v.object({ url: v.string(), title: v.string(), as: v.union(v.literal("product"), v.literal("article")) })),
  pitch: v.optional(v.object({ subject: v.string(), body: v.string(), writtenAt: v.number(), costMicroUsd: v.number() })),
  note: v.optional(v.string()) });

/** The week's read pages: each is ready to send (its contact, the page to suggest and its email), set aside with the
 * reason, or already linking to the site. Starts the sender when the site sends on its own. */
export const recordPrepared = internalMutation({ args: { siteId: v.id("sites"), results: v.array(prepared) }, handler: async (ctx, { siteId, results }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus) return { ready: 0 };
  const now = Date.now();
  let ready = 0;
  for (const r of results) {
    const o = await ctx.db.get(r.id);
    if (!o || o.siteId !== siteId || o.status !== "new") continue;
    const { id: _id, ...fields } = r;
    void _id;
    await ctx.db.patch(o._id, { ...fields, checkedAt: now, ...(r.status === "won" ? { wonAt: now } : {}) });
    if (r.status === "ready") ready++;
  }
  if (ready && site.linkOutreach === "send") await wakeSender(ctx, siteId, now);
  return { ready };
} });

/** The weekly link checks: a contacted page that now links to the site is won (and counted); a won page that no longer
 * does is lost. */
export const recordChecks = internalMutation({ args: { siteId: v.id("sites"), checks: v.array(v.object({ id: v.id("link_opportunities"),
  linked: v.boolean(), href: v.optional(v.string()), followed: v.optional(v.boolean()) })) }, handler: async (ctx, { siteId, checks }) => {
  const now = Date.now();
  let won = 0;
  for (const c of checks) {
    const o = await ctx.db.get(c.id);
    if (!o || o.siteId !== siteId) continue;
    if (c.linked && o.status !== "won") { await ctx.db.patch(o._id, { status: "won", wonAt: now, won: { href: (c.href ?? "").slice(0, 600), followed: c.followed === true }, checkedAt: now }); won++; }
    else if (!c.linked && o.status === "won") await ctx.db.patch(o._id, { status: "lost", lostAt: now, checkedAt: now });
    else await ctx.db.patch(o._id, { checkedAt: now });
  }
  return { won };
} });

// ------------------------------------------------------------------------------------------------------- the owner's controls

export const MODES = ["off", "find", "draft", "send"] as const;
/** The owner's choice. "send" needs a mailbox that passed its check; every mode keeps what was found. */
export const setMode = mutation({ args: { siteId: v.id("sites"), mode: v.union(v.literal("off"), v.literal("find"), v.literal("draft"), v.literal("send")) },
  handler: async (ctx, { siteId, mode }) => {
    const site = await ownedSite(ctx, siteId);
    if (!site) throw new ConvexError("Not your site");
    if (mode === "send") {
      const mailbox = await mailboxOf(ctx, siteId);
      if (mailbox?.status !== "ready") throw new ConvexError("Connect your mailbox first: Pentra sends from it");
    }
    const wasOff = !site.linkOutreach;
    await ctx.db.patch(siteId, { linkOutreach: mode === "off" ? undefined : mode, updatedAt: Date.now() });
    if (mode === "send") await wakeSender(ctx, siteId, Date.now());
    // P369: switching link building on looks for pages at once (from the latest diagnosis), not at the next weekly run.
    if (wasOff && mode !== "off" && !(await rows(ctx, siteId)).some((o) => o.url)) await ctx.scheduler.runAfter(0, internal.actions.linkOutreach.findNow, { siteId });
    return { mode };
  } });

/** The owner's mailbox: Pentra sends from it and reads its inbox only for replies to these emails. The password is
 * encrypted at once (the old outreach system's key) and checked by logging in, without sending anything. */
export const connectMailbox = mutation({ args: { siteId: v.id("sites"), provider: v.union(v.literal("gmail"), v.literal("outlook"), v.literal("zoho"),
  v.literal("fastmail"), v.literal("other")), email: v.string(), password: v.string(), senderName: v.string(), postalAddress: v.string(),
  smtpHost: v.optional(v.string()), smtpPort: v.optional(v.number()), imapHost: v.optional(v.string()), imapPort: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const site = await ownedSite(ctx, args.siteId);
    if (!site) throw new ConvexError("Not your site");
    const email = args.email.trim().toLowerCase(), senderName = args.senderName.replace(/\s+/g, " ").trim(), postalAddress = args.postalAddress.replace(/\s+/g, " ").trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new ConvexError("Enter the mailbox's full email address");
    if (senderName.length < 2 || senderName.length > 60) throw new ConvexError("Enter the name your emails are signed with");
    if (postalAddress.length < 10 || postalAddress.length > 200) throw new ConvexError("Enter a postal address: US anti-spam law asks every business email to carry one");
    if (args.password.length < 6 || args.password.length > 200) throw new ConvexError("Enter the mailbox's password (for Gmail, an app password)");
    const preset = SMTP_PRESETS.find((p) => p.id === args.provider);
    const host = (value: string | undefined) => (value ?? "").trim().toLowerCase();
    const smtpHost = preset?.host ?? host(args.smtpHost), smtpPort = preset?.port ?? args.smtpPort ?? 465;
    const imapPreset = preset ? { host: preset.imapHost, port: preset.imapPort } : imapPresetForSmtpHost(smtpHost);
    const imapHost = imapPreset?.host ?? host(args.imapHost), imapPort = imapPreset?.port ?? args.imapPort ?? 993;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(smtpHost) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(imapHost) || ![465, 587].includes(smtpPort) || imapPort !== 993) {
      throw new ConvexError("Enter your mailbox's sending (SMTP, port 465 or 587) and receiving (IMAP, port 993) servers");
    }
    const credentials = await encryptOutreachCredentials({ secrets: { smtpPassword: args.password, imapPassword: args.password },
      binding: mailboxBinding(args.siteId, email), key: outreachCredentialKeyConfig(process.env) });
    const now = Date.now(), existing = await mailboxOf(ctx, args.siteId);
    const row = { siteId: args.siteId, email, senderName, postalAddress, smtp: { host: smtpHost, port: smtpPort }, imap: { host: imapHost, port: imapPort },
      credentials, status: "checking" as const, note: undefined, updatedAt: now };
    const id = existing ? (await ctx.db.patch(existing._id, row), existing._id) : await ctx.db.insert("link_mailboxes", { ...row, createdAt: now });
    await ctx.scheduler.runAfter(0, internal.actions.linkOutreach.verifyMailbox, { siteId: args.siteId, mailboxId: id });
    return { status: "checking" };
  } });

export const mailbox = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  if (!await ownedSite(ctx, siteId)) return null;
  const m = await mailboxOf(ctx, siteId);
  return m ? { email: m.email, senderName: m.senderName, postalAddress: m.postalAddress, status: m.status, note: m.note ?? null, checkedAt: m.checkedAt ?? null } : null;
} });

export const mailboxChecked = internalMutation({ args: { siteId: v.id("sites"), mailboxId: v.id("link_mailboxes"), ok: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, { siteId, mailboxId, ok, note }) => {
    const m = await ctx.db.get(mailboxId);
    if (!m || m.siteId !== siteId) return;
    await ctx.db.patch(mailboxId, { status: ok ? "ready" : "failed", note: note?.slice(0, 300), checkedAt: Date.now(), updatedAt: Date.now() });
  } });

/** The owner's view: the mode, the counts, and every page found with where it stands (newest work first). */
export const listForSite = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownedSite(ctx, siteId);
  if (!site) return null;
  const all = await rows(ctx, siteId);
  const count = (...statuses: string[]) => all.filter((o) => statuses.includes(o.status)).length;
  // P406: every page already written to comes before the pages not yet read, so a site with many found pages still lists
  // what happened to each email (a bounce sorted after 50 new pages fell off the list).
  const order: Record<string, number> = { replied: 0, ready: 1, sent: 2, won: 3, bounced: 4, opted_out: 5, lost: 6, new: 7, no_contact: 8, skipped: 9, dismissed: 10 };
  return { mode: site.linkOutreach ?? "off",
    counts: { found: all.length, ready: count("ready"), contacted: count("sent", "replied", "won", "lost", "opted_out", "bounced"), replied: count("replied"), won: count("won"),
      bounced: count("bounced"), optedOut: count("opted_out") },
    items: all.filter((o) => o.url).sort((a, b) => (order[a.status] ?? 20) - (order[b.status] ?? 20) || b.rank - a.rank).slice(0, 60).map((o) => ({
      id: o._id, status: o.status, url: o.url!, title: o.title || o.domain, domain: o.domain, rank: o.rank, source: o.source ?? "competitor_links", linksTo: o.linksTo,
      contact: o.contact?.email ?? null, uncertain: Boolean(o.pendingSend),
      target: o.target ?? null, pitch: o.pitch ? { subject: o.pitch.subject, body: o.pitch.body } : null, sentAt: o.sends?.[0]?.at ?? null,
      followedUpAt: o.sends?.[1]?.at ?? null, repliedAt: o.repliedAt ?? null, wonAt: o.wonAt ?? null, note: o.note ?? null, approved: Boolean(o.approvedAt) })) };
} });

/** Draft mode: the owner sends one prepared email (it goes out at the next allowed moment, from their mailbox). */
export const approve = mutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities") }, handler: async (ctx, { siteId, id }) => {
  const site = await ownedSite(ctx, siteId), o = await ctx.db.get(id);
  if (!site || !o || o.siteId !== siteId || o.status !== "ready") throw new ConvexError("This email can't be sent");
  if ((await mailboxOf(ctx, siteId))?.status !== "ready") throw new ConvexError("Connect your mailbox first: Pentra sends from it");
  await ctx.db.patch(id, { approvedAt: Date.now() });
  await wakeSender(ctx, siteId, Date.now());
} });

export const dismiss = mutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities") }, handler: async (ctx, { siteId, id }) => {
  const site = await ownedSite(ctx, siteId), o = await ctx.db.get(id);
  if (!site || !o || o.siteId !== siteId || !["new", "ready", "no_contact", "skipped"].includes(o.status)) throw new ConvexError("This page can't be set aside");
  await ctx.db.patch(id, { status: "dismissed" });
} });

// ------------------------------------------------------------------------------------------------------- sending

/** Schedules the sender for now, unless a turn is already booked sooner. */
async function wakeSender(ctx: MutationCtx, siteId: Id<"sites">, at: number) {
  const m = await mailboxOf(ctx, siteId);
  if (!m || m.status !== "ready") return;
  const booked = m.nextRunAt !== undefined && m.nextRunAt > Date.now() ? m.nextRunAt : undefined;
  if (booked !== undefined && booked <= at) return;
  // P406: a later booking stays on record, so the turn started here doesn't book a second chain beside it (sendTurnDone).
  if (booked === undefined) await ctx.db.patch(m._id, { nextRunAt: at });
  await ctx.scheduler.runAt(at, internal.actions.linkOutreach.sendNext, { siteId });
}

/** One send turn's inputs: the mailbox, every send of the last week (the caps), the next email due (a follow-up first,
 * then a prepared first email: in draft mode only the ones the owner pressed Send on), and the contacted addresses whose
 * replies to look for. */
export const sendContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId), m = await mailboxOf(ctx, siteId);
  if (!site || site.deletionStatus || !m || m.status !== "ready" || !site.linkOutreach || site.linkOutreach === "find") return null;
  const all = await rows(ctx, siteId), now = Date.now();
  // P406: an email going out at this moment counts toward the caps too.
  const sentAt = sendTimes(all, now);
  const suppressed = new Set(all.filter((o) => o.optedOutAt || o.bouncedAt).flatMap((o) => o.contact ? [o.contact.email] : []));
  // An attempt with no receipt (pendingSend) is never sent again: the owner sees it as uncertain.
  // P371: US and UK sites only, by the site's domain and the contact's address, checked again at every send.
  // P376: never a user-written platform (dev.to and the like), checked again at every send.
  const allowed = (o: (typeof all)[number]) => recipientCountryAllowed(o.domain) && (!o.contact || recipientCountryAllowed(o.contact.email)) && editorialSite(o.domain);
  // P406: no follow-up to an address that turns out to be a desk (support, legal, no-reply) or an escape's leftover.
  const followUp = all.find((o) => o.status === "sent" && !o.pendingSend && followUpDue(o, now) && o.contact && !suppressed.has(o.contact.email) && allowed(o) &&
    isContactableAddress(o.contact.email) && !isDeskAddress(o.contact.email));
  const first = all.filter((o) => o.status === "ready" && !o.pendingSend && o.contact && o.pitch && !suppressed.has(o.contact.email) && allowed(o) &&
    (site.linkOutreach === "send" || o.approvedAt))
    .sort((a, b) => (a.approvedAt ? 0 : 1) - (b.approvedAt ? 0 : 1) || b.rank - a.rank)[0];
  const next = followUp ?? first;
  // When the next follow-up falls due (first emails with no answer yet), so the sender wakes for it.
  const waiting = all.filter((o) => o.status === "sent" && !o.pendingSend && o.sends?.length === 1 && o.contact && !suppressed.has(o.contact.email) &&
    isContactableAddress(o.contact.email) && !isDeskAddress(o.contact.email))
    .map((o) => o.sends![0].at + LINK_FOLLOW_UP_DAYS * DAY);
  // P406: the addresses whose answers are looked for: written to in the last INBOX_WATCH_DAYS days (bounded work per turn).
  const contacted = all.filter((o) => o.status === "sent" && o.contact && o.sends?.length && now - o.sends[o.sends.length - 1].at < INBOX_WATCH_DAYS * DAY)
    .map((o) => ({ id: o._id, email: o.contact!.email, since: o.sends![0].at }));
  return { mailbox: { id: m._id, email: m.email, senderName: m.senderName, postalAddress: m.postalAddress, smtp: m.smtp, imap: m.imap, credentials: m.credentials },
    site: { name: site.siteName ?? site.domain, domain: site.domain }, sentAt,
    next: next ? { id: next._id, url: next.url ?? `https://${next.domain}/`, domain: next.domain, kind: followUp ? "follow_up" as const : "first" as const, to: next.contact!.email, subject: next.pitch!.subject, body: next.pitch!.body,
      theirTitle: next.title ?? next.domain, ourTitle: next.target?.title ?? site.siteName ?? site.domain, inReplyTo: next.sends?.[0]?.messageId ?? null } : null,
    nextFollowUpAt: waiting.length ? Math.min(...waiting) : null, contacted, awaiting: contacted.length > 0 };
} });

/** Records an email as about to go out. A row already carrying an attempt (its outcome unknown) is refused: Pentra never
 * risks writing to someone twice. */
export const claimSend = internalMutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities"), kind: v.union(v.literal("first"), v.literal("follow_up")),
  messageId: v.string() }, handler: async (ctx, { siteId, id, kind, messageId }) => {
  const o = await ctx.db.get(id), site = await ctx.db.get(siteId);
  if (!o || !site || o.siteId !== siteId || o.pendingSend || site.deletionStatus || !site.linkOutreach || site.linkOutreach === "find") return { ok: false };
  if (kind === "first" ? o.status !== "ready" || (site.linkOutreach !== "send" && !o.approvedAt) : o.status !== "sent" || !followUpDue(o, Date.now())) return { ok: false };
  // P406: the pace is checked here, in the one transaction every send passes through, against every email sent or going
  // out: two send turns running at once can no longer both send (Convex runs these one after the other).
  const now = Date.now();
  if (!sendAllowedNow(now, sendTimes(await rows(ctx, siteId), now))) return { ok: false };
  await ctx.db.patch(id, { pendingSend: { kind, messageId: messageId.slice(0, 300), at: now } });
  return { ok: true };
} });

/** P406: a prepared email whose address is a desk (support, legal, no-reply) or an escape's leftover is set aside, never sent.
 * P408: and one whose address reaches no one the site names and no editorial or general inbox, or whose page can't be read
 * just before sending. */
export const setAsideDesk = internalMutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities"), unread: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, id, unread }) => {
    const o = await ctx.db.get(id);
    if (!o || o.siteId !== siteId || o.pendingSend || o.status !== "ready") return;
    await ctx.db.patch(id, { status: "skipped", note: unread ? UNREAD_BEFORE_SENDING_NOTE : NOT_AN_EDITOR_NOTE });
  } });

/** The mailbox accepted the email: the attempt becomes a send. */
export const recordSend = internalMutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities"), kind: v.union(v.literal("first"), v.literal("follow_up")),
  messageId: v.string() }, handler: async (ctx, { siteId, id, kind, messageId }) => {
  const o = await ctx.db.get(id);
  if (!o || o.siteId !== siteId || o.pendingSend?.messageId !== messageId) return;
  await ctx.db.patch(id, { status: "sent", pendingSend: undefined, sends: [...(o.sends ?? []), { at: Date.now(), kind, messageId: messageId.slice(0, 300) }] });
} });

/** The mailbox refused the email before accepting it: nothing went out, so the attempt is cleared. */
export const releaseSend = internalMutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities"), messageId: v.string(), note: v.string() },
  handler: async (ctx, { siteId, id, messageId, note }) => {
    const o = await ctx.db.get(id);
    if (!o || o.siteId !== siteId || o.pendingSend?.messageId !== messageId) return;
    await ctx.db.patch(id, { pendingSend: undefined, note: note.slice(0, 200) });
  } });

/** P371, P408: a page whose site shows a business outside the US and the UK is set aside, never written to. */
export const setAsideForCountry = internalMutation({ args: { siteId: v.id("sites"), id: v.id("link_opportunities") }, handler: async (ctx, { siteId, id }) => {
  const o = await ctx.db.get(id);
  if (!o || o.siteId !== siteId || o.pendingSend || !["new", "ready", "no_contact"].includes(o.status)) return;
  await ctx.db.patch(id, { status: "skipped", note: OUTSIDE_US_UK_NOTE });
} });

/** The mailbox to check (its encrypted credentials stay server side). */
export const mailboxForCheck = internalQuery({ args: { siteId: v.id("sites"), mailboxId: v.id("link_mailboxes") }, handler: async (ctx, { siteId, mailboxId }) => {
  const m = await ctx.db.get(mailboxId);
  return m && m.siteId === siteId ? { id: m._id, email: m.email, senderName: m.senderName, postalAddress: m.postalAddress, smtp: m.smtp, imap: m.imap,
    credentials: m.credentials } : null;
} });

/** Replies, bounces and opt-outs seen in the mailbox: the conversation is the owner's now, and Pentra never writes to that
 * address again (an opt-out or bounce holds for every page that address runs). */
export const recordInbox = internalMutation({ args: { siteId: v.id("sites"), events: v.array(v.object({ id: v.id("link_opportunities"),
  kind: v.union(v.literal("reply"), v.literal("opt_out"), v.literal("bounce")) })) }, handler: async (ctx, { siteId, events }) => {
  const now = Date.now();
  for (const e of events) {
    const o = await ctx.db.get(e.id);
    if (!o || o.siteId !== siteId || o.status !== "sent") continue;
    await ctx.db.patch(o._id, e.kind === "reply" ? { status: "replied", repliedAt: now } : e.kind === "opt_out" ? { status: "opted_out", optedOutAt: now, repliedAt: now }
      : { status: "bounced", bouncedAt: now });
  }
} });

/** Ends a send turn: books the next one when there is more to send, else leaves the sender asleep until new work. */
export const sendTurnDone = internalMutation({ args: { siteId: v.id("sites"), nextAt: v.union(v.number(), v.null()), error: v.optional(v.string()) },
  handler: async (ctx, { siteId, nextAt, error }) => {
    const m = await mailboxOf(ctx, siteId);
    if (!m) return;
    if (error && /auth|login|credential|535|534/i.test(error)) {
      await ctx.db.patch(m._id, { status: "failed", note: `Sending stopped: the mailbox refused the login (${error.slice(0, 120)})`, nextRunAt: undefined, updatedAt: Date.now() });
      return;
    }
    // P406: one chain of turns per mailbox. Each Send press or wake used to start a chain that never merged back (four woke
    // together at 13:00 on Nov 10); a turn now books the next one only when no turn is already booked at or before it.
    const now = Date.now();
    const booked = m.nextRunAt !== undefined && m.nextRunAt > now ? m.nextRunAt : undefined;
    const book = nextAt !== null && (booked === undefined || nextAt < booked);
    await ctx.db.patch(m._id, { nextRunAt: book ? nextAt! : booked, ...(error ? { note: `Last send failed: ${error.slice(0, 160)}` } : {}), updatedAt: now });
    if (book) await ctx.scheduler.runAt(nextAt!, internal.actions.linkOutreach.sendNext, { siteId });
  } });

/** P369: what finding at once needs: the latest diagnosis's page one (the competitors) and the pages the AI answers cited. */
export const findContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus || !site.linkOutreach) return null;
  const latest = await ctx.db.query("site_diagnoses").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).order("desc").first();
  // P396: the Answers engine's own answers (every question, every assistant, the last two weeks) are the fuller record of
  // what the assistants read and whom they name; the weekly diagnosis's few AI checks come after them.
  const answers = site.answers?.enabled
    ? await ctx.db.query("answer_checks").withIndex("by_site_asked", (q) => q.eq("siteId", siteId).gte("askedAt", Date.now() - 14 * 86_400_000)).take(800)
    : [];
  const confirmed = (site.answers?.competitors ?? []).flatMap((c) => c.domain ? [c.domain] : []);
  return { domain: site.domain, pageOne: latest?.pageOne ?? [],
    profileCompetitors: [...(site.competitors ?? []), ...confirmed, ...rivalDomainsFromAnswers(answers, site.domain)],
    aiPages: [...citedPagesFromAnswers(answers), ...(latest?.aiAnswers?.checks ?? []).flatMap((c) => c.pages ?? [])] };
} });

/** For the weekly email: what the week's link work did. */
export async function linkWeek(ctx: QueryCtx, siteId: Id<"sites">, since: number) {
  const all = await rows(ctx, siteId);
  return { found: all.filter((o) => o.foundAt >= since && o.url).length, emailed: all.filter((o) => (o.sends ?? []).some((s) => s.kind === "first" && s.at >= since)).length,
    replied: all.filter((o) => (o.repliedAt ?? 0) >= since).length, won: all.filter((o) => (o.wonAt ?? 0) >= since).length,
    wonTotal: all.filter((o) => o.status === "won").length };
}

/** Operator read for the watchdog (P373): counts by status, the newest set-aside reasons and the mailbox state. No email
 * address, page text or credential leaves the server. */
export const opsSummary = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  const all = await rows(ctx, siteId), m = await mailboxOf(ctx, siteId);
  const counts: Record<string, number> = {};
  for (const o of all) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const notes: Record<string, number> = {};
  for (const o of all) if (o.note) notes[o.note.slice(0, 90)] = (notes[o.note.slice(0, 90)] ?? 0) + 1;
  return { mode: site.linkOutreach ?? "off", found: all.length, withPage: all.filter((o) => o.url).length, counts, notes,
    sent: all.reduce((n, o) => n + (o.sends?.length ?? 0), 0), uncertain: all.filter((o) => o.pendingSend).length,
    nonUsUk: all.filter((o) => (o.sends?.length ?? 0) > 0 && !recipientCountryAllowed(o.domain)).length,
    mailbox: m ? { status: m.status, note: m.note ?? null, nextRunAt: m.nextRunAt ?? null } : null };
} });
