import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { FREE_CHECK_CACHE_MS, FREE_CHECK_DAILY_CAP_MICRO_USD, FREE_CHECK_EMAIL_ADDRESS_DAILY_LIMIT, FREE_CHECK_EMAIL_DAILY_LIMIT,
  FREE_CHECK_EMAIL_VISITOR_DAILY_LIMIT, FREE_CHECK_EVENT_DAILY_LIMIT, FREE_CHECK_FAILED_RETRY_MS, FREE_CHECK_IP_DAILY_LIMIT,
  FREE_CHECK_RESERVATION_MICRO_USD, FREE_CHECK_RUNNING_MS, FREE_CHECK_VERSION, freeCheckDay, freeCheckDomain, freeCheckReportEmail,
  freeCheckView } from "./lib/missedSearches";
import { plausibleEmail, sendCustomerEmail } from "./lib/customerEmail";

/** The free Missed Searches Checker (P122, Oct 20 2026). pentra.dev's
 * /api/check route calls `request` and `track` through the internal HTTP API
 * with an HMAC of the visitor's IP and the day; the result page reads `get`.
 * Paid work runs only after the day's spend cap and the visitor's limit
 * allow it, and every check's worst case is held until its real cost is
 * known. A finished check is reused for a week. */

const issue = v.object({ code: v.string(), severity: v.union(v.literal("critical"), v.literal("warning")), message: v.string() });
export const missedRow = v.object({ keyword: v.string(), searchVolume: v.number(), difficulty: v.number(), variants: v.optional(v.number()) });
export const almostRow = v.object({ keyword: v.string(), searchVolume: v.number(), position: v.number(), url: v.string(), variants: v.optional(v.number()) });
export const unrankedRow = v.object({ keyword: v.string(), searchVolume: v.number(), url: v.string(), variants: v.optional(v.number()) });
const outcome = v.union(
  v.object({ kind: v.literal("done"), businessName: v.string(), countryName: v.string(), summary: v.string(), places: v.array(v.string()),
    missed: v.array(missedRow), almost: v.array(almostRow), unranked: v.array(unrankedRow),
    health: v.object({ passed: v.number(), total: v.number(), issues: v.array(issue) }),
    keywordsUnavailable: v.boolean() }),
  v.object({ kind: v.literal("failed"), error: v.string(), refund: v.optional(v.boolean()) }),
);
export const checkDiagnostics = v.object({ seedSource: v.union(v.literal("model"), v.literal("homepage")), seeds: v.array(v.string()),
  topics: v.optional(v.array(v.string())), sample: v.optional(v.array(v.object({ keyword: v.string(), keep: v.boolean(), reason: v.string() }))),
  discovered: v.number(), ranked: v.number(), judged: v.number(), kept: v.number(),
  places: v.optional(v.array(v.string())), freePlan: v.optional(v.string()), coverage: v.optional(v.union(v.literal("model"), v.literal("words"))),
  pagesRead: v.optional(v.number()), rankCheck: v.optional(v.union(v.literal("verified"), v.literal("partial"))) });

async function counter(ctx: MutationCtx, key: string) {
  return ctx.db.query("free_check_quota").withIndex("by_key", q => q.eq("key", key)).first();
}

/** Visitor counters are useless after their day: a few are removed per
 * request (the day's spend rows are cost history and are kept). */
async function trimVisitorCounters(ctx: MutationCtx, day: string) {
  for (const kind of ["visitor", "events", "emails", "address"] as const) {
    const old = await ctx.db.query("free_check_quota").withIndex("by_kind_day", q => q.eq("kind", kind).lt("day", day)).take(10);
    for (const row of old) await ctx.db.delete(row._id);
  }
}

