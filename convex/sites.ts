import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "./planLimits";

const now = () => Date.now();

export const list = query({
  args: { clerkUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.clerkUserId;
    if (!userId) return [];
    return ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();
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
    clerkUserId: v.optional(v.string()),
    niche: v.optional(v.string()),
    tone: v.optional(v.string()),
    language: v.optional(v.string()),
    cadencePerWeek: v.optional(v.number()),
    autopilotEnabled: v.optional(v.boolean()),
    inferToneNiche: v.optional(v.boolean()),
    approvalRequired: v.optional(v.boolean()),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
    // Publishing platform
    publishMethod: v.optional(v.string()),
    wpUrl: v.optional(v.string()),
    wpUsername: v.optional(v.string()),
    wpAppPassword: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
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
    brandPrimaryColor: v.optional(v.string()),
    brandAccentColor: v.optional(v.string()),
    brandFontFamily: v.optional(v.string()),
    brandLogoUrl: v.optional(v.string()),
    anchorKeywords: v.optional(v.array(v.string())),
    externalLinking: v.optional(v.boolean()),
    sourceCitations: v.optional(v.boolean()),
    youtubeEmbeds: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.clerkUserId ?? undefined;

    // ── Site count limit (only on new site creation, not updates) ──
    if (!args.id && userId) {
      const existingSites = await ctx.db
        .query("sites")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      // Check if any existing site has planFeatures to determine limits
      const features = (existingSites[0] as any)?.planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);

      // Check if domain already exists (would be an update, not new)
      const domainNorm = args.domain.trim().toLowerCase();
      const domainExists = existingSites.some((s) => s.domain === domainNorm);

      if (!domainExists) {
        // Check cumulative site additions this month (prevents delete+re-add abuse)
        const now = new Date();
        const monthStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ).getTime();
        const siteAddLogs = await ctx.db
          .query("usage_log")
          .withIndex("by_user_type", (q) =>
            q.eq("userId", userId).eq("type", "site_added"),
          )
          .collect();
        const sitesAddedThisMonth = siteAddLogs.filter(
          (l) => l.createdAt >= monthStart,
        ).length;

        if (sitesAddedThisMonth >= limits.maxSites) {
          throw new Error(
            `Site limit reached (${sitesAddedThisMonth}/${limits.maxSites} this month). You cannot add more sites until your next billing cycle.`,
          );
        }

        // Log this site addition
        await ctx.db.insert("usage_log", {
          userId,
          type: "site_added",
          createdAt: Date.now(),
        });
      }
    }

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
      publishMethod: args.publishMethod,
      wpUrl: args.wpUrl,
      wpUsername: args.wpUsername,
      wpAppPassword: args.wpAppPassword,
      webhookUrl: args.webhookUrl,
      webhookSecret: args.webhookSecret,
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
      brandPrimaryColor: args.brandPrimaryColor,
      brandAccentColor: args.brandAccentColor,
      brandFontFamily: args.brandFontFamily,
      brandLogoUrl: args.brandLogoUrl,
      anchorKeywords: args.anchorKeywords,
      externalLinking: args.externalLinking,
      sourceCitations: args.sourceCitations,
      youtubeEmbeds: args.youtubeEmbeds,
      urlStructure: args.urlStructure,
      updatedAt: now(),
    };

    if (args.id) {
      // Strip undefined values — Convex patch with undefined CLEARS the field,
      // so partial step saves (e.g. profile step, audience step) would wipe
      // fields set by other steps (e.g. ctaUrl set in strategy step).
      const definedData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ) as typeof data;
      await ctx.db.patch(args.id, definedData);
      return args.id;
    }

    const existing = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();

    if (existing?._id) {
      // Merge: only overwrite fields that are explicitly provided
      const merged: Record<string, unknown> = { updatedAt: now(), userId };
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedAt") continue;
        merged[key] = value ?? (existing as Record<string, unknown>)[key];
      }
      await ctx.db.patch(existing._id, merged);
      return existing._id;
    }

    if (!userId) throw new Error("Unable to determine user identity. Please try again.");
    return await ctx.db.insert("sites", {
      ...data,
      userId,
      language: args.language ?? "en",
      cadencePerWeek: args.cadencePerWeek ?? 4,
      publishMethod: args.publishMethod ?? "github",
      externalLinking: args.externalLinking ?? true,
      sourceCitations: args.sourceCitations ?? true,
      youtubeEmbeds: args.youtubeEmbeds ?? false,
      urlStructure: args.urlStructure ?? "/blog/[slug]",
      createdAt: now(),
    });
  },
});

