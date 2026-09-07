import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName, type FunctionReference } from "convex/server";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

const source = buildSync({ entryPoints: ["convex/jobs.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const NOW = Date.UTC(2026, 8, 6, 12);

function fixture(siteId = "tenant-a", checkpoint = false) {
  let timestamp = NOW;
  const runtime = { exports: {} as Record<string, Handler> };
  runInNewContext(source, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return timestamp; } } });
  const job: Row = { _id: "job", siteId, type: "article", status: "running",
    workerToken: "owned-worker", workerAttempts: 0, leaseExpiresAt: NOW - 1,
    heartbeatAt: NOW - 1_800_001, updatedAt: NOW - 1_800_001,
    reservationId: "usage", ...(checkpoint ? { articleId: "saved-draft" } : {}) };
  const tables: Record<string, Row[]> = {
    jobs: [job], sites: [{ _id: siteId, userId: "owner", domain: `${siteId}.example`,
      autopilotEnabled: true, autopilotRolloutMode: "live" }],
    article_generation_attempts: [{ _id: "attempt", attemptKey: "job:0", status: "reserved" }],
    usage_log: [{ _id: "usage", jobId: "job", type: "article_generated", state: checkpoint ? "settled" : "reserved" }],
    autopilot_alerts: [], account_plan_entitlements: [], account_deletion_receipts: [],
    plan_candidate_checkpoints: [],
  };
  const writes: string[] = [];
  const wakes: Array<{ at: number; name: string; args: Row }> = [];
  const find = (id: string) => Object.values(tables).flat().find(row => row._id === id);
  const ctx = { db: {
    async get(id: string) { return structuredClone(find(id) ?? null); },
    normalizeId(table: string, id: string) { return tables[table]?.some(row => row._id === id) ? id : null; },
    async patch(id: string, values: Row) {
      const row = find(id); assert.ok(row); writes.push(id);
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
    },
    async delete(id: string) {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex(row => row._id === id);
        if (index !== -1) { rows.splice(index, 1); writes.push(id); return; }
      }
      assert.fail(`Missing row ${id}`);
    },
    async insert(table: string, values: Row) {
      assert.ok(tables[table], table); const id = `${table}-${tables[table].length}`;
      tables[table].push({ _id: id, ...structuredClone(values) }); writes.push(id); return id;
    },
    query(table: string) {
      assert.ok(tables[table], `Unexpected table ${table}`);
      const predicates: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) {
        predicates.push(row => row[key] === value); return range;
      } };
      const rows = () => structuredClone(tables[table].filter(row => predicates.every(p => p(row))));
      const chain = {
        withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        order() { return chain; },
        async take(limit: number) { return rows().slice(0, limit); },
        async collect() { return rows(); },
        async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
        async first() { return rows()[0] ?? null; },
      };
      return chain;
    },
  }, scheduler: {
    async runAt(at: number, ref: FunctionReference<"mutation">, args: Row) {
      wakes.push({ at, name: getFunctionName(ref), args: structuredClone(args) }); return "wake";
    },
  } };
  const run = (name: string, args: Row) => runtime.exports[name]._handler(ctx, args);
  return { job, tables, wakes, writes, run, setTime(value: number) { timestamp = value; } };
}

test("both atomic claim paths arm lease recovery before the worker can disappear", async () => {
  for (const name of ["markRunning", "claimPending"]) for (const siteId of ["tenant-a", "tenant-b"]) {
    const f = fixture(siteId);
    Object.assign(f.tables.sites[0], { domain: `${siteId}.example`, autopilotEnabled: true, autopilotRolloutMode: "live" });
    Object.assign(f.job, { status: "pending", rolloutEpoch: 0 });
    const claimed = await f.run(name, { jobId: "job", siteId, workerToken: "new-worker" });
    assert.ok(claimed);
    assert.equal(f.wakes.length, 1, "Claim must atomically schedule its own recovery, not wait for a future cadence tick");
    assert.equal(f.wakes[0].name, "jobs:resetStuckJobs");
    assert.equal(f.wakes[0].at, f.job.leaseExpiresAt);
    assert.deepEqual(f.wakes[0].args, { siteId, jobId: "job", expectedWorkerToken: "new-worker" });
    await f.run(name, { jobId: "job", siteId, workerToken: "duplicate-worker" });
    assert.equal(f.wakes.length, 1);
  }
});

