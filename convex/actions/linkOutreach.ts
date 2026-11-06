"use node";
/** Phase 4 (Nov 2026), earned links the Elvix way: the work that touches the web and the owner's mailbox.
 *   - prepare: reads each page the weekly finder found (free), finds who runs it (their page, then their contact and about
 *     pages: free), chooses the site's page to suggest, and writes the email (one cheap model call each, under a small
 *     spend hold), used only when it passes the objective checks; and checks contacted pages for the won link (free).
 *   - sendNext: one email per turn from the owner's mailbox (SMTP), after reading the inbox for replies, bounces and
 *     opt-outs (IMAP); paced by convex/lib/linkOutreach.ts nextSendAt; an uncertain send is never retried.
 *   - verifyMailbox: logs in to the mailbox (SMTP and IMAP) without sending anything. */
import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { contactDiscoveryUrls, extractContactCandidates, selectBestContact } from "../lib/outreachContacts";
import { requestsOutreachOptOut } from "../lib/outreachInbound";
import { decryptOutreachCredentials, outreachCredentialKeyConfig, type EncryptedOutreachCredentials } from "../lib/outreachCredentialEncryption";
import { classifySmtpFailure, smtpTransportOptions } from "../lib/outreachSmtp";
import { aiCitedPages, checkPitch, emailFooter, followUpEmail, linkToSite, nextSendAt, pageIntersectionRequest, parsePageIntersection, pitchRequest, pitchTarget,
  readListingPage, PITCH_MAX_TOKENS, PITCH_TOOL, type ListingPage } from "../lib/linkOutreach";
import { linkCompetitors } from "../lib/linkOpportunities";
import { meterDataForSeoCost, pageIntersection } from "./seoData";
import { BUYER_FIT_MODEL, buyerFitCostMicroUsd } from "../lib/topicFit";
import { structuredToolChoice } from "../lib/toolChoice";
import { mailboxBinding } from "../linkOpportunities";

/** A pitch call whose answer was lost is charged at this bound (a Haiku call with two page excerpts costs well under it). */
const PITCH_CALL_MAX_MICRO_USD = 5_000;
const PREPARE_HOLD_MICRO_USD = 100_000;
/** The preparation stops taking new pages after this long (an action has ten minutes); the rest wait for the next run. */
const PREPARE_TIME_MS = 6 * 60_000;
const fetchPage = (url: string) => safeFetchPublicText(url, { expectedHost: new URL(url).hostname, allowedContentTypes: [/^text\/html(?:;|$)/i], timeoutMs: 15_000 });

type PrepareResult = { skipped?: string; checked?: number; prepared?: number; ready?: number; costMicroUsd?: number };
type SendResult = { sent: boolean; reason?: string; nextAt?: number | null; error?: string };

