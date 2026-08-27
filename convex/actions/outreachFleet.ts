"use node";

import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server.js";
import { v } from "convex/values";
import type {
  PrepareResult,
  InboundSyncResult,
  SendResult,
  VerifyResult,
} from "./outreach";

export type OutreachFleetPhase = "maintenance" | "inbound" | "delivery";

export type OutreachFleetSiteState = {
  siteId: string;
  autopilotEnabled: boolean;
  autopilotRolloutMode?: string;
  inboxConfigurationValid: boolean;
  hasInbox: boolean;
  inboxProvider?: string;
  inboxStatus?: string;
  inboxMode?: string;
  inboxVerified: boolean;
  inboxOwnerCurrent?: boolean;
  outboundTransportReady?: boolean;
  autonomyConsentActive?: boolean;
  autonomyDurabilityMigrationPending?: boolean;
  autonomyReconciliationPending?: boolean;
  hasVerifiedOpportunities: boolean;
  hasApprovedMessages: boolean;
  hasDueAutomaticMessages?: boolean;
  hasLinksToVerify: boolean;
  inboundMonitoringReady?: boolean;
  inboundMonitoringMode?: "imap" | "signed_relay" | "legacy_gmail" | "unavailable";
  hasMessagesToMonitor?: boolean;
};

export type OutreachFleetPlan = {
  prepare: boolean;
  deliver: boolean;
  verify: boolean;
  monitor?: boolean;
  bootstrapDurability?: boolean;
  failClosedReason?: string;
};

const CONNECTED_INBOX_STATUSES = new Set(["connected", "warming", "active"]);
/**
 * Fleet automation prepares drafts, delivers one consent-authorized due
 * message, verifies links, and reads bounded inbound receipts. Every delivery
 * still crosses the tenant-scoped atomic claim and its live evidence gates.
 */
export function planOutreachFleetSite(
  state: OutreachFleetSiteState,
  phase: OutreachFleetPhase,
): OutreachFleetPlan {
  // These are explicit server-side receipts, not provider-name inference.
  // Missing projections fail closed for every transport.
  const inboxOwnerCurrent = state.inboxOwnerCurrent === true;
  const outboundTransportReady = state.outboundTransportReady === true;
  if (!state.inboxConfigurationValid) {
    return {
      prepare: false,
      deliver: false,
      verify: false,
      failClosedReason: "Multiple outreach inboxes exist for this tenant.",
    };
  }

  if (phase === "maintenance") {
    const bootstrapDurability =
      state.autonomyDurabilityMigrationPending === true;
    return {
      prepare:
        !bootstrapDurability &&
        state.autopilotEnabled &&
        ["warm", "live"].includes(state.autopilotRolloutMode ?? "observe") &&
        (state.hasVerifiedOpportunities ||
          state.autonomyReconciliationPending === true) &&
        state.hasInbox &&
        inboxOwnerCurrent &&
        CONNECTED_INBOX_STATUSES.has(state.inboxStatus ?? ""),
      deliver: false,
      // Link receipts remain truthful even if the tenant later disconnects
      // its sending inbox.
      verify: state.hasLinksToVerify,
      ...(bootstrapDurability ? { bootstrapDurability: true } : {}),
    };
  }

  if (phase === "inbound") {
    if (state.inboundMonitoringMode === "signed_relay") {
      return {
        prepare: false,
        deliver: false,
        verify: false,
        monitor: false,
      };
    }
    return {
      prepare: false,
      deliver: false,
      verify: false,
      monitor:
        ["imap", "legacy_gmail"].includes(
          state.inboundMonitoringMode ?? "unavailable",
        ) &&
        state.inboundMonitoringReady === true &&
        state.hasMessagesToMonitor === true,
      ...(state.inboundMonitoringReady === true
        ? {}
        : {
            failClosedReason:
              "Configure IMAP, the signed inbound relay, or retain the legacy Gmail monitoring grant.",
          }),
    };
  }

  if (state.autonomyDurabilityMigrationPending === true) {
    return {
      prepare: false,
      deliver: false,
      verify: false,
      bootstrapDurability: true,
    };
  }

  const deliveryReady = Boolean(
    state.autopilotEnabled &&
      ["warm", "live"].includes(
        state.autopilotRolloutMode ?? "observe",
      ) &&
      state.hasInbox &&
      outboundTransportReady &&
      ["warming", "active"].includes(state.inboxStatus ?? "") &&
      state.inboxVerified &&
      inboxOwnerCurrent &&
      state.inboxMode === "live" &&
      state.autonomyConsentActive === true &&
      state.inboundMonitoringReady === true &&
      state.inboundMonitoringMode === "signed_relay" &&
      state.hasDueAutomaticMessages === true,
  );
  return {
    prepare: false,
    deliver: deliveryReady,
    verify: false,
    ...(deliveryReady
      ? {}
      : {
          failClosedReason:
            "No due message has a current tenant autonomy, sender, relay, and rollout authorization.",
        }),
  };
}

