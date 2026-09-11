import assert from "node:assert/strict";
import test from "node:test";
import { corePipelineFixture, START } from "./helpers/core-pipeline-fixture.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

const DAY = 86_400_000;
function projectionFixture() {
  const f = corePipelineFixture(async () => { assert.fail("Projection isolation must not contact a provider"); });
  const sites = ["one.example", "two.example"].map(domain => {
    const userId = `synthetic-${domain}`;
    f.add("account_plan_entitlements", { userId, status: "completed", maxSites: 9999,
      maxArticles: 150, planFeatures: ["max_sites_unlimited", "max_articles_150"] });
    const siteId = f.add("sites", { domain, siteName: domain, userId, createdAt: START - 2 * DAY,
      updatedAt: START - DAY, autopilotEnabled: true, autopilotRolloutMode: "live",
      autopilotRolloutEpoch: 0, cadencePerWeek: 7, approvalRequired: false, publishMethod: "github",
      repoOwner: "synthetic", repoName: domain, repoDefaultBranch: "main", githubToken: "synthetic-only",
      gscAccessToken: "synthetic-only", gscProperty: `sc-domain:${domain}`,
      niche: "Irrigation maintenance scheduling software", blogTheme: "Irrigation workflow",
      siteSummary: "Software for recording irrigation maintenance", anchorKeywords: ["irrigation scheduling"],
      language: "en", targetCountry: "United States", urlStructure: "/blog/[slug]",
      planFeatures: ["max_sites_unlimited", "max_articles_150"] });
    f.add("pages", { siteId, slug: "/", url: `https://${domain}/`, title: "Irrigation software", createdAt: START - DAY });
    return siteId;
  });
  f.add("maintenance_state", { key: "publication-integrity-v4", status: "completed" });
  return { ...f, sites };
}
function legacyWindow(f: ReturnType<typeof projectionFixture>, siteId: string) {
  // Projection-only metadata, not generated/sealed-article acceptance fixtures.
  for (let i = 0; i < 51; i++) f.add("article_summaries", {
    siteId, articleId: `articles:old-${siteId}-${i}`, status: "ready",
    canonicalDomain: "old.example", domainRevision: 1, articleCreatedAt: START - 1000 + i,
    articleUpdatedAt: START - 1000 + i, title: `Old metadata ${i}`, slug: `old-${i}`,
  });
}
function runningRun(f: ReturnType<typeof projectionFixture>, siteId: string) {
  return f.add("autopilot_runs", { siteId, trigger: "natural", status: "running",
    scheduledAt: START - 10, startedAt: START - 5, heartbeatAt: START - 5 });
}
type Fixture = ReturnType<typeof projectionFixture>;
function readyMetadata(f: Fixture, siteId: string, suffix: string, createdAt = START - 500) {
  const articleId = `articles:projection-${siteId}-${suffix}`;
  f.add("article_summaries", { siteId, articleId, status: "ready", articleCreatedAt: createdAt,
    articleUpdatedAt: createdAt, title: "Projection metadata only", slug: suffix,
    publicationGateStatus: "passed", publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "a".repeat(64), publicationConfigHash: "b".repeat(64) });
  return articleId;
}
const faultCodes = {
  legacy: "article_summary_domain_window_incomplete",
  candidates: "publication_buffer_scan_incomplete",
  history: "publication_history_incomplete",
  binding: "publication_history_binding_mismatch",
} as const;
function fault(f: Fixture, siteId: string, kind: keyof typeof faultCodes) {
  if (kind === "legacy") return legacyWindow(f, siteId);
  for (let i = 0; i < (kind === "candidates" ? 51 : 1); i++) {
    const articleId = readyMetadata(f, siteId, `fault-${i}`, START - 1000 + i);
    for (let j = 0; j < (kind === "history" ? 101 : 1); j++) f.add("jobs", {
      siteId, articleId, type: "article", status: "failed", createdAt: START - 100,
      updatedAt: START - 100, publicationAttempts: kind === "candidates" ? 3 : 0,
      payload: kind === "binding" ? { articleId: "articles:conflicting-binding" } : { articleId },
    });
  }
}
function deadline(f: Fixture, siteId: string, publishedAt = START - 2 * DAY) {
  f.add("article_summaries", { siteId, articleId: `articles:previous-${siteId}`, status: "published",
    articleCreatedAt: publishedAt - 1000, articleUpdatedAt: publishedAt, publishedAt,
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION, auditedContentHash: "c".repeat(64),
    publicUrlStatus: "verified", title: "Previous receipt metadata", slug: "previous" });
  const dueAt = publishedAt + DAY;
  const runId = f.add("autopilot_runs", { siteId, trigger: "cadence_deadline", status: "scheduled",
    scheduledAt: dueAt, dueAt, deadlineKind: "cadence_deadline", rolloutEpoch: 0 });
  return { dueAt, runId, publishedAt };
}
function assertInventory(value: { status: string; usableCountLowerBound: number; blockers: string[] },
  kind: keyof typeof faultCodes, lowerBound = 0) {
  assert.equal(value.status, lowerBound ? "partial" : "unknown");
  assert.equal(value.usableCountLowerBound, lowerBound);
  assert.deepEqual(value.blockers, [faultCodes[kind]]);
}

