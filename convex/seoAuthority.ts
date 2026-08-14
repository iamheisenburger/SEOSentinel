import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's authority opportunities");
  }
}

export const upsertVerifiedBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    opportunities: v.array(v.object({
      articleId: v.optional(v.id("articles")),
      fingerprint: v.string(),
      type: v.string(),
      sourceDomain: v.string(),
      sourceUrl: v.string(),
      targetUrl: v.string(),
      context: v.string(),
      domainRank: v.optional(v.number()),
      evidenceHash: v.string(),
      verifiedAt: v.number(),
    })),
  },
  handler: async (ctx, { siteId, opportunities }) => {
    let inserted = 0;
    let updated = 0;
    for (const opportunity of opportunities) {
      if (opportunity.articleId) {
        const article = await ctx.db.get(opportunity.articleId);
        if (!article || article.siteId !== siteId) {
          throw new Error("Authority opportunity crossed a tenant boundary");
        }
      }
      const existing = await ctx.db
        .query("seo_authority_opportunities")
        .withIndex("by_fingerprint", (q) =>
          q.eq("fingerprint", opportunity.fingerprint),
        )
        .unique();
      const patch = {
        ...opportunity,
        siteId,
        lastCheckedAt: opportunity.verifiedAt,
        updatedAt: opportunity.verifiedAt,
      };
      if (existing) {
        if (existing.siteId !== siteId) {
          throw new Error("Authority fingerprint belongs to another tenant");
        }
        await ctx.db.patch(existing._id, patch);
        updated++;
      } else {
        await ctx.db.insert("seo_authority_opportunities", {
          ...patch,
          status: "verified",
          createdAt: opportunity.verifiedAt,
        });
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

export const listVerified = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    await requireSiteOwner(ctx, siteId);
    return ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "verified"),
      )
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 50, 100)));
  },
});

export const getVerifiedBySource = internalQuery({
  args: { siteId: v.id("sites"), sourceUrl: v.string() },
  handler: async (ctx, { siteId, sourceUrl }) => {
    const candidates = await ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "verified"),
      )
      .take(100);
    return candidates.find((candidate) => candidate.sourceUrl === sourceUrl) ?? null;
  },
});

export const markOutreachPrepared = internalMutation({
  args: {
    siteId: v.id("sites"),
    opportunityId: v.id("seo_authority_opportunities"),
  },
  handler: async (ctx, { siteId, opportunityId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity || opportunity.siteId !== siteId) {
      throw new Error("Authority opportunity not found for site");
    }
    if (opportunity.status !== "verified" && opportunity.status !== "outreach_prepared") {
      throw new Error("Outreach can only be prepared for a verified opportunity");
    }
    const timestamp = Date.now();
    await ctx.db.patch(opportunityId, {
      status: "outreach_prepared",
      outreachPreparedAt: timestamp,
      updatedAt: timestamp,
    });
  },
});