function deliveryFixture(siteId = "tenant-a") {
  const f = fixture(siteId);
  Object.assign(f.job, { status: "pending", rolloutEpoch: 0,
    payload: { articleId: "sealed", publishOnly: true, bufferDelivery: true } });
  delete f.job.reservationId;
  f.tables.articles = [
    { _id: "sealed", siteId, topicId: "sealed-topic", status: "ready",
      publicationGateStatus: "passed", publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "immutable-hash" },
    { _id: "review-draft", siteId, topicId: "different-topic", status: "review" },
  ];
  f.tables.topic_clusters = [
    { _id: "sealed-topic", siteId }, { _id: "different-topic", siteId },
  ];
  f.tables.jobs.push({ _id: "background", siteId, type: "article", status: "running",
    rolloutEpoch: 0, workerToken: "background-owner", leaseExpiresAt: NOW + 60_000,
    payload: { qualityRetry: true, bufferFill: true, articleId: "review-draft" } });
  return f;
}

for (const claimName of ["claimPending", "markRunning"]) {
test(`${claimName}: due sealed delivery is independent of disjoint buffered review and generation workers`, async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const background of ["review", "generation-checkpoint", "generation-topic", "manual-review", "manual-generation", "plan", "links"]) {
      const f = deliveryFixture(siteId);
      const worker = f.tables.jobs[1];
      if (background === "generation-checkpoint") {
        worker.articleId = "review-draft"; worker.payload = { bufferFill: true };
      } else if (background === "generation-topic") {
        worker.payload = { bufferFill: true, topicId: "different-topic" };
      } else if (background === "manual-review") {
        worker.payload = { manual: true, qualityRetry: true, articleId: "review-draft" };
      } else if (background === "manual-generation") {
        worker.payload = { manual: true, topicId: "different-topic" };
      } else if (background === "plan") {
        worker.type = "plan"; worker.payload = { reason: "topic_buffer_refill" };
      } else if (background === "links") {
        worker.type = "links"; worker.payload = { articleId: "review-draft" };
      }
      const before = structuredClone(worker);
      assert.ok(await f.run(claimName, { jobId: "job", siteId, workerToken: "publisher" }), background);
      assert.equal(f.job.status, "running");
      assert.deepEqual(worker, before, "Delivery must not interrupt or steal the background lease");
      assert.equal(f.wakes.length, 1);
      assert.deepEqual(f.wakes[0].args, { siteId, jobId: "job", expectedWorkerToken: "publisher" });
      assert.equal(f.tables.article_generation_attempts.length, 1, "Delivery creates no provider admission");
      assert.equal(await f.run(claimName, { jobId: "job", siteId, workerToken: "duplicate" }), null);
      assert.equal(f.wakes.length, 1);
    }
  }
});

test(`${claimName}: isolated delivery fails closed for same-artifact, ambiguous and publication-capable workers`, async () => {
  const cases: Array<[string, (f: ReturnType<typeof deliveryFixture>) => void]> = [
    ["same payload article", f => { (f.tables.jobs[1].payload as Row).articleId = "sealed"; }],
    ["same checkpoint article", f => { f.tables.jobs[1].articleId = "sealed"; }],
    ["same topic", f => { (f.tables.jobs[1].payload as Row).topicId = "sealed-topic"; }],
    ["auto-publishing review", f => { (f.tables.jobs[1].payload as Row).bufferFill = false; }],
    ["truthy publish-only", f => { (f.tables.jobs[1].payload as Row).publishOnly = "true"; }],
    ["ambiguous manual flag", f => { (f.tables.jobs[1].payload as Row).manual = "true"; }],
    ["unknown generation target", f => { f.tables.jobs[1].payload = { bufferFill: true }; }],
    ["foreign draft", f => { f.tables.articles[1].siteId = "tenant-b"; }],
    ["missing draft", f => { f.tables.articles.pop(); }],
    ["old-domain draft", f => { f.tables.articles[1].canonicalDomain = "old.example"; f.tables.articles[1].domainRevision = 1; }],
    ["plan on publication target", f => { f.tables.jobs[1].type = "plan"; f.tables.jobs[1].payload = { growthParentArticleId: "sealed" }; }],
    ["links on publication target", f => { f.tables.jobs[1].type = "links"; f.tables.jobs[1].payload = { articleId: "sealed" }; }],
    ["unknown worker", f => { f.tables.jobs[1].type = "onboarding"; }],
    ["another publisher", f => { f.tables.jobs[1].payload = { publishOnly: true, articleId: "review-draft" }; }],
    ["one safe and one unsafe worker", f => { f.tables.jobs.push({ ...f.tables.jobs[1], _id: "unsafe", payload: { articleId: "sealed", bufferFill: true } }); }],
  ];
  for (const [label, change] of cases) {
    const f = deliveryFixture(); change(f);
    assert.equal(await f.run(claimName, { jobId: "job", siteId: "tenant-a", workerToken: "publisher" }), null, label);
    assert.equal(f.writes.length, 0, label); assert.equal(f.wakes.length, 0, label);
  }
});