export const prepare = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<PrepareResult> => {
  const site = await ctx.runQuery(internal.linkOpportunities.prepareContext, { siteId });
  if (!site) return { skipped: "link building is off" };
  // The weekly link checks first: free page reads.
  const checks = [];
  for (const o of site.toCheck) {
    try { const page = await fetchPage(o.url); checks.push({ id: o.id, ...linkToSite(page.text, page.url, site.domain) }); }
    catch { /* unreachable this week: checked again next week */ }
  }
  if (checks.length) await ctx.runMutation(internal.linkOpportunities.recordChecks, { siteId, checks });
  if (site.mode === "find" || !site.fresh.length) return { checked: checks.length, prepared: 0 };

  const hold = await ctx.runMutation(internal.siteDiagnosis.reserve, { siteId, trigger: `link_prepare:${Math.floor(Date.now() / (7 * 86_400_000))}:${Date.now()}`,
    reservedMicroUsd: PREPARE_HOLD_MICRO_USD });
  const paid = hold.ok && Boolean(process.env.ANTHROPIC_API_KEY);
  const anthropic = paid ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000, fetch }) : null;
  const suppressed = new Set(site.suppressed);
  const deadline = Date.now() + PREPARE_TIME_MS;
  let spent = 0;
  const results = [];
  for (const o of site.fresh) {
    if (Date.now() > deadline) break;
    try {
      const fetched = await fetchPage(o.url);
      const read = readListingPage(fetched.text, fetched.url, { competitors: o.linksTo, siteDomain: site.domain, language: site.language });
      if (!read.ok) { results.push({ id: o.id, status: read.linksToSite ? "won" as const : "skipped" as const, note: read.reason }); continue; }
      // Who runs the page: an address it publishes, else one on its contact or about page (never a guessed address).
      let contact = selectBestContact(extractContactCandidates({ html: fetched.text, siteDomain: o.domain }));
      for (const url of contactDiscoveryUrls({ sourceUrl: o.url, siteDomain: o.domain, limit: 4 }).slice(1)) {
        if (contact) break;
        try { const page = await fetchPage(url); contact = selectBestContact(extractContactCandidates({ html: page.text, siteDomain: o.domain })); } catch { /* next */ }
      }
      if (!contact) { results.push({ id: o.id, status: "no_contact" as const, title: read.title, kind: read.kind, note: "No published email address on the site" }); continue; }
      if (suppressed.has(contact.email)) { results.push({ id: o.id, status: "skipped" as const, title: read.title, note: "That address asked not to be emailed" }); continue; }
      const target = pitchTarget({ kind: read.kind, title: read.title }, { name: site.name, homeUrl: site.homeUrl, articles: site.articles });
      if (!anthropic) { results.push({ id: o.id, status: "no_contact" as const, title: read.title, kind: read.kind, contact: { email: contact.email, source: contact.discoveryMethod },
        target, note: "The email waits for the next week's budget" }); continue; }
      const request = pitchRequest({ sender: site.senderName, site: { name: site.name, domain: site.domain, summary: site.summary },
        their: { url: o.url, title: read.title, kind: read.kind, excerpt: read.excerpt, competitors: read.competitorLinks }, ours: { ...target, summary: site.summary } });
      let input: unknown = null, cost = PITCH_CALL_MAX_MICRO_USD;
      try {
        const response = await anthropic.messages.create({ model: BUYER_FIT_MODEL, max_tokens: PITCH_MAX_TOKENS, system: request.system,
          messages: [{ role: "user", content: request.userMessage }],
          tools: [{ name: PITCH_TOOL, description: "Record the email.", input_schema: request.inputSchema, strict: true }],
          tool_choice: structuredToolChoice(BUYER_FIT_MODEL, PITCH_TOOL) });
        cost = buyerFitCostMicroUsd(response.usage);
        const tool = response.content.find((b) => b.type === "tool_use" && b.name === PITCH_TOOL);
        input = tool && tool.type === "tool_use" ? tool.input : null;
      } catch { /* charged at its bound; the page waits for next week */ }
      spent += cost;
      const checked = input ? checkPitch(input, { ourUrl: target.url, theirTitle: read.title, facts: `${site.summary}\n${target.title}\n${read.excerpt}` }) : null;
      if (!checked?.ok) { results.push({ id: o.id, status: "skipped" as const, title: read.title, kind: read.kind, contact: { email: contact.email, source: contact.discoveryMethod },
        target, note: checked ? `The email failed a check: ${checked.reason}` : "The email wasn't written" }); continue; }
      results.push({ id: o.id, status: "ready" as const, title: read.title, linksTo: read.competitorLinks, kind: read.kind, contact: { email: contact.email, source: contact.discoveryMethod }, target,
        pitch: { subject: checked.subject, body: checked.body, writtenAt: Date.now(), costMicroUsd: cost } });
    } catch (error) {
      results.push({ id: o.id, status: "skipped" as const, note: `The page couldn't be read (${String(error instanceof Error ? error.message : error).slice(0, 100)})` });
    }
  }
  if (hold.ok) await ctx.runMutation(internal.siteDiagnosis.close, { siteId, reservationId: hold.reservationId, sent: spent > 0, actualMicroUsd: spent });
  const recorded = await ctx.runMutation(internal.linkOpportunities.recordPrepared, { siteId, results });
  return { checked: checks.length, prepared: results.length, ready: recorded.ready, costMicroUsd: spent };
} });

/** P369: switching link building on finds the pages at once (one DataForSEO request under a $0.05 hold, from the latest
 * diagnosis's page one), records them and starts the preparation; the weekly diagnosis does the same from then on. */