type StageRecord<Result> = {
  status: "not_applicable" | "completed" | "fail_closed" | "failed";
  attemptedAt?: number;
  completedAt?: number;
  failed: number;
  detail?: string;
  result?: Result;
};

type SiteRunResult = {
  siteId: Id<"sites">;
  phase: OutreachFleetPhase;
  prepare: StageRecord<PrepareResult>;
  delivery: StageRecord<SendResult>;
  verification: StageRecord<VerifyResult>;
  monitoring: StageRecord<InboundSyncResult>;
};

function notApplicable(detail: string): StageRecord<never> {
  return { status: "not_applicable", failed: 0, detail };
}

async function runStage<Result>(args: {
  siteId: Id<"sites">;
  phase: OutreachFleetPhase;
  stage: string;
  execute: () => Promise<Result>;
}): Promise<StageRecord<Result>> {
  const attemptedAt = Date.now();
  try {
    const result = await args.execute();
    return {
      status: "completed",
      attemptedAt,
      completedAt: Date.now(),
      failed: 0,
      result,
    };
  } catch {
    // Never log provider responses or credential-bearing errors. The durable
    // underlying actions record per-message failures where appropriate.
    console.error(
      `[outreach-fleet] ${args.phase}/${args.stage} failed for tenant ${args.siteId}`,
    );
    return {
      status: "failed",
      attemptedAt,
      completedAt: Date.now(),
      failed: 1,
      detail: "The tenant-scoped stage failed closed.",
    };
  }
}

const phaseValidator = v.union(
  v.literal("maintenance"),
  v.literal("inbound"),
  v.literal("delivery"),
);

/**
 * Paginate every tenant, but schedule each eligible tenant as an independent
 * action. One provider failure therefore cannot abort another tenant or the
 * continuation page. This dispatcher never invokes authority discovery.
 */
export const dispatchFleet = internalAction({
  args: {
    phase: phaseValidator,
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { phase, cursor }): Promise<{
    scheduled: number;
    skipped: number;
    failed: number;
    scheduledNext: boolean;
  }> => {
    const page = phase === "inbound"
      ? await ctx.runQuery(internal.outreach.listLegacyInboundFleetPage, {
          cursor,
        })
      : await ctx.runQuery(internal.sites.listOutreachFleetPage, { cursor });
    let scheduled = 0;
    let skipped = 0;
    let failed = 0;
    for (const state of page.page) {
      const plan = planOutreachFleetSite(state, phase);
      if (
        !plan.prepare &&
        !plan.deliver &&
        !plan.verify &&
        !plan.monitor &&
        !plan.bootstrapDurability
      ) {
        skipped++;
        continue;
      }
      try {
        await ctx.scheduler.runAfter(
          scheduled * 200,
          internal.actions.outreachFleet.runSite,
          { siteId: state.siteId, phase },
        );
        scheduled++;
      } catch {
        failed++;
        console.error(
          `[outreach-fleet] scheduling failed for tenant ${state.siteId}`,
        );
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        Math.max(1_000, scheduled * 200),
        internal.actions.outreachFleet.dispatchFleet,
        { phase, cursor: page.continueCursor },
      );
    }
    return { scheduled, skipped, failed, scheduledNext: !page.isDone };
  },
});

/**
 * Run only the stages authorized by a fresh tenant-scoped readiness snapshot.
 * Each stage catches its own failure so link verification still runs when
 * draft preparation fails, and vice versa.
 */
