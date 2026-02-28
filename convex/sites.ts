import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const now = () => Date.now();

export const list = query({
  handler: async (ctx) => {
    return ctx.db.query("sites").order("asc").collect();
  },
});

export const get = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db.get(siteId);
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("sites")),
    domain: v.string(),
    niche: v.optional(v.string()),
    tone: v.optional(v.string()),
    language: v.optional(v.string()),
    cadencePerWeek: v.optional(v.number()),
    autopilotEnabled: v.optional(v.boolean()),
    inferToneNiche: v.optional(v.boolean()),
    approvalRequired: v.optional(v.boolean()),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
    // AI-analyzed fields
    siteName: v.optional(v.string()),
    siteType: v.optional(v.string()),
    siteSummary: v.optional(v.string()),
    blogTheme: v.optional(v.string()),
    keyFeatures: v.optional(v.array(v.string())),
    pricingInfo: v.optional(v.string()),
    founders: v.optional(v.string()),
    targetCountry: v.optional(v.string()),
    targetAudienceSummary: v.optional(v.string()),
    painPoints: v.optional(v.array(v.string())),
    productUsage: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    ctaText: v.optional(v.string()),
    ctaUrl: v.optional(v.string()),
    imageBrandingPrompt: v.optional(v.string()),
    anchorKeywords: v.optional(v.array(v.string())),
    externalLinking: v.optional(v.boolean()),
    sourceCitations: v.optional(v.boolean()),
    youtubeEmbeds: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const domain = args.domain.trim().toLowerCase();
    const autopilotEnabled = args.autopilotEnabled ?? true;
    const inferToneNiche = args.inferToneNiche ?? true;
    const approvalRequired = args.approvalRequired ?? false;

    const data = {
      domain,
      niche: args.niche,
      tone: args.tone,
      language: args.language,
      cadencePerWeek: args.cadencePerWeek,
      autopilotEnabled,
      inferToneNiche,
      approvalRequired,
      repoOwner: args.repoOwner,
      repoName: args.repoName,
      siteName: args.siteName,
      siteType: args.siteType,
      siteSummary: args.siteSummary,
      blogTheme: args.blogTheme,
      keyFeatures: args.keyFeatures,
      pricingInfo: args.pricingInfo,
      founders: args.founders,
      targetCountry: args.targetCountry,
      targetAudienceSummary: args.targetAudienceSummary,
      painPoints: args.painPoints,
      productUsage: args.productUsage,
      competitors: args.competitors,
      ctaText: args.ctaText,
      ctaUrl: args.ctaUrl,
      imageBrandingPrompt: args.imageBrandingPrompt,
      anchorKeywords: args.anchorKeywords,
      externalLinking: args.externalLinking,
      sourceCitations: args.sourceCitations,
      youtubeEmbeds: args.youtubeEmbeds,
      urlStructure: args.urlStructure,
      updatedAt: now(),
    };

    if (args.id) {
      await ctx.db.patch(args.id, data);
      return args.id;
    }

    const existing = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();

    if (existing?._id) {
      // Merge: only overwrite fields that are explicitly provided
      const merged: Record<string, unknown> = { updatedAt: now() };
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedAt") continue;
        merged[key] = value ?? (existing as Record<string, unknown>)[key];
      }
      await ctx.db.patch(existing._id, merged);
      return existing._id;
    }

    return await ctx.db.insert("sites", {
      ...data,
      language: args.language ?? "en",
      cadencePerWeek: args.cadencePerWeek ?? 4,
      externalLinking: args.externalLinking ?? true,
      sourceCitations: args.sourceCitations ?? true,
      youtubeEmbeds: args.youtubeEmbeds ?? false,
      urlStructure: args.urlStructure ?? "/blog/[slug]",
      createdAt: now(),
    });
  },
});
