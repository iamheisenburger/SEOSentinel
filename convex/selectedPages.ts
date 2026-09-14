import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { confirmedContentProfileHash, contentConnectionHash, assertUnprotectedPage, selectedUrlMatches,
  CONTENT_PAGE_COOLDOWN_MS, CONTENT_PAGE_REVIEW_MS } from "./lib/contentSelection";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { accountDeletionKey } from "./lib/accountDeletion";
import { takeCurrentGscQueryRows } from "./lib/currentGscRows";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals } from "./lib/autopilotBuffer";
import { siteCanonicalDomain, siteCanonicalDomainRevision } from "./lib/siteDomainBinding";

async function owner(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || identity?.subject !== site.userId) throw new Error("Not authorized");
  return site;
}
export function selectionConnection(site: Doc<"sites">) {
  if (!site.userId || !["github","wordpress"].includes(site.publishMethod ?? "") ||
    !publisherDestinationReceiptVerified({ site, ownerAccountKey: accountDeletionKey(site.userId) })) throw new Error("Verify the current publishing destination before selecting pages");
}
export const selectionContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await owner(ctx, siteId); selectionConnection(site); return site;
} });
export const list = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  await owner(ctx, siteId);
  const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501);
  return { complete: rows.length <= 500, pages: rows.filter(p => p.editable).map(p => ({ id: p._id, url: p.url,
    title: p.title, active: p.editable!.active, selectedAt: p.editable!.selectedAt, lastImprovedAt: p.editable!.lastImprovedAt,
    latestRevisionId: p.editable!.latestRevisionId, revocationStatus: p.editable!.revocationStatus, sourceRevision: p.editable!.sourceRevision })) };
} });
const imported = v.object({ kind: v.union(v.literal("github"), v.literal("wordpress")), path: v.optional(v.string()),
  resourceId: v.optional(v.number()), permission: v.optional(v.string()), slug: v.string(), url: v.string(),
  sourceRevision: v.string(), sourceContent: v.string(), markdown: v.string(), title: v.string(), metaTitle: v.string(),
  description: v.string(), header: v.optional(v.string()) });
export const recordSelection = internalMutation({ args: { siteId: v.id("sites"), connectionHash: v.string(), profileHash: v.string(), source: imported },
  handler: async (ctx, args) => {
    const site = await owner(ctx, args.siteId); selectionConnection(site);
    if (contentConnectionHash(site) !== args.connectionHash || confirmedContentProfileHash(site) !== args.profileHash ||
      site.publishMethod !== args.source.kind || !selectedUrlMatches(site, args.source.slug, args.source.url)) throw new Error("Selection binding changed");
    assertUnprotectedPage(args.source.slug, args.source.title, args.source.sourceContent);
    const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
    if (rows.length > 500) throw new Error("Selected-page inventory is incomplete");
    const matches = rows.filter(p => p.url === args.source.url);
    if (matches.length > 1) throw new Error("Selected-page inventory is ambiguous");
    const old = matches[0], { slug, url, ...source } = args.source;
    const editable = { ...source, version: (old?.editable?.version ?? 0) + 1, active: true,
      connectionHash: args.connectionHash, profileHash: args.profileHash, selectedAt: Date.now(),
      lastImprovedAt: old?.editable?.lastImprovedAt, latestRevisionId: old?.editable?.latestRevisionId };
    if (old) { await ctx.db.patch(old._id, { title: source.title, slug, editable }); return old._id; }
    return await ctx.db.insert("pages", { siteId: site._id, url, slug, title: source.title, editable,
      canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site), createdAt: Date.now() });
  } });
export const revoke = mutation({ args: { siteId: v.id("sites"), pageId: v.id("pages") }, handler: async (ctx, args) => {
  await owner(ctx, args.siteId); const page = await ctx.db.get(args.pageId);
  if (!page?.editable || page.siteId !== args.siteId) throw new Error("Selected page not found");
  await ctx.db.patch(page._id, { editable: { ...page.editable, active: false, version: page.editable.version + 1,
    revocationStatus: page.editable.kind === "wordpress" ? "pending" : "confirmed" } });
  if (page.editable.kind === "wordpress") await ctx.scheduler.runAfter(0, internal.actions.selectedPages.revokeRemote,
    { siteId: args.siteId, pageId: page._id, version: page.editable.version + 1 });
} });
export const revocationResult = internalMutation({ args: { siteId: v.id("sites"), pageId: v.id("pages"), version: v.number(),
  attempt: v.number(), ok: v.boolean() }, handler: async (ctx, args) => {
  const page = await ctx.db.get(args.pageId), e = page?.editable;
  if (!e || page?.siteId !== args.siteId || e.active || e.version !== args.version) return;
  const retry = !args.ok && args.attempt < 3;
  await ctx.db.patch(page._id, { editable: { ...e, revocationStatus: args.ok ? "confirmed" : retry ? "pending" : "failed" } });
  if (retry) await ctx.scheduler.runAfter(30_000 * args.attempt, internal.actions.selectedPages.revokeRemote,
    { siteId: args.siteId, pageId: args.pageId, version: args.version, attempt: args.attempt + 1 });
} });
export const revocationContext = internalQuery({ args: { siteId: v.id("sites"), pageId: v.id("pages"), version: v.number() }, handler: async (ctx, args) => {
  const site = await ctx.db.get(args.siteId), page = await ctx.db.get(args.pageId), e = page?.editable;
  if (!site || page?.siteId !== site._id || !e || e.active || e.version !== args.version || e.kind !== "wordpress" ||
    e.connectionHash !== contentConnectionHash(site)) return null;
  return { site, resourceId: e.resourceId, permission: e.permission };
} });

