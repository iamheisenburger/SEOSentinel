import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  normalizeCanonicalDomain,
  pageMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding";

const now = () => Date.now();

async function listBySiteHandler(ctx: QueryCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  if (!site) return [];
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    return legacyEpoch.filter((page) => pageMatchesCurrentDomain(site, page));
  }
  const stamped = await ctx.db
    .query("pages")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", siteId)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
    )
    .collect();
  return stamped;
}

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this site's pages");
    }
    return listBySiteHandler(ctx, siteId);
  },
});

export const listBySiteInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => listBySiteHandler(ctx, siteId),
});

export const bulkUpsert = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    pages: v.array(
      v.object({
        url: v.string(),
        slug: v.string(),
        title: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        summary: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    ctx,
    { siteId, expectedCanonicalDomain, expectedDomainRevision, pages },
  ) => {
    const site = await ctx.db.get(siteId);
    const canonicalDomain = site ? siteCanonicalDomain(site) : null;
    if (
      !site ||
      site.deletionStatus ||
      !canonicalDomain ||
      normalizeCanonicalDomain(expectedCanonicalDomain) !== canonicalDomain ||
      expectedDomainRevision !== siteCanonicalDomainRevision(site) ||
      pages.some((page) =>
        normalizeCanonicalDomain(page.url) !== canonicalDomain
      )
    ) {
      throw new Error("Website domain changed before crawl persistence");
    }
    for (const page of pages) {
      const existing = siteUsesLegacyDomainReceipts(site)
        ? (await ctx.db
          .query("pages")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .collect())
          .find((candidate) =>
            candidate.slug === page.slug &&
            pageMatchesCurrentDomain(site, candidate)
          )
        : await ctx.db
          .query("pages")
          .withIndex("by_site_domain_revision_slug", (q) =>
            q
              .eq("siteId", siteId)
              .eq("canonicalDomain", canonicalDomain)
              .eq("domainRevision", expectedDomainRevision)
              .eq("slug", page.slug)
          )
          .unique();

      if (existing?._id) {
        await ctx.db.patch(existing._id, {
          url: page.url,
          canonicalDomain,
          domainRevision: expectedDomainRevision,
          title: page.title ?? existing.title,
          keywords: page.keywords ?? existing.keywords,
          summary: page.summary ?? existing.summary,
        });
      } else {
        await ctx.db.insert("pages", {
          siteId,
          url: page.url,
          canonicalDomain,
          domainRevision: expectedDomainRevision,
          slug: page.slug,
          title: page.title,
          keywords: page.keywords,
          summary: page.summary,
          createdAt: now(),
        });
      }
    }
  },
});