const FIND_HOLD_MICRO_USD = 50_000;
export const findNow = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<{ found: number; note?: string }> => {
  const site = await ctx.runQuery(internal.linkOpportunities.findContext, { siteId });
  if (!site) return { found: 0, note: "link building is off" };
  const competitors = linkCompetitors(site.pageOne, site.domain);
  let pages: ListingPage[] = [];
  if (competitors.length >= 2) {
    const hold = await ctx.runMutation(internal.siteDiagnosis.reserve, { siteId, trigger: `link_find:${Date.now()}`, reservedMicroUsd: FIND_HOLD_MICRO_USD });
    if (hold.ok) {
      let spent = 0, uncertain = false;
      try {
        const metered = await meterDataForSeoCost(() => pageIntersection(pageIntersectionRequest(competitors, site.domain)));
        spent = Math.ceil(metered.usd * 1e6); uncertain = metered.uncertain;
        pages = parsePageIntersection(metered.result, competitors, site.domain);
      } catch { /* nothing found this time: the weekly run tries again */ }
      if (!uncertain) await ctx.runMutation(internal.siteDiagnosis.close, { siteId, reservationId: hold.reservationId, sent: spent > 0, actualMicroUsd: spent });
    }
  }
  const all = [...pages, ...aiCitedPages(site.aiPages, site.domain, competitors)];
  if (all.length) await ctx.runMutation(internal.linkOpportunities.record, { siteId, pages: all });
  await ctx.scheduler.runAfter(0, internal.actions.linkOutreach.prepare, { siteId });
  return { found: all.length };
} });

type Mailbox = { id: Id<"link_mailboxes">; email: string; senderName: string; postalAddress: string; smtp: { host: string; port: number };
  imap: { host: string; port: number }; credentials: EncryptedOutreachCredentials };
