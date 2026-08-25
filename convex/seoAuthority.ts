import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  authorityDiscoveryPolicyFor,
  evaluateAuthorityDiscoveryCapacity,
  AUTHORITY_DISCOVERY_RESERVATION_TTL_MS,
  type AuthorityDiscoveryTrigger,
} from "./lib/authorityDiscoveryBudget";
import {
  releaseSharedProviderReservation,
  reserveSharedProviderBudget,
  type ProviderReservationReleaseReason,
} from "./lib/providerSpendReservation";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import { accountDeletionKey } from "./lib/accountDeletion";
import { outreachMessageOwnerMatches } from "./lib/outreachAutonomy";
import {
  articleMatchesCurrentDomain,
  normalizeCanonicalDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding";

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to access this site's authority opportunities");
  }
  return site;
}

function authorityOpportunityMatchesCurrentDomain(
  site: Doc<"sites">,
  opportunity: Doc<"seo_authority_opportunities">,
): boolean {
  if (
    opportunity.canonicalDomain !== undefined ||
    opportunity.domainRevision !== undefined
  ) {
    return normalizeCanonicalDomain(opportunity.canonicalDomain ?? "") ===
        siteCanonicalDomain(site) &&
      opportunity.domainRevision === siteCanonicalDomainRevision(site);
  }
  return siteUsesLegacyDomainReceipts(site);
}

function authorityRunMatchesCurrentDomain(
  site: Doc<"sites">,
  run: Doc<"seo_authority_runs">,
): boolean {
  if (run.canonicalDomain !== undefined || run.domainRevision !== undefined) {
    return normalizeCanonicalDomain(run.canonicalDomain ?? "") ===
        siteCanonicalDomain(site) &&
      run.domainRevision === siteCanonicalDomainRevision(site);
  }
  return siteUsesLegacyDomainReceipts(site);
}

function safeTrigger(value: string): AuthorityDiscoveryTrigger {
  if (value !== "owner" && value !== "growth") {
    throw new Error("Unknown authority discovery trigger");
  }
  return value;
}

/**
 * Atomically reserve one complete authority-discovery attempt.
 *
 * Owner clicks and autonomous growth enter through this same mutation. Paid
 * tiers receive the full daily policy; Free receives the included, bounded
 * 30-day policy. Every tier still passes the same evidence and safety gates.
 */
