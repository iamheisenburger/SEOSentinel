import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  ALL_FEATURE_KEYS,
  allocateCadenceForMonthlyAllowance,
  cadenceFitsMonthlyAllowance,
  defaultCadenceForMonthlyLimit,
  getLimitsFromFeatures,
  requiredMonthlyArticlesForCadence,
} from "./planLimits";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { sanitizeSiteForClient } from "./lib/siteSecurity";
import {
  shouldCancelForEpochTransition,
} from "./lib/jobRollout";
import {
  publicationAdapterConfigHash,
  requireSafeGitHubDefaultBranch,
  safeGitHubRepositoryPart,
} from "./lib/publicationArtifact";
import {
  PUBLICATION_AUDIT_VERSION,
  sha256Hex,
} from "./lib/publicationArtifact";
import { PUBLICATION_ADAPTER_VERSION } from "./lib/publicationReceipts";
import {
  DATAFORSEO_AUTHORITY_SOURCE,
  validateOrganicClickGoal,
} from "./lib/expectedClickPortfolio";
import {
  liveAutopilotReadiness,
  warmAutopilotReadiness,
} from "./lib/autopilotReadiness";
import {
  autonomousGmailCredentialIssues,
  outreachDeletionGate,
} from "./lib/outreachDelivery";
import {
  selectPlanEntitledSiteIds,
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import { articleGenerationAttemptKey } from "./lib/articleGenerationAttempt";
import {
  accountDeletionKey,
  accountDeletionTombstoneUserId,
} from "./lib/accountDeletion.ts";
import {
  inboundRelayConfigured,
  inboundRelayDsnRoutingReady,
} from "./lib/outreachInboundRelay.ts";
import {
  autonomousOutreachConsentActive,
  autonomousOutreachReconciliationComplete,
  autonomousOutreachRuntimeEnabled,
  OUTREACH_DURABILITY_MIGRATION_VERSION,
} from "./lib/outreachAutonomy.ts";
import { MAX_SEQUENCE_STEP } from "./lib/outreachPacing.ts";
import {
  DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
  isSeoGrowthActuationEligible,
} from "./lib/seoGrowth.ts";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale.ts";
import {
  evaluateSchedulerReadyTopicInventory,
  SCHEDULER_TOPIC_INVENTORY_READ_LIMIT,
} from "./lib/schedulerTopicReadiness.ts";
import { terminallyClosePlanCheckpoints } from
  "./planCandidateCheckpoints";
import { releaseSharedProviderReservation } from
  "./lib/providerSpendReservation";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  topicPlanProviderReservationTriggerFromPayload,
} from "./lib/planProviderBudget";
import {
  recordDurableContactReceiptForAccount,
  recordDurablePacingReceiptForAccount,
  recordUnlinkedDurablePacingReceipt,
} from "./lib/outreachDurability.ts";
import {
  materializeOutreachSuppressionTombstoneForAccount,
} from "./lib/outreachSuppression.ts";
import {
  aggregateOneSetupReadiness,
  aggregateOneSetupRequestState,
  initialOneSetupProgress,
  managedProvisioningRetryAt,
  oneSetupActionMessage,
  oneSetupCapabilityReadiness,
  ONE_SETUP_CONTRACT_VERSION,
  type OneSetupActionOwner,
  type OneSetupAutomationMode,
  type OneSetupMode,
  type OneSetupReadinessState,
} from "./lib/oneSetup.ts";
import {
  oneSetupOutreachMailboxReceiptVerified,
  oneSetupPublisherReceiptVerified,
  oneSetupSearchMeasurementReceiptVerified,
} from "./lib/oneSetupCanonical.ts";
import { oneSetupPromotionBlockers } from "./lib/oneSetupRuntime.ts";

function inboundRelayRuntimeConfig() {
  return {
    domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    secrets: [
      process.env.OUTREACH_INBOUND_RELAY_SECRET,
      process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    ],
    dsnTargetSecret:
      process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
    adapterVersion: process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
    retentionPolicyHash:
      process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
    retentionAudited: process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  };
}

const now = () => Date.now();
const CADENCE_ALLOCATION_VERSION = 1;
const ONE_SETUP_MODE_VALIDATOR = v.union(
  v.literal("connect_existing"),
  v.literal("managed"),
);
const ONE_SETUP_AUTOMATION_MODE_VALIDATOR = v.union(
  v.literal("assisted"),
  v.literal("full"),
);
const ONE_SETUP_PROGRESS_VALIDATOR = v.union(
  v.literal("owner_action_required"),
  v.literal("requested"),
  v.literal("in_progress"),
  v.literal("ready"),
  v.literal("blocked"),
);
const ONE_SETUP_ACTION_OWNER_VALIDATOR = v.union(
  v.literal("owner"),
  v.literal("operator"),
);
const DELIVERY_CONFIG_KEYS = new Set([
  "domain", "publishMethod", "repoOwner", "repoName", "repoDefaultBranch", "githubToken",
  "wpUrl", "wpUsername", "wpAppPassword", "webhookUrl", "webhookSecret",
  "urlStructure", "brandPrimaryColor", "brandAccentColor", "brandFontFamily",
  "autopilotEnabled", "cadencePerWeek",
]);

function normalizedAuthorityDomain(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function syncOrganicClickGoal(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  monthlyOrganicClicksGoal: number | undefined,
) {
  if (monthlyOrganicClicksGoal === undefined) return;
  const existing = await ctx.db
    .query("seo_growth_goals")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .unique();
  const timestamp = now();
  if (existing) {
    await ctx.db.patch(existing._id, { monthlyOrganicClicksGoal, updatedAt: timestamp });
    return;
  }
  await ctx.db.insert("seo_growth_goals", {
    siteId,
    monthlyOrganicClicksGoal,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function assertCadenceFitsAccountAllowance(
  cadencePerWeek: number,
  availableArticles: number,
  maxArticles: number,
) {
  if (!cadenceFitsMonthlyAllowance(cadencePerWeek, availableArticles)) {
    const requested = requiredMonthlyArticlesForCadence(cadencePerWeek);
    throw new Error(
      `This cadence requires ${requested} articles in a 31-day month, but the account has ${availableArticles} of ${maxArticles} monthly articles available for this site. Reduce another site's cadence or upgrade first.`,
    );
  }
}

type AccountCadenceSnapshot = {
  entitlement: Doc<"account_plan_entitlements"> | null;
  maxArticles: number;
  allocatedArticles: number;
  currentSiteArticles: number;
  availableArticles: number;
  ready: boolean;
};

async function accountCadenceSnapshot(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  currentSite: Doc<"sites"> | null,
  fallbackPlanFeatures: readonly string[],
): Promise<AccountCadenceSnapshot> {
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const maxArticles = entitlement?.maxArticles ??
    getLimitsFromFeatures([...fallbackPlanFeatures]).maxArticles;
  const currentSiteArticles = currentSite &&
      !currentSite.deletionStatus &&
      !currentSite.planParkedAt
    ? requiredMonthlyArticlesForCadence(currentSite.cadencePerWeek ?? 0)
    : 0;

  if (entitlement) {
    const ready = entitlement.status === "completed" &&
      entitlement.cadenceAllocationVersion === CADENCE_ALLOCATION_VERSION &&
      entitlement.allocatedMonthlyArticles !== undefined;
    const allocatedArticles = ready
      ? Math.max(0, Math.floor(entitlement.allocatedMonthlyArticles ?? 0))
      : maxArticles;
    return {
      entitlement,
      maxArticles,
      allocatedArticles,
      currentSiteArticles,
      availableArticles: ready
        ? Math.max(
            0,
            maxArticles - allocatedArticles + currentSiteArticles,
          )
        : currentSiteArticles,
      ready,
    };
  }

  // Temporary compatibility path for installations not yet covered by the
  // authoritative Clerk backfill. It is bounded and conservative: ambiguity
  // consumes the full account allowance instead of manufacturing capacity.
  const bound = Math.min(152, Math.max(2, maxArticles + 2));
  const sites = await ctx.db
    .query("sites")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("asc")
    .take(bound);
  let allocatedArticles = sites
    .filter((site) => !site.deletionStatus && !site.planParkedAt)
    .reduce(
      (total, site) =>
        total + requiredMonthlyArticlesForCadence(site.cadencePerWeek ?? 0),
      0,
    );
  if (sites.length === bound) {
    // Without an authoritative account receipt, any truncated fleet has
    // unknown allocations. Consume the full allowance conservatively even
    // when the edited site happened to be in the first page; this still lets
    // that site keep or reduce its own cadence, but never overgrants capacity.
    allocatedArticles = Math.max(maxArticles, allocatedArticles);
  }
  return {
    entitlement: null,
    maxArticles,
    allocatedArticles,
    currentSiteArticles,
    availableArticles: Math.max(
      0,
      maxArticles - allocatedArticles + currentSiteArticles,
    ),
    ready: true,
  };
}

async function reserveAccountCadence(
  ctx: MutationCtx,
  snapshot: AccountCadenceSnapshot,
  nextCadencePerWeek: number,
) {
  const nextArticles = requiredMonthlyArticlesForCadence(nextCadencePerWeek);
  const nextAllocated =
    snapshot.allocatedArticles - snapshot.currentSiteArticles + nextArticles;
  if (nextAllocated > snapshot.maxArticles) {
    throw new Error("Account cadence allocation exceeded the active plan");
  }
  if (snapshot.entitlement) {
    await ctx.db.patch(snapshot.entitlement._id, {
      allocatedMonthlyArticles: Math.max(0, nextAllocated),
      updatedAt: now(),
    });
  }
}

async function rebalanceAccountCadencesAfterRequest(
  ctx: MutationCtx,
  snapshot: AccountCadenceSnapshot,
) {
  if (!snapshot.entitlement) return;
  await applyCanonicalPlanToUserSites(
    ctx,
    snapshot.entitlement.userId,
    snapshot.entitlement.planFeatures,
    { forceReconcile: true },
  );
}

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

async function scheduleOutreachSequenceCancellationForInbox(
  ctx: MutationCtx,
  inbox: Doc<"outreach_inboxes">,
  reason: string,
): Promise<boolean> {
  if (
    !inbox.credentialOwnerAccountKey ||
    !Number.isSafeInteger(inbox.autonomyConsentVersion) ||
    !inbox.autonomyConsentPolicyHash ||
    !Number.isFinite(inbox.autonomyConsentAcceptedAt) ||
    inbox.autonomyConsentAcceptedAt! <= 0
  ) return false;
  await ctx.scheduler.runAfter(
    0,
    internal.outreach.cancelAutonomousSequenceInternal,
    {
      siteId: inbox.siteId,
      ownerAccountKey: inbox.credentialOwnerAccountKey,
      consentVersion: inbox.autonomyConsentVersion!,
      consentPolicyHash: inbox.autonomyConsentPolicyHash,
      consentAcceptedAt: inbox.autonomyConsentAcceptedAt!,
      sequenceStep: 0,
      reason,
    },
  );
  return true;
}

/**
 * A sender that was secondary to the old site can become the primary domain
 * after a site edit. Demote it atomically with the domain change and invalidate
 * every sender-bound approval. Refuse the edit while Gmail delivery is in
 * flight so the action cannot continue with a now-invalid tenant boundary.
 */
async function demoteOutreachForDomainChange(
  ctx: MutationCtx,
  siteId: Id<"sites">,
): Promise<void> {
  await gateInboundRelayCanaryExternalLease(
    ctx,
    siteId,
    "change this site's domain",
  );
  const inFlight = await ctx.db
    .query("outreach_messages")
    .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "sending"))
    .first();
  if (inFlight) {
    throw new Error("The site domain cannot change while outreach delivery is in progress");
  }
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  const timestamp = now();
  for (const inbox of inboxes) {
    await ctx.db.patch(inbox._id, {
      status: "connected",
      mode: "approval",
      verifiedAt: undefined,
      configurationVersion: (inbox.configurationVersion ?? 0) + 1,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      autonomyDisabledAt: timestamp,
      autonomyReconciliationStatus: "paused",
      autonomyReconciliationCursor: undefined,
      lastError:
        "The tenant domain changed. Reconnect and verify the secondary-domain sender before reviewing new outreach.",
      updatedAt: timestamp,
    });
    await scheduleOutreachSequenceCancellationForInbox(
      ctx,
      inbox,
      "The tenant domain changed before this message became due.",
    );
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
  includeManual = false,
  autonomousPlansOnly = false,
): Promise<number> {
  const [site, pending, running] = await Promise.all([
    ctx.db.get(siteId),
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
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    if (autonomousPlansOnly) {
      // Either direction of the expected-click toggle changes the paid plan
      // contract. No non-manual plan—legacy, migration, growth, or checkpoint
      // marked—may cross that boundary with its old authorization snapshot.
      const expectedClickMigration =
        payload.expectedClickPlanMigrationVersion !== undefined;
      if (
        job.type !== "plan" ||
        (payload.manual === true && !expectedClickMigration)
      ) continue;
    } else if (!includeManual && !shouldCancelForEpochTransition(job)) {
      continue;
    }
    const cancelledAt = now();
    let releasedPlanReservation = false;
    if (
      job.status === "pending" && job.type === "plan" &&
      (job.workerAttempts ?? 0) === 0 && !job.workerToken &&
      !job.providerReservationReleasedAt && job.providerSpendReservationId
    ) {
      const reservation = await ctx.db.get(job.providerSpendReservationId);
      const expectedReservationTrigger =
        topicPlanProviderReservationTriggerFromPayload(payload);
      const exactUntouchedReservation = reservation &&
        site?.userId &&
        reservation.siteId === siteId &&
        reservation.userId === site.userId &&
        reservation.purpose === "topic_plan" &&
        reservation.trigger === expectedReservationTrigger &&
        reservation.createdAt === job.createdAt &&
        reservation.reservationDay === job.providerCostReservationDay &&
        reservation.reservedMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        job.providerCostReservedMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        job.providerCostCeilingMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        reservation.releasedAt === undefined;
      if (exactUntouchedReservation) {
        releasedPlanReservation = (await releaseSharedProviderReservation(
          ctx,
          {
            reservationId: job.providerSpendReservationId,
            siteId,
            purpose: "topic_plan",
            reason: "plan_cancelled_before_execution",
            timestamp: cancelledAt,
          },
        )).released;
      }
    }
    if (job.status === "running") {
      const attempt = await ctx.db
        .query("article_generation_attempts")
        .withIndex("by_attempt_key", (q) =>
          q.eq(
            "attemptKey",
            articleGenerationAttemptKey(
              String(job._id),
              job.workerAttempts ?? 0,
            ),
          )
        )
        .unique();
      if (attempt?.status === "reserved") {
        // A rollout, plan, or deletion transition invalidates the worker lease,
        // but it cannot erase the possibility that paid provider work started.
        await ctx.db.patch(attempt._id, {
          status: "ambiguous",
          expiresAt: undefined,
          settledAt: cancelledAt,
          articleKey: job.articleId ? String(job.articleId) : undefined,
          updatedAt: cancelledAt,
        });
      }
    }
    if (job.reservationId && !job.articleId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === job._id) {
        await ctx.db.delete(reservation._id);
      }
    }
    if (payload.topicId) {
      const topicId = ctx.db.normalizeId("topic_clusters", String(payload.topicId));
      const topic = topicId ? await ctx.db.get(topicId) : null;
      if (topic?.siteId === siteId && topic.status === "queued") {
        await ctx.db.patch(topic._id, { status: "pending", updatedAt: cancelledAt });
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
      ...(releasedPlanReservation
        ? {
            providerReservationReleasedAt: cancelledAt,
            providerReservationReleaseReason:
              "plan_cancelled_before_execution",
          }
        : {}),
      updatedAt: cancelledAt,
    });
    if (
      releasedPlanReservation &&
      typeof payload.expectedClickPlanMigrationVersion === "number"
    ) {
      const site = await ctx.db.get(siteId);
      if (
        site?.expectedClickPlanMigrationJobId === job._id &&
        site.expectedClickPlanMigrationVersion ===
          payload.expectedClickPlanMigrationVersion &&
        site.expectedClickPlanMigrationReservedAt === job.createdAt
      ) {
        await ctx.db.patch(siteId, {
          expectedClickPlanMigrationVersion: undefined,
          expectedClickPlanMigrationJobId: undefined,
          expectedClickPlanMigrationReservedAt: undefined,
          updatedAt: cancelledAt,
        });
      }
    }
    if (job.type === "plan") {
      await terminallyClosePlanCheckpoints(
        ctx,
        job._id,
        cancelledAt,
        "plan_checkpoint_cancelled_by_epoch_transition",
      );
    }
    cancelled += 1;
  }
  return cancelled;
}

const PLAN_SITE_RECONCILIATION_PAGE_SIZE = 25;

async function reconcileCanonicalPlanSitePage(
  ctx: MutationCtx,
  entitlementId: Id<"account_plan_entitlements">,
  syncVersion: number,
  cursor: string | undefined,
  remainingAllowance: number,
  remainingArticleAllowance: number,
) {
  const entitlement = await ctx.db.get(entitlementId);
  if (
    !entitlement ||
    entitlement.syncVersion !== syncVersion ||
    entitlement.status !== "reconciling"
  ) {
    return { superseded: true as const };
  }
  const page = await ctx.db
    .query("sites")
    .withIndex("by_user", (q) => q.eq("userId", entitlement.userId))
    .order("asc")
    .paginate({
      cursor: cursor ?? null,
      numItems: PLAN_SITE_RECONCILIATION_PAGE_SIZE,
    });
  const entitledSiteIds = selectPlanEntitledSiteIds(
    page.page.map((site) => ({
      siteId: String(site._id),
      creationTime: site._creationTime,
      deleting: Boolean(site.deletionStatus),
    })),
    remainingAllowance,
  );
  const timestamp = now();
  let activated = 0;
  let parked = 0;
  let nextRemainingArticleAllowance = Math.max(
    0,
    Math.floor(remainingArticleAllowance),
  );
  for (const site of page.page) {
    const requestedCadence = site.cadenceRequestedPerWeek ??
      site.cadencePerWeek ??
      defaultCadenceForMonthlyLimit(entitlement.maxArticles);
    const shouldPark = !site.deletionStatus &&
      !entitledSiteIds.has(String(site._id));
    const cadencePerWeek = shouldPark || Boolean(site.deletionStatus)
      ? site.cadencePerWeek ?? requestedCadence
      : allocateCadenceForMonthlyAllowance(
          requestedCadence,
          nextRemainingArticleAllowance,
        );
    if (!shouldPark && !site.deletionStatus) {
      nextRemainingArticleAllowance = Math.max(
        0,
        nextRemainingArticleAllowance -
          requiredMonthlyArticlesForCadence(cadencePerWeek),
      );
    }
    const parkingChanged = shouldPark !== Boolean(site.planParkedAt);
    const cadenceChanged = cadencePerWeek !== (site.cadencePerWeek ?? 0);
    if ((parkingChanged && shouldPark) || cadenceChanged) {
      await gateInboundRelayCanaryExternalLease(
        ctx,
        site._id,
        "change this site's plan allocation",
      );
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        site._id,
        cadenceChanged
          ? "account-wide article cadence allocation changed"
          : "site moved outside the current plan allowance",
        true,
      );
    }
    if (parkingChanged && shouldPark) {
      const outreachInboxes = await ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .take(2);
      for (const inbox of outreachInboxes) {
        await ctx.db.patch(inbox._id, {
          mode: "approval",
          autonomyDisabledAt: timestamp,
          autonomyReconciliationStatus: "paused",
          autonomyReconciliationCursor: undefined,
          updatedAt: Math.max(inbox.updatedAt, timestamp),
        });
        await scheduleOutreachSequenceCancellationForInbox(
          ctx,
          inbox,
          "The tenant was parked outside its plan allowance before this message became due.",
        );
      }
    }
    await ctx.db.patch(site._id, {
      planFeatures: entitlement.planFeatures,
      cadenceRequestedPerWeek: requestedCadence,
      cadencePerWeek,
      ...(parkingChanged || cadenceChanged
        ? {
            planParkedAt: shouldPark ? timestamp : undefined,
            planAllowanceChangedAt: timestamp,
            autopilotRolloutEpoch:
              (site.autopilotRolloutEpoch ?? 0) + 1,
            ...(!shouldPark || cadenceChanged
              ? {
                  autopilotRolloutMode: "observe",
                  autopilotRolloutStartedAt: timestamp,
                }
              : {}),
          }
        : {}),
      updatedAt: timestamp,
    });
    if (shouldPark) parked += 1;
    else if (!site.deletionStatus) activated += 1;
  }
  const nextRemainingAllowance = Math.max(
    0,
    remainingAllowance - entitledSiteIds.size,
  );
  if (page.isDone) {
    await ctx.db.patch(entitlementId, {
      status: "completed",
      cursor: undefined,
      remainingAllowance: nextRemainingAllowance,
      remainingArticleAllowance: nextRemainingArticleAllowance,
      allocatedMonthlyArticles:
        entitlement.maxArticles - nextRemainingArticleAllowance,
      cadenceAllocationVersion: CADENCE_ALLOCATION_VERSION,
      updatedAt: timestamp,
    });
  } else {
    await ctx.db.patch(entitlementId, {
      cursor: page.continueCursor,
      remainingAllowance: nextRemainingAllowance,
      remainingArticleAllowance: nextRemainingArticleAllowance,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.sites.continuePlanFeatureSyncInternal,
      {
        entitlementId,
        syncVersion,
        cursor: page.continueCursor,
        remainingAllowance: nextRemainingAllowance,
        remainingArticleAllowance: nextRemainingArticleAllowance,
      },
    );
  }
  return {
    superseded: false as const,
    completed: page.isDone,
    scanned: page.page.length,
    activated,
    parked,
    maxSites: entitlement.maxSites,
    allocatedMonthlyArticles:
      entitlement.maxArticles - nextRemainingArticleAllowance,
  };
}

async function applyCanonicalPlanToUserSites(
  ctx: MutationCtx,
  userId: string,
  planFeatures: readonly string[],
  options?: { forceReconcile?: boolean },
) {
  const deletionReceipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) =>
      q.eq("accountKey", accountDeletionKey(userId))
    )
    .unique();
  if (deletionReceipt) {
    return {
      superseded: false as const,
      completed: false,
      deleting: true as const,
      scanned: 0,
      activated: 0,
      parked: 0,
      maxSites: 0,
    };
  }
  const allowedFeatures = new Set(ALL_FEATURE_KEYS);
  const verifiedFeatures = [...new Set(
    planFeatures.filter((feature) => allowedFeatures.has(feature)),
  )].sort();
  const limits = getLimitsFromFeatures(verifiedFeatures);
  const existing = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing?.status === "deleting") {
    return {
      superseded: false as const,
      completed: false,
      deleting: true as const,
      scanned: 0,
      activated: 0,
      parked: 0,
      maxSites: 0,
    };
  }
  const timestamp = now();
  const existingCanonicalFeatures = existing
    ? [...new Set(existing.planFeatures)].sort()
    : [];
  if (
    options?.forceReconcile !== true &&
    existing?.status === "completed" &&
    existing.cadenceAllocationVersion === CADENCE_ALLOCATION_VERSION &&
    existing.allocatedMonthlyArticles !== undefined &&
    existing.allocatedMonthlyArticles <= limits.maxArticles &&
    existing.maxSites === limits.maxSites &&
    existing.maxArticles === limits.maxArticles &&
    existingCanonicalFeatures.length === verifiedFeatures.length &&
    existingCanonicalFeatures.every(
      (feature, index) => feature === verifiedFeatures[index],
    )
  ) {
    await ctx.db.patch(existing._id, {
      authoritativeVerifiedAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      superseded: false as const,
      completed: true,
      unchanged: true,
      scanned: 0,
      activated: 0,
      parked: 0,
      maxSites: existing.maxSites,
    };
  }
  const syncVersion = (existing?.syncVersion ?? 0) + 1;
  const fields = {
    userId,
    planFeatures: verifiedFeatures,
    maxSites: limits.maxSites,
    maxArticles: limits.maxArticles,
    syncVersion,
    syncStartedAt: timestamp,
    authoritativeVerifiedAt: timestamp,
    status: "reconciling",
    cursor: undefined,
    remainingAllowance:
      limits.maxSites >= 9999 ? Number.MAX_SAFE_INTEGER : limits.maxSites,
    remainingArticleAllowance: limits.maxArticles,
    allocatedMonthlyArticles: 0,
    cadenceAllocationVersion: undefined,
    updatedAt: timestamp,
  };
  const entitlementId = existing?._id ??
    await ctx.db.insert("account_plan_entitlements", {
      ...fields,
      createdAt: timestamp,
    });
  if (existing) await ctx.db.patch(existing._id, fields);
  return reconcileCanonicalPlanSitePage(
    ctx,
    entitlementId,
    syncVersion,
    undefined,
    limits.maxSites >= 9999 ? Number.MAX_SAFE_INTEGER : limits.maxSites,
    limits.maxArticles,
  );
}

async function requireSiteOwnerIncludingDeleting(
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

async function requireSiteOwner(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
) {
  const site = await requireSiteOwnerIncludingDeleting(ctx, siteId);
  if (site.deletionStatus) throw new Error("Site not found");
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
    return sites
      .filter((site) => !site.deletionStatus)
      .map(sanitizeSiteForClient);
  },
});

