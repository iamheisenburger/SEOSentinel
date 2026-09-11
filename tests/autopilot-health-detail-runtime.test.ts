import assert from "node:assert/strict";
import test from "node:test";
import { corePipelineFixture, START } from "./helpers/core-pipeline-fixture.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";
import { autopilotHealthStatus } from "../convex/lib/autopilotBuffer.ts";
import { AUTOPILOT_OPERATOR_HEALTH_STATUSES } from "../convex/lib/autopilotRunOutcome.ts";
import { AUTOPILOT_HEALTH_DETAILS, autopilotHealthDetail } from "../convex/lib/autopilotHealthDetail.ts";

const DAY = 86_400_000;
const healthy = AUTOPILOT_HEALTH_DETAILS.healthy;
function fixture(domain = "orchard.example") {
  const f = corePipelineFixture(async () => { assert.fail("Health presentation may not call providers"); });
  const userId = `synthetic-${domain}`;
  const features = ["max_sites_unlimited", "max_articles_150"];
  f.add("account_plan_entitlements", { userId, status: "completed", maxSites: 9999, maxArticles: 150, planFeatures: features });
  const siteId = f.add("sites", { userId, domain, siteName: domain, createdAt: START - 10_000,
    updatedAt: START - 10_000, autopilotEnabled: true, autopilotRolloutMode: "live",
    cadencePerWeek: 7, approvalRequired: false, planFeatures: features });
  f.add("maintenance_state", { key: "publication-integrity-v4", status: "completed" });
  const runId = f.add("autopilot_runs", { siteId, trigger: "natural", status: "completed",
    outcome: "planning_blocked", scheduledAt: START - 2000, completedAt: START - 1000 });
  const healthId = f.add("autopilot_health", { siteId, status: "planning_blocked", lastRunId: runId,
    lastNaturalScheduledAt: START - 2000, heartbeatAt: START - 1000, updatedAt: START - 1000 });
  function ready(count: number, updatedAt = START - 5000) {
    for (let i = 0; i < count; i++) f.add("article_summaries", { siteId,
      articleId: `articles:synthetic-${domain}-${i}-${updatedAt}`, status: "ready",
      articleCreatedAt: updatedAt, articleUpdatedAt: updatedAt, title: "Metadata, not article acceptance", slug: `metadata-${i}`,
      publicationGateStatus: "passed", publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "a".repeat(64), publicationConfigHash: "b".repeat(64) });
  }
  return { ...f, siteId, runId, healthId, ready, userId, health: () => f.get(healthId)! };
}

test("health detail covers every registered status; only explicitly healthy may make the healthy claim", () => {
  assert.deepEqual(Object.keys(AUTOPILOT_HEALTH_DETAILS).sort(), [...AUTOPILOT_OPERATOR_HEALTH_STATUSES].sort());
  for (const status of AUTOPILOT_OPERATOR_HEALTH_STATUSES) {
    assert.equal(autopilotHealthDetail({ status }) === healthy, status === "healthy", status);
  }
  for (const status of ["future_unknown", "__proto__", "constructor"]) {
    assert.match(autopilotHealthDetail({ status }), /unrecognized/);
  }
  assert.notEqual(autopilotHealthDetail({ status: "healthy", publicationMissed: true }), healthy);
  assert.notEqual(AUTOPILOT_HEALTH_DETAILS.planning_blocked, AUTOPILOT_HEALTH_DETAILS.cadence_failure_cooldown);
  assert.notEqual(AUTOPILOT_HEALTH_DETAILS.provider_funding_paused, AUTOPILOT_HEALTH_DETAILS.provider_allowance_paused);
});

for (const domain of ["orchard.example", "freight.example"]) {
  test(`${domain}: actual refresh and SLA preserve every fail-closed policy result without healthy fallback`, async () => {
    const f = fixture(domain); f.ready(1);
    // Exercise the real policy, including outcomes it intentionally normalizes
    // to buffer_low. Presentation must not change that pre-existing precedence.
    for (const outcome of [...AUTOPILOT_OPERATOR_HEALTH_STATUSES].filter(s => s !== "healthy" && s !== "recovering")) {
      f.get(f.runId)!.outcome = outcome;
      const expected = autopilotHealthStatus({ schedulerStale: false, publicationMissed: false,
        bufferCount: 1, bufferMinimum: 3, lastOutcome: outcome });
      for (const handler of ["autopilot:refreshSiteCadenceHealth", "autopilot:auditSla"]) {
        await f.invoke(handler, handler.endsWith("auditSla") ? {} : { siteId: f.siteId });
        assert.equal(f.health().status, expected, `${handler}: ${outcome}`);
        assert.equal(f.health().detail, autopilotHealthDetail({ status: expected }));
        assert.notEqual(f.health().detail, healthy);
        assert.equal(f.health().approvedBufferCount, 1);
        assert.equal(f.health().bufferMinimum, 3);
        assert.equal(f.health().nextPublicationDueAt, START - 10_000 + DAY);
      }
    }
    assert.equal(f.tables.jobs.length, 0);
    assert.equal(f.tables.provider_spend_reservations.length, 0);
    f.assertOffline();
  });
}