test("incomplete legacy inventory does not hide a healthy peer in the actual fleet reader", async () => {
  const f = projectionFixture();
  assert.equal((await f.invoke("autopilot:getFleetReadiness", {})).length, 2);
  legacyWindow(f, f.sites[0]);
  const rows = await f.invoke("autopilot:getFleetReadiness", {});
  assert.equal(rows.length, 2);
  const bad = rows.find((row: { siteId: string }) => row.siteId === f.sites[0]);
  const peer = rows.find((row: { siteId: string }) => row.siteId === f.sites[1]);
  assert.equal(bad.bufferInventory.status, "unknown");
  assert.ok(bad.bufferInventory.blockers.includes("article_summary_domain_window_incomplete"));
  assert.equal(bad.sealedBufferCount, undefined); assert.equal(bad.liveReady, false);
  assert.equal(peer.bufferInventory.status, "complete"); assert.equal(peer.sealedBufferCount, 0);
  assert.equal(f.tables.jobs.length, 0); f.assertOffline();
});

test("incomplete inventory cannot roll back atomic natural-run completion to running", async () => {
  const f = projectionFixture(), siteId = f.sites[0];
  const control = runningRun(f, siteId);
  await f.invoke("autopilot:markRunFinished", { runId: control, outcome: "publication_delivery_terminal" });
  assert.equal(f.get(control)!.status, "completed");
  legacyWindow(f, siteId);
  const runId = runningRun(f, siteId);
  f.get(runId)!.recoveryOfRunId = control;
  let failure: unknown;
  try { await f.invoke("autopilot:markRunFinished", { runId, outcome: "publication_delivery_terminal" }); }
  catch (error) { failure = error; }
  assert.equal(f.get(runId)!.status, "completed", String(failure));
  assert.equal(f.get(runId)!.completedAt, START);
  assert.equal(f.get(runId)!.outcome, "publication_inventory_incomplete");
  assert.equal(f.get(runId)!.bufferInventory.status, "unknown");
  const health = f.tables.autopilot_health.find(row => row.siteId === siteId)!;
  assert.equal(health.approvedBufferCount, undefined);
  assert.equal(health.bufferInventory.status, "unknown");
  const receipt = structuredClone(f.get(runId));
  f.setTime(START + 1);
  assert.equal((await f.invoke("autopilot:markRunFinished", { runId, outcome: "buffer_full", detail: "duplicate" })).reason, "run_not_active");
  assert.deepEqual(f.get(runId), receipt); assert.equal(f.get(runId)!.recoveryOfRunId, control);
  assert.equal(f.tables.jobs.length, 0); f.assertOffline();
});

test("actual autopilotTick stops incomplete inventory before onboarding or providers and durably finishes", async () => {
  const f = projectionFixture(), siteId = f.sites[0];
  legacyWindow(f, siteId);
  f.get(siteId)!.contentAnalysisCanonicalDomain = "stale.example";
  f.get(siteId)!.autopilotRolloutMode = "warm";
  const runId = runningRun(f, siteId); f.get(runId)!.status = "scheduled";
  let failure: unknown;
  try { await f.invoke("actions/pipeline:autopilotTick", { siteId, runId, trigger: "natural" }); }
  catch (error) { failure = error; }
  assert.equal(f.trace.filter(row => row.name === "network").length, 0, String(failure));
  assert.equal(f.get(runId)!.status, "completed", String(failure));
  assert.equal(f.get(runId)!.outcome, "publication_inventory_incomplete");
  assert.equal(f.get(runId)!.bufferInventory.status, "unknown");
  assert.equal(f.tables.jobs.length, 0);
  f.assertOffline();
});