// Owner-facing, PII-free capacity projection for truthful cadence controls.
// The mutation repeats the same authoritative read and reservation, so this
// query is advisory UX only and cannot be used to win a concurrency race.
export const getCadenceCapacity = query({
  args: { siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const site = siteId
      ? await requireSiteOwner(ctx, siteId)
      : null;
    const snapshot = await accountCadenceSnapshot(
      ctx,
      identity.subject,
      site,
      site?.planFeatures ?? [],
    );
    return {
      ready: snapshot.ready,
      maxArticles: snapshot.maxArticles,
      allocatedOtherArticles: Math.max(
        0,
        snapshot.allocatedArticles - snapshot.currentSiteArticles,
      ),
      availableMonthlyArticles: snapshot.availableArticles,
      currentMonthlyArticles: snapshot.currentSiteArticles,
      siteParked: Boolean(site?.planParkedAt),
    };
  },
});

export const get = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    try {
      const site = await requireSiteOwner(ctx, siteId);
      if (site.deletionStatus) return null;
      return sanitizeSiteForClient(site);
    } catch {
      return null;
    }
  },
});

type ManagedProvisioningCapability =
  Doc<"managed_provisioning_requests">["publisher"];

function nextOneSetupCapability(
  previous: ManagedProvisioningCapability | undefined,
  mode: OneSetupMode,
  timestamp: number,
  reset: boolean,
): ManagedProvisioningCapability {
  if (!reset && previous?.mode === mode && previous.state !== "ready") {
    return previous;
  }
  return {
    mode,
    state: initialOneSetupProgress(mode),
    requestedAt: timestamp,
    updatedAt: timestamp,
  };
}

function safeOneSetupReasonCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(normalized)) {
    throw new Error("Invalid provisioning reason code");
  }
  return normalized;
}

/**
 * Save owner intent only. This request cannot carry provider credentials and
 * cannot make publishing, Search Console, or an outreach mailbox ready.
 */
export const saveOneSetupRequest = mutation({
  args: {
    siteId: v.id("sites"),
    publisherMode: ONE_SETUP_MODE_VALIDATOR,
    searchMeasurementMode: ONE_SETUP_MODE_VALIDATOR,
    outreachMailboxMode: ONE_SETUP_MODE_VALIDATOR,
    automationMode: ONE_SETUP_AUTOMATION_MODE_VALIDATOR,
    requestedCadencePerWeek: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await requireSiteOwner(ctx, args.siteId);
    if (!site.userId || site.accountDeletionRequestedAt) {
      throw new Error("Site not found");
    }
    if (
      !Number.isFinite(args.requestedCadencePerWeek) ||
      args.requestedCadencePerWeek <= 0 ||
      args.requestedCadencePerWeek > 21
    ) {
      throw new Error("Invalid requested cadence");
    }
    const siteRequestedCadence =
      site.cadenceRequestedPerWeek ?? site.cadencePerWeek ?? 0;
    if (Math.abs(siteRequestedCadence - args.requestedCadencePerWeek) > 1e-9) {
      throw new Error("Save the site cadence before submitting setup");
    }
    if (
      site.autopilotEnabled !== true ||
      Boolean(site.approvalRequired) !== (args.automationMode === "assisted")
    ) {
      throw new Error("Save the site automation mode before submitting setup");
    }

    const domainSnapshot = site.canonicalDomain ??
      normalizedAuthorityDomain(site.domain);
    if (!domainSnapshot) throw new Error("The site domain is invalid");
    const ownerAccountKey = accountDeletionKey(site.userId);
    const existing = await ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .unique();
    const timestamp = now();
    const reset = Boolean(
      existing &&
        (existing.ownerAccountKey !== ownerAccountKey ||
          existing.domainSnapshot !== domainSnapshot ||
          existing.contractVersion !== ONE_SETUP_CONTRACT_VERSION),
    );
    const publisher = nextOneSetupCapability(
      existing?.publisher,
      args.publisherMode,
      timestamp,
      reset,
    );
    const searchMeasurement = nextOneSetupCapability(
      existing?.searchMeasurement,
      args.searchMeasurementMode,
      timestamp,
      reset,
    );
    const outreachMailbox = nextOneSetupCapability(
      existing?.outreachMailbox,
      args.outreachMailboxMode,
      timestamp,
      reset,
    );
    const aggregateState = aggregateOneSetupRequestState([
      publisher,
      searchMeasurement,
      outreachMailbox,
    ]);
    const revision = (existing?.revision ?? 0) + 1;
    const record = {
      ownerAccountKey,
      domainSnapshot,
      contractVersion: ONE_SETUP_CONTRACT_VERSION,
      revision,
      automationMode: args.automationMode,
      requestedCadencePerWeek: args.requestedCadencePerWeek,
      publisher,
      searchMeasurement,
      outreachMailbox,
      aggregateState,
      fulfillmentState: "queued" as const,
      fulfillmentAttempt: reset ? 0 : existing?.fulfillmentAttempt ?? 0,
      nextAttemptAt: timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: undefined,
      updatedAt: timestamp,
      completedAt: undefined,
    };
    let requestId: Id<"managed_provisioning_requests">;
    if (existing) {
      await ctx.db.patch(existing._id, record);
      requestId = existing._id;
    } else {
      requestId = await ctx.db.insert("managed_provisioning_requests", {
        siteId: site._id,
        ...record,
        createdAt: timestamp,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId, expectedRevision: revision },
    );
    return { requestId, revision };
  },
});

/** Provider adapters may report credential-free progress against an exact
 * revision. They cannot report ready: only the canonical reconciler owns that
 * transition. */
export const setOneSetupCapabilityProgressInternal = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    capability: v.union(
      v.literal("publisher"),
      v.literal("search_measurement"),
      v.literal("outreach_mailbox"),
    ),
    state: ONE_SETUP_PROGRESS_VALIDATOR,
    blockedReasonCode: v.optional(v.string()),
    actionRequiredBy: v.optional(ONE_SETUP_ACTION_OWNER_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.revision !== args.expectedRevision) {
      throw new Error("Provisioning request changed");
    }
    const site = await ctx.db.get(request.siteId);
    const domainSnapshot = site?.canonicalDomain ??
      (site ? normalizedAuthorityDomain(site.domain) : null);
    if (
      !site?.userId ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt ||
      request.ownerAccountKey !== accountDeletionKey(site.userId) ||
      request.domainSnapshot !== domainSnapshot ||
      request.contractVersion !== ONE_SETUP_CONTRACT_VERSION
    ) {
      throw new Error("Provisioning request is no longer active");
    }
    const field = args.capability === "search_measurement"
      ? "searchMeasurement"
      : args.capability === "outreach_mailbox"
        ? "outreachMailbox"
        : "publisher";
    const current = request[field];
    if (args.state === "ready") {
      throw new Error(
        "Provider progress cannot mark a capability ready; canonical reconciliation is required",
      );
    }
    if (
      current.mode === "connect_existing" &&
      args.state !== "owner_action_required" &&
      args.state !== "blocked"
    ) {
      throw new Error("Owner-managed connections cannot be advanced by a provider");
    }
    if (current.mode === "managed" && args.state === "owner_action_required") {
      throw new Error("Managed provisioning cannot delegate credential entry silently");
    }
    const blockedReasonCode = args.state === "blocked"
      ? safeOneSetupReasonCode(args.blockedReasonCode)
      : undefined;
    if (
      args.state === "blocked" &&
      (!blockedReasonCode || !args.actionRequiredBy)
    ) {
      throw new Error("Blocked provisioning progress requires an exact action owner and reason");
    }
    if (
      current.mode === "connect_existing" &&
      args.state === "blocked" &&
      args.actionRequiredBy !== "owner"
    ) {
      throw new Error("Owner-managed connection blockers belong to the owner");
    }
    const timestamp = now();
    const next: ManagedProvisioningCapability = {
      ...current,
      state: args.state,
      blockedReasonCode,
      actionRequiredBy: args.state === "blocked"
        ? args.actionRequiredBy as OneSetupActionOwner
        : args.state === "owner_action_required"
          ? "owner"
          : undefined,
      updatedAt: timestamp,
    };
    const capabilities = {
      publisher: field === "publisher" ? next : request.publisher,
      searchMeasurement: field === "searchMeasurement"
        ? next
        : request.searchMeasurement,
      outreachMailbox: field === "outreachMailbox"
        ? next
        : request.outreachMailbox,
    };
    const aggregateState = aggregateOneSetupRequestState([
      capabilities.publisher,
      capabilities.searchMeasurement,
      capabilities.outreachMailbox,
    ]);
    const operatorActionRequired = [
      capabilities.publisher,
      capabilities.searchMeasurement,
      capabilities.outreachMailbox,
    ].some((capability) => capability.actionRequiredBy === "operator");
    const revision = request.revision + 1;
    const nextAttemptAt = managedProvisioningRetryAt(timestamp);
    await ctx.db.patch(request._id, {
      ...capabilities,
      aggregateState,
      fulfillmentState:
        args.state === "blocked" || args.state === "owner_action_required"
          ? "waiting_action"
          : "retry_wait",
      nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: operatorActionRequired
        ? request.operatorActionRequiredAt ?? timestamp
        : undefined,
      revision,
      updatedAt: timestamp,
      completedAt: undefined,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: revision },
    );
    return { revision, aggregateState, nextAttemptAt };
  },
});

