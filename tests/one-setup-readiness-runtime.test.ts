import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";

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
  let owner = "owner-a";
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
    auth: { async getUserIdentity() { return { subject: owner }; } },
    db: {
      async get(id: string) { return structuredClone(row(id) ?? null); },
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
  };
  const modules = Object.fromEntries(Object.entries(bundles).map(([name, source]) => {
    const runtime = { exports: {} as Record<string, Handler> };
    runInNewContext(source, { module: runtime, exports: runtime.exports,
      require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
      Date: class extends Date { static now() { return timestamp; } } });
    return [name, runtime.exports];
  }));
  return { tables, row, reads, asOwner(value: string) { owner = value; },
    async run(module: string, name: string, args: Row) {
      return structuredClone(await modules[module][name]._handler(ctx, args));
    } };
}

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
