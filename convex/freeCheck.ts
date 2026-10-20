import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { FREE_CHECK_CACHE_MS, FREE_CHECK_DAILY_CAP_MICRO_USD, FREE_CHECK_EVENT_DAILY_LIMIT, FREE_CHECK_FAILED_RETRY_MS,
  FREE_CHECK_IP_DAILY_LIMIT, FREE_CHECK_RESERVATION_MICRO_USD, FREE_CHECK_RUNNING_MS, freeCheckDay, freeCheckDomain,
  freeCheckView } from "./lib/missedSearches";

/** The free Missed Searches Checker (P122, Oct 20 2026). pentra.dev's
 * /api/check route calls `request` and `track` through the internal HTTP API
 * with an HMAC of the visitor's IP and the day; the result page reads `get`.
 * Paid work runs only after the day's spend cap and the visitor's limit
 * allow it, and every check's worst case is held until its real cost is
 * known. A finished check is reused for a week. */

const issue = v.object({ code: v.string(), severity: v.union(v.literal("critical"), v.literal("warning")), message: v.string() });
const outcome = v.union(
  v.object({ kind: v.literal("done"), businessName: v.string(), countryName: v.string(),
    missed: v.array(v.object({ keyword: v.string(), searchVolume: v.number(), difficulty: v.number() })),
    almost: v.array(v.object({ keyword: v.string(), searchVolume: v.number(), position: v.number(), url: v.string() })),
    health: v.object({ passed: v.number(), total: v.number(), issues: v.array(issue) }),
    keywordsUnavailable: v.boolean() }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
);

async function counter(ctx: MutationCtx, key: string) {
  return ctx.db.query("free_check_quota").withIndex("by_key", q => q.eq("key", key)).first();
}

/** Visitor counters are useless after their day: a few are removed per
 * request (the day's spend rows are cost history and are kept). */
async function trimVisitorCounters(ctx: MutationCtx, day: string) {
  for (const kind of ["visitor", "events"] as const) {
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
      : existing.status === "done" ? age < FREE_CHECK_CACHE_MS : age < FREE_CHECK_FAILED_RETRY_MS;
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
      missed: undefined, almost: undefined, health: undefined, keywordsUnavailable: undefined, costMicroUsd: undefined, costUncertain: undefined });
  } else checkId = await ctx.db.insert("free_checks", { domain, ...fresh });
  await ctx.db.insert("acquisition_events", { kind: "check_started", source: "free_check", domain, at: now });
  await ctx.scheduler.runAfter(0, internal.actions.freeCheck.run, { checkId, domain, requestedAt: now, day,
    reservedMicroUsd: FREE_CHECK_RESERVATION_MICRO_USD });
  await trimVisitorCounters(ctx, day);
  return { status: "running" as const, domain };
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
  reservedMicroUsd: v.number(), costMicroUsd: v.number(), costUncertain: v.boolean(), outcome },
  handler: async (ctx, args) => {
    const spend = await counter(ctx, `spend:${args.day}`);
    const settled = args.costUncertain ? Math.max(args.costMicroUsd, args.reservedMicroUsd) : args.costMicroUsd;
    if (spend) await ctx.db.patch(spend._id, { microUsd: Math.max(0, (spend.microUsd ?? 0) - args.reservedMicroUsd + settled) });
    const row = await ctx.db.get(args.checkId);
    if (!row || row.status !== "running" || row.requestedAt !== args.requestedAt) return;
    const cost = { costMicroUsd: settled, costUncertain: args.costUncertain, completedAt: Date.now(), step: undefined };
    if (args.outcome.kind === "failed") await ctx.db.patch(args.checkId, { status: "failed", error: args.outcome.error, ...cost });
    else {
      const done = args.outcome;
      await ctx.db.patch(args.checkId, { status: "done", businessName: done.businessName, countryName: done.countryName,
        missed: done.missed, almost: done.almost, health: done.health, keywordsUnavailable: done.keywordsUnavailable, ...cost });
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

/** The free tool's numbers since a time (operator read): checks run and
 * reused, their outcomes and cost, signup clicks and signups. */
export const numbers = internalQuery({ args: { since: v.number() }, handler: async (ctx, { since }) => {
  const events = await ctx.db.query("acquisition_events").withIndex("by_at", q => q.gte("at", since)).take(10_000);
  const count = (kind: string) => events.filter(e => e.kind === kind).length;
  const checks = await ctx.db.query("free_checks").withIndex("by_requested", q => q.gte("requestedAt", since)).take(5_000);
  return {
    since, started: count("check_started"), reused: count("check_cached"), signupClicks: count("signup_click"), signups: count("signup"),
    done: checks.filter(c => c.status === "done").length, failed: checks.filter(c => c.status === "failed").length,
    running: checks.filter(c => c.status === "running").length,
    withResults: checks.filter(c => c.status === "done" && (c.missed?.length ?? 0) > 0).length,
    costUsd: checks.reduce((sum, c) => sum + (c.costMicroUsd ?? 0), 0) / 1_000_000,
  };
} });
