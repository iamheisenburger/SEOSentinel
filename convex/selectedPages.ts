import { isApiCmsMethod } from "./lib/cmsDestinations";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { moneyPagesFirst, nearPageOne } from "./lib/moneyPages";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { confirmedContentProfileHash, contentConnectionHash, assertUnprotectedPage, selectedUrlMatches,
  CONTENT_PAGE_COOLDOWN_MS, CONTENT_PAGE_REVIEW_MS, parseSelectedMarkdown, selectedGitHubPath, targetedImprovement, contentWords, refreshInsertTarget } from "./lib/contentSelection";
import { contentIssue } from "./lib/contentCustomer";
import { publisherDestinationReceiptVerified } from "./lib/publisherProvisioning";
import { accountDeletionKey } from "./lib/accountDeletion";
import { takeCurrentGscQueryRows } from "./lib/currentGscRows";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals } from "./lib/autopilotBuffer";
import { siteCanonicalDomain, siteCanonicalDomainRevision } from "./lib/siteDomainBinding";
import { stripLeadingDocumentTitle } from "./lib/markdownPublishing";
import { publicationDeliveryConfig } from "./lib/publicationArtifact";
import { REFRESH_COOLDOWN_MS, REFRESH_REVIEW_MS, refreshArticleOldEnough, refreshablePentraPage, refreshOpportunities, refreshSlotAvailable, refreshWindowStart } from "./lib/articleRefresh";
import { isBrandedSearchQuery } from "./lib/searchPerformance";

async function owner(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId), identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || identity?.subject !== site.userId) throw new Error("Not authorized");
  return site;
}
export function selectionConnection(site: Doc<"sites">) {
  if (!site.userId || !["github","wordpress"].includes(site.publishMethod ?? "") ||
    !publisherDestinationReceiptVerified({ site, ownerAccountKey: accountDeletionKey(site.userId) })) throw new Error("Verify the current publishing destination before selecting pages");
}
/** New-article work also runs on hosted platforms (Shopify, Webflow, Ghost),
 * which publish new articles only; selecting existing pages stays GitHub/WordPress. */
export function contentWorkConnection(site: Doc<"sites">) {
  if (isApiCmsMethod(site.publishMethod)) {
    if (!site.userId || !publisherDestinationReceiptVerified({ site, ownerAccountKey: accountDeletionKey(site.userId) })) {
      throw new Error("Verify the current publishing destination before starting content work");
    }
    return;
  }
  selectionConnection(site);
}
export const selectionContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await owner(ctx, siteId); selectionConnection(site); return site;
} });

/** Creation consent covers Pentra's own verified pages, never an unrelated
 * customer's existing URL. The exact source/grant is retained with its receipt;
 * a later revocation or selection is never overwritten by verification replay. */
