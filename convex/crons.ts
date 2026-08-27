import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Autopilot runs 8x daily (every 3 hours) to support higher-tier cadences.
// Scale plan needs ~2/day, Enterprise needs ~5/day. Each run processes 1 article
// per eligible site. The scheduler enforces per-site cadence timing.
crons.daily("autopilot-1", { hourUTC: 0, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "00:00" });
crons.daily("autopilot-2", { hourUTC: 3, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "03:00" });
crons.daily("autopilot-3", { hourUTC: 6, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "06:00" });
crons.daily("autopilot-4", { hourUTC: 9, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "09:00" });
crons.daily("autopilot-5", { hourUTC: 12, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "12:00" });
crons.daily("autopilot-6", { hourUTC: 15, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "15:00" });
crons.daily("autopilot-7", { hourUTC: 18, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "18:00" });
crons.daily("autopilot-8", { hourUTC: 21, minuteUTC: 0 }, internal.autopilot.dispatchActiveSites, { trigger: "natural", cronSlotUTC: "21:00" });

// Durable watchdog: detects scheduler silence and a missed quality-published
// cadence independently of the generation pipeline itself.
crons.interval("autopilot-sla-watchdog", { hours: 1 }, internal.autopilot.auditSla);
crons.interval(
  "growth-loop-ga-rollout-start",
  { minutes: 15 },
  internal.growthLoop.ensureEligibleRolloutInternal,
  {},
);
crons.interval(
  "growth-loop-ga-rollout",
  { minutes: 15 },
  internal.growthLoop.advanceRolloutInternal,
  {},
);
crons.interval(
  "plan-entitlement-reconciliation-recovery",
  { minutes: 5 },
  internal.sites.recoverStalePlanFeatureSyncsInternal,
  {},
);
crons.interval(
  "account-deletion-recovery",
  { minutes: 5 },
  internal.sites.recoverAccountDeletionsInternal,
  {},
);
// Exact per-request wakes are primary. This bounded tenant-generic pass
// recovers scheduler silence, expired leases, and additive v1 setup requests.
crons.interval(
  "managed-provisioning-recovery",
  { minutes: 5 },
  internal.managedProvisioning.dispatchFleet,
  {},
);
// The legacy body-to-summary migration is intentionally not cron-driven.
// While the shared account is constrained, an operator must run the bounded
// migration once and verify its completion marker before enabling a canary.
crons.daily("autopilot-lifecycle-prune", { hourUTC: 1, minuteUTC: 30 }, internal.autopilot.pruneLifecycle);

// The legacy expected-click portfolio advances once per day after GSC sync.
// Each tenant runs demand first; only fleet-origin demand completion (or a
// proven no-demand state) chains evidence. A separate receipt-safe recovery
// sweep never creates a new reservation or touches operator-origin jobs.
crons.daily(
  "expected-click-backfill-fleet",
  { hourUTC: 13, minuteUTC: 15 },
  internal.actions.expectedClickBackfillFleet.dispatchFleet,
  {},
);
crons.interval(
  "expected-click-backfill-recovery",
  { hours: 1 },
  internal.actions.expectedClickBackfillFleet.dispatchRecoveryFleet,
  {},
);

// Empty-buffer rescue is tenant-generic and entitlement-gated. The fleet pass
// is provider-free unless an exact site has exhausted its ordinary two-step
// plan, has no usable inventory or active work, and can atomically reserve the
// two bounded $0.10 phases. Per-site mutations retain the one-shot authority.
crons.interval(
  "cadence-micro-seed-fleet",
  { minutes: 15 },
  internal.actions.cadenceMicroSeed.dispatchCadenceMicroSeedFleet,
  {},
);

// Search outcomes are a tenant capability, not a single-site-only canary. The
// action paginates enabled sites and isolates per-site failures so one expired
// credential cannot suppress every other customer's measurement loop.
crons.daily(
  "all-sites-gsc-sync",
  { hourUTC: 12, minuteUTC: 30 },
  internal.actions.gscSync.syncAllSites,
  {},
);

// Classification starts after the daily GSC sync window. It is deliberately
// independent of publishing: paused tenants still get measured, while one
// broken tenant is isolated in its own scheduled action.
crons.daily(
  "all-sites-seo-growth",
  { hourUTC: 13, minuteUTC: 30 },
  internal.actions.seoGrowth.scanAllSites,
  {},
);

// Receipt-only recovery. This never publishes or retries an external write;
// it only resumes exact live verification for already acknowledged revisions.
crons.interval(
  "published-revision-verification-recovery",
  { minutes: 15 },
  internal.publisher.recoverPublishedRevisionVerifications,
  {},
);

// Authority maintenance consumes only opportunities already verified by a
// tenant-scoped growth scan. It prepares reviewable drafts and re-checks exact
// link receipts; it never performs global discovery or sends email.
crons.daily(
  "outreach-maintenance-fleet",
  { hourUTC: 14, minuteUTC: 30 },
  internal.actions.outreachFleet.dispatchFleet,
  { phase: "maintenance" },
);

// One due message per eligible tenant per pass. The fleet state is only a
// scheduling hint; the action and serializable claim revalidate the exact
// tenant consent, live evidence, sender DNS, relay, suppression and pacing.
crons.interval(
  "outreach-autonomous-delivery-fleet",
  { minutes: 15 },
  internal.actions.outreachFleet.dispatchFleet,
  { phase: "delivery" },
);

// Reply/bounce monitoring is independent of outbound delivery. It reads only
// dedicated outreach inboxes through either bounded customer-managed IMAP or
// the legacy isolated Gmail read scope. It stores no inbound body and applies
// durable tenant suppressions.
crons.interval(
  "outreach-inbound-fleet",
  { minutes: 15 },
  internal.actions.outreachFleet.dispatchFleet,
  { phase: "inbound" },
);

// Global sender-domain reputation is retained only for its documented safety
// window; the mutation paginates so cleanup cannot create an unbounded cron.
crons.daily(
  "outreach-sender-reputation-prune",
  { hourUTC: 2, minuteUTC: 15 },
  internal.outreach.pruneExpiredSenderPacingReceiptsInternal,
  {},
);

export default crons;