test(`${claimName}: the delivery lane never bypasses seal, tenant, rollout, retry or payload admission`, async () => {
  const cases: Array<[string, (f: ReturnType<typeof deliveryFixture>) => void]> = [
    ["unsealed", f => { f.tables.articles[0].publicationGateStatus = "blocked"; }],
    ["stale audit", f => { f.tables.articles[0].publicationAuditVersion = -1; }],
    ["missing hash", f => { delete f.tables.articles[0].auditedContentHash; }],
    ["not ready", f => { f.tables.articles[0].status = "review"; }],
    ["foreign publication", f => { f.tables.articles[0].siteId = "tenant-b"; }],
    ["rollout changed", f => { f.tables.sites[0].autopilotRolloutEpoch = 1; }],
    ["disabled", f => { f.tables.sites[0].autopilotEnabled = false; }],
    ["retry not due", f => { f.job.nextAttemptAt = NOW + 1; }],
    ["mixed review/delivery flags", f => { (f.job.payload as Row).qualityRetry = true; }],
    ["truthy mixed review flag", f => { (f.job.payload as Row).qualityRetry = "true"; }],
    ["manual", f => { (f.job.payload as Row).manual = true; }],
    ["non-buffer publication", f => { (f.job.payload as Row).bufferDelivery = false; }],
    ["divergent checkpoint", f => { f.job.articleId = "review-draft"; }],
  ];
  for (const [label, change] of cases) {
    const f = deliveryFixture(); change(f);
    assert.equal(await f.run(claimName, { jobId: "job", siteId: "tenant-a", workerToken: "publisher" }), null, label);
    assert.equal(f.writes.length, 0, label); assert.equal(f.wakes.length, 0, label);
  }
});

test(`${claimName}: delivery priority does not open concurrent provider work or permit a second publisher`, async () => {
  const f = deliveryFixture();
  assert.ok(await f.run(claimName, { jobId: "job", siteId: "tenant-a", workerToken: "publisher" }));
  f.tables.jobs.push({ ...structuredClone(f.job), _id: "second-publication", status: "pending" });
  assert.equal(await f.run(claimName, { jobId: "second-publication", siteId: "tenant-a", workerToken: "second" }), null);
  f.tables.jobs.push({ ...structuredClone(f.tables.jobs[1]), _id: "second-review", status: "pending" });
  assert.equal(await f.run(claimName, { jobId: "second-review", siteId: "tenant-a", workerToken: "reviewer" }), null);
  assert.equal(f.wakes.length, 1);
});
}

test("exact lease observer follows real heartbeat renewal then recovers only the expired execution", async () => {
  for (const checkpoint of [false, true]) {
    const f = fixture("tenant-a", checkpoint);
    Object.assign(f.job, { rolloutEpoch: 0, leaseExpiresAt: NOW + 60_000 });
    // A checkpoint is only inspected for domain binding if it is present.
    if (checkpoint) f.tables.articles = [{ _id: "saved-draft", siteId: "tenant-a" }];
    const args = { siteId: "tenant-a", jobId: "job", expectedWorkerToken: "owned-worker" };
    await f.run("resetStuckJobs", args);
    assert.equal(f.writes.length, 0);
    assert.equal(f.wakes.length, 1);
    f.setTime(NOW + 30_000);
    const renewal = await f.run("heartbeatWorker", { jobId: "job", workerToken: "owned-worker" }) as Row;
    assert.equal(renewal.owned, true);
    assert.equal(f.wakes.length, 1, "heartbeats do not create a scheduled function each time");
    f.setTime(NOW + 60_000);
    const writesBefore = f.writes.length;
    await f.run("resetStuckJobs", f.wakes[0].args);
    assert.equal(f.writes.length, writesBefore, "live renewal must not be reset");
    assert.equal(f.wakes.length, 2);
    assert.equal(f.wakes[1].at, f.job.leaseExpiresAt);
    f.setTime(Number(f.job.leaseExpiresAt));
    await f.run("resetStuckJobs", f.wakes[1].args);
    assert.equal(f.job.status, "pending");
    assert.equal(f.job.workerAttempts, 1);
    assert.equal(f.tables.article_generation_attempts[0].status, "ambiguous");
    assert.equal(f.job.articleId, checkpoint ? "saved-draft" : undefined);
    assert.equal(f.wakes[2].name, "autopilot:dispatchSiteFollowup");
    assert.equal(f.wakes[2].at, f.job.nextAttemptAt);
    const counts = [f.wakes.length, f.writes.length];
    await f.run("resetStuckJobs", args);
    assert.deepEqual([f.wakes.length, f.writes.length], counts, "duplicate observer cannot reset or retry twice");
  }
});