export async function authorizedWorkPage(ctx: QueryCtx | MutationCtx, site: Doc<"sites">, job: Doc<"jobs">) {
  const cw = job.contentWork;
  if (!cw || cw.intent !== "improve") return null;
  const page = cw.targetPageId ? await ctx.db.get(cw.targetPageId) : null, e = page?.editable;
  if (!page || !e?.active || page.siteId !== site._id || job.siteId !== site._id || e.version !== cw.permissionVersion ||
    e.sourceRevision !== cw.baseRevision || e.profileHash !== confirmedContentProfileHash(site) ||
    e.connectionHash !== contentConnectionHash(site) || !selectedUrlMatches(site, page.slug, page.url)) throw new Error("Selected-page permission, source or destination changed");
  assertUnprotectedPage(page.slug, e.title, e.sourceContent);
  return page;
}
export const workContext = internalQuery({ args: { siteId: v.id("sites"), jobId: v.optional(v.id("jobs")), articleId: v.optional(v.id("articles")) },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId); if (!site) throw new Error("Site not found");
    const matches = args.articleId ? await ctx.db.query("jobs").withIndex("by_site_article", q => q.eq("siteId", site._id).eq("articleId", args.articleId)).take(21) : [];
    if (matches.length > 20) throw new Error("Content work inventory incomplete");
    const job = args.jobId ? await ctx.db.get(args.jobId) : matches.find(j => j.contentWork?.intent === "improve");
    if (!job) return null;
    if (job.siteId !== site._id || (args.articleId && job.articleId !== args.articleId)) throw new Error("Not authorized");
    const page = await authorizedWorkPage(ctx, site, job);
    return page ? { job, page, site } : null;
  } });

/** Reuse the daily ingestion's exact tenant/date/epoch receipts. Weekly bounded
 * selection is discretionary; absent metrics do not veto unrelated creation. */
export async function chooseImprovement(ctx: MutationCtx, site: Doc<"sites">, jobs: Doc<"jobs">[]) {
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
  if (pages.length > 500) return null;
  const candidates = pages.filter(p => p.editable?.active && p.editable.connectionHash === contentConnectionHash(site) &&
    p.editable.profileHash === confirmedContentProfileHash(site) &&
    Date.now() - (p.editable.lastReviewedAt ?? 0) >= CONTENT_PAGE_REVIEW_MS &&
    Date.now() - (p.editable.lastImprovedAt ?? 0) >= CONTENT_PAGE_COOLDOWN_MS &&
    !jobs.some(j => j.contentWork?.targetPageId === p._id && !["verified","failed"].includes(j.contentWork.stage)));
  if (!candidates.length) return null;
  let measurements: Awaited<ReturnType<typeof takeCurrentGscQueryRows>>;
  try { measurements = await takeCurrentGscQueryRows(ctx, site, 1000); } catch { return null; }
  for (const page of candidates) {
    const e = page.editable!;
    await ctx.db.patch(page._id, { editable: { ...e, lastReviewedAt: Date.now() } });
    try { assertUnprotectedPage(page.slug, e.title, e.sourceContent); } catch { continue; }
    const rows = measurements.rows.filter(r => r.page === page.url && r.impressions > 0 &&
      !e.markdown.toLowerCase().includes(r.query.toLowerCase()) &&
      evaluateTopicBusinessFit({ keyword: r.query, label: e.title, ...tenantTopicBusinessSignals(site) }).eligible)
      .sort((a,b) => b.impressions - a.impressions);
    // An actual first-party reader question may be useful without Search Console.
    const question = rows[0]?.query ?? (site.painPoints ?? []).find(q => q.endsWith("?") &&
      !e.markdown.toLowerCase().includes(q.toLowerCase()) && evaluateTopicBusinessFit({ keyword: q, label: e.title, ...tenantTopicBusinessSignals(site) }).eligible);
    if (!question) continue;
    return { page, question, reason: rows[0] ? `Current Search Console query: ${question}; impressions=${rows[0].impressions}; date=${rows[0].date}. No claim of causal growth.`
      : `Confirmed first-party reader question: ${question}. Search metrics unavailable; do not invent them.` };
  }
  return null;
}
