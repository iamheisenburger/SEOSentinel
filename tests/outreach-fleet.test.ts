import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  planOutreachFleetSite,
  type OutreachFleetSiteState,
} from "../convex/actions/outreachFleet.ts";

function state(
  overrides: Partial<OutreachFleetSiteState> = {},
): OutreachFleetSiteState {
  return {
    siteId: "site-a",
    autopilotEnabled: true,
    autopilotRolloutMode: "live",
    inboxConfigurationValid: true,
    hasInbox: true,
    inboxProvider: "gmail",
    inboxStatus: "active",
    inboxMode: "approval",
    inboxVerified: true,
    hasVerifiedOpportunities: false,
    hasApprovedMessages: false,
    hasLinksToVerify: false,
    ...overrides,
  };
}

test("approved drafts never enter automatic fleet delivery", () => {
  const plan = planOutreachFleetSite(state({
    inboxMode: "live",
    hasApprovedMessages: true,
  }), "delivery");
  assert.equal(plan.deliver, false);
  assert.match(plan.failClosedReason ?? "", /Automatic outreach delivery is disabled/);
});

test("no inbox state can enable fleet delivery", () => {
  assert.equal(planOutreachFleetSite(state({
    inboxMode: "live",
    hasApprovedMessages: true,
  }), "delivery").deliver, false);
  assert.equal(planOutreachFleetSite(state({
    inboxMode: "live",
    hasApprovedMessages: true,
    inboxVerified: false,
  }), "delivery").deliver, false);
  assert.equal(planOutreachFleetSite(state({
    inboxMode: "live",
    hasApprovedMessages: true,
    inboxProvider: "resend",
  }), "delivery").deliver, false);
  assert.equal(planOutreachFleetSite(state({
    inboxMode: "live",
    hasApprovedMessages: true,
    inboxStatus: "suspended",
  }), "delivery").deliver, false);
});

test("maintenance prepares existing evidence and verifies links without discovery", () => {
  const plan = planOutreachFleetSite(state({
    inboxStatus: "connected",
    hasVerifiedOpportunities: true,
    hasLinksToVerify: true,
  }), "maintenance");
  assert.deepEqual(plan, {
    prepare: true,
    deliver: false,
    verify: true,
  });

  const source = readFileSync("convex/actions/outreachFleet.ts", "utf8");
  assert.match(source, /prepareOutreachInternal/);
  assert.doesNotMatch(source, /sendApprovedOutreachInternal/);
  assert.match(source, /verifyAcquiredLinksInternal/);
  assert.doesNotMatch(source, /analyzeBacklinksInternal|actions\.backlinks/);
});

test("duplicate inbox configuration fails closed for every fleet phase", () => {
  for (const phase of ["maintenance", "delivery"] as const) {
    const plan = planOutreachFleetSite(state({
      inboxConfigurationValid: false,
      inboxMode: "live",
      hasVerifiedOpportunities: true,
      hasApprovedMessages: true,
      hasLinksToVerify: true,
    }), phase);
    assert.deepEqual(
      { prepare: plan.prepare, deliver: plan.deliver, verify: plan.verify },
      { prepare: false, deliver: false, verify: false },
    );
  }
});

test("link verification remains eligible after an inbox is disconnected", () => {
  const plan = planOutreachFleetSite(state({
    hasInbox: false,
    inboxProvider: undefined,
    inboxStatus: undefined,
    inboxMode: undefined,
    inboxVerified: false,
    hasLinksToVerify: true,
  }), "maintenance");
  assert.equal(plan.prepare, false);
  assert.equal(plan.verify, true);
});

test("inbound fleet reads replies but can never deliver email", () => {
  const plan = planOutreachFleetSite(state({
    inboundMonitoringReady: true,
    hasMessagesToMonitor: true,
  }), "inbound");
  assert.deepEqual(plan, {
    prepare: false,
    deliver: false,
    verify: false,
    monitor: true,
  });
  const disconnected = planOutreachFleetSite(state({
    inboundMonitoringReady: false,
    hasMessagesToMonitor: true,
  }), "inbound");
  assert.equal(disconnected.monitor, false);
  assert.equal(disconnected.deliver, false);

  const source = readFileSync("convex/actions/outreachFleet.ts", "utf8");
  const crons = readFileSync("convex/crons.ts", "utf8");
  assert.match(source, /syncInboundRepliesInternal/);
  assert.match(crons, /outreach-inbound-fleet/);
  assert.match(crons, /phase: "inbound"/);
});

test("maintenance preparation is gated to an executing tenant rollout", () => {
  for (const overrides of [
    { autopilotEnabled: false, autopilotRolloutMode: "live" },
    { autopilotEnabled: true, autopilotRolloutMode: "observe" },
    { autopilotEnabled: true, autopilotRolloutMode: undefined },
  ]) {
    const plan = planOutreachFleetSite(state({
      hasVerifiedOpportunities: true,
      hasLinksToVerify: true,
      ...overrides,
    }), "maintenance");
    assert.equal(plan.prepare, false);
    assert.equal(
      plan.verify,
      true,
      "truthful link verification remains independent of drafting rollout",
    );
  }
});

test("fleet rechecks rollout readiness immediately before preparation", () => {
  const source = readFileSync("convex/actions/outreachFleet.ts", "utf8");
  const prepare = source.slice(
    source.indexOf("if (plan.prepare)"),
    source.indexOf("if (plan.verify)"),
  );
  assert.match(prepare, /internal\.sites\.getOutreachFleetState/);
  assert.match(prepare, /planOutreachFleetSite\(freshState, phase\)/);
  assert.ok(
    prepare.indexOf("getOutreachFleetState") <
      prepare.indexOf("prepareOutreachInternal"),
  );

  const outreach = readFileSync("convex/actions/outreach.ts", "utf8");
  const internalPrepare = outreach.slice(
    outreach.indexOf("export const prepareOutreachInternal"),
    outreach.indexOf("// ── Delivery ──"),
  );
  assert.match(internalPrepare, /isSeoGrowthActuationEligible\(site\)/);
});

test("fleet pagination and stage failures are tenant isolated", () => {
  const source = readFileSync("convex/actions/outreachFleet.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const crons = readFileSync("convex/crons.ts", "utf8");

  assert.match(source, /internal\.sites\.listOutreachFleetPage/);
  assert.match(source, /internal\.actions\.outreachFleet\.runSite/);
  assert.match(source, /internal\.actions\.outreachFleet\.dispatchFleet/);
  assert.match(source, /for \(const state of page\.page\)/);
  assert.match(source, /try \{[\s\S]*scheduler\.runAfter[\s\S]*\} catch/);
  assert.match(source, /Each stage catches its own failure/);
  assert.match(sites, /export const listOutreachFleetPage = internalQuery/);
  assert.match(sites, /export const getOutreachFleetState = internalQuery/);
  assert.match(sites, /autopilotEnabled: site\.autopilotEnabled === true/);
  assert.match(sites, /autopilotRolloutMode: site\.autopilotRolloutMode \?\? "observe"/);
  assert.match(sites, /withIndex\("by_site_status"/);
  assert.match(crons, /outreach-maintenance-fleet/);
  assert.doesNotMatch(crons, /outreach-approved-delivery-fleet/);
});