test("fenced recovery cannot touch foreign, superseded, terminal, missing or separately owned onboarding jobs", async () => {
  for (const variant of ["foreign", "superseded", "terminal", "missing", "onboarding", "missing-lease"]) {
    const f = fixture();
    if (variant === "superseded") f.job.workerToken = "replacement";
    if (variant === "terminal") f.job.status = "done";
    if (variant === "missing-lease") delete f.job.leaseExpiresAt;
    if (variant === "onboarding") Object.assign(f.job, { type: "onboarding", payload: { workflow: "core_crawl_analysis_v1" } });
    await f.run("resetStuckJobs", { siteId: variant === "foreign" ? "tenant-b" : "tenant-a",
      jobId: variant === "missing" ? "unknown" : "job", expectedWorkerToken: "owned-worker" });
    assert.equal(f.writes.length, 0, variant);
    assert.equal(f.wakes.length, 0, variant);
  }
  for (const args of [{ jobId: "job" }, { expectedWorkerToken: "owned-worker" },
    { siteId: "tenant-a", jobId: "job", expectedWorkerToken: "" }]) {
    const f = fixture();
    await assert.rejects(f.run("resetStuckJobs", args), /Exact worker recovery requires/);
    assert.equal(f.writes.length, 0); assert.equal(f.wakes.length, 0);
  }
});

test("an exact observer reaps no sibling jobs even when their leases also expired", async () => {
  const f = fixture();
  const sibling = { ...structuredClone(f.job), _id: "sibling", workerToken: "sibling-worker" };
  f.tables.jobs.push(sibling);
  const before = structuredClone(sibling);
  await f.run("resetStuckJobs", { siteId: "tenant-a", jobId: "job", expectedWorkerToken: "owned-worker" });
  assert.equal(f.job.status, "pending");
  assert.deepEqual(sibling, before);
  assert.equal(f.wakes.length, 1);
});

test("exact observers preserve exhausted article attempts and ambiguous plans as terminal", async () => {
  for (const type of ["article", "plan"]) {
    const f = fixture();
    f.job.type = type;
    if (type === "article") {
      f.job.workerAttempts = 3;
      f.tables.article_generation_attempts[0].attemptKey = "job:3";
    } else f.tables.article_generation_attempts = [];
    await f.run("resetStuckJobs", { siteId: "tenant-a", jobId: "job", expectedWorkerToken: "owned-worker" });
    assert.equal(f.job.status, "failed");
    assert.equal(f.job.nextAttemptAt, undefined);
    assert.equal(f.wakes.length, 0, "terminal work never receives another paid execution");
    if (type === "article") assert.equal(f.tables.article_generation_attempts[0].status, "ambiguous");
    else assert.equal(f.tables.article_generation_attempts.length, 0);
  }
});

test("expired article leases atomically arm their exact canonical retry wake for either tenant", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const checkpoint of [false, true]) {
      const f = fixture(siteId, checkpoint);
      await f.run("resetStuckJobs", { siteId });
      assert.equal(f.job.status, "pending");
      assert.equal(f.job.workerToken, undefined);
      assert.equal(f.job.leaseExpiresAt, undefined);
      assert.equal(f.tables.article_generation_attempts[0].status, "ambiguous");
      assert.equal(f.job.workerAttempts, 1);
      assert.equal(f.job.nextAttemptAt, NOW + 60_000);
      assert.equal(f.wakes.length, 1, "A stored retry timestamp alone does not wake the job");
      assert.equal(f.wakes[0].at, f.job.nextAttemptAt);
      assert.equal(f.wakes[0].name, "autopilot:dispatchSiteFollowup");
      assert.equal(f.wakes[0].args.siteId, siteId);
      assert.equal(f.job.articleId, checkpoint ? "saved-draft" : undefined);
      assert.equal(f.tables.usage_log.length, checkpoint ? 1 : 0);
      const writes = f.writes.length;
      await f.run("resetStuckJobs", { siteId });
      assert.equal(f.wakes.length, 1);
      assert.equal(f.writes.length, writes);
    }
  }
});