export const reserveDiscoveryRun = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.optional(v.id("articles")),
    trigger: v.string(),
    ownerUserId: v.optional(v.string()),
    growthActionFingerprint: v.optional(v.string()),
    growthMeasurementKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trigger = safeTrigger(args.trigger);
    const site = await ctx.db.get(args.siteId);
    if (
      !site ||
      !site.userId ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      return { allowed: false as const, reason: "site_unavailable" as const };
    }
    if (trigger === "owner" && args.ownerUserId !== site.userId) {
      throw new Error("Authority discovery reservation crossed an owner boundary");
    }
    const canonicalDomain = siteCanonicalDomain(site);
    const domainRevision = siteCanonicalDomainRevision(site);
    if (!canonicalDomain) {
      return { allowed: false as const, reason: "site_unavailable" as const };
    }
    if (args.articleId) {
      const article = await ctx.db.get(args.articleId);
      if (
        !article ||
        article.siteId !== args.siteId ||
        !articleMatchesCurrentDomain(site, article)
      ) {
        throw new Error("Authority discovery reservation crossed an article boundary");
      }
    }
    if (
      trigger === "growth" &&
      (
        !args.articleId ||
        !site.autopilotEnabled ||
        !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
      )
    ) {
      return { allowed: false as const, reason: "rollout_ineligible" as const };
    }
    if (trigger === "growth") {
      const action = args.growthActionFingerprint
        ? await ctx.db
          .query("seo_growth_actions")
          .withIndex("by_fingerprint", (q) =>
            q.eq("fingerprint", args.growthActionFingerprint!)
          )
          .unique()
        : null;
      if (
        !action ||
        action.siteId !== args.siteId ||
        action.articleId !== args.articleId ||
        action.status !== "open" ||
        !args.growthMeasurementKey ||
        action.measurementKey !== args.growthMeasurementKey ||
        action.measurementCanonicalDomain !== canonicalDomain ||
        action.measurementDomainRevision !== domainRevision ||
        action.measurementGscConnectionRevision !==
          siteGscConnectionRevision(site) ||
        action.measurementGscProperty !== site.gscProperty ||
        action.measurementGscSyncEpoch !== site.gscSyncEpoch ||
        action.measurementGscDataThrough !== site.gscDataThrough
      ) {
        return {
          allowed: false as const,
          reason: "growth_measurement_superseded" as const,
        };
      }
    }

    const policy = authorityDiscoveryPolicyFor({
      trigger,
      planFeatures: site.planFeatures ?? [],
    });
    if (!policy) {
      return {
        allowed: false as const,
        reason: "plan_entitlement_missing" as const,
      };
    }

    const timestamp = Date.now();
    const running = (await ctx.db
      .query("seo_authority_runs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", args.siteId).eq("status", "running")
      )
      .collect()).filter((run) => authorityRunMatchesCurrentDomain(site, run));
    let hasActiveReservation = false;
    for (const run of running) {
      if (run.expiresAt > timestamp) {
        hasActiveReservation = true;
        continue;
      }
      // A killed action still consumed its reservation. Settle the abandoned
      // attempt before evaluating a new one instead of refunding/replaying it.
      await ctx.db.patch(run._id, {
        status: "settled",
        outcome: "reservation_expired",
        errorCategory: "worker_interrupted",
        settledAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const recent = (
      await ctx.db
        .query("seo_authority_runs")
        .withIndex("by_site_created", (q) => q.eq("siteId", args.siteId))
        .order("desc")
        .take(100)
    ).filter((run) => authorityRunMatchesCurrentDomain(site, run)).slice(0, 20);
    // A provider-account preflight performs no paid work and releases the
    // shared reservation. It therefore must not burn the tenant's 24-hour or
    // 30-day discovery allowance. The shared ledger applies a short global
    // retry cooldown so a depleted wallet cannot spin across tenants.
    const latest = recent.find(
      (run) => run.outcome !== "provider_balance_unavailable",
    );
    const capacity = evaluateAuthorityDiscoveryCapacity({
      hasActiveReservation,
      latestSiteAttemptAt: latest?.createdAt,
      now: timestamp,
      cooldownMs: policy.cooldownMs,
    });
    if (!capacity.allowed) {
      return { allowed: false as const, reason: capacity.reason };
    }

    const shared = await reserveSharedProviderBudget(ctx, {
      siteId: args.siteId,
      userId: site.userId,
      purpose: "authority_discovery",
      trigger,
      reservedMicroUsd: policy.providerCostCeilingMicroUsd,
      timestamp,
    });
    if (!shared.ok) {
      return { allowed: false as const, reason: shared.reason };
    }

    const runId = await ctx.db.insert("seo_authority_runs", {
      siteId: args.siteId,
      userId: site.userId,
      canonicalDomain,
      domainRevision,
      growthActionFingerprint: args.growthActionFingerprint,
      growthMeasurementKey: args.growthMeasurementKey,
      articleId: args.articleId,
      trigger,
      mode: policy.mode,
      policyVersion: policy.version,
      status: "running",
      providerCostCeilingMicroUsd: policy.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd: policy.providerCostCeilingMicroUsd,
      providerSpendReservationId: shared.reservationId,
      providerCallLimit: policy.providerCallLimit,
      openAiCallLimit: policy.openAiCallLimit,
      candidateLimit: policy.candidateLimit,
      pageFetchLimit: policy.pageFetchLimit,
      totalDeadlineMs: policy.totalDeadlineMs,
      expiresAt: timestamp + AUTHORITY_DISCOVERY_RESERVATION_TTL_MS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      allowed: true as const,
      runId,
      policy,
      canonicalDomain,
      domainRevision,
      providerSpendReservationId: shared.reservationId,
    };
  },
});

export const abortDiscoveryRunForProviderBalance = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("seo_authority_runs"),
    releaseReason: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.siteId !== args.siteId) {
      throw new Error("Authority discovery abort crossed a tenant boundary");
    }
    if (run.status === "settled") {
      return { aborted: false, alreadySettled: true, released: false };
    }
    const releaseReason = args.releaseReason as ProviderReservationReleaseReason;
    if (
      releaseReason !== "provider_balance_insufficient" &&
      releaseReason !== "provider_balance_preflight_unavailable"
    ) {
      throw new Error("Unknown provider reservation release reason");
    }
    const timestamp = Date.now();
    const released = (await releaseSharedProviderReservation(ctx, {
      reservationId: run.providerSpendReservationId,
      siteId: args.siteId,
      purpose: "authority_discovery",
      reason: releaseReason,
      timestamp,
    })).released;
    await ctx.db.patch(args.runId, {
      status: "settled",
      outcome: "provider_balance_unavailable",
      errorCategory: releaseReason,
      providerCallsAttempted: 0,
      openAiCallsAttempted: 0,
      candidatesConsidered: 0,
      pageFetchesAttempted: 0,
      profileComplete: false,
      mentionsApplicable: true,
      mentionsComplete: false,
      brokenLinksApplicable: false,
      brokenLinksComplete: false,
      verifiedOpportunities: 0,
      settledAt: timestamp,
      updatedAt: timestamp,
    });
    return { aborted: true, alreadySettled: false, released };
  },
});