/** Start a check, or answer from the cache. */
export const request = internalMutation({ args: { domain: v.string(), visitor: v.string() }, handler: async (ctx, args) => {
  const domain = freeCheckDomain(args.domain);
  if (!domain) return { status: "invalid" as const, domain: null };
  const now = Date.now(), day = freeCheckDay(now);
  const existing = await ctx.db.query("free_checks").withIndex("by_domain", q => q.eq("domain", domain)).first();
  if (existing) {
    const age = now - (existing.completedAt ?? existing.requestedAt);
    const reuse = existing.status === "running" ? now - existing.requestedAt < FREE_CHECK_RUNNING_MS
      : existing.status === "done" ? age < FREE_CHECK_CACHE_MS && existing.version === FREE_CHECK_VERSION : age < FREE_CHECK_FAILED_RETRY_MS;
    if (reuse) {
      if (existing.status === "done") await ctx.db.insert("acquisition_events", { kind: "check_cached", source: "free_check", domain, at: now });
      return { status: existing.status, domain };
    }
  }
  const visitorKey = `visitor:${args.visitor}`, spendKey = `spend:${day}`;
  const visitor = await counter(ctx, visitorKey);
  if ((visitor?.count ?? 0) >= FREE_CHECK_IP_DAILY_LIMIT) return { status: "limited" as const, domain };
  const spend = await counter(ctx, spendKey);
  if ((spend?.microUsd ?? 0) + FREE_CHECK_RESERVATION_MICRO_USD > FREE_CHECK_DAILY_CAP_MICRO_USD) return { status: "paused" as const, domain };
  // The check's worst case is held before any paid call; the run settles it.
  if (spend) await ctx.db.patch(spend._id, { count: spend.count + 1, microUsd: (spend.microUsd ?? 0) + FREE_CHECK_RESERVATION_MICRO_USD });
  else await ctx.db.insert("free_check_quota", { kind: "spend", key: spendKey, day, count: 1, microUsd: FREE_CHECK_RESERVATION_MICRO_USD });
  if (visitor) await ctx.db.patch(visitor._id, { count: visitor.count + 1 });
  else await ctx.db.insert("free_check_quota", { kind: "visitor", key: visitorKey, day, count: 1 });
  const fresh = { status: "running" as const, requestedAt: now, step: "Reading your homepage" };
  let checkId: Id<"free_checks">;
  if (existing) {
    checkId = existing._id;
    await ctx.db.patch(checkId, { ...fresh, completedAt: undefined, error: undefined, businessName: undefined, countryName: undefined,
      missed: undefined, almost: undefined, unranked: undefined, summary: undefined, places: undefined,
      health: undefined, keywordsUnavailable: undefined, costMicroUsd: undefined, costUncertain: undefined,
      version: undefined, diagnostics: undefined });
  } else checkId = await ctx.db.insert("free_checks", { domain, ...fresh });
  await ctx.db.insert("acquisition_events", { kind: "check_started", source: "free_check", domain, at: now });
  await ctx.scheduler.runAfter(0, internal.actions.freeCheck.run, { checkId, domain, requestedAt: now, day,
    reservedMicroUsd: FREE_CHECK_RESERVATION_MICRO_USD, visitor: args.visitor });
  await trimVisitorCounters(ctx, day);
  return { status: "running" as const, domain };
} });

/** How many new checks this network has left today (shown before anyone
 * types a domain); 0 also when today's free checks are paused. */
export const quotaFor = internalQuery({ args: { visitor: v.string() }, handler: async (ctx, { visitor }) => {
  const day = freeCheckDay(Date.now());
  const [used, spend] = await Promise.all([
    ctx.db.query("free_check_quota").withIndex("by_key", q => q.eq("key", `visitor:${visitor}`)).first(),
    ctx.db.query("free_check_quota").withIndex("by_key", q => q.eq("key", `spend:${day}`)).first(),
  ]);
  const paused = (spend?.microUsd ?? 0) + FREE_CHECK_RESERVATION_MICRO_USD > FREE_CHECK_DAILY_CAP_MICRO_USD;
  return { remaining: paused ? 0 : Math.max(0, FREE_CHECK_IP_DAILY_LIMIT - (used?.count ?? 0)), paused };
} });

/** What the running check is doing, for the result page. */
export const progress = internalMutation({ args: { checkId: v.id("free_checks"), requestedAt: v.number(), step: v.string() },
  handler: async (ctx, { checkId, requestedAt, step }) => {
    const row = await ctx.db.get(checkId);
    if (row?.status === "running" && row.requestedAt === requestedAt) await ctx.db.patch(checkId, { step });
  } });

/** Record the outcome and settle the day's spend at the real cost (the whole
 * hold stays counted when a paid call's cost is uncertain). A run that a
 * newer one replaced writes nothing but its cost. */
