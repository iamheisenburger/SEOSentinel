import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals } from "../convex/lib/autopilotBuffer.ts";
import { DATAFORSEO_AUTHORITY_SOURCE, DATAFORSEO_DEMAND_SOURCE } from "../convex/lib/expectedClickPortfolio.ts";
import { EXPECTED_CLICK_DEMAND_BACKFILL_VERSION } from "../convex/lib/expectedClickDemandBackfill.ts";
import { EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION } from "../convex/lib/expectedClickEvidenceBackfill.ts";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 11, 14);
const code = buildSync({ entryPoints: ["convex/plannedTopicDiagnostics.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;

function fixture(business = "florist inventory") {
  const site: Row = { _id: "tenant-a", userId: "owner-a", domain: "flowers.test",
    autopilotEnabled: true, expectedClickSchedulingEnabled: true, autopilotRolloutMode: "live",
    autopilotRolloutEpoch: 2, cadencePerWeek: 7, targetCountry: "United States", language: "English",
    niche: `${business} software`, siteSummary: `${business} software for independent businesses`,
    blogTheme: business, targetAudienceSummary: `${business} teams`, productUsage: business,
    siteType: "SaaS", anchorKeywords: [`${business} software`], keyFeatures: [`${business} automation`],
    planFeatures: ["max_sites_unlimited", "max_articles_150"],
    seoAuthorityDomain: "flowers.test", seoAuthorityDomainRank: 20,
    seoAuthoritySource: DATAFORSEO_AUTHORITY_SOURCE, seoAuthorityMeasuredAt: now - 1000,
    githubToken: "SECRET-SITE", wpAppPassword: "SECRET-PASSWORD", webhookSecret: "SECRET-WEBHOOK" };
  const keyword = `${business} software`;
  const fit = evaluateTopicBusinessFit({ keyword, label: keyword, ...tenantTopicBusinessSignals(site as never) });
  assert.equal(fit.eligible, true);
  const topic: Row = { _id: "topic-a", siteId: site._id, primaryKeyword: keyword, label: keyword,
    status: "planned", keywordDifficultyMeasured: true, keywordDifficulty: 5,
    businessFitEligible: fit.eligible, businessFitVersion: fit.version,
    businessFitScore: fit.score, businessFitReasons: fit.reasons, createdAt: now - 5000, updatedAt: now - 4000,
    notes: "SECRET-TOPIC", secondaryKeywords: [] };
  const tables: Record<string, Row[]> = { topic_clusters: [topic],
    maintenance_state: [{ key: "publication-integrity-v4", status: "completed" }] };
  const reads: Array<{ table: string; index: string; limit: number; equality: Row }> = [];
  const runtime = { exports: {} as { inspectAdmission: { _handler: (ctx: unknown, args: unknown) => Promise<Row> } } };
  const noMutation = () => { throw Error("mutation/provider/scheduler forbidden"); };
  runInNewContext(code, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url),
    URL, TextEncoder, console, process: { env: {} }, fetch: noMutation,
    Date: class extends Date { static now() { return now; } } });
  const ctx = { scheduler: { runAfter: noMutation }, runAction: noMutation, runMutation: noMutation,
    db: { insert: noMutation, patch: noMutation, delete: noMutation,
      async get(id: string) { assert.equal(id, site._id, "never dereference a foreign topic/article/job ID"); return structuredClone(site); },
      query(table: string) {
        assert.notEqual(table, "articles", "diagnostic cannot load full Markdown");
        assert.notEqual(table, "sites", "enterprise fixture must never enumerate tenants");
        let index = ""; const equality: Row = {}; const predicates: Array<(r: Row) => boolean> = [];
        const range = { eq(k: string, v: unknown) { equality[k] = v; predicates.push(r => r[k] === v); return range; },
          gte(k: string, v: number) { predicates.push(r => Number(r[k]) >= v); return range; } };
        const query = { withIndex(name: string, f: (q: typeof range) => unknown) { index = name; f(range); return query; },
          async take(limit: number) {
            reads.push({ table, index, limit, equality }); assert.ok(Number.isInteger(limit) && limit <= 1001);
            if (["topic_clusters", "article_summaries", "jobs"].includes(table)) assert.equal(equality.siteId, site._id);
            return structuredClone((tables[table] ?? []).filter(r => predicates.every(p => p(r))).slice(0, limit));
          }, async first() { return (await query.take(1))[0] ?? null; },
          async unique() { const rows = await query.take(2); assert.ok(rows.length <= 1); return rows[0] ?? null; } };
        return query;
      },
    } };
  return { site, topic, tables, reads, run: (topicIds = ["topic-a"]) => runtime.exports.inspectAdmission._handler(ctx, { siteId: site._id, topicIds }) };
}

function topicResult(result: Row) { return (result.topics as Row[])[0] as Row; }
function rule(topic: Row, phase: string) { return (topic[phase] as Row).firstRule; }

test("actual read-only handler reports real positive admission without inventing selection or paid authorization", async () => {
  for (const business of ["florist inventory", "restaurant reservation"]) {
    const f = fixture(business); const result = await f.run(); const t = topicResult(result);
    assert.equal(result.complete, true); assert.equal((result.siteGate as Row).allowed, true);
    assert.equal((result.tenantAuthority as Row).fresh, true);
    assert.equal(rule(t, "demand"), "requires_ordinary_selection");
    assert.equal(rule(t, "evidence"), "current_positive_demand_required");
    assert.equal(t.selectionInspected, false);
    assert.ok(!JSON.stringify(result).includes("SECRET"));
    assert.ok(!JSON.stringify(result).includes("fingerprint"));
    assert.ok(f.reads.some(r => r.table === "topic_clusters" && r.limit === 513));
    assert.ok(f.reads.filter(r => r.table === "jobs").every(r => r.limit === 51));
  }
});

test("site and authority gates precede per-topic admission in the actual phase order", async () => {
  const paused = fixture(); paused.site.cadencePerWeek = 0; paused.topic.businessFitEligible = false;
  const p = topicResult(await paused.run());
  assert.equal(rule(p, "demand"), "cadence_paused"); assert.equal(rule(p, "evidence"), "cadence_paused");
  const stale = fixture(); stale.site.seoAuthorityMeasuredAt = now - 46 * 86400000;
  const s = topicResult(await stale.run());
  assert.equal(rule(s, "demand"), "tenant_authority_unavailable");
  assert.equal(rule(s, "evidence"), "current_positive_demand_required");
});

test("exact first blockers distinguish checkpoint, linkage, job, fit, KD and drift", async () => {
  const cases: Array<[Row, string]> = [
    [{ planCheckpointTerminalFailureCode: "SECRET-REASON" }, "plan_checkpoint_terminal"],
    [{ planCheckpointSerpAttemptedAt: now - 1 }, "plan_checkpoint_serp_already_attempted"],
    [{ businessFitEligible: false }, "business_fit_not_verified"],
    [{ keywordDifficultyMeasured: false }, "keyword_difficulty_unverified"],
    [{ businessFitVersion: -1 }, "business_fit_drifted"],
    [{ businessFitReasons: ["SECRET-STORED-REASON"] }, "business_fit_drifted"],
  ];
  for (const [patch, expected] of cases) {
    const f = fixture(); Object.assign(f.topic, patch); const result = await f.run();
    assert.equal(rule(topicResult(result), "demand"), expected); assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  const linked = fixture(); linked.tables.article_summaries = [{ articleId: "a", siteId: "tenant-a", topicId: "topic-a", status: "review" }];
  assert.equal(rule(topicResult(await linked.run()), "demand"), "linked_article_exists");
  const job = fixture(); job.tables.jobs = [{ _id: "job-a", siteId: "tenant-a", status: "running", type: "article", payload: { topicId: "topic-a", key: "SECRET-JOB" } }];
  assert.equal(rule(topicResult(await job.run()), "demand"), "active_article_job");
});

test("paid exact-keyword markers and current-zero demand are not inferred as replayable missing evidence", async () => {
  const f = fixture(); Object.assign(f.topic, { searchDemandBackfillAttemptVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
    searchDemandBackfillAttemptKeyword: f.topic.primaryKeyword, searchDemandBackfillAttemptedAt: now - 10 });
  assert.equal(rule(topicResult(await f.run()), "demand"), "exact_demand_already_attempted");
  Object.assign(f.topic, { searchDemandSource: DATAFORSEO_DEMAND_SOURCE, searchDemandMeasuredAt: now - 10,
    searchDemandLocationCode: 2840, searchDemandLanguageCode: "en", searchVolume: 0 });
  let t = topicResult(await f.run()); assert.equal(rule(t, "demand"), "demand_already_current");
  assert.equal(rule(t, "evidence"), "current_positive_demand_required");
  Object.assign(f.topic, { searchVolume: 100, expectedClickEvidenceAttemptVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
    expectedClickEvidenceAttemptKeyword: f.topic.primaryKeyword, expectedClickEvidenceAttemptedAt: now - 5 });
  t = topicResult(await f.run()); assert.equal(rule(t, "evidence"), "exact_evidence_already_attempted");
  f.topic.updatedAt = now; assert.equal(rule(topicResult(await f.run()), "evidence"), "exact_evidence_already_attempted");
});

test("existing published artifacts route before planned gates without being mislabeled blocked planned work", async () => {
  const f = fixture(); f.site.cadencePerWeek = 0;
  f.tables.article_summaries = [{ articleId: "published-a", siteId: "tenant-a", topicId: "topic-a", status: "published" }];
  const t = topicResult(await f.run());
  assert.equal(rule(t, "demand"), "artifact_route_not_planned_recovery");
  assert.equal(rule(t, "evidence"), "artifact_route_not_planned_recovery");
});

test("foreign IDs are rejected through tenant-indexed resolution without reading foreign records", async () => {
  const f = fixture(); f.tables.topic_clusters.push({ ...f.topic, _id: "foreign-topic", siteId: "other-tenant", primaryKeyword: "SECRET-FOREIGN" });
  await assert.rejects(f.run(["foreign-topic"]), /diagnostic_topic_scope_mismatch/);
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].equality.siteId, "tenant-a");
  assert.ok(!JSON.stringify(await f.run()).includes("SECRET-FOREIGN"));
});

