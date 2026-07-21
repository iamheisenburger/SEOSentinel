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

// Non-canary fleet scans remain disabled while the shared account is over its
// database-I/O allowance. GSC sync is owner-triggered only; decay, refresh,
// and relinking require a separately reviewed bounded rollout before any cron
// may be restored.

export default crons;