async function secretsOf(siteId: Id<"sites">, mailbox: Mailbox) {
  return await decryptOutreachCredentials({ encrypted: mailbox.credentials, binding: mailboxBinding(siteId, mailbox.email),
    key: outreachCredentialKeyConfig(process.env, mailbox.credentials.credentialKeyId) });
}
const transportFor = (mailbox: Mailbox, password: string) => nodemailer.createTransport({
  ...smtpTransportOptions({ host: mailbox.smtp.host, port: mailbox.smtp.port, username: mailbox.email, password, fromEmail: mailbox.email }),
  connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
const imapFor = (mailbox: Mailbox, password: string) => new ImapFlow({ host: mailbox.imap.host, port: mailbox.imap.port, secure: true,
  auth: { user: mailbox.email, pass: password }, logger: false, socketTimeout: 20_000, greetingTimeout: 10_000 });

export const verifyMailbox = internalAction({ args: { siteId: v.id("sites"), mailboxId: v.id("link_mailboxes") }, handler: async (ctx, { siteId, mailboxId }): Promise<void> => {
  const context = await ctx.runQuery(internal.linkOpportunities.mailboxForCheck, { siteId, mailboxId });
  if (!context) return;
  let note: string | undefined;
  try {
    const secrets = await secretsOf(siteId, context);
    const transport = transportFor(context, secrets.smtpPassword);
    try { await transport.verify(); } finally { transport.close(); }
    const imap = imapFor(context, secrets.imapPassword);
    try { await imap.connect(); } finally { if (imap.usable) await imap.logout().catch(() => undefined); }
  } catch (error) {
    note = classifySmtpFailure(error instanceof Error ? error.message : "unknown").operatorMessage;
  }
  await ctx.runMutation(internal.linkOpportunities.mailboxChecked, { siteId, mailboxId, ok: !note, ...(note ? { note } : {}) });
} });

/** Reads the mailbox for answers to the contacted pages: a reply from a contacted address (an opt-out when it asks to
 * stop), or a bounce that names it. Bounded: only those addresses, only since each was first written to. */
async function readInbox(mailbox: Mailbox, password: string, contacted: ReadonlyArray<{ id: Id<"link_opportunities">; email: string; since: number }>) {
  const events: Array<{ id: Id<"link_opportunities">; kind: "reply" | "opt_out" | "bounce" }> = [];
  if (!contacted.length) return events;
  const imap = imapFor(mailbox, password);
  await imap.connect();
  const lock = await imap.getMailboxLock("INBOX");
  try {
    const earliest = new Date(Math.min(...contacted.map((c) => c.since)) - 86_400_000);
    for (const c of contacted) {
      const uids = await imap.search({ from: c.email, since: new Date(c.since - 86_400_000) }, { uid: true });
      if (!uids || !uids.length) continue;
      let optOut = false;
      for await (const message of imap.fetch(uids.slice(-3), { source: { maxLength: 64_000 } }, { uid: true })) {
        if (requestsOutreachOptOut(String(message.source ?? ""))) optOut = true;
      }
      events.push({ id: c.id, kind: optOut ? "opt_out" : "reply" });
    }
    const answered = new Set(events.map((e) => e.id));
    for (const from of ["mailer-daemon", "postmaster"]) {
      const uids = await imap.search({ from, since: earliest }, { uid: true });
      if (!uids || !uids.length) continue;
      for await (const message of imap.fetch(uids.slice(-20), { source: { maxLength: 64_000 } }, { uid: true })) {
        const text = String(message.source ?? "").toLowerCase();
        for (const c of contacted) if (!answered.has(c.id) && text.includes(c.email)) { events.push({ id: c.id, kind: "bounce" }); answered.add(c.id); }
      }
    }
  } finally {
    lock.release();
    await imap.logout().catch(() => undefined);
  }
  return events;
}

export const sendNext = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<SendResult> => {
  const turn = await ctx.runQuery(internal.linkOpportunities.sendContext, { siteId });
  if (!turn) return { sent: false, reason: "sending is off or the mailbox isn't ready" };
  const now = Date.now();
  let error: string | undefined, sent = false;
  try {
    const secrets = await secretsOf(siteId, turn.mailbox);
    // Answers first: a reply, bounce or opt-out stops that page's follow-up and holds the address.
    const events = await readInbox(turn.mailbox, secrets.imapPassword, turn.contacted);
    if (events.length) await ctx.runMutation(internal.linkOpportunities.recordInbox, { siteId, events });
    const fresh = events.length ? await ctx.runQuery(internal.linkOpportunities.sendContext, { siteId }) : turn;
    const next = fresh?.next;
    const at = nextSendAt(now, turn.sentAt);
    if (next && at <= now + 60_000) {
      const domain = turn.mailbox.email.split("@")[1];
      const messageId = `<pentra-link-${randomUUID()}@${domain}>`;
      // The send is recorded as attempted before it goes out: an attempt with no receipt is never sent again.
      const claim = await ctx.runMutation(internal.linkOpportunities.claimSend, { siteId, id: next.id, kind: next.kind, messageId });
      if (claim.ok) {
        const body = next.kind === "follow_up" ? followUpEmail({ theirTitle: next.theirTitle, ourTitle: next.ourTitle, firstName: turn.mailbox.senderName.split(" ")[0] }).body : next.body;
        const transport = transportFor(turn.mailbox, secrets.smtpPassword);
        try {
          const info = await transport.sendMail({ from: { name: turn.mailbox.senderName, address: turn.mailbox.email }, to: next.to,
            subject: next.kind === "follow_up" ? `Re: ${next.subject}` : next.subject,
            text: body + emailFooter({ name: turn.mailbox.senderName, site: turn.site.name, postalAddress: turn.mailbox.postalAddress }),
            messageId, ...(next.kind === "follow_up" && next.inReplyTo ? { inReplyTo: next.inReplyTo, references: next.inReplyTo } : {}) });
          if (!Array.isArray(info.accepted) || !info.accepted.length) throw new Error("The mailbox didn't accept the email");
          await ctx.runMutation(internal.linkOpportunities.recordSend, { siteId, id: next.id, kind: next.kind, messageId });
          sent = true;
        } catch (sendError) {
          error = sendError instanceof Error ? sendError.message : String(sendError);
          // Refused before acceptance: nothing went out, so the attempt is cleared and tried at the next turn.
          await ctx.runMutation(internal.linkOpportunities.releaseSend, { siteId, id: next.id, messageId, note: classifySmtpFailure(error).operatorMessage });
        } finally { transport.close(); }
      }
    }
  } catch (turnError) { error = turnError instanceof Error ? turnError.message : String(turnError); }
  // The next turn: at once (paced) when an email is waiting, else when the next follow-up falls due, else asleep until new work.
  const after = await ctx.runQuery(internal.linkOpportunities.sendContext, { siteId });
  const nextAt = !after ? null : after.next ? nextSendAt(Date.now(), after.sentAt)
    : after.nextFollowUpAt !== null ? nextSendAt(Math.max(Date.now(), after.nextFollowUpAt), after.sentAt) : null;
  await ctx.runMutation(internal.linkOpportunities.sendTurnDone, { siteId, nextAt, ...(error ? { error: error.slice(0, 300) } : {}) });
  return { sent, nextAt, ...(error ? { error: error.slice(0, 200) } : {}) };
} });

