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
  cadenceFitsOperationalLimit,
  defaultTargetCadenceForMonthlyLimit,
  getLimitsFromFeatures,
  requiredMonthlyArticlesForCadence,
} from "./planLimits";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { sanitizeSiteForClient } from "./lib/siteSecurity";
import { inboundMonitoringCapability } from "./lib/outreachSecurity.ts";
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
  autonomousOutreachTransportIssues,
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
  inboundRelayConfigurationHash,
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
  releaseDurableContactClaimForAccount,
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
  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
  oneSetupDomainRevisionReceiptMatches,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
  oneSetupLegacyInitialPlanJobBindingMatches,
  oneSetupInitialPlanReceiptDecision,
} from "./lib/oneSetupInitialPlan.ts";
import { oneSetupExecutionNextEligibleAt } from
  "./lib/oneSetupExecution.ts";
import {
  canonicalGscReceiptMutationFenceCurrent,
  oneSetupManagedOutreachMailboxReceiptVerified,
  oneSetupOutreachMailboxReceiptVerified,
  oneSetupPublisherReceiptVerified,
  oneSetupSearchMeasurementReceiptVerified,
} from "./lib/oneSetupCanonical.ts";
import { oneSetupPromotionBlockers } from "./lib/oneSetupRuntime.ts";
import {
  takeCurrentDomainArticleSummariesByStatus,
  takeCurrentDomainTopics,
  contentAnalysisMatchesCurrentDomain,
  gscConnectionMatchesCurrentDomain,
  gscPropertyMatchesCanonicalDomain,
  nextCanonicalDomainRevision,
  nextGscConnectionRevision,
  normalizeCanonicalDomain,
  pageMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding.ts";
import {
  MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION,
  MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION,
  managedOutreachMailboxProfileIssues,
  managedOutreachMailboxReleaseSealed,
  nextManagedOutreachMailboxGeneration,
  type ManagedOutreachMailboxProfile,
} from "./lib/managedOutreachMailbox.ts";
import {
  stageManagedOutreachMailboxRelease,
  stageManagedOutreachMailboxReleaseForInbox,
} from "./managedOutreachMailbox.ts";
import {
  materializeManagedSesCanaryTombstoneForDeletion,
  materializeManagedSesSendTombstoneForDeletion,
} from "./outreach.ts";
import {
  MANAGED_SES_TRANSPORT,
  managedSesInboxReceiptCurrent,
} from "./lib/managedSes.ts";
import { planCheckpointTopicExecutionLocked } from
  "./lib/planCandidateCheckpoint.ts";
import {
  expectedPublisherDestinationReceipt,
  publisherAutopublishConsentCurrent,
  publisherAutopublishConsentReceipt,
  publisherStandingAutopublishConsentCurrent,
  PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH,
  PUBLISHER_AUTOPUBLISH_CONSENT_TEXT,
  PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
  PUBLISHER_DESTINATION_RECEIPT_VERSION,
} from "./lib/publisherProvisioning.ts";

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
const CADENCE_ALLOCATION_VERSION = 2;
const ONE_SETUP_MODE_VALIDATOR = v.union(
  v.literal("connect_existing"),
  v.literal("managed"),
);
const ONE_SETUP_AUTOMATION_MODE_VALIDATOR = v.union(
  v.literal("assisted"),
  v.literal("full"),
);
const ONE_SETUP_PUBLISHER_KIND_VALIDATOR = v.union(
  v.literal("github"),
  v.literal("wordpress"),
  v.literal("webhook"),
);
const ONE_SETUP_OUTREACH_TRANSPORT_VALIDATOR = v.union(
  v.literal("smartlead_managed"),
  v.literal("gmail_oauth"),
  v.literal("smtp"),
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
  // These fields participate in the final tenant-topic/approval gate. Once a
  // provider mutation is fenced, owner edits wait for an exact receipt so an
  // action snapshot cannot race a later authorization revocation.
  "approvalRequired", "niche", "blogTheme", "siteSummary", "siteType",
  "targetAudienceSummary", "productUsage", "anchorKeywords", "keyFeatures",
  "painPoints",
]);
const PUBLISHER_CONNECTION_KEYS = new Set([
  "domain",
  "publishMethod",
  "repoOwner",
  "repoName",
  "repoDefaultBranch",
  "githubToken",
  "wpUrl",
  "wpUsername",
  "wpAppPassword",
  "webhookUrl",
  "webhookSecret",
  "urlStructure",
]);