export const runSite = internalAction({
  args: {
    siteId: v.id("sites"),
    phase: phaseValidator,
  },
  handler: async (ctx, { siteId, phase }): Promise<SiteRunResult> => {
    let state: OutreachFleetSiteState | null;
    try {
      state = phase === "inbound"
        ? await ctx.runQuery(internal.outreach.getLegacyInboundFleetState, {
            siteId,
          })
        : await ctx.runQuery(internal.sites.getOutreachFleetState, { siteId });
    } catch {
      console.error(
        `[outreach-fleet] readiness lookup failed for tenant ${siteId}`,
      );
      const failed: StageRecord<never> = {
        status: "failed",
        attemptedAt: Date.now(),
        completedAt: Date.now(),
        failed: 1,
        detail: "Tenant readiness could not be verified.",
      };
      return {
        siteId,
        phase,
        prepare: failed,
        delivery: failed,
        verification: failed,
        monitoring: failed,
      };
    }
    if (!state) {
      const missing = notApplicable("Tenant no longer exists.");
      return {
        siteId,
        phase,
        prepare: missing,
        delivery: missing,
        verification: missing,
        monitoring: missing,
      };
    }

    const plan = planOutreachFleetSite(state, phase);
    if (plan.bootstrapDurability) {
      try {
        // This mutation only creates/resumes the account compliance backfill.
        // It neither fetches recipient pages nor crosses a mail provider.
        await ctx.runMutation(
          internal.outreach.ensureOutreachDurabilityMigrationInternal,
          { siteId },
        );
      } catch {
        console.error(
          `[outreach-fleet] ${phase}/durability-bootstrap failed for tenant ${siteId}`,
        );
      }
    }
    let prepare: StageRecord<PrepareResult> = notApplicable(
      plan.failClosedReason ?? "No verified opportunity is ready for drafting.",
    );
    let delivery: StageRecord<SendResult> = notApplicable(
      plan.failClosedReason ?? "No approved message is ready for automatic delivery.",
    );
    let verification: StageRecord<VerifyResult> = notApplicable(
      plan.failClosedReason ?? "No contacted or acquired link needs verification.",
    );
    let monitoring: StageRecord<InboundSyncResult> = notApplicable(
      plan.failClosedReason ?? "No delivered outreach needs inbound monitoring.",
    );

    if (plan.prepare) {
      // The fleet page and initial site snapshot are only scheduling hints.
      // Re-read rollout state immediately before the external contact crawl,
      // so a tenant paused in the meantime cannot start new outreach work.
      let freshState: OutreachFleetSiteState | null = null;
      try {
        freshState = await ctx.runQuery(internal.sites.getOutreachFleetState, {
          siteId,
        });
      } catch {
        prepare = {
          status: "failed",
          attemptedAt: Date.now(),
          completedAt: Date.now(),
          failed: 1,
          detail: "Tenant rollout readiness could not be reverified.",
        };
      }
      const freshPlan = freshState
        ? planOutreachFleetSite(freshState, phase)
        : null;
      if (freshState && !freshPlan?.prepare) {
        prepare = notApplicable(
          "Autonomous outreach preparation is disabled for this tenant rollout.",
        );
      } else if (freshPlan?.prepare) {
        prepare = await runStage({
          siteId,
          phase,
          stage: "prepare",
          execute: () => ctx.runAction(
            internal.actions.outreach.prepareOutreachInternal,
            { siteId, limit: 25 },
          ),
        });
      }
    }
    if (plan.deliver) {
      // Re-read immediately before any live DNS/page fetch. The mutation claim
      // rechecks again after those reads and before Gmail is called.
      let freshState: OutreachFleetSiteState | null = null;
      try {
        freshState = await ctx.runQuery(internal.sites.getOutreachFleetState, {
          siteId,
        });
      } catch {
        delivery = {
          status: "failed",
          attemptedAt: Date.now(),
          completedAt: Date.now(),
          failed: 1,
          detail: "Tenant autonomy readiness could not be reverified.",
        };
      }
      const freshPlan = freshState
        ? planOutreachFleetSite(freshState, phase)
        : null;
      if (freshState && !freshPlan?.deliver) {
        delivery = notApplicable(
          "Authority autopilot was disabled or became unready before delivery.",
        );
      } else if (freshPlan?.deliver) {
        delivery = await runStage({
          siteId,
          phase,
          stage: "delivery",
          execute: () => ctx.runAction(
            internal.actions.outreach.sendAutomaticOutreachInternal,
            { siteId },
          ),
        });
      }
    }
    if (plan.verify) {
      verification = await runStage({
        siteId,
        phase,
        stage: "verification",
        execute: () => ctx.runAction(
          internal.actions.outreach.verifyAcquiredLinksInternal,
          { siteId, limit: 50 },
        ),
      });
    }
    if (plan.monitor) {
      monitoring = await runStage({
        siteId,
        phase,
        stage: "inbound",
        execute: () => ctx.runAction(
          state.inboundMonitoringMode === "imap"
            ? internal.actions.outreach.syncImapInboxInternal
            : internal.actions.outreach.syncInboundRepliesInternal,
          { siteId },
        ),
      });
    }

    const result = { siteId, phase, prepare, delivery, verification, monitoring };
    // Result reasons can contain prospect domains or addresses. Central logs
    // receive only stable stage/count metadata, never recipient evidence.
    const numericCounts = (value: unknown) => {
      if (!value || typeof value !== "object") return undefined;
      const row = value as Record<string, unknown>;
      return Object.fromEntries(
        ["considered", "drafted", "blocked", "skipped", "sent", "failed"]
          .filter((key) => typeof row[key] === "number")
          .map((key) => [key, row[key]]),
      );
    };
    console.log("[outreach-fleet] tenant run", JSON.stringify({
      siteId,
      phase,
      stages: {
        prepare: numericCounts(prepare),
        delivery: numericCounts(delivery),
        verification: numericCounts(verification),
        monitoring: numericCounts(monitoring),
      },
    }));
    return result;
  },
});