function pendingOneSetupCapability(mode: OneSetupMode): ManagedProvisioningCapability {
  return {
    mode,
    state: initialOneSetupProgress(mode),
    requestedAt: 0,
    updatedAt: 0,
  };
}

export const getOneSetupReadiness = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const [
      request,
      crawledPage,
      topics,
      growthGoal,
      inboxes,
      cadenceSnapshot,
    ] =
      await Promise.all([
        ctx.db
          .query("managed_provisioning_requests")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .unique(),
        ctx.db
          .query("pages")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .first(),
        ctx.db
          .query("topic_clusters")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .take(SCHEDULER_TOPIC_INVENTORY_READ_LIMIT + 1),
        ctx.db
          .query("seo_growth_goals")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .unique(),
        ctx.db
          .query("outreach_inboxes")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .take(2),
        accountCadenceSnapshot(
          ctx,
          site.userId!,
          site,
          site.planFeatures ?? [],
        ),
      ]);
    const domainSnapshot = site.canonicalDomain ??
      normalizedAuthorityDomain(site.domain);
    const ownerAccountKey = site.userId ? accountDeletionKey(site.userId) : null;
    const requestValid = Boolean(
      request &&
        ownerAccountKey &&
        request.ownerAccountKey === ownerAccountKey &&
        request.domainSnapshot === domainSnapshot &&
        request.contractVersion === ONE_SETUP_CONTRACT_VERSION,
    );
    const publisherProgress = requestValid
      ? request!.publisher
      : pendingOneSetupCapability("connect_existing");
    const measurementProgress = requestValid
      ? request!.searchMeasurement
      : pendingOneSetupCapability("connect_existing");
    const outreachProgress = requestValid
      ? request!.outreachMailbox
      : pendingOneSetupCapability("connect_existing");

    const publisherVerified = oneSetupPublisherReceiptVerified(site);
    const measurementVerified = oneSetupSearchMeasurementReceiptVerified(site);
    const outreachMailboxVerified = Boolean(
      ownerAccountKey && oneSetupOutreachMailboxReceiptVerified({
        inboxes,
        ownerAccountKey,
      }),
    );
    const schedulerReadiness =
      topics.length <= SCHEDULER_TOPIC_INVENTORY_READ_LIMIT
        ? evaluateSchedulerReadyTopicInventory({
            site,
            topics,
            monthlyOrganicClickGoal:
              growthGoal?.monthlyOrganicClicksGoal ??
              DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
            currentLocationCode: dataForSeoLocationCode(site.targetCountry),
            currentLanguageCode: dataForSeoLanguageCode(site.language),
          })
        : null;

    const websiteState: OneSetupReadinessState =
      crawledPage && (site.siteSummary || site.niche)
        ? "ready"
        : requestValid
          ? "queued"
          : "action_required";
    const planState: OneSetupReadinessState =
      (schedulerReadiness?.schedulerReadyTopicIds.length ?? 0) > 0
      ? "ready"
      : requestValid
        ? "queued"
        : "action_required";
    const requestedCadence = requestValid
      ? request!.requestedCadencePerWeek
      : site.cadenceRequestedPerWeek ?? site.cadencePerWeek ?? 0;
    const cadenceState: OneSetupReadinessState =
      cadenceSnapshot.ready &&
        requestedCadence > 0 &&
        site.cadencePerWeek === requestedCadence &&
        cadenceFitsMonthlyAllowance(
          requestedCadence,
          cadenceSnapshot.availableArticles,
        ) &&
        !site.planParkedAt &&
        !site.domainOwnershipConflictAt
        ? "ready"
        : site.planParkedAt || site.domainOwnershipConflictAt
          ? "blocked"
          : requestValid
            ? "queued"
            : "action_required";
    const automationState: OneSetupReadinessState = !requestValid
      ? "action_required"
      : site.autopilotEnabled === true &&
          Boolean(site.approvalRequired) ===
            (request!.automationMode === "assisted")
        ? "ready"
        : "action_required";
    const stages: Array<{
      key: string;
      label: string;
      state: OneSetupReadinessState;
      mode?: OneSetupMode;
      actionRequiredBy?: OneSetupActionOwner;
      reasonCode?: string;
      actionMessage?: string;
    }> = [
      { key: "website", label: "Website analyzed", state: websiteState },
      { key: "content_plan", label: "Content plan prepared", state: planState },
      { key: "cadence", label: "Cadence reserved", state: cadenceState },
      {
        key: "automation",
        label: "Automation mode authorized",
        state: automationState,
      },
      {
        key: "publisher",
        label: "Publishing destination verified",
        state: oneSetupCapabilityReadiness({
          connectionVerified: publisherVerified,
          progress: publisherProgress,
        }),
        mode: publisherProgress.mode,
        actionRequiredBy: publisherProgress.actionRequiredBy,
        reasonCode: publisherProgress.blockedReasonCode,
        actionMessage: oneSetupActionMessage(
          publisherProgress.blockedReasonCode,
        ),
      },
      {
        key: "search_measurement",
        label: "Search measurement verified",
        state: oneSetupCapabilityReadiness({
          connectionVerified: measurementVerified,
          progress: measurementProgress,
        }),
        mode: measurementProgress.mode,
        actionRequiredBy: measurementProgress.actionRequiredBy,
        reasonCode: measurementProgress.blockedReasonCode,
        actionMessage: oneSetupActionMessage(
          measurementProgress.blockedReasonCode,
        ),
      },
      {
        key: "outreach_mailbox",
        label: "Outreach mailbox verified",
        state: oneSetupCapabilityReadiness({
          connectionVerified: outreachMailboxVerified,
          progress: outreachProgress,
        }),
        mode: outreachProgress.mode,
        actionRequiredBy: outreachProgress.actionRequiredBy,
        reasonCode: outreachProgress.blockedReasonCode,
        actionMessage: oneSetupActionMessage(
          outreachProgress.blockedReasonCode,
        ),
      },
    ];
    const aggregate = aggregateOneSetupReadiness(
      stages.map((stage) => stage.state),
    );
    return {
      contractVersion: ONE_SETUP_CONTRACT_VERSION,
      requestExists: requestValid,
      requestRevision: requestValid ? request!.revision : 0,
      automationMode: (requestValid
        ? request!.automationMode
        : "assisted") as OneSetupAutomationMode,
      requestedCadencePerWeek: requestValid
        ? request!.requestedCadencePerWeek
        : site.cadenceRequestedPerWeek ?? site.cadencePerWeek ?? 0,
      aggregate,
      stages,
      fulfillment: requestValid
        ? {
            state: request!.fulfillmentState ?? "queued",
            attempt: request!.fulfillmentAttempt ?? 0,
            nextAttemptAt: request!.nextAttemptAt,
            lastClaimedAt: request!.lastClaimedAt,
            lastReconciledAt: request!.lastReconciledAt,
          }
        : null,
      // This is a narrowly named publishing receipt. It must not be presented
      // as proof that outreach, ranking, or conversion outcomes are active.
      publishingRolloutLive: site.autopilotRolloutMode === "live",
      updatedAt: Math.max(site.updatedAt, requestValid ? request!.updatedAt : 0),
    };
  },
});

export const getFull = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const activeSite = site?.deletionStatus ? null : site;
    return await siteExecutionAuthorized(ctx, activeSite) ? activeSite : null;
  },
});

export const recordSeoAuthorityEvidenceInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    domain: v.string(),
    domainRank: v.number(),
    referringDomains: v.number(),
    source: v.string(),
    measuredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    const measuredDomain = normalizedAuthorityDomain(args.domain);
    const currentDomain = normalizedAuthorityDomain(site.domain);
    if (
      !measuredDomain ||
      !currentDomain ||
      measuredDomain !== currentDomain ||
      args.source !== DATAFORSEO_AUTHORITY_SOURCE ||
      !Number.isFinite(args.domainRank) ||
      args.domainRank < 0 ||
      args.domainRank > 100 ||
      !Number.isFinite(args.referringDomains) ||
      args.referringDomains < 0 ||
      !Number.isFinite(args.measuredAt) ||
      args.measuredAt <= 0 ||
      args.measuredAt > now() + 5 * 60 * 1000
    ) {
      throw new Error("Invalid or incompatible SEO authority evidence");
    }
    await ctx.db.patch(args.siteId, {
      seoAuthorityDomain: measuredDomain,
      seoAuthorityDomainRank: args.domainRank,
      seoAuthorityReferringDomains: args.referringDomains,
      seoAuthoritySource: args.source,
      seoAuthorityMeasuredAt: args.measuredAt,
      updatedAt: now(),
    });
    return { recorded: true };
  },
});

export const setPublicationAdapterVerificationInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    configHash: v.string(),
    adapterVersion: v.string(),
    verifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("Site not found");
    assertConfigUnlocked(site);
    if (site.publishMethod !== "wordpress" && site.publishMethod !== "webhook") {
      throw new Error("This publication method does not use adapter verification");
    }
    const currentHash = publicationAdapterConfigHash(site);
    if (
      !currentHash ||
      currentHash !== args.configHash ||
      args.adapterVersion !== PUBLICATION_ADAPTER_VERSION
    ) {
      throw new Error("Publishing configuration changed during verification");
    }
    await ctx.db.patch(site._id, {
      publicationAdapterVerifiedAt: args.verifiedAt,
      publicationAdapterVersion: args.adapterVersion,
      publicationAdapterConfigHash: args.configHash,
      updatedAt: now(),
    });
    return { ok: true };
  },
});

