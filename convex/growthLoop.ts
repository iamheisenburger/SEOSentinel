import { v } from "convex/values";

import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { sha256Hex } from "./lib/publicationArtifact";
import { accountDeletionKey } from "./lib/accountDeletion";
import { oneSetupOutreachMailboxReceiptVerified } from
  "./lib/oneSetupCanonical";
import { inboundRelayDsnRoutingReady } from "./lib/outreachInboundRelay";
import { inboundMonitoringCapability } from "./lib/outreachSecurity";
import { takeCurrentGscPageRows } from "./lib/currentGscRows";
import { addSearchConsoleDays } from "./lib/searchPerformance";
import { buildGrowthScorecard } from "./lib/growthScorecard";
import {
  capabilityReceipt,
  GROWTH_LOOP_CONTRACT_VERSION,
  GROWTH_LOOP_RELEASE_VERSION,
  GROWTH_LOOP_ROLLOUT_STAGES,
  GROWTH_LOOP_STAGE_KEYS,
  growthLoopReleaseBlockers,
  type CapabilityState,
  type GrowthLoopReleaseProfile,
  type GrowthLoopStageKey,
  type PublisherKind,
} from "./lib/growthLoopContracts";

const CANARY_KIND = v.union(
  v.literal("publisher_github"),
  v.literal("publisher_wordpress"),
  v.literal("publisher_webhook"),
  v.literal("tenant_natural_loop"),
  v.literal("tenant_terminal_convergence"),
  v.literal("measurement_decision"),
  v.literal("smtp_connection"),
  v.literal("smtp_delivery"),
  v.literal("imap_reply"),
  v.literal("imap_bounce"),
  v.literal("imap_stop"),
  v.literal("smtp_followup_cancellation"),
  v.literal("controlled_conversion"),
  v.literal("smartlead_provisioning"),
  v.literal("smartlead_warmup"),
  v.literal("smartlead_delivery"),
  v.literal("smartlead_reply"),
  v.literal("smartlead_bounce"),
  v.literal("smartlead_unsubscribe"),
  v.literal("smartlead_cancellation"),
  v.literal("acquired_backlink"),
);

const RELEASE_PROFILE = v.union(
  v.literal("bootstrap_v1"),
  v.literal("full_managed"),
);

const BOOTSTRAP_TENANT_ROLE = v.union(
  v.literal("primary_natural"),
  v.literal("secondary_convergence"),
);

const BOOTSTRAP_V1_CANARY_KINDS = new Set([
  "publisher_github",
  "tenant_natural_loop",
  "tenant_terminal_convergence",
  "measurement_decision",
  "smtp_connection",
  "smtp_delivery",
  "imap_reply",
  "imap_bounce",
  "imap_stop",
  "smtp_followup_cancellation",
  "controlled_conversion",
  "acquired_backlink",
]);

function releaseProfileAllowsCanary(
  profile: GrowthLoopReleaseProfile,
  kind: string,
): boolean {
  if (profile === "bootstrap_v1") return BOOTSTRAP_V1_CANARY_KINDS.has(kind);
  return ![
    "tenant_terminal_convergence",
    "smtp_connection",
    "smtp_delivery",
    "imap_reply",
    "imap_bounce",
    "imap_stop",
    "smtp_followup_cancellation",
    "controlled_conversion",
  ].includes(kind);
}

function stateForSetupProgress(state: string | undefined): CapabilityState {
  switch (state) {
    case "ready": return "ready";
    case "owner_action_required": return "waiting_owner";
    case "requested":
    case "in_progress": return "waiting_pentra";
    case "blocked": return "degraded";
    default: return "waiting_owner";
  }
}

function nextIntervalAt(timestamp: number, minutes: number): number {
  const interval = minutes * 60 * 1000;
  return Math.floor(timestamp / interval) * interval + interval;
}

function nextUtcDailyAt(timestamp: number, hour: number, minute: number): number {
  const current = new Date(timestamp);
  const next = Date.UTC(
    current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(),
    hour, minute, 0, 0,
  );
  return next > timestamp ? next : next + 24 * 60 * 60 * 1000;
}

