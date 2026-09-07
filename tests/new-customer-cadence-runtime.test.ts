import assert from "node:assert/strict";
import test from "node:test";
import { newCustomerFixture as fixture, NOW, type Args } from "./helpers/new-customer-fixture.ts";

test("new customer creation and consent preserve every whole-number supported cadence", async () => {
  for (let cadence = 1; cadence <= 21; cadence++) {
    const f = fixture();
    await f.create(cadence);
    const site = f.tables.sites[0];
    assert.equal(site.canonicalDomain, "customer.example");
    assert.equal(site.canonicalDomainRevision, 0);
    assert.equal(site.cadencePerWeek, cadence);
    assert.equal(site.approvalRequired, true);
    assert.equal(site.autopilotRolloutMode, "observe");
    assert.equal(f.scheduled.length, 0);
    const saved = await f.run("sites", "saveOneSetupRequest", f.saveArgs(cadence));
    const request = f.tables.managed_provisioning_requests[0];
    assert.equal(request.requestedCadencePerWeek, cadence);
    assert.equal(request.domainRevisionSnapshot, 0);
    assert.ok(request.publisherAutopublishConsent);
    assert.equal(site.approvalRequired, false);
    // Consent alone cannot invent a connected/verified destination.
    assert.equal(site.autopilotRolloutMode, "observe");
    assert.equal(site.publicationAdapterVerifiedAt, undefined);
    assert.equal((request.publisher as Args).state, "owner_action_required");
    assert.deepEqual(f.scheduled.map(w => w.name), [
      "managedProvisioning:dispatchRequest", "oneSetupExecutions:bootstrapSavedExecution",
    ]);
    assert.deepEqual(f.scheduled[1].args, {
      requestId: saved.requestId, configurationRevision: saved.configurationRevision,
    });
  }
});

test("a closed browser after owner save still creates one exact execution and a recovery watchdog", async () => {
  const f = fixture();
  await f.create(14);
  await f.run("sites", "saveOneSetupRequest", f.saveArgs(14));
  const wake = f.scheduled.find(w => w.name === "oneSetupExecutions:bootstrapSavedExecution")!;
  const first = await f.run("oneSetupExecutions", "bootstrapSavedExecution", wake.args);
  assert.equal(first.state, "execution_bootstrapped");
  const execution = f.tables.one_setup_executions[0];
  assert.equal(execution.siteId, "sites-1");
  assert.equal(execution.requestedCadencePerWeek, 14);
  const resume = f.scheduled.find(w => w.name === "actions/pipeline:resumeOneSetupExecutionInternal")!;
  assert.equal(resume.args.expectedExecutionId, execution._id);
  assert.ok(f.scheduled.some(w => w.name === "oneSetupExecutions:recoverScheduledResumeDispatch" && w.at > NOW));
  // Simulate the normal action's claim racing the saved browser bootstrap.
  await f.run("oneSetupExecutions", "claim", { ...resume.args, claimNonce: "worker-1" });
  const again = await f.run("oneSetupExecutions", "bootstrapSavedExecution", wake.args);
  assert.equal(again.state, "claim_active");
  assert.equal(f.tables.one_setup_executions.length, 1);
  assert.equal(f.tables.jobs.length, 0, "The bootstrap/claim must not manufacture a provider job");
});

test("new customer cannot skip owner identity, cadence validity, consent, or adapter readiness", async () => {
  for (const cadence of [0, -1, 22, NaN, Infinity]) {
    const f = fixture();
    await assert.rejects(f.create(cadence), /target cadence/);
    assert.equal(f.writes.length, 0);
  }
  const anonymous = fixture();
  anonymous.signIn(null);
  await assert.rejects(anonymous.create(7), /Authentication required/);
  const bypass = fixture();
  await assert.rejects(bypass.create(7, { approvalRequired: false }), /authorize automatic publishing/);
  assert.equal(bypass.writes.length, 0);
  for (const [extra, expected] of [
    [{ publisherAutopublishConsentAccepted: false }, /Authorize automatic publishing/],
    [{ requestedCadencePerWeek: 14 }, /Save the site cadence/],
    [{ publisherKind: "wordpress" }, /remain beta/],
    [{ publisherKind: "webhook" }, /remain beta/],
  ] as const) {
    const f = fixture();
    await f.create(7);
    await assert.rejects(f.run("sites", "saveOneSetupRequest", f.saveArgs(7, extra)), expected);
    assert.equal(f.tables.sites[0].approvalRequired, true);
    assert.equal(f.tables.managed_provisioning_requests.length, 0);
    assert.equal(f.scheduled.length, 0);
  }
});

test("setup saves cannot overwrite a different owner and old configuration wakes cannot execute", async () => {
  const f = fixture();
  await f.create(7);
  await assert.rejects(f.create(14), /already connected/);
  f.signIn("another-customer");
  await assert.rejects(f.run("sites", "saveOneSetupRequest", f.saveArgs(7)), /Site not found/);
  f.signIn("customer");
  await f.run("sites", "saveOneSetupRequest", f.saveArgs(7));
  const oldWake = f.scheduled.find(w => w.name === "oneSetupExecutions:bootstrapSavedExecution")!;
  await f.run("sites", "saveOneSetupRequest", f.saveArgs(7));
  assert.equal(f.tables.managed_provisioning_requests.length, 1);
  const superseded = await f.run("oneSetupExecutions", "bootstrapSavedExecution", oldWake.args);
  assert.equal(superseded.state, "request_superseded");
  assert.equal(f.tables.one_setup_executions.length, 0);
  assert.equal(f.tables.jobs.length, 0);
});

test("billing reconciliation during setup keeps the exact execution and a future automatic authorization wake", async () => {
  const f = fixture();
  await f.create(7);
  await f.run("sites", "saveOneSetupRequest", f.saveArgs(7));
  f.tables.account_plan_entitlements[0].status = "reconciling";
  const wake = f.scheduled.find(w => w.name === "oneSetupExecutions:bootstrapSavedExecution")!;
  const result = await f.run("oneSetupExecutions", "bootstrapSavedExecution", wake.args);
  assert.equal(result.state, "authorization_wait");
  assert.ok(Number(result.nextAt) > NOW);
  assert.equal(f.tables.one_setup_executions.length, 1);
  assert.equal(f.tables.jobs.length, 0);
  assert.ok(!f.scheduled.some(w => w.name === "actions/pipeline:resumeOneSetupExecutionInternal"));
  const retry = f.scheduled.at(-1)!;
  f.tables.account_plan_entitlements[0].status = "completed";
  const recovered = await f.run("oneSetupExecutions", "bootstrapSavedExecution", retry.args);
  assert.equal(recovered.state, "execution_bootstrapped");
  assert.equal(f.tables.one_setup_executions.length, 1);
});