test("input, inventory and active-job caps fail closed without publishing a false phase result", async () => {
  for (const ids of [[], ["topic-a", "topic-a"], Array.from({ length: 9 }, (_, i) => `t${i}`)]) {
    const f = fixture(); await assert.rejects(f.run(ids), /diagnostic_topic_bound/); assert.equal(f.reads.length, 0);
  }
  const topics = fixture(); topics.tables.topic_clusters = Array.from({ length: 513 }, (_, i) => ({ ...topics.topic, _id: `t${i}` }));
  const limited = await topics.run(["t0"]); assert.equal(limited.complete, false); assert.equal(limited.topics, undefined);
  assert.equal(topics.reads.length, 1);
  const jobs = fixture(); jobs.tables.jobs = Array.from({ length: 51 }, (_, i) => ({ _id: `j${i}`, siteId: "tenant-a", status: "running", type: "article" }));
  assert.equal((await jobs.run()).complete, false);
  const summaries = fixture(); summaries.tables.article_summaries = Array.from({ length: 513 }, (_, i) => ({ articleId: `a${i}`, siteId: "tenant-a" }));
  assert.equal((await summaries.run()).complete, false);
  const migration = fixture(); migration.tables.maintenance_state = []; assert.equal((await migration.run()).complete, false);
});
