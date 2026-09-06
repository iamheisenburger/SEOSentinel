import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

const bundled = buildSync({ stdin: {
  contents: `${readFileSync("convex/actions/pipeline.ts", "utf8")}\nexport { continueAutopilotAfterProcessedJob };`,
  resolveDir: `${process.cwd()}/convex/actions`, sourcefile: "pipeline.ts", loader: "ts",
}, bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
function fixture(siteId: string, schedule: Row) {
  const runtime = { exports: {} as { continueAutopilotAfterProcessedJob: (ctx: unknown, siteId: string, processed: Row) => Promise<void> } };
  runInNewContext(bundled, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, Buffer, TextEncoder, TextDecoder,
    console, process: { env: {} },
  });
  const dispatches: Row[] = [];
  const ctx = {
    async runAction(ref: Parameters<typeof getFunctionName>[0], args: Row) {
      assert.equal(getFunctionName(ref), "actions/scheduler:scheduleCadence");
      assert.equal(args.siteId, siteId);
      return schedule;
    },
    async runMutation(ref: Parameters<typeof getFunctionName>[0], args: Row) {
      assert.equal(getFunctionName(ref), "autopilot:dispatchSiteFollowup");
      assert.equal(args.siteId, siteId);
      dispatches.push(structuredClone(args));
    },
  };
  return { dispatches, run: (processed: Row) => runtime.exports.continueAutopilotAfterProcessedJob(ctx, siteId, processed) };
}

test("actual terminal article continuation immediately dispatches each admitted topic-plan mode", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const mode of ["topic_replenishment", "topic_portfolio_goal_replenishment", "topic_portfolio_evidence_replenishment"]) {
      for (const outcome of ["buffered", "planCompleted", "planContinuationSettled", "qualityQuarantined", "publicationSucceeded"]) {
        const f = fixture(siteId, { scheduled: 1, mode, planJobId: "admitted-job" });
        await f.run({ processed: true, [outcome]: true });
        assert.equal(f.dispatches.length, 1, `${mode} after ${outcome}`);
        assert.equal(f.dispatches[0].trigger, "plan_ready");
      }
    }
  }
});

test("actual continuation cannot bypass a denied or unrecognized scheduler result", async () => {
  for (const schedule of [
    { scheduled: 0, mode: "topic_replenishment" },
    { scheduled: 0, mode: "topic_replenishment_exhausted" },
    { scheduled: 0, mode: "cadence_failure_cooldown" },
    { scheduled: 0, mode: "planning_blocked" },
    { scheduled: 1, mode: "unexpected_mode" },
    // Micro-seed continuation owns its separate evidence wake; no duplicate.
    { scheduled: 1, mode: "cadence_micro_seed_continuation" },
  ]) {
    const f = fixture("tenant", schedule);
    await f.run({ processed: true, qualityQuarantined: true });
    assert.equal(f.dispatches.length, 0);
  }
});
