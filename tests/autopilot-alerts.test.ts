import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  autopilotAlertRequiresAttention,
  dashboardAutopilotRequiresAttention,
  healthyReceiptSupersedesAlert,
  isInformationalAutopilotAlert,
  isRecoveredByHealthyAutopilotReceipt,
} from "../convex/lib/autopilotAlerts.ts";

const healthy = { status: "healthy", updatedAt: 500 };

test("queued topic replenishment is progress, not an automation blocker", () => {
  const queued = { kind: "topic_replenishment", updatedAt: 501 };
  const horizon = { kind: "topic_horizon_replenishment", updatedAt: 501 };
  assert.equal(isInformationalAutopilotAlert(queued.kind), true);
  assert.equal(autopilotAlertRequiresAttention(queued, healthy), false);
  assert.equal(autopilotAlertRequiresAttention(horizon, healthy), false);
});

test("a later healthy receipt supersedes recovered content failures", () => {
  for (const kind of [
    "article_provider_funding_unavailable",
    "job_failed",
    "job_retry_exhausted",
    "operator_warmup_run_failed",
    "quality_quarantined",
    "topic_replenishment_exhausted",
  ]) {
    const alert = { kind, updatedAt: 499 };
    assert.equal(isRecoveredByHealthyAutopilotReceipt(kind), true);
    assert.equal(healthyReceiptSupersedesAlert(alert, healthy), true);
    assert.equal(autopilotAlertRequiresAttention(alert, healthy), false);
  }
});

test("a newer failure and persistent delivery incidents still require attention", () => {
  assert.equal(
    autopilotAlertRequiresAttention(
      { kind: "job_failed", updatedAt: 501 },
      healthy,
    ),
    true,
  );
  for (const kind of [
    "publication_failed",
    "public_publication_unverified",
    "plan_spend_ambiguous",
  ]) {
    assert.equal(
      autopilotAlertRequiresAttention({ kind, updatedAt: 499 }, healthy),
      true,
    );
  }
});

test("healthy scheduler, cadence, and sealed buffer are not contradicted by stale alerts", () => {
  assert.equal(
    dashboardAutopilotRequiresAttention({
      health: healthy,
      alerts: [
        { kind: "job_failed", updatedAt: 400 },
        { kind: "job_retry_exhausted", updatedAt: 401 },
        { kind: "topic_horizon_replenishment", updatedAt: 502 },
        { kind: "operator_warmup_run_failed", updatedAt: 100 },
        { kind: "topic_replenishment", updatedAt: 502 },
      ],
    }),
    false,
  );
});

test("health query and writes reconcile stale alerts instead of trusting raw active rows", () => {
  const backend = readFileSync("convex/autopilot.ts", "utf8");
  const dashboard = readFileSync(
    "src/app/(dashboard)/dashboard/page.tsx",
    "utf8",
  );
  assert.match(
    backend,
    /patch\.status === "healthy"[\s\S]*resolveAlertsRecoveredByHealthyReceipt/,
  );
  assert.match(
    backend,
    /activeAlerts\.filter\(\(alert\) =>[\s\S]*autopilotAlertRequiresAttention\(alert, health\)/,
  );
  assert.match(dashboard, /dashboardAutopilotRequiresAttention/);
  assert.doesNotMatch(
    dashboard,
    /activeAutopilotAlerts\.length\s*>\s*0\s*\|\|/,
  );
});
