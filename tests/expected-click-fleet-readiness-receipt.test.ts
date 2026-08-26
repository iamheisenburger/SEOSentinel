import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_SKIP_REASONS,
  normalizeSkipReason,
} from "../convex/lib/expectedClickSkipReceipt.ts";

const fleet = readFileSync(
  new URL("../convex/actions/expectedClickBackfillFleet.ts", import.meta.url),
  "utf8",
);
const demand = readFileSync(
  new URL("../convex/expectedClickDemandBackfill.ts", import.meta.url),
  "utf8",
);
const evidence = readFileSync(
  new URL("../convex/expectedClickEvidenceBackfill.ts", import.meta.url),
  "utf8",
);

test("the natural daily fleet records both provider-free readiness refusals", () => {
  const runSite = fleet.slice(
    fleet.indexOf("export const runSite"),
    fleet.indexOf("export const runEvidenceSite"),
  );
  const runEvidenceSite = fleet.slice(
    fleet.indexOf("export const runEvidenceSite"),
    fleet.indexOf("export const recoverSite"),
  );

  assert.match(
    runSite,
    /runMutation\([\s\S]*inspectAndRecordFleetReadinessInternal/,
  );
  assert.doesNotMatch(
    runSite,
    /runQuery\([\s\S]*getFleetReadinessInternal/,
    "a read-only cheap gate would bypass the durable receipt again",
  );
  assert.match(
    runEvidenceSite,
    /runMutation\([\s\S]*inspectAndRecordFleetReadinessInternal/,
  );
  assert.doesNotMatch(
    runEvidenceSite,
    /runQuery\([\s\S]*getFleetReadinessInternal/,
  );
});

test("each inspection re-evaluates and records in one transaction", () => {
  for (const [source, kind] of [
    [demand, "demand"],
    [evidence, "evidence"],
  ] as const) {
    const start = source.indexOf(
      "export const inspectAndRecordFleetReadinessInternal",
    );
    assert.notEqual(start, -1);
    const body = source.slice(start, source.indexOf("\n});", start) + 4);
    assert.match(body, /internalMutation/);
    assert.match(body, /expectedClick(?:Demand|Evidence)FleetReadiness/);
    assert.match(body, /if \(readiness && !readiness\.ready\)/);
    assert.match(body, /recordExpectedClickReservationOutcome/);
    assert.match(body, new RegExp(`kind: "${kind}"`));
    assert.match(body, /candidateCounts: readiness\.candidateCounts/);
    assert.match(body, /selectedCandidateCount: readiness\.candidateCount/);
  }
});

test("every current provider-free refusal reason is operator-safe", () => {
  const required = [
    "provider_attempt_ambiguous",
    "demand_fleet_job_incomplete",
    "evidence_fleet_job_incomplete",
    "demand_phase_incomplete",
    "demand_phase_unavailable",
    "demand_candidates_remaining",
    "no_current_demand_candidates",
    "cadence_paused",
    "verified_keyword_mode_required",
    "plan_entitlement_missing",
    "site_limit_reached",
    "article_usage_read_limit_exhausted",
    "article_quota_no_headroom",
  ];
  for (const reason of required) {
    assert.ok(EXPECTED_CLICK_SKIP_REASONS.includes(reason as never), reason);
    assert.equal(normalizeSkipReason(reason), reason);
  }
});