export async function enrollVerifiedCreation(ctx: MutationCtx, site: Doc<"sites">, article: Doc<"articles">, job: Doc<"jobs">) {
  const source = article.contentWorkCreationSource;
  const slug = article.slug.replace(/^\//, "");
  if (job.contentWork?.intent !== "create" || job.articleId !== article._id || article.siteId !== site._id ||
    article.publishedContentHash !== job.contentWork.approvedArtifactHash || !article.publicationReceipt || !article.publicUrl) throw new Error("Managed creation receipt is not bound to this work");
  // Hosted platforms (Shopify, Webflow, Ghost) publish new articles only; there
  // is no editable-page grant to enroll, and none is ever inferred.
  if (isApiCmsMethod(site.publishMethod) && !source) return;
  if (!source || source.kind !== site.publishMethod || source.connectionHash !== contentConnectionHash(site) ||
    source.profileHash !== confirmedContentProfileHash(site) || source.connectionHash !== job.contentWork.connectionHash ||
    !selectedUrlMatches(site, slug, article.publicUrl)) throw new Error("Managed creation source or consent is unavailable");
  const parsed = source.kind === "github" ? parseSelectedMarkdown(source.sourceContent, article.publicUrl) : null;
  if (parsed && (parsed.title !== article.title || parsed.markdown !== stripLeadingDocumentTitle(article.markdown, article.title))) throw new Error("Managed source differs from the verified article title/body");
  if (source.kind === "github" && (!source.path || selectedGitHubPath(site, source.path) !== slug || !/^[a-f0-9]{40}$/.test(source.sourceRevision))) throw new Error("Managed GitHub source does not match its created path");
  if (source.kind === "wordpress" && (String(source.resourceId) !== article.publicationReceipt.externalId || !/^[a-f0-9]{64}$/.test(source.permission ?? "") || !/^[a-f0-9]{64}$/.test(source.sourceRevision))) throw new Error("Managed WordPress receipt lost its exact resource grant");
  if (source.permissionRevokedAtReceipt) return; // Historical delivery never renews remote edit permission.
  assertUnprotectedPage(article.slug, article.title, source.sourceContent);
  const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
  if (rows.length > 500) throw new Error("Managed page inventory is incomplete");
  const matches = rows.filter(p => p.url === article.publicUrl);
  if (matches.length > 1) throw new Error("Managed page inventory is ambiguous");
  const existing = matches[0];
  if (existing?.editable) return; // Includes an explicitly revoked managed page.
  const editable = { ...source, version: 1, active: true, managedArticleId: article._id,
    markdown: parsed?.markdown ?? stripLeadingDocumentTitle(article.markdown, article.title), title: article.title, metaTitle: article.metaTitle ?? article.title,
    description: article.metaDescription ?? "", header: parsed?.header, selectedAt: Date.now(), lastWorkJobId: job._id };
  if (existing) await ctx.db.patch(existing._id, { editable });
  else await ctx.db.insert("pages", { siteId: site._id, slug, url: article.publicUrl, title: article.title,
    canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site), editable, createdAt: Date.now() });
}
export const list = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await owner(ctx, siteId);
  let connectionHash: string | undefined;
  try { connectionHash = contentConnectionHash(site); } catch { /* Disconnected owners must still see and revoke existing permissions. */ }
  const profileHash = confirmedContentProfileHash(site);
  const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501);
  return { complete: rows.length <= 500, pages: await Promise.all(rows.slice(0, 500).filter(p => p.editable).map(async p => {
    const job = p.editable!.lastWorkJobId ? await ctx.db.get(p.editable!.lastWorkJobId) : null;
    const state = job?.siteId === siteId ? job.contentWork : null;
    return { id: p._id, url: p.url,
    title: p.title, active: p.editable!.active, selectedAt: p.editable!.selectedAt, lastImprovedAt: p.editable!.lastImprovedAt,
    managed: Boolean(p.editable!.managedArticleId), bindingCurrent: p.editable!.connectionHash === connectionHash && p.editable!.profileHash === profileHash,
    pendingVerification: state?.stage === "verify", issue: contentIssue(state?.failure),
    latestRevisionId: p.editable!.latestRevisionId, revocationStatus: p.editable!.revocationStatus, sourceRevision: p.editable!.sourceRevision };
  })) };
} });
const imported = v.object({ kind: v.union(v.literal("github"), v.literal("wordpress")), path: v.optional(v.string()),
  resourceId: v.optional(v.number()), permission: v.optional(v.string()), slug: v.string(), url: v.string(),
  sourceRevision: v.string(), sourceContent: v.string(), markdown: v.string(), title: v.string(), metaTitle: v.string(),
  description: v.string(), header: v.optional(v.string()) });