export const patchInternal = internalMutation({
  args: { siteId: v.id("sites"), patch: v.any() },
  handler: async (ctx, { siteId, patch }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) throw new Error("Site not found");

    const safePatch = Object.fromEntries(
      Object.entries((patch ?? {}) as Record<string, unknown>).filter(
        ([key, value]) =>
          value !== undefined &&
          !["_id", "_creationTime", "userId", "createdAt"].includes(key),
      ),
    );
    if (Object.prototype.hasOwnProperty.call(safePatch, "organicClickGoalMonthly")) {
      validateOrganicClickGoal(
        safePatch.organicClickGoalMonthly as number | undefined,
      );
    }
    const nextDomain = typeof safePatch.domain === "string"
      ? normalizedAuthorityDomain(safePatch.domain)
      : normalizedAuthorityDomain(site.domain);
    const domainChanged =
      Object.prototype.hasOwnProperty.call(safePatch, "domain") &&
      nextDomain !== normalizedAuthorityDomain(site.domain);
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
            publicationAdapterVerifiedAt: undefined,
            publicationAdapterVersion: undefined,
            publicationAdapterConfigHash: undefined,
          }
        : {}),
      ...(domainChanged
        ? {
            seoAuthorityDomain: undefined,
            seoAuthorityDomainRank: undefined,
            seoAuthorityReferringDomains: undefined,
            seoAuthoritySource: undefined,
            seoAuthorityMeasuredAt: undefined,
          }
        : {}),
      updatedAt: now(),
    });
    await syncOrganicClickGoal(
      ctx,
      siteId,
      safePatch.organicClickGoalMonthly as number | undefined,
    );
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("sites")),
    createOnly: v.optional(v.boolean()),
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
    organicClickGoalMonthly: v.optional(v.number()),
    urlStructure: v.optional(v.string()),
    mediumToken: v.optional(v.string()),
    linkedinAccessToken: v.optional(v.string()),
    syndicationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId) throw new Error("Authentication required");
    const accountDeletion = await ctx.db
      .query("account_deletion_receipts")
      .withIndex("by_account_key", (q) =>
        q.eq("accountKey", accountDeletionKey(userId))
      )
      .unique();
    if (accountDeletion) {
      throw new Error("This account has been deleted and cannot create or update sites");
    }

    const domain = normalizedAuthorityDomain(args.domain);
    if (!domain) throw new Error("Enter a valid website domain");
    const currentSite = args.id ? await requireSiteOwner(ctx, args.id) : null;
    const canonicalClaims = await ctx.db
      .query("sites")
      .withIndex("by_canonical_domain", (q) =>
        q.eq("canonicalDomain", domain)
      )
      .take(2);
    // Compatibility fence for rows created before canonicalDomain existed.
    // These are exact indexed probes, not an unbounded fleet scan.
    const legacyDomainVariants = [...new Set([
      domain,
      `www.${domain}`,
      `https://${domain}`,
      `https://${domain}/`,
      `https://www.${domain}`,
      `https://www.${domain}/`,
      `http://${domain}`,
      `http://${domain}/`,
      `http://www.${domain}`,
      `http://www.${domain}/`,
      args.domain.trim().toLowerCase(),
    ])];
    const legacyClaims = await Promise.all(
      legacyDomainVariants.map((candidate) =>
        ctx.db
          .query("sites")
          .withIndex("by_domain", (q) => q.eq("domain", candidate))
          .first()
      ),
    );
    const domainClaims = new Map<string, Doc<"sites">>();
    for (const claim of [...canonicalClaims, ...legacyClaims]) {
      if (claim) domainClaims.set(String(claim._id), claim);
    }
    if (domainClaims.size > 1) {
      throw new Error(
        "This domain has multiple existing ownership claims. Automation remains paused until support resolves them.",
      );
    }
    const domainClaim = [...domainClaims.values()].find(
      (claim) => !args.id || claim._id !== args.id,
    ) ?? (args.id ? currentSite : [...domainClaims.values()][0]);
    if (args.id && domainClaim && domainClaim._id !== args.id) {
      // The indexed read makes this serializable with concurrent creates and
      // renames. Deleting tenants retain their claim until purge completes.
      throw new Error("This domain is already connected to another site");
    }
    const existingSites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const accountEntitlement = await ctx.db
      .query("account_plan_entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const activeExistingSites = existingSites.filter(
      (site) => !site.deletionStatus,
    );
    const planFeatures =
      accountEntitlement?.planFeatures ??
      currentSite?.planFeatures ?? activeExistingSites[0]?.planFeatures ?? [];
    const sameDomainSite = activeExistingSites.find(
      (site) => site.domain === domain,
    ) ?? null;
    const cadenceSite = currentSite ?? sameDomainSite;
    const cadenceSnapshot = await accountCadenceSnapshot(
      ctx,
      userId,
      cadenceSite,
      planFeatures,
    );
    const isNewSite = !currentSite && !sameDomainSite;
    if ((isNewSite || args.cadencePerWeek !== undefined) && !cadenceSnapshot.ready) {
      throw new Error(
        "Your plan update is still reconciling. Cadence capacity will be available when it completes.",
      );
    }

    // ── Site count limit (only on new site creation, not updates) ──
    if (!args.id && userId) {
      if (accountEntitlement && accountEntitlement.status !== "completed") {
        throw new Error(
          "Your plan update is still reconciling. Try adding the site again in a moment.",
        );
      }
      // Check if any existing site has planFeatures to determine limits
      const limits = getLimitsFromFeatures(planFeatures);

      // Check if domain already exists (would be an update, not new)
      const domainExists = Boolean(sameDomainSite);

      if (!domainExists) {
        // Parked sites still belong to the account and retain their data. They
        // count here so a downgraded customer cannot create a replacement to
        // bypass the canonical site allowance.
        if (
          limits.maxSites < 9999 &&
          activeExistingSites.length >= limits.maxSites
        ) {
          throw new Error(
            `Site limit reached (${activeExistingSites.length}/${limits.maxSites}). Upgrade your plan to add more sites.`,
          );
        }
      }
    }

    const requestedCadence = isNewSite
      ? args.cadencePerWeek ??
        defaultCadenceForMonthlyLimit(cadenceSnapshot.maxArticles)
      : args.cadencePerWeek;
    let effectiveCadence: number | undefined;
    let reserveCadence = false;
    if (requestedCadence !== undefined) {
      if (isNewSite && args.cadencePerWeek === undefined) {
        effectiveCadence = allocateCadenceForMonthlyAllowance(
          requestedCadence,
          cadenceSnapshot.availableArticles,
        );
        reserveCadence = true;
      } else if (cadenceSite?.planParkedAt) {
        // A parked tenant retains customer intent but receives no paid article
        // allocation until a trusted plan reconciliation reactivates it.
        effectiveCadence = undefined;
      } else {
        assertCadenceFitsAccountAllowance(
          requestedCadence,
          cadenceSnapshot.availableArticles,
          cadenceSnapshot.maxArticles,
        );
        effectiveCadence = requestedCadence;
        reserveCadence = true;
      }
    }

    validateOrganicClickGoal(args.organicClickGoalMonthly);
    const autopilotEnabled = args.autopilotEnabled ?? true;
    const inferToneNiche = args.inferToneNiche ?? true;
    const approvalRequired = args.approvalRequired ?? false;

    const data = {
      domain,
      canonicalDomain: domain,
      niche: args.niche,
      tone: args.tone,
      language: args.language,
      cadencePerWeek: effectiveCadence,
      cadenceRequestedPerWeek: requestedCadence,
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
      organicClickGoalMonthly: args.organicClickGoalMonthly,
      urlStructure: args.urlStructure,
      updatedAt: now(),
    };

    if (args.id) {
      if (args.createOnly) {
        throw new Error("A create-only setup cannot update an existing site");
      }
      // Strip undefined values — Convex patch with undefined CLEARS the field,
      // so partial step saves (e.g. profile step, audience step) would wipe
      // fields set by other steps (e.g. ctaUrl set in strategy step).
      const definedData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ) as typeof data;
      const authorityDomainChanged =
        normalizedAuthorityDomain(currentSite!.domain) !==
        normalizedAuthorityDomain(domain);
      if (authorityDomainChanged) {
        await demoteOutreachForDomainChange(ctx, args.id);
      }
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
      if (reserveCadence && effectiveCadence !== undefined) {
        await reserveAccountCadence(ctx, cadenceSnapshot, effectiveCadence);
      }
      await ctx.db.patch(args.id, {
        ...definedData,
        domainOwnershipConflictAt: undefined,
        ...(invalidatesRollout
          ? {
              autopilotRolloutMode: "observe",
              autopilotRolloutEpoch:
                (currentSite!.autopilotRolloutEpoch ?? 0) + 1,
              publicationAdapterVerifiedAt: undefined,
              publicationAdapterVersion: undefined,
              publicationAdapterConfigHash: undefined,
            }
          : {}),
        ...(authorityDomainChanged
          ? {
              seoAuthorityDomain: undefined,
              seoAuthorityDomainRank: undefined,
              seoAuthorityReferringDomains: undefined,
              seoAuthoritySource: undefined,
              seoAuthorityMeasuredAt: undefined,
            }
          : {}),
      });
      if (requestedCadence !== undefined) {
        await rebalanceAccountCadencesAfterRequest(ctx, cadenceSnapshot);
      }
      await syncOrganicClickGoal(ctx, args.id, args.organicClickGoalMonthly);
      return args.id;
    }

    const existing = domainClaim;

    if (existing?._id) {
      if (args.createOnly) {
        throw new Error("This website is already connected to your account");
      }
      if (existing.userId !== userId) {
        throw new Error("This domain is already connected to another account");
      }
      if (existing.deletionStatus) {
        throw new Error("This domain is currently being deleted; wait for deletion to finish before reconnecting it");
      }
      // Merge: only overwrite fields that are explicitly provided
      const merged: Record<string, unknown> = { updatedAt: now(), userId };
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedAt") continue;
        merged[key] = value ?? (existing as Record<string, unknown>)[key];
      }
      clearStaleGitHubBranch(existing, merged);
      const authorityDomainChanged =
        normalizedAuthorityDomain(existing.domain) !==
        normalizedAuthorityDomain(String(merged.domain ?? existing.domain));
      if (authorityDomainChanged) {
        await demoteOutreachForDomainChange(ctx, existing._id);
      }
      const invalidatesRollout = deliveryConfigChanged(existing, merged);
      if (invalidatesRollout) assertConfigUnlocked(existing);
      if (invalidatesRollout) {
        await cancelAutonomousJobsForEpochTransition(
          ctx,
          existing._id,
          "site configuration changed",
        );
      }
      if (reserveCadence && effectiveCadence !== undefined) {
        await reserveAccountCadence(ctx, cadenceSnapshot, effectiveCadence);
      }
      await ctx.db.patch(existing._id, {
        ...merged,
        domainOwnershipConflictAt: undefined,
        ...(invalidatesRollout
          ? {
              autopilotRolloutMode: "observe",
              autopilotRolloutEpoch:
                (existing.autopilotRolloutEpoch ?? 0) + 1,
              publicationAdapterVerifiedAt: undefined,
              publicationAdapterVersion: undefined,
              publicationAdapterConfigHash: undefined,
            }
          : {}),
        ...(authorityDomainChanged
          ? {
              seoAuthorityDomain: undefined,
              seoAuthorityDomainRank: undefined,
              seoAuthorityReferringDomains: undefined,
              seoAuthoritySource: undefined,
              seoAuthorityMeasuredAt: undefined,
            }
          : {}),
      });
      if (requestedCadence !== undefined) {
        await rebalanceAccountCadencesAfterRequest(ctx, cadenceSnapshot);
      }
      await syncOrganicClickGoal(ctx, existing._id, args.organicClickGoalMonthly);
      return existing._id;
    }

    if (effectiveCadence === undefined) {
      throw new Error("A new site requires an account cadence allocation");
    }
    await reserveAccountCadence(ctx, cadenceSnapshot, effectiveCadence);
    const siteId = await ctx.db.insert("sites", {
      ...data,
      userId,
      planFeatures,
      language: args.language ?? "en",
      cadenceRequestedPerWeek: requestedCadence,
      cadencePerWeek: effectiveCadence,
      publishMethod: args.publishMethod ?? "github",
      externalLinking: args.externalLinking ?? true,
      sourceCitations: args.sourceCitations ?? true,
      youtubeEmbeds: args.youtubeEmbeds ?? false,
      urlStructure: args.urlStructure ?? "/blog/[slug]",
      autopilotRolloutMode: "observe",
      autopilotRolloutEpoch: 0,
      createdAt: now(),
    });
    await syncOrganicClickGoal(ctx, siteId, args.organicClickGoalMonthly);
    return siteId;
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
    organicClickGoalMonthly: v.optional(v.number()),
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
    const accountDeletion = site.userId
      ? await ctx.db
          .query("account_deletion_receipts")
          .withIndex("by_account_key", (q) =>
            q.eq("accountKey", accountDeletionKey(site.userId!))
          )
          .unique()
      : null;
    // Parked sites remain editable, but a verified account deletion is a
    // permanent lifecycle fence. In particular, a captured session cannot
    // restore publishing/outreach credentials during the quiescence window.
    if (site.accountDeletionRequestedAt || accountDeletion) {
      throw new Error("This account has been deleted and cannot update sites");
    }
    validateOrganicClickGoal(fields.organicClickGoalMonthly);
    let cadenceSnapshot: AccountCadenceSnapshot | null = null;
    if (fields.cadencePerWeek !== undefined) {
      cadenceSnapshot = await accountCadenceSnapshot(
        ctx,
        site.userId!,
        site,
        site.planFeatures ?? [],
      );
      if (!cadenceSnapshot.ready) {
        throw new Error(
          "Your plan update is still reconciling. Cadence capacity will be available when it completes.",
        );
      }
      if (!site.planParkedAt) {
        assertCadenceFitsAccountAllowance(
          fields.cadencePerWeek,
          cadenceSnapshot.availableArticles,
          cadenceSnapshot.maxArticles,
        );
      }
    }
    const requestedCadence = fields.cadencePerWeek;
    if (requestedCadence !== undefined && site.planParkedAt) {
      // Preserve the requested setting while the plan leaves this site parked;
      // reconciliation will allocate it only if a later plan has capacity.
      fields.cadencePerWeek = undefined;
    }
    const patch: Record<string, unknown> = {
      updatedAt: now(),
      ...(requestedCadence !== undefined
        ? { cadenceRequestedPerWeek: requestedCadence }
        : {}),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    if (
      requestedCadence !== undefined &&
      !site.planParkedAt &&
      cadenceSnapshot
    ) {
      await reserveAccountCadence(
        ctx,
        cadenceSnapshot,
        requestedCadence,
      );
      patch.cadencePerWeek = requestedCadence;
      patch.cadenceRequestedPerWeek = requestedCadence;
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
            publicationAdapterVerifiedAt: undefined,
            publicationAdapterVersion: undefined,
            publicationAdapterConfigHash: undefined,
          }
        : {}),
    });
    if (requestedCadence !== undefined && cadenceSnapshot) {
      await rebalanceAccountCadencesAfterRequest(ctx, cadenceSnapshot);
    }
    await syncOrganicClickGoal(ctx, siteId, fields.organicClickGoalMonthly);
  },
});

const SITE_DELETION_BATCH = 100;
// Credentials disappear immediately, while the data sweep waits long enough
// for any action that captured the tenant before the deletion request to
// finish. New work is fenced by deletionStatus/getFull and fleet filters.
const SITE_DELETION_QUIESCENCE_MS = 20 * 60 * 1000;
const ACCOUNT_DELETION_SITE_PAGE_SIZE = 5;
const ACCOUNT_DELETION_RECEIPT_BATCH = 100;
const ACCOUNT_DELETION_RETRY_MS = 60 * 1000;
const ACCOUNT_DELETION_RECEIPT_STAGES = [
  "outreach_foreign_owner_messages",
  "outreach_foreign_owner_contacts",
  "outreach_foreign_owner_suppressions",
  "outreach_foreign_owner_inboxes",
  "outreach_durability_migrations",
  "outreach_sender_suppression_tombstones",
  "outreach_tenant_contact_receipts",
  "outreach_sender_pacing_receipts",
  "article_generation_attempts",
  "provider_spend_reservations",
  "usage_log",
] as const;
const SITE_DELETION_STAGES = [
  "one_setup_executions",
  "managed_provisioning_requests",
  "outreach_inbound_relay_canaries",
  "outreach_inbound_relay_receipts",
  "outreach_messages",
  "outreach_contacts",
  "outreach_suppressions",
  "outreach_inboxes",
  "outcome_receipts",
  "outcome_daily_rollups",
  "outcome_ingest_credentials",
  "seo_authority_runs",
  "seo_authority_opportunities",
  "expected_click_demand_jobs",
  "expected_click_evidence_jobs",
  "cadence_micro_seed_jobs",
  "provider_spend_reservations",
  "legacy_publication_receipt_adoptions",
  "published_article_revisions",
  "seo_growth_actions",
  "seo_growth_health",
  "seo_growth_goals",
  "search_page_daily",
  "search_performance",
  "autopilot_alerts",
  "autopilot_health",
  "autopilot_runs",
  "article_summaries",
  "plan_candidate_checkpoints",
  "jobs",
  "topic_clusters",
  "pages",
  "articles",
  "usage_log",
] as const;

async function gateInboundRelayCanaryExternalLease(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  operation: string,
): Promise<void> {
  const timestamp = now();
  const canaries = await ctx.db
    .query("outreach_inbound_relay_canaries")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .take(2);
  const claimed = canaries.filter(
    (canary) => canary.deliveryStatus === "claimed",
  );
  if (claimed.some(
    (canary) => (canary.deliveryLeaseExpiresAt ?? 0) > timestamp,
  )) {
    throw new Error(
      `Cannot ${operation} while the owner-triggered Gmail routing canary is in progress`,
    );
  }
  for (const canary of claimed) {
    await ctx.db.patch(canary._id, {
      deliveryStatus: "unverified",
      deliveryLeaseExpiresAt: undefined,
      deliveryFinalizedAt: timestamp,
    });
  }
}

async function gateSiteDeletionForOutreach(
  ctx: MutationCtx,
  siteId: Id<"sites">,
): Promise<
  | { ready: true }
  | {
      ready: false;
      reason:
        | "outreach_delivery_unverified"
        | "outreach_owner_unresolved";
      convertedExpired: number;
    }
> {
  const timestamp = now();
  await gateInboundRelayCanaryExternalLease(ctx, siteId, "delete this site");
  const [sending, unresolved] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "sending")
      )
      .take(10),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified")
      )
      .take(1),
  ]);
  const decision = outreachDeletionGate({
    sending: sending.map((message) => ({
      messageId: message._id,
      status: message.status,
      attemptId: message.deliveryAttemptId,
      leaseExpiresAt: message.deliveryLeaseExpiresAt,
    })),
    unresolvedDeliveryCount: unresolved.length,
    now: timestamp,
  });
  if (decision.state === "in_flight") {
    // Throwing leaves the whole mutation untouched. The serializable read of
    // the sending index also conflicts with a concurrent approved -> sending
    // claim, so either the claim wins or deletion does, never both.
    throw new Error(
      "Cannot delete a site while outreach delivery is in progress",
    );
  }
  if (decision.state === "expired_unverified") {
    for (const messageId of decision.expiredMessageIds) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: timestamp,
        failureReason:
          "The delivery lease expired before tenant deletion. Review Gmail's Sent folder and resolve this outcome before deleting the site; it will not be retried automatically.",
        updatedAt: timestamp,
      });
    }
    return {
      ready: false,
      reason: "outreach_delivery_unverified",
      convertedExpired: decision.expiredMessageIds.length,
    };
  }
  if (decision.state === "manual_review") {
    return {
      ready: false,
      reason: "outreach_delivery_unverified",
      convertedExpired: 0,
    };
  }
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .take(2);
  const exactInboxOwner = inboxes.length === 1
    ? inboxes[0].credentialOwnerAccountKey
    : undefined;
  if (!exactInboxOwner) {
    const [suppression, ...acceptedBatches] = await Promise.all([
      ctx.db
        .query("outreach_suppressions")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first(),
      ...[
        "sent",
        "delivery_reviewed_sent",
        "replied",
        "bounced",
        "delivery_unverified",
      ].map((status) =>
        ctx.db
          .query("outreach_messages")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", status)
          )
          .take(51)
      ),
    ]);
    const unresolvedAccepted = acceptedBatches.some(
      (batch) =>
        batch.length >= 51 ||
        batch.some((message) => !message.deliveryOwnerAccountKey),
    );
    if (
      suppression ||
      unresolvedAccepted ||
      inboxes.some((inbox) => Boolean(inbox.lastSentAt))
    ) {
      return {
        ready: false,
        reason: "outreach_owner_unresolved",
        convertedExpired: 0,
      };
    }
  }
  return { ready: true };
}

