import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  decideOnboardingClaim,
  onboardingJobMatchesDomainBinding,
  onboardingFailureCooldownMs,
  onboardingInputFingerprint,
  ONBOARDING_CACHE_VERSION,
  ONBOARDING_LEASE_MS,
  ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD,
  ONBOARDING_WORKFLOW,
} from "./lib/onboardingClaim";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import { reserveSharedProviderBudget } from "./lib/providerSpendReservation";
import {
  contentAnalysisMatchesCurrentDomain,
  pageMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding";

const now = () => Date.now();

function completeLegacyProfile(site: Doc<"sites">): boolean {
  return Boolean(
    site.siteName &&
      site.siteType &&
      site.siteSummary &&
      site.blogTheme &&
      site.keyFeatures &&
      site.pricingInfo &&
      site.founders &&
      site.niche &&
      site.tone &&
      site.targetCountry &&
      site.targetAudienceSummary &&
      site.painPoints &&
      site.productUsage &&
      site.competitors &&
      site.anchorKeywords,
  );
}

function legacyResult(
  site: Doc<"sites">,
  pages: Doc<"pages">[],
): Record<string, unknown> {
  return {
    pages: pages.map((page) => ({
      slug: page.slug,
      title: page.title ?? page.slug,
      summary: page.summary ?? "",
      keywords: page.keywords,
    })),
    analysis: {
      siteName: site.siteName!,
      siteType: site.siteType!,
      siteSummary: site.siteSummary!,
      blogTheme: site.blogTheme!,
      keyFeatures: site.keyFeatures!,
      pricingInfo: site.pricingInfo!,
      founders: site.founders!,
      niche: site.niche!,
      tone: site.tone!,
      targetCountry: site.targetCountry!,
      targetAudienceSummary: site.targetAudienceSummary!,
      painPoints: site.painPoints!,
      productUsage: site.productUsage!,
      suggestedCompetitors: site.competitors!,
      suggestedAnchorKeywords: site.anchorKeywords!,
    },
    brand: {
      primaryColor: site.brandPrimaryColor ?? null,
      accentColor: site.brandAccentColor ?? null,
      fontFamily: site.brandFontFamily ?? null,
      logoUrl: site.brandLogoUrl ?? null,
    },
  };
}

function pagesMatchSiteDomain(
  domain: string,
  pages: readonly Doc<"pages">[],
): boolean {
  try {
    const siteOrigin = new URL(onboardingInputFingerprint(domain)).origin;
    return pages.every(
      (page) =>
        new URL(onboardingInputFingerprint(page.url)).origin === siteOrigin,
    );
  } catch {
    return false;
  }
}

export const claim = internalMutation({
  args: {
    siteId: v.id("sites"),
    workerToken: v.string(),
  },
  handler: async (
    ctx,
    { siteId, workerToken },
  ): Promise<
    | { status: "claimed"; jobId: Id<"jobs"> }
    | { status: "cached"; result: unknown }
    | { status: "in_progress" | "cooling_down"; retryAt: number }
    | { status: "budget_blocked"; reason: string }
  > => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("This site is not active under the current plan");
    }
    const canonicalDomain = siteCanonicalDomain(site);
    const domainRevision = siteCanonicalDomainRevision(site);
    if (!canonicalDomain) throw new Error("This site domain is invalid");
    const domainBinding = {
      canonicalDomain,
      domainRevision,
      legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
    };

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q.eq("siteId", siteId).eq("type", "onboarding"),
      )
      .order("desc")
      .take(50);
    const currentTime = now();
    const inputFingerprint = onboardingInputFingerprint(site.domain);
    const failureCountByFingerprint = new Map<string, number>();
    for (const job of jobs) {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      if (
        job.status === "failed" &&
        payload.workflow === ONBOARDING_WORKFLOW &&
        typeof payload.inputFingerprint === "string"
      ) {
        failureCountByFingerprint.set(
          payload.inputFingerprint,
          (failureCountByFingerprint.get(payload.inputFingerprint) ?? 0) + 1,
        );
      }
    }
    const currentFailureCount = jobs.filter((job) =>
      job.status === "failed" &&
      onboardingJobMatchesDomainBinding(
        job,
        inputFingerprint,
        domainBinding,
      )
    ).length;
    let expiredCurrentRetryAt: number | undefined;
    for (const job of jobs) {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      if (
        job.status === "running" &&
        payload.workflow === ONBOARDING_WORKFLOW &&
        (job.leaseExpiresAt ?? 0) <= currentTime
      ) {
        const expiredIsCurrent = onboardingJobMatchesDomainBinding(
          job,
          inputFingerprint,
          domainBinding,
        );
        const fingerprint = typeof payload.inputFingerprint === "string"
          ? payload.inputFingerprint
          : "legacy_unknown";
        const failureCount = expiredIsCurrent
          ? currentFailureCount + 1
          : (failureCountByFingerprint.get(fingerprint) ?? 0) + 1;
        failureCountByFingerprint.set(fingerprint, failureCount);
        const retryAt = currentTime +
          onboardingFailureCooldownMs(failureCount);
        await ctx.db.patch(job._id, {
          status: "failed",
          error: "Website analysis lease expired before completion",
          nextAttemptAt: retryAt,
          workerToken: undefined,
          heartbeatAt: undefined,
          leaseExpiresAt: undefined,
          updatedAt: currentTime,
        });
        if (expiredIsCurrent) {
          expiredCurrentRetryAt = Math.max(
            expiredCurrentRetryAt ?? 0,
            retryAt,
          );
        }
      }
    }
    if (expiredCurrentRetryAt !== undefined) {
      return {
        status: "cooling_down",
        retryAt: expiredCurrentRetryAt,
      };
    }
    const decision = decideOnboardingClaim(
      jobs,
      currentTime,
      inputFingerprint,
      domainBinding,
    );
    if (
      decision.status !== "claim" &&
      !(decision.status === "cached" &&
        !contentAnalysisMatchesCurrentDomain(site))
    ) return decision;

    // Older installations predate the receipt ledger. Hydrate one exact
    // success receipt from a complete stored profile instead of paying to
    // regenerate data Pentra already has.
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const hasVersionedReceipt = jobs.some((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return payload.workflow === ONBOARDING_WORKFLOW;
    });
    if (
      !hasVersionedReceipt &&
      pages.length > 0 &&
      pagesMatchSiteDomain(site.domain, pages) &&
      pages.every((page) => pageMatchesCurrentDomain(site, page)) &&
      contentAnalysisMatchesCurrentDomain(site) &&
      completeLegacyProfile(site)
    ) {
      const result = legacyResult(site, pages);
      await ctx.db.insert("jobs", {
        siteId,
        type: "onboarding",
        status: "done",
        payload: {
          workflow: ONBOARDING_WORKFLOW,
          cacheVersion: ONBOARDING_CACHE_VERSION,
          inputFingerprint,
          canonicalDomain,
          domainRevision,
          source: "legacy_profile",
        },
        result,
        workerAttempts: 0,
        publicationAttempts: 0,
        createdAt: currentTime,
        updatedAt: currentTime,
      });
      return { status: "cached", result };
    }

    const reservation = await reserveSharedProviderBudget(ctx, {
      siteId,
      userId: site.userId!,
      purpose: "onboarding_analysis",
      trigger: "owner_onboarding",
      reservedMicroUsd: ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD,
      timestamp: currentTime,
    });
    if (!reservation.ok) {
      return { status: "budget_blocked", reason: reservation.reason };
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "onboarding",
      status: "running",
      payload: {
        workflow: ONBOARDING_WORKFLOW,
        cacheVersion: ONBOARDING_CACHE_VERSION,
        inputFingerprint,
        canonicalDomain,
        domainRevision,
        source: "owner_onboarding",
      },
      workerToken,
      providerCostCeilingMicroUsd:
        ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservationDay: new Date(currentTime)
        .toISOString()
        .slice(0, 10),
      providerSpendReservationId: reservation.reservationId,
      workerAttempts: 1,
      publicationAttempts: 0,
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + ONBOARDING_LEASE_MS,
      createdAt: currentTime,
      updatedAt: currentTime,
    });
    return { status: "claimed", jobId };
  },
});