export const settleDiscoveryRun = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("seo_authority_runs"),
    outcome: v.string(),
    errorCategory: v.optional(v.string()),
    providerCallsAttempted: v.number(),
    openAiCallsAttempted: v.number(),
    candidatesConsidered: v.number(),
    pageFetchesAttempted: v.number(),
    profileComplete: v.boolean(),
    mentionsApplicable: v.boolean(),
    mentionsComplete: v.boolean(),
    brokenLinksApplicable: v.boolean(),
    brokenLinksComplete: v.boolean(),
    verifiedOpportunities: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.siteId !== args.siteId) {
      throw new Error("Authority discovery settlement crossed a tenant boundary");
    }
    if (run.status === "settled") return { settled: false, alreadySettled: true };
    const timestamp = Date.now();
    await ctx.db.patch(args.runId, {
      status: "settled",
      outcome: args.outcome,
      errorCategory: args.errorCategory,
      providerCallsAttempted: args.providerCallsAttempted,
      openAiCallsAttempted: args.openAiCallsAttempted,
      candidatesConsidered: args.candidatesConsidered,
      pageFetchesAttempted: args.pageFetchesAttempted,
      profileComplete: args.profileComplete,
      mentionsApplicable: args.mentionsApplicable,
      mentionsComplete: args.mentionsComplete,
      brokenLinksApplicable: args.brokenLinksApplicable,
      brokenLinksComplete: args.brokenLinksComplete,
      verifiedOpportunities: args.verifiedOpportunities,
      settledAt: timestamp,
      updatedAt: timestamp,
    });
    return { settled: true, alreadySettled: false };
  },
});

