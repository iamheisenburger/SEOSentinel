/** Pentra Answers (Nov 2026): publishing, the database side. The page's state through publishing, indexing and the hosted
 * answers address (answers.yourdomain.com), plus the public reads the hosted pages render from. */
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { answersAllows, answersEnabled } from "./lib/answersAccess";
import { validHostedDomain } from "./lib/answerPublishing";
import { hostOf } from "./lib/answerEngine";
import { businessOf, siteAnswersAccess } from "./answers";

/** Everything publishing one page needs: the page, where it goes, and the site's connection (server-side only). */
export const publishContext = internalQuery({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  if (!page || !["draft", "publish_failed", "publishing"].includes(page.status)) return null;
  const site = await ctx.db.get(page.siteId);
  if (!site || !answersEnabled(site)) return null;
  const access = await siteAnswersAccess(ctx, site);
  if (!answersAllows(access).publish) return null;
  const previous = page.rewriteOf ? await ctx.db.get(page.rewriteOf) : null;
  return { page, site, previous: previous && previous.status === "published" ? previous : null, business: businessOf(site) };
} });

export const markPublishing = internalMutation({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  if (!page || !["draft", "publish_failed"].includes(page.status)) return false;
  await ctx.db.patch(pageId, { status: "publishing", publishError: undefined, updatedAt: Date.now() });
  return true;
} });

export const markPublished = internalMutation({ args: { pageId: v.id("answer_pages"), url: v.string(), target: v.string(), receipt: v.string() },
  handler: async (ctx, { pageId, url, target, receipt }) => {
    const page = await ctx.db.get(pageId);
    if (!page || page.status !== "publishing") return;
    const now = Date.now();
    await ctx.db.patch(pageId, { status: "published", publishedUrl: url, publishedAt: now, publishTarget: target, publishReceipt: receipt.slice(0, 2000),
      publishError: undefined, updatedAt: now });
    // A rewrite replaces the page it rewrote: one live page per question, at the same address.
    if (page.rewriteOf) {
      const previous = await ctx.db.get(page.rewriteOf);
      if (previous && previous.status === "published") await ctx.db.patch(previous._id, { status: "retired", updatedAt: now });
    }
    const question = await ctx.db.get(page.questionId);
    if (question) await ctx.db.patch(question._id, { pageId });
  } });

export const markPublishFailed = internalMutation({ args: { pageId: v.id("answer_pages"), error: v.string() }, handler: async (ctx, { pageId, error }) => {
  const page = await ctx.db.get(pageId);
  if (!page || page.status !== "publishing") return;
  await ctx.db.patch(pageId, { status: "publish_failed", publishError: error.slice(0, 400), updatedAt: Date.now() });
} });

export const recordIndexing = internalMutation({ args: { pageId: v.id("answer_pages"), indexNow: v.optional(v.string()), sitemap: v.optional(v.boolean()),
  liveIssue: v.optional(v.string()) },
  handler: async (ctx, { pageId, indexNow, sitemap, liveIssue }) => {
    const page = await ctx.db.get(pageId);
    if (!page) return;
    const now = Date.now();
    await ctx.db.patch(pageId, { ...(indexNow ? { indexNow: { at: now, status: indexNow } } : {}), ...(sitemap ? { googleSitemapAt: now } : {}),
      ...(liveIssue ? { issues: [...new Set([...page.issues.filter((i) => !i.startsWith("Not live yet")), liveIssue])] }
        : { issues: page.issues.filter((i) => !i.startsWith("Not live yet")) }), updatedAt: now });
  } });

export const setIndexNowKey = internalMutation({ args: { siteId: v.id("sites"), key: v.string(), host: v.optional(v.string()) },
  handler: async (ctx, { siteId, key, host }) => {
    const site = await ctx.db.get(siteId);
    if (!site?.answers) return;
    const hosts = new Set(site.answers.indexNowHosts ?? []);
    if (host) hosts.add(hostOf(host));
    await ctx.db.patch(siteId, { answers: { ...site.answers, indexNowKey: site.answers.indexNowKey ?? key, indexNowHosts: [...hosts] } });
  } });

// ── The hosted answers address ──

/** The owner points answers.yourdomain.com at Pentra: Pentra attaches the address and checks its DNS until it's live. */
export const setHostedDomain = mutation({ args: { siteId: v.id("sites"), domain: v.string() }, handler: async (ctx, { siteId, domain }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject || !answersEnabled(site)) throw new ConvexError("Site not found.");
  const host = validHostedDomain(domain, site.domain);
  if (!host) throw new ConvexError(`Use a subdomain of ${hostOf(site.domain)}, like answers.${hostOf(site.domain)}.`);
  const claimed = await ctx.db.query("answer_host_index").withIndex("by_host", (q) => q.eq("host", host)).first();
  if (claimed && claimed.siteId !== siteId) throw new ConvexError("That address is already used by another site.");
  for (const row of await ctx.db.query("answer_host_index").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(10)) {
    if (row.host !== host) await ctx.db.delete(row._id);
  }
  if (!claimed) await ctx.db.insert("answer_host_index", { host, siteId, createdAt: Date.now() });
  await ctx.db.patch(siteId, { answers: { ...site.answers!, publishing: { target: "hosted", hostedDomain: host, hostedStatus: "pending_dns" } },
    updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.answerPublish.attachHostedDomain, { siteId });
  return { host, cname: "cname.vercel-dns.com" };
} });

