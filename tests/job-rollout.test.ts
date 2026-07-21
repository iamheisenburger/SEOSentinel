import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  jobAuthorizedForExecution,
  shouldCancelForEpochTransition,
} from "../convex/lib/jobRollout.ts";

test("manual owner jobs remain available while autonomous rollout observes", () => {
  const observe = {
    autopilotEnabled: true,
    autopilotRolloutMode: "observe",
    autopilotRolloutEpoch: 8,
  };
  assert.equal(
    jobAuthorizedForExecution(observe, {
      payload: { manual: true },
      rolloutEpoch: 2,
    }),
    true,
  );
  assert.equal(
    jobAuthorizedForExecution(observe, {
      payload: { bufferFill: true },
      rolloutEpoch: 8,
    }),
    false,
  );

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /if \(payload\?\.manual\)[\s\S]{0,300}status: site\.approvalRequired \? "review" : "ready"/);
  assert.match(pipeline, /if \(payload\.manual\)[\s\S]{0,350}manualDeliveryWaiting: true/);
});

test("legacy and prior-epoch autonomous jobs cannot block a warm transition", () => {
  const warm = {
    autopilotEnabled: true,
    autopilotRolloutMode: "warm",
    autopilotRolloutEpoch: 9,
  };
  assert.equal(jobAuthorizedForExecution(warm, { payload: {}, rolloutEpoch: undefined }), false);
  assert.equal(jobAuthorizedForExecution(warm, { payload: {}, rolloutEpoch: 8 }), false);
  assert.equal(jobAuthorizedForExecution(warm, { payload: {}, rolloutEpoch: 9 }), true);
  assert.equal(shouldCancelForEpochTransition({ payload: {}, rolloutEpoch: undefined }), true);
  assert.equal(shouldCancelForEpochTransition({ payload: { manual: true }, rolloutEpoch: 2 }), false);

  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /cancelAutonomousJobsForEpochTransition/);
  assert.match(sites, /Cancelled by rollout epoch transition/);
  assert.match(sites, /reservation\?\.state === "reserved"/);
});

test("site deletion and reset fail closed around publication leases", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /Cannot delete a site while a publication lease exists/);
  assert.match(sites, /articles\.some\(\(article\) => article\.publicationLeaseOwner\)/);
  assert.match(sites, /Cannot reset data while a publication lease exists/);
});