async function requestSiteDeletion(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  ownerUserId: string,
) {
  const site = await ctx.db.get(siteId);
  if (!site || site.userId !== ownerUserId) throw new Error("Site not found");
  if (site.publicationLeaseOwner) {
    throw new Error("Cannot delete a site while a publication lease exists");
  }
  const leasedArticles = await ctx.db
    .query("articles")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  if (leasedArticles.some((article) => article.publicationLeaseOwner)) {
    throw new Error("Cannot delete a site while an article publication lease exists");
  }
  for (const revisionStatus of [
    "leased",
    "attempted",
  ]) {
    const unresolvedRevision = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", revisionStatus as
          | "leased"
          | "attempted")
      )
      .first();
    if (unresolvedRevision) {
      throw new Error(
        "Cannot delete a site while a published revision delivery is in progress",
      );
    }
  }
  const ambiguousRevision = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", siteId).eq("status", "unverified")
    )
    .filter((q) => q.eq(q.field("receipt"), undefined))
    .first();
  if (ambiguousRevision) {
    throw new Error(
      "Cannot delete a site while a published revision has an unverified external delivery outcome",
    );
  }
  if (site.deletionStatus) return { scheduled: true, alreadyRequested: true };

  const outreachDeletion = await gateSiteDeletionForOutreach(ctx, siteId);
  if (!outreachDeletion.ready) {
    return {
      scheduled: false,
      alreadyRequested: false,
      deferred: true,
      reason: outreachDeletion.reason,
      convertedExpired: outreachDeletion.convertedExpired,
    };
  }

  await cancelAutonomousJobsForEpochTransition(
    ctx,
    siteId,
    "tenant deletion requested",
    true,
  );
  const timestamp = now();
  // Revoke every credential on the site row immediately. Bulk data removal is
  // resumable, but a deletion request must not leave a usable token while it
  // is waiting for the next batch.
  await ctx.db.patch(siteId, {
    deletionStatus: "running",
    deletionRequestedAt: timestamp,
    deletionRequestedBy: ownerUserId,
    deletionStage: 0,
    autopilotEnabled: false,
    autopilotRolloutMode: "observe",
    autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
    githubToken: undefined,
    wpAppPassword: undefined,
    webhookSecret: undefined,
    mediumToken: undefined,
    linkedinAccessToken: undefined,
    gscAccessToken: undefined,
    gscRefreshToken: undefined,
    gscEmail: undefined,
    wpUsername: undefined,
    webhookUrl: undefined,
    updatedAt: timestamp,
  });
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  for (const inbox of inboxes) {
    await ctx.db.patch(inbox._id, {
      status: "disconnected",
      mode: "approval",
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      verifiedAt: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      inboundRelayDsnRoutingTargetGeneration: undefined,
      updatedAt: timestamp,
    });
  }
  await ctx.scheduler.runAfter(
    SITE_DELETION_QUIESCENCE_MS,
    internal.sites.continueSiteDeletionInternal,
    { siteId, stage: 0 },
  );
  return { scheduled: true, alreadyRequested: false };
}

async function revokeSiteCredentialsForAccountDeletion(
  ctx: MutationCtx,
  site: Doc<"sites">,
  timestamp: number,
) {
  await gateInboundRelayCanaryExternalLease(
    ctx,
    site._id,
    "delete this account",
  );
  if (!site.accountDeletionRequestedAt) {
    await cancelAutonomousJobsForEpochTransition(
      ctx,
      site._id,
      "verified account deletion requested",
      true,
    );
  }
  await ctx.db.patch(site._id, {
    accountDeletionRequestedAt:
      site.accountDeletionRequestedAt ?? timestamp,
    autopilotEnabled: false,
    autopilotRolloutMode: "observe",
    autopilotRolloutEpoch:
      (site.autopilotRolloutEpoch ?? 0) +
      (site.accountDeletionRequestedAt ? 0 : 1),
    githubToken: undefined,
    wpAppPassword: undefined,
    webhookSecret: undefined,
    mediumToken: undefined,
    linkedinAccessToken: undefined,
    gscAccessToken: undefined,
    gscRefreshToken: undefined,
    gscEmail: undefined,
    wpUsername: undefined,
    webhookUrl: undefined,
    updatedAt: timestamp,
  });
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", site._id))
    .collect();
  for (const inbox of inboxes) {
    await ctx.db.patch(inbox._id, {
      status: "disconnected",
      mode: "approval",
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      verifiedAt: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      inboundRelayDsnRoutingTargetGeneration: undefined,
      updatedAt: timestamp,
    });
  }
}

