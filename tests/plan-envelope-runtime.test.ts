import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { automaticPlanYieldTarget, planProviderAmountsMatch, planProviderEnvelopeMicroUsd } from "../convex/lib/planProviderBudget.ts";
import { planSeedBatchManifestHash } from "../convex/lib/planCandidateCheckpoint.ts";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals } from "../convex/lib/autopilotBuffer.ts";
import { DATAFORSEO_AUTHORITY_SOURCE, DATAFORSEO_DEMAND_SOURCE } from "../convex/lib/expectedClickPortfolio.ts";

type Row = Record<string, unknown>;
type Expression = (r: Row) => unknown;
const filters = {
  field: (key: string): Expression => r => r[key],
  eq: (left: Expression, right: unknown): Expression => r => left(r) === right,
  and: (...expressions: Expression[]): Expression => r => expressions.every(e => e(r)),
};
type Handler = { _handler: (ctx: unknown, args: Row) => Promise<Row> };
const now = Date.UTC(2026, 8, 6, 17);
const modules = Object.fromEntries(["jobs", "planCandidateCheckpoints", "sites"].map(name => {
  const bundle = buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const runtime = { exports: {} as Record<string, Handler> };
  runInNewContext(bundle, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url),
    Date: class extends Date { static now() { return now; } }, URL, TextEncoder, console, process: { env: {} } });
  return [name, runtime.exports];
}));

function fixture(cadence = 7, id = "site") {
  const features = ["max_sites_unlimited", "max_articles_150"];
  const tables: Record<string, Row[]> = {
    sites: [{ _id: id, userId: `owner-${id}`, domain: `${id}.example`, cadencePerWeek: cadence,
      autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 1,
      expectedClickSchedulingEnabled: true, planFeatures: features }],
    account_plan_entitlements: [{ _id: "entitlement", userId: `owner-${id}`, status: "completed",
      maxSites: 9999, maxArticles: 150, planFeatures: features }],
    account_deletion_receipts: [], usage_log: [], jobs: [], provider_spend_reservations: [],
    topic_clusters: [], article_summaries: [], seo_growth_goals: [], plan_candidate_checkpoints: [], autopilot_runs: [],
    autopilot_alerts: [], article_generation_attempts: [],
  };
  const scheduled: Row[] = [];
  const row = (key: unknown) => Object.values(tables).flat().find(r => r._id === key);
  const ctx = { db: {
    async get(key: string) { return structuredClone(row(key) ?? null); },
    async patch(key: string, patch: Row) { assert.ok(row(key), `missing ${key}`); Object.assign(row(key)!, structuredClone(patch)); },
    async insert(table: string, value: Row) {
      assert.ok(tables[table], `unexpected insert ${table}`);
      const key = `${table}-${tables[table].length}`; tables[table].push({ _id: key, ...structuredClone(value) }); return key;
    },
    query(table: string) {
      assert.ok(tables[table], `unexpected query ${table}`);
      const predicates: Array<(r: Row) => boolean> = [];
      const range = {
        eq(key: string, value: unknown) { predicates.push(r => r[key] === value); return range; },
        gte(key: string, value: number) { predicates.push(r => typeof r[key] === "number" && (r[key] as number) >= value); return range; },
        lt(key: string, value: number) { predicates.push(r => typeof r[key] === "number" && (r[key] as number) < value); return range; },
      };
      let direction = 1;
      const found = () => tables[table].filter(r => predicates.every(p => p(r)))
        .sort((a, b) => direction * (Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)));
      const chain = {
        withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        filter(fn: (q: typeof filters) => Expression) { const expression = fn(filters); predicates.push(r => Boolean(expression(r))); return chain; },
        order(order: string) { direction = order === "desc" ? -1 : 1; return chain; },
        async take(limit: number) { assert.ok(limit > 0 && limit <= 2001); return structuredClone(found().slice(0, limit)); },
        async collect() { return structuredClone(found()); },
        async first() { return structuredClone(found()[0] ?? null); },
        async unique() { assert.ok(found().length <= 1); return structuredClone(found()[0] ?? null); },
      }; return chain;
    },
  }, scheduler: {
    async runAfter(delay: number, _fn: unknown, args: Row) { scheduled.push({ delay, ...args }); return "scheduled"; },
    async runAt(at: number, _fn: unknown, args: Row) { scheduled.push({ at, ...args }); return "scheduled"; },
  } };
  return { tables, row, scheduled, id,
    async run(module: string, name: string, args: Row) {
      const before = structuredClone(tables), scheduledBefore = structuredClone(scheduled);
      try { return structuredClone(await modules[module][name]._handler(ctx, args)); }
      catch (error) { for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        scheduled.splice(0, scheduled.length, ...scheduledBefore); throw error; }
    },
  };
}