export const upsertVerifiedBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("seo_authority_runs"),
    opportunities: v.array(v.object({
      articleId: v.optional(v.id("articles")),
      fingerprint: v.string(),
      type: v.string(),
      sourceDomain: v.string(),
      sourceUrl: v.string(),
      targetUrl: v.string(),
      context: v.string(),
      anchorText: v.optional(v.string()),
      relevanceTerms: v.optional(v.array(v.string())),
      domainRank: v.optional(v.number()),
      evidenceHash: v.string(),
      verifiedAt: v.number(),
    })),
  },
  handler: async (ctx, { siteId, runId, opportunities }) => {
    const [site, run] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(runId),
    ]);
    const canonicalDomain = site ? siteCanonicalDomain(site) : null;
    const domainRevision = site ? siteCanonicalDomainRevision(site) : -1;
    if (
      !siteExecutionActive(site) ||
      !canonicalDomain ||
      !run ||
      run.siteId !== siteId ||
      run.status !== "running" ||
      normalizeCanonicalDomain(run.canonicalDomain ?? "") !== canonicalDomain ||
      run.domainRevision !== domainRevision
    ) {
      throw new Error("Site not found");
    }
    if (run.trigger === "growth") {
      const action = run.growthActionFingerprint
        ? await ctx.db
          .query("seo_growth_actions")
          .withIndex("by_fingerprint", (q) =>
            q.eq("fingerprint", run.growthActionFingerprint!)
          )
          .unique()
        : null;
      if (
        !action ||
        action.siteId !== siteId ||
        action.articleId !== run.articleId ||
        action.status !== "open" ||
        action.measurementKey !== run.growthMeasurementKey ||
        action.measurementCanonicalDomain !== canonicalDomain ||
        action.measurementDomainRevision !== domainRevision ||
        action.measurementGscConnectionRevision !==
          siteGscConnectionRevision(site) ||
        action.measurementGscProperty !== site.gscProperty ||
        action.measurementGscSyncEpoch !== site.gscSyncEpoch ||
        action.measurementGscDataThrough !== site.gscDataThrough
      ) {
        throw new Error("Authority discovery growth measurement was superseded");
      }
    }
    let inserted = 0;
    let updated = 0;
    for (const opportunity of opportunities) {
      if (opportunity.articleId) {
        const article = await ctx.db.get(opportunity.articleId);
        if (
          !article ||
          article.siteId !== siteId ||
          !articleMatchesCurrentDomain(site, article)
        ) {
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
        canonicalDomain,
        domainRevision,
        lastCheckedAt: opportunity.verifiedAt,
        updatedAt: opportunity.verifiedAt,
      };
      if (existing) {
        if (
          existing.siteId !== siteId ||
          !authorityOpportunityMatchesCurrentDomain(site, existing)
        ) {
          throw new Error("Authority fingerprint belongs to another tenant");
        }
        const messages = existing.status === "outreach_prepared"
          ? await ctx.db
              .query("outreach_messages")
              .withIndex("by_opportunity", (q) =>
                q.eq("opportunityId", existing._id)
              )
              .collect()
          : [];
        const hasLiveOrDeliveredMessage = messages.some((message) =>
          [
            "draft",
            "approved",
            "sending",
            "delivery_unverified",
            "delivery_reviewed_sent",
            "sent",
            "replied",
          ].includes(message.status)
        );
        const freshlyRecoverable =
          existing.status === "rejected" ||
          (
            existing.status === "outreach_prepared" &&
            !hasLiveOrDeliveredMessage
          );
        // A previously stale opportunity becomes actionable again when a
        // fresh fetch confirms the exact evidence. A discarded or definitively
        // failed draft may then receive a brand-new review; the old message is
        // never retried. Preserve active and delivered histories.
        await ctx.db.patch(existing._id, {
          ...patch,
          ...(
            freshlyRecoverable
              ? {
                  status: "verified",
                  rejectedAt: undefined,
                  outreachPreparedAt: undefined,
                }
              : {}
          ),
        });
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

async function listAuthorityByCurrentDomainStatus(
  ctx: QueryCtx,
  site: Doc<"sites">,
  status: string,
  limit: number,
) {
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const rows = await ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .order("desc")
      .take(limit);
    return rows.filter((row) =>
      authorityOpportunityMatchesCurrentDomain(site, row)
    );
  }
  return ctx.db
    .query("seo_authority_opportunities")
    .withIndex("by_site_domain_revision_status", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
        .eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export const listVerified = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const site = await requireSiteOwner(ctx, siteId);
    return listAuthorityByCurrentDomainStatus(
      ctx,
      site,
      "verified",
      Math.max(1, Math.min(limit ?? 50, 100)),
    );
  },
});

/**
 * Owner-facing authority ledger for the Backlinks dashboard.
 *
 * The UI needs the complete evidence trail, not only today's actionable rows:
 * prepared/contacted/acquired opportunities are durable receipts, while
 * rejected rows explain why an item disappeared from the queue. Querying each
 * indexed status also keeps one tenant's ledger physically scoped to its site.
 */
export const listForSite = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const take = Math.max(1, Math.min(limit ?? 100, 200));
    const statuses = [
      "verified",
      "outreach_prepared",
      "contacted",
      "acquired",
      "rejected",
    ];
    const batches = await Promise.all(
      statuses.map((status) =>
        listAuthorityByCurrentDomainStatus(ctx, site, status, take)
      ),
    );
    return batches
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, take);
  },
});

export const listVerifiedInternal = internalQuery({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return [];
    return listAuthorityByCurrentDomainStatus(
      ctx,
      site,
      "verified",
      Math.max(1, Math.min(limit ?? 50, 200)),
    );
  },
});

export const listByStatusInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    status: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, status, limit }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return [];
    return listAuthorityByCurrentDomainStatus(
      ctx,
      site,
      status,
      Math.max(1, Math.min(limit ?? 50, 200)),
    );
  },
});

async function messageBelongsToAuthorityOpportunity(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  siteId: Id<"sites">,
  opportunityId: Id<"seo_authority_opportunities">,
  ownerAccountKey: string,
): Promise<boolean> {
  if (
    message.siteId !== siteId ||
    message.opportunityId !== opportunityId ||
    !outreachMessageOwnerMatches(message, ownerAccountKey)
  ) return false;
  if (!message.inboxId) return true;
  const inbox = await ctx.db.get(message.inboxId);
  return Boolean(inbox && inbox.siteId === siteId);
}

/**
 * A link is only acquired once the exact live link has been observed on the
 * exact page. The caller supplies the page it saw; this records it as the
 * receipt so the claim can be re-checked later.
 */