export const detail = query({ args: { siteId: v.id("sites"), pageId: v.id("pages") }, handler: async (ctx, args) => {
  await owner(ctx, args.siteId);
  const page = await ctx.db.get(args.pageId), e = page?.editable;
  if (!page || page.siteId !== args.siteId || !e) throw new Error("Selected page not found");
  const revision = e.latestRevisionId ? await ctx.db.get(e.latestRevisionId) : null;
  return { title: e.title, url: page.url, baseRevision: e.sourceRevision,
    paragraphs: e.markdown.split(/\n\s*\n/).filter(p => p.length >= 15 && contentWords(p) <= 100).slice(0, 100),
    rollback: revision?.siteId === args.siteId && revision.selectedPageId === page._id && revision.liveVerifiedAt && revision.deliveredSource?.revision === e.sourceRevision
      ? { revisionId: revision._id, before: revision.nextArtifact.markdown, after: revision.baseArtifact.markdown } : null };
} });
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
  // Refreshes of Pentra's own older articles take at most one slot in four
  // and revisit the same article at most every 60 days (lib/articleRefresh).
  const refreshAllowed = refreshSlotAvailable(jobs), now = Date.now();
  // Pentra's own articles (adopted older ones, and the ones Autopilot wrote
  // and enrolled at publication once they are 28 days old) may take the
  // page-2 refresh when a refresh slot is free and the 60-day cooldown is over.
  const refreshDue = (e: NonNullable<Doc<"pages">["editable"]>) => refreshablePentraPage(e, now) &&
    refreshAllowed && now - (e.lastImprovedAt ?? 0) >= REFRESH_COOLDOWN_MS;
  const candidates = pages.filter(p => p.editable?.active && p.editable.connectionHash === contentConnectionHash(site) &&
    p.editable.profileHash === confirmedContentProfileHash(site) &&
    // Page-2 refresh candidates are re-checked daily (Search Console moves daily).
    now - (p.editable.lastReviewedAt ?? 0) >= (p.editable.origin === "published_refresh" || refreshDue(p.editable) ? REFRESH_REVIEW_MS : CONTENT_PAGE_REVIEW_MS) &&
    now - (p.editable.lastImprovedAt ?? 0) >= CONTENT_PAGE_COOLDOWN_MS &&
    (p.editable.origin !== "published_refresh" || refreshDue(p.editable)) &&
    !jobs.some(j => j.contentWork?.targetPageId === p._id && !["verified","failed"].includes(j.contentWork.stage)));
  if (!candidates.length) return null;
  let measurements: Awaited<ReturnType<typeof takeCurrentGscQueryRows>>;
  // The newest 28 days of Search Console data, not the oldest rows first.
  const windowStart = refreshWindowStart((site.gscDateEpochs ?? []).map(receipt => receipt.date));
  try { measurements = await takeCurrentGscQueryRows(ctx, site, 3000, windowStart ? { startDate: windowStart } : undefined); } catch { return null; }
  // "Money pages" first: a page already ranking on positions 4-20 is the
  // cheapest to lift onto page one, so it is considered before the rest.
  for (const page of moneyPagesFirst(candidates, measurements.rows)) {
    const e = page.editable!;
    await ctx.db.patch(page._id, { editable: { ...e, lastReviewedAt: Date.now() } });
    try { assertUnprotectedPage(page.slug, e.title, e.sourceContent); } catch { continue; }
    if (refreshDue(e)) {
      // The page-2 search is usually the article's own keyword, so it is
      // already in the text: the refresh answers it in a dedicated section.
      const eligible = refreshOpportunities(measurements.rows, page.url).filter(o => !isBrandedSearchQuery(o.query, site.domain) &&
        evaluateTopicBusinessFit({ keyword: o.query, label: e.title, ...tenantTopicBusinessSignals(site) }).eligible);
      const best = eligible.find(o => !e.markdown.toLowerCase().includes(o.query)) ?? eligible[0];
      const managed = best && e.managedArticleId ? await ctx.db.get(e.managedArticleId) : null;
      const refreshTarget = best ? refreshInsertTarget(e, managed?.articleType) : undefined;
      if (best && refreshTarget) {
        return { page, question: best.query, editTarget: refreshTarget,
          reason: `Refresh of a page-2 article: Search Console shows "${best.query}" at average position ${Math.round(best.position)} with ${best.impressions} impressions in the last 28 days. No claim of causal growth.` };
      }
    }
    // An adopted article is only ever refreshed; an article Autopilot wrote
    // can still get the ordinary targeted improvement below.
    if (e.origin === "published_refresh") continue;
    const rows = measurements.rows.filter(r => r.page === page.url && r.impressions > 0 &&
      (!e.lastImprovedAt || r.date > new Date(e.lastImprovedAt).toISOString().slice(0, 10)) &&
      !e.markdown.toLowerCase().includes(r.query.toLowerCase()) &&
      evaluateTopicBusinessFit({ keyword: r.query, label: e.title, ...tenantTopicBusinessSignals(site) }).eligible)
      .sort((a,b) => Number(nearPageOne(b)) - Number(nearPageOne(a)) || b.impressions - a.impressions);
    // An actual first-party reader question may be useful without Search Console.
    const question = rows[0]?.query ?? (site.painPoints ?? []).find(q => q.endsWith("?") &&
      !e.markdown.toLowerCase().includes(q.toLowerCase()) && evaluateTopicBusinessFit({ keyword: q, label: e.title, ...tenantTopicBusinessSignals(site) }).eligible);
    if (!question) continue;
    const editTarget = targetedImprovement(e, site, question);
    if (contentWords(e.markdown) >= 1200 && !editTarget) continue;
    return { page, question, editTarget, reason: rows[0] ? `Current Search Console query: ${question}; impressions=${rows[0].impressions}; date=${rows[0].date}${nearPageOne(rows[0]) ? `; position=${Math.round(rows[0].position!)} (close to page one)` : ""}. No claim of causal growth.`
      : `Confirmed first-party reader question: ${question}. Search metrics unavailable; do not invent them.` };
  }
  return null;
}