async function queued(f: ReturnType<typeof fixture>, overrides: Row = {}) {
  const result = await f.run("jobs", "queuePlanIfAbsent", { siteId: f.id, reason: "topic_evidence_replenishment", ...overrides });
  assert.equal(result.queued, true, JSON.stringify(result));
  const job = f.row(result.jobId)!;
  return { job, spend: f.row(job.providerSpendReservationId)! };
}
function claim(job: Row) { Object.assign(job, { status: "running", workerToken: "lease", leaseExpiresAt: now + 60_000 }); }

test("real automatic queue reserves one execution atomically for different tenants and cadences", async () => {
  for (const cadence of [7, 21]) for (const id of ["a", "b"]) {
    const f = fixture(cadence, id); const { job, spend } = await queued(f);
    assert.equal((job.payload as Row).planProviderEnvelopeVersion, 2);
    assert.equal(job.providerCostReservedMicroUsd, 1_000_000);
    assert.equal(job.providerCostCeilingMicroUsd, 1_000_000);
    assert.equal(spend.reservedMicroUsd, 1_000_000);
    assert.equal(spend.userId, `owner-${id}`);
    const before = structuredClone(f.tables);
    assert.equal((await f.run("jobs", "queuePlanIfAbsent", { siteId: id, reason: "topic_evidence_replenishment" })).reason, "active");
    assert.deepEqual(f.tables, before, "duplicate admission cannot reserve or enqueue twice");
    claim(job);
    assert.deepEqual(await f.run("planCandidateCheckpoints", "authorizeSingleExecution", {
      siteId: id, jobId: job._id, workerToken: "lease", workerExecution: 1,
    }), { checkpointEnabled: true, workerExecution: 1 });
    await assert.rejects(f.run("planCandidateCheckpoints", "authorizeSingleExecution", {
      siteId: id, jobId: job._id, workerToken: "lease", workerExecution: 2,
    }));
  }
});

test("one-execution envelopes admit affordable work without widening account or fleet caps", async () => {
  for (const used of [8_100_000, 8_600_001]) {
    const f = fixture(); f.tables.provider_spend_reservations.push({ _id: "prior", siteId: f.id,
      userId: `owner-${f.id}`, purpose: "article_generation", reservedMicroUsd: used, createdAt: now - 1000 });
    const prior = structuredClone(f.tables.provider_spend_reservations[0]);
    const result = await f.run("jobs", "queuePlanIfAbsent", { siteId: f.id, reason: "topic_evidence_replenishment" });
    assert.equal(result.queued, used === 8_100_000, JSON.stringify(result));
    if (!result.queued) assert.equal(result.reason, "provider_account_daily_budget_reserved");
    assert.deepEqual(f.tables.provider_spend_reservations[0], prior, "historical reservations are not repriced");
  }
  const f = fixture(); f.tables.provider_spend_reservations.push({ _id: "prior", siteId: f.id,
    userId: `owner-${f.id}`, purpose: "article_generation", reservedMicroUsd: 8_100_000, createdAt: now - 1000 });
  const result = await f.run("jobs", "queuePlanIfAbsent", { siteId: f.id, reason: "owner_requested_plan", manual: true });
  assert.equal(result.queued, false, "a manual two-execution plan still requires its full envelope");
  assert.equal(result.reason, "provider_account_daily_budget_reserved");
});

test("manual and marker-absent producer policies keep the original two-execution amount", async () => {
  for (const automatic of [true, false]) {
    const f = fixture(); if (automatic) f.row(f.id)!.expectedClickSchedulingEnabled = false;
    const { job, spend } = await queued(f, automatic ? {} : { manual: true, reason: "owner_requested_plan" });
    assert.equal((job.payload as Row).planProviderEnvelopeVersion, undefined);
    assert.equal(job.providerCostReservedMicroUsd, 2_000_000);
    assert.equal(spend.reservedMicroUsd, 2_000_000);
  }
});