async function continueAccountDeletionPage(
  ctx: MutationCtx,
  receiptId: Id<"account_deletion_receipts">,
) {
  const receipt = await ctx.db.get(receiptId);
  if (!receipt || receipt.status !== "revoking" || !receipt.userId) {
    return { status: receipt?.status ?? "missing", scheduled: 0 };
  }
  const page = await ctx.db
    .query("sites")
    .withIndex("by_user", (q) => q.eq("userId", receipt.userId!))
    .order("asc")
    .paginate({
      cursor: receipt.siteCursor ?? null,
      numItems: ACCOUNT_DELETION_SITE_PAGE_SIZE,
    });
  const timestamp = now();
  for (const site of page.page) {
    await revokeSiteCredentialsForAccountDeletion(ctx, site, timestamp);
    await ctx.scheduler.runAfter(
      SITE_DELETION_QUIESCENCE_MS,
      internal.sites.finalizeAccountSiteDeletionInternal,
      { receiptId, siteId: site._id },
    );
  }
  const sitesRevoked = receipt.sitesRevoked + page.page.length;
  if (page.isDone) {
    await ctx.db.patch(receiptId, {
      status: "purging",
      siteCursor: undefined,
      sitesRevoked,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      SITE_DELETION_QUIESCENCE_MS,
      internal.sites.finalizeAccountDeletionInternal,
      { receiptId },
    );
  } else {
    await ctx.db.patch(receiptId, {
      siteCursor: page.continueCursor,
      sitesRevoked,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.sites.continueAccountDeletionInternal,
      { receiptId },
    );
  }
  return {
    status: page.isDone ? "purging" : "revoking",
    scheduled: page.page.length,
    sitesRevoked,
  };
}

async function deletionRowsForStage(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  stage: number,
): Promise<Array<{ _id: Id<TableNames> }>> {
  const name = SITE_DELETION_STAGES[stage];
  switch (name) {
    case "one_setup_executions":
      return ctx.db
        .query("one_setup_executions")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(SITE_DELETION_BATCH);
    case "managed_provisioning_requests":
      return ctx.db
        .query("managed_provisioning_requests")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(SITE_DELETION_BATCH);
    case "outreach_inbound_relay_canaries":
      return ctx.db.query("outreach_inbound_relay_canaries").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_inbound_relay_receipts":
      return ctx.db.query("outreach_inbound_relay_receipts").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_messages":
      return ctx.db.query("outreach_messages").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_contacts":
      return ctx.db.query("outreach_contacts").withIndex("by_site_domain", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_suppressions":
      return ctx.db.query("outreach_suppressions").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_inboxes":
      return ctx.db.query("outreach_inboxes").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outcome_receipts":
      return ctx.db.query("outcome_receipts").withIndex("by_site_occurred", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outcome_daily_rollups":
      return ctx.db.query("outcome_daily_rollups").withIndex("by_site_date", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outcome_ingest_credentials":
      return ctx.db.query("outcome_ingest_credentials").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "seo_authority_runs":
      return ctx.db.query("seo_authority_runs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "seo_authority_opportunities":
      return ctx.db.query("seo_authority_opportunities").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "expected_click_demand_jobs":
      return ctx.db.query("expected_click_demand_jobs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "expected_click_evidence_jobs":
      return ctx.db.query("expected_click_evidence_jobs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "cadence_micro_seed_jobs":
      return ctx.db.query("cadence_micro_seed_jobs").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "plan_candidate_checkpoints":
      return ctx.db.query("plan_candidate_checkpoints").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "provider_spend_reservations":
      return ctx.db.query("provider_spend_reservations").withIndex("by_site_created", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "legacy_publication_receipt_adoptions":
      return ctx.db.query("legacy_publication_receipt_adoptions").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "published_article_revisions":
      return ctx.db.query("published_article_revisions").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "seo_growth_actions":
      return ctx.db.query("seo_growth_actions").withIndex("by_site_status", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "seo_growth_health":
      return ctx.db.query("seo_growth_health").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "seo_growth_goals":
      return ctx.db.query("seo_growth_goals").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "search_page_daily":
      return ctx.db.query("search_page_daily").withIndex("by_site_date", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "search_performance":
      return ctx.db.query("search_performance").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "autopilot_alerts":
      return ctx.db.query("autopilot_alerts").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "autopilot_health":
      return ctx.db.query("autopilot_health").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "autopilot_runs":
      return ctx.db.query("autopilot_runs").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "article_summaries":
      return ctx.db.query("article_summaries").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "jobs":
      return ctx.db.query("jobs").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "topic_clusters":
      return ctx.db.query("topic_clusters").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "pages":
      return ctx.db.query("pages").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "articles":
      return ctx.db.query("articles").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "usage_log":
      return ctx.db.query("usage_log").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    default:
      return [];
  }
}

export const continueSiteDeletionInternal = internalMutation({
  args: { siteId: v.id("sites"), stage: v.number() },
  handler: async (ctx, { siteId, stage }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return { done: true };
    if (site.deletionStatus !== "running") {
      throw new Error("Site deletion is not active");
    }
    const verifiedAccountDeletion = Boolean(
      site.accountDeletionRequestedAt &&
        site.deletionRequestedBy === "verified_account_deletion",
    );
    const safeStage = Math.max(0, Math.floor(stage));
    if (safeStage >= SITE_DELETION_STAGES.length) {
      // A provider action may have captured this tenant before deletion was
      // requested and written a late row after its table's first sweep. Read
      // every tenant-scoped index once more before deleting the site. Convex's
      // optimistic transaction semantics make a concurrent matching insert
      // conflict/retry this final mutation instead of leaving an orphan.
      for (let verifyStage = 0; verifyStage < SITE_DELETION_STAGES.length; verifyStage++) {
        const lingering = await deletionRowsForStage(ctx, siteId, verifyStage);
        if (lingering.length > 0) {
          await ctx.db.patch(siteId, {
            deletionStage: verifyStage,
            updatedAt: now(),
          });
          await ctx.scheduler.runAfter(
            0,
            internal.sites.continueSiteDeletionInternal,
            { siteId, stage: verifyStage },
          );
          return {
            done: false,
            stage: "final_verification",
            deleted: 0,
            nextStage: verifyStage,
          };
        }
      }
      const ownerUserId = site.userId;
      const currentEntitlement = ownerUserId
        ? await ctx.db
            .query("account_plan_entitlements")
            .withIndex("by_user", (q) => q.eq("userId", ownerUserId))
            .unique()
        : null;
      // A site-local mirror may be stale when deletion finishes concurrently
      // with an upgrade/downgrade. Only the current account receipt is
      // authoritative when it exists.
      await ctx.db.delete(siteId);
      // Only an authoritative account receipt may reactivate a parked site.
      // A legacy site-local mirror must never be promoted into a new canonical
      // entitlement while a deletion finishes.
      if (
        ownerUserId &&
        currentEntitlement &&
        currentEntitlement.status !== "deleting"
      ) {
        await applyCanonicalPlanToUserSites(
          ctx,
          ownerUserId,
          currentEntitlement.planFeatures,
          { forceReconcile: true },
        );
      }
      return { done: true };
    }
    const rows = await deletionRowsForStage(ctx, siteId, safeStage);
    for (const row of rows) {
      if (SITE_DELETION_STAGES[safeStage] === "outreach_messages") {
        const message = row as Doc<"outreach_messages">;
        const acceptedAt = message.sentAt ?? (
          message.status === "delivery_unverified"
            ? message.deliveryClaimedAt
            : undefined
        );
        if (acceptedAt) {
          const messageInbox = message.inboxId
            ? await ctx.db.get(message.inboxId)
            : null;
          const settlementAccountKey =
            message.deliveryOwnerAccountKey ??
            (messageInbox?.siteId === siteId
              ? messageInbox.credentialOwnerAccountKey
              : undefined);
          if (!settlementAccountKey && !verifiedAccountDeletion) {
            throw new Error(
              "Outreach history has unresolved immutable ownership; prove the exact legacy mailbox owner before deletion",
            );
          }
          // Legacy rows predate the durable ledgers. Materialize the exact
          // compliance/reputation state in the same transaction before the
          // site-scoped evidence is removed. Ordinary site deletion also
          // permanently retires previously-contacted recipients, closing the
          // delayed STOP race without retaining an inbound alias.
          if (settlementAccountKey) {
            await recordDurableContactReceiptForAccount(
              ctx,
              settlementAccountKey,
              message.toDomain,
              acceptedAt,
            );
            await materializeOutreachSuppressionTombstoneForAccount(
              ctx,
              settlementAccountKey,
              "domain",
              message.toDomain,
              "manual",
              acceptedAt,
            );
            await materializeOutreachSuppressionTombstoneForAccount(
              ctx,
              settlementAccountKey,
              "email",
              message.toEmail,
              "manual",
              acceptedAt,
            );
            if (messageInbox && messageInbox.siteId === siteId) {
              await recordDurablePacingReceiptForAccount(
                ctx,
                settlementAccountKey,
                messageInbox,
                acceptedAt,
                false,
              );
            }
          } else if (messageInbox && messageInbox.siteId === siteId) {
            // A verified full-account erasure must not deadlock or attach an
            // unproven legacy send to the deleting/current account. Scrub the
            // raw recipient/body row and retain only the unlinked global
            // sender-domain pacing fence disclosed in the privacy policy.
            await recordUnlinkedDurablePacingReceipt(
              ctx,
              messageInbox,
              acceptedAt,
            );
          }
        }
        await ctx.db.delete(message._id);
      } else if (SITE_DELETION_STAGES[safeStage] === "outreach_suppressions") {
        const suppression = row as Doc<"outreach_suppressions">;
        if (suppression.kind === "domain" || suppression.kind === "email") {
          const suppressionInboxes = await ctx.db
            .query("outreach_inboxes")
            .withIndex("by_site", (q) => q.eq("siteId", siteId))
            .take(2);
          const settlementAccountKey = suppression.ownerAccountKey ?? (
            !suppression.ownerLineageUnresolvedAt &&
              suppressionInboxes.length === 1
              ? suppressionInboxes[0].credentialOwnerAccountKey
              : undefined
          );
          if (!settlementAccountKey && !verifiedAccountDeletion) {
            throw new Error(
              "Outreach suppression history has unresolved immutable ownership; prove the exact legacy mailbox owner before deletion",
            );
          }
          if (settlementAccountKey) {
            await materializeOutreachSuppressionTombstoneForAccount(
              ctx,
              settlementAccountKey,
              suppression.kind,
              suppression.value,
              suppression.reason,
              suppression.createdAt,
            );
          }
        }
        await ctx.db.delete(suppression._id);
      } else if (SITE_DELETION_STAGES[safeStage] === "outreach_inboxes") {
        const inbox = row as Doc<"outreach_inboxes">;
        if (inbox.lastSentAt) {
          const settlementAccountKey = inbox.credentialOwnerAccountKey;
          if (!settlementAccountKey && !verifiedAccountDeletion) {
            throw new Error(
              "Outreach inbox pacing has unresolved immutable ownership; prove the exact legacy mailbox owner before deletion",
            );
          }
          if (settlementAccountKey) {
            await recordDurablePacingReceiptForAccount(
              ctx,
              settlementAccountKey,
              inbox,
              inbox.lastSentAt,
              false,
            );
          } else {
            await recordUnlinkedDurablePacingReceipt(
              ctx,
              inbox,
              inbox.lastSentAt,
            );
          }
        }
        await ctx.db.delete(inbox._id);
      } else if (SITE_DELETION_STAGES[safeStage] === "usage_log") {
        // Preserve the owner's immutable billing-period consumption so
        // deleting and recreating a site cannot reset article/provider
        // entitlement. Remove every reference to the deleted tenant's
        // content while retaining only the user-level quota audit fields.
        await ctx.db.patch(row._id as Id<"usage_log">, {
          siteId: undefined,
          jobId: undefined,
          articleId: undefined,
        });
      } else if (
        SITE_DELETION_STAGES[safeStage] === "provider_spend_reservations"
      ) {
        // Fleet day/month circuit breakers must survive tenant deletion, or a
        // user could delete and recreate a site to refund paid provider work.
        // Remove the site reference while retaining the owner-level spend row.
        await ctx.db.patch(row._id as Id<"provider_spend_reservations">, {
          siteId: undefined,
        });
      } else {
        await ctx.db.delete(row._id);
      }
    }
    const nextStage = rows.length >= SITE_DELETION_BATCH
      ? safeStage
      : safeStage + 1;
    await ctx.db.patch(siteId, { deletionStage: nextStage, updatedAt: now() });
    await ctx.scheduler.runAfter(0, internal.sites.continueSiteDeletionInternal, {
      siteId,
      stage: nextStage,
    });
    return {
      done: false,
      stage: SITE_DELETION_STAGES[safeStage],
      deleted: rows.length,
      nextStage,
    };
  },
});

export const requestSiteDeletionInternal = internalMutation({
  args: { siteId: v.id("sites"), ownerUserId: v.string() },
  handler: async (ctx, { siteId, ownerUserId }) =>
    requestSiteDeletion(ctx, siteId, ownerUserId),
});

export const requestAccountDeletionInternal = internalMutation({
  args: {
    userId: v.string(),
    sourceEventId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, sourceEventId }) => {
    const safeUserId = userId.trim();
    if (
      !safeUserId.startsWith("user_") ||
      safeUserId.length > 512 ||
      (sourceEventId !== undefined &&
        (!sourceEventId.trim() || sourceEventId.length > 512))
    ) {
      throw new Error("Invalid verified account deletion payload");
    }
    const key = accountDeletionKey(safeUserId);
    const existingReceipt = await ctx.db
      .query("account_deletion_receipts")
      .withIndex("by_account_key", (q) => q.eq("accountKey", key))
      .unique();
    const timestamp = now();
    const entitlement = await ctx.db
      .query("account_plan_entitlements")
      .withIndex("by_user", (q) => q.eq("userId", safeUserId))
      .unique();
    const unexpectedSite = existingReceipt?.status === "completed"
      ? await ctx.db
          .query("sites")
          .withIndex("by_user", (q) => q.eq("userId", safeUserId))
          .first()
      : null;
    if (
      existingReceipt?.status === "completed" &&
      !entitlement &&
      !unexpectedSite
    ) {
      return {
        accepted: true,
        status: "completed",
        alreadyRequested: true,
      };
    }
    const entitlementFields = {
      status: "deleting",
      syncVersion: (entitlement?.syncVersion ?? 0) + 1,
      syncStartedAt: timestamp,
      cursor: undefined,
      remainingAllowance: 0,
      remainingArticleAllowance: 0,
      allocatedMonthlyArticles: 0,
      cadenceAllocationVersion: CADENCE_ALLOCATION_VERSION,
      updatedAt: timestamp,
    };
    if (entitlement) {
      await ctx.db.patch(entitlement._id, entitlementFields);
    } else {
      // The verified deletion event is authoritative for lifecycle, not for a
      // paid tier. A zero-capacity deleting receipt atomically fences legacy
      // accounts without guessing or silently assigning a Free plan.
      await ctx.db.insert("account_plan_entitlements", {
        userId: safeUserId,
        planFeatures: [],
        maxSites: 0,
        maxArticles: 0,
        authoritativeVerifiedAt: timestamp,
        ...entitlementFields,
        createdAt: timestamp,
      });
    }

    const sourceEventKey = sourceEventId
      ? sha256Hex(`pentra-clerk-event:v1:${sourceEventId.trim()}`)
      : existingReceipt?.sourceEventKey;
    const receiptId = existingReceipt?._id ??
      await ctx.db.insert("account_deletion_receipts", {
        accountKey: key,
        userId: safeUserId,
        sourceEventKey,
        status: "revoking",
        sitesRevoked: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    if (existingReceipt) {
      await ctx.db.patch(existingReceipt._id, {
        userId: safeUserId,
        sourceEventKey,
        ...(existingReceipt.status === "completed"
          ? {
              status: "revoking",
              siteCursor: undefined,
              receiptStage: undefined,
              completedAt: undefined,
              sitesRevoked: 0,
            }
          : {}),
        updatedAt: timestamp,
      });
      if (
        existingReceipt.status === "revoking" ||
        existingReceipt.status === "completed"
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.sites.continueAccountDeletionInternal,
          { receiptId },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.sites.finalizeAccountDeletionInternal,
          { receiptId },
        );
      }
      return {
        accepted: true,
        status:
          existingReceipt.status === "completed"
            ? "revoking"
            : existingReceipt.status,
        alreadyRequested: true,
      };
    }

    const firstPage = await continueAccountDeletionPage(ctx, receiptId);
    return {
      accepted: true,
      status: firstPage.status,
      alreadyRequested: false,
      sitesRevoked: firstPage.sitesRevoked,
    };
  },
});

export const continueAccountDeletionInternal = internalMutation({
  args: { receiptId: v.id("account_deletion_receipts") },
  handler: async (ctx, { receiptId }) =>
    continueAccountDeletionPage(ctx, receiptId),
});

export const finalizeAccountSiteDeletionInternal = internalMutation({
  args: {
    receiptId: v.id("account_deletion_receipts"),
    siteId: v.id("sites"),
  },
  handler: async (ctx, { receiptId, siteId }) => {
    const receipt = await ctx.db.get(receiptId);
    const site = await ctx.db.get(siteId);
    if (!receipt || receipt.status === "completed" || !receipt.userId) {
      return { scheduled: false, reason: "account_deletion_inactive" };
    }
    if (!site) return { scheduled: false, reason: "site_deleted" };
    if (
      site.userId !== receipt.userId ||
      accountDeletionKey(site.userId ?? "") !== receipt.accountKey
    ) {
      throw new Error("Account deletion tenant boundary mismatch");
    }
    if (site.deletionStatus === "running") {
      return { scheduled: false, reason: "site_purge_running" };
    }
    const timestamp = now();
    const quiescentAt =
      (site.accountDeletionRequestedAt ?? timestamp) +
      SITE_DELETION_QUIESCENCE_MS;
    const [sending, canaries] = await Promise.all([
      ctx.db
        .query("outreach_messages")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "sending")
        )
        .take(100),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(2),
    ]);
    const latestExternalLease = Math.max(
      site.publicationLeaseExpiresAt ?? 0,
      ...sending.map((message) => message.deliveryLeaseExpiresAt ?? 0),
      ...canaries.map((canary) => canary.deliveryLeaseExpiresAt ?? 0),
    );
    const safeAfter = Math.max(quiescentAt, latestExternalLease + 1_000);
    if (safeAfter > timestamp) {
      await ctx.scheduler.runAfter(
        Math.min(safeAfter - timestamp, SITE_DELETION_QUIESCENCE_MS),
        internal.sites.finalizeAccountSiteDeletionInternal,
        { receiptId, siteId },
      );
      return { scheduled: true, reason: "awaiting_safety_quiescence" };
    }

    // Every supported external lease is at most fifteen minutes. Only after
    // the longer twenty-minute account quiescence may stale lease metadata be
    // cleared; no external write is retried and the ordinary deletion sweep
    // removes the now-inert evidence rows.
    await ctx.db.patch(siteId, {
      publicationLeaseOwner: undefined,
      publicationLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    const leasedArticles = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .filter((q) => q.neq(q.field("publicationLeaseOwner"), undefined))
      .take(100);
    for (const article of leasedArticles) {
      await ctx.db.patch(article._id, {
        publicationLeaseHash: undefined,
        publicationLeaseOwner: undefined,
        publicationLeaseStartedAt: undefined,
        updatedAt: timestamp,
      });
    }
    for (const status of ["leased", "attempted"] as const) {
      const revisions = await ctx.db
        .query("published_article_revisions")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        )
        .take(100);
      for (const revision of revisions) {
        await ctx.db.patch(revision._id, {
          status: "unverified",
          leaseOwner: undefined,
          updatedAt: timestamp,
        });
      }
    }
    const legacyLeases = await ctx.db
      .query("legacy_publication_receipt_adoptions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "leased")
      )
      .take(100);
    for (const adoption of legacyLeases) {
      await ctx.db.patch(adoption._id, {
        status: "failed",
        leaseOwner: undefined,
        failureCode: "account_deleted_after_lease_quiescence",
        failureDetail:
          "The account was deleted after the external lease safety window; no retry is authorized.",
        updatedAt: timestamp,
      });
    }
    for (const message of sending) {
      await ctx.db.patch(message._id, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: timestamp,
        failureReason:
          "The account was deleted after the delivery lease safety window; this message will not be retried.",
        updatedAt: timestamp,
      });
    }

    await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      "account deletion purge started after safety quiescence",
      true,
    );
    await revokeSiteCredentialsForAccountDeletion(ctx, site, timestamp);
    await ctx.db.patch(siteId, {
      deletionStatus: "running",
      deletionRequestedAt: site.accountDeletionRequestedAt ?? timestamp,
      deletionRequestedBy: "verified_account_deletion",
      deletionStage: 0,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.sites.continueSiteDeletionInternal,
      { siteId, stage: 0 },
    );
    return { scheduled: true, reason: "site_purge_started" };
  },
});

async function accountReceiptRowsForStage(
  ctx: MutationCtx,
  userId: string,
  stage: number,
) {
  const name = ACCOUNT_DELETION_RECEIPT_STAGES[stage];
  switch (name) {
    case "outreach_foreign_owner_messages": {
      const ownerAccountKey = accountDeletionKey(userId);
      const [createdByOwner, deliveredByOwner] = await Promise.all([
        ctx.db
          .query("outreach_messages")
          .withIndex("by_owner", (q) =>
            q.eq("ownerAccountKey", ownerAccountKey)
          )
          .take(10),
        ctx.db
          .query("outreach_messages")
          .withIndex("by_delivery_owner", (q) =>
            q.eq("deliveryOwnerAccountKey", ownerAccountKey)
          )
          .take(10),
      ]);
      const unique = new Map<string, Doc<"outreach_messages">>();
      for (const message of [...createdByOwner, ...deliveredByOwner]) {
        unique.set(String(message._id), message);
      }
      return [...unique.values()].slice(0, 10);
    }
    case "outreach_foreign_owner_contacts":
      return ctx.db
        .query("outreach_contacts")
        .withIndex("by_owner", (q) =>
          q.eq("ownerAccountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "outreach_foreign_owner_suppressions":
      return ctx.db
        .query("outreach_suppressions")
        .withIndex("by_owner", (q) =>
          q.eq("ownerAccountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "outreach_foreign_owner_inboxes":
      return ctx.db
        .query("outreach_inboxes")
        .withIndex("by_credential_owner", (q) =>
          q.eq("credentialOwnerAccountKey", accountDeletionKey(userId))
        )
        .take(1);
    case "outreach_durability_migrations":
      return ctx.db
        .query("outreach_durability_migrations")
        .withIndex("by_account", (q) =>
          q.eq("accountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "outreach_sender_suppression_tombstones":
      return ctx.db
        .query("outreach_sender_suppression_tombstones")
        .withIndex("by_account", (q) =>
          q.eq("accountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "outreach_tenant_contact_receipts":
      return ctx.db
        .query("outreach_tenant_contact_receipts")
        .withIndex("by_account", (q) =>
          q.eq("accountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "outreach_sender_pacing_receipts":
      return ctx.db
        .query("outreach_sender_pacing_receipts")
        .withIndex("by_account", (q) =>
          q.eq("accountKey", accountDeletionKey(userId))
        )
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "article_generation_attempts":
      return ctx.db
        .query("article_generation_attempts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "provider_spend_reservations":
      return ctx.db
        .query("provider_spend_reservations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    case "usage_log":
      return ctx.db
        .query("usage_log")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(ACCOUNT_DELETION_RECEIPT_BATCH);
    default:
      return [];
  }
}

async function scrubForeignAccountOutreachMessage(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  timestamp: number,
): Promise<"deleted" | "progress" | "lease_wait"> {
  if (
    message.status === "sending" &&
    (message.deliveryLeaseExpiresAt ?? 0) > timestamp
  ) {
    return "lease_wait";
  }
  const relayReceipts = await ctx.db
    .query("outreach_inbound_relay_receipts")
    .withIndex("by_site_message", (q) =>
      q.eq("siteId", message.siteId).eq("messageId", message._id)
    )
    .take(10);
  for (const relayReceipt of relayReceipts) {
    await ctx.db.delete(relayReceipt._id);
  }
  if (relayReceipts.length >= 10) return "progress";

  const inbox = message.inboxId ? await ctx.db.get(message.inboxId) : null;
  const acceptedAt = message.sentAt ?? (
    ["sending", "delivery_unverified"].includes(message.status)
      ? message.deliveryClaimedAt
      : undefined
  );
  if (acceptedAt && inbox && inbox.siteId === message.siteId) {
    await recordUnlinkedDurablePacingReceipt(ctx, inbox, acceptedAt);
  }
  await ctx.db.delete(message._id);
  return "deleted";
}

export const finalizeAccountDeletionInternal = internalMutation({
  args: { receiptId: v.id("account_deletion_receipts") },
  handler: async (ctx, { receiptId }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) return { completed: true, reason: "receipt_missing" };
    if (receipt.status === "completed") {
      return { completed: true, reason: "already_completed" };
    }
    if (!receipt.userId) {
      throw new Error("Account deletion receipt lost its resumable owner key");
    }
    if (receipt.status === "revoking") {
      await ctx.scheduler.runAfter(
        0,
        internal.sites.continueAccountDeletionInternal,
        { receiptId },
      );
      return { completed: false, reason: "revocation_resumed" };
    }

    const remainingSite = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", receipt.userId!))
      .first();
    if (remainingSite) {
      if (remainingSite.deletionStatus === "running") {
        await ctx.scheduler.runAfter(
          0,
          internal.sites.continueSiteDeletionInternal,
          {
            siteId: remainingSite._id,
            stage: Math.max(0, Math.floor(remainingSite.deletionStage ?? 0)),
          },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.sites.finalizeAccountSiteDeletionInternal,
          { receiptId, siteId: remainingSite._id },
        );
      }
      await ctx.scheduler.runAfter(
        ACCOUNT_DELETION_RETRY_MS,
        internal.sites.finalizeAccountDeletionInternal,
        { receiptId },
      );
      return { completed: false, reason: "site_purge_pending" };
    }

    const stage = Math.max(0, Math.floor(receipt.receiptStage ?? 0));
    if (stage < ACCOUNT_DELETION_RECEIPT_STAGES.length) {
      const rows = await accountReceiptRowsForStage(
        ctx,
        receipt.userId,
        stage,
      );
      const tombstoneUserId = accountDeletionTombstoneUserId(
        receipt.accountKey,
      );
      const name = ACCOUNT_DELETION_RECEIPT_STAGES[stage];
      let externalLeaseWait = false;
      for (const row of rows) {
        if (name === "outreach_foreign_owner_messages") {
          const result = await scrubForeignAccountOutreachMessage(
            ctx,
            row as Doc<"outreach_messages">,
            now(),
          );
          externalLeaseWait ||= result === "lease_wait";
        } else if (name === "outreach_foreign_owner_inboxes") {
          const inbox = row as Doc<"outreach_inboxes">;
          const inboxMessages = await ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
            .take(20);
          for (const message of inboxMessages) {
            const result = await scrubForeignAccountOutreachMessage(
              ctx,
              message,
              now(),
            );
            externalLeaseWait ||= result === "lease_wait";
          }
          if (inboxMessages.length === 0) {
            const canaries = await ctx.db
              .query("outreach_inbound_relay_canaries")
              .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
              .take(20);
            for (const canary of canaries) {
              if (
                canary.deliveryStatus === "claimed" &&
                (canary.deliveryLeaseExpiresAt ?? 0) > now()
              ) {
                externalLeaseWait = true;
                continue;
              }
              await ctx.db.delete(canary._id);
            }
            if (canaries.length === 0) {
              // Pre-lineage rows cannot be attributed merely because this
              // foreign inbox is the last historical credential on the site:
              // current-owner rows may coexist on the same defensive state.
              // Mark only unowned rows unresolved, preserve them for operator
              // review, and make future silent adoption impossible.
              const [unresolvedContacts, unresolvedSuppressions] =
                await Promise.all([
                  ctx.db
                    .query("outreach_contacts")
                    .withIndex("by_site_owner_unresolved", (q) =>
                      q
                        .eq("siteId", inbox.siteId)
                        .eq("ownerAccountKey", undefined)
                        .eq("ownerLineageUnresolvedAt", undefined)
                    )
                    .take(20),
                  ctx.db
                    .query("outreach_suppressions")
                    .withIndex("by_site_owner_unresolved", (q) =>
                      q
                        .eq("siteId", inbox.siteId)
                        .eq("ownerAccountKey", undefined)
                        .eq("ownerLineageUnresolvedAt", undefined)
                    )
                    .take(20),
                ]);
              const unresolvedAt = now();
              for (const contact of unresolvedContacts) {
                await ctx.db.patch(contact._id, {
                  ownerLineageUnresolvedAt: unresolvedAt,
                  updatedAt: Math.max(contact.updatedAt, unresolvedAt),
                });
              }
              for (const suppression of unresolvedSuppressions) {
                await ctx.db.patch(suppression._id, {
                  ownerLineageUnresolvedAt: unresolvedAt,
                });
              }
              if (
                unresolvedContacts.length === 0 &&
                unresolvedSuppressions.length === 0
              ) {
                await ctx.db.delete(inbox._id);
              }
            }
          }
        } else if (
          name === "outreach_foreign_owner_contacts" ||
          name === "outreach_foreign_owner_suppressions" ||
          name === "outreach_durability_migrations" ||
          name === "outreach_sender_suppression_tombstones" ||
          name === "outreach_tenant_contact_receipts"
        ) {
          await ctx.db.delete(row._id);
        } else if (name === "outreach_sender_pacing_receipts") {
          // Sender-domain reputation is global and must not be refunded by
          // moving the mailbox to another account. Remove only the deleted
          // account link; the hashed short-lived pacing state remains.
          await ctx.db.patch(
            row._id as Id<"outreach_sender_pacing_receipts">,
            { accountKey: undefined, tenantDomainKey: undefined },
          );
        } else if (name === "article_generation_attempts") {
          const attempt = row as Doc<"article_generation_attempts">;
          await ctx.db.patch(attempt._id, {
            userId: tombstoneUserId,
            jobKey: sha256Hex(
              `pentra-deleted-job:v1:${receipt.accountKey}:${attempt.jobKey}`,
            ),
            attemptKey: sha256Hex(
              `pentra-deleted-attempt:v1:${receipt.accountKey}:${attempt.attemptKey}`,
            ),
            articleKey: undefined,
            updatedAt: now(),
          });
        } else if (name === "provider_spend_reservations") {
          await ctx.db.patch(
            row._id as Id<"provider_spend_reservations">,
            { userId: tombstoneUserId, siteId: undefined },
          );
        } else {
          await ctx.db.patch(row._id as Id<"usage_log">, {
            userId: tombstoneUserId,
            siteId: undefined,
            jobId: undefined,
            articleId: undefined,
          });
        }
      }
      const nextStage = rows.length > 0 ? stage : stage + 1;
      await ctx.db.patch(receiptId, {
        status: "scrubbing_receipts",
        receiptStage: nextStage,
        updatedAt: now(),
      });
      await ctx.scheduler.runAfter(
        externalLeaseWait ? ACCOUNT_DELETION_RETRY_MS : 0,
        internal.sites.finalizeAccountDeletionInternal,
        { receiptId },
      );
      return {
        completed: false,
        reason: "receipt_scrub_pending",
        stage: name,
        scrubbed: rows.length,
      };
    }

    const entitlement = await ctx.db
      .query("account_plan_entitlements")
      .withIndex("by_user", (q) => q.eq("userId", receipt.userId!))
      .unique();
    if (entitlement) await ctx.db.delete(entitlement._id);
    const completedAt = now();
    await ctx.db.patch(receiptId, {
      userId: undefined,
      sourceEventKey: undefined,
      status: "completed",
      receiptStage: undefined,
      completedAt,
      updatedAt: completedAt,
    });
    return { completed: true, reason: "purge_completed" };
  },
});

export const recoverAccountDeletionsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = now();
    let resumed = 0;
    for (const status of [
      "revoking",
      "purging",
      "scrubbing_receipts",
    ]) {
      const receipts = await ctx.db
        .query("account_deletion_receipts")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", status).lt("updatedAt", timestamp - 2 * 60 * 1000)
        )
        .take(10);
      for (const receipt of receipts) {
        await ctx.db.patch(receipt._id, { updatedAt: timestamp });
        await ctx.scheduler.runAfter(
          0,
          status === "revoking"
            ? internal.sites.continueAccountDeletionInternal
            : internal.sites.finalizeAccountDeletionInternal,
          { receiptId: receipt._id },
        );
        resumed += 1;
      }
    }
    return { resumed };
  },
});

// Delete a single tenant with immediate credential revocation followed by a
// bounded, resumable purge of every tenant-scoped record.
export const deleteSite = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwnerIncludingDeleting(ctx, siteId);
    return requestSiteDeletion(ctx, siteId, site.userId!);
  },
});

// List ALL sites for trusted cron/actions only.
export const listAllForAutopilot = internalQuery({
  handler: async (ctx) => {
    return ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .take(50);
  },
});

export const listAutopilotPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) =>
    ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .paginate({ cursor: cursor ?? null, numItems: 25 }),
});

// Growth measurement is intentionally independent of publishing state. A
// tenant can pause article generation while Pentra continues to measure and
// diagnose already-published URLs.
export const listGrowthPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("sites")
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    return {
      ...result,
      page: result.page.filter(
        (site) => !site.deletionStatus && !site.planParkedAt,
      ).map((site) => ({
        siteId: site._id,
        gscConnected: Boolean(
          site.gscProperty && (site.gscRefreshToken || site.gscAccessToken),
        ),
      })),
    };
  },
});

function expectedClickBackfillFleetState(site: Doc<"sites">) {
  return {
    siteId: site._id,
    autopilotEnabled: site.autopilotEnabled === true,
    expectedClickSchedulingEnabled:
      site.expectedClickSchedulingEnabled === true,
    autopilotRolloutMode: site.autopilotRolloutMode ?? "observe",
    deleting: Boolean(site.deletionStatus),
  };
}

/**
 * Credential-free fleet projection. Only explicitly enabled, non-deleting
 * autopilot tenants enter pagination; warm/live authorization is rechecked by
 * the isolated site action immediately before any provider preflight.
 */
export const listExpectedClickBackfillFleetPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("expectedClickSchedulingEnabled"), true),
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
          q.neq(q.field("userId"), undefined),
          q.or(
            q.eq(q.field("autopilotRolloutMode"), "warm"),
            q.eq(q.field("autopilotRolloutMode"), "live"),
          ),
        )
      )
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    return {
      ...result,
      page: result.page.map(expectedClickBackfillFleetState),
    };
  },
});

export const getExpectedClickBackfillFleetState = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus || site.planParkedAt) return null;
    return expectedClickBackfillFleetState(site);
  },
});