test("actual health handlers preserve genuine recovered health and distinguish running work", async () => {
  const f = fixture(); f.ready(3, START - 100);
  for (const handler of ["autopilot:refreshSiteCadenceHealth", "autopilot:auditSla"]) {
    await f.invoke(handler, handler.endsWith("auditSla") ? {} : { siteId: f.siteId });
    assert.equal(f.health().status, "healthy"); assert.equal(f.health().detail, healthy);
    assert.equal(f.health().approvedBufferCount, 3);
  }
  f.get(f.runId)!.status = "running";
  await f.invoke("autopilot:refreshSiteCadenceHealth", { siteId: f.siteId });
  assert.equal(f.health().status, "recovering"); assert.notEqual(f.health().detail, healthy);
  f.assertOffline();
});

test("missed/stale precedence and exact publication timestamps survive incomplete inventory and detail refresh", async () => {
  const f = fixture(); f.ready(1);
  const publishedAt = START - 2 * DAY, dueAt = publishedAt + DAY;
  f.add("article_summaries", { siteId: f.siteId, articleId: "articles:prior-metadata", status: "published",
    articleCreatedAt: publishedAt - 1000, articleUpdatedAt: publishedAt, publishedAt,
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION, auditedContentHash: "c".repeat(64) });
  f.health().lastNaturalScheduledAt = START - 5 * 3_600_000;
  for (const handler of ["autopilot:refreshSiteCadenceHealth", "autopilot:auditSla"]) {
    await f.invoke(handler, handler.endsWith("auditSla") ? {} : { siteId: f.siteId });
    assert.equal(f.health().status, "scheduler_stale");
    assert.match(f.health().detail, /deadline missed.*heartbeat is stale/);
    assert.equal(f.health().lastPublishedAt, publishedAt); assert.equal(f.health().nextPublicationDueAt, dueAt);
  }
  for (let i = 0; i < 51; i++) f.add("article_summaries", { siteId: f.siteId, articleId: `articles:old-${i}`,
    status: "ready", canonicalDomain: "old.example", domainRevision: 1,
    articleCreatedAt: START + i, articleUpdatedAt: START + i });
  for (const handler of ["autopilot:refreshSiteCadenceHealth", "autopilot:auditSla"]) {
    await f.invoke(handler, handler.endsWith("auditSla") ? {} : { siteId: f.siteId });
    assert.equal(f.health().status, "publication_inventory_incomplete");
    assert.equal(f.health().bufferInventory.status, "partial");
    assert.equal(f.health().bufferInventory.usableCountLowerBound, 1);
    assert.equal(f.health().approvedBufferCount, undefined);
    assert.match(f.health().detail, /deadline missed/); assert.notEqual(f.health().detail, healthy);
    assert.equal(f.health().lastPublishedAt, publishedAt); assert.equal(f.health().nextPublicationDueAt, dueAt);
  }
  for (const row of f.tables.article_summaries) if (!row.canonicalDomain && row.status === "ready") row.status = "failed";
  for (const handler of ["autopilot:refreshSiteCadenceHealth", "autopilot:auditSla"]) {
    await f.invoke(handler, handler.endsWith("auditSla") ? {} : { siteId: f.siteId });
    assert.equal(f.health().bufferInventory.status, "unknown");
    assert.equal(f.health().approvedBufferCount, undefined);
    assert.match(f.health().detail, /deadline missed/);
    assert.equal(f.health().nextPublicationDueAt, dueAt);
  }
  f.assertOffline();
});

test("public health read corrects only legacy contradictory healthy copy, without writing or losing exact detail", async () => {
  const f = fixture(); f.setIdentity(f.userId);
  f.health().detail = healthy;
  const before = structuredClone(f.tables);
  const view = await f.invoke("autopilot:getHealthForSite", { siteId: f.siteId });
  assert.equal(view.health.status, "planning_blocked");
  assert.equal(view.health.detail, AUTOPILOT_HEALTH_DETAILS.planning_blocked);
  assert.deepEqual(f.tables, before);
  f.health().detail = "Exact recorded provider allowance blocker";
  assert.equal((await f.invoke("autopilot:getHealthForSite", { siteId: f.siteId })).health.detail,
    "Exact recorded provider allowance blocker");
  f.setIdentity("synthetic-other-owner");
  await assert.rejects(f.invoke("autopilot:getHealthForSite", { siteId: f.siteId }), /Not authorized/);
  f.assertOffline();
});
