import assert from "node:assert/strict";
import test from "node:test";
import { corePipelineFixture, START } from "./helpers/core-pipeline-fixture.ts";
import { dashboardActivityView } from "../src/lib/dashboard-activity.ts";
import type { SiteJobActivity } from "../convex/lib/siteJobActivity.ts";

function fixture() {
  const f = corePipelineFixture(async () => { assert.fail("Activity reads may not call providers"); });
  const sites = ["Irrigation service", "Freight dispatch"].map((siteName, i) => f.add("sites", {
    siteName, domain: `business-${i}.example`, userId: "synthetic-owner", createdAt: START - 10_000,
  }));
  f.setIdentity("synthetic-owner");
  const addJob = (siteId: string, status = "done", type = "article") => f.add("jobs", {
    siteId, status, type, createdAt: START, updatedAt: START,
    workerToken: "private-worker-capability", payload: { secret: "private-input" },
    result: { secret: "private-output" }, error: "private-error",
    stepProgress: { current: 1, total: 2, stepLabel: "private-progress" },
  });
  return { ...f, sites, addJob,
    read: (siteId: string) => f.invoke("jobs:getDashboardActivity", { siteId }) as Promise<SiteJobActivity> };
}

test("actual owner-authorized site query cannot be starved by a busy peer and returns safe bounded rows", async () => {
  const f = fixture();
  const aJob = f.addJob(f.sites[0]);
  for (let i = 0; i < 70; i++) f.addJob(f.sites[1], i < 60 ? "running" : "pending");
  const before = structuredClone(f.tables);
  const a = await f.read(f.sites[0]), b = await f.read(f.sites[1]);
  assert.deepEqual(a.recent.jobs.map(j => j._id), [aJob]);
  assert.deepEqual(a.running, { status: "complete", count: 0 });
  assert.deepEqual(a.pending, { status: "complete", count: 0 });
  assert.equal(b.recent.status, "truncated"); assert.equal(b.recent.jobs.length, 8);
  assert.deepEqual(b.running, { status: "truncated", lowerBound: 51 });
  assert.deepEqual(b.pending, { status: "complete", count: 10 });
  assert.equal(dashboardActivityView(f.sites[0], a).label, "Idle");
  assert.equal(dashboardActivityView(f.sites[1], b).label, "≥51 running · 10 queued");
  assert.ok(!JSON.stringify([a, b]).includes("private-"));
  assert.deepEqual(f.tables, before);
  for (const read of f.queryReads.filter(r => r.table === "jobs")) {
    assert.ok(["by_site", "by_site_status"].includes(read.index!));
    assert.ok([9, 51].includes(read.limit!));
    assert.ok(read.range.some(r => r.key === "siteId" && f.sites.includes(r.value)));
  }
  f.assertOffline();
});

test("query denies unauthenticated/cross-account/missing sites before any job read", async () => {
  const f = fixture(); f.addJob(f.sites[0]);
  for (const identity of [null, "synthetic-other-owner"]) {
    f.setIdentity(identity);
    await assert.rejects(f.read(f.sites[0]), /Not authorized/);
  }
  f.setIdentity("synthetic-owner");
  await assert.rejects(f.read("sites:missing"), /Not authorized/);
  assert.equal(f.queryReads.length, 0);
  await assert.rejects(f.invoke("jobs:getDashboardActivity", { siteId: 1 }), /real Convex validator/);
  f.assertOffline();
});

test("exact boundary counts, pending-only work and unknown job fields remain truthful", async () => {
  const f = fixture(), siteId = f.sites[0];
  assert.equal((await f.read(siteId)).recent.status, "complete");
  for (let i = 0; i < 50; i++) f.addJob(siteId, "pending");
  assert.deepEqual((await f.read(siteId)).pending, { status: "complete", count: 50 });
  assert.equal(dashboardActivityView(siteId, await f.read(siteId)).label, "50 queued");
  f.addJob(siteId, "pending");
  assert.deepEqual((await f.read(siteId)).pending, { status: "truncated", lowerBound: 51 });
  const id = f.addJob(siteId, "private-status", "private-type");
  f.get(id)!.updatedAt = NaN;
  const job = (await f.read(siteId)).recent.jobs[0];
  assert.equal(job.status, "unknown"); assert.equal(job.type, "unknown"); assert.equal(job.updatedAt, undefined);
  assert.ok(!JSON.stringify(job).includes("private-"));
  f.assertOffline();
});

test("no selection, loading, stale responses and site switching cannot show old activity or exact zero", async () => {
  const f = fixture(); f.addJob(f.sites[0], "running");
  const a = await f.read(f.sites[0]), b = await f.read(f.sites[1]);
  for (const [site, data] of [[undefined, a], [f.sites[0], undefined], [f.sites[1], a]] as const) {
    const view = dashboardActivityView(site, data);
    assert.equal(view.state, "loading"); assert.equal(view.recent, undefined); assert.notEqual(view.label, "Idle");
  }
  assert.equal(dashboardActivityView(f.sites[0], a).label, "1 running");
  assert.equal(dashboardActivityView(f.sites[1], b).label, "Idle");
  assert.equal(dashboardActivityView(f.sites[0], b).state, "loading");
  assert.equal(dashboardActivityView(f.sites[0], a).recent?.jobs.length, 1);
  const incomplete = { ...b, running: { status: "truncated" as const, lowerBound: 0 } };
  assert.equal(dashboardActivityView(f.sites[1], incomplete).state, "unknown");
  f.addJob(f.sites[1], "unrecognized-historical-state");
  assert.equal(dashboardActivityView(f.sites[1], await f.read(f.sites[1])).state, "unknown");
  f.failReads("jobs", new Error("Synthetic database unavailable"));
  await assert.rejects(f.read(f.sites[1]), /database unavailable/);
});