export const complete = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    result: v.any(),
  },
  handler: async (ctx, { siteId, jobId, workerToken, result }) => {
    const [job, site] = await Promise.all([
      ctx.db.get(jobId),
      ctx.db.get(siteId),
    ]);
    const canonicalDomain = site ? siteCanonicalDomain(site) : null;
    const domainRevision = site ? siteCanonicalDomainRevision(site) : -1;
    const inputFingerprint = site
      ? onboardingInputFingerprint(site.domain)
      : "";
    if (
      !job ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !canonicalDomain ||
      job.siteId !== siteId ||
      job.type !== "onboarding" ||
      job.status !== "running" ||
      job.workerToken !== workerToken ||
      !onboardingJobMatchesDomainBinding(
        job,
        inputFingerprint,
        {
          canonicalDomain,
          domainRevision,
          legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
        },
      )
    ) {
      throw new Error("Onboarding lease was lost before completion");
    }
    const currentTime = now();
    await ctx.db.patch(jobId, {
      status: "done",
      result,
      error: undefined,
      nextAttemptAt: undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    return { completed: true };
  },
});

export const fail = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, { siteId, jobId, workerToken }) => {
    const [job, site] = await Promise.all([
      ctx.db.get(jobId),
      ctx.db.get(siteId),
    ]);
    if (
      !job ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      job.siteId !== siteId ||
      job.type !== "onboarding" ||
      job.status !== "running" ||
      job.workerToken !== workerToken ||
      !onboardingJobMatchesDomainBinding(
        job,
        onboardingInputFingerprint(site.domain),
        {
          canonicalDomain: siteCanonicalDomain(site) ?? "",
          domainRevision: siteCanonicalDomainRevision(site),
          legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
        },
      )
    ) {
      return { failed: false };
    }
    const currentTime = now();
    const jobPayload = job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};
    const inputFingerprint = jobPayload.inputFingerprint;
    const payloadCanonicalDomain = jobPayload.canonicalDomain;
    const payloadDomainRevision = jobPayload.domainRevision;
    const legacySiteDomain = site ? siteCanonicalDomain(site) : null;
    const failureBinding =
      typeof payloadCanonicalDomain === "string" &&
        Number.isSafeInteger(payloadDomainRevision) &&
        (payloadDomainRevision as number) >= 0
        ? {
          canonicalDomain: payloadCanonicalDomain,
          domainRevision: payloadDomainRevision as number,
          legacyFallbackAllowed: false,
        }
        : site && legacySiteDomain && siteUsesLegacyDomainReceipts(site)
        ? {
          canonicalDomain: legacySiteDomain,
          domainRevision: siteCanonicalDomainRevision(site),
          legacyFallbackAllowed: true,
        }
        : null;
    const priorFailures = (
      await ctx.db
        .query("jobs")
        .withIndex("by_site_type_created", (q) =>
          q.eq("siteId", siteId).eq("type", "onboarding"),
        )
        .order("desc")
        .take(50)
    ).filter((candidate) => {
      return (
        candidate.status === "failed" &&
        typeof inputFingerprint === "string" &&
        failureBinding !== null &&
        onboardingJobMatchesDomainBinding(
          candidate,
          inputFingerprint,
          failureBinding,
        )
      );
    }).length;
    const retryAt = currentTime + onboardingFailureCooldownMs(priorFailures + 1);
    await ctx.db.patch(jobId, {
      status: "failed",
      error: "Website analysis did not complete",
      nextAttemptAt: retryAt,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    return {
      failed: true,
      retryAt,
    };
  },
});