function normalizedAuthorityDomain(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

type CanonicalDomainRevisionSite = Doc<"sites"> & {
  canonicalDomainRevision?: number;
  gscCanonicalDomain?: string;
  gscDomainRevision?: number;
};

function canonicalDomainTransitionPatch(site: Doc<"sites">) {
  const timestamp = now();
  return {
    canonicalDomainRevision: nextCanonicalDomainRevision(site),
    contentAnalysisCanonicalDomain: undefined,
    contentAnalysisDomainRevision: undefined,
    gscAccessToken: undefined,
    gscRefreshToken: undefined,
    gscProperty: undefined,
    gscCanonicalDomain: undefined,
    gscDomainRevision: undefined,
    gscConnectionRevision: nextGscConnectionRevision(site),
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
    gscReceiptStatus: "revoked" as const,
    gscReceiptRevision: (site.gscReceiptRevision ?? 0) + 1,
    gscReceiptVerifiedAt: undefined,
    gscReceiptRevokedAt: timestamp,
    gscReceiptReasonCode: "site_domain_changed",
  };
}

async function scheduleRetiredGscEpochPruning(
  ctx: MutationCtx,
  site: Doc<"sites">,
) {
  const epochs = new Set<string>();
  for (const receipt of site.gscDateEpochs ?? []) {
    if (receipt.syncEpoch) epochs.add(receipt.syncEpoch);
  }
  if (site.gscSyncEpoch) epochs.add(site.gscSyncEpoch);
  if (site.gscPendingSyncEpoch) epochs.add(site.gscPendingSyncEpoch);
  for (const syncEpoch of epochs) {
    await Promise.all([
      ctx.scheduler.runAfter(0, internal.searchPerformance.pruneSyncEpoch, {
        siteId: site._id,
        syncEpoch,
        table: "query" as const,
      }),
      ctx.scheduler.runAfter(0, internal.searchPerformance.pruneSyncEpoch, {
        siteId: site._id,
        syncEpoch,
        table: "page" as const,
      }),
    ]);
  }
}

async function invalidateAuxiliaryCadenceJobs(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  reason: string,
) {
  const demandStatuses = ["pending", "running", "partial"];
  const evidenceStatuses = ["pending", "running", "partial"];
  const microStatuses = [
    "pending",
    "running",
    "awaiting_evidence",
    "evidence_running",
    "cadence_scheduling",
  ];
  const [demandGroups, evidenceGroups, microGroups, autopilotRunGroups] =
    await Promise.all([
    Promise.all(demandStatuses.map((status) =>
      ctx.db
        .query("expected_click_demand_jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        )
        .take(101)
    )),
    Promise.all(evidenceStatuses.map((status) =>
      ctx.db
        .query("expected_click_evidence_jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        )
        .take(101)
    )),
    Promise.all(microStatuses.map((status) =>
      ctx.db
        .query("cadence_micro_seed_jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        )
        .take(101)
    )),
    Promise.all(["scheduled", "running"].map((status) =>
      ctx.db
        .query("autopilot_runs")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .filter((q) => q.eq(q.field("status"), status))
        .take(101)
    )),
  ]);
  if (
    [...demandGroups, ...evidenceGroups, ...microGroups, ...autopilotRunGroups]
      .some((rows) => rows.length > 100)
  ) {
    throw new Error("Too many auxiliary cadence jobs to invalidate safely");
  }
  const timestamp = now();
  for (const job of [...demandGroups.flat(), ...evidenceGroups.flat()]) {
    await ctx.db.patch(job._id, {
      status: "domain_epoch_invalidated",
      errorCode: reason,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const job of microGroups.flat()) {
    await ctx.db.patch(job._id, {
      status: "domain_epoch_invalidated",
      errorCode: reason,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const run of autopilotRunGroups.flat()) {
    await ctx.db.patch(run._id, {
      status: "failed",
      outcome: "domain_epoch_invalidated",
      detail: reason,
      completedAt: timestamp,
      heartbeatAt: timestamp,
    });
  }
}

async function invalidateDomainCadenceState(
  ctx: MutationCtx,
  siteId: Id<"sites">,
) {
  await invalidateAuxiliaryCadenceJobs(
    ctx,
    siteId,
    "canonical_domain_changed",
  );
  const timestamp = now();
  const [
    health,
    growthHealth,
    activeAlerts,
    outcomeCredentials,
    openGrowthActions,
    monitoringGrowthActions,
  ] = await Promise.all([
    ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique(),
    ctx.db
      .query("seo_growth_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique(),
    ctx.db
      .query("autopilot_alerts")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "active")
      )
      .take(100),
    ctx.db
      .query("outcome_ingest_credentials")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(10),
    ctx.db
      .query("seo_growth_actions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "open")
      )
      .take(101),
    ctx.db
      .query("seo_growth_actions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "monitoring")
      )
      .take(101),
  ]);
  if (openGrowthActions.length > 100 || monitoringGrowthActions.length > 100) {
    throw new Error("Too many growth receipts to change the canonical domain safely");
  }
  if (health) {
    await ctx.db.patch(health._id, {
      lastPublishedAt: undefined,
      nextPublicationDueAt: undefined,
      approvedBufferCount: 0,
      portfolioStatus: undefined,
      portfolioDecision: undefined,
      portfolioSupportsGoal: undefined,
      portfolioExpectedClicksMonthly: undefined,
      portfolioGoalMonthly: undefined,
      portfolioClickDeficit: undefined,
      portfolioEvidenceMissing: undefined,
      portfolioEvaluatedAt: undefined,
      portfolioVersion: undefined,
      status: "recovering",
      detail: "Canonical domain changed; prior-domain cadence health was invalidated.",
      heartbeatAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (growthHealth) {
    await ctx.db.delete(growthHealth._id);
  }
  for (const alert of activeAlerts) {
    await ctx.db.patch(alert._id, {
      status: "resolved",
      resolvedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const credential of outcomeCredentials) {
    await ctx.db.patch(credential._id, {
      tokenHash: undefined,
      status: "revoked",
      revokedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const action of [...openGrowthActions, ...monitoringGrowthActions]) {
    await ctx.db.patch(action._id, {
      status: "dismissed",
      automationStatus: "domain_epoch_invalidated",
      automationDetail:
        "The canonical domain changed; this prior-domain growth action was retired.",
      updatedAt: timestamp,
    });
  }
}

async function invalidateGscGrowthState(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  reason: string,
) {
  await invalidateAuxiliaryCadenceJobs(
    ctx,
    siteId,
    "gsc_connection_changed",
  );
  const [health, open, monitoring] = await Promise.all([
    ctx.db
      .query("seo_growth_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique(),
    ctx.db
      .query("seo_growth_actions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "open")
      )
      .take(101),
    ctx.db
      .query("seo_growth_actions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "monitoring")
      )
      .take(101),
  ]);
  if (open.length > 100 || monitoring.length > 100) {
    throw new Error("Too many active growth receipts to rotate Search Console safely");
  }
  if (health) await ctx.db.delete(health._id);
  const timestamp = now();
  for (const action of [...open, ...monitoring]) {
    await ctx.db.patch(action._id, {
      status: "dismissed",
      automationStatus: "gsc_connection_invalidated",
      automationDetail: reason,
      updatedAt: timestamp,
    });
  }
}

async function currentDomainPage(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
): Promise<Doc<"pages"> | null> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return null;
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    return legacyEpoch.find((page) => pageMatchesCurrentDomain(site, page)) ??
      null;
  }
  const stamped = await ctx.db
    .query("pages")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
    )
    .first();
  return stamped;
}

async function currentDomainTopic(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
): Promise<Doc<"topic_clusters"> | null> {
  const currentTopics = await takeCurrentDomainTopics(ctx, site, 50);
  return currentTopics.find((topic) =>
    !planCheckpointTopicExecutionLocked(topic) &&
    topic.status !== "disqualified"
  ) ?? null;
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

function assertCadenceTargetSupported(cadencePerWeek: number) {
  if (!cadenceFitsOperationalLimit(cadencePerWeek)) {
    throw new Error(
      "Choose a target cadence from 1 to 21 articles per week. The monthly plan allowance is enforced separately at generation time.",
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
    // Cadence target selection depends only on an authoritative completed
    // entitlement. Legacy allocation metadata is ignored and migrates during
    // the next canonical plan reconciliation.
    const ready = entitlement.status === "completed";
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

function deliveryConfigChanged(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return Object.entries(patch).some(
    ([key, value]) => DELIVERY_CONFIG_KEYS.has(key) && site[key] !== value,
  );
}

function publisherConnectionChanged(
  site: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return Object.entries(patch).some(
    ([key, value]) =>
      PUBLISHER_CONNECTION_KEYS.has(key) && site[key] !== value,
  );
}

function publisherConnectionInvalidationPatch(
  site: Doc<"sites">,
  changed: boolean,
) {
  return changed
    ? {
        publisherConnectionGeneration:
          (site.publisherConnectionGeneration ?? 0) + 1,
        publisherDestinationReceipt: undefined,
      }
    : {};
}

async function scheduleManagedPublisherResume(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  supersedeLease = false,
) {
  const request = await ctx.db
    .query("managed_provisioning_requests")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .unique();
  if (!request || request.fulfillmentState === "cancelled") return;
  const timestamp = now();
  const liveLease = request.fulfillmentState === "leased" &&
    (request.leaseExpiresAt ?? 0) > timestamp;
  let expectedRevision = request.revision;
  if (supersedeLease) {
    const publisher: ManagedProvisioningCapability = {
      ...request.publisher,
      state: "requested",
      blockedReasonCode: undefined,
      actionRequiredBy: undefined,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    expectedRevision += 1;
    await ctx.db.patch(request._id, {
      publisher,
      aggregateState: aggregateOneSetupRequestState([
        publisher,
        request.searchMeasurement,
        request.outreachMailbox,
      ]),
      fulfillmentState: "queued",
      nextAttemptAt: timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      revision: expectedRevision,
      updatedAt: timestamp,
      completedAt: undefined,
    });
  } else if (!liveLease) {
    await ctx.db.patch(request._id, {
      fulfillmentState: "queued",
      nextAttemptAt: timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: timestamp,
      completedAt: undefined,
    });
  } else {
    // The active preflight will invoke canonical reconciliation itself. Its
    // lease watchdog remains armed if the action dies after receipt storage.
    return;
  }
  await ctx.scheduler.runAfter(0, internal.managedProvisioning.dispatchRequest, {
    requestId: request._id,
    expectedRevision,
  });
}

function unattendedPublishingEnabled(args: {
  autopilotEnabled?: boolean;
  approvalRequired?: boolean;
}): boolean {
  return args.autopilotEnabled === true && args.approvalRequired !== true;
}

/** Every public site-settings surface shares this transition fence. Existing
 * legacy rows remain editable, but creating a new unattended state requires
 * the exact current One Setup contract and its standing consent receipt. */
async function assertUnattendedPublishingTransitionAuthorized(
  ctx: MutationCtx,
  site: Doc<"sites"> | null,
  next: { autopilotEnabled?: boolean; approvalRequired?: boolean },
) {
  if (
    !unattendedPublishingEnabled(next) ||
    unattendedPublishingEnabled(site ?? {})
  ) return;
  if (!site?.userId) {
    throw new Error(
      "Choose Full Autopilot in One Setup and authorize automatic publishing before turning off review",
    );
  }
  const request = await ctx.db
    .query("managed_provisioning_requests")
    .withIndex("by_site", (q) => q.eq("siteId", site._id))
    .unique();
  const requestCurrent = Boolean(
    request &&
      request.ownerAccountKey === accountDeletionKey(site.userId) &&
      request.domainSnapshot === siteCanonicalDomain(site) &&
      request.contractVersion === ONE_SETUP_CONTRACT_VERSION &&
      oneSetupDomainRevisionReceiptMatches({
        currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
        receiptDomainRevision: request.domainRevisionSnapshot,
        legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
      }),
  );
  if (
    !request ||
    !requestCurrent ||
    request.automationMode !== "full" ||
    !publisherStandingAutopublishConsentCurrent({ request })
  ) {
    throw new Error(
      "Choose Full Autopilot in One Setup and authorize automatic publishing before turning off review",
    );
  }
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
  const [inFlight, unresolved] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "sending")
      )
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified")
      )
      .first(),
  ]);
  if (inFlight || unresolved) {
    throw new Error(
      "The site domain cannot change while outreach delivery is in progress or awaiting manual review",
    );
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

async function assertConfigUnlocked(
  ctx: MutationCtx,
  site: Doc<"sites">,
) {
  // A lease timestamp is a worker-recovery bound, not proof that an external
  // write cannot still settle. Configuration and domain epochs therefore stay
  // frozen until every delivery has either a durable receipt or a
  // deterministic pre-provider failure.
  if (site.publicationLeaseOwner) {
    throw new Error("Publishing settings are locked while a publication is in progress");
  }
  for (const status of ["leased", "attempted"] as const) {
    const unresolved = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .first();
    if (unresolved) {
      throw new Error(
        "Publishing settings are locked while a revision delivery is unresolved",
      );
    }
  }
  const ambiguous = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", site._id).eq("status", "unverified")
    )
    .filter((q) => q.eq(q.field("receipt"), undefined))
    .first();
  if (ambiguous) {
    throw new Error(
      "Publishing settings are locked until the ambiguous revision is reconciled",
    );
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

async function schedulePublicationReceiptRecovery(
  ctx: MutationCtx,
  site: Doc<"sites">,
) {
  const leaseOwner = site.publicationLeaseOwner;
  if (!leaseOwner) return;
  const [articles, revisions] = await Promise.all([
    ctx.db
      .query("articles")
      .withIndex("by_site_publication_lease", (q) =>
        q.eq("siteId", site._id).eq("publicationLeaseOwner", leaseOwner)
      )
      .take(2),
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_lease_owner", (q) =>
        q.eq("siteId", site._id).eq("leaseOwner", leaseOwner)
      )
      .take(2),
  ]);
  if (articles.length + revisions.length !== 1) {
    // Preserve the lock for operator review; guessing an artifact here could
    // release or replay the wrong external write.
    return;
  }
  const delay = Math.max(
    0,
    (site.publicationLeaseExpiresAt ?? now()) - now() + 1_000,
  );
  if (articles[0]) {
    await ctx.scheduler.runAfter(delay, internal.publisher.publishArticleInternal, {
      siteId: site._id,
      articleId: articles[0]._id,
    });
  } else if (revisions[0]) {
    await ctx.scheduler.runAfter(
      delay,
      internal.publisher.executePublishedRevisionInternal,
      { revisionId: revisions[0]._id },
    );
  }
}

async function reconcileCanonicalPlanSitePage(
  ctx: MutationCtx,
  entitlementId: Id<"account_plan_entitlements">,
  syncVersion: number,
  cursor: string | undefined,
  remainingAllowance: number,
  remainingArticleAllowance: number,
) {
  // Kept in the cursor contract for in-flight v1 reconciliations. Target
  // cadence v2 no longer consumes this legacy reservation value.
  void remainingArticleAllowance;
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
  const nextRemainingArticleAllowance = entitlement.maxArticles;
  for (const site of page.page) {
    await schedulePublicationReceiptRecovery(ctx, site);
    const requestedCadenceCandidate = site.cadenceRequestedPerWeek ??
      site.cadencePerWeek ??
      defaultTargetCadenceForMonthlyLimit(entitlement.maxArticles);
    const requestedCadence = cadenceFitsOperationalLimit(
        requestedCadenceCandidate,
      )
      ? requestedCadenceCandidate
      : defaultTargetCadenceForMonthlyLimit(entitlement.maxArticles);
    const shouldPark = !site.deletionStatus &&
      !entitledSiteIds.has(String(site._id));
    const cadencePerWeek = shouldPark || Boolean(site.deletionStatus)
      ? site.cadencePerWeek ?? requestedCadence
      : requestedCadence;
    const parkingChanged = shouldPark !== Boolean(site.planParkedAt);
    const cadenceChanged = cadencePerWeek !== (site.cadencePerWeek ?? 0);
    // Plan reconciliation must complete even when an older external write has
    // an unresolved receipt. The durable publication lock remains intact and
    // recovery is receipt-only; this transition changes allocation/rollout,
    // never the sealed external destination.
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
          ? "target publishing cadence changed"
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
      // Legacy allocation fields remain for schema compatibility. Target
      // cadence no longer reserves quota; immutable usage claims enforce the
      // purchased monthly allowance at generation time.
      allocatedMonthlyArticles: 0,
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
    allocatedMonthlyArticles: 0,
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
    const timestamp = now();
    const date = new Date(timestamp);
    const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const usageRows = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", identity.subject)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart)
      )
      .take(snapshot.maxArticles + 1);
    const articlesUsedThisMonth = usageRows.filter(
      (row) =>
        row.state !== "reserved" || (row.expiresAt ?? Infinity) > timestamp,
    ).length;
    const remainingMonthlyArticles = Math.max(
      0,
      snapshot.maxArticles - articlesUsedThisMonth,
    );
    return {
      ready: snapshot.ready,
      maxArticles: snapshot.maxArticles,
      // Compatibility fields now expose consumption rather than a fictional
      // cadence reservation. New clients should use the explicit names.
      allocatedOtherArticles: 0,
      availableMonthlyArticles: remainingMonthlyArticles,
      currentMonthlyArticles: articlesUsedThisMonth,
      articlesUsedThisMonth,
      remainingMonthlyArticles,
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

function managedOutreachProfileFromOwnerInput(args: {
  mode: OneSetupMode;
  requiresSenderDomain: boolean;
  tenantDomain: string;
  fromName?: string;
  physicalMailingAddress?: string;
  senderDomainChoice?: string;
  attestationVersion?: number;
  canaryConsentVersion?: number;
  confirmsSenderIdentityAndAddress?: boolean;
  confirmsDedicatedManagedSenderIdentity?: boolean;
  authorizesManagedDeliveryEventCanary?: boolean;
  confirmsAutonomousSendingRequiresSeparateConsent?: boolean;
  previousProfile?: ManagedOutreachMailboxProfile;
  timestamp: number;
}): ManagedOutreachMailboxProfile | undefined {
  if (args.mode !== "managed") return undefined;
  const fromName = String(args.fromName ?? "")
    .replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
  const physicalMailingAddress = String(args.physicalMailingAddress ?? "")
    .replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
  const senderDomainChoice = normalizeCanonicalDomain(
    String(args.senderDomainChoice ?? ""),
  );
  if (
    args.requiresSenderDomain &&
    (!senderDomainChoice || senderDomainChoice === args.tenantDomain)
  ) {
    throw new Error(
      "Choose a valid secondary sending domain that is separate from the website domain",
    );
  }
  if (
    args.attestationVersion !==
      MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION ||
    args.canaryConsentVersion !==
      MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION ||
    !args.confirmsSenderIdentityAndAddress ||
    !args.confirmsDedicatedManagedSenderIdentity ||
    !args.authorizesManagedDeliveryEventCanary ||
    !args.confirmsAutonomousSendingRequiresSeparateConsent
  ) {
    throw new Error(
      "Confirm the managed sender identity, dedicated sender address, signed delivery-event canary, and separate automatic-sending consent boundary",
    );
  }
  const profileUnchanged = Boolean(
    args.previousProfile?.fromName === fromName &&
      args.previousProfile.physicalMailingAddress === physicalMailingAddress &&
      args.previousProfile.senderDomainChoice === senderDomainChoice &&
      args.previousProfile.attestationVersion === args.attestationVersion &&
      args.previousProfile.canaryConsentVersion === args.canaryConsentVersion &&
      managedOutreachMailboxProfileIssues(args.previousProfile).length === 0,
  );
  const profile: ManagedOutreachMailboxProfile = profileUnchanged
    ? args.previousProfile!
    : {
        fromName,
        physicalMailingAddress,
        senderDomainChoice: senderDomainChoice || undefined,
        attestationVersion: args.attestationVersion,
        senderIdentityAndAddressAttestedAt: args.timestamp,
        dedicatedSenderIdentityAttestedAt: args.timestamp,
        deliveryEventCanaryAuthorizedAt: args.timestamp,
        canaryConsentVersion: args.canaryConsentVersion,
      };
  const issues = managedOutreachMailboxProfileIssues(profile);
  if (issues.length > 0) {
    throw new Error(`Managed outreach profile is invalid: ${issues.join(", ")}`);
  }
  return profile;
}

/**
 * Save owner intent only. This request cannot carry provider credentials and
 * cannot make publishing, Search Console, or an outreach mailbox ready.
 */
export const saveOneSetupRequest = mutation({
  args: {
    siteId: v.id("sites"),
    publisherKind: ONE_SETUP_PUBLISHER_KIND_VALIDATOR,
    outreachTransport: ONE_SETUP_OUTREACH_TRANSPORT_VALIDATOR,
    publisherMode: ONE_SETUP_MODE_VALIDATOR,
    searchMeasurementMode: ONE_SETUP_MODE_VALIDATOR,
    outreachMailboxMode: ONE_SETUP_MODE_VALIDATOR,
    automationMode: ONE_SETUP_AUTOMATION_MODE_VALIDATOR,
    publisherAutopublishConsentAccepted: v.optional(v.boolean()),
    requestedCadencePerWeek: v.number(),
    managedOutreachFromName: v.optional(v.string()),
    managedOutreachPhysicalMailingAddress: v.optional(v.string()),
    managedOutreachSenderDomain: v.optional(v.string()),
    managedOutreachAttestationVersion: v.optional(v.number()),
    managedOutreachCanaryConsentVersion: v.optional(v.number()),
    confirmsSenderIdentityAndAddress: v.optional(v.boolean()),
    confirmsDedicatedManagedSenderIdentity: v.optional(v.boolean()),
    authorizesManagedDeliveryEventCanary: v.optional(v.boolean()),
    confirmsAutonomousSendingRequiresSeparateConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const site = await requireSiteOwner(ctx, args.siteId);
    if (!site.userId || site.accountDeletionRequestedAt !== undefined) {
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
    if (site.autopilotEnabled !== true) {
      throw new Error("Save the site automation mode before submitting setup");
    }
    if (
      args.automationMode === "full" &&
      args.publisherAutopublishConsentAccepted !== true
    ) {
      throw new Error(
        "Authorize automatic publishing before enabling Full Autopilot",
      );
    }
    if (args.publisherMode !== "connect_existing") {
      throw new Error(
        "Choose GitHub, WordPress, or signed webhook and authorize that exact destination",
      );
    }
    const fullManagedBetaEnabled =
      process.env.PENTRA_FULL_MANAGED_BETA_ENABLED === "true";
    if (!fullManagedBetaEnabled && args.publisherKind !== "github") {
      throw new Error(
        "WordPress and signed-webhook publishing remain beta and are not included in bootstrap v1 GA",
      );
    }
    if (!fullManagedBetaEnabled && args.outreachTransport === "smartlead_managed") {
      throw new Error(
        "Managed Smartlead outreach remains beta; choose customer-managed SMTP/IMAP",
      );
    }
    if (args.searchMeasurementMode !== "connect_existing") {
      throw new Error(
        "Search Console OAuth must be authorized by the website owner during One Setup",
      );
    }
    const expectedMailboxMode = args.outreachTransport === "smartlead_managed"
      ? "managed"
      : "connect_existing";
    if (args.outreachMailboxMode !== expectedMailboxMode) {
      throw new Error("The outreach transport and setup ownership do not match");
    }
    if (site.publishMethod !== args.publisherKind) {
      throw new Error("Save the selected publishing destination before submitting setup");
    }

    const domainSnapshot = siteCanonicalDomain(site) ??
      normalizedAuthorityDomain(site.domain);
    if (!domainSnapshot) throw new Error("The site domain is invalid");
    const domainRevisionSnapshot = siteCanonicalDomainRevision(site);
    const legacyDomainReceiptsAllowed =
      siteUsesLegacyDomainReceipts(site);
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
          existing.contractVersion !== ONE_SETUP_CONTRACT_VERSION ||
          !oneSetupDomainRevisionReceiptMatches({
            currentCanonicalDomainRevision: domainRevisionSnapshot,
            receiptDomainRevision: existing.domainRevisionSnapshot,
            legacyUnstampedAllowed: legacyDomainReceiptsAllowed,
          })),
    );
    const outreachFromName = String(args.managedOutreachFromName ?? "")
      .replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
    const outreachPhysicalMailingAddress = String(
      args.managedOutreachPhysicalMailingAddress ?? "",
    ).replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
    if (
      outreachFromName.length < 2 ||
      outreachPhysicalMailingAddress.length < 15 ||
      outreachPhysicalMailingAddress.includes("@") ||
      args.managedOutreachAttestationVersion !==
        MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION ||
      args.managedOutreachCanaryConsentVersion !==
        MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION ||
      args.confirmsSenderIdentityAndAddress !== true ||
      args.authorizesManagedDeliveryEventCanary !== true ||
      args.confirmsAutonomousSendingRequiresSeparateConsent !== true
    ) {
      throw new Error(
        "Confirm the sender identity, mailing address, signed delivery-event canary, and separate automatic-sending consent boundary",
      );
    }
    const priorSenderProfile = reset ? undefined : existing?.outreachSenderProfile;
    const senderProfileUnchanged = Boolean(
      priorSenderProfile?.fromName === outreachFromName &&
      priorSenderProfile.physicalMailingAddress ===
        outreachPhysicalMailingAddress &&
      priorSenderProfile.attestationVersion ===
        args.managedOutreachAttestationVersion &&
      priorSenderProfile.canaryConsentVersion ===
        args.managedOutreachCanaryConsentVersion,
    );
    const outreachSenderProfile = senderProfileUnchanged
      ? priorSenderProfile
      : {
          fromName: outreachFromName,
          physicalMailingAddress: outreachPhysicalMailingAddress,
          attestationVersion: args.managedOutreachAttestationVersion!,
          senderIdentityAndAddressAttestedAt: timestamp,
          deliveryEventCanaryAuthorizedAt: timestamp,
          canaryConsentVersion: args.managedOutreachCanaryConsentVersion!,
        };
    const desiredApprovalRequired = args.automationMode === "assisted";
    if (Boolean(site.approvalRequired) !== desiredApprovalRequired) {
      await assertConfigUnlocked(ctx, site);
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        site._id,
        "one setup automation authorization changed",
      );
      await ctx.db.patch(site._id, {
        approvalRequired: desiredApprovalRequired,
        autopilotRolloutMode: "observe",
        autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
        publicationAdapterVerifiedAt: undefined,
        publicationAdapterVersion: undefined,
        publicationAdapterConfigHash: undefined,
        updatedAt: timestamp,
      });
    }
    const mailboxHardReset = Boolean(
      reset ||
        existing?.fulfillmentState === "cancelled" ||
        (existing?.outreachTransport !== undefined &&
          existing.outreachTransport !== args.outreachTransport),
    );
    if (
      existing?.outreachMailbox.mode === "managed" &&
      (args.outreachMailboxMode !== "managed" || mailboxHardReset)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        site._id,
        timestamp,
        args.outreachMailboxMode === "connect_existing"
          ? "owner_selected_connect_existing"
          : "managed_mailbox_request_reset",
      );
    }
    const managedOutreachProfile = managedOutreachProfileFromOwnerInput({
      mode: args.outreachMailboxMode,
      requiresSenderDomain: args.outreachTransport === "smartlead_managed",
      tenantDomain: domainSnapshot,
      fromName: args.managedOutreachFromName,
      physicalMailingAddress: args.managedOutreachPhysicalMailingAddress,
      senderDomainChoice: args.managedOutreachSenderDomain,
      attestationVersion: args.managedOutreachAttestationVersion,
      canaryConsentVersion: args.managedOutreachCanaryConsentVersion,
      confirmsSenderIdentityAndAddress:
        args.confirmsSenderIdentityAndAddress,
      confirmsDedicatedManagedSenderIdentity:
        args.confirmsDedicatedManagedSenderIdentity,
      authorizesManagedDeliveryEventCanary:
        args.authorizesManagedDeliveryEventCanary,
      confirmsAutonomousSendingRequiresSeparateConsent:
        args.confirmsAutonomousSendingRequiresSeparateConsent,
      previousProfile: reset ? undefined : existing?.managedOutreachProfile,
      timestamp,
    });
    const initialPlanContextFingerprint =
      oneSetupInitialPlanContextFingerprint(site);
    let migratedLegacyPlanJob: Doc<"jobs"> | null = null;
    let migratedStableDomainPlanJob: Doc<"jobs"> | null = null;
    let legacyQuarantineCode: string | undefined;
    const stableReceiptFields = existing
      ? [
          existing.initialPlanReceiptVersion,
          existing.initialPlanGeneration,
          existing.initialPlanContextFingerprint,
          existing.initialPlanJobId,
        ]
      : [];
    const stableReceiptUninitialized = Boolean(
      existing && stableReceiptFields.every((value) => value === undefined),
    );
    const stableReceiptPartiallyInitialized = Boolean(
      existing &&
        !stableReceiptUninitialized &&
        (
          existing.initialPlanReceiptVersion !==
              ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION ||
          !Number.isSafeInteger(existing.initialPlanGeneration) ||
          (existing.initialPlanGeneration ?? 0) <= 0 ||
          !existing.initialPlanContextFingerprint
        ),
    );
    if (existing && !reset && stableReceiptUninitialized) {
      const priorConfigurationRevision = existing.configurationRevision ?? 0;
      const priorExecutions = priorConfigurationRevision > 0
        ? await ctx.db
            .query("one_setup_executions")
            .withIndex("by_request_configuration", (q) =>
              q.eq("requestId", existing._id).eq(
                "configurationRevision",
                priorConfigurationRevision,
              )
            )
            .take(2)
        : [];
      if (priorExecutions.length > 1) {
        legacyQuarantineCode = "legacy_initial_plan_execution_ambiguous";
      } else if (priorExecutions.length === 1) {
        const priorExecution = priorExecutions[0];
        if (priorExecution.planJobId) {
          const priorJob = await ctx.db.get(priorExecution.planJobId);
          const priorPayload = priorJob?.payload &&
              typeof priorJob.payload === "object"
            ? priorJob.payload as Record<string, unknown>
            : {};
          const proven = priorJob &&
            oneSetupLegacyInitialPlanJobBindingMatches({
              requestId: String(existing._id),
              requestSiteId: String(existing.siteId),
              requestOwnerAccountKey: existing.ownerAccountKey,
              requestDomainSnapshot: existing.domainSnapshot,
              requestContractVersion: existing.contractVersion,
              siteId: String(site._id),
              ownerAccountKey,
              domainSnapshot,
              contractVersion: ONE_SETUP_CONTRACT_VERSION,
              executionId: String(priorExecution._id),
              executionRequestId: String(priorExecution.requestId),
              executionSiteId: String(priorExecution.siteId),
              executionOwnerAccountKey: priorExecution.ownerAccountKey,
              executionDomainSnapshot: priorExecution.domainSnapshot,
              executionConfigurationRevision:
                priorExecution.configurationRevision,
              jobId: String(priorJob?._id ?? ""),
              jobSiteId: priorJob?.siteId
                ? String(priorJob.siteId)
                : undefined,
              jobType: priorJob?.type,
              payloadManual: priorPayload.manual,
              payloadReason: priorPayload.reason,
              payloadExecutionId: priorPayload.oneSetupExecutionId,
              payloadConfigurationRevision:
                priorPayload.oneSetupConfigurationRevision,
              payloadRequestId: priorPayload.oneSetupRequestId,
              payloadReceiptVersion:
                priorPayload.oneSetupInitialPlanReceiptVersion,
              payloadGeneration:
                priorPayload.oneSetupInitialPlanGeneration,
              payloadCanonicalDomainRevision:
                priorPayload.oneSetupCanonicalDomainRevision,
              currentCanonicalDomainRevision: domainRevisionSnapshot,
              legacyUnstampedAllowed: legacyDomainReceiptsAllowed,
            });
          if (proven) {
            migratedLegacyPlanJob = priorJob;
          } else {
            legacyQuarantineCode = "legacy_initial_plan_receipt_unprovable";
          }
        }
      }
    } else if (existing && !reset && stableReceiptPartiallyInitialized) {
      legacyQuarantineCode = "initial_plan_receipt_partial";
    }
    if (
      existing &&
      !reset &&
      !stableReceiptUninitialized &&
      !stableReceiptPartiallyInitialized &&
      existing.initialPlanJobId &&
      existing.domainRevisionSnapshot === undefined &&
      legacyDomainReceiptsAllowed
    ) {
      const stableJob = await ctx.db.get(existing.initialPlanJobId);
      const stablePayload = stableJob?.payload &&
          typeof stableJob.payload === "object"
        ? stableJob.payload as Record<string, unknown>
        : {};
      const stableDomainReceiptProven = Boolean(
        stableJob &&
        stableJob.siteId === site._id &&
        stableJob.type === "plan" &&
        stablePayload.manual === true &&
        stablePayload.reason === "one_setup_initial_plan" &&
        oneSetupInitialPlanJobBindingMatches({
          requestId: String(existing._id),
          requestPlanJobId: String(existing.initialPlanJobId),
          requestReceiptVersion: existing.initialPlanReceiptVersion,
          requestGeneration: existing.initialPlanGeneration,
          jobId: String(stableJob._id),
          payloadRequestId: stablePayload.oneSetupRequestId,
          payloadReceiptVersion:
            stablePayload.oneSetupInitialPlanReceiptVersion,
          payloadGeneration:
            stablePayload.oneSetupInitialPlanGeneration,
          requestDomainRevisionSnapshot: existing.domainRevisionSnapshot,
          payloadCanonicalDomainRevision:
            stablePayload.oneSetupCanonicalDomainRevision,
          currentCanonicalDomainRevision: domainRevisionSnapshot,
          legacyUnstampedAllowed: legacyDomainReceiptsAllowed,
        })
      );
      if (stableDomainReceiptProven) {
        migratedStableDomainPlanJob = stableJob;
      } else {
        legacyQuarantineCode = "stable_initial_plan_domain_receipt_unprovable";
      }
    }
    const initialPlanReceipt = oneSetupInitialPlanReceiptDecision({
      storedVersion: existing?.initialPlanReceiptVersion,
      storedGeneration: existing?.initialPlanGeneration,
      storedContextFingerprint: existing?.initialPlanContextFingerprint,
      storedJobId: existing?.initialPlanJobId
        ? String(existing.initialPlanJobId)
        : undefined,
      currentContextFingerprint: initialPlanContextFingerprint,
      hardReset: reset,
    });
    const initialPlanJobId = migratedLegacyPlanJob?._id ??
      (initialPlanReceipt.adoptBoundJob ? existing?.initialPlanJobId : undefined);
    const initialPlanQuarantineCode = legacyQuarantineCode ??
      (initialPlanReceipt.reset ? undefined : existing?.initialPlanQuarantineCode);
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
      mailboxHardReset,
    );
    const aggregateState = aggregateOneSetupRequestState([
      publisher,
      searchMeasurement,
      outreachMailbox,
    ]);
    const revision = (existing?.revision ?? 0) + 1;
    const configurationRevision = (existing?.configurationRevision ?? 0) + 1;
    const outreachMailboxGeneration = nextManagedOutreachMailboxGeneration({
      previousGeneration: existing?.outreachMailboxGeneration,
      previousMode: existing?.outreachMailbox.mode,
      nextMode: args.outreachMailboxMode,
      hardReset: mailboxHardReset,
    });
    const record = {
      ownerAccountKey,
      domainSnapshot,
      domainRevisionSnapshot,
      contractVersion: ONE_SETUP_CONTRACT_VERSION,
      revision,
      configurationRevision,
      initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      initialPlanGeneration: initialPlanReceipt.generation,
      initialPlanContextFingerprint,
      initialPlanJobId,
      initialPlanBoundAt: migratedLegacyPlanJob
        ? timestamp
        : initialPlanReceipt.adoptBoundJob
          ? existing?.initialPlanBoundAt
          : undefined,
      initialPlanQuarantineCode,
      initialPlanQuarantinedAt: initialPlanQuarantineCode
        ? existing?.initialPlanQuarantinedAt ?? timestamp
        : undefined,
      initialPlanRecoveryCount: initialPlanReceipt.reset
        ? 0
        : existing?.initialPlanRecoveryCount ?? 0,
      automationMode: args.automationMode,
      publisherAutopublishConsent: args.automationMode === "full"
        ? publisherAutopublishConsentReceipt({
            ownerAccountKey,
            canonicalDomain: domainSnapshot,
            domainRevision: domainRevisionSnapshot,
            acceptedAt: timestamp,
          })
        : undefined,
      requestedCadencePerWeek: args.requestedCadencePerWeek,
      publisherKind: args.publisherKind,
      outreachTransport: args.outreachTransport,
      universalContractMigrationVersion: 1,
      outreachSenderProfile,
      outreachMailboxGeneration,
      managedOutreachProfile,
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
    const enrichedPlanJob = migratedLegacyPlanJob ??
      migratedStableDomainPlanJob;
    if (enrichedPlanJob) {
      const payload = enrichedPlanJob.payload &&
          typeof enrichedPlanJob.payload === "object"
        ? enrichedPlanJob.payload as Record<string, unknown>
        : {};
      await ctx.db.patch(enrichedPlanJob._id, {
        payload: {
          ...payload,
          oneSetupRequestId: requestId,
          oneSetupInitialPlanReceiptVersion:
            ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
          oneSetupInitialPlanGeneration: initialPlanReceipt.generation,
          oneSetupCanonicalDomainRevision: domainRevisionSnapshot,
        },
        updatedAt: timestamp,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId, expectedRevision: revision },
    );
    // Arm the setup execution from the save transaction itself. The browser's
    // public resume call is only an eager accelerator: losing the save
    // response or closing the tab cannot leave this configuration without an
    // exact execution, claim handoff, and mutation watchdog.
    await ctx.scheduler.runAfter(
      0,
      internal.oneSetupExecutions.bootstrapSavedExecution,
      { requestId, configurationRevision },
    );
    return { requestId, revision, configurationRevision };
  },
});

/** Explicit owner remediation for a legacy/full request whose versioned
 * standing publication authorization is absent or stale. */
export const acceptPublisherAutopublishConsent = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (!site.userId || site.accountDeletionRequestedAt !== undefined) {
      throw new Error("Site not found");
    }
    const request = await ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique();
    const ownerAccountKey = accountDeletionKey(site.userId);
    const canonicalDomain = siteCanonicalDomain(site);
    const domainRevision = siteCanonicalDomainRevision(site);
    if (
      !request ||
      request.automationMode !== "full" ||
      request.ownerAccountKey !== ownerAccountKey ||
      request.domainSnapshot !== canonicalDomain ||
      !oneSetupDomainRevisionReceiptMatches({
        currentCanonicalDomainRevision: domainRevision,
        receiptDomainRevision: request.domainRevisionSnapshot,
        legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
      }) ||
      request.contractVersion !== ONE_SETUP_CONTRACT_VERSION
    ) {
      throw new Error("No current Full Autopilot authorization is pending");
    }
    if (publisherAutopublishConsentCurrent({ request })) {
      return {
        accepted: true as const,
        revision: request.revision,
        consentVersion: PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
      };
    }
    const timestamp = now();
    const publisher: ManagedProvisioningCapability = {
      ...request.publisher,
      state: "requested",
      blockedReasonCode: undefined,
      actionRequiredBy: undefined,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    const aggregateState = aggregateOneSetupRequestState([
      publisher,
      request.searchMeasurement,
      request.outreachMailbox,
    ]);
    const operatorActionRequired = [
      publisher,
      request.searchMeasurement,
      request.outreachMailbox,
    ].some((capability) => capability.actionRequiredBy === "operator");
    const revision = request.revision + 1;
    await ctx.db.patch(request._id, {
      publisherAutopublishConsent: publisherAutopublishConsentReceipt({
        ownerAccountKey,
        canonicalDomain: canonicalDomain!,
        domainRevision,
        acceptedAt: timestamp,
      }),
      publisher,
      aggregateState,
      fulfillmentState: "queued",
      nextAttemptAt: timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: operatorActionRequired
        ? request.operatorActionRequiredAt ?? timestamp
        : undefined,
      revision,
      updatedAt: timestamp,
      completedAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.managedProvisioning.dispatchRequest, {
      requestId: request._id,
      expectedRevision: revision,
    });
    return {
      accepted: true as const,
      revision,
      consentVersion: PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
    };
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
      !oneSetupDomainRevisionReceiptMatches({
        currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
        receiptDomainRevision: request.domainRevisionSnapshot,
        legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
      }) ||
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
      providerReportedAt: timestamp,
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
        currentDomainPage(ctx, site),
        takeCurrentDomainTopics(
          ctx,
          site,
          SCHEDULER_TOPIC_INVENTORY_READ_LIMIT + 1,
        ),
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
    const domainSnapshot = siteCanonicalDomain(site);
    const ownerAccountKey = site.userId ? accountDeletionKey(site.userId) : null;
    const requestValid = Boolean(
      request &&
        ownerAccountKey &&
        request.ownerAccountKey === ownerAccountKey &&
        request.domainSnapshot === domainSnapshot &&
        request.contractVersion === ONE_SETUP_CONTRACT_VERSION &&
        oneSetupDomainRevisionReceiptMatches({
          currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
          receiptDomainRevision: request.domainRevisionSnapshot,
          legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
        }),
    );
    const managedMailboxResources = requestValid &&
        request!.outreachMailbox.mode === "managed" &&
        request!.outreachMailboxGeneration !== undefined
      ? await ctx.db
          .query("managed_outreach_mailbox_resources")
          .withIndex("by_request", (q) => q.eq("requestId", request!._id))
          .take(2)
      : [];
    const managedMailboxResource = managedMailboxResources.length === 1 &&
        managedMailboxResources[0].generation ===
          request!.outreachMailboxGeneration
      ? managedMailboxResources[0]
      : null;
    const currentExecution = requestValid &&
        (request!.configurationRevision ?? 0) > 0
      ? await ctx.db
          .query("one_setup_executions")
          .withIndex("by_request_configuration", (q) =>
            q.eq("requestId", request!._id).eq(
              "configurationRevision",
              request!.configurationRevision ?? 0,
            )
          )
          .unique()
      : null;
    const currentExecutionValid = Boolean(
      currentExecution &&
        currentExecution.siteId === site._id &&
        currentExecution.ownerAccountKey === ownerAccountKey &&
        currentExecution.domainSnapshot === domainSnapshot &&
        currentExecution.domainRevisionSnapshot ===
          request?.domainRevisionSnapshot,
    );
    const currentExecutionBlocker = currentExecutionValid
      ? currentExecution!.blockerCode
      : undefined;
    const persistentProviderRecovery = Boolean(
      currentExecutionBlocker?.startsWith("provider_") &&
        (request?.initialPlanRecoveryCount ?? 0) >= 3,
    );
    const contentPlanActionRequired = Boolean(
      currentExecutionValid &&
        (currentExecution!.status === "blocked" || persistentProviderRecovery),
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
    const autopublishConsentCurrent = Boolean(
      requestValid && publisherAutopublishConsentCurrent({ request: request! }),
    );
    const fullConsentActionRequired = Boolean(
      requestValid &&
        request!.automationMode === "full" &&
        !autopublishConsentCurrent,
    );
    const assistedReviewActionRequired = Boolean(
      requestValid &&
        request!.automationMode === "assisted" &&
        site.autopilotEnabled === true &&
        site.approvalRequired !== true,
    );
    const measurementVerified =
      oneSetupSearchMeasurementReceiptVerified(site) &&
      gscConnectionMatchesCurrentDomain(site);
    const outreachMailboxVerified = Boolean(
      ownerAccountKey && (
        outreachProgress.mode === "managed"
          ? oneSetupManagedOutreachMailboxReceiptVerified({
              siteDomain: site.domain,
              inboxes,
              resource: managedMailboxResource,
              requestId: String(request!._id),
              siteId: String(site._id),
              ownerAccountKey,
              expectedDomainRevision: request!.domainRevisionSnapshot ?? -1,
              expectedConfigurationRevision:
                request!.configurationRevision ?? 0,
              expectedGeneration: request!.outreachMailboxGeneration ?? -1,
              expectedRequestContractVersion: request!.contractVersion,
              expectedProfile: request?.managedOutreachProfile,
              now: Date.now(),
              rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
              runtimeConfig: inboundRelayRuntimeConfig(),
            })
          : oneSetupOutreachMailboxReceiptVerified({
              inboxes,
              ownerAccountKey,
            })
      ),
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
      crawledPage &&
        contentAnalysisMatchesCurrentDomain(site) &&
        (site.siteSummary || site.niche)
        ? "ready"
        : requestValid
          ? "queued"
          : "action_required";
    const planState: OneSetupReadinessState = contentPlanActionRequired
      ? "blocked"
      : (schedulerReadiness?.schedulerReadyTopicIds.length ?? 0) > 0
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
        cadenceFitsOperationalLimit(requestedCadence) &&
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
            (request!.automationMode === "assisted") &&
          autopublishConsentCurrent
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
      actionKind?:
        | "connect_publishing"
        | "connect_search_measurement"
        | "connect_gmail_outreach"
        | "configure_smtp_outreach"
        | "accept_publisher_autopublish"
        | "review_publishing";
      actionLabel?: string;
    }> = [
      { key: "website", label: "Website analyzed", state: websiteState },
      {
        key: "content_plan",
        label: "Content plan prepared",
        state: planState,
        actionRequiredBy: contentPlanActionRequired
          ? currentExecutionBlocker?.startsWith("provider_")
            ? "operator"
            : "owner"
          : undefined,
        reasonCode: contentPlanActionRequired
          ? currentExecutionBlocker
          : undefined,
        actionMessage: contentPlanActionRequired
          ? persistentProviderRecovery
            ? "Pentra is continuing bounded provider reinspection; persistent funding or provider availability needs operator attention."
            : "The exact setup execution stopped safely and requires attention; no paid plan receipt was replayed."
          : undefined,
      },
      { key: "cadence", label: "Cadence reserved", state: cadenceState },
      {
        key: "automation",
        label: "Automation mode authorized",
        state: automationState,
        actionRequiredBy: fullConsentActionRequired ||
            assistedReviewActionRequired
          ? "owner"
          : undefined,
        reasonCode: fullConsentActionRequired
          ? "publisher_autopublish_consent_required"
          : assistedReviewActionRequired
            ? "publisher_review_required"
            : undefined,
        actionMessage: fullConsentActionRequired
          ? oneSetupActionMessage("publisher_autopublish_consent_required")
          : assistedReviewActionRequired
            ? "Turn on review before publishing, or restart setup and explicitly authorize Full Autopilot."
            : undefined,
        actionKind: fullConsentActionRequired
          ? "accept_publisher_autopublish"
          : assistedReviewActionRequired
            ? "review_publishing"
            : undefined,
        actionLabel: fullConsentActionRequired
          ? "Authorize automatic publishing"
          : assistedReviewActionRequired
            ? "Review publishing settings"
            : undefined,
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
        actionKind: publisherProgress.actionRequiredBy === "owner" &&
            publisherProgress.blockedReasonCode?.startsWith("publisher_connection")
          ? "connect_publishing"
          : undefined,
        actionLabel: publisherProgress.actionRequiredBy === "owner" &&
            publisherProgress.blockedReasonCode?.startsWith("publisher_connection")
          ? "Connect publishing"
          : undefined,
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
        actionKind: measurementProgress.actionRequiredBy === "owner"
          ? "connect_search_measurement"
          : undefined,
        actionLabel: measurementProgress.actionRequiredBy === "owner"
          ? "Connect Search Console"
          : undefined,
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
        actionKind: outreachProgress.actionRequiredBy === "owner"
          ? request?.outreachTransport === "smtp"
            ? "configure_smtp_outreach"
            : "connect_gmail_outreach"
          : undefined,
        actionLabel: outreachProgress.actionRequiredBy === "owner"
          ? request?.outreachTransport === "smtp"
            ? "Configure SMTP mailbox"
            : "Connect Gmail mailbox"
          : undefined,
      },
    ];
    const aggregate = aggregateOneSetupReadiness(
      stages.map((stage) => stage.state),
    );
    return {
      contractVersion: ONE_SETUP_CONTRACT_VERSION,
      requestExists: requestValid,
      requestRevision: requestValid ? request!.revision : 0,
      configurationRevision: requestValid
        ? request!.configurationRevision ?? 0
        : 0,
      automationMode: (requestValid
        ? request!.automationMode
        : "assisted") as OneSetupAutomationMode,
      requestedCadencePerWeek: requestValid
        ? request!.requestedCadencePerWeek
        : site.cadenceRequestedPerWeek ?? site.cadencePerWeek ?? 0,
      publisherAutopublishConsent: {
        required: Boolean(
          requestValid && request!.automationMode === "full",
        ),
        current: autopublishConsentCurrent,
        version: PUBLISHER_AUTOPUBLISH_CONSENT_VERSION,
        policyHash: PUBLISHER_AUTOPUBLISH_CONSENT_POLICY_HASH,
        text: PUBLISHER_AUTOPUBLISH_CONSENT_TEXT,
      },
      outreachSenderProfile: requestValid
        ? request!.outreachSenderProfile
        : undefined,
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
      initialPlanExecution: currentExecutionValid
        ? {
          status: currentExecution!.status,
          blockerCode: currentExecution!.blockerCode,
          recoveryCount: request!.initialPlanRecoveryCount ?? 0,
          nextEligibleAt: oneSetupExecutionNextEligibleAt({
            planSettlementNextAt: currentExecution!.planSettlementNextAt,
            bootstrapAuthorizationNextAt:
              currentExecution!.bootstrapAuthorizationNextAt,
            pendingResumeNextAt: currentExecution!.pendingResumeNextAt,
            claimWatchNextAt: currentExecution!.claimWatchNextAt,
          }),
        }
        : null,
      // This is a narrowly named publishing receipt. It must not be presented
      // as proof that outreach, ranking, or conversion outcomes are active.
      publishingRolloutLive: site.autopilotRolloutMode === "live",
      updatedAt: Math.max(
        site.updatedAt,
        requestValid ? request!.updatedAt : 0,
        currentExecutionValid ? currentExecution!.updatedAt : 0,
      ),
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

/** Narrow recovery projection for a delivery whose durable lease may predate
 * a plan/domain-conflict transition. Callers still need the atomic
 * executionLeasePredatesPlanTransition receipt before settling and may never
 * use this projection to authorize a new provider mutation. */
export const getPublicationRecoverySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (
      !site ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt
    ) return null;
    return site;
  },
});

export const recordSeoAuthorityEvidenceInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
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
      normalizeCanonicalDomain(args.expectedCanonicalDomain) !==
        siteCanonicalDomain(site) ||
      args.expectedDomainRevision !== siteCanonicalDomainRevision(site) ||
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
    await assertConfigUnlocked(ctx, site);
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

export const settleLegacyPublicationAdapterPreflightInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    attemptedAt: v.number(),
    expectedConfigHash: v.string(),
    failureCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (
      !site ||
      site.publicationAdapterVerificationAttemptedAt !== args.attemptedAt ||
      publicationAdapterConfigHash(site) !== args.expectedConfigHash
    ) return { settled: false as const };
    const timestamp = now();
    await ctx.db.patch(site._id, args.failureCode
      ? {
          publicationAdapterVerificationFailedAt: timestamp,
          publicationAdapterVerificationFailureCode:
            args.failureCode.slice(0, 80),
          updatedAt: timestamp,
        }
      : {
          publicationAdapterVerificationFailedAt: undefined,
          publicationAdapterVerificationFailureCode: undefined,
          updatedAt: timestamp,
        });
    return { settled: true as const };
  },
});

/**
 * Persist only the exact proof assembled around a successful provider
 * preflight. Recomputing every tenant/configuration field in this mutation is
 * the post-I/O CAS that rejects domain, owner, and connection interleavings.
 */
export const recordPublisherDestinationReceiptInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    receipt: v.object({
      version: v.number(),
      status: v.union(v.literal("verified"), v.literal("revoked")),
      method: v.union(
        v.literal("github"),
        v.literal("wordpress"),
        v.literal("webhook"),
      ),
      destinationId: v.string(),
      ownerAccountKey: v.string(),
      canonicalDomain: v.string(),
      domainRevision: v.number(),
      configHash: v.string(),
      connectionGeneration: v.number(),
      adapterVersion: v.string(),
      verifiedAt: v.number(),
      revokedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (
      !site?.userId ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt
    ) throw new Error("Site not found");
    const expected = expectedPublisherDestinationReceipt({
      site,
      ownerAccountKey: accountDeletionKey(site.userId),
      verifiedAt: args.receipt.verifiedAt,
    });
    const timestamp = now();
    if (
      !expected ||
      args.receipt.version !== PUBLISHER_DESTINATION_RECEIPT_VERSION ||
      args.receipt.status !== "verified" ||
      args.receipt.revokedAt !== undefined ||
      !Number.isFinite(args.receipt.verifiedAt) ||
      args.receipt.verifiedAt <= 0 ||
      args.receipt.verifiedAt > timestamp + 5 * 60 * 1000 ||
      JSON.stringify(args.receipt) !== JSON.stringify(expected)
    ) {
      throw new Error("Publishing destination changed during verification");
    }
    await ctx.db.patch(site._id, {
      publisherDestinationReceipt: expected,
      updatedAt: timestamp,
    });
    await scheduleManagedPublisherResume(ctx, site._id);
    return {
      recorded: true as const,
      connectionGeneration: expected.connectionGeneration,
    };
  },
});

export const patchInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.optional(v.string()),
    expectedDomainRevision: v.optional(v.number()),
    patch: v.any(),
  },
  handler: async (
    ctx,
    { siteId, expectedCanonicalDomain, expectedDomainRevision, patch },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) throw new Error("Site not found");
    if (
      (expectedCanonicalDomain === undefined) !==
        (expectedDomainRevision === undefined) ||
      (expectedCanonicalDomain !== undefined &&
        (
          normalizeCanonicalDomain(expectedCanonicalDomain) !==
            siteCanonicalDomain(site) ||
          expectedDomainRevision !== siteCanonicalDomainRevision(site)
        ))
    ) {
      throw new Error("Site domain changed before derived data persistence");
    }

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
    if (Object.prototype.hasOwnProperty.call(safePatch, "domain") && !nextDomain) {
      throw new Error("Enter a valid website domain");
    }
    const domainChanged =
      Object.prototype.hasOwnProperty.call(safePatch, "domain") &&
      nextDomain !== normalizedAuthorityDomain(site.domain);
    clearStaleGitHubBranch(site, safePatch);
    const publisherConnectionInvalidated = publisherConnectionChanged(
      site,
      safePatch,
    );
    if (domainChanged) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        siteId,
        now(),
        "managed_mailbox_domain_invalidated",
      );
    }
    const invalidatesRollout = deliveryConfigChanged(site, safePatch);
    if (invalidatesRollout) await assertConfigUnlocked(ctx, site);
    if (invalidatesRollout) {
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "publishing configuration changed",
        domainChanged,
      );
    }
    if (domainChanged) await scheduleRetiredGscEpochPruning(ctx, site);
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
      ...publisherConnectionInvalidationPatch(
        site,
        publisherConnectionInvalidated,
      ),
      ...(domainChanged
        ? {
            ...canonicalDomainTransitionPatch(site),
            canonicalDomain: nextDomain!,
            seoAuthorityDomain: undefined,
            seoAuthorityDomainRank: undefined,
            seoAuthorityReferringDomains: undefined,
            seoAuthoritySource: undefined,
            seoAuthorityMeasuredAt: undefined,
          }
        : {}),
      updatedAt: now(),
    });
    if (publisherConnectionInvalidated) {
      await scheduleManagedPublisherResume(ctx, siteId, true);
    }
    if (domainChanged) await invalidateDomainCadenceState(ctx, siteId);
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
    if (
      args.publishMethod &&
      ["wordpress", "webhook"].includes(args.publishMethod) &&
      currentSite?.publishMethod !== args.publishMethod &&
      process.env.PENTRA_FULL_MANAGED_BETA_ENABLED !== "true"
    ) {
      throw new Error(
        "WordPress and signed-webhook publishing are beta and are not enabled for bootstrap v1",
      );
    }
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
        defaultTargetCadenceForMonthlyLimit(cadenceSnapshot.maxArticles)
      : args.cadencePerWeek;
    let effectiveCadence: number | undefined;
    if (requestedCadence !== undefined) {
      if (cadenceSite?.planParkedAt) {
        // A parked tenant retains customer intent but receives no paid article
        // execution until a trusted plan reconciliation reactivates it.
        effectiveCadence = undefined;
      } else {
        assertCadenceTargetSupported(requestedCadence);
        effectiveCadence = requestedCadence;
      }
    }

    validateOrganicClickGoal(args.organicClickGoalMonthly);
    const autopilotEnabled = args.autopilotEnabled;
    const inferToneNiche = args.inferToneNiche ?? true;
    const approvalRequired = args.approvalRequired;

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
      await assertUnattendedPublishingTransitionAuthorized(
        ctx,
        currentSite!,
        {
          autopilotEnabled:
            definedData.autopilotEnabled ?? currentSite!.autopilotEnabled,
          approvalRequired:
            definedData.approvalRequired ?? currentSite!.approvalRequired,
        },
      );
      const authorityDomainChanged =
        normalizedAuthorityDomain(currentSite!.domain) !==
        normalizedAuthorityDomain(domain);
      if (authorityDomainChanged) {
        await stageManagedOutreachMailboxRelease(
          ctx,
          args.id,
          now(),
          "managed_mailbox_domain_invalidated",
        );
        await demoteOutreachForDomainChange(ctx, args.id);
      }
      clearStaleGitHubBranch(currentSite!, definedData);
      const publisherConnectionInvalidated = publisherConnectionChanged(
        currentSite!,
        definedData,
      );
      const invalidatesRollout = deliveryConfigChanged(currentSite!, definedData);
      if (invalidatesRollout) await assertConfigUnlocked(ctx, currentSite!);
      if (invalidatesRollout) {
        await cancelAutonomousJobsForEpochTransition(
          ctx,
          args.id,
          "site configuration changed",
          authorityDomainChanged,
        );
      }
      if (authorityDomainChanged) {
        await scheduleRetiredGscEpochPruning(ctx, currentSite!);
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
        ...publisherConnectionInvalidationPatch(
          currentSite!,
          publisherConnectionInvalidated,
        ),
        ...(authorityDomainChanged
          ? {
              ...canonicalDomainTransitionPatch(currentSite!),
              seoAuthorityDomain: undefined,
              seoAuthorityDomainRank: undefined,
              seoAuthorityReferringDomains: undefined,
              seoAuthoritySource: undefined,
              seoAuthorityMeasuredAt: undefined,
            }
          : {}),
      });
      if (publisherConnectionInvalidated) {
        await scheduleManagedPublisherResume(ctx, args.id, true);
      }
      if (authorityDomainChanged) {
        await invalidateDomainCadenceState(ctx, args.id);
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
      await assertUnattendedPublishingTransitionAuthorized(ctx, existing, {
        autopilotEnabled: merged.autopilotEnabled as boolean | undefined,
        approvalRequired: merged.approvalRequired as boolean | undefined,
      });
      clearStaleGitHubBranch(existing, merged);
      const publisherConnectionInvalidated = publisherConnectionChanged(
        existing,
        merged,
      );
      const authorityDomainChanged =
        normalizedAuthorityDomain(existing.domain) !==
        normalizedAuthorityDomain(String(merged.domain ?? existing.domain));
      if (authorityDomainChanged) {
        await stageManagedOutreachMailboxRelease(
          ctx,
          existing._id,
          now(),
          "managed_mailbox_domain_invalidated",
        );
        await demoteOutreachForDomainChange(ctx, existing._id);
      }
      const invalidatesRollout = deliveryConfigChanged(existing, merged);
      if (invalidatesRollout) await assertConfigUnlocked(ctx, existing);
      if (invalidatesRollout) {
        await cancelAutonomousJobsForEpochTransition(
          ctx,
          existing._id,
          "site configuration changed",
          authorityDomainChanged,
        );
      }
      if (authorityDomainChanged) {
        await scheduleRetiredGscEpochPruning(ctx, existing);
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
        ...publisherConnectionInvalidationPatch(
          existing,
          publisherConnectionInvalidated,
        ),
        ...(authorityDomainChanged
          ? {
              ...canonicalDomainTransitionPatch(existing),
              seoAuthorityDomain: undefined,
              seoAuthorityDomainRank: undefined,
              seoAuthorityReferringDomains: undefined,
              seoAuthoritySource: undefined,
              seoAuthorityMeasuredAt: undefined,
            }
          : {}),
      });
      if (publisherConnectionInvalidated) {
        await scheduleManagedPublisherResume(ctx, existing._id, true);
      }
      if (authorityDomainChanged) {
        await invalidateDomainCadenceState(ctx, existing._id);
      }
      await syncOrganicClickGoal(ctx, existing._id, args.organicClickGoalMonthly);
      return existing._id;
    }

    if (effectiveCadence === undefined) {
      throw new Error("A new site requires an active target cadence");
    }
    const initialAutopilotEnabled = args.autopilotEnabled ?? true;
    const initialApprovalRequired = args.approvalRequired ?? false;
    await assertUnattendedPublishingTransitionAuthorized(ctx, null, {
      autopilotEnabled: initialAutopilotEnabled,
      approvalRequired: initialApprovalRequired,
    });
    const siteId = await ctx.db.insert("sites", {
      ...data,
      userId,
      planFeatures,
      language: args.language ?? "en",
      autopilotEnabled: initialAutopilotEnabled,
      approvalRequired: initialApprovalRequired,
      cadenceRequestedPerWeek: requestedCadence,
      cadencePerWeek: effectiveCadence,
      publishMethod: args.publishMethod ?? "github",
      externalLinking: args.externalLinking ?? true,
      sourceCitations: args.sourceCitations ?? true,
      youtubeEmbeds: args.youtubeEmbeds ?? false,
      urlStructure: args.urlStructure ?? "/blog/[slug]",
      autopilotRolloutMode: "observe",
      autopilotRolloutEpoch: 0,
      publisherConnectionGeneration: 0,
      canonicalDomainRevision: 0,
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
    if (
      fields.publishMethod &&
      ["wordpress", "webhook"].includes(fields.publishMethod) &&
      site.publishMethod !== fields.publishMethod &&
      process.env.PENTRA_FULL_MANAGED_BETA_ENABLED !== "true"
    ) {
      throw new Error(
        "WordPress and signed-webhook publishing are beta and are not enabled for bootstrap v1",
      );
    }
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
    const nextAutopilotEnabled = fields.autopilotEnabled ??
      site.autopilotEnabled;
    const nextApprovalRequired = fields.approvalRequired ??
      site.approvalRequired;
    await assertUnattendedPublishingTransitionAuthorized(ctx, site, {
      autopilotEnabled: nextAutopilotEnabled,
      approvalRequired: nextApprovalRequired,
    });
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
        assertCadenceTargetSupported(fields.cadencePerWeek);
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
      patch.cadencePerWeek = requestedCadence;
      patch.cadenceRequestedPerWeek = requestedCadence;
    }
    clearStaleGitHubBranch(site, patch);
    const publisherConnectionInvalidated = publisherConnectionChanged(
      site,
      patch,
    );
    const invalidatesRollout = deliveryConfigChanged(site, patch);
    if (invalidatesRollout) await assertConfigUnlocked(ctx, site);
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
      ...publisherConnectionInvalidationPatch(
        site,
        publisherConnectionInvalidated,
      ),
    });
    if (publisherConnectionInvalidated) {
      await scheduleManagedPublisherResume(ctx, siteId, true);
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
  // Managed foreign inboxes must release first so their post-boundary
  // messages can materialize exact provider-only tombstones before scrubbing.
  "outreach_foreign_owner_inboxes",
  "outreach_foreign_owner_messages",
  "outreach_foreign_owner_contacts",
  "outreach_foreign_owner_suppressions",
  "managed_outreach_mailbox_release_tombstones",
  "outreach_durability_migrations",
  "outreach_sender_suppression_tombstones",
  "outreach_tenant_contact_receipts",
  "outreach_sender_pacing_receipts",
  "managed_ses_pacing_receipts",
  "article_generation_attempts",
  "provider_spend_reservations",
  "usage_log",
] as const;
const SITE_DELETION_STAGES = [
  "managed_outreach_mailbox_resources",
  "one_setup_executions",
  "managed_provisioning_requests",
  "managed_ses_delivery_events",
  "managed_ses_event_canaries",
  "outreach_inbound_relay_canaries",
  "outreach_inbound_relay_receipts",
  "outreach_imap_receipts",
  "smartlead_canary_operations",
  "smartlead_webhook_events",
  "outreach_messages",
  // A signed event may settle while its exact message/canary row is being
  // drained. Sweep the event index again after both parent tables are gone;
  // the final all-stage rescan then supplies the OCC boundary against a
  // concurrent last insert.
  "managed_ses_delivery_events_terminal",
  "outreach_contacts",
  "outreach_suppressions",
  "outreach_inboxes",
  "outcome_receipts",
  "outcome_daily_rollups",
  "outcome_ingest_credentials",
  "seo_authority_runs",
  "seo_authority_opportunities",
  "opportunity_decision_receipts",
  "outreach_policy_decisions",
  "growth_loop_canary_receipts",
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

async function managedSesDeliveryHasExactReleaseFence(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  inbox: Doc<"outreach_inboxes"> | null,
  allowAtomicReleaseStaging: boolean,
): Promise<boolean> {
  if (
    message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
    !message.inboxId ||
    !inbox ||
    inbox._id !== message.inboxId ||
    inbox.siteId !== message.siteId ||
    inbox.provider !== MANAGED_SES_TRANSPORT ||
    !message.deliveryOwnerAccountKey ||
    message.deliveryOwnerAccountKey !== inbox.credentialOwnerAccountKey
  ) return false;
  const resources = await ctx.db
    .query("managed_outreach_mailbox_resources")
    .withIndex("by_canonical_inbox", (q) =>
      q.eq("canonicalInboxId", inbox._id)
    )
    .take(2);
  if (resources.length !== 1) return false;
  const resource = resources[0];
  if (
    resource.siteId !== message.siteId ||
    resource.ownerAccountKey !== message.deliveryOwnerAccountKey ||
    resource.transportKind !== MANAGED_SES_TRANSPORT ||
    resource.operationKey !== message.managedSesResourceOperationKey ||
    resource.generation !== message.managedSesGeneration ||
    resource.adapterVersion !== message.managedSesAdapterVersion
  ) return false;

  if (
    allowAtomicReleaseStaging &&
    resource.lifecycleState === "canonicalized" &&
    resource.releaseState === "active" &&
    inbox.credentialSource === "managed_adapter" &&
    inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
    inbox.managedTransportOperationKey === resource.operationKey &&
    inbox.managedTransportGeneration === resource.generation &&
    inbox.managedTransportAdapterVersion === resource.adapterVersion &&
    inbox.managedTransportResourceReceipt === resource.resourceReceipt
  ) return true;

  const tombstone = await ctx.db
    .query("managed_outreach_mailbox_release_tombstones")
    .withIndex("by_operation", (q) =>
      q.eq("operationKey", resource.operationKey)
    )
    .unique();
  if (
    !resource.releaseRequestedAt ||
    resource.lifecycleState !== "cancelled" ||
    !["requested", "leased", "blocked", "released"].includes(
      resource.releaseState,
    ) ||
    !tombstone ||
    tombstone.ownerAccountKey !== resource.ownerAccountKey ||
    tombstone.generation !== resource.generation ||
    tombstone.adapterVersion !== resource.adapterVersion ||
    !["release_requested", "blocked", "released"].includes(tombstone.state)
  ) return false;

  if (
    managedOutreachMailboxReleaseSealed({
      externalProvisioningAttemptedAt:
        resource.externalProvisioningAttemptedAt,
      externalAllocatedAt: resource.externalAllocatedAt,
      hasCanonicalInbox: Boolean(resource.canonicalInboxId),
      releaseState: resource.releaseState,
      tombstoneState: tombstone.state,
    })
  ) return true;
  return Boolean(
    inbox.credentialSource === "managed_adapter_retiring" &&
      inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
      inbox.managedTransportOperationKey === resource.operationKey &&
      inbox.managedTransportGeneration === resource.generation &&
      inbox.managedTransportAdapterVersion === resource.adapterVersion &&
      inbox.status === "disconnected" &&
      inbox.mode === "approval",
  );
}

async function gateSiteDeletionForOutreach(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  options: { allowAtomicManagedReleaseStaging?: boolean } = {},
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
  const [sendingRows, unresolvedRows, inboxes] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "sending")
      )
      .take(101),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified")
      )
      .take(101),
    ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2),
  ]);
  if (sendingRows.length > 100 || unresolvedRows.length > 100) {
    return {
      ready: false,
      reason: "outreach_delivery_unverified",
      convertedExpired: 0,
    };
  }
  const inboxById = new Map(
    inboxes.map((inbox) => [String(inbox._id), inbox]),
  );
  const releaseFenceCoverage = new Map<string, Promise<boolean>>();
  const releaseOwns = (message: Doc<"outreach_messages">) => {
    const key = JSON.stringify([
      message.inboxId,
      message.deliveryOwnerAccountKey,
      message.managedSesResourceOperationKey,
      message.managedSesGeneration,
      message.managedSesAdapterVersion,
    ]);
    const existing = releaseFenceCoverage.get(key);
    if (existing) return existing;
    const result = managedSesDeliveryHasExactReleaseFence(
      ctx,
      message,
      message.inboxId
        ? inboxById.get(String(message.inboxId)) ?? null
        : null,
      options.allowAtomicManagedReleaseStaging === true,
    );
    releaseFenceCoverage.set(key, result);
    return result;
  };
  const sendingCoverage = await Promise.all(sendingRows.map(releaseOwns));
  const unresolvedCoverage = await Promise.all(unresolvedRows.map(releaseOwns));
  const sending = sendingRows.filter((_, index) => !sendingCoverage[index]);
  const unresolved = unresolvedRows.filter(
    (_, index) => !unresolvedCoverage[index],
  );
  const decision = outreachDeletionGate({
    sending: sending.map((message) => ({
      messageId: message._id,
      status: message.status,
      attemptId: message.deliveryAttemptId,
      leaseExpiresAt: message.deliveryLeaseExpiresAt,
      boundaryVersion: message.deliveryBoundaryVersion,
      externalAttemptedAt: message.deliveryExternalAttemptedAt,
      managedSesExternalAttemptedAt: message.managedSesExternalAttemptedAt,
    })),
    unresolvedDeliveryCount: unresolved.length,
    now: timestamp,
  });
  for (const messageId of decision.safePreboundaryMessageIds) {
    const message = sending.find((row) => row._id === messageId);
    if (!message) continue;
    await ctx.db.patch(message._id, {
      status: "skipped",
      deliveryLeaseExpiresAt: undefined,
      deliveryLeaseExpiredAt: timestamp,
      managedSesUnsubscribeTokenHash: undefined,
      blockedReason:
        "Tenant deletion drained an expired exact claim that never crossed the provider boundary.",
      failureReason:
        "Tenant deletion drained an expired exact claim that never crossed the provider boundary.",
      updatedAt: timestamp,
    });
    if (message.deliveryOwnerAccountKey && message.deliveryAttemptId) {
      await releaseDurableContactClaimForAccount(
        ctx,
        message.deliveryOwnerAccountKey,
        message.toDomain,
        message.deliveryAttemptId,
        timestamp,
      );
    }
  }
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

  // Managed SES ambiguity is settled by the exact resource release pipeline,
  // not by a Gmail-style owner review. Quarantine and stage that immutable
  // disposition/release fence before evaluating whether any remaining
  // (legacy/Gmail) provider boundary still requires owner action.
  const timestamp = now();
  await stageManagedOutreachMailboxRelease(
    ctx,
    siteId,
    timestamp,
    "tenant_site_deletion_requested",
  );
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
    publisherConnectionGeneration:
      (site.publisherConnectionGeneration ?? 0) + 1,
    publisherDestinationReceipt: undefined,
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
      credentialCiphertext: undefined,
      credentialKeyId: undefined,
      credentialEncryptionVersion: undefined,
      credentialBindingHash: undefined,
      imapHost: undefined,
      imapPort: undefined,
      imapUsername: undefined,
      imapVerifiedAt: undefined,
      imapUidValidity: undefined,
      imapLastUid: undefined,
      imapLastPolledAt: undefined,
      imapNextPollAt: undefined,
      imapLeaseToken: undefined,
      imapLeaseExpiresAt: undefined,
      imapLastError: undefined,
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
  // A verified account-erasure receipt must erect its credential fence even
  // when a previously claimed relay canary is still inside its bounded lease.
  // The later account-site finalizer waits through that exact lease and the
  // global quiescence window; throwing here would roll back the deletion
  // receipt and leave credentials live indefinitely.
  if (!site.accountDeletionRequestedAt) {
    await cancelAutonomousJobsForEpochTransition(
      ctx,
      site._id,
      "verified account deletion requested",
      true,
    );
  }
  await stageManagedOutreachMailboxRelease(
    ctx,
    site._id,
    timestamp,
    "verified_account_deletion_requested",
  );
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
    publisherConnectionGeneration:
      (site.publisherConnectionGeneration ?? 0) + 1,
    publisherDestinationReceipt: undefined,
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
      credentialCiphertext: undefined,
      credentialKeyId: undefined,
      credentialEncryptionVersion: undefined,
      credentialBindingHash: undefined,
      imapHost: undefined,
      imapPort: undefined,
      imapUsername: undefined,
      imapVerifiedAt: undefined,
      imapUidValidity: undefined,
      imapLastUid: undefined,
      imapLastPolledAt: undefined,
      imapNextPollAt: undefined,
      imapLeaseToken: undefined,
      imapLeaseExpiresAt: undefined,
      imapLastError: undefined,
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
    case "managed_outreach_mailbox_resources":
      return ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(SITE_DELETION_BATCH);
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
    case "managed_ses_delivery_events":
    case "managed_ses_delivery_events_terminal":
      return ctx.db
        .query("managed_ses_delivery_events")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(SITE_DELETION_BATCH);
    case "managed_ses_event_canaries":
      return ctx.db
        .query("managed_ses_event_canaries")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(SITE_DELETION_BATCH);
    case "outreach_inbound_relay_canaries":
      return ctx.db.query("outreach_inbound_relay_canaries").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_inbound_relay_receipts":
      return ctx.db.query("outreach_inbound_relay_receipts").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_imap_receipts":
      return ctx.db.query("outreach_imap_receipts").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "smartlead_canary_operations":
      return ctx.db.query("smartlead_canary_operations").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "smartlead_webhook_events":
      return ctx.db.query("smartlead_webhook_events").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
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
    case "opportunity_decision_receipts":
      return ctx.db.query("opportunity_decision_receipts").withIndex("by_site_classification", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "outreach_policy_decisions":
      return ctx.db.query("outreach_policy_decisions").withIndex("by_site_decision", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
    case "growth_loop_canary_receipts":
      return ctx.db.query("growth_loop_canary_receipts").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(SITE_DELETION_BATCH);
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
      if (
        SITE_DELETION_STAGES[safeStage] ===
          "managed_outreach_mailbox_resources"
      ) {
        const resource = row as Doc<"managed_outreach_mailbox_resources">;
        const tombstone = await ctx.db
          .query("managed_outreach_mailbox_release_tombstones")
          .withIndex("by_operation", (q) =>
            q.eq("operationKey", resource.operationKey)
          )
          .unique();
        if (!managedOutreachMailboxReleaseSealed({
          externalProvisioningAttemptedAt:
            resource.externalProvisioningAttemptedAt,
          externalAllocatedAt: resource.externalAllocatedAt,
          hasCanonicalInbox: Boolean(resource.canonicalInboxId),
          releaseState: resource.releaseState,
          tombstoneState: tombstone?.state,
        })) {
          await stageManagedOutreachMailboxRelease(
            ctx,
            siteId,
            now(),
            verifiedAccountDeletion
              ? "verified_account_deletion_requested"
              : "tenant_site_deletion_requested",
          );
          await ctx.db.patch(siteId, {
            deletionStage: safeStage,
            updatedAt: now(),
          });
          await ctx.scheduler.runAfter(
            ACCOUNT_DELETION_RETRY_MS,
            internal.sites.continueSiteDeletionInternal,
            { siteId, stage: safeStage },
          );
          return {
            done: false,
            stage: "managed_mailbox_external_release_pending",
            deleted: 0,
            nextStage: safeStage,
          };
        }
        await ctx.db.delete(resource._id);
      } else if (
        SITE_DELETION_STAGES[safeStage] === "managed_ses_event_canaries"
      ) {
        const canary = row as Doc<"managed_ses_event_canaries">;
        if (!(await materializeManagedSesCanaryTombstoneForDeletion(
          ctx,
          canary,
        ))) {
          await ctx.db.patch(siteId, {
            deletionStage: safeStage,
            updatedAt: now(),
          });
          await ctx.scheduler.runAfter(
            ACCOUNT_DELETION_RETRY_MS,
            internal.sites.continueSiteDeletionInternal,
            { siteId, stage: safeStage },
          );
          return {
            done: false,
            stage: "managed_ses_canary_tombstone_pending",
            deleted: 0,
            nextStage: safeStage,
          };
        }
        await ctx.db.delete(canary._id);
      } else if (SITE_DELETION_STAGES[safeStage] === "outreach_messages") {
        const message = row as Doc<"outreach_messages">;
        if (!(await materializeManagedSesSendTombstoneForDeletion(
          ctx,
          message,
        ))) {
          await ctx.db.patch(siteId, {
            deletionStage: safeStage,
            updatedAt: now(),
          });
          await ctx.scheduler.runAfter(
            ACCOUNT_DELETION_RETRY_MS,
            internal.sites.continueSiteDeletionInternal,
            { siteId, stage: safeStage },
          );
          return {
            done: false,
            stage: "managed_ses_send_tombstone_pending",
            deleted: 0,
            nextStage: safeStage,
          };
        }
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
    const [sending, canaries, managedSesCanaries] = await Promise.all([
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
      ctx.db
        .query("managed_ses_event_canaries")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(100),
    ]);
    const latestExternalLease = Math.max(
      site.publicationLeaseExpiresAt ?? 0,
      ...sending.map((message) => message.deliveryLeaseExpiresAt ?? 0),
      ...canaries.map((canary) => canary.deliveryLeaseExpiresAt ?? 0),
      ...managedSesCanaries.map((canary) =>
        Math.max(
          canary.sendLeaseExpiresAt ?? 0,
          canary.dispositionLeaseExpiresAt ?? 0,
        )
      ),
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
    case "managed_outreach_mailbox_release_tombstones":
      return ctx.db
        .query("managed_outreach_mailbox_release_tombstones")
        .withIndex("by_account", (q) =>
          q.eq("ownerAccountKey", accountDeletionKey(userId))
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
    case "managed_ses_pacing_receipts":
      return ctx.db
        .query("managed_ses_pacing_receipts")
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
  if (!(await materializeManagedSesSendTombstoneForDeletion(ctx, message))) {
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
  const imapReceipts = await ctx.db
    .query("outreach_imap_receipts")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .take(10);
  for (const receipt of imapReceipts) await ctx.db.delete(receipt._id);
  if (imapReceipts.length >= 10) return "progress";

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

type ForeignManagedInboxReleaseState =
  | { state: "not_managed" }
  | { state: "pending" }
  | {
      state: "sealed";
      resource: Doc<"managed_outreach_mailbox_resources">;
    };

async function stageForeignOwnerManagedInboxRelease(
  ctx: MutationCtx,
  inbox: Doc<"outreach_inboxes">,
  deletingOwnerAccountKey: string,
  timestamp: number,
): Promise<ForeignManagedInboxReleaseState> {
  const managed = Boolean(
    inbox.provider === MANAGED_SES_TRANSPORT ||
      inbox.managedTransportKind === MANAGED_SES_TRANSPORT ||
      ["managed_adapter", "managed_adapter_retiring"].includes(
        inbox.credentialSource ?? "",
      ),
  );
  if (!managed) return { state: "not_managed" };
  if (inbox.credentialOwnerAccountKey !== deletingOwnerAccountKey) {
    throw new Error(
      "Foreign managed inbox no longer belongs to the deleting account",
    );
  }

  await stageManagedOutreachMailboxReleaseForInbox(
    ctx,
    inbox._id,
    timestamp,
    "verified_account_deletion_foreign_owner",
  );
  const resources = await ctx.db
    .query("managed_outreach_mailbox_resources")
    .withIndex("by_canonical_inbox", (q) =>
      q.eq("canonicalInboxId", inbox._id)
    )
    .take(2);
  if (resources.length !== 1) {
    throw new Error(
      "Foreign managed inbox must resolve to one exact external resource",
    );
  }
  const resource = resources[0];
  if (
    resource.siteId !== inbox.siteId ||
    resource.canonicalInboxId !== inbox._id ||
    resource.ownerAccountKey !== deletingOwnerAccountKey ||
    resource.transportKind !== MANAGED_SES_TRANSPORT ||
    (inbox.credentialSource !== undefined &&
      (inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
        inbox.managedTransportOperationKey !== resource.operationKey ||
        inbox.managedTransportGeneration !== resource.generation ||
        inbox.managedTransportAdapterVersion !== resource.adapterVersion))
  ) {
    throw new Error(
      "Foreign managed inbox external-resource provenance is not exact",
    );
  }
  const tombstone = await ctx.db
    .query("managed_outreach_mailbox_release_tombstones")
    .withIndex("by_operation", (q) =>
      q.eq("operationKey", resource.operationKey)
    )
    .unique();
  if (
    !tombstone ||
    !managedOutreachMailboxReleaseSealed({
      externalProvisioningAttemptedAt:
        resource.externalProvisioningAttemptedAt,
      externalAllocatedAt: resource.externalAllocatedAt,
      hasCanonicalInbox: true,
      releaseState: resource.releaseState,
      tombstoneState: tombstone.state,
    }) ||
    tombstone.ownerAccountKey !== deletingOwnerAccountKey ||
    tombstone.generation !== resource.generation ||
    tombstone.adapterVersion !== resource.adapterVersion
  ) return { state: "pending" };
  return { state: "sealed", resource };
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
          const managedRelease = await stageForeignOwnerManagedInboxRelease(
            ctx,
            inbox,
            receipt.accountKey,
            now(),
          );
          if (managedRelease.state === "pending") {
            externalLeaseWait = true;
            continue;
          }
          if (managedRelease.state === "sealed") {
            // Drain only the exact historical inbox. Site-wide reads here
            // could erase the current owner's managed resource after a site
            // transfer, so every query is keyed by the foreign inbox id.
            const deliveryEvents = await ctx.db
              .query("managed_ses_delivery_events")
              .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
              .take(20);
            for (const event of deliveryEvents) {
              await ctx.db.delete(event._id);
            }
            if (deliveryEvents.length > 0) continue;
            const managedCanaries = await ctx.db
              .query("managed_ses_event_canaries")
              .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
              .take(20);
            for (const canary of managedCanaries) {
              if (
                await materializeManagedSesCanaryTombstoneForDeletion(
                  ctx,
                  canary,
                )
              ) {
                await ctx.db.delete(canary._id);
              } else {
                externalLeaseWait = true;
              }
            }
            if (managedCanaries.length > 0) continue;
          }
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
                if (managedRelease.state === "sealed") {
                  await ctx.db.delete(managedRelease.resource._id);
                }
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
        } else if (
          name === "managed_outreach_mailbox_release_tombstones"
        ) {
          const tombstone = row as
            Doc<"managed_outreach_mailbox_release_tombstones">;
          if (![
            "released",
            "not_required",
          ].includes(tombstone.state)) {
            throw new Error(
              "Managed mailbox release must be sealed before account deletion can remove its tombstone",
            );
          }
          await ctx.db.delete(tombstone._id);
        } else if (name === "outreach_sender_pacing_receipts") {
          // Sender-domain reputation is global and must not be refunded by
          // moving the mailbox to another account. Remove only the deleted
          // account link; the hashed short-lived pacing state remains.
          await ctx.db.patch(
            row._id as Id<"outreach_sender_pacing_receipts">,
            { accountKey: undefined, tenantDomainKey: undefined },
          );
        } else if (name === "managed_ses_pacing_receipts") {
          // Preserve conservative shared-domain reputation without retaining
          // a deleted tenant, mailbox, or managed-resource linkage.
          await ctx.db.patch(
            row._id as Id<"managed_ses_pacing_receipts">,
            {
              accountKey: undefined,
              mailboxKey: undefined,
              resourceOperationKeyDigest: undefined,
              updatedAt: now(),
            },
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
        gscConnected: gscConnectionMatchesCurrentDomain(site),
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
  const queriedAt = Date.now();
  const siteOwnerAccountKey = site.userId
    ? accountDeletionKey(site.userId)
    : undefined;
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .take(2);
  const inbox = inboxes.length === 1 ? inboxes[0] : undefined;
  const inboxOwnerCurrent = Boolean(
    inbox &&
      siteOwnerAccountKey &&
      inbox.credentialOwnerAccountKey === siteOwnerAccountKey,
  );
  const managedSesResources = inbox?.provider === MANAGED_SES_TRANSPORT
    ? await ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) =>
          q.eq("canonicalInboxId", inbox._id)
        )
        .take(2)
    : [];
  const managedSesResource = managedSesResources.length === 1
    ? managedSesResources[0]
    : undefined;
  const relayRuntimeConfig = inboundRelayRuntimeConfig();
  const relayConfigurationHash = inboundRelayConfigurationHash(
    relayRuntimeConfig,
  );
  const managedSesTransportReady = Boolean(
    inbox &&
      inboxOwnerCurrent &&
      managedSesResource &&
      managedSesResource.siteId === siteId &&
      managedSesResource.ownerAccountKey === siteOwnerAccountKey &&
      managedSesResource.transportKind === MANAGED_SES_TRANSPORT &&
      managedSesResource.lifecycleState === "canonicalized" &&
      managedSesResource.releaseState === "active" &&
      managedSesResource.canonicalInboxId === inbox._id &&
      managedSesResource.operationKey ===
        inbox.managedTransportOperationKey &&
      managedSesResource.generation === inbox.managedTransportGeneration &&
      managedSesResource.adapterVersion ===
        inbox.managedTransportAdapterVersion &&
      managedSesResource.resourceReceipt ===
        inbox.managedTransportResourceReceipt &&
      managedSesResource.externalVerifiedAt ===
        inbox.managedTransportResourceVerifiedAt &&
      managedSesInboxReceiptCurrent({
        inbox,
        now: queriedAt,
        expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
      }),
  );
  const managedSesInboundRelayReady = Boolean(
    managedSesTransportReady &&
      relayConfigurationHash &&
      inbox?.managedTransportInboundCanaryRelayConfigurationHash ===
        relayConfigurationHash &&
      inbox.managedTransportInboundCanaryRetentionPolicyHash ===
        relayRuntimeConfig.retentionPolicyHash,
  );
  const outboundTransportReady = Boolean(
    inbox &&
      inboxOwnerCurrent &&
      (inbox.provider === MANAGED_SES_TRANSPORT
        ? managedSesTransportReady
        : autonomousOutreachTransportIssues({
            inbox,
            now: queriedAt,
            managedSesAdapterVersion:
              process.env.MANAGED_SES_ADAPTER_VERSION,
          }).length === 0),
  );
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
      outboundTransportReady,
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
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  const currentAuthorityOpportunity = async (status: string) => {
    if (!canonicalDomain) return null;
    if (siteUsesLegacyDomainReceipts(site)) {
      const rows = await ctx.db
        .query("seo_authority_opportunities")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        )
        .take(100);
      return rows.find((row) => {
        const unstampedLegacy =
          row.canonicalDomain === undefined && row.domainRevision === undefined;
        const explicitlyCurrent =
          normalizeCanonicalDomain(row.canonicalDomain ?? "") ===
            canonicalDomain &&
          row.domainRevision === siteCanonicalDomainRevision(site);
        return unstampedLegacy || explicitlyCurrent;
      }) ?? null;
    }
    return ctx.db
      .query("seo_authority_opportunities")
      .withIndex("by_site_domain_revision_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", siteCanonicalDomainRevision(site))
          .eq("status", status)
      )
      .first();
  };
  const currentMessageByStatus = async (status: string) => {
    if (!siteOwnerAccountKey || !canonicalDomain) return null;
    if (siteUsesLegacyDomainReceipts(site)) {
      return ctx.db
        .query("outreach_messages")
        .withIndex("by_site_owner_lineage_status", (q) =>
          q
            .eq("siteId", siteId)
            .eq("ownerAccountKey", siteOwnerAccountKey)
            .eq("ownerLineageUnresolvedAt", undefined)
            .eq("status", status)
        )
        .first();
    }
    return ctx.db
      .query("outreach_messages")
      .withIndex("by_site_epoch_owner_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", domainRevision)
          .eq("ownerAccountKey", siteOwnerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", status)
      )
      .first();
  };
  const currentDueAutomaticMessage = async () => {
    if (
      !activeAutonomyConsent ||
      !inbox ||
      !siteOwnerAccountKey ||
      !canonicalDomain
    ) return null;
    const messages = await Promise.all(
      Array.from({ length: MAX_SEQUENCE_STEP + 1 }, (_, sequenceStep) =>
        siteUsesLegacyDomainReceipts(site)
          ? ctx.db
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
                .lte("scheduledAt", queriedAt)
            )
            .first()
          : ctx.db
            .query("outreach_messages")
            .withIndex("by_site_epoch_owner_auto_sequence_scheduled", (q) =>
              q
                .eq("siteId", siteId)
                .eq("canonicalDomain", canonicalDomain)
                .eq("domainRevision", domainRevision)
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
                .lte("scheduledAt", queriedAt)
            )
            .first()
      ),
    );
    return messages.find(Boolean) ?? null;
  };
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
    currentAuthorityOpportunity("verified"),
    currentMessageByStatus("approved"),
    currentDueAutomaticMessage(),
    currentAuthorityOpportunity("contacted"),
    currentAuthorityOpportunity("acquired"),
    currentMessageByStatus("sent"),
    currentMessageByStatus("delivery_reviewed_sent"),
    currentMessageByStatus("replied"),
  ]);
  const signedRelayReady = Boolean(
    inbox &&
    inboxOwnerCurrent &&
    !["disconnected", "suspended"].includes(inbox.status) &&
    inboundRelayConfigured(relayRuntimeConfig) &&
    (inbox.provider === MANAGED_SES_TRANSPORT
      ? managedSesInboundRelayReady
      : inbox.provider === "gmail" && inboundRelayDsnRoutingReady({
          inbox,
          now: queriedAt,
          rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
          runtimeConfig: relayRuntimeConfig,
        })),
  );
  const inboundCapability = inboxOwnerCurrent
    ? inboundMonitoringCapability(inbox, { relayReady: signedRelayReady })
    : inboundMonitoringCapability(null);
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
    inboxOwnerCurrent,
    outboundTransportReady,
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
    inboundMonitoringReady: inboundCapability.ready,
    inboundMonitoringMode: inboundCapability.mode,
    hasMessagesToMonitor: [sentMessage, reviewedSentMessage, repliedMessage]
      .some((message) => Boolean(
        message &&
        (inboundCapability.mode === "imap"
          ? message.deliveryTransport === "smtp" &&
            message.inboundRelayOutboundMessageIdHash
          : inbox?.provider === MANAGED_SES_TRANSPORT
            ? message.inboundRelayAliasHash &&
              message.inboundRelayOutboundMessageIdHash
            : message.providerMessageId || message.providerThreadId),
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
    await assertConfigUnlocked(ctx, site);
    if (!site.autopilotEnabled && mode !== "observe") {
      throw new Error("Autopilot must be enabled before controlled rollout");
    }
    if (mode !== "observe") {
      const setupBlockers = await oneSetupPromotionBlockers(
        ctx,
        site,
        mode === "live" ? "live" : "warm",
      );
      if (setupBlockers.length > 0) {
        throw new Error(
          `One-setup canonical receipts are incomplete: ${setupBlockers.join(", ")}`,
        );
      }
    }

    if (mode === "live") {
      const hasCrawledPage = Boolean(await currentDomainPage(ctx, site));
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
      const ready = await takeCurrentDomainArticleSummariesByStatus(
        ctx,
        site,
        "ready",
        10,
      );
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
    await assertConfigUnlocked(ctx, site);
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
    const hasCrawledPage = Boolean(await currentDomainPage(ctx, site));
    const limits = getLimitsFromFeatures(site.planFeatures ?? []);
    const setupBlockers = await oneSetupPromotionBlockers(ctx, site, "live");
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
    const warmSetupBlockers = await oneSetupPromotionBlockers(ctx, site, "warm");
    const mode = warm.ready && warmSetupBlockers.length === 0
      ? "warm" as const
      : "observe" as const;
    await assertConfigUnlocked(ctx, site);
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
      // This also fences receipt-free `unverified` published revisions after
      // their worker/site lease was cleared. A reset is all-or-nothing; one
      // hidden ambiguous provider outcome cannot be discovered only after
      // other tenants have already entered deletion.
      await assertConfigUnlocked(ctx, site);
      const outreachDeletion = await gateSiteDeletionForOutreach(
        ctx,
        site._id,
        { allowAtomicManagedReleaseStaging: true },
      );
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
      // Run every deletion-request fence in this same serializable mutation.
      // Either every site is marked deletion-pending and credentials are
      // revoked before commit, or any failure rolls the account reset back;
      // asynchronous workers only perform the later bounded purge.
      const result = await requestSiteDeletion(
        ctx,
        site._id,
        identity.subject,
      );
      if (!result.scheduled) {
        throw new Error(
          `Account reset could not atomically fence site ${String(site._id)}`,
        );
      }
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
    expectedCanonicalDomain: v.optional(v.string()),
    expectedDomainRevision: v.optional(v.number()),
    expectedConnectionGeneration: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      siteId,
      githubToken,
      repoOwner,
      repoName,
      repoDefaultBranch,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionGeneration,
    },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    const expectedFence = [
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionGeneration,
    ];
    if (
      expectedFence.some((value) => value !== undefined) &&
      (
        expectedFence.some((value) => value === undefined) ||
        normalizeCanonicalDomain(expectedCanonicalDomain!) !==
          siteCanonicalDomain(site) ||
        expectedDomainRevision !== siteCanonicalDomainRevision(site) ||
        expectedConnectionGeneration !==
          (site.publisherConnectionGeneration ?? 0)
      )
    ) {
      throw new Error("Publishing connection changed during verification");
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
      await assertConfigUnlocked(ctx, site);
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
      ...publisherConnectionInvalidationPatch(site, invalidatesRollout),
      updatedAt: now(),
    });
    if (invalidatesRollout) {
      await scheduleManagedPublisherResume(ctx, site._id, true);
    }
    return {
      publisherConnectionGeneration: (site.publisherConnectionGeneration ?? 0) +
        (invalidatesRollout ? 1 : 0),
    };
  },
});