/** Pentra's own older published articles that could be refreshed: live for
 * 28+ days on the current GitHub destination, not yet an editable page, and
 * showing a page-2 search in the last 28 days of Search Console data. */
export const refreshAdoptionContext = internalQuery({ args: { siteId: v.id("sites"), limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  const site = await ctx.db.get(args.siteId);
  if (!site || site.deletionStatus || site.accountDeletionRequestedAt || site.serviceMode !== "growth_first" ||
    !site.contentSchedule || site.contentSchedule.ownerReviewedOnly || site.contentSchedule.paused || site.publishMethod !== "github" || !site.userId) return null;
  try { selectionConnection(site); } catch { return null; }
  let connectionHash: string;
  try { connectionHash = contentConnectionHash(site); } catch { return null; }
  const windowStart = refreshWindowStart((site.gscDateEpochs ?? []).map(receipt => receipt.date));
  if (!windowStart) return { site, connectionHash, profileHash: confirmedContentProfileHash(site), candidates: [] };
  const measurements = await takeCurrentGscQueryRows(ctx, site, 6000, { startDate: windowStart });
  const pages = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
  if (pages.length > 500) return null;
  const adopted = new Set(pages.filter(p => p.editable).map(p => p.url));
  const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", site._id).eq("status", "published")).take(2001))
    .filter(row => row.publicUrl && row.publicUrlStatus === "verified" && refreshArticleOldEnough(row.publishedAt, Date.now()) && !adopted.has(row.publicUrl));
  const scored = summaries.map(row => ({ row, best: refreshOpportunities(measurements.rows, row.publicUrl!)
    .find(o => !isBrandedSearchQuery(o.query, site.domain)) }))
    .filter(entry => entry.best).sort((a, b) => b.best!.impressions - a.best!.impressions)
    .slice(0, Math.max(1, Math.min(args.limit ?? 3, 5)));
  const candidates = [];
  for (const { row } of scored) {
    const article = await ctx.db.get(row.articleId);
    if (!article || article.siteId !== site._id || article.status !== "published" || article.publicationReceipt?.method !== "github" ||
      !article.publicationDeliveryHash || article.contentWorkSourceJobId) continue;
    const slug = article.slug.replace(/^\//, "");
    const contentDir = publicationDeliveryConfig(site).contentDir;
    if (!contentDir) continue;
    candidates.push({ articleId: article._id, path: `${contentDir}/${slug}.md`, url: row.publicUrl!,
      deliveryKey: `pentra:${article.publicationDeliveryHash}` });
  }
  return { site, connectionHash, profileHash: confirmedContentProfileHash(site), candidates };
} });

/** Adopt one verified Pentra-owned article as a refreshable page. Consent is
 * the site's Autopilot setup, which covers Pentra's own published pages only;
 * the action proved ownership from the file's own frontmatter. */
export const recordRefreshAdoption = internalMutation({ args: { siteId: v.id("sites"), articleId: v.id("articles"),
  connectionHash: v.string(), profileHash: v.string(), source: imported },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId), article = await ctx.db.get(args.articleId);
    if (!site || !article || article.siteId !== site._id || article.status !== "published" || site.serviceMode !== "growth_first" ||
      !site.contentSchedule || site.contentSchedule.ownerReviewedOnly || site.publishMethod !== "github" || args.source.kind !== "github") return { adopted: false };
    selectionConnection(site);
    if (contentConnectionHash(site) !== args.connectionHash || confirmedContentProfileHash(site) !== args.profileHash ||
      !selectedUrlMatches(site, args.source.slug, args.source.url) || article.publicUrl !== args.source.url) return { adopted: false };
    assertUnprotectedPage(args.source.slug, args.source.title, args.source.sourceContent);
    const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", site._id)).take(501);
    if (rows.length > 500) return { adopted: false };
    const matches = rows.filter(p => p.url === args.source.url);
    if (matches.length > 1 || matches[0]?.editable) return { adopted: false }; // never overrides an owner selection or revocation
    const { slug, url, ...source } = args.source;
    const editable = { ...source, version: 1, active: true, connectionHash: args.connectionHash, profileHash: args.profileHash,
      selectedAt: Date.now(), managedArticleId: article._id, origin: "published_refresh" as const };
    if (matches[0]) await ctx.db.patch(matches[0]._id, { editable });
    else await ctx.db.insert("pages", { siteId: site._id, url, slug, title: source.title, editable,
      canonicalDomain: siteCanonicalDomain(site)!, domainRevision: siteCanonicalDomainRevision(site), createdAt: Date.now() });
    return { adopted: true };
  } });

