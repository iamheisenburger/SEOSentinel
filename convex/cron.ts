import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Daily autopilot tick to keep onboarding/plan/drafts flowing.
// Runs twice a day to spread the load; cadence remains 4/week via scheduler.
crons.daily("autopilot-morning", { hourUTC: 5, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);

crons.daily("autopilot-evening", { hourUTC: 17, minuteUTC: 0 }, api.actions.pipeline.autopilotCron);

export default crons;