/** Customer-visible, credential-free truth projection for the whole loop. */
export const getStatus = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const site = await ctx.db.get(siteId);
    if (!site || site.userId !== identity.subject || site.deletionStatus) {
      throw new Error("Site not found");
    }
    const timestamp = Date.now();
    const gscWindow = site.gscDataThrough
      ? {
          startDate: addSearchConsoleDays(site.gscDataThrough, -111),
          endDate: site.gscDataThrough,
        }
      : undefined;
    const [request, health, topics, articles, actions, inboxes, resources, opportunities, rollups, gscRead] =
      await Promise.all([
        ctx.db.query("managed_provisioning_requests").withIndex("by_site", (q) => q.eq("siteId", siteId)).unique(),
        ctx.db.query("autopilot_health").withIndex("by_site", (q) => q.eq("siteId", siteId)).unique(),
        ctx.db.query("topic_clusters").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(500),
        ctx.db.query("articles").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(500),
        ctx.db.query("seo_growth_actions").withIndex("by_site_priority", (q) => q.eq("siteId", siteId)).take(500),
        ctx.db.query("outreach_inboxes").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(10),
        ctx.db.query("managed_outreach_mailbox_resources").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(20),
        ctx.db.query("seo_authority_opportunities").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "acquired")).take(100),
        ctx.db.query("outcome_daily_rollups").withIndex("by_site_date", (q) => q.eq("siteId", siteId)).take(500),
        takeCurrentGscPageRows(ctx, site, 5_000, gscWindow),
      ]);

    const latestOpportunity = await ctx.db
      .query("opportunity_decision_receipts")
      .withIndex("by_site_evaluated", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    const published = articles.filter((article) =>
      article.status === "published" && article.publicationReceipt &&
      article.publicUrlStatus === "verified" && article.publicUrlVerifiedAt
    );
    const measuredConversions = rollups.reduce(
      (sum, row) => sum + (row.signups ?? 0) + (row.activations ?? 0) +
        (row.paidConversions ?? 0) + row.qualifiedActions,
      0,
    );
    const readyBuffer = health?.approvedBufferCount ?? articles.filter((article) =>
      article.status === "ready" && article.publicationGateStatus === "passed" &&
      Boolean(article.auditedContentHash)
    ).length;
    const bufferMinimum = health?.bufferMinimum ?? 2;
    const currentInbox = inboxes.length === 1 ? inboxes[0] : undefined;
    const activeManagedResource = currentInbox
      ? resources.find((resource) =>
          resource.canonicalInboxId === currentInbox._id &&
          resource.operationKey === currentInbox.managedTransportOperationKey &&
          resource.generation === currentInbox.managedTransportGeneration)
      : undefined;
    const smartleadInbox = currentInbox?.managedTransportKind ===
      "smartlead_managed";
    const smartleadCanariesReady = Boolean(
      smartleadInbox &&
        activeManagedResource?.transportKind === "smartlead_managed" &&
        activeManagedResource.domainAuthenticationReceipt &&
        activeManagedResource.warmupState === "verified" &&
        activeManagedResource.warmupEligibleAt &&
        activeManagedResource.warmupEligibleAt <= timestamp &&
        activeManagedResource.deliveryCanaryReceipt &&
        activeManagedResource.replyCanaryReceipt &&
        activeManagedResource.bounceCanaryReceipt &&
        activeManagedResource.unsubscribeCanaryReceipt &&
        activeManagedResource.cancellationCanaryReceipt
    );
    const relayReady = Boolean(
      currentInbox && currentInbox.provider !== "smtp" &&
      inboundRelayDsnRoutingReady({
        inbox: currentInbox,
        now: timestamp,
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        runtimeConfig: {
          domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
          secrets: [
            process.env.OUTREACH_INBOUND_RELAY_SECRET,
            process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
          ],
          dsnTargetSecret:
            process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
          adapterVersion:
            process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
          retentionPolicyHash:
            process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
          retentionAudited:
            process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
        },
      })
    );
    const inboundCapability = inboundMonitoringCapability(currentInbox, {
      relayReady,
    });
    const customerManagedReady = Boolean(
      currentInbox && !smartleadInbox &&
      oneSetupOutreachMailboxReceiptVerified({
        inboxes,
        ownerAccountKey: accountDeletionKey(site.userId),
      }) &&
      inboundCapability.ready
    );
    const outreachReady = smartleadInbox
      ? smartleadCanariesReady
      : customerManagedReady;
    const outreachState: CapabilityState = inboxes.length > 1
      ? "terminal"
      : outreachReady
        ? "ready"
        : !currentInbox
          ? "waiting_owner"
          : ["disconnected", "suspended"].includes(currentInbox.status)
            ? "degraded"
            : smartleadInbox && currentInbox.status === "warming"
              ? "warming"
              : smartleadInbox
                ? "waiting_provider"
                : "waiting_owner";
    const outreachBlocker = outreachReady
      ? undefined
      : inboxes.length > 1
        ? "outreach_inbox_identity_conflict"
        : !currentInbox
          ? "sender_connection_required"
          : ["disconnected", "suspended"].includes(currentInbox.status)
            ? "sender_connection_degraded"
            : smartleadInbox && currentInbox.status === "warming"
              ? "managed_sender_warming"
              : smartleadInbox
                ? "smartlead_canaries_pending"
                : currentInbox?.provider === "smtp"
                  ? "sender_authentication_or_imap_verification_required"
                  : "sender_authentication_or_bounce_canary_required";
    const setupState = stateForSetupProgress(request?.aggregateState);
    const setupBlocker = setupState === "ready"
      ? undefined
      : request?.publisher.blockedReasonCode ??
        request?.searchMeasurement.blockedReasonCode ??
        request?.outreachMailbox.blockedReasonCode ??
        "one_setup_incomplete";
    const setupResponsible = setupState === "waiting_owner" ? "owner" : "pentra";
    const setupWake = request?.nextAttemptAt ?? nextIntervalAt(timestamp, 5);
    const planningWake = latestOpportunity?.automaticWakeAt ??
      latestOpportunity?.nextEligibleAt ?? nextIntervalAt(timestamp, 15);
    const publicationWake = health?.nextPublicationDueAt ?? nextIntervalAt(timestamp, 180);
    const measurementWake = nextUtcDailyAt(timestamp, 12, 30);
    const improvementWake = nextUtcDailyAt(timestamp, 13, 30);
    const outreachWake = activeManagedResource?.nextAttemptAt ??
      activeManagedResource?.warmupEligibleAt ?? nextIntervalAt(timestamp, 15);
    const backlinkWake = nextUtcDailyAt(timestamp, 14, 30);

    const specs: Array<{
      key: GrowthLoopStageKey;
      state: CapabilityState;
      blockerCode?: string;
      nextEligibleAt?: number;
      automaticWakeAt?: number;
    }> = [
      {
        key: "setup",
        state: setupState,
        blockerCode: setupBlocker,
        nextEligibleAt: setupState === "ready" ? undefined : setupState === "waiting_owner" ? timestamp : setupWake,
        automaticWakeAt: setupState === "ready" ? undefined : setupWake,
      },
      {
        key: "planning",
        state: latestOpportunity?.classification === "eligible" || topics.some((topic) => topic.status === "planned")
          ? "ready"
          : latestOpportunity?.classification === "opportunity_space_exhausted"
            ? "degraded"
            : "waiting_pentra",
        blockerCode: latestOpportunity?.classification === "eligible" || topics.some((topic) => topic.status === "planned")
          ? undefined
          : latestOpportunity?.classification ??
            (health?.portfolioStatus === "below_goal"
              ? "opportunity_space_exhausted"
              : "opportunity_decision_pending"),
        nextEligibleAt: latestOpportunity?.classification === "eligible" || topics.some((topic) => topic.status === "planned")
          ? undefined : planningWake,
        automaticWakeAt: latestOpportunity?.classification === "eligible" || topics.some((topic) => topic.status === "planned")
          ? undefined : planningWake,
      },
      {
        key: "buffer",
        state: readyBuffer >= bufferMinimum ? "ready" : "waiting_pentra",
        blockerCode: readyBuffer >= bufferMinimum ? undefined : "sealed_buffer_below_minimum",
        nextEligibleAt: readyBuffer >= bufferMinimum ? undefined : nextIntervalAt(timestamp, 15),
        automaticWakeAt: readyBuffer >= bufferMinimum ? undefined : nextIntervalAt(timestamp, 15),
      },
      {
        key: "publication",
        state: published.length > 0 ? "ready" : site.publisherDestinationReceipt?.status === "verified" ? "waiting_pentra" : "waiting_owner",
        blockerCode: published.length > 0 ? undefined : site.publisherDestinationReceipt?.status === "verified" ? "verified_publication_pending" : "publisher_authorization_required",
        nextEligibleAt: published.length > 0 ? undefined : publicationWake,
        automaticWakeAt: published.length > 0 ? undefined : publicationWake,
      },
      {
        key: "measurement",
        state: site.gscReceiptStatus === "verified" && site.gscDataSyncedAt ? "ready" : site.gscReceiptStatus === "verified" ? "waiting_provider" : "waiting_owner",
        blockerCode: site.gscReceiptStatus === "verified" && site.gscDataSyncedAt ? undefined : site.gscReceiptStatus === "verified" ? "gsc_observation_window_pending" : "search_console_authorization_required",
        nextEligibleAt: site.gscReceiptStatus === "verified" && site.gscDataSyncedAt ? undefined : site.gscReceiptStatus === "verified" ? measurementWake : timestamp,
        automaticWakeAt: site.gscReceiptStatus === "verified" && site.gscDataSyncedAt ? undefined : measurementWake,
      },
      {
        key: "improvement",
        state: actions.some((action) => action.automationStatus === "executed" || action.status === "resolved") ? "ready" : published.length > 0 ? "waiting_pentra" : "waiting_provider",
        blockerCode: actions.some((action) => action.automationStatus === "executed" || action.status === "resolved") ? undefined : published.length > 0 ? "measured_growth_decision_pending" : "publication_evidence_required",
        nextEligibleAt: actions.some((action) => action.automationStatus === "executed" || action.status === "resolved") ? undefined : improvementWake,
        automaticWakeAt: actions.some((action) => action.automationStatus === "executed" || action.status === "resolved") ? undefined : improvementWake,
      },
      {
        key: "outreach",
        state: outreachState,
        blockerCode: outreachBlocker,
        nextEligibleAt: outreachReady
          ? undefined
          : outreachState === "terminal"
            ? undefined
            : currentInbox ? outreachWake : timestamp,
        automaticWakeAt: outreachReady || outreachState === "terminal"
          ? undefined
          : outreachWake,
      },
      {
        key: "backlink_verification",
        state: opportunities.length > 0 ? "ready" : "waiting_provider",
        blockerCode: opportunities.length > 0 ? undefined : "no_acquired_backlink_receipt",
        nextEligibleAt: opportunities.length > 0 ? undefined : backlinkWake,
        automaticWakeAt: opportunities.length > 0 ? undefined : backlinkWake,
      },
    ];
    const stages = Object.fromEntries(specs.map((spec) => [
      spec.key,
      capabilityReceipt({
        capability: spec.key,
        state: spec.state,
        blockerCode: spec.blockerCode,
        nextEligibleAt: spec.nextEligibleAt,
        automaticWakeAt: spec.automaticWakeAt,
        binding: `${siteId}:${site.autopilotRolloutEpoch ?? 0}`,
        evaluatedAt: timestamp,
      }),
    ])) as Record<GrowthLoopStageKey, ReturnType<typeof capabilityReceipt>>;
    const unfinishedTimes = Object.values(stages)
      .flatMap((stage) => stage.nextEligibleAt === undefined ? [] : [stage.nextEligibleAt]);
    const scorecard = buildGrowthScorecard({
      dataThrough: site.gscDataThrough,
      receiptDates: (site.gscDateEpochs ?? []).map((receipt) => receipt.date),
      rows: gscRead.rows,
    });
    const latestGrowthAction = [...actions]
      .sort((left, right) => right.lastObservedAt - left.lastObservedAt)[0];
    return {
      siteId: String(siteId),
      stages,
      stageOrder: GROWTH_LOOP_STAGE_KEYS,
      ready: Object.values(stages).every((stage) => stage.state === "ready"),
      nextEligibleAt: unfinishedTimes.length ? Math.min(...unfinishedTimes) : undefined,
      verifiedOutcomes: {
        publishedUrls: published.length,
        measuredConversions,
        acquiredBacklinks: opportunities.length,
      },
      activity: {
        topics: topics.length,
        articles: articles.length,
        growthActions: actions.length,
      },
      forecasts: {
        expectedClicksMonthly: health?.portfolioExpectedClicksMonthly,
        goalMonthly: health?.portfolioGoalMonthly,
        evidenceMissing: health?.portfolioEvidenceMissing,
      },
      searchPerformance: {
        dataThrough: site.gscDataThrough,
        evidenceReadComplete: !gscRead.exhausted,
        windows: scorecard,
      },
      latestGrowthAction: latestGrowthAction
        ? {
            actionKind: latestGrowthAction.actionKind,
            status: latestGrowthAction.status,
            reason: latestGrowthAction.reason,
            automationStatus: latestGrowthAction.automationStatus,
            lastObservedAt: latestGrowthAction.lastObservedAt,
            nextReviewAt: latestGrowthAction.nextReviewAt,
            resolvedAt: latestGrowthAction.resolvedAt,
          }
        : null,
      evaluatedAt: timestamp,
      version: GROWTH_LOOP_CONTRACT_VERSION,
      setupResponsible,
    };
  },
});

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const ROLLOUT_STAGE_OBSERVATION_MS = 60 * 60 * 1000;
const ROLLOUT_RECHECK_MS = 15 * 60 * 1000;