/** Refresh adoptions no work has started on yet, re-checked against the
 * file's history (adoptions made before the history check existed, or an owner
 * who edited the file after adoption). */
export const refreshAdoptionsToRecheck = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const rows = await ctx.db.query("pages").withIndex("by_site", q => q.eq("siteId", siteId)).take(501);
  return rows.filter(p => p.editable?.origin === "published_refresh" && p.editable.active && p.editable.kind === "github" &&
    typeof p.editable.path === "string" && p.editable.lastImprovedAt === undefined && p.editable.lastWorkJobId === undefined)
    .slice(0, 10).map(p => ({ pageId: p._id, version: p.editable!.version, path: p.editable!.path! }));
} });

/** Stops a not-yet-started refresh of a file the owner has edited. */
export const retireRefreshAdoption = internalMutation({ args: { pageId: v.id("pages"), version: v.number() }, handler: async (ctx, { pageId, version }) => {
  const page = await ctx.db.get(pageId), editable = page?.editable;
  if (!page || !editable || editable.origin !== "published_refresh" || editable.version !== version || !editable.active ||
    editable.lastImprovedAt !== undefined || editable.lastWorkJobId !== undefined) return { retired: false };
  await ctx.db.patch(pageId, { editable: { ...editable, active: false } });
  return { retired: true };
} });

/** Sites whose Autopilot may refresh its own older GitHub articles. */
export const refreshAdoptionFleetPage = internalQuery({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { cursor }) => {
  const page = await ctx.db.query("sites").paginate({ cursor, numItems: 50 });
  return { isDone: page.isDone, continueCursor: page.continueCursor,
    siteIds: page.page.filter(site => !site.deletionStatus && site.serviceMode === "growth_first" && site.publishMethod === "github" &&
      site.contentSchedule && !site.contentSchedule.ownerReviewedOnly && !site.contentSchedule.paused).map(site => site._id) };
} });
