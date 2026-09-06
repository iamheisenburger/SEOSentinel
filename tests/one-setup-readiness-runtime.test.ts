import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";
import { oneSetupInitialPlanContextFingerprint } from "../convex/lib/oneSetupInitialPlan.ts";
import { getFunctionName } from "convex/server";

type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: Row) => Promise<Row> };
const timestamp = Date.UTC(2026, 8, 6, 13);
const bundles = Object.fromEntries(["sites", "oneSetupExecutions"].map(name => {
  const contents = name === "sites" && process.env.ONE_SETUP_READINESS_BASELINE_REF
    ? execFileSync("git", ["show", `${process.env.ONE_SETUP_READINESS_BASELINE_REF}:convex/sites.ts`], { encoding: "utf8" })
    : readFileSync(`convex/${name}.ts`, "utf8");
  return [name, buildSync({ stdin: { contents, resolveDir: `${process.cwd()}/convex`,
    sourcefile: `${name}.ts`, loader: "ts" }, bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text];
}));

function fixture() {
  let owner: string | null = "owner-a";
  let clock = timestamp;
  let rejectDispatch = false;
  const wakes: Array<{ at: number; name: string; args: Row }> = [];
  const tables: Record<string, Row[]> = {
    sites: [], managed_provisioning_requests: [], one_setup_executions: [], jobs: [],
    account_plan_entitlements: [], account_deletion_receipts: [], pages: [],
    topic_clusters: [], seo_growth_goals: [], outreach_inboxes: [],
  };
  for (const id of ["a", "b"]) {
    tables.sites.push({ _id: id, userId: `owner-${id}`, domain: `${id}.example`,
      canonicalDomainRevision: 1, cadencePerWeek: 7, autopilotEnabled: true,
      planFeatures: ["max_sites_unlimited", "max_articles_150"], updatedAt: timestamp,
      githubToken: "private-site-credential" });
    tables.account_plan_entitlements.push({ _id: `entitlement-${id}`,
      userId: `owner-${id}`, status: "completed", maxArticles: 150, maxSites: 9999 });
    const binding = { siteId: id, ownerAccountKey: accountDeletionKey(`owner-${id}`),
      domainSnapshot: `${id}.example`, domainRevisionSnapshot: 1,
      configurationRevision: 1, automationMode: "full", requestedCadencePerWeek: 7 };
    tables.managed_provisioning_requests.push({ _id: `request-${id}`, ...binding,
      contractVersion: 1, revision: 1, initialPlanJobId: `job-${id}`,
      initialPlanReceiptVersion: 1, initialPlanGeneration: 1,
      initialPlanContextFingerprint: oneSetupInitialPlanContextFingerprint({ domain: `${id}.example` }),
      publisher: { mode: "connect_existing", state: "ready" },
      searchMeasurement: { mode: "connect_existing", state: "ready" },
      outreachMailbox: { mode: "connect_existing", state: "ready" },
      updatedAt: timestamp, outreachSenderProfile: { physicalAddress: "private-postal-address" } });
    tables.one_setup_executions.push({ _id: `execution-${id}`, ...binding,
      requestId: `request-${id}`, publisherMode: "connect_existing",
      searchMeasurementMode: "connect_existing", outreachMailboxMode: "connect_existing",
      status: "completed", planJobId: `job-${id}`, topicCount: 3,
      completedAt: timestamp - 1000, createdAt: timestamp - 5000, updatedAt: timestamp - 1000,
      claimNonce: "private-claim-nonce" });
    tables.jobs.push({ _id: `job-${id}`, siteId: id, type: "plan", status: "done", workerAttempts: 1,
      payload: { manual: true, reason: "one_setup_initial_plan", oneSetupRequestId: `request-${id}`,
        oneSetupInitialPlanReceiptVersion: 1, oneSetupInitialPlanGeneration: 1,
        oneSetupCanonicalDomainRevision: 1, secret: "private-payload" },
      result: { count: 3, text: "private-provider-output" } });
  }
  const row = (id: string) => Object.values(tables).flat().find(value => value._id === id)!;
  const reads: Array<{ table: string; index: string }> = [];
  const ctx = {
    auth: { async getUserIdentity() { return owner ? { subject: owner } : null; } },
    db: {
      async get(id: string) { return structuredClone(row(id) ?? null); },
      normalizeId(table: string, id: string) { return tables[table]?.some(r => r._id === id) ? id : null; },
      async patch(id: string, patch: Row) { assert.ok(row(id)); Object.assign(row(id), structuredClone(patch)); },
      query(table: string) {
        assert.ok(tables[table], `Unexpected table ${table}`);
        const predicates: Array<(value: Row) => boolean> = [];
        const range = { eq(key: string, value: unknown) { predicates.push(r => r[key] === value); return range; } };
        const rows = () => tables[table].filter(value => predicates.every(p => p(value)));
        const chain = {
          withIndex(index: string, fn: (q: typeof range) => unknown) { reads.push({ table, index }); fn(range); return chain; },
          order() { return chain; },
          async take(limit: number) { return structuredClone(rows().slice(0, limit)); },
          async collect() { return structuredClone(rows()); },
          async first() { return structuredClone(rows()[0] ?? null); },
          async unique() { assert.ok(rows().length <= 1); return structuredClone(rows()[0] ?? null); },
        };
        return chain;
      },
    },
    scheduler: {
      async runAfter(delay: number, ref: Parameters<typeof getFunctionName>[0], args: Row) {
        if (rejectDispatch) throw new Error("Injected dispatch failure");
        wakes.push({ at: clock + delay, name: getFunctionName(ref), args: structuredClone(args) });
      },
      async runAt(at: number, ref: Parameters<typeof getFunctionName>[0], args: Row) {
        wakes.push({ at, name: getFunctionName(ref), args: structuredClone(args) });
      },
    },
  };
  const modules = Object.fromEntries(Object.entries(bundles).map(([name, source]) => {
    const runtime = { exports: {} as Record<string, Handler> };
    runInNewContext(source, { module: runtime, exports: runtime.exports,
      require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
      Date: class extends Date { static now() { return clock; } } });
    return [name, runtime.exports];
  }));
  return { tables, row, reads, wakes, asOwner(value: string | null) { owner = value; },
    at(value: number) { clock = value; },
    rejectDispatch() { rejectDispatch = true; },
    async run(module: string, name: string, args: Row) {
      const before = structuredClone(tables); const wakeCount = wakes.length;
      try { return structuredClone(await modules[module][name]._handler(ctx, args)); }
      catch (error) {
        for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        wakes.length = wakeCount;
        throw error;
      }
    } };
}

function failedPlanFixture(id = "a") {
  const f = fixture(); f.asOwner(`owner-${id}`);
  Object.assign(f.row(`execution-${id}`), { status: "blocked", blockerCode: "transient_provider_failure" });
  Object.assign(f.row(`job-${id}`), { status: "failed", result: undefined,
    createdAt: timestamp - 3_600_000, updatedAt: timestamp - 1_800_000,
    providerSpendReservationId: "immutable-paid-reservation" });
  return f;
}
const retryArgs = (id = "a", generation = 1) => ({ siteId: id,
  expectedPlanJobId: `job-${id}`, expectedPlanGeneration: generation,
  expectedConfigurationRevision: 1 });

test("explicit owner retry authorizes one successor without replaying or rewriting the failed paid receipt", async () => {
  for (const id of ["a", "b"]) {
    const f = failedPlanFixture(id); const oldJob = structuredClone(f.row(`job-${id}`));
    const site = structuredClone(f.row(id));
    const result = await f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs(id));
    assert.equal(result.state, "retry_requested");
    assert.equal(f.row(`request-${id}`).initialPlanGeneration, 2);
    assert.equal(f.row(`request-${id}`).initialPlanJobId, undefined);
    assert.equal(f.row(`request-${id}`).configurationRevision, 1);
    assert.equal(f.row(`execution-${id}`).status, "pending");
    assert.equal(f.row(`execution-${id}`).planJobId, undefined);
    assert.deepEqual(f.row(`job-${id}`), oldJob);
    assert.deepEqual(f.row(id), site, "retry cannot change cadence, publishing or outreach authority");
    assert.equal(f.tables.jobs.length, 2, "the canonical queue must reserve the new paid job");
    assert.deepEqual(f.wakes.map(w => w.name), ["actions/pipeline:resumeOneSetupExecutionInternal", "oneSetupExecutions:recoverScheduledResumeDispatch"]);
    const committed = structuredClone(f.tables);
    assert.equal((await f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs(id))).state, "already_requested");
    assert.deepEqual(f.tables, committed); assert.equal(f.wakes.length, 2);
  }
});