// Partial update — edit individual site settings post-onboarding
export const updateSite = mutation({
  args: {
    siteId: v.id("sites"),
    siteName: v.optional(v.string()),
    niche: v.optional(v.string()),
    tone: v.optional(v.string()),
    language: v.optional(v.string()),
    cadencePerWeek: v.optional(v.number()),
    autopilotEnabled: v.optional(v.boolean()),
    approvalRequired: v.optional(v.boolean()),
    ctaText: v.optional(v.string()),
    ctaUrl: v.optional(v.string()),
    anchorKeywords: v.optional(v.array(v.string())),
    externalLinking: v.optional(v.boolean()),
    sourceCitations: v.optional(v.boolean()),
    youtubeEmbeds: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()),
    brandPrimaryColor: v.optional(v.string()),
    brandAccentColor: v.optional(v.string()),
    brandFontFamily: v.optional(v.string()),
    targetCountry: v.optional(v.string()),
    targetAudienceSummary: v.optional(v.string()),
    painPoints: v.optional(v.array(v.string())),
    competitors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { siteId, ...fields }) => {
    const patch: Record<string, unknown> = { updatedAt: now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(siteId, patch);
  },
});

// Delete a single site and all its related data
export const deleteSite = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    // Delete articles
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const a of articles) await ctx.db.delete(a._id);

    // Delete topics
    const topics = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const t of topics) await ctx.db.delete(t._id);

    // Delete pages
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const p of pages) await ctx.db.delete(p._id);

    // Delete jobs
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const j of jobs) await ctx.db.delete(j._id);

    // Delete the site itself
    await ctx.db.delete(siteId);
  },
});

// List ALL sites — used by autopilot cron (no auth context)
export const listAllForAutopilot = query({
  handler: async (ctx) => {
    return ctx.db.query("sites").collect();
  },
});

// Sync plan features from Clerk to all user's sites (called from client after auth)
export const syncPlanFeatures = mutation({
  args: { planFeatures: v.array(v.string()) },
  handler: async (ctx, { planFeatures }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const userId = identity.subject;
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const site of sites) {
      await ctx.db.patch(site._id, { planFeatures });
    }
  },
});

// Count sites owned by a specific user
export const countByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return sites.length;
  },
});

// Wipe all data — for dev/reset only
// Admin: set plan features on a site directly
export const setPlanFeatures = mutation({
  args: { siteId: v.id("sites"), planFeatures: v.array(v.string()) },
  handler: async (ctx, { siteId, planFeatures }) => {
    await ctx.db.patch(siteId, { planFeatures } as any);
  },
});

export const resetAll = mutation({
  handler: async (ctx) => {
    const tables = ["sites", "pages", "topic_clusters", "articles", "jobs"] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

// One-off: fix orphaned sites that have no userId
export const fixOrphanSites = mutation({
  args: { clerkUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.clerkUserId;
    if (!userId) return { fixed: 0, userId: null };
    const allSites = await ctx.db.query('sites').collect();
    let fixed = 0;
    for (const site of allSites) {
      if (!site.userId) {
        await ctx.db.patch(site._id, { userId });
        fixed++;
      }
    }
    return { fixed, userId };
  },
});