const expectedClickFleetDispatchKind = v.union(
  v.literal("daily"),
  v.literal("recovery"),
);

function requireExpectedClickFleetDispatchKey(
  kind: "daily" | "recovery",
  dispatchKey: string,
): void {
  const valid = kind === "daily"
    ? /^\d{4}-\d{2}-\d{2}$/.test(dispatchKey)
    : /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(dispatchKey);
  if (!valid) throw new Error("Invalid expected-click fleet dispatch key");
}

function sameOptionalCursor(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left === right;
}

/**
 * Durable page claim. Duplicate actions may both schedule one page, but only
 * the first matching OCC advancement can move the stored cursor. Tenant queue
 * mutations remain the authoritative one-batch/day spend fence.
 */
export const beginExpectedClickFleetDispatchPage = internalMutation({
  args: {
    kind: expectedClickFleetDispatchKind,
    dispatchKey: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { kind, dispatchKey, cursor }) => {
    requireExpectedClickFleetDispatchKey(kind, dispatchKey);
    let run = await ctx.db
      .query("expected_click_fleet_dispatch_runs")
      .withIndex("by_kind_key", (q) =>
        q.eq("kind", kind).eq("dispatchKey", dispatchKey)
      )
      .first();
    if (!run) {
      const timestamp = now();
      const runId = await ctx.db.insert(
        "expected_click_fleet_dispatch_runs",
        {
          kind,
          dispatchKey,
          status: "running",
          cursor,
          pageCount: 0,
          scheduledSites: 0,
          failedSites: 0,
          continuationScheduleFailures: 0,
          resumeSchedules: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
      run = (await ctx.db.get(runId))!;
    }
    if (
      run.status !== "running" ||
      !sameOptionalCursor(run.cursor, cursor)
    ) {
      return {
        claimed: false as const,
        runId: run._id,
        status: run.status,
        cursor: run.cursor,
      };
    }
    return {
      claimed: true as const,
      runId: run._id,
      status: run.status,
      cursor: run.cursor,
    };
  },
});

/** Checkpoint first, then schedule the continuation. A crash in between is
 * recovered from this exact cursor by the hourly fleet sweep. */
export const advanceExpectedClickFleetDispatchPage = internalMutation({
  args: {
    runId: v.id("expected_click_fleet_dispatch_runs"),
    kind: expectedClickFleetDispatchKind,
    dispatchKey: v.string(),
    expectedCursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    scheduled: v.number(),
    failed: v.number(),
  },
  handler: async (ctx, args) => {
    requireExpectedClickFleetDispatchKey(args.kind, args.dispatchKey);
    if (
      !Number.isInteger(args.scheduled) || args.scheduled < 0 ||
      args.scheduled > 25 || !Number.isInteger(args.failed) ||
      args.failed < 0 || args.failed > 25 ||
      args.scheduled + args.failed > 25 ||
      (!args.isDone && !args.nextCursor)
    ) {
      throw new Error("Invalid expected-click fleet page receipt");
    }
    const run = await ctx.db.get(args.runId);
    if (
      !run || run.kind !== args.kind || run.dispatchKey !== args.dispatchKey ||
      run.status !== "running" ||
      !sameOptionalCursor(run.cursor, args.expectedCursor)
    ) {
      return { advanced: false as const };
    }
    const timestamp = now();
    await ctx.db.patch(run._id, {
      status: args.isDone ? "completed" : "running",
      cursor: args.isDone ? undefined : args.nextCursor,
      pageCount: run.pageCount + 1,
      scheduledSites: run.scheduledSites + args.scheduled,
      failedSites: run.failedSites + args.failed,
      updatedAt: timestamp,
      completedAt: args.isDone ? timestamp : undefined,
    });
    return {
      advanced: true as const,
      completed: args.isDone,
      cursor: args.isDone ? undefined : args.nextCursor,
    };
  },
});

export const recordExpectedClickFleetContinuationFailure = internalMutation({
  args: {
    runId: v.id("expected_click_fleet_dispatch_runs"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { runId, cursor }) => {
    const run = await ctx.db.get(runId);
    if (
      !run || run.status !== "running" ||
      !sameOptionalCursor(run.cursor, cursor)
    ) return { recorded: false as const };
    await ctx.db.patch(run._id, {
      continuationScheduleFailures: run.continuationScheduleFailures + 1,
      updatedAt: now(),
    });
    return { recorded: true as const };
  },
});

export const listRecoverableExpectedClickFleetDispatchRuns = internalQuery({
  args: { staleBefore: v.number() },
  handler: async (ctx, { staleBefore }) => {
    const rows = await ctx.db
      .query("expected_click_fleet_dispatch_runs")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "running").lte("updatedAt", staleBefore)
      )
      .take(11);
    return {
      runs: rows.slice(0, 10).map((run) => ({
        runId: run._id,
        kind: run.kind,
        dispatchKey: run.dispatchKey,
        cursor: run.cursor,
      })),
      truncated: rows.length > 10,
    };
  },
});

export const markExpectedClickFleetDispatchResumeScheduled = internalMutation({
  args: {
    runId: v.id("expected_click_fleet_dispatch_runs"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { runId, cursor }) => {
    const run = await ctx.db.get(runId);
    if (
      !run || run.status !== "running" ||
      !sameOptionalCursor(run.cursor, cursor)
    ) return { marked: false as const };
    await ctx.db.patch(run._id, {
      resumeSchedules: run.resumeSchedules + 1,
      updatedAt: now(),
    });
    return { marked: true as const };
  },
});

export const pruneExpectedClickFleetDispatchRuns = internalMutation({
  args: { olderThan: v.number() },
  handler: async (ctx, { olderThan }) => {
    const rows = await ctx.db
      .query("expected_click_fleet_dispatch_runs")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "completed").lt("updatedAt", olderThan)
      )
      .take(50);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});

async function outreachFleetState(
  ctx: QueryCtx,
  site: Doc<"sites">,
) {
  const siteId = site._id;
  const siteOwnerAccountKey = site.userId
    ? accountDeletionKey(site.userId)
    : undefined;
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .take(2);
  const inbox = inboxes.length === 1 ? inboxes[0] : undefined;
  const durabilityMigration = site.userId
    ? await ctx.db
        .query("outreach_durability_migrations")
        .withIndex("by_account", (q) =>
          q.eq("accountKey", accountDeletionKey(site.userId!))
        )
        .first()
    : null;
  // Raw-message ownership and compliance durability also protect the manual
  // owner-approved path. Bootstrap this provider-free migration for every
  // exact-current-owner executable inbox; autonomy consent is deliberately
  // checked only by the separate delivery authorization below.
  const durabilityMigrationBootstrapEligible = Boolean(
    siteOwnerAccountKey &&
      inbox?.credentialOwnerAccountKey === siteOwnerAccountKey &&
      await siteExecutionAuthorized(ctx, site)
  );
  const autonomyAuthorizationEligible = Boolean(
    durabilityMigrationBootstrapEligible &&
      autonomousOutreachRuntimeEnabled(
      process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
      ) &&
      autonomousOutreachConsentActive(inbox, site.userId) &&
      isSeoGrowthActuationEligible(site) &&
      autonomousGmailCredentialIssues({
        oauthScopes: inbox?.oauthScopes,
        hasRefreshToken: Boolean(inbox?.oauthRefreshToken),
      }).length === 0,
  );
  const durabilityMigrationComplete = Boolean(
    durabilityMigration?.version === OUTREACH_DURABILITY_MIGRATION_VERSION &&
      durabilityMigration.status === "complete",
  );
  const activeAutonomyConsent = Boolean(
    autonomyAuthorizationEligible &&
      autonomousOutreachReconciliationComplete(inbox) &&
      durabilityMigrationComplete,
  );
  const queriedAt = Date.now();
  const [
    verifiedOpportunity,
    approvedMessage,
    dueAutomaticMessage,
    contactedOpportunity,
    acquiredOpportunity,
    sentMessage,
    reviewedSentMessage,
    repliedMessage,
  ] = await Promise.all([
    ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "verified")
      )
      .first(),
    siteOwnerAccountKey
      ? ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", siteOwnerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "approved")
          )
          .first()
      : Promise.resolve(null),
    activeAutonomyConsent && inbox && siteOwnerAccountKey
      ? Promise.all(
          Array.from({ length: MAX_SEQUENCE_STEP + 1 }, (_, sequenceStep) =>
            ctx.db
              .query("outreach_messages")
              .withIndex("by_site_owner_lineage_status_autonomy_consent_sequence_scheduled", (q) =>
                q
                  .eq("siteId", siteId)
                  .eq("ownerAccountKey", siteOwnerAccountKey)
                  .eq("ownerLineageUnresolvedAt", undefined)
                  .eq("status", "approved")
                  .eq("approvalKind", "account_autopilot")
                  .eq("approvalConsentVersion", inbox.autonomyConsentVersion)
                  .eq(
                    "approvalConsentPolicyHash",
                    inbox.autonomyConsentPolicyHash,
                  )
                  .eq(
                    "approvalConsentAcceptedAt",
                    inbox.autonomyConsentAcceptedAt,
                  )
                  .eq("sequenceStep", sequenceStep)
                  .lte("scheduledAt", queriedAt),
              )
              .first()
          ),
        ).then((messages) => messages.find(Boolean) ?? null)
      : Promise.resolve(null),
    ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "contacted")
      )
      .first(),
    ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "acquired")
      )
      .first(),
    siteOwnerAccountKey
      ? ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", siteOwnerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "sent")
          )
          .first()
      : Promise.resolve(null),
    siteOwnerAccountKey
      ? ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", siteOwnerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "delivery_reviewed_sent")
          )
          .first()
      : Promise.resolve(null),
    siteOwnerAccountKey
      ? ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", siteOwnerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "replied")
          )
          .first()
      : Promise.resolve(null),
  ]);
  const signedRelayReady = Boolean(
    inbox &&
    inbox.provider === "gmail" &&
    !["disconnected", "suspended"].includes(inbox.status) &&
    inboundRelayConfigured(inboundRelayRuntimeConfig()) &&
    inboundRelayDsnRoutingReady({
      inbox,
      now: Date.now(),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      runtimeConfig: inboundRelayRuntimeConfig(),
    }),
  );
  const legacyGmailReadReady = Boolean(
    inbox &&
    inbox.provider === "gmail" &&
    inbox.oauthScopes?.split(/\s+/).includes(
      "https://www.googleapis.com/auth/gmail.readonly",
    ) &&
    (inbox.oauthRefreshToken || inbox.oauthAccessToken) &&
    !["disconnected", "suspended"].includes(inbox.status),
  );
  const inboundMonitoringMode:
    | "signed_relay"
    | "legacy_gmail"
    | "unavailable" = signedRelayReady
      ? "signed_relay"
      : legacyGmailReadReady
        ? "legacy_gmail"
        : "unavailable";
  return {
    siteId,
    autopilotEnabled: site.autopilotEnabled === true,
    autopilotRolloutMode: site.autopilotRolloutMode ?? "observe",
    // A duplicate inbox is an invalid tenant configuration. It must not
    // collapse the whole fleet query or authorize either drafting or sending.
    inboxConfigurationValid: inboxes.length <= 1,
    hasInbox: Boolean(inbox),
    inboxProvider: inbox?.provider,
    inboxStatus: inbox?.status,
    inboxMode: inbox?.mode,
    inboxVerified: Boolean(inbox?.verifiedAt),
    autonomyConsentActive: activeAutonomyConsent,
    autonomyDurabilityMigrationPending: Boolean(
      durabilityMigrationBootstrapEligible && !durabilityMigrationComplete,
    ),
    autonomyReconciliationPending: Boolean(
      inbox?.mode === "live" &&
        inbox.autonomyReconciliationStatus !== "complete",
    ),
    hasVerifiedOpportunities: Boolean(verifiedOpportunity),
    hasApprovedMessages: Boolean(approvedMessage),
    hasDueAutomaticMessages: Boolean(dueAutomaticMessage),
    hasLinksToVerify: Boolean(contactedOpportunity || acquiredOpportunity),
    inboundMonitoringReady: signedRelayReady || legacyGmailReadReady,
    inboundMonitoringMode,
    hasMessagesToMonitor: [sentMessage, reviewedSentMessage, repliedMessage]
      .some((message) => Boolean(
        message?.providerMessageId || message?.providerThreadId,
      )),
  };
}

