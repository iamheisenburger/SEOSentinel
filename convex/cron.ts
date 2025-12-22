import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Autopilot runs 4x daily to ensure 4 articles/week get processed.
// Each run processes 1 article to avoid timeout issues with long-form content.
crons.daily("autopilot-1", { hourUTC: 3, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-2", { hourUTC: 9, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-3", { hourUTC: 15, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);
crons.daily("autopilot-4", { hourUTC: 21, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);

export default crons;

