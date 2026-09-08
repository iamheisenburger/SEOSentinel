import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";
import { DATAFORSEO_AUTHORITY_SOURCE } from "../convex/lib/expectedClickPortfolio.ts";

// The VM boundary deliberately exercises untyped database documents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const now = Date.UTC(2026, 8, 8, 14);
const source = readFileSync("convex/actions/pipeline.ts", "utf8");
function bundlePipeline(contents: string) {
  return buildSync({ stdin: {
    contents: `${contents.replaceAll('await import("./seoData")', 'await Promise.resolve(globalThis.__seoData)')}\nexport { handlePlan };`,
    resolveDir: `${process.cwd()}/convex/actions`, sourcefile: "pipeline.ts", loader: "ts",
  }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
}
const repaired = bundlePipeline(source);
// Reproduce the observed early throw against the same paid discovery fixture.
const previous = bundlePipeline(source.replace(
  "if (!checkpointPlanningEnabled) throw new Error(emptyDiscoveryMessage);",
  "throw new Error(emptyDiscoveryMessage);",
));
const stageCode = buildSync({ entryPoints: ["convex/planCandidateCheckpoints.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;

function fixture(siteId: string, pipeline = repaired) {
  const site: Row = { _id: siteId, userId: `${siteId}-owner`, domain: "example.org", siteName: "Example",
    autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 1,
    expectedClickSchedulingEnabled: true, language: "en", targetCountry: "US",
    anchorKeywords: ["lead capture software"], niche: "lead capture software", siteType: "SaaS Product",
    seoAuthorityDomain: "example.org", seoAuthorityDomainRank: 5, seoAuthorityReferringDomains: 2,
    seoAuthoritySource: DATAFORSEO_AUTHORITY_SOURCE, seoAuthorityMeasuredAt: now - 1000 };
  const job: Row = { _id: "job", siteId, type: "plan", status: "running", rolloutEpoch: 1,
    canonicalDomain: "example.org", domainRevision: 0, workerAttempts: 0, workerToken: "lease",
    leaseExpiresAt: now + 60_000, createdAt: now - 5000,
    providerSpendReservationId: "reservation", providerCostCeilingMicroUsd: 1_000_000,
    providerCostReservedMicroUsd: 1_000_000, providerCostReservationDay: "2026-09-08",
    payload: { reason: "topic_replenishment", planCheckpointModeVersion: 1, planProviderEnvelopeVersion: 2,
      planYieldTarget: { version: 1, targetBufferShortfall: 1, verifiedHorizonShortfall: 1,
        articleQuotaHeadroom: 5, requiredVerifiedYield: 1 } } };
  const reservation: Row = { _id: "reservation", siteId, userId: site.userId, purpose: "topic_plan",
    trigger: "topic_plan", reservedMicroUsd: 1_000_000, reservationDay: "2026-09-08", createdAt: job.createdAt };
  const existing = [{ _id: "existing", siteId, primaryKeyword: "lead capture software", status: "used" }];
  const tables: Record<string, Row[]> = { sites: [site], jobs: [job], provider_spend_reservations: [reservation],
    topic_clusters: existing, plan_candidate_checkpoints: [], account_deletion_receipts: [], account_plan_entitlements: [] };
  const mutations: string[] = []; const providerCalls: string[] = [];
  const db = {
    async get(id: string) { return Object.values(tables).flat().find(r => r._id === id) ?? null; },
    async insert(table: string, row: Row) { assert.equal(table, "plan_candidate_checkpoints");
      const id = `checkpoint-${tables[table].length}`; tables[table].push({ _id: id, ...structuredClone(row) }); return id; },
    async patch(id: string, patch: Row) {
      if (id === job._id) {
        assert.deepEqual(Object.keys(patch).sort(), ["heartbeatAt", "leaseExpiresAt", "updatedAt"]);
        Object.assign(job, structuredClone(patch)); return;
      }
      const checkpoint = tables.plan_candidate_checkpoints.find(r => r._id === id);
      assert.ok(checkpoint, "An empty plan must not patch topics, reservations, or attempts");
      Object.assign(checkpoint, structuredClone(patch));
    },
    query(table: string) {
      assert.ok(tables[table], table); const predicates: Array<(r: Row) => boolean> = [];
      const range = { eq(k: string, v: unknown) { predicates.push(r => r[k] === v); return range; } };
      const rows = () => tables[table].filter(r => predicates.every(p => p(r)));
      const chain = { withIndex(_name: string, f: (q: typeof range) => unknown) { f(range); return chain; },
        order() { return chain; }, async collect() { return rows(); }, async unique() {
          assert.ok(rows().length <= 1); return rows()[0] ?? null;
        }, async take(limit: number) { return rows().slice(0, limit); } }; return chain;
    },
  };
  const globals = { require: createRequire(import.meta.url), URL, Buffer, TextEncoder, TextDecoder, Error,
    process: { env: {} }, console: { log() {}, error() {} },
    Date: class extends Date { static now() { return now; } },
    __seoData: { computeMaxKD: () => 15, async discoverKeywords() {
      providerCalls.push("discovery"); return [{ keyword: "lead capture software", searchVolume: 70,
        difficulty: 5, difficultyMeasured: true, cpc: 1 }];
    }, async getKeywordMetrics() { providerCalls.push("exact-anchors"); return []; },
    async analyzeSERP() { assert.fail("An empty measured plan cannot buy SERP evidence"); } },
    fetch() { assert.fail("An empty measured plan cannot call a model or another provider"); },
  };
  const runtime = { exports: {} as Row }; const stageRuntime = { exports: {} as Row };
  runInNewContext(pipeline, { ...globals, module: runtime, exports: runtime.exports });
  runInNewContext(stageCode, { ...globals, module: stageRuntime, exports: stageRuntime.exports });
  let lastStage: Row | undefined;
  const ctx = {
    async runQuery(ref: Parameters<typeof getFunctionName>[0], args: Row) {
      assert.equal(args.siteId, siteId); const name = getFunctionName(ref);
      if (name === "sites:getFull") return site;
      if (name === "topics:listBySiteInternal") return existing;
      if (name === "articles:listBySiteInternal" || name === "searchPerformance:getDiscoverySignalsInternal") return [];
      if (name === "outcomes:getCadencePrioritySignalsInternal") return { signals: [], truncated: false };
      assert.fail(name);
    },
    async runMutation(ref: Parameters<typeof getFunctionName>[0], args: Row) {
      const name = getFunctionName(ref); mutations.push(name);
      if (name === "jobs:heartbeatWorker") return { owned: true };
      if (name === "jobs:updateProgress" || name === "sites:recordSeoAuthorityEvidenceInternal") return;
      if (name === "planCandidateCheckpoints:stage") {
        lastStage = structuredClone(args); return stageRuntime.exports.stage._handler({ db }, args);
      }
      assert.fail(name);
    },
  };
  return { site, job, reservation, tables, mutations, providerCalls, seoData: globals.__seoData,
    run: () => runtime.exports.handlePlan(ctx, siteId, "job", "lease", 0, undefined, undefined, 1, 1, 1),
    replay: (patch: Row = {}) => stageRuntime.exports.stage._handler({ db }, { ...lastStage, ...patch }),
  };
}

test("observed preselection zero-yield used to lose its checkpoint; repaired pipeline records an honest empty result without further spend", async () => {
  const old = fixture("tenant-old", previous);
  await assert.rejects(old.run(), /no measured, authority-attainable/);
  assert.equal(old.tables.plan_candidate_checkpoints.length, 0);
  for (const tenant of ["tenant-a", "tenant-b"]) {
    const f = fixture(tenant); const reservation = JSON.stringify(f.reservation);
    await assert.rejects(f.run(), /retained zero exact candidates/);
    assert.equal(f.tables.plan_candidate_checkpoints.length, 1);
    const checkpoint = f.tables.plan_candidate_checkpoints[0];
    assert.equal(checkpoint.status, "empty"); assert.equal(checkpoint.siteId, tenant);
    assert.equal(checkpoint.workerExecution, 1); assert.equal(checkpoint.completedAt, now);
    assert.equal(checkpoint.candidateTopicIds.length, 0); assert.ok(checkpoint.seedBatches.length > 0);
    assert.deepEqual(f.providerCalls, old.providerCalls);
    assert.equal(JSON.stringify(f.reservation), reservation); assert.equal(f.job.workerAttempts, 0);
    const replay = await f.replay(); assert.equal(replay.replay, true); assert.equal(replay.active, false);
    assert.equal(f.tables.plan_candidate_checkpoints.length, 1);
    await assert.rejects(f.replay({ seedManifestHash: "changed" }), /manifest/);
    await assert.rejects(f.replay({ workerToken: "expired-worker" }), /fence/);
    f.job.status = "failed";
    await assert.rejects(f.replay(), /fence/);
  }
});

test("unverified or legacy executions cannot mint an empty checkpoint", async () => {
  const f = fixture("tenant"); f.site.expectedClickSchedulingEnabled = false;
  await assert.rejects(f.run(), /no measured, authority-attainable/);
  assert.equal(f.tables.plan_candidate_checkpoints.length, 0);
  const unavailable = fixture("tenant-unavailable");
  unavailable.seoData.discoverKeywords = async () => { throw new Error("Unverified provider response"); };
  await assert.rejects(unavailable.run(), /Verified keyword data is required/);
  assert.equal(unavailable.tables.plan_candidate_checkpoints.length, 0);
});