test("a reduced envelope is valid only for the exact versioned single-execution contract", () => {
  const payload = { reason: "topic_evidence_replenishment", planCheckpointModeVersion: 1, planProviderEnvelopeVersion: 2,
    planYieldTarget: automaticPlanYieldTarget({ targetBufferShortfall: 4, verifiedHorizonShortfall: 7, articleQuotaHeadroom: 20 }) };
  const job = { payload, providerCostReservedMicroUsd: 1_000_000, providerCostCeilingMicroUsd: 1_000_000 };
  assert.equal(planProviderAmountsMatch(job, 1_000_000), true);
  assert.equal(planProviderAmountsMatch(job, undefined), false);
  assert.equal(planProviderAmountsMatch(job, 2_000_000), false);
  for (const patch of [{ manual: true }, { reason: "owner_plan" }, { oneSetupExecutionId: "setup" },
    { growthParentArticleId: "article" }, { expectedClickPlanMigrationVersion: 1 }, { planCheckpointModeVersion: 0 },
    { planProviderEnvelopeVersion: 3 }, { planProviderEnvelopeVersion: null }, { planYieldTarget: {} },
    { underfilledPlanContinuation: {} }]) {
    assert.equal(planProviderEnvelopeMicroUsd({ ...payload, ...patch }), null, JSON.stringify(patch));
  }
  assert.equal(planProviderEnvelopeMicroUsd({ reason: "owner_plan" }), 2_000_000);
});

test("new envelope rejects paid-boundary ownership, ledger and payload drift", async () => {
  for (const [target, patch] of [
    ["spend", { reservedMicroUsd: 2_000_000 }], ["spend", { userId: "foreign" }],
    ["spend", { siteId: "foreign" }], ["spend", { settledAt: now }], ["spend", { settledMicroUsd: 0 }],
    ["spend", { releasedAt: now }], ["spend", { reservationDay: "2026-09-05" }],
    ["job", { providerCostCeilingMicroUsd: 2_000_000 }], ["job", { workerAttempts: 1 }],
    ["job", { payload: { planProviderEnvelopeVersion: 2, manual: true } }],
  ] as Array<[string, Row]>) {
    const f = fixture(); const { job, spend } = await queued(f); claim(job);
    Object.assign(target === "job" ? job : spend, patch);
    const before = structuredClone(f.tables);
    await assert.rejects(f.run("planCandidateCheckpoints", "authorizeSingleExecution", {
      siteId: f.id, jobId: job._id, workerToken: "lease", workerExecution: 1,
    }), /Plan checkpoint/, JSON.stringify(patch));
    assert.deepEqual(f.tables, before);
  }
});

test("known pre-provider failures release the new amount once and never rewrite its original receipt", async () => {
  const f = fixture(); const { job, spend } = await queued(f); claim(job);
  const args = { siteId: f.id, jobId: job._id, workerToken: "lease", releaseReason: "provider_balance_insufficient" };
  assert.equal((await f.run("jobs", "abortPlanForProviderBalance", args)).released, true);
  assert.equal(spend.reservedMicroUsd, 1_000_000);
  assert.equal(spend.releasedAt, now);
  const before = structuredClone(f.tables);
  assert.equal((await f.run("jobs", "abortPlanForProviderBalance", args)).updated, false);
  assert.deepEqual(f.tables, before);
});

test("real worker failure does not replay a single-execution plan or release ambiguous spend", async () => {
  const f = fixture(); const { job, spend } = await queued(f); claim(job);
  const result = await f.run("jobs", "markRetryableFailure", { jobId: job._id, workerToken: "lease", error: "Provider timeout" });
  assert.equal(result.willRetry, false);
  assert.equal(job.status, "failed");
  assert.equal(job.workerAttempts, 1);
  assert.equal(spend.releasedAt, undefined);
  assert.equal(spend.settledAt, undefined);
  assert.equal(f.scheduled.length, 0);
  assert.equal(f.tables.jobs.length, 1);
});

test("underfilled checkpoint output cannot obtain an unfunded continuation", async () => {
  const f = fixture(); const { job } = await queued(f);
  Object.assign(job, { status: "done", result: { planPersistenceCommit: {
    version: 1, commitNonce: "commit", workerExecution: 1, expectedClickSchedulingEnabled: true,
    acceptedTopicCount: 1, cumulativeTopicCount: 1, inserted: 1, revived: 0, skipped: 0,
    acceptedKeywordKeys: ["support request assignment"], committedAt: now,
  } } });
  const before = structuredClone(f.tables);
  const result = await f.run("jobs", "continueSuccessfulUnderfilledPlan", {
    siteId: f.id, jobId: job._id, workerToken: "lease", commitNonce: "commit", savedTopicCount: 1, firstResult: {},
  });
  assert.equal(result.reason, "checkpoint_single_execution");
  assert.deepEqual(f.tables, before);
  assert.equal(f.scheduled.length, 0);
});