for (const kind of Object.keys(faultCodes) as Array<keyof typeof faultCodes>) {
  for (const badIndex of [0, 1]) test(`${kind} inventory, bad tenant ${badIndex ? "last" : "first"}: actual SLA, fleet, operator, health and completion stay site-scoped`, async () => {
    const f = projectionFixture(), siteId = f.sites[badIndex], peerId = f.sites[1 - badIndex];
    fault(f, siteId, kind);
    const badDeadline = deadline(f, siteId), peerDeadline = deadline(f, peerId, START - 1000);
    for (let i = 0; i < 4; i++) readyMetadata(f, peerId, `peer-${i}`);
    f.add("autopilot_health", { siteId, heartbeatAt: START, approvedBufferCount: 42,
      status: "healthy", nextPublicationDueAt: badDeadline.dueAt });
    const beforeJobs = structuredClone(f.tables.jobs);
    const audit = await f.invoke("autopilot:auditSla", {});
    assert.equal(audit.inventoryIncomplete, 1); assert.equal(audit.missed, 1);
    const health = f.tables.autopilot_health.find(row => row.siteId === siteId)!;
    assertInventory(health.bufferInventory, kind);
    assert.equal(health.approvedBufferCount, undefined); assert.equal(health.status, "publication_inventory_incomplete");
    assert.equal(health.nextPublicationDueAt, badDeadline.dueAt); assert.equal(health.lastPublishedAt, badDeadline.publishedAt);
    const peerHealth = f.tables.autopilot_health.find(row => row.siteId === peerId)!;
    assert.equal(peerHealth.approvedBufferCount, 4); assert.equal(peerHealth.status, "healthy");
    assert.equal(peerHealth.nextPublicationDueAt, peerDeadline.dueAt);
    const alerts = f.tables.autopilot_alerts.filter(row => row.siteId === siteId && row.status === "active");
    assert.ok(alerts.some(row => row.kind === "missed_publication_sla"));
    assert.ok(alerts.some(row => row.kind === "publication_inventory_incomplete"));
    assert.ok(!alerts.some(row => row.kind === "buffer_empty" || row.kind === "buffer_low"));
    for (const name of ["autopilot:refreshSiteCadenceHealth", "autopilot:reconcileSealedBufferCount"]) {
      const result = await f.invoke(name, { siteId });
      assertInventory(result.bufferInventory, kind); assert.equal(result.approvedBufferCount, undefined);
      assert.equal(f.tables.autopilot_health.find(row => row.siteId === siteId)!.nextPublicationDueAt, badDeadline.dueAt);
    }
    const runId = runningRun(f, siteId);
    await f.invoke("autopilot:markRunFinished", { runId, outcome: "publication_delivery_terminal" });
    const run = f.get(runId)!;
    assert.equal(run.status, "completed"); assert.equal(run.completedAt, START);
    assert.equal(run.outcome, "publication_inventory_incomplete"); assertInventory(run.bufferInventory, kind);
    const snapshot = await f.invoke("autopilot:getOperatorSnapshot", { siteId });
    assertInventory(snapshot.bufferInventory, kind); assertInventory(snapshot.health.bufferInventory, kind);
    assert.equal(snapshot.health.approvedBufferCount, undefined);
    assert.equal(snapshot.cadenceDeadline.runId, badDeadline.runId);
    assert.equal(snapshot.cadenceDeadline.scheduledAt, badDeadline.dueAt);
    assert.equal(snapshot.cadenceDeadline.deadlineKind, "cadence_deadline");
    assert.equal(snapshot.health.status, "publication_inventory_incomplete");
    const completed = snapshot.runs.find((row: { runId: string }) => row.runId === runId);
    assert.equal(completed.status, "completed"); assertInventory(completed.bufferInventory, kind);
    const fleet = await f.invoke("autopilot:getFleetReadiness", {});
    assert.equal(fleet.length, 2);
    const bad = fleet.find((row: { siteId: string }) => row.siteId === siteId);
    const peer = fleet.find((row: { siteId: string }) => row.siteId === peerId);
    assertInventory(bad.bufferInventory, kind); assert.equal(bad.sealedBufferCount, undefined);
    assert.equal(bad.warmReady, false); assert.equal(bad.liveReady, false);
    assert.ok(bad.liveBlockers.includes(faultCodes[kind]));
    assert.equal(peer.sealedBufferCount, 4); assert.equal(peer.liveReady, true);
    assert.deepEqual(f.tables.jobs, beforeJobs); f.assertOffline();
  });

  test(`${kind}: actual scheduler and tick do not turn unknown inventory into paid refill`, async () => {
    const f = projectionFixture(), siteId = f.sites[0];
    fault(f, siteId, kind);
    const expected = deadline(f, siteId);
    const beforeJobs = structuredClone(f.tables.jobs);
    const schedule = await f.invoke("actions/scheduler:scheduleCadence", { siteId });
    assert.equal(schedule.mode, "publication_inventory_incomplete"); assert.equal(schedule.scheduled, 0);
    assert.equal(schedule.bufferCount, undefined); assertInventory(schedule.bufferInventory, kind);
    // An already pending non-publication job must not be processed by this
    // blocked tick. This is synthetic local metadata, not a live queue edit.
    const pending = f.add("jobs", { siteId, type: "article", status: "pending", createdAt: START, updatedAt: START,
      rolloutEpoch: 0, payload: { projectionOnlyTest: true } });
    const runId = runningRun(f, siteId); f.get(runId)!.status = "scheduled";
    await f.invoke("actions/pipeline:autopilotTick", { siteId, runId, trigger: "natural" });
    assert.equal(f.get(runId)!.status, "completed"); assert.equal(f.get(runId)!.completedAt, START);
    assert.equal(f.get(runId)!.outcome, "publication_inventory_incomplete"); assertInventory(f.get(runId)!.bufferInventory, kind);
    assert.equal(f.get(pending)!.status, "pending");
    assert.equal(f.tables.jobs.length, beforeJobs.length + 1);
    assert.deepEqual(f.tables.jobs.filter(row => row._id !== pending), beforeJobs);
    assert.equal(f.trace.filter(row => row.name === "network" || row.name === "actions/pipeline:processNextJob").length, 0);
    const health = f.tables.autopilot_health.find(row => row.siteId === siteId)!;
    assert.equal(health.nextPublicationDueAt, expected.dueAt); assert.equal(health.lastPublishedAt, expected.publishedAt);
    f.assertOffline();
  });
}