/** Publish to the site's own connection (WordPress, GitHub, Webflow, Shopify, Ghost, webhook) instead. */
export const usePublishingConnection = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject || !answersEnabled(site)) throw new ConvexError("Site not found.");
  await ctx.db.patch(siteId, { answers: { ...site.answers!, publishing: { target: "site" } }, updatedAt: Date.now() });
  return { ok: true };
} });

export const hostedDomainState = internalMutation({ args: { siteId: v.id("sites"), status: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { siteId, status, error }) => {
    const site = await ctx.db.get(siteId);
    const publishing = site?.answers?.publishing;
    if (!site?.answers || !publishing?.hostedDomain) return;
    await ctx.db.patch(siteId, { answers: { ...site.answers, publishing: { ...publishing, hostedStatus: status, hostedCheckedAt: Date.now(),
      ...(error ? { hostedError: error.slice(0, 200) } : { hostedError: undefined }) } } });
  } });

/** A hosted page as its public route renders it: only a published page on a live hosted address. */
export const hostedPage = query({ args: { host: v.string(), slug: v.string() }, handler: async (ctx, { host, slug }) => {
  const lookup = await ctx.db.query("answer_host_index").withIndex("by_host", (q) => q.eq("host", hostOf(host))).first();
  if (!lookup) return null;
  const site = await ctx.db.get(lookup.siteId);
  if (!site?.answers?.publishing || site.answers.publishing.hostedDomain !== hostOf(host) || site.answers.publishing.hostedStatus !== "live") return null;
  const page = await ctx.db.query("answer_pages").withIndex("by_site_slug", (q) => q.eq("siteId", site._id).eq("slug", slug))
    .filter((q) => q.eq(q.field("status"), "published")).first();
  if (!page) return null;
  const business = businessOf(site);
  return { title: page.title, metaDescription: page.metaDescription, markdown: page.markdown, sources: page.sources.map((s) => ({ n: s.n, url: s.url, title: s.title ?? null })),
    publishedAt: page.publishedAt ?? page.updatedAt, updatedAt: page.updatedAt, question: page.question,
    business: { name: business.name, domain: business.domain, ctaText: site.ctaText ?? null, ctaUrl: site.ctaUrl ?? null } };
} });

/** A hosted address's published pages (its index and sitemap), and its IndexNow key. */
export const hostedIndex = query({ args: { host: v.string() }, handler: async (ctx, { host }) => {
  const lookup = await ctx.db.query("answer_host_index").withIndex("by_host", (q) => q.eq("host", hostOf(host))).first();
  if (!lookup) return null;
  const site = await ctx.db.get(lookup.siteId);
  if (!site?.answers?.publishing || site.answers.publishing.hostedDomain !== hostOf(host) || site.answers.publishing.hostedStatus !== "live") return null;
  const pages = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", site._id).eq("status", "published")).take(500);
  const business = businessOf(site);
  return { business: { name: business.name, domain: business.domain }, indexNowKey: site.answers.indexNowKey ?? null,
    pages: pages.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).map((p) => ({ slug: p.slug, title: p.title, metaDescription: p.metaDescription,
      updatedAt: p.updatedAt })) };
} });

/** A published page as indexing needs it (with the site's connection for placing the IndexNow key; server-side only). */
export const pageForIndexing = internalQuery({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const page = await ctx.db.get(pageId);
  if (!page || page.status !== "published" || !page.publishedUrl) return null;
  const site = await ctx.db.get(page.siteId);
  if (!site?.answers) return null;
  const layout = site.githubLayout as { framework?: string } | undefined;
  return { siteId: site._id, publishedUrl: page.publishedUrl, title: page.title, target: page.publishTarget ?? "site",
    site: { domain: site.domain, key: site.answers.indexNowKey ?? null, hosts: site.answers.indexNowHosts ?? [],
      ...(site.githubToken ? { githubToken: site.githubToken } : {}), ...(site.repoOwner ? { repoOwner: site.repoOwner } : {}),
      ...(site.repoName ? { repoName: site.repoName } : {}), ...(site.repoDefaultBranch ? { repoDefaultBranch: site.repoDefaultBranch } : {}),
      ...(layout?.framework ? { framework: layout.framework } : {}) } };
} });

export const hostedState = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  const publishing = site?.answers?.publishing;
  return site && publishing?.target === "hosted" && publishing.hostedDomain ? { host: publishing.hostedDomain, status: publishing.hostedStatus ?? "pending_dns" } : null;
} });

/** The hosted address went live: pages that waited for it publish now. */
export const retryHostedPublishes = internalMutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const failed = await ctx.db.query("answer_pages").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "publish_failed")).take(50);
  let delay = 0;
  for (const page of failed) { await ctx.scheduler.runAfter(delay, internal.actions.answerPublish.publishPage, { pageId: page._id }); delay += 1_500; }
  return { retried: failed.length };
} });