test("a scheduling policy transition releases only untouched pending single-execution plans", async () => {
  for (const running of [false, true]) {
    const f = fixture(); const { job, spend } = await queued(f); if (running) claim(job);
    const result = await f.run("sites", "setExpectedClickScheduling", { siteId: f.id, enabled: false });
    assert.equal(result.cancelledJobs, 1);
    assert.equal(job.status, "failed");
    assert.equal(spend.reservedMicroUsd, 1_000_000);
    assert.equal(spend.releasedAt, running ? undefined : now);
    const before = structuredClone(f.tables);
    assert.equal((await f.run("sites", "setExpectedClickScheduling", { siteId: f.id, enabled: false })).cancelledJobs, 0);
    assert.deepEqual(f.tables, before);
  }
});

test("new reservation survives checkpoint staging, exact replay and per-candidate paid admission", async () => {
  const f = fixture(); const site = f.row(f.id)!;
  Object.assign(site, { niche: "Sales follow up automation software", anchorKeywords: ["sales follow up"],
    keyFeatures: ["automated sales follow up"], seoAuthorityDomain: `${f.id}.example`,
    seoAuthorityDomainRank: 40, seoAuthorityReferringDomains: 500,
    seoAuthoritySource: DATAFORSEO_AUTHORITY_SOURCE, seoAuthorityMeasuredAt: now });
  const { job } = await queued(f); claim(job);
  const keyword = "automated sales follow up";
  const fit = evaluateTopicBusinessFit({ keyword, label: keyword, ...tenantTopicBusinessSignals(site) });
  assert.equal(fit.eligible, true);
  const manifest = { siteId: f.id, planJobId: String(job._id), workerExecution: 1, replenishmentSequence: 0,
    locationCode: 2840, languageCode: "en", candidateCapacity: 1, seedBatches: [[keyword]] };
  const args = { ...manifest, jobId: job._id, workerToken: "lease", seedManifestHash: planSeedBatchManifestHash(manifest),
    candidates: [{ label: keyword, primaryKeyword: keyword, secondaryKeywords: [], searchVolume: 200,
      keywordDifficulty: 5, keywordDifficultyMeasured: true, searchDemandSource: DATAFORSEO_DEMAND_SOURCE,
      searchDemandMeasuredAt: now, searchDemandLocationCode: 2840, searchDemandLanguageCode: "en",
      businessFitEligible: true, businessFitScore: fit.score, businessFitVersion: fit.version, businessFitReasons: fit.reasons }] };
  const staged = await f.run("planCandidateCheckpoints", "stage", args);
  assert.equal(staged.active, true);
  const checkpoint = f.row(staged.checkpointId)!;
  assert.equal(checkpoint.providerCostReservedMicroUsd, 1_000_000);
  const before = structuredClone(f.tables);
  assert.equal((await f.run("planCandidateCheckpoints", "stage", args)).replay, true);
  assert.deepEqual(f.tables, before);
  const candidate = (staged.staged as Row[])[0];
  const begin = { siteId: f.id, jobId: job._id, workerToken: "lease", workerExecution: 1,
    checkpointId: staged.checkpointId, topicId: candidate.topicId, candidateFingerprint: candidate.candidateFingerprint };
  assert.equal((await f.run("planCandidateCheckpoints", "beginInlineSerp", begin)).allowed, true);
  assert.equal((await f.run("planCandidateCheckpoints", "beginInlineSerp", begin)).reason, "already_attempted");
});

test("lifecycle and monthly-count fences cannot be bypassed by the cheaper execution envelope", async () => {
  for (const patch of [{ deletionStatus: "deleting" }, { planParkedAt: now }, { domainOwnershipConflictAt: now }]) {
    const f = fixture(); Object.assign(f.row(f.id)!, patch); const before = structuredClone(f.tables);
    await assert.rejects(queued(f), /Site not found/);
    assert.deepEqual(f.tables, before);
  }
  const f = fixture();
  f.tables.provider_spend_reservations.push(...Array.from({ length: 15 }, (_, i) => ({
    _id: `past-${i}`, siteId: f.id, userId: `owner-${f.id}`, purpose: "topic_plan", createdAt: now - 86_400_000,
    reservedMicroUsd: 1_000_000, settledMicroUsd: 1_000_000, settledAt: now - 10_000,
  })));
  const before = structuredClone(f.tables);
  const result = await f.run("jobs", "queuePlanIfAbsent", { siteId: f.id, reason: "topic_evidence_replenishment" });
  assert.equal(result.reason, "plan_headroom_exhausted");
  assert.deepEqual(f.tables, before);
});