test("positive lower bounds stay partial: no early delivery, refill, automatic or controlled promotion", async () => {
  const f = projectionFixture(), siteId = f.sites[0];
  fault(f, siteId, "history");
  for (let i = 0; i < 4; i++) readyMetadata(f, siteId, `clean-${i}`);
  const expected = deadline(f, siteId, START - 1000);
  const schedule = await f.invoke("actions/scheduler:scheduleCadence", { siteId });
  assert.equal(schedule.mode, "publication_inventory_incomplete"); assert.equal(schedule.bufferCount, undefined);
  assertInventory(schedule.bufferInventory, "history", 4);
  assert.ok(f.trace.some(row => row.name === "autopilot:scheduleCadenceDeadline" && row.args.dueAt === expected.dueAt));
  f.get(siteId)!.autopilotRolloutMode = "warm";
  const before = structuredClone(f.get(siteId));
  const promotion = await f.invoke("autopilot:promoteWarmSiteIfReady", { siteId });
  assert.equal(promotion.promoted, false); assert.equal(promotion.sealedCount, undefined);
  assertInventory(promotion.bufferInventory, "history", 4);
  assert.ok(promotion.blockers.includes("publication_inventory_incomplete"));
  await assert.rejects(f.invoke("sites:setAutopilotRollout", { siteId, mode: "live" }), /Publication inventory is partial.*publication_history_incomplete/);
  assert.deepEqual(f.get(siteId), before);
  assert.equal(f.tables.jobs.filter(row => row.status === "pending").length, 0);
  f.assertOffline();
});

