import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { ALL_FEATURE_KEYS, getLimitsFromFeatures } from "./planLimits";
import type { Id } from "./_generated/dataModel";
import { sanitizeSiteForClient } from "./lib/siteSecurity";
import {
  shouldCancelForEpochTransition,
} from "./lib/jobRollout";
import {
  requireSafeGitHubDefaultBranch,
  safeGitHubRepositoryPart,
} from "./lib/publicationArtifact";

const now = () => Date.now();
const DELIVERY_CONFIG_KEYS = new Set([
  "domain", "publishMethod", "repoOwner", "repoName", "repoDefaultBranch", "githubToken",
  "wpUrl", "wpUsername", "wpAppPassword", "webhookUrl", "webhookSecret",
  "urlStructure", "brandPrimaryColor", "brandAccentColor", "brandFontFamily",
  "autopilotEnabled",
]);

function deliveryConfigChanged(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return Object.entries(patch).some(
    ([key, value]) => DELIVERY_CONFIG_KEYS.has(key) && site[key] !== value,
  );
}

function githubRepositoryChanged(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return ["repoOwner", "repoName"].some(
    (key) =>
      Object.prototype.hasOwnProperty.call(patch, key) &&
      patch[key] !== site[key],
  );
}

function clearStaleGitHubBranch(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  if (githubRepositoryChanged(site, patch)) {
    // Only the trusted OAuth connection path can restore this value after it
    // verifies the repository metadata with GitHub.
    patch.repoDefaultBranch = undefined;
  }
}

function assertConfigUnlocked(site: { publicationLeaseOwner?: string; publicationLeaseExpiresAt?: number }) {
  if (site.publicationLeaseOwner && (site.publicationLeaseExpiresAt ?? 0) > now()) {
    throw new Error("Publishing settings are locked while a publication is in progress");
  }
}

/** Atomically retire autonomous work from the previous rollout epoch. Manual
 * owner-requested work is intentionally independent of the autonomous rollout. */
async function cancelAutonomousJobsForEpochTransition(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  reason: string,
): Promise<number> {
  const [pending, running] = await Promise.all([
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "pending"),
      )
      .collect(),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "running"),
      )
      .collect(),
  ]);
  let cancelled = 0;
  for (const job of [...pending, ...running]) {
    if (!shouldCancelForEpochTransition(job)) continue;
    if (job.reservationId && !job.articleId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === job._id) {
        await ctx.db.delete(reservation._id);
      }
    }
    const payload = job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};
    if (payload.topicId) {
      const topicId = ctx.db.normalizeId("topic_clusters", String(payload.topicId));
      const topic = topicId ? await ctx.db.get(topicId) : null;
      if (topic?.siteId === siteId && topic.status === "queued") {
        await ctx.db.patch(topic._id, { status: "pending", updatedAt: now() });
      }
    }
    await ctx.db.patch(job._id, {
      status: "failed",
      error: `Cancelled by rollout epoch transition: ${reason}`,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: now(),
    });
    cancelled += 1;
  }
  return cancelled;
}

async function requireSiteOwner(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");

  const site = await ctx.db.get(siteId);
  if (!site || site.userId !== identity.subject) {
    throw new Error("Site not found");
  }
  return site;
}

export const list = query({
  args: { clerkUserId: v.optional(v.string()) },
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId) return [];
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();
    return sites.map(sanitizeSiteForClient);
  },
});

export const get = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    try {
      const site = await requireSiteOwner(ctx, siteId);
      return sanitizeSiteForClient(site);
    } catch {
      return null;
    }
  },
});

export const getFull = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => ctx.db.get(siteId),
});

