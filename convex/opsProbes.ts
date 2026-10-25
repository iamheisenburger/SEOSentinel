import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/** Operator reads for V9 (Oct 24 2026): how large the documents are that the
 * product reads most often, as byte counts, stage labels and field names only
 * (never document content). Owner sites only, one call at a time. */
const bytes = (value: unknown) => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
function jobSize(job: Doc<"jobs">, nextDeadlineAt: number) {
  const cw = job.contentWork;
  return { stage: cw?.stage ?? null, status: job.status, intent: cw?.intent ?? null, operation: cw?.operation ?? null,
    future: (cw?.deadlineAt ?? 0) >= nextDeadlineAt, bytes: bytes(job), contentWork: bytes(cw), calls: cw?.providerCalls.length ?? 0,
    inlineResults: (cw?.providerCalls ?? []).reduce((sum, call) => sum + bytes(call.result), 0),
    payload: bytes(job.payload), result: bytes(job.result) };
}

/** The documents a full-buffer scheduler pass reads (contentWork:advance). */
export const schedulerReadSizes = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  const next = site.contentSchedule?.nextDeadlineAt ?? 0;
  const seen = new Map<string, Doc<"jobs">>();
  const keep = (rows: Doc<"jobs">[]) => { for (const row of rows) seen.set(row._id, row); };
  keep(await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", next)).take(50));
  for (const status of ["pending", "running"]) keep(await ctx.db.query("jobs").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", status)).take(50));
  for (const stage of ["verify", "ready"] as const) {
    keep(await ctx.db.query("jobs").withIndex("by_site_content_stage", q => q.eq("siteId", siteId).eq("contentWork.stage", stage)).take(50));
  }
  const fields = Object.entries(site).map(([field, value]) => ({ field, bytes: bytes(value) })).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
  const schedule = site.contentSchedule as Record<string, unknown> | undefined;
  const scheduleFields = Object.entries(schedule ?? {}).map(([field, value]) => ({ field, bytes: bytes(value) }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  return { siteBytes: bytes(site), siteFields: fields, scheduleFields, jobs: [...seen.values()].map(job => jobSize(job, next)) };
} });

/** What an article-preparation pass reads besides jobs: every page of the site
 * (chooseImprovement), the topic inventory (chooseTopic) and up to 3,000 Search
 * Console rows. Totals and the largest fields, per table, one table a call. */
export const siteTableSizes = internalQuery({ args: { siteId: v.id("sites"),
  table: v.union(v.literal("pages"), v.literal("topic_clusters"), v.literal("search_performance")) },
  handler: async (ctx, { siteId, table }) => {
    const rows: Record<string, unknown>[] = table === "pages"
      ? await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501)
      : table === "topic_clusters"
        ? await ctx.db.query("topic_clusters").withIndex("by_site", q => q.eq("siteId", siteId)).take(2001)
        : await ctx.db.query("search_performance").withIndex("by_site", q => q.eq("siteId", siteId)).take(3000);
    const fieldBytes = new Map<string, number>();
    for (const row of rows) for (const [field, value] of Object.entries(row)) {
      if (field === "editable" && value && typeof value === "object") {
        for (const [inner, innerValue] of Object.entries(value)) fieldBytes.set(`editable.${inner}`, (fieldBytes.get(`editable.${inner}`) ?? 0) + bytes(innerValue));
      } else fieldBytes.set(field, (fieldBytes.get(field) ?? 0) + bytes(value));
    }
    return { rows: rows.length, bytes: rows.reduce((sum, row) => sum + bytes(row), 0),
      largestFields: [...fieldBytes.entries()].map(([field, total]) => ({ field, bytes: total })).sort((a, b) => b.bytes - a.bytes).slice(0, 8) };
  } });

/** One page of a site's content jobs this month (what the usage recount reads):
 * totals only, split at P118 (Oct 20 2026), when provider results moved out of
 * job documents. */
export const monthJobSizes = internalQuery({ args: { siteId: v.id("sites"), monthStart: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { siteId, monthStart, cursor }) => {
    const page = await ctx.db.query("jobs").withIndex("by_site_content_deadline", q => q.eq("siteId", siteId).gte("contentWork.deadlineAt", monthStart))
      .paginate({ numItems: 16, cursor });
    const sizes = page.page.map(job => ({ ...jobSize(job, Number.MAX_SAFE_INTEGER), createdAt: job.createdAt }));
    return { isDone: page.isDone, continueCursor: page.continueCursor, jobs: sizes.length, bytes: sizes.reduce((s, j) => s + j.bytes, 0),
      inlineResults: sizes.reduce((s, j) => s + j.inlineResults, 0), largest: Math.max(0, ...sizes.map(j => j.bytes)),
      byIntent: sizes.reduce<Record<string, number>>((m, j) => ({ ...m, [`${j.intent}`]: (m[`${j.intent}`] ?? 0) + 1 }), {}) };
  } });
