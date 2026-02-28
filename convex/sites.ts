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
  },
  handler: async (ctx, args) => {
    const domain = args.domain.trim().toLowerCase();
    const autopilotEnabled = args.autopilotEnabled ?? true;
    const inferToneNiche = args.inferToneNiche ?? true;
    const approvalRequired = args.approvalRequired ?? false;

    if (args.id) {
      await ctx.db.patch(args.id, {
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
        updatedAt: now(),
      });
      return args.id;
    }

    const existing = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    if (existing?._id) {
      await ctx.db.patch(existing._id, {
        niche: args.niche ?? existing.niche,
        tone: args.tone ?? existing.tone,
        language: args.language ?? existing.language,
        cadencePerWeek: args.cadencePerWeek ?? existing.cadencePerWeek,
        autopilotEnabled: args.autopilotEnabled ?? existing.autopilotEnabled ?? true,
        inferToneNiche: args.inferToneNiche ?? existing.inferToneNiche ?? true,
        approvalRequired: args.approvalRequired ?? existing.approvalRequired ?? false,
        repoOwner: args.repoOwner ?? existing.repoOwner,
        repoName: args.repoName ?? existing.repoName,
        updatedAt: now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("sites", {
      domain,
      niche: args.niche,
      tone: args.tone,
      language: args.language ?? "en",
      cadencePerWeek: args.cadencePerWeek ?? 4,
      autopilotEnabled,
      inferToneNiche,
      approvalRequired,
      repoOwner: args.repoOwner,
      repoName: args.repoName,
      createdAt: now(),
      updatedAt: now(),
    });
  },
});