export const patchInternal = internalMutation({
  args: { siteId: v.id("sites"), patch: v.any() },
  handler: async (ctx, { siteId, patch }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");

    const safePatch = Object.fromEntries(
      Object.entries((patch ?? {}) as Record<string, unknown>).filter(
        ([key, value]) =>
          value !== undefined &&
          !["_id", "_creationTime", "userId", "createdAt"].includes(key),
      ),
    );
    const invalidatesRollout = deliveryConfigChanged(site, safePatch);
    if (invalidatesRollout) assertConfigUnlocked(site);
    if (invalidatesRollout) {
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "publishing configuration changed",
      );
    }
    await ctx.db.patch(siteId, {
      ...safePatch,
      ...(invalidatesRollout
        ? {
            autopilotRolloutMode: "observe",
            autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
          }
        : {}),
      updatedAt: now(),
    });
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
    verifiedKeywordDataRequired: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()),
    mediumToken: v.optional(v.string()),
    linkedinAccessToken: v.optional(v.string()),
    syndicationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId) throw new Error("Authentication required");

    const currentSite = args.id ? await requireSiteOwner(ctx, args.id) : null;

    // ── Site count limit (only on new site creation, not updates) ──
    if (!args.id && userId) {
      const existingSites = await ctx.db
        .query("sites")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      // Check if any existing site has planFeatures to determine limits
      const features = existingSites[0]?.planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);

      // Check if domain already exists (would be an update, not new)
      const domainNorm = args.domain.trim().toLowerCase();
      const domainExists = existingSites.some((s) => s.domain === domainNorm);

      if (!domainExists) {
        // Count active sites — use actual site count, not immutable usage_log,
        // so users can re-add sites after deleting them.
        if (existingSites.length >= limits.maxSites) {
          throw new Error(
            `Site limit reached (${existingSites.length}/${limits.maxSites}). Upgrade your plan to add more sites.`,
          );
        }
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
      verifiedKeywordDataRequired: args.verifiedKeywordDataRequired,
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
      clearStaleGitHubBranch(currentSite!, definedData);
      const invalidatesRollout = deliveryConfigChanged(currentSite!, definedData);
      if (invalidatesRollout) assertConfigUnlocked(currentSite!);
      if (invalidatesRollout) {
        await cancelAutonomousJobsForEpochTransition(
          ctx,
          args.id,
          "site configuration changed",
        );
      }
      await ctx.db.patch(args.id, {
        ...definedData,
        ...(invalidatesRollout
          ? {
              autopilotRolloutMode: "observe",
              autopilotRolloutEpoch:
                (currentSite!.autopilotRolloutEpoch ?? 0) + 1,
            }
          : {}),
      });
      return args.id;
    }

    const existing = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();

    if (existing?._id) {
      if (existing.userId !== userId) {
        throw new Error("This domain is already connected to another account");
      }
      // Merge: only overwrite fields that are explicitly provided
      const merged: Record<string, unknown> = { updatedAt: now(), userId };
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedAt") continue;
        merged[key] = value ?? (existing as Record<string, unknown>)[key];
      }
      clearStaleGitHubBranch(existing, merged);
      const invalidatesRollout = deliveryConfigChanged(existing, merged);
      if (invalidatesRollout) assertConfigUnlocked(existing);
      if (invalidatesRollout) {
        await cancelAutonomousJobsForEpochTransition(
          ctx,
          existing._id,
          "site configuration changed",
        );
      }
      await ctx.db.patch(existing._id, {
        ...merged,
        ...(invalidatesRollout
          ? {
              autopilotRolloutMode: "observe",
              autopilotRolloutEpoch:
                (existing.autopilotRolloutEpoch ?? 0) + 1,
            }
          : {}),
      });
      return existing._id;
    }

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
      autopilotRolloutMode: "observe",
      autopilotRolloutEpoch: 0,
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
    verifiedKeywordDataRequired: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()),
    brandPrimaryColor: v.optional(v.string()),
    brandAccentColor: v.optional(v.string()),
    brandFontFamily: v.optional(v.string()),
    targetCountry: v.optional(v.string()),
    targetAudienceSummary: v.optional(v.string()),
    painPoints: v.optional(v.array(v.string())),
    competitors: v.optional(v.array(v.string())),
    // Publishing config
    publishMethod: v.optional(v.string()),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
    wpUrl: v.optional(v.string()),
    wpUsername: v.optional(v.string()),
    wpAppPassword: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    // Syndication
    mediumToken: v.optional(v.string()),
    linkedinAccessToken: v.optional(v.string()),
    syndicationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { siteId, ...fields }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const patch: Record<string, unknown> = { updatedAt: now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    clearStaleGitHubBranch(site, patch);
    const invalidatesRollout = deliveryConfigChanged(site, patch);
    if (invalidatesRollout) assertConfigUnlocked(site);
    if (invalidatesRollout) {
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "site settings changed",
      );
    }
    await ctx.db.patch(siteId, {
      ...patch,
      ...(invalidatesRollout
        ? {
            autopilotRolloutMode: "observe",
            autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
          }
        : {}),
    });
  },
});