export const markAcquired = internalMutation({
  args: {
    siteId: v.id("sites"),
    opportunityId: v.id("seo_authority_opportunities"),
    acquiredLinkUrl: v.string(),
  },
  handler: async (ctx, { siteId, opportunityId, acquiredLinkUrl }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site) || !site.userId) throw new Error("Site not found");
    const ownerAccountKey = accountDeletionKey(site.userId);
    const opportunity = await ctx.db.get(opportunityId);
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity)
    ) {
      throw new Error("Authority opportunity not found for site");
    }
    const timestamp = Date.now();
    await ctx.db.patch(opportunityId, {
      status: "acquired",
      acquiredAt: opportunity.acquiredAt ?? timestamp,
      acquiredLinkUrl,
      lastCheckedAt: timestamp,
      updatedAt: timestamp,
    });
    const queued = await ctx.db
      .query("outreach_messages")
      .withIndex("by_opportunity", (q) => q.eq("opportunityId", opportunityId))
      .take(20);
    for (const message of queued) {
      if (
        !["draft", "blocked", "approved"].includes(message.status) ||
        !(await messageBelongsToAuthorityOpportunity(
          ctx,
          message,
          siteId,
          opportunityId,
          ownerAccountKey,
        ))
      ) continue;
      await ctx.db.patch(message._id, {
        status: "skipped",
        blockedReason:
          "The exact backlink was acquired before this message became due.",
        updatedAt: timestamp,
      });
    }
  },
});

/**
 * A link that was previously verified as acquired and is now gone. Reverting
 * to contacted keeps the history honest rather than leaving a stale claim.
 */
export const markAcquiredLinkLost = internalMutation({
  args: {
    siteId: v.id("sites"),
    opportunityId: v.id("seo_authority_opportunities"),
  },
  handler: async (ctx, { siteId, opportunityId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site) || !site.userId) throw new Error("Site not found");
    const opportunity = await ctx.db.get(opportunityId);
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity)
    ) {
      throw new Error("Authority opportunity not found for site");
    }
    if (opportunity.status !== "acquired") return;
    const timestamp = Date.now();
    await ctx.db.patch(opportunityId, {
      status: "contacted",
      acquiredLinkUrl: undefined,
      lastCheckedAt: timestamp,
      updatedAt: timestamp,
    });
  },
});

/**
 * Retire opportunities a fresh scan no longer confirms.
 *
 * Evidence decays: a dead link gets fixed, a mention gets edited, and a
 * matching rule gets stricter. An unconfirmed opportunity left in the queue
 * becomes an email about something that is no longer true, so anything not
 * re-verified by the current scan is rejected. Contacted and acquired records
 * are untouched — those are history, not a queue.
 */
export const rejectUnconfirmed = internalMutation({
  args: {
    siteId: v.id("sites"),
    verifiedBefore: v.number(),
    types: v.optional(v.array(v.string())),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, { siteId, verifiedBefore, types, articleId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site) || !site.userId) throw new Error("Site not found");
    const ownerAccountKey = accountDeletionKey(site.userId);
    const timestamp = Date.now();
    let rejected = 0;
    for (const status of ["verified", "outreach_prepared"]) {
      const rows = await listAuthorityByCurrentDomainStatus(
        ctx,
        site,
        status,
        500,
      );
      for (const row of rows) {
        if (row.verifiedAt >= verifiedBefore) continue;
        if (types && !types.includes(row.type)) continue;
        // A focused scan can only invalidate evidence for the exact article
        // it inspected. Without this boundary, scanning article B retires
        // verified opportunities discovered for article A.
        if (articleId && row.articleId !== articleId) continue;
        await ctx.db.patch(row._id, {
          status: "rejected",
          rejectedAt: timestamp,
          updatedAt: timestamp,
        });
        const queued = await ctx.db
          .query("outreach_messages")
          .withIndex("by_opportunity", (q) => q.eq("opportunityId", row._id))
          .take(20);
        for (const message of queued) {
          if (
            !["draft", "blocked", "approved"].includes(message.status) ||
            !(await messageBelongsToAuthorityOpportunity(
              ctx,
              message,
              siteId,
              row._id,
              ownerAccountKey,
            ))
          ) continue;
          await ctx.db.patch(message._id, {
            status: "skipped",
            blockedReason:
              "The authority opportunity was not reconfirmed before this message became due.",
            updatedAt: timestamp,
          });
        }
        rejected++;
      }
    }
    return { rejected };
  },
});

export const getVerifiedBySource = internalQuery({
  args: { siteId: v.id("sites"), sourceUrl: v.string() },
  handler: async (ctx, { siteId, sourceUrl }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    const candidates = await listAuthorityByCurrentDomainStatus(
      ctx,
      site,
      "verified",
      100,
    );
    return candidates.find((candidate) => candidate.sourceUrl === sourceUrl) ?? null;
  },
});

export const markOutreachPrepared = internalMutation({
  args: {
    siteId: v.id("sites"),
    opportunityId: v.id("seo_authority_opportunities"),
  },
  handler: async (ctx, { siteId, opportunityId }) => {
    const [site, opportunity] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(opportunityId),
    ]);
    if (!siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity)
    ) {
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