// Set Google Search Console OAuth tokens via HTTP API
export const setGscTokenInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    establishConnection: v.optional(v.boolean()),
    gscAccessToken: v.string(),
    gscRefreshToken: v.optional(v.string()),
    gscProperty: v.optional(v.string()),
    gscEmail: v.optional(v.string()),
    gscScopes: v.optional(v.string()),
    expectedReceiptRevision: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      siteId,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      establishConnection,
      gscAccessToken,
      gscRefreshToken,
      gscProperty,
      gscEmail,
      gscScopes,
      expectedReceiptRevision,
    },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    const canonicalDomain = siteCanonicalDomain(site);
    if (
      !canonicalDomain ||
      normalizeCanonicalDomain(expectedCanonicalDomain) !== canonicalDomain ||
      expectedDomainRevision !== siteCanonicalDomainRevision(site) ||
      expectedConnectionRevision !== siteGscConnectionRevision(site)
    ) {
      throw new Error("Site domain changed during Search Console connection");
    }
    const property = gscProperty ?? site.gscProperty;
    if (!property) {
      throw new Error("A matching Search Console property is required for the initial connection");
    }
    if (
      expectedReceiptRevision !== undefined &&
      (site.gscReceiptRevision ?? 0) !== expectedReceiptRevision
    ) {
      throw new Error("Search Console connection changed during token refresh");
    }
    if (!establishConnection && expectedReceiptRevision === undefined) {
      throw new Error("A token refresh requires the exact connection receipt");
    }
    if (!establishConnection && site.gscReceiptStatus === "revoked") {
      throw new Error("A revoked Search Console connection cannot be refreshed");
    }
    if (establishConnection && !gscProperty) {
      throw new Error("A fresh Search Console connection requires an exact property receipt");
    }
    if (!gscPropertyMatchesCanonicalDomain(property, canonicalDomain)) {
      throw new Error("Search Console property does not match the current site domain");
    }
    if (
      !establishConnection &&
      (!gscConnectionMatchesCurrentDomain(site) ||
        property !== site.gscProperty)
    ) {
      throw new Error("Search Console refresh belongs to an earlier connection");
    }
    const connectionRevision = establishConnection
      ? nextGscConnectionRevision(site)
      : expectedConnectionRevision;
    if (establishConnection) {
      await assertConfigUnlocked(ctx, site);
      await scheduleRetiredGscEpochPruning(ctx, site);
      await invalidateGscGrowthState(
        ctx,
        siteId,
        "Search Console was reconnected; prior measurement actions were retired.",
      );
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        siteId,
        "Search Console connection changed",
      );
    }
    const timestamp = now();
    await ctx.db.patch(site._id, {
      gscAccessToken,
      ...(establishConnection
        ? {
            // A new connection never inherits account-owned fields omitted by
            // the provider. This prevents a fresh grant from falling back to
            // an older account's refresh token or identity.
            gscRefreshToken,
            gscProperty: property,
            gscEmail,
            gscScopes,
            gscConnectedAt: timestamp,
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
            gscReceiptStatus: "verified" as const,
            gscReceiptRevision: (site.gscReceiptRevision ?? 0) + 1,
            gscReceiptVerifiedAt: timestamp,
            gscReceiptRevokedAt: undefined,
            gscReceiptReasonCode: undefined,
            autopilotRolloutMode: "observe" as const,
            autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
          }
        : {
            ...(gscRefreshToken ? { gscRefreshToken } : {}),
          }),
      gscCanonicalDomain: canonicalDomain,
      gscDomainRevision: expectedDomainRevision,
      gscConnectionRevision: connectionRevision,
      updatedAt: timestamp,
    });
  },
});