// Delete a single site and all its related data
export const deleteSite = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (site.publicationLeaseOwner) {
      throw new Error("Cannot delete a site while a publication lease exists");
    }
    // Delete articles
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    if (articles.some((article) => article.publicationLeaseOwner)) {
      throw new Error("Cannot delete a site while an article publication lease exists");
    }
    for (const a of articles) await ctx.db.delete(a._id);

    const articleSummaries = await ctx.db
      .query("article_summaries")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const summary of articleSummaries) await ctx.db.delete(summary._id);

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

    const searchPerformance = await ctx.db
      .query("search_performance")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const row of searchPerformance) await ctx.db.delete(row._id);

    const autopilotRuns = await ctx.db
      .query("autopilot_runs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const row of autopilotRuns) await ctx.db.delete(row._id);
    const autopilotHealth = await ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const row of autopilotHealth) await ctx.db.delete(row._id);
    const autopilotAlerts = await ctx.db
      .query("autopilot_alerts")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const row of autopilotAlerts) await ctx.db.delete(row._id);

    // Delete the site itself
    await ctx.db.delete(siteId);
  },
});

// List ALL sites for trusted cron/actions only.
export const listAllForAutopilot = internalQuery({
  handler: async (ctx) => {
    return ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .take(50);
  },
});

export const countByUserBounded = internalQuery({
  args: { userId: v.string(), maximum: v.number() },
  handler: async (ctx, { userId, maximum }) => {
    const safeMaximum = Math.max(0, Math.min(100, Math.floor(maximum)));
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(safeMaximum + 1);
    return sites.length;
  },
});

// This is deliberately internal-only: ordinary site settings cannot opt a
// tenant into paid generation or external publication. Warm mode builds a
// sealed buffer with delivery disabled; live mode is allowed only after that
// buffer is present. Advancing the epoch invalidates every older queued job.
export const setAutopilotRollout = internalMutation({
  args: {
    siteId: v.id("sites"),
    mode: v.union(v.literal("observe"), v.literal("warm"), v.literal("live")),
  },
  handler: async (ctx, { siteId, mode }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    assertConfigUnlocked(site);
    if (!site.autopilotEnabled && mode !== "observe") {
      throw new Error("Autopilot must be enabled before controlled rollout");
    }

    if (mode !== "observe") {
      const [warm, live] = await Promise.all([
        ctx.db
          .query("sites")
          .withIndex("by_rollout", (q) =>
            q.eq("autopilotRolloutMode", "warm").eq("autopilotEnabled", true),
          )
          .take(2),
        ctx.db
          .query("sites")
          .withIndex("by_rollout", (q) =>
            q.eq("autopilotRolloutMode", "live").eq("autopilotEnabled", true),
          )
          .take(2),
      ]);
      const otherActive = [...warm, ...live].find(
        (candidate) => candidate._id !== siteId,
      );
      if (otherActive) {
        throw new Error(
          `A different tenant is already in controlled rollout (${otherActive._id})`,
        );
      }
    }

    if (mode === "live") {
      const ready = await ctx.db
        .query("article_summaries")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "ready"),
        )
        .take(10);
      const sealed = ready.filter(
        (article) =>
          article.publicationGateStatus === "passed" &&
          article.publicationAuditVersion === 4 &&
          !!article.auditedContentHash,
      );
      if (sealed.length < 2) {
        throw new Error(
          `Live rollout requires at least two sealed articles; found ${sealed.length}`,
        );
      }
    }

    const rolloutEpoch = (site.autopilotRolloutEpoch ?? 0) + 1;
    const cancelledJobs = await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      `${site.autopilotRolloutMode ?? "observe"} -> ${mode}`,
    );
    await ctx.db.patch(siteId, {
      autopilotRolloutMode: mode,
      autopilotRolloutEpoch: rolloutEpoch,
      updatedAt: Date.now(),
    });
    return { mode, rolloutEpoch, cancelledJobs };
  },
});

