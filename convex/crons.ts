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
// The legacy body-to-summary migration is intentionally not cron-driven.
// While the shared account is constrained, an operator must run the bounded
// migration once and verify its completion marker before enabling a canary.
crons.daily("autopilot-lifecycle-prune", { hourUTC: 1, minuteUTC: 30 }, internal.autopilot.pruneLifecycle);

// Search outcomes are a tenant capability, not a LeadPilot-only canary. The
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

export default crons;