test("owner retry refuses stale, foreign, active, completed, zero-yield and ambiguous receipt bindings", async () => {
  for (const [id, patch] of [
    ["a", { planParkedAt: timestamp }], ["a", { accountDeletionRequestedAt: timestamp }],
    ["a", { canonicalDomainRevision: 2 }], ["a", { niche: "changed planning context" }],
    ["a", { domainOwnershipConflictAt: timestamp }],
    ["entitlement-a", { status: "pending" }], ["entitlement-a", { maxArticles: 5 }],
    ["request-a", { initialPlanQuarantineCode: "ambiguous_legacy_receipt" }],
    ["execution-a", { status: "completed" }], ["execution-a", { status: "plan_queued" }],
    ["execution-a", { automationMode: "approval" }], ["execution-a", { requestedCadencePerWeek: 21 }],
    ["execution-a", { publisherMode: "managed" }],
    ["job-a", { status: "running" }], ["job-a", { status: "pending" }],
    ["job-a", { status: "done", result: { count: 0 } }],
    ["job-a", { siteId: "b" }], ["job-a", { leaseExpiresAt: timestamp + 1 }],
  ] as Array<[string, Row]>) {
    const f = failedPlanFixture(); Object.assign(f.row(id), patch); const before = structuredClone(f.tables);
    await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs()));
    assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
  }
  for (const owner of [null, "owner-b"]) {
    const f = failedPlanFixture(); f.asOwner(owner); const before = structuredClone(f.tables);
    await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs()), /Not authorized/);
    assert.deepEqual(f.tables, before);
  }
  for (const patch of [{ expectedPlanGeneration: 2 }, { expectedConfigurationRevision: 2 },
    { expectedPlanJobId: "job-b" }, { expectedPlanGeneration: NaN }]) {
    const f = failedPlanFixture(); const before = structuredClone(f.tables);
    await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", { ...retryArgs(), ...patch }));
    assert.deepEqual(f.tables, before);
  }
});