test("complete empty is exact zero, not unknown; deterministic recovery clears incomplete health and alert", async () => {
  const f = projectionFixture(), siteId = f.sites[0];
  fault(f, siteId, "candidates");
  await f.invoke("autopilot:refreshSiteCadenceHealth", { siteId });
  // A test-only metadata transition demonstrates rereading current truth;
  // production never deletes reservations or resets attempts for recovery.
  for (const row of f.tables.article_summaries) if (row.siteId === siteId) row.status = "failed";
  const result = await f.invoke("autopilot:reconcileSealedBufferCount", { siteId });
  assert.deepEqual(result.bufferInventory, { status: "complete", usableCountLowerBound: 0, inspectedCandidates: 0, blockers: [] });
  assert.equal(result.approvedBufferCount, 0);
  const health = f.tables.autopilot_health.find(row => row.siteId === siteId)!;
  assert.equal(health.status, "recovering");
  assert.ok(!f.tables.autopilot_alerts.some(row => row.siteId === siteId && row.kind === "publication_inventory_incomplete" && row.status === "active"));
  await f.invoke("autopilot:auditSla", {});
  assert.ok(f.tables.autopilot_alerts.some(row => row.siteId === siteId && row.kind === "buffer_empty" && row.status === "active"));
  const schedule = await f.invoke("actions/scheduler:scheduleCadence", { siteId });
  assert.notEqual(schedule.mode, "publication_inventory_incomplete");
  assert.ok(f.trace.some(row => row.name === "topics:getInventoryAuditInternal"), "Complete empty inventory reaches the ordinary guarded refill path");
  f.assertOffline();
});

test("real database, schema and authentication failures remain errors, not synthetic unknown projections", async () => {
  const f = projectionFixture(), siteId = f.sites[0], runId = runningRun(f, siteId);
  const unavailable = new Error("synthetic database unavailable");
  f.failReads("article_summaries", unavailable);
  for (const [name, args] of [
    ["autopilot:getFleetReadiness", {}], ["autopilot:auditSla", {}],
    ["autopilot:markRunFinished", { runId, outcome: "publication_delivery_terminal" }],
    ["autopilot:getOperatorSnapshot", { siteId }],
  ] as const) await assert.rejects(f.invoke(name, args), error => error === unavailable);
  assert.equal(f.get(runId)!.status, "running"); // Genuine transaction errors still roll back.
  assert.equal(f.tables.autopilot_health.length, 0);
  f.failReads("article_summaries");
  const sameText = new Error("article_summary_domain_window_incomplete");
  f.failReads("article_summaries", sameText);
  await assert.rejects(f.invoke("actions/scheduler:scheduleCadence", { siteId }), error => error === sameText,
    "Error text must not become expected incomplete-data control flow");
  f.failReads("article_summaries");
  await assert.rejects(f.invoke("autopilot:refreshSiteCadenceHealth", { siteId: 42 }), /real Convex validator/);
  await assert.rejects(f.invoke("autopilot:getHealthForSite", { siteId }), /auth|sign|unauthorized/i);
  f.assertOffline();
});

test("incomplete completion preserves an existing exact cadence receipt even when its published summary is unavailable", async () => {
  const f = projectionFixture(), siteId = f.sites[0];
  legacyWindow(f, siteId);
  const dueAt = START + DAY / 2, publishedAt = dueAt - DAY;
  f.add("autopilot_health", { siteId, status: "healthy", heartbeatAt: START,
    nextPublicationDueAt: dueAt, lastPublishedAt: publishedAt, approvedBufferCount: 4 });
  const deadlineId = f.add("autopilot_runs", { siteId, trigger: "cadence_deadline", status: "scheduled", scheduledAt: dueAt });
  const runId = runningRun(f, siteId);
  await f.invoke("autopilot:markRunFinished", { runId, outcome: "publication_delivery_terminal" });
  const snapshot = await f.invoke("autopilot:getOperatorSnapshot", { siteId });
  assert.equal(snapshot.health.nextPublicationDueAt, dueAt);
  assert.equal(snapshot.health.lastPublishedAt, publishedAt);
  assert.equal(snapshot.cadenceDeadline.runId, deadlineId);
  assertInventory(snapshot.bufferInventory, "legacy");
  assert.equal(f.get(runId)!.status, "completed"); f.assertOffline();
});