// Plan features are accepted only from the authenticated Next.js billing bridge.
export const syncPlanFeaturesInternal = internalMutation({
  args: { userId: v.string(), planFeatures: v.array(v.string()) },
  handler: async (ctx, { userId, planFeatures }) => {
    const allowedFeatures = new Set(ALL_FEATURE_KEYS);
    const verifiedFeatures = planFeatures.filter((feature) =>
      allowedFeatures.has(feature),
    );
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const site of sites) {
      await ctx.db.patch(site._id, { planFeatures: verifiedFeatures });
    }
  },
});

// Count sites for trusted server-side diagnostics.
export const countByUser = internalQuery({
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
export const setPlanFeatures = internalMutation({
  args: { siteId: v.id("sites"), planFeatures: v.array(v.string()) },
  handler: async (ctx, { siteId, planFeatures }) => {
    await ctx.db.patch(siteId, { planFeatures });
  },
});

export const resetAll = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    for (const site of sites) {
      if (site.publicationLeaseOwner) {
        throw new Error("Cannot reset data while a publication lease exists");
      }
      const leasedArticles = await ctx.db
        .query("articles")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect();
      if (leasedArticles.some((article) => article.publicationLeaseOwner)) {
        throw new Error("Cannot reset data while an article publication lease exists");
      }
      const rowsByTable = await Promise.all([
        ctx.db.query("pages").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("topic_clusters").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("articles").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("article_summaries").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("jobs").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("search_performance").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("autopilot_runs").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("autopilot_health").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
        ctx.db.query("autopilot_alerts").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
      ]);
      for (const rows of rowsByTable) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
      await ctx.db.delete(site._id);
    }
  },
});

// One-off: fix orphaned sites that have no userId
export const fixOrphanSites = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = args.clerkUserId;
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

// Set GitHub OAuth token via HTTP API (accepts string siteId)
export const setGithubTokenInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    githubToken: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    repoDefaultBranch: v.string(),
  },
  handler: async (
    ctx,
    { siteId, githubToken, repoOwner, repoName, repoDefaultBranch },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const currentRepoOwner = safeGitHubRepositoryPart(site.repoOwner, "owner");
    const currentRepoName = safeGitHubRepositoryPart(
      site.repoName,
      "repository name",
    );
    if (currentRepoOwner !== repoOwner || currentRepoName !== repoName) {
      throw new Error(
        "GitHub repository settings changed during connection; reconnect to verify the current repository",
      );
    }
    const verifiedDefaultBranch = requireSafeGitHubDefaultBranch(repoDefaultBranch);
    const invalidatesRollout =
      site.githubToken !== githubToken ||
      site.repoDefaultBranch !== verifiedDefaultBranch;
    if (invalidatesRollout) {
      assertConfigUnlocked(site);
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "GitHub connection or verified default branch changed",
      );
    }
    await ctx.db.patch(site._id, {
      githubToken,
      repoDefaultBranch: verifiedDefaultBranch,
      ...(invalidatesRollout
        ? {
            autopilotRolloutMode: "observe" as const,
            autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
          }
        : {}),
      updatedAt: now(),
    });
  },
});

// Set Google Search Console OAuth tokens via HTTP API
export const setGscTokenInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    gscAccessToken: v.string(),
    gscRefreshToken: v.optional(v.string()),
    gscProperty: v.optional(v.string()),
    gscEmail: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, gscAccessToken, gscRefreshToken, gscProperty, gscEmail }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    if (!gscProperty && !site.gscProperty) {
      throw new Error("A matching Search Console property is required for the initial connection");
    }
    await ctx.db.patch(site._id, {
      gscAccessToken,
      ...(gscRefreshToken ? { gscRefreshToken } : {}),
      ...(gscProperty ? { gscProperty } : {}),
      ...(gscEmail ? { gscEmail } : {}),
      ...(!site.gscConnectedAt ? { gscConnectedAt: now() } : {}),
      updatedAt: now(),
    });
  },
});

// Disconnect Google Search Console
export const disconnectGsc = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    await ctx.db.patch(siteId, {
      gscAccessToken: undefined,
      gscRefreshToken: undefined,
      gscProperty: undefined,
      gscEmail: undefined,
      gscConnectedAt: undefined,
      updatedAt: now(),
    });
  },
});