test("owner retry respects failure eligibility and rolls back authorization when dispatch cannot be armed", async () => {
  for (const patch of [{ updatedAt: timestamp - 1 },
    { cadenceFailure: { eligibleAt: timestamp + 60_000 } }]) {
    const f = failedPlanFixture(); Object.assign(f.row("job-a"), patch); const before = structuredClone(f.tables);
    const result = await f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs());
    assert.equal(result.state, "waiting"); assert.ok(Number(result.eligibleAt) > timestamp);
    assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
  }
  const f = failedPlanFixture(); f.rejectDispatch(); const before = structuredClone(f.tables);
  await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs()), /Injected dispatch failure/);
  assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
});

test("repeated distinct owner retries retain the daily envelope and reject corrupted counters", async () => {
  for (const attemptInWindow of [3, 4, NaN]) {
    const f = failedPlanFixture();
    f.row("request-a").initialPlanOwnerRetry = {
      previousJobId: "an-earlier-failed-job", previousGeneration: 1,
      configurationRevision: 1, requestedAt: timestamp - 1_800_000,
      windowStartAt: Date.UTC(2026, 8, 6), attemptInWindow,
    };
    const before = structuredClone(f.tables);
    if (attemptInWindow === 3) {
      const result = await f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs());
      assert.equal(result.state, "waiting");
      assert.equal(result.eligibleAt, Date.UTC(2026, 8, 7));
    } else {
      await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs()), /Invalid owner retry/);
    }
    assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
  }
});

test("customer readiness exposes the exact failed-plan retry and removes it after authorization", async () => {
  const f = failedPlanFixture();
  const result = await f.run("sites", "getOneSetupReadiness", { siteId: "a" });
  const retry = result.initialPlanRetry as Row;
  assert.equal(retry.planJobId, "job-a"); assert.equal(retry.planGeneration, 1);
  assert.equal((result.stages as Row[]).find(s => s.key === "content_plan")?.actionKind, "retry_initial_plan");
  await f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs());
  const after = await f.run("sites", "getOneSetupReadiness", { siteId: "a" });
  assert.equal(after.initialPlanRetry, null);
  assert.equal((after.stages as Row[]).find(s => s.key === "content_plan")?.actionKind, undefined);
});