const GSC_RECEIPT_REASON_VALIDATOR = v.union(
  v.literal("oauth_invalid_grant"),
  v.literal("provider_unauthorized"),
  v.literal("owner_disconnected"),
  v.literal("site_domain_changed"),
);

/**
 * A successful provider read refreshes the exact domain/grant receipt. The
 * receipt revision prevents a late response from an older OAuth grant from
 * blessing a newer connection on the same domain.
 */
export const markGscReceiptVerifiedInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedGscProperty: v.string(),
    expectedReceiptRevision: v.number(),
    verifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    const timestamp = now();
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.gscAccessToken ||
      !site.gscRefreshToken ||
      site.gscReceiptStatus === "revoked" ||
      !Number.isFinite(args.verifiedAt) ||
      args.verifiedAt <= 0 ||
      args.verifiedAt > timestamp + 5 * 60 * 1000 ||
      args.verifiedAt < (site.gscReceiptVerifiedAt ?? 0) ||
      args.verifiedAt <= (site.gscReceiptRevokedAt ?? 0) ||
      !canonicalGscReceiptMutationFenceCurrent({
        site: site as CanonicalDomainRevisionSite,
        ...args,
      })
    ) return { updated: false as const };
    const receiptRevision = args.expectedReceiptRevision === 0
      ? 1
      : args.expectedReceiptRevision;
    await ctx.db.patch(site._id, {
      gscReceiptStatus: "verified",
      gscReceiptRevision: receiptRevision,
      gscReceiptVerifiedAt: args.verifiedAt,
      gscReceiptRevokedAt: undefined,
      gscReceiptReasonCode: undefined,
      updatedAt: timestamp,
    });
    return { updated: true as const, receiptRevision };
  },
});