export const complete = internalMutation({ args: { checkId: v.id("free_checks"), requestedAt: v.number(), day: v.string(),
  reservedMicroUsd: v.number(), costMicroUsd: v.number(), costUncertain: v.boolean(), outcome, diagnostics: v.optional(checkDiagnostics),
  visitor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const spend = await counter(ctx, `spend:${args.day}`);
    const settled = args.costUncertain ? Math.max(args.costMicroUsd, args.reservedMicroUsd) : args.costMicroUsd;
    if (spend) await ctx.db.patch(spend._id, { microUsd: Math.max(0, (spend.microUsd ?? 0) - args.reservedMicroUsd + settled) });
    // A website that couldn't be read cost nothing and isn't the visitor's
    // doing: the check doesn't count against their network's daily checks.
    if (args.outcome.kind === "failed" && args.outcome.refund && args.visitor && args.day === freeCheckDay(Date.now())) {
      const used = await counter(ctx, `visitor:${args.visitor}`);
      if (used && used.count > 0) await ctx.db.patch(used._id, { count: used.count - 1 });
    }
    const row = await ctx.db.get(args.checkId);
    if (!row || row.status !== "running" || row.requestedAt !== args.requestedAt) return;
    const cost = { costMicroUsd: settled, costUncertain: args.costUncertain, completedAt: Date.now(), step: undefined,
      version: FREE_CHECK_VERSION, ...(args.diagnostics ? { diagnostics: args.diagnostics } : {}) };
    if (args.outcome.kind === "failed") await ctx.db.patch(args.checkId, { status: "failed", error: args.outcome.error, ...cost });
    else {
      const done = args.outcome;
      await ctx.db.patch(args.checkId, { status: "done", businessName: done.businessName, countryName: done.countryName,
        summary: done.summary || undefined, places: done.places, missed: done.missed, almost: done.almost, unranked: done.unranked,
        health: done.health, keywordsUnavailable: done.keywordsUnavailable, ...cost });
    }
  } });

/** A check's result page. Signed-out visitors get the first missed searches
 * and the number of the rest; a signed-in visitor gets all of them. */
export const get = query({ args: { domain: v.string() }, handler: async (ctx, args) => {
  const domain = freeCheckDomain(args.domain);
  if (!domain) return null;
  const row = await ctx.db.query("free_checks").withIndex("by_domain", q => q.eq("domain", domain)).first();
  if (!row) return null;
  return freeCheckView(row, (await ctx.auth.getUserIdentity()) !== null);
} });

/** A signup click from a result page (bounded per visitor and day). */
export const track = internalMutation({ args: { kind: v.literal("signup_click"), domain: v.optional(v.string()), visitor: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now(), day = freeCheckDay(now), key = `events:${args.visitor}`;
    const row = await counter(ctx, key);
    if ((row?.count ?? 0) >= FREE_CHECK_EVENT_DAILY_LIMIT) return { recorded: false };
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("free_check_quota", { kind: "events", key, day, count: 1 });
    const domain = args.domain ? freeCheckDomain(args.domain) ?? undefined : undefined;
    await ctx.db.insert("acquisition_events", { kind: args.kind, source: "free_check", ...(domain ? { domain } : {}), at: now });
    return { recorded: true };
  } });

/** One report email: the check has missed searches, and the visitor's, the
 * address's and the day's limits allow it. Returns the email to send. */
export const claimReport = internalMutation({ args: { domain: v.string(), emailKey: v.string(), visitor: v.string() },
  handler: async (ctx, args) => {
    const domain = freeCheckDomain(args.domain);
    const row = domain ? await ctx.db.query("free_checks").withIndex("by_domain", q => q.eq("domain", domain)).first() : null;
    if (!row || row.status !== "done" || !row.missed?.length) return { status: "no_result" as const };
    const day = freeCheckDay(Date.now());
    const limits = [
      { kind: "emails" as const, key: `emails:${args.visitor}`, max: FREE_CHECK_EMAIL_VISITOR_DAILY_LIMIT },
      { kind: "address" as const, key: `address:${args.emailKey}`, max: FREE_CHECK_EMAIL_ADDRESS_DAILY_LIMIT },
      { kind: "email_total" as const, key: `email_total:${day}`, max: FREE_CHECK_EMAIL_DAILY_LIMIT },
    ];
    const counters = await Promise.all(limits.map(limit => counter(ctx, limit.key)));
    if (limits.some((limit, i) => (counters[i]?.count ?? 0) >= limit.max)) return { status: "limited" as const };
    for (const [i, limit] of limits.entries()) {
      const row = counters[i];
      if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
      else await ctx.db.insert("free_check_quota", { kind: limit.kind, key: limit.key, day, count: 1 });
    }
    return { status: "ok" as const, ...freeCheckReportEmail(row) };
  } });