test("stale setup choices cannot advertise a retry and deleted accounts cannot authorize it", async () => {
  for (const patch of [{ automationMode: "approval" }, { requestedCadencePerWeek: 21 },
    { publisherMode: "managed" }, { searchMeasurementMode: "managed" },
    { outreachMailboxMode: "managed" }]) {
    const f = failedPlanFixture(); Object.assign(f.row("execution-a"), patch);
    const result = await f.run("sites", "getOneSetupReadiness", { siteId: "a" });
    assert.equal(result.initialPlanRetry, null);
  }
  const f = failedPlanFixture();
  f.tables.account_deletion_receipts.push({ _id: "deleted-a", accountKey: accountDeletionKey("owner-a") });
  const before = structuredClone(f.tables);
  await assert.rejects(f.run("oneSetupExecutions", "requestFailedPlanRetry", retryArgs()));
  assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
});

test("completed setup plans stay prepared after all initial topics have been consumed", async () => {
  const f = fixture();
  for (const id of ["a", "b"]) {
    f.asOwner(`owner-${id}`);
    const before = structuredClone(f.tables);
    const result = await f.run("sites", "getOneSetupReadiness", { siteId: id });
    assert.equal((result.stages as Row[]).find(stage => stage.key === "content_plan")?.state, "ready");
    assert.deepEqual(f.tables, before, "readiness must not rewrite a receipt or reserve work");
    assert.equal(f.tables.topic_clusters.length, 0, "this is setup history, not invented live inventory");
  }
});

test("readiness refuses zero-yield, failed, incomplete and mismatched terminal plan receipts", async () => {
  for (const patch of [{ topicCount: 0 }, { topicCount: NaN }, { completedAt: undefined },
    { status: "plan_queued" }, { planJobId: "job-b" }, { requestId: "request-b" },
    { ownerAccountKey: "different-owner" }, { domainRevisionSnapshot: 0 }]) {
    const f = fixture(); Object.assign(f.row("execution-a"), patch);
    const result = await f.run("sites", "getOneSetupReadiness", { siteId: "a" });
    assert.notEqual((result.stages as Row[]).find(stage => stage.key === "content_plan")?.state, "ready");
  }
  const f = fixture(); Object.assign(f.row("execution-a"), { status: "blocked", blockerCode: "plan_zero_yield" });
  const result = await f.run("sites", "getOneSetupReadiness", { siteId: "a" });
  assert.equal((result.stages as Row[]).find(stage => stage.key === "content_plan")?.state, "blocked");
  await assert.rejects(f.run("sites", "getOneSetupReadiness", { siteId: "b" }), /Site not found/);
});

test("setup operator projection is exact-site, indexed, read-only and excludes private context", async () => {
  const f = fixture(); const before = structuredClone(f.tables);
  const result = await f.run("oneSetupExecutions", "getOperatorSnapshot", { siteId: "a" });
  assert.equal(result.currentRequest, true);
  assert.equal((result.execution as Row).executionId, "execution-a");
  assert.equal((result.boundPlan as Row).jobId, "job-a");
  assert.equal((result.boundPlan as Row).resultCount, 3);
  assert.deepEqual(f.tables, before);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["private-", "job-b", "owner-a", "ownerAccountKey", "payload", "outreachSenderProfile"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.deepEqual(f.reads.map(read => read.index), ["by_site", "by_account_key", "by_request_configuration"]);
});

test("operator projection cannot adopt foreign, stale or deleted setup and plan bindings", async () => {
  for (const patch of [{ planJobId: "job-b" }, { domainRevisionSnapshot: 0 }, { siteId: "b" }]) {
    const f = fixture(); Object.assign(f.row("execution-a"), patch);
    const result = await f.run("oneSetupExecutions", "getOperatorSnapshot", { siteId: "a" });
    assert.equal(result.boundPlan, null);
  }
  for (const patch of [{ deletionStatus: "deleting" }, { accountDeletionRequestedAt: timestamp },
    { canonicalDomainRevision: 2 }, { userId: "different-owner" }]) {
    const f = fixture(); Object.assign(f.row("a"), patch);
    const result = await f.run("oneSetupExecutions", "getOperatorSnapshot", { siteId: "a" });
    assert.equal(result.currentRequest, false);
    assert.equal(result.execution, undefined);
  }
});
