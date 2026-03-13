import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Autopilot runs 8x daily (every 3 hours) to support higher-tier cadences.
// Scale plan needs ~2/day, Enterprise needs ~5/day. Each run processes 1 article
// per eligible site. The scheduler enforces per-site cadence timing.
crons.daily("autopilot-1", { hourUTC: 0, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-2", { hourUTC: 3, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-3", { hourUTC: 6, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-4", { hourUTC: 9, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-5", { hourUTC: 12, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-6", { hourUTC: 15, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-7", { hourUTC: 18, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-8", { hourUTC: 21, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);

// Monthly re-linking: update internal links on all published articles (1st of each month at 6am UTC)
crons.monthly("relink-articles", { day: 1, hourUTC: 6, minuteUTC: 0 }, api.actions.pipeline.relinkAllArticles);

// Daily GSC sync: pull search performance data for all connected sites (2am UTC — after GSC data updates)
crons.daily("gsc-sync", { hourUTC: 2, minuteUTC: 0 }, api.actions.gscSync.syncAllSites);

// Daily content decay scan: detect declining articles using GSC data (3am UTC — after GSC sync)
crons.daily("decay-scan", { hourUTC: 3, minuteUTC: 0 }, api.actions.contentDecay.scanAllSites);

export default crons;