/**
 * Credential-free authority/outreach fleet projection. Pagination is over
 * sites, while every readiness read uses a site-prefixed index. A tenant with
 * no inbox or work simply remains ineligible; no mailbox secret leaves this
 * internal query.
 */
export const listOutreachFleetPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("sites")
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    const page: Awaited<ReturnType<typeof outreachFleetState>>[] = [];
    for (const site of result.page) {
      if (
        site.deletionStatus ||
        site.planParkedAt ||
        !(await siteExecutionAuthorized(ctx, site))
      ) continue;
      page.push(await outreachFleetState(ctx, site));
    }
    return {
      ...result,
      page,
    };
  },
});

export const getOutreachFleetState = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) return null;
    return outreachFleetState(ctx, site);
  },
});

export const countByUserBounded = internalQuery({
  args: { userId: v.string(), maximum: v.number() },
  handler: async (ctx, { userId, maximum }) => {
    const safeMaximum = Math.max(0, Math.min(100, Math.floor(maximum)));
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
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
    if (!site || site.deletionStatus || site.planParkedAt) {
      throw new Error("Site not found");
    }
    assertConfigUnlocked(site);
    if (!site.autopilotEnabled && mode !== "observe") {
      throw new Error("Autopilot must be enabled before controlled rollout");
    }
    if (mode !== "observe") {
      const setupBlockers = await oneSetupPromotionBlockers(ctx, site);
      if (setupBlockers.length > 0) {
        throw new Error(
          `One-setup canonical receipts are incomplete: ${setupBlockers.join(", ")}`,
        );
      }
    }

    if (mode === "live") {
      const hasCrawledPage = Boolean(await ctx.db
        .query("pages")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first());
      const limits = getLimitsFromFeatures(site.planFeatures ?? []);
      const readiness = liveAutopilotReadiness(
        site,
        hasCrawledPage,
        limits.maxArticles,
      );
      if (!readiness.ready) {
        throw new Error(
          `Live rollout prerequisites are incomplete: ${readiness.blockers.join(", ")}`,
        );
      }
      const ready = await ctx.db
        .query("article_summaries")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "ready"),
        )
        .take(10);
      const sealed = ready.filter(
        (article) =>
          article.publicationGateStatus === "passed" &&
          article.publicationAuditVersion === PUBLICATION_AUDIT_VERSION &&
          !!article.auditedContentHash,
      );
      if (sealed.length < 2) {
        throw new Error(
          `Live rollout requires at least two sealed articles; found ${sealed.length}`,
        );
      }
    }

    const rolloutEpoch = (site.autopilotRolloutEpoch ?? 0) + 1;
    const rolloutStartedAt = Date.now();
    const cancelledJobs = await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      `${site.autopilotRolloutMode ?? "observe"} -> ${mode}`,
    );
    await ctx.db.patch(siteId, {
      autopilotRolloutMode: mode,
      autopilotRolloutEpoch: rolloutEpoch,
      autopilotRolloutStartedAt: rolloutStartedAt,
      ...(mode === "observe"
        ? {}
        : { expectedClickSchedulingEnabled: true }),
      updatedAt: rolloutStartedAt,
    });
    return { mode, rolloutEpoch, cancelledJobs };
  },
});

// Re-check every live tenant against the same readiness contract used for
// promotion. Any regression retires the old rollout epoch and cancels its
// autonomous work before another delivery can be queued.
export const enforceLiveReadiness = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return {
        ready: false,
        changed: false,
        mode: "observe" as const,
        blockers: ["site_plan_entitlement_inactive"],
      };
    }
    if (site.autopilotRolloutMode !== "live") {
      return { ready: false, changed: false, mode: site.autopilotRolloutMode ?? "observe", blockers: [] as string[] };
    }
    const hasCrawledPage = Boolean(await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .first());
    const limits = getLimitsFromFeatures(site.planFeatures ?? []);
    const setupBlockers = await oneSetupPromotionBlockers(ctx, site);
    const liveReadiness = liveAutopilotReadiness(
      site,
      hasCrawledPage,
      limits.maxArticles,
    );
    const live = {
      ready: liveReadiness.ready && setupBlockers.length === 0,
      blockers: [...liveReadiness.blockers, ...setupBlockers],
    };
    if (live.ready) {
      return { ready: true, changed: false, mode: "live", blockers: [] as string[] };
    }
    const warm = warmAutopilotReadiness(site, hasCrawledPage);
    const mode = warm.ready && setupBlockers.length === 0
      ? "warm" as const
      : "observe" as const;
    const cancelledJobs = await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      `live readiness regressed: ${live.blockers.join(", ")}`,
    );
    const changedAt = now();
    await ctx.db.patch(siteId, {
      autopilotRolloutMode: mode,
      autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
      autopilotRolloutStartedAt: changedAt,
      updatedAt: changedAt,
    });
    const health = await ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .first();
    if (health) {
      await ctx.db.patch(health._id, {
        status: mode === "observe" ? "rollout_observe" : "recovering",
        detail: `Live readiness regressed: ${live.blockers.join(", ")}. Delivery stopped and rollout moved to ${mode}.`,
        heartbeatAt: changedAt,
        updatedAt: changedAt,
      });
    }
    return {
      ready: false,
      changed: true,
      mode,
      blockers: live.blockers,
      cancelledJobs,
    };
  },
});

// Plan features are accepted only from the authenticated Next.js billing bridge.
export const syncPlanFeaturesInternal = internalMutation({
  args: { userId: v.string(), planFeatures: v.array(v.string()) },
  handler: async (ctx, { userId, planFeatures }) =>
    applyCanonicalPlanToUserSites(ctx, userId, planFeatures),
});

export const continuePlanFeatureSyncInternal = internalMutation({
  args: {
    entitlementId: v.id("account_plan_entitlements"),
    syncVersion: v.number(),
    cursor: v.optional(v.string()),
    remainingAllowance: v.number(),
    remainingArticleAllowance: v.number(),
  },
  handler: async (
    ctx,
    {
      entitlementId,
      syncVersion,
      cursor,
      remainingAllowance,
      remainingArticleAllowance,
    },
  ) => reconcileCanonicalPlanSitePage(
    ctx,
    entitlementId,
    syncVersion,
    cursor,
    Math.max(0, Math.floor(remainingAllowance)),
    Math.max(0, Math.floor(remainingArticleAllowance)),
  ),
});

export const recoverStalePlanFeatureSyncsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = now();
    const stale = await ctx.db
      .query("account_plan_entitlements")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "reconciling").lt("updatedAt", timestamp - 2 * 60 * 1000)
      )
      .take(25);
    for (const entitlement of stale) {
      // A legacy in-flight receipt predating the account-wide cadence ledger
      // cannot be resumed from an unknown article cursor. Restart the same
      // authoritative target from page one instead of manufacturing capacity.
      if (entitlement.remainingArticleAllowance === undefined) {
        await applyCanonicalPlanToUserSites(
          ctx,
          entitlement.userId,
          entitlement.planFeatures,
          { forceReconcile: true },
        );
        continue;
      }
      await ctx.db.patch(entitlement._id, { updatedAt: timestamp });
      await ctx.scheduler.runAfter(
        0,
        internal.sites.continuePlanFeatureSyncInternal,
        {
          entitlementId: entitlement._id,
          syncVersion: entitlement.syncVersion,
          cursor: entitlement.cursor,
          remainingAllowance: entitlement.remainingAllowance,
          remainingArticleAllowance:
            entitlement.remainingArticleAllowance,
        },
      );
    }
    return { resumed: stale.length };
  },
});

// PII-free rollout receipt for the one-time Clerk entitlement backfill. The
// operator compares these aggregates with Clerk's authoritative user count;
// no user id, domain, metadata, or feature array leaves Convex.
export const auditPlanEntitlementPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    authoritativeVerifiedSince: v.number(),
  },
  handler: async (ctx, { cursor, authoritativeVerifiedSince }) => {
    const page = await ctx.db
      .query("account_plan_entitlements")
      .order("asc")
      .paginate({ cursor: cursor ?? null, numItems: 100 });
    let verifiedCompleted = 0;
    let verifiedReconciling = 0;
    for (const entitlement of page.page) {
      if (
        (entitlement.authoritativeVerifiedAt ?? 0) <
          authoritativeVerifiedSince
      ) continue;
      if (entitlement.status === "completed") verifiedCompleted += 1;
      else verifiedReconciling += 1;
    }
    return {
      scanned: page.page.length,
      verifiedCompleted,
      verifiedReconciling,
      isDone: page.isDone,
      cursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

// One bounded, resumable migration replaces legacy per-site cadence clamps
// with the canonical account-wide allocator. Account receipts, not site-local
// feature mirrors, are the authoritative source for every repair.
export const reconcileUnsustainableCadences = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("account_plan_entitlements").paginate({
      cursor: cursor ?? null,
      numItems: 25,
    });
    let adjusted = 0;
    for (const entitlement of page.page) {
      if (entitlement.status !== "completed") continue;
      await applyCanonicalPlanToUserSites(
        ctx,
        entitlement.userId,
        entitlement.planFeatures,
        { forceReconcile: true },
      );
      adjusted += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.sites.reconcileUnsustainableCadences,
        { cursor: page.continueCursor },
      );
    }
    return {
      adjusted,
      scanned: page.page.length,
      done: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

// One-time bounded migration gives every legacy site the same canonical host
// key used by new writes. Any duplicate is retained for owner/support review
// but both records fail closed until ownership is resolved.
export const backfillCanonicalDomains = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("sites").order("asc").paginate({
      cursor: cursor ?? null,
      numItems: 25,
    });
    const timestamp = now();
    let canonicalized = 0;
    let conflicts = 0;
    for (const site of page.page) {
      const canonicalDomain = normalizedAuthorityDomain(site.domain);
      if (!canonicalDomain) {
        await ctx.db.patch(site._id, {
          domainOwnershipConflictAt:
            site.domainOwnershipConflictAt ?? timestamp,
          updatedAt: timestamp,
        });
        conflicts += 1;
        continue;
      }
      const existing = await ctx.db
        .query("sites")
        .withIndex("by_canonical_domain", (q) =>
          q.eq("canonicalDomain", canonicalDomain)
        )
        .take(2);
      const conflicting = existing.filter((row) => row._id !== site._id);
      if (conflicting.length > 0) {
        await ctx.db.patch(site._id, {
          canonicalDomain,
          domainOwnershipConflictAt:
            site.domainOwnershipConflictAt ?? timestamp,
          updatedAt: timestamp,
        });
        for (const row of conflicting) {
          await ctx.db.patch(row._id, {
            domainOwnershipConflictAt:
              row.domainOwnershipConflictAt ?? timestamp,
            updatedAt: timestamp,
          });
        }
        conflicts += 1;
      } else {
        await ctx.db.patch(site._id, {
          domain: canonicalDomain,
          canonicalDomain,
          domainOwnershipConflictAt: undefined,
          updatedAt: timestamp,
        });
        canonicalized += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.sites.backfillCanonicalDomains,
        { cursor: page.continueCursor },
      );
    }
    return {
      scanned: page.page.length,
      canonicalized,
      conflicts,
      done: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
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
    const site = await ctx.db.get(siteId);
    if (!site?.userId || site.deletionStatus) throw new Error("Site not found");
    return applyCanonicalPlanToUserSites(ctx, site.userId, planFeatures);
  },
});

// Operator-controlled compatibility rollout. A tenant remains on the proven
// scheduler until its fresh expected-click inventory has been inspected; this
// prevents one additive deployment from draining every legacy cadence.
export const setExpectedClickScheduling = internalMutation({
  args: {
    siteId: v.id("sites"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { siteId, enabled }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) throw new Error("Site not found");
    const changed = site.expectedClickSchedulingEnabled !== enabled;
    let cancelledJobs = 0;
    if (changed) {
      cancelledJobs = await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "Expected-click scheduling contract changed",
        false,
        true,
      );
    }
    await ctx.db.patch(siteId, {
      expectedClickSchedulingEnabled: enabled,
      updatedAt: now(),
    });
    return { enabled, cancelledJobs };
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

    // Preflight every tenant before scheduling any deletion. A later
    // article-level lease must not turn an account reset into a partial wipe.
    for (const site of sites) {
      if (site.publicationLeaseOwner) {
        throw new Error("Cannot reset data while a publication lease exists");
      }
      const leasedArticles = await ctx.db
        .query("articles")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect();
      if (leasedArticles.some((article) => article.publicationLeaseOwner)) {
        throw new Error(
          "Cannot reset data while an article publication lease exists",
        );
      }
      const outreachDeletion = await gateSiteDeletionForOutreach(ctx, site._id);
      if (!outreachDeletion.ready) {
        return {
          scheduled: 0,
          deferred: true,
          reason: outreachDeletion.reason,
          siteId: site._id,
          convertedExpired: outreachDeletion.convertedExpired,
        };
      }
    }
    for (const site of sites) {
      await ctx.scheduler.runAfter(0, internal.sites.requestSiteDeletionInternal, {
        siteId: site._id,
        ownerUserId: identity.subject,
      });
    }
    return { scheduled: sites.length };
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
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
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
            publicationAdapterVerifiedAt: undefined,
            publicationAdapterVersion: undefined,
            publicationAdapterConfigHash: undefined,
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
    gscScopes: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, gscAccessToken, gscRefreshToken, gscProperty, gscEmail, gscScopes }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    if (!gscProperty && !site.gscProperty) {
      throw new Error("A matching Search Console property is required for the initial connection");
    }
    await ctx.db.patch(site._id, {
      gscAccessToken,
      ...(gscRefreshToken ? { gscRefreshToken } : {}),
      ...(gscProperty ? { gscProperty } : {}),
      ...(gscEmail ? { gscEmail } : {}),
      ...(gscScopes ? { gscScopes } : {}),
      ...(!site.gscConnectedAt ? { gscConnectedAt: now() } : {}),
      updatedAt: now(),
    });
  },
});

// Disconnect Google Search Console
export const disconnectGsc = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    assertConfigUnlocked(site);
    const cancelledJobs = await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      "Google Search Console disconnected",
    );
    await ctx.db.patch(siteId, {
      gscAccessToken: undefined,
      gscRefreshToken: undefined,
      gscProperty: undefined,
      gscEmail: undefined,
      gscScopes: undefined,
      gscConnectedAt: undefined,
      gscSyncEpoch: undefined,
      gscPendingSyncEpoch: undefined,
      gscPendingSyncMode: undefined,
      gscPendingWindowStart: undefined,
      gscPendingDataThrough: undefined,
      gscPendingStartedAt: undefined,
      gscDateEpochs: undefined,
      gscDataWindowStart: undefined,
      gscDataThrough: undefined,
      gscHistoryDays: undefined,
      gscCompleteWindows: undefined,
      gscDataSyncedAt: undefined,
      gscQueryRows: undefined,
      gscPageRows: undefined,
      gscAnalyticsRequests: undefined,
      autopilotRolloutMode: "observe",
      autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
      updatedAt: now(),
    });
    return { disconnected: true, cancelledJobs };
  },
});