test("lease recovery cannot requeue fresh, foreign or exhausted article executions", async () => {
  const fresh = fixture(); fresh.job.leaseExpiresAt = NOW + 1;
  await fresh.run("resetStuckJobs", { siteId: "tenant-a" });
  assert.equal(fresh.writes.length, 0); assert.equal(fresh.wakes.length, 0);
  const foreign = fixture();
  await foreign.run("resetStuckJobs", { siteId: "tenant-b" });
  assert.equal(foreign.writes.length, 0); assert.equal(foreign.wakes.length, 0);
  const exhausted = fixture(); exhausted.job.workerAttempts = 3;
  await exhausted.run("resetStuckJobs", { siteId: "tenant-a" });
  assert.equal(exhausted.job.status, "failed");
  assert.equal(exhausted.job.nextAttemptAt, undefined); assert.equal(exhausted.wakes.length, 0);
});

test("transient failure commits retry and wake together without depending on the action surviving", async () => {
  const f = fixture("tenant-b", true);
  await f.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Provider timeout" });
  assert.equal(f.job.status, "pending");
  assert.equal(f.tables.article_generation_attempts[0].status, "failed");
  assert.equal(f.wakes.length, 1);
  assert.equal(f.wakes[0].at, NOW + 120_000);
  assert.equal(f.wakes[0].name, "autopilot:dispatchSiteFollowup");
  assert.equal(f.wakes[0].args.siteId, "tenant-b");
  assert.equal(f.job.articleId, "saved-draft");
  await f.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Duplicate completion" });
  assert.equal(f.wakes.length, 1);
  assert.equal(f.job.workerAttempts, 1);
});

test("a stale failure or exhausted retry never arms more provider work", async () => {
  const stale = fixture();
  await stale.run("markRetryableFailure", { jobId: "job", workerToken: "wrong", error: "Timeout" });
  assert.equal(stale.writes.length, 0); assert.equal(stale.wakes.length, 0);
  const exhausted = fixture(); exhausted.job.workerAttempts = 3;
  await exhausted.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Timeout" });
  assert.equal(exhausted.job.status, "failed"); assert.equal(exhausted.wakes.length, 0);
});

test("capacity deferral commits its wake without relying on a surviving action or spending an attempt", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const reason of ["account_concurrency", "fleet_concurrency"]) {
      for (const checkpoint of [false, true]) {
        const f = fixture(siteId, checkpoint);
        const args = { jobId: "job", workerToken: "owned-worker", reason, retryAfterMs: 120_000 };
        await f.run("deferArticleProviderAdmission", args);
        assert.equal(f.job.status, "pending");
        assert.equal(f.job.workerAttempts, 0);
        assert.equal(f.tables.article_generation_attempts[0].status, "reserved");
        assert.equal(f.job.articleId, checkpoint ? "saved-draft" : undefined);
        assert.equal(f.tables.usage_log.length, checkpoint ? 1 : 0);
        assert.equal(f.wakes.length, 1, "The mutation must arm the wake even if its calling action dies");
        assert.equal(f.wakes[0].at, f.job.nextAttemptAt);
        assert.equal(f.wakes[0].at, NOW + 120_000);
        assert.equal(f.wakes[0].name, "autopilot:dispatchSiteFollowup");
        assert.deepEqual(f.wakes[0].args, { siteId, trigger: "provider_capacity_retry", reason });
        const writes = f.writes.length;
        await f.run("deferArticleProviderAdmission", args);
        assert.equal(f.writes.length, writes);
        assert.equal(f.wakes.length, 1);
      }
    }
  }
});

test("capacity deferral rejects stale/non-article work and retains the minimum pacing interval", async () => {
  for (const variant of ["stale", "non-article", "missing-site"]) {
    const f = fixture();
    if (variant === "non-article") f.job.type = "plan";
    if (variant === "missing-site") delete f.job.siteId;
    await f.run("deferArticleProviderAdmission", {
      jobId: "job", workerToken: variant === "stale" ? "wrong" : "owned-worker",
      reason: "account_concurrency", retryAfterMs: 120_000,
    });
    assert.equal(f.writes.length, 0); assert.equal(f.wakes.length, 0);
  }
  const f = fixture();
  await f.run("deferArticleProviderAdmission", {
    jobId: "job", workerToken: "owned-worker", reason: "fleet_concurrency", retryAfterMs: 1,
  });
  assert.equal(f.job.nextAttemptAt, NOW + 30_000);
  assert.equal(f.wakes[0].at, f.job.nextAttemptAt);
});