function requireHash(value: string | undefined, label: string): string {
  if (!value || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact SHA-256 receipt`);
  }
  return value;
}

function rolloutCanaryBlockers(
  canaries: Array<{
    kind: string;
    status: string;
    siteId?: unknown;
    bootstrapTenantRole?: unknown;
    managedResourceId?: unknown;
  }>,
  profile: GrowthLoopReleaseProfile,
): string[] {
  const passed = canaries.filter((row) => row.status === "passed");
  const naturalTenantIds = new Set(passed
    .filter((row) => row.kind === "tenant_natural_loop" && row.siteId)
    .map((row) => String(row.siteId)));
  const terminalTenantIds = new Set(passed
    .filter((row) =>
      row.kind === "tenant_terminal_convergence" && row.siteId
    )
    .map((row) => String(row.siteId)));
  const publisherRows = passed.filter((row) =>
    row.kind.startsWith("publisher_") &&
    row.siteId && naturalTenantIds.has(String(row.siteId))
  );
  const publisherKinds = new Set(publisherRows.map((row) => row.kind));
  const smartleadRows = passed.filter((row) =>
    row.kind.startsWith("smartlead_")
  );
  const smartleadResourceIds = new Set(smartleadRows
    .map((row) => row.managedResourceId ? String(row.managedResourceId) : "")
    .filter(Boolean));
  const blockers: string[] = [];
  if (profile === "bootstrap_v1") {
    const primaryNatural = passed.filter((row) =>
      row.kind === "tenant_natural_loop" &&
      row.bootstrapTenantRole === "primary_natural" && row.siteId
    );
    const secondary = passed.filter((row) =>
      ["tenant_natural_loop", "tenant_terminal_convergence"].includes(row.kind) &&
      row.bootstrapTenantRole === "secondary_convergence" && row.siteId
    );
    if (
      primaryNatural.length < 1 || secondary.length < 1 ||
      String(primaryNatural[0]?.siteId) === String(secondary[0]?.siteId)
    ) {
      blockers.push("two_authorized_tenant_canaries_missing");
    }
    if (primaryNatural.length < 1) blockers.push("tenant_natural_loop_missing");
    if (secondary.length < 1) blockers.push("tenant_terminal_convergence_missing");
    if (!publisherKinds.has("publisher_github")) {
      blockers.push("publisher_github_missing");
    }
    for (const kind of [
      "measurement_decision",
      "smtp_connection",
      "smtp_delivery",
      "imap_reply",
      "imap_bounce",
      "imap_stop",
      "smtp_followup_cancellation",
      "controlled_conversion",
      "acquired_backlink",
    ]) {
      if (!passed.some((row) => row.kind === kind)) {
        blockers.push(`${kind}_missing`);
      }
    }
    return blockers;
  }
  if (naturalTenantIds.size < 3) {
    blockers.push("three_unrelated_tenant_canaries_missing");
  }
  if ([...naturalTenantIds].some((siteId) =>
    !publisherRows.some((row) => String(row.siteId) === siteId)
  )) blockers.push("tenant_canary_publisher_receipt_missing");
  for (const kind of ["publisher_github", "publisher_wordpress", "publisher_webhook"]) {
    if (!publisherKinds.has(kind)) blockers.push(`${kind}_missing`);
  }
  for (const kind of [
    "smartlead_provisioning", "smartlead_warmup",
    "smartlead_delivery", "smartlead_reply", "smartlead_bounce",
    "smartlead_unsubscribe", "smartlead_cancellation",
  ]) {
    if (!smartleadRows.some((row) => row.kind === kind)) {
      blockers.push(`${kind}_missing`);
    }
  }
  if (smartleadResourceIds.size !== 1) {
    blockers.push("smartlead_canary_generation_incoherent");
  }
  if (!passed.some((row) =>
    row.kind === "measurement_decision" && row.siteId &&
    naturalTenantIds.has(String(row.siteId))
  )) blockers.push("measurement_decision_missing");
  if (!passed.some((row) =>
    row.kind === "acquired_backlink" && row.siteId &&
    naturalTenantIds.has(String(row.siteId))
  )) blockers.push("acquired_backlink_missing");
  return blockers;
}

async function rolloutOperationalBlockers(ctx: MutationCtx, timestamp: number) {
  const silentCutoff = timestamp - 15 * 60 * 1000;
  const [alerts, jobs, runs, resources, messages] = await Promise.all([
    ctx.db.query("autopilot_alerts")
      .withIndex("by_status_created", (q) => q.eq("status", "active"))
      .take(501),
    ctx.db.query("jobs")
      .withIndex("by_status_heartbeat", (q) => q.eq("status", "running"))
      .take(101),
    ctx.db.query("autopilot_runs")
      .withIndex("by_status_heartbeat", (q) => q.eq("status", "running"))
      .take(101),
    ctx.db.query("managed_outreach_mailbox_resources")
      .withIndex("by_lifecycle_lease", (q) => q.eq("lifecycleState", "leased"))
      .take(101),
    ctx.db.query("outreach_messages")
      .withIndex("by_status_lease", (q) => q.eq("status", "sending"))
      .take(101),
  ]);
  if (
    alerts.length > 500 || jobs.length > 100 || runs.length > 100 ||
    resources.length > 100 || messages.length > 100
  ) throw new Error("Growth-loop rollout evidence read limit exceeded");
  const severePattern =
    /(duplicate_external|cross_tenant|suppression|integrity|conflict|delivery_unverified|terminal_alert)/;
  const unresolvedSevereIncidentCount = alerts.filter((alert) =>
    severePattern.test(`${alert.kind}:${alert.message}`.toLowerCase())
  ).length;
  const silentStateCount =
    jobs.filter((job) => (job.heartbeatAt ?? job.updatedAt) <= silentCutoff).length +
    runs.filter((run) => run.heartbeatAt <= silentCutoff).length +
    resources.filter((resource) =>
      !resource.leaseExpiresAt || resource.leaseExpiresAt <= timestamp).length +
    messages.filter((message) =>
      !message.deliveryLeaseExpiresAt || message.deliveryLeaseExpiresAt <= timestamp).length;
  return { unresolvedSevereIncidentCount, silentStateCount };
}

async function startEligibleRollout(
  ctx: MutationCtx,
  releaseCommit: string,
  profile: GrowthLoopReleaseProfile,
  deploymentReceiptHash: string,
  deployedAt: number,
) {
  const existing = await ctx.db.query("growth_loop_rollout_controls")
    .withIndex("by_release_commit", (q) => q.eq("releaseCommit", releaseCommit))
    .unique();
  if (existing) {
    if (
      (existing.profile ?? "full_managed") !== profile ||
      existing.deploymentReceiptHash !== deploymentReceiptHash ||
      existing.deployedAt !== deployedAt
    ) throw new Error("Release commit is bound to a different deployment profile");
    return { control: existing, blockers: [] as string[] };
  }
  const canaries = await ctx.db.query("growth_loop_canary_receipts")
    .withIndex("by_release", (q) => q.eq("releaseCommit", releaseCommit))
    .take(101);
  if (canaries.length > 100) {
    return { control: null, blockers: ["release_canary_read_limit_exceeded"] };
  }
  const eligibleCanaries = canaries.filter((canary) =>
    (canary.profile ?? "full_managed") === profile &&
    canary.deploymentReceiptHash === deploymentReceiptHash &&
    canary.deployedAt === deployedAt
  );
  const blockers = rolloutCanaryBlockers(eligibleCanaries, profile);
  if (blockers.length) return { control: null, blockers };
  const timestamp = Date.now();
  const operational = await rolloutOperationalBlockers(ctx, timestamp);
  if (operational.unresolvedSevereIncidentCount > 0) {
    blockers.push("unresolved_severe_incident");
  }
  if (operational.silentStateCount > 0) {
    blockers.push("silent_state_over_15_minutes");
  }
  if (blockers.length) return { control: null, blockers };
  const id = await ctx.db.insert("growth_loop_rollout_controls", {
    releaseCommit,
    profile,
    deploymentReceiptHash,
    deployedAt,
    status: "active",
    targetPercent: GROWTH_LOOP_ROLLOUT_STAGES[0],
    stageStartedAt: timestamp,
    nextEvaluationAt: timestamp + ROLLOUT_STAGE_OBSERVATION_MS,
    unresolvedSevereIncidentCount: 0,
    silentStateCount: 0,
    contractVersion: GROWTH_LOOP_RELEASE_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { control: await ctx.db.get(id), blockers: [] as string[] };
}

/** Begin widening only after the release candidate already has every source-
 * bound production canary. The mutation cannot invent a canary result. */
export const startRolloutInternal = internalMutation({
  args: {
    releaseCommit: v.string(),
    profile: RELEASE_PROFILE,
    deploymentReceiptHash: v.string(),
    deployedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { releaseCommit } = args;
    if (!RELEASE_COMMIT_PATTERN.test(releaseCommit)) {
      throw new Error("Release commit must be a full immutable git commit");
    }
    requireHash(args.deploymentReceiptHash, "deployment receipt");
    if (!Number.isSafeInteger(args.deployedAt) || args.deployedAt <= 0) {
      throw new Error("Deployment timestamp is invalid");
    }
    const result = await startEligibleRollout(
      ctx,
      releaseCommit,
      args.profile,
      args.deploymentReceiptHash,
      args.deployedAt,
    );
    if (!result.control) {
      throw new Error(`Growth-loop rollout blocked: ${result.blockers.join(",")}`);
    }
    return result.control;
  },
});

/** Natural recovery for the case where the last canary committed while an
 * operational evidence read was temporarily unavailable. */
export const ensureEligibleRolloutInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const latestCanary = await ctx.db.query("growth_loop_canary_receipts")
      .order("desc")
      .first();
    if (!latestCanary) {
      return { started: false as const, reason: "no_release_canaries" };
    }
    if (
      !latestCanary.deploymentReceiptHash ||
      !HASH_PATTERN.test(latestCanary.deploymentReceiptHash) ||
      !latestCanary.deployedAt
    ) {
      return {
        started: false as const,
        releaseCommit: latestCanary.releaseCommit,
        blockers: ["deployment_receipt_missing"],
      };
    }
    try {
      const result = await startEligibleRollout(
        ctx,
        latestCanary.releaseCommit,
        latestCanary.profile ?? "full_managed",
        latestCanary.deploymentReceiptHash ?? "",
        latestCanary.deployedAt ?? 0,
      );
      return result.control
        ? {
            started: true as const,
            releaseCommit: latestCanary.releaseCommit,
            targetPercent: result.control.targetPercent,
          }
        : {
            started: false as const,
            releaseCommit: latestCanary.releaseCommit,
            blockers: result.blockers,
          };
    } catch {
      return {
        started: false as const,
        releaseCommit: latestCanary.releaseCommit,
        blockers: ["operational_evidence_temporarily_unavailable"],
      };
    }
  },
});

/** Natural staged widening. Any severe or silent state pauses the shared
 * release controller; a clean re-check restarts the current stage's
 * observation window rather than widening immediately. */
export const advanceRolloutInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = Date.now();
    const control = await ctx.db.query("growth_loop_rollout_controls")
      .withIndex("by_next", (q) => q.lte("nextEvaluationAt", timestamp))
      .order("asc")
      .first();
    if (!control || control.status === "complete") {
      return { advanced: false as const, reason: "no_rollout_due" };
    }
    const operational = await rolloutOperationalBlockers(ctx, timestamp);
    if (
      operational.unresolvedSevereIncidentCount > 0 ||
      operational.silentStateCount > 0
    ) {
      await ctx.db.patch(control._id, {
        status: "paused",
        blockerCode: operational.unresolvedSevereIncidentCount > 0
          ? "unresolved_severe_incident"
          : "silent_state_over_15_minutes",
        unresolvedSevereIncidentCount:
          operational.unresolvedSevereIncidentCount,
        silentStateCount: operational.silentStateCount,
        nextEvaluationAt: timestamp + ROLLOUT_RECHECK_MS,
        updatedAt: timestamp,
      });
      return { advanced: false as const, paused: true as const, ...operational };
    }
    if (control.status === "paused") {
      await ctx.db.patch(control._id, {
        status: "active",
        blockerCode: undefined,
        stageStartedAt: timestamp,
        nextEvaluationAt: timestamp + ROLLOUT_STAGE_OBSERVATION_MS,
        unresolvedSevereIncidentCount: 0,
        silentStateCount: 0,
        updatedAt: timestamp,
      });
      return { advanced: false as const, resumed: true as const };
    }
    const currentIndex = GROWTH_LOOP_ROLLOUT_STAGES.indexOf(
      control.targetPercent as typeof GROWTH_LOOP_ROLLOUT_STAGES[number],
    );
    if (currentIndex < 0) throw new Error("Invalid growth-loop rollout stage");
    if (control.targetPercent === 100) {
      await ctx.db.patch(control._id, {
        status: "complete",
        nextEvaluationAt: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return { advanced: true as const, targetPercent: 100, complete: true as const };
    }
    const targetPercent = GROWTH_LOOP_ROLLOUT_STAGES[currentIndex + 1];
    await ctx.db.patch(control._id, {
      targetPercent,
      stageStartedAt: timestamp,
      nextEvaluationAt: timestamp + ROLLOUT_STAGE_OBSERVATION_MS,
      blockerCode: undefined,
      unresolvedSevereIncidentCount: 0,
      silentStateCount: 0,
      updatedAt: timestamp,
    });
    return { advanced: true as const, targetPercent, complete: false as const };
  },
});

/**
 * Internal adapter settlement only. The caller supplies source IDs, never a
 * success flag or hash. This mutation re-reads the production evidence and
 * derives the immutable receipt, so an orchestrator cannot self-report GA.
 */
export const recordCanaryInternal = internalMutation({
  args: {
    releaseCommit: v.string(),
    profile: RELEASE_PROFILE,
    deploymentReceiptHash: v.string(),
    deployedAt: v.number(),
    siteId: v.id("sites"),
    bootstrapTenantRole: v.optional(BOOTSTRAP_TENANT_ROLE),
    kind: CANARY_KIND,
    articleId: v.optional(v.id("articles")),
    opportunityId: v.optional(v.id("seo_authority_opportunities")),
    growthActionId: v.optional(v.id("seo_growth_actions")),
    opportunityDecisionReceiptId:
      v.optional(v.id("opportunity_decision_receipts")),
    inboxId: v.optional(v.id("outreach_inboxes")),
    messageId: v.optional(v.id("outreach_messages")),
    outcomeReceiptId: v.optional(v.id("outcome_receipts")),
    managedResourceId: v.optional(v.id("managed_outreach_mailbox_resources")),
    promotionRunId: v.optional(v.id("autopilot_runs")),
  },
  handler: async (ctx, args) => {
    if (!RELEASE_COMMIT_PATTERN.test(args.releaseCommit)) {
      throw new Error("Release commit must be a full immutable git commit");
    }
    requireHash(args.deploymentReceiptHash, "deployment receipt");
    if (!Number.isSafeInteger(args.deployedAt) || args.deployedAt <= 0) {
      throw new Error("Deployment timestamp is invalid");
    }
    if (!releaseProfileAllowsCanary(args.profile, args.kind)) {
      throw new Error("Canary kind is not allowed for this release profile");
    }
    const tenantCanaryKind = [
      "tenant_natural_loop",
      "tenant_terminal_convergence",
    ].includes(args.kind);
    if (
      (args.profile === "bootstrap_v1" && tenantCanaryKind &&
        !args.bootstrapTenantRole) ||
      (args.kind === "tenant_terminal_convergence" &&
        args.bootstrapTenantRole !== "secondary_convergence") ||
      (!tenantCanaryKind && args.bootstrapTenantRole) ||
      (args.profile === "full_managed" && args.bootstrapTenantRole)
    ) {
      throw new Error("Release canary tenant role is invalid");
    }
    const site = await ctx.db.get(args.siteId);
    if (!site || site.deletionStatus) throw new Error("Canary site is unavailable");

    let receiptHash: string;
    let observedAt: number;
    const sourceIds: Record<string, string | undefined> = {};

    const requirePublishedArticle = async () => {
      if (!args.articleId) throw new Error("Published article evidence is required");
      const article = await ctx.db.get(args.articleId);
      if (
        !article || article.siteId !== args.siteId || article.status !== "published" ||
        article.publicUrlStatus !== "verified" || !article.publicUrlVerifiedAt ||
        !article.publicationReceipt || article.publicationReceipt.status !== "published" ||
        article.publicationReceipt.url !== article.publicUrl ||
        article.publicationReceipt.contentHash !== article.publishedContentHash ||
        article.auditedContentHash !== article.publishedContentHash ||
        article.publicationGateStatus !== "passed"
      ) {
        throw new Error("Article lacks an exact sealed and live publication receipt");
      }
      sourceIds.articleId = String(article._id);
      return article;
    };

    if (args.kind.startsWith("publisher_")) {
      const article = await requirePublishedArticle();
      const expectedMethod = args.kind.slice("publisher_".length);
      if (article.publicationReceipt!.method !== expectedMethod) {
        throw new Error("Publisher canary does not match the settled adapter");
      }
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        articleId: String(article._id),
        publicationReceipt: article.publicationReceipt,
        publicUrlVerifiedAt: article.publicUrlVerifiedAt,
      }));
      observedAt = article.publicUrlVerifiedAt!;
    } else if (args.kind === "tenant_natural_loop") {
      const article = await requirePublishedArticle();
      if (!article.topicId || !args.promotionRunId) {
        throw new Error("Natural-loop canary requires topic and promotion-run evidence");
      }
      const [promotionRun, decisions] = await Promise.all([
        ctx.db.get(args.promotionRunId),
        ctx.db.query("opportunity_decision_receipts")
          .withIndex("by_site_evaluated", (q) => q.eq("siteId", args.siteId))
          .order("desc")
          .take(500),
      ]);
      const opportunity = decisions.find((decision) =>
        decision.topicId === article.topicId && decision.admitted &&
        decision.classification === "eligible" &&
        decision.evaluatedAt <= (article.publishedAt ?? article.publicUrlVerifiedAt!)
      );
      if (
        !promotionRun || promotionRun.siteId !== args.siteId ||
        promotionRun.trigger !== "automatic_live_promotion" ||
        promotionRun.status !== "completed" ||
        promotionRun.articleId !== article._id ||
        (promotionRun.sealedBufferCount ?? 0) < 2 ||
        !opportunity
      ) {
        throw new Error("Natural-loop source does not prove planning, sealed buffer, and publication");
      }
      sourceIds.promotionRunId = String(promotionRun._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        articleId: String(article._id),
        opportunityReceiptId: String(opportunity._id),
        opportunityInputHash: opportunity.inputHash,
        promotionRunId: String(promotionRun._id),
        sealedBufferCount: promotionRun.sealedBufferCount,
        publicationReceipt: article.publicationReceipt,
        publicUrlVerifiedAt: article.publicUrlVerifiedAt,
      }));
      observedAt = article.publicUrlVerifiedAt!;
    } else if (args.kind === "tenant_terminal_convergence") {
      if (!args.opportunityDecisionReceiptId) {
        throw new Error("Terminal opportunity decision evidence is required");
      }
      const decision = await ctx.db.get(args.opportunityDecisionReceiptId);
      if (
        !decision || decision.siteId !== args.siteId ||
        decision.classification !== "opportunity_space_exhausted" ||
        decision.admitted || !decision.inputHash ||
        !decision.automaticWakeAt ||
        decision.automaticWakeAt <= decision.evaluatedAt
      ) {
        throw new Error(
          "Terminal convergence lacks an exact exhausted-opportunity receipt",
        );
      }
      sourceIds.opportunityDecisionReceiptId = String(decision._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        decisionId: String(decision._id),
        classification: decision.classification,
        inputHash: decision.inputHash,
        evaluatedAt: decision.evaluatedAt,
        automaticWakeAt: decision.automaticWakeAt,
      }));
      observedAt = decision.evaluatedAt;
    } else if (args.kind === "measurement_decision") {
      if (!args.growthActionId) throw new Error("Growth action evidence is required");
      const action = await ctx.db.get(args.growthActionId);
      if (
        !action || action.siteId !== args.siteId ||
        !action.measurementKey || !action.measurementGscDataThrough ||
        !(action.automationStatus === "executed" || action.status === "resolved")
      ) {
        throw new Error("Growth action lacks an executed GSC-backed decision receipt");
      }
      const article = await ctx.db.get(action.articleId);
      if (
        !article || article.siteId !== args.siteId || article.status !== "published" ||
        article.publicUrlStatus !== "verified"
      ) {
        throw new Error("Measured growth action is not bound to a verified publication");
      }
      sourceIds.growthActionId = String(action._id);
      sourceIds.articleId = String(article._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        growthActionId: String(action._id),
        articleId: String(article._id),
        measurementKey: action.measurementKey,
        dataThrough: action.measurementGscDataThrough,
        actionKind: action.actionKind,
        automationStatus: action.automationStatus,
        status: action.status,
        automatedAt: action.automatedAt,
        resolvedAt: action.resolvedAt,
      }));
      observedAt = action.automatedAt ?? action.resolvedAt ?? action.lastObservedAt;
    } else if (args.kind === "smtp_connection") {
      if (!args.inboxId) throw new Error("SMTP inbox evidence is required");
      const inbox = await ctx.db.get(args.inboxId);
      const capability = inboundMonitoringCapability(inbox);
      if (
        !inbox || inbox.siteId !== args.siteId || inbox.provider !== "smtp" ||
        !inbox.verifiedAt || !capability.imapReady ||
        !["connected", "warming", "active"].includes(inbox.status)
      ) {
        throw new Error(
          "SMTP/IMAP connection lacks encrypted credentials and verified sockets",
        );
      }
      sourceIds.inboxId = String(inbox._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        inboxId: String(inbox._id),
        configurationVersion: inbox.configurationVersion,
        credentialKeyId: inbox.credentialKeyId,
        verifiedAt: inbox.verifiedAt,
        imapVerifiedAt: inbox.imapVerifiedAt,
      }));
      observedAt = Math.max(inbox.verifiedAt, inbox.imapVerifiedAt ?? 0);
    } else if (args.kind === "smtp_delivery") {
      if (!args.inboxId || !args.messageId) {
        throw new Error("SMTP delivery evidence is required");
      }
      const [inbox, message] = await Promise.all([
        ctx.db.get(args.inboxId),
        ctx.db.get(args.messageId),
      ]);
      if (
        !inbox || inbox.siteId !== args.siteId || inbox.provider !== "smtp" ||
        !message || message.siteId !== args.siteId ||
        message.inboxId !== inbox._id || message.deliveryTransport !== "smtp" ||
        message.controlledCanaryKind !== "smtp_delivery" ||
        message.controlledCanaryRole !== "primary" ||
        !message.controlledCanaryOperationKey ||
        !message.sentAt || !message.deliveryAttemptId ||
        !["sent", "delivery_reviewed_sent", "replied", "bounced"].includes(
          message.status,
        )
      ) throw new Error("SMTP message lacks an exact accepted-delivery receipt");
      sourceIds.inboxId = String(inbox._id);
      sourceIds.messageId = String(message._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        inboxId: String(inbox._id),
        messageId: String(message._id),
        attemptId: message.deliveryAttemptId,
        providerMessageIdDigest: message.inboundRelayOutboundMessageIdHash,
        sentAt: message.sentAt,
      }));
      observedAt = message.sentAt;
    } else if (["imap_reply", "imap_bounce", "imap_stop"].includes(args.kind)) {
      if (!args.inboxId || !args.messageId) {
        throw new Error("IMAP settlement evidence is required");
      }
      const [inbox, message] = await Promise.all([
        ctx.db.get(args.inboxId),
        ctx.db.get(args.messageId),
      ]);
      const expectedKind = args.kind === "imap_reply"
        ? "reply"
        : args.kind === "imap_bounce"
          ? "bounce"
          : "unsubscribe";
      if (
        !inbox || inbox.siteId !== args.siteId || inbox.provider !== "smtp" ||
        !message || message.siteId !== args.siteId ||
        message.inboxId !== inbox._id ||
        message.controlledCanaryKind !== args.kind ||
        message.controlledCanaryRole !== "primary" ||
        !message.controlledCanaryOperationKey ||
        message.inboundReceiptTransport !== "imap" ||
        message.inboundReceiptKind !== expectedKind ||
        !message.inboundReceiptHash || !message.inboundReceiptAt
      ) throw new Error("IMAP event lacks an exact tenant-bound receipt");
      sourceIds.inboxId = String(inbox._id);
      sourceIds.messageId = String(message._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        inboxId: String(inbox._id),
        messageId: String(message._id),
        evidenceHash: message.inboundReceiptHash,
        receivedAt: message.inboundReceiptAt,
      }));
      observedAt = message.inboundReceiptAt;
    } else if (args.kind === "smtp_followup_cancellation") {
      if (!args.messageId) throw new Error("Cancellation source message is required");
      const message = await ctx.db.get(args.messageId);
      if (
        !message || message.siteId !== args.siteId ||
        !message.controlledCanaryKind ||
        message.controlledCanaryRole !== "primary" ||
        message.inboundReceiptTransport !== "imap" ||
        !["reply", "bounce", "unsubscribe"].includes(
          message.inboundReceiptKind ?? "",
        )
      ) throw new Error("Cancellation source lacks a settled IMAP stop event");
      const children = await ctx.db.query("outreach_messages")
        .withIndex("by_site_status", (q) => q.eq("siteId", args.siteId))
        .take(500);
      const threadChildren = children.filter((row) =>
        row.threadKey === message.threadKey && row.sequenceStep > message.sequenceStep
      );
      if (
        threadChildren.some((row) =>
          ["draft", "approved", "sending", "sent"].includes(row.status)
        ) || !threadChildren.some((row) =>
          ["blocked", "skipped"].includes(row.status)
        )
      ) throw new Error("A pending follow-up survived the IMAP stop event");
      sourceIds.messageId = String(message._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        messageId: String(message._id),
        threadKey: message.threadKey,
        children: threadChildren.map((row) => ({
          id: String(row._id),
          step: row.sequenceStep,
          status: row.status,
          blockedReason: row.blockedReason,
        })),
      }));
      observedAt = Math.max(
        message.inboundReceiptAt ?? 0,
        ...threadChildren.map((row) => row.updatedAt),
      );
    } else if (args.kind === "controlled_conversion") {
      if (!args.outcomeReceiptId) {
        throw new Error("Controlled conversion receipt evidence is required");
      }
      const receipt = await ctx.db.get(args.outcomeReceiptId);
      if (
        !receipt || receipt.siteId !== args.siteId || !receipt.isCanary ||
        receipt.eventType !== "qualified_action"
      ) throw new Error("Outcome receipt is not an isolated conversion canary");
      sourceIds.outcomeReceiptId = String(receipt._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        outcomeReceiptId: String(receipt._id),
        articleId: String(receipt.articleId),
        eventId: receipt.eventId,
        occurredAt: receipt.occurredAt,
        receivedAt: receipt.receivedAt,
      }));
      observedAt = receipt.receivedAt;
    } else if (args.kind.startsWith("smartlead_")) {
      if (!args.managedResourceId) throw new Error("Smartlead resource evidence is required");
      const resource = await ctx.db.get(args.managedResourceId);
      if (
        !resource || resource.siteId !== args.siteId ||
        resource.transportKind !== "smartlead_managed" ||
        resource.lifecycleState !== "canonicalized" ||
        resource.releaseState !== "active" || !resource.canonicalInboxId
      ) {
        throw new Error("Smartlead resource is not the active canonical tenant generation");
      }
      sourceIds.managedResourceId = String(resource._id);
      if (args.kind === "smartlead_provisioning") {
        if (!resource.encryptedProviderBinding || !resource.resourceReceipt || !resource.externalVerifiedAt) {
          throw new Error("Smartlead provisioning lacks its exact provider binding receipt");
        }
        receiptHash = sha256Hex(JSON.stringify({
          kind: args.kind,
          siteId: String(args.siteId),
          resourceId: String(resource._id),
          operationKey: resource.operationKey,
          generation: resource.generation,
          resourceReceipt: resource.resourceReceipt,
          configurationHash: resource.configurationHash,
          externalVerifiedAt: resource.externalVerifiedAt,
        }));
        observedAt = resource.externalVerifiedAt;
      } else if (args.kind === "smartlead_warmup") {
        if (
          resource.warmupState !== "verified" || !resource.warmupStartedAt ||
          !resource.warmupEligibleAt || resource.warmupEligibleAt > Date.now() ||
          !resource.domainAuthenticationReceipt
        ) {
          throw new Error("Smartlead warm-up and domain authentication are not verified");
        }
        receiptHash = sha256Hex(JSON.stringify({
          kind: args.kind,
          siteId: String(args.siteId),
          resourceId: String(resource._id),
          generation: resource.generation,
          warmupStartedAt: resource.warmupStartedAt,
          warmupEligibleAt: resource.warmupEligibleAt,
          domainAuthenticationReceipt: resource.domainAuthenticationReceipt,
        }));
        observedAt = resource.warmupEligibleAt;
      } else {
        const field = args.kind === "smartlead_delivery"
          ? resource.deliveryCanaryReceipt
          : args.kind === "smartlead_reply"
            ? resource.replyCanaryReceipt
            : args.kind === "smartlead_bounce"
              ? resource.bounceCanaryReceipt
              : args.kind === "smartlead_unsubscribe"
                ? resource.unsubscribeCanaryReceipt
                : args.kind === "smartlead_cancellation"
                  ? resource.cancellationCanaryReceipt
                  : undefined;
        receiptHash = requireHash(field, args.kind);
        observedAt = resource.updatedAt;
      }
    } else if (args.kind === "acquired_backlink") {
      if (!args.opportunityId) throw new Error("Acquired opportunity evidence is required");
      const opportunity = await ctx.db.get(args.opportunityId);
      if (
        !opportunity || opportunity.siteId !== args.siteId ||
        opportunity.status !== "acquired" || !opportunity.acquiredAt ||
        !opportunity.acquiredLinkUrl || opportunity.lastCheckedAt < opportunity.acquiredAt
      ) {
        throw new Error("Opportunity lacks a live acquired-backlink receipt");
      }
      sourceIds.opportunityId = String(opportunity._id);
      receiptHash = sha256Hex(JSON.stringify({
        kind: args.kind,
        siteId: String(args.siteId),
        opportunityId: String(opportunity._id),
        evidenceHash: opportunity.evidenceHash,
        acquiredLinkUrl: opportunity.acquiredLinkUrl,
        acquiredAt: opportunity.acquiredAt,
        lastCheckedAt: opportunity.lastCheckedAt,
      }));
      observedAt = opportunity.lastCheckedAt;
    } else {
      throw new Error("Unsupported canary kind");
    }

    if (observedAt < args.deployedAt) {
      throw new Error("Canary evidence predates the bound production deployment");
    }

    const canaryKey = sha256Hex(JSON.stringify({
      releaseCommit: args.releaseCommit,
      profile: args.profile,
      deploymentReceiptHash: args.deploymentReceiptHash,
      deployedAt: args.deployedAt,
      bootstrapTenantRole: args.bootstrapTenantRole,
      siteId: String(args.siteId),
      kind: args.kind,
      ...sourceIds,
    }));
    const existing = await ctx.db.query("growth_loop_canary_receipts")
      .withIndex("by_canary_key", (q) => q.eq("canaryKey", canaryKey))
      .unique();
    if (existing) {
      const same = existing.releaseCommit === args.releaseCommit &&
        (existing.profile ?? "full_managed") === args.profile &&
        existing.deploymentReceiptHash === args.deploymentReceiptHash &&
        existing.deployedAt === args.deployedAt &&
        existing.bootstrapTenantRole === args.bootstrapTenantRole &&
        existing.siteId === args.siteId && existing.kind === args.kind &&
        existing.status === "passed" && existing.receiptHash === receiptHash &&
        existing.observedAt === observedAt;
      if (!same) throw new Error("Canary key already has a different immutable receipt");
      return existing._id;
    }
    const canaryId = await ctx.db.insert("growth_loop_canary_receipts", {
      releaseCommit: args.releaseCommit,
      profile: args.profile,
      deploymentReceiptHash: args.deploymentReceiptHash,
      deployedAt: args.deployedAt,
      bootstrapTenantRole: args.bootstrapTenantRole,
      siteId: args.siteId,
      canaryKey,
      kind: args.kind,
      articleId: args.articleId,
      opportunityId: args.opportunityId,
      growthActionId: args.growthActionId,
      opportunityDecisionReceiptId: args.opportunityDecisionReceiptId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      outcomeReceiptId: args.outcomeReceiptId,
      managedResourceId: args.managedResourceId,
      promotionRunId: args.promotionRunId,
      status: "passed",
      receiptHash,
      observedAt,
      createdAt: Date.now(),
    });
    // The final required source-bound canary starts the staged release in the
    // same transaction. Incomplete evidence remains a durable canary rather
    // than producing an operator-only recovery step.
    try {
      await startEligibleRollout(
        ctx,
        args.releaseCommit,
        args.profile,
        args.deploymentReceiptHash,
        args.deployedAt,
      );
    } catch {
      // Rollout diagnostics must never erase a valid immutable canary. The
      // 15-minute controller can re-evaluate once operational reads recover.
    }
    return canaryId;
  },
});

/**
 * The only GA stamping path. It derives acceptance exclusively from immutable
 * production canaries and refuses partial or self-reported evidence.
 */
export const createReleaseReceiptInternal = internalMutation({
  args: {
    releaseCommit: v.string(),
    profile: RELEASE_PROFILE,
    deploymentReceiptHash: v.string(),
    deployedAt: v.number(),
    adapterMatrixHash: v.string(),
    supportedMatrixHash: v.string(),
  },
  handler: async (ctx, args) => {
    if (!RELEASE_COMMIT_PATTERN.test(args.releaseCommit)) {
      throw new Error("Release commit must be a full immutable git commit");
    }
    if (!HASH_PATTERN.test(args.adapterMatrixHash)) {
      throw new Error("Adapter matrix must be an exact SHA-256 receipt");
    }
    requireHash(args.deploymentReceiptHash, "deployment receipt");
    requireHash(args.supportedMatrixHash, "supported matrix");
    if (!Number.isSafeInteger(args.deployedAt) || args.deployedAt <= 0) {
      throw new Error("Deployment timestamp is invalid");
    }
    const existing = await ctx.db.query("growth_loop_release_receipts")
      .withIndex("by_release_commit", (q) => q.eq("releaseCommit", args.releaseCommit))
      .unique();
    if (existing) {
      if (
        (existing.profile ?? "full_managed") !== args.profile ||
        existing.deploymentReceiptHash !== args.deploymentReceiptHash ||
        existing.deployedAt !== args.deployedAt ||
        existing.adapterMatrixHash !== args.adapterMatrixHash ||
        existing.supportedMatrixHash !== args.supportedMatrixHash
      ) {
        throw new Error("Release commit is already bound to a different GA receipt");
      }
      return existing;
    }
    const rolloutControl = await ctx.db.query("growth_loop_rollout_controls")
      .withIndex("by_release_commit", (q) =>
        q.eq("releaseCommit", args.releaseCommit))
      .unique();
    if (
      !rolloutControl || rolloutControl.status !== "complete" ||
      rolloutControl.targetPercent !== 100 || !rolloutControl.completedAt ||
      (rolloutControl.profile ?? "full_managed") !== args.profile ||
      rolloutControl.deploymentReceiptHash !== args.deploymentReceiptHash ||
      rolloutControl.deployedAt !== args.deployedAt
    ) throw new Error("GA receipt blocked: staged_rollout_incomplete");
    const canaries = await ctx.db.query("growth_loop_canary_receipts")
      .withIndex("by_release", (q) => q.eq("releaseCommit", args.releaseCommit))
      .take(101);
    if (canaries.length > 100) throw new Error("Release canary read limit exceeded");
    const timestamp = Date.now();
    const silentCutoff = timestamp - 15 * 60 * 1000;
    const [activeAlerts, runningJobs, runningRuns, leasedResources, sendingMessages, enrolledSites] =
      await Promise.all([
        ctx.db.query("autopilot_alerts")
          .withIndex("by_status_created", (q) => q.eq("status", "active"))
          .take(501),
        ctx.db.query("jobs")
          .withIndex("by_status_heartbeat", (q) => q.eq("status", "running"))
          .take(101),
        ctx.db.query("autopilot_runs")
          .withIndex("by_status_heartbeat", (q) => q.eq("status", "running"))
          .take(101),
        ctx.db.query("managed_outreach_mailbox_resources")
          .withIndex("by_lifecycle_lease", (q) => q.eq("lifecycleState", "leased"))
          .take(101),
        ctx.db.query("outreach_messages")
          .withIndex("by_status_lease", (q) => q.eq("status", "sending"))
          .take(101),
        ctx.db.query("sites")
          .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
          .take(501),
      ]);
    if (
      activeAlerts.length > 500 || runningJobs.length > 100 ||
      runningRuns.length > 100 || leasedResources.length > 100 ||
      sendingMessages.length > 100 || enrolledSites.length > 500
    ) {
      throw new Error("GA operational evidence read limit exceeded");
    }
    const severeIncidentPattern =
      /(failed|unverified|conflict|stale|operator_action|required|regressed|cross_tenant|duplicate_external|suppression)/;
    const unresolvedSevereIncidentCount = activeAlerts.filter((alert) =>
      severeIncidentPattern.test(alert.kind)
    ).length;
    const silentStateCount =
      runningJobs.filter((job) => (job.heartbeatAt ?? job.updatedAt) <= silentCutoff).length +
      runningRuns.filter((run) => run.heartbeatAt <= silentCutoff).length +
      leasedResources.filter((resource) =>
        !resource.leaseExpiresAt || resource.leaseExpiresAt <= timestamp
      ).length +
      sendingMessages.filter((message) =>
        !message.deliveryLeaseExpiresAt || message.deliveryLeaseExpiresAt <= timestamp
      ).length;
    const passed = canaries.filter((canary) =>
      canary.status === "passed" &&
      (canary.profile ?? "full_managed") === args.profile &&
      canary.deploymentReceiptHash === args.deploymentReceiptHash &&
      canary.deployedAt === args.deployedAt
    );
    const kinds = new Set(passed.map((canary) => canary.kind));
    const tenantCanaries = passed.filter((canary) => canary.kind === "tenant_natural_loop" && canary.siteId);
    const terminalTenantCanaries = passed.filter((canary) =>
      canary.kind === "tenant_terminal_convergence" && canary.siteId
    );
    const tenantSiteIds = new Set([
      ...tenantCanaries.map((canary) => String(canary.siteId)),
      ...terminalTenantCanaries.map((canary) => String(canary.siteId)),
    ]);
    const primaryNaturalCanaries = tenantCanaries.filter((canary) =>
      canary.bootstrapTenantRole === "primary_natural"
    );
    const secondaryCanaries = passed.filter((canary) =>
      canary.bootstrapTenantRole === "secondary_convergence" &&
      ["tenant_natural_loop", "tenant_terminal_convergence"].includes(canary.kind) &&
      canary.siteId
    );
    const eligibleSites = enrolledSites.filter((site) =>
      !site.deletionStatus && !site.planParkedAt &&
      (site.cadencePerWeek ?? 0) > 0 &&
      (args.profile === "bootstrap_v1"
        ? tenantSiteIds.has(String(site._id))
        : true)
    );
    const terminalSiteIds = new Set(
      terminalTenantCanaries.map((canary) => String(canary.siteId)),
    );
    const liveEligibleSites = eligibleSites.filter((site) =>
      site.autopilotRolloutMode === "live" ||
      (args.profile === "bootstrap_v1" && terminalSiteIds.has(String(site._id)))
    );
    const rolloutPercent = eligibleSites.length === 0
      ? 0
      : Math.floor((100 * liveEligibleSites.length) / eligibleSites.length);
    const publisherRows = passed.filter((canary) =>
      canary.kind.startsWith("publisher_") &&
      canary.siteId && tenantSiteIds.has(String(canary.siteId))
    );
    const publisherKinds = new Set(publisherRows.map((row) => row.kind));
    const naturalTenantSiteIds = new Set(
      tenantCanaries.map((canary) => String(canary.siteId)),
    );
    const everyTenantHasPublisherProof = [...naturalTenantSiteIds].every((siteId) =>
      publisherRows.some((row) => String(row.siteId) === siteId)
    );
    const smartleadRows = passed.filter((canary) => canary.kind.startsWith("smartlead_"));
    const smartleadResourceIds = new Set(smartleadRows.map((row) => String(row.managedResourceId)));
    const smartleadCoherent = smartleadResourceIds.size === 1 && !smartleadResourceIds.has("undefined");
    const bootstrap = args.profile === "bootstrap_v1";
    const evidence = {
      profile: args.profile,
      releaseCommit: args.releaseCommit,
      publisherCanaries: (["github", "wordpress", "webhook"] as PublisherKind[])
        .filter((kind) => publisherKinds.has(`publisher_${kind}` as typeof passed[number]["kind"])),
      tenantCanaryIds: [...tenantSiteIds],
      unrelatedTenantCount: tenantSiteIds.size,
      naturalPlanningVerified: bootstrap
        ? primaryNaturalCanaries.length >= 1 && everyTenantHasPublisherProof
        : tenantCanaries.length >= 3 && everyTenantHasPublisherProof,
      sealedBufferVerified: bootstrap
        ? primaryNaturalCanaries.length >= 1 && everyTenantHasPublisherProof
        : tenantCanaries.length >= 3 && everyTenantHasPublisherProof,
      publicationVerified: bootstrap
        ? primaryNaturalCanaries.length >= 1 && everyTenantHasPublisherProof
        : tenantCanaries.length >= 3 && everyTenantHasPublisherProof,
      measurementDecisionExecuted: kinds.has("measurement_decision"),
      smartleadProvisioningVerified: smartleadCoherent && kinds.has("smartlead_provisioning"),
      smartleadWarmupVerified: smartleadCoherent && kinds.has("smartlead_warmup"),
      smartleadDeliveryVerified: smartleadCoherent && kinds.has("smartlead_delivery"),
      smartleadReplyVerified: smartleadCoherent && kinds.has("smartlead_reply"),
      smartleadBounceVerified: smartleadCoherent && kinds.has("smartlead_bounce"),
      smartleadUnsubscribeVerified: smartleadCoherent && kinds.has("smartlead_unsubscribe"),
      smartleadCancellationVerified: smartleadCoherent && kinds.has("smartlead_cancellation"),
      terminalConvergenceVerified:
        secondaryCanaries.length >= 1,
      smtpConnectionVerified: kinds.has("smtp_connection"),
      smtpDeliveryVerified: kinds.has("smtp_delivery"),
      imapReplyVerified: kinds.has("imap_reply"),
      imapBounceVerified: kinds.has("imap_bounce"),
      imapStopVerified: kinds.has("imap_stop"),
      smtpFollowupCancellationVerified:
        kinds.has("smtp_followup_cancellation"),
      controlledConversionVerified: kinds.has("controlled_conversion"),
      acquiredBacklinkVerified: kinds.has("acquired_backlink"),
      unresolvedSevereIncidentCount,
      silentStateCount,
    };
    const blockers = growthLoopReleaseBlockers(evidence);
    if (rolloutPercent !== 100) blockers.push("rollout_not_100_percent");
    if (blockers.length) throw new Error(`GA receipt blocked: ${blockers.join(",")}`);
    const publisherHashes = passed.filter((row) => row.kind.startsWith("publisher_")).map((row) => row.receiptHash);
    const tenantHashes = tenantCanaries.map((row) => row.receiptHash);
    const smartleadHashes = passed.filter((row) => row.kind.startsWith("smartlead_")).map((row) => row.receiptHash);
    const acquired = passed.find((row) => row.kind === "acquired_backlink")!;
    const receiptId = await ctx.db.insert("growth_loop_release_receipts", {
      releaseCommit: args.releaseCommit,
      profile: args.profile,
      deploymentReceiptHash: args.deploymentReceiptHash,
      deployedAt: args.deployedAt,
      adapterMatrixHash: args.adapterMatrixHash,
      supportedMatrixHash: args.supportedMatrixHash,
      publisherCanaryReceiptHashes: publisherHashes,
      tenantCanaryReceiptHashes: [
        ...tenantHashes,
        ...terminalTenantCanaries.map((row) => row.receiptHash),
      ],
      smartleadCanaryReceiptHashes: smartleadHashes,
      customerManagedCanaryReceiptHashes: passed.filter((row) => [
        "smtp_connection",
        "smtp_delivery",
        "imap_reply",
        "imap_bounce",
        "imap_stop",
        "smtp_followup_cancellation",
      ].includes(row.kind)).map((row) => row.receiptHash),
      acquiredBacklinkReceiptHash: acquired.receiptHash,
      rolloutPercent,
      contractVersion: GROWTH_LOOP_RELEASE_VERSION,
      acceptedAt: timestamp,
      createdAt: timestamp,
    });
    return ctx.db.get(receiptId);
  },
});

export const getLatestRelease = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db.query("growth_loop_release_receipts").order("desc").first();
  },
});