/** An emailed report, counted by checked domain. */
export const recordReport = internalMutation({ args: { domain: v.string() }, handler: async (ctx, args) => {
  const domain = freeCheckDomain(args.domain);
  if (domain) await ctx.db.insert("acquisition_events", { kind: "report_emailed", source: "free_check", domain, at: Date.now() });
} });

/** Email a check's full report to the address the visitor typed (P123). The
 * address is used for this one send and never stored. */
export const emailReport = internalAction({ args: { domain: v.string(), email: v.string(), emailKey: v.string(), visitor: v.string() },
  handler: async (ctx, args): Promise<{ status: "sent" | "failed" | "limited" | "no_result" | "invalid" }> => {
    const email = plausibleEmail(args.email);
    if (!email) return { status: "invalid" };
    const claim = await ctx.runMutation(internal.freeCheck.claimReport, { domain: args.domain, emailKey: args.emailKey, visitor: args.visitor });
    if (claim.status !== "ok") return { status: claim.status };
    const sent = await sendCustomerEmail({ to: email, subject: claim.subject, text: claim.text });
    if (!sent.sent) {
      console.warn(`Free check report not sent: ${sent.error ?? "unknown"}`);
      return { status: "failed" };
    }
    await ctx.runMutation(internal.freeCheck.recordReport, { domain: args.domain });
    return { status: "sent" };
  } });

/** A signed-in owner who came from a free check saved that website: counted
 * once per website, and only when the account really has it. */
export const recordSignup = mutation({ args: { domain: v.string() }, handler: async (ctx, args) => {
  const identity = await ctx.auth.getUserIdentity();
  const domain = freeCheckDomain(args.domain);
  if (!identity || !domain) return { recorded: false };
  const sites = await ctx.db.query("sites").withIndex("by_user", q => q.eq("userId", identity.subject)).take(50);
  if (!sites.some(site => freeCheckDomain(site.domain) === domain)) return { recorded: false };
  if (await ctx.db.query("acquisition_events").withIndex("by_kind_domain", q => q.eq("kind", "signup").eq("domain", domain)).first()) {
    return { recorded: false };
  }
  await ctx.db.insert("acquisition_events", { kind: "signup", source: "free_check", domain, at: Date.now() });
  return { recorded: true };
} });

/** One check's stages and cost (operator read): explains a thin result. */
export const diagnosticsFor = internalQuery({ args: { domain: v.string() }, handler: async (ctx, args) => {
  const domain = freeCheckDomain(args.domain);
  const row = domain ? await ctx.db.query("free_checks").withIndex("by_domain", q => q.eq("domain", domain)).first() : null;
  return row ? { domain: row.domain, status: row.status, version: row.version ?? 1, requestedAt: row.requestedAt, completedAt: row.completedAt ?? null,
    error: row.error ?? null, costMicroUsd: row.costMicroUsd ?? null, missed: row.missed?.length ?? 0, almost: row.almost?.length ?? 0,
    unranked: row.unranked?.length ?? 0, summary: row.summary ?? null, places: row.places ?? [],
    diagnostics: row.diagnostics ?? null } : null;
} });

/** The free tool's numbers since a time (operator read): checks run and
 * reused, their outcomes and cost, signup clicks and signups. */
export const numbers = internalQuery({ args: { since: v.number() }, handler: async (ctx, { since }) => {
  const events = await ctx.db.query("acquisition_events").withIndex("by_at", q => q.gte("at", since)).take(10_000);
  const count = (kind: string) => events.filter(e => e.kind === kind).length;
  const checks = await ctx.db.query("free_checks").withIndex("by_requested", q => q.gte("requestedAt", since)).take(5_000);
  return {
    since, started: count("check_started"), reused: count("check_cached"), signupClicks: count("signup_click"), signups: count("signup"),
    reportsEmailed: count("report_emailed"),
    done: checks.filter(c => c.status === "done").length, failed: checks.filter(c => c.status === "failed").length,
    running: checks.filter(c => c.status === "running").length,
    withResults: checks.filter(c => c.status === "done" && (c.missed?.length ?? 0) > 0).length,
    costUsd: checks.reduce((sum, c) => sum + (c.costMicroUsd ?? 0), 0) / 1_000_000,
  };
} });