/** Hard provider authorization failures revoke only the exact captured grant. */
export const markGscReceiptRevokedInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedGscProperty: v.string(),
    expectedReceiptRevision: v.number(),
    reasonCode: GSC_RECEIPT_REASON_VALIDATOR,
    revokedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    const timestamp = now();
    if (
      !site ||
      !Number.isFinite(args.revokedAt) ||
      args.revokedAt <= 0 ||
      args.revokedAt > timestamp + 5 * 60 * 1000 ||
      !canonicalGscReceiptMutationFenceCurrent({
        site: site as CanonicalDomainRevisionSite,
        ...args,
      })
    ) return { updated: false as const };
    const wasLive = site.autopilotRolloutMode === "live";
    if (wasLive) {
      await cancelAutonomousJobsForEpochTransition(
        ctx,
        site._id,
        "Search Console authorization was revoked",
      );
    }
    // Revocation consumes the captured grant generation. Concurrent refresh or
    // verification responses still carrying the old generation cannot restore
    // either a credential or readiness after this mutation commits.
    const receiptRevision = (site.gscReceiptRevision ?? 0) + 1;
    await ctx.db.patch(site._id, {
      gscAccessToken: undefined,
      gscRefreshToken: undefined,
      gscReceiptStatus: "revoked",
      gscReceiptRevision: receiptRevision,
      gscReceiptRevokedAt: args.revokedAt,
      gscReceiptReasonCode: args.reasonCode,
      ...(wasLive
        ? {
            autopilotRolloutMode: "warm" as const,
            autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
          }
        : {}),
      updatedAt: timestamp,
    });
    return { updated: true as const, receiptRevision };
  },
});

// Disconnect Google Search Console
export const disconnectGsc = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    await assertConfigUnlocked(ctx, site);
    const cancelledJobs = await cancelAutonomousJobsForEpochTransition(
      ctx,
      siteId,
      "Google Search Console disconnected",
    );
    await invalidateGscGrowthState(
      ctx,
      siteId,
      "Search Console was disconnected; prior measurement actions were retired.",
    );
    await scheduleRetiredGscEpochPruning(ctx, site);
    const timestamp = now();
    await ctx.db.patch(siteId, {
      gscAccessToken: undefined,
      gscRefreshToken: undefined,
      gscProperty: undefined,
      gscCanonicalDomain: undefined,
      gscDomainRevision: undefined,
      gscConnectionRevision: nextGscConnectionRevision(site),
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
      gscReceiptStatus: "revoked",
      gscReceiptRevision: (site.gscReceiptRevision ?? 0) + 1,
      gscReceiptRevokedAt: timestamp,
      gscReceiptReasonCode: "owner_disconnected",
      autopilotRolloutMode: "observe",
      autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
      updatedAt: timestamp,
    });
    return { disconnected: true, cancelledJobs };
  },
});
