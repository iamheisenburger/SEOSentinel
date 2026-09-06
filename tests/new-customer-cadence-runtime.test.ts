import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

// Actual registered mutations share one in-memory database. No production
// tenant, credentials, providers or external publishing calls are involved.
// The harness implements only the indexed boundaries used by this workflow.
type Row = Record<string, unknown> & { _id: string };
type Args = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: Args) => Promise<unknown> };
const NOW = Date.UTC(2026, 8, 6, 12);
const source = Object.fromEntries(["sites", "oneSetupExecutions"].map(name => [
  name,
  buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text,
]));

function fixture() {
  const tables: Record<string, Row[]> = {
    sites: [], managed_provisioning_requests: [], one_setup_executions: [],
    account_deletion_receipts: [], published_article_revisions: [], jobs: [],
    account_plan_entitlements: [{ _id: "entitlement", userId: "customer",
      status: "completed", maxSites: 9999, maxArticles: 150,
      planFeatures: ["max_sites_unlimited", "max_articles_150"] }],
  };
  let identity: string | null = "customer";
  const scheduled: Array<{ name: string; at: number; args: Args }> = [];
  const writes: Array<{ table: string; id: string }> = [];
  const get = (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null;
  const schedule = async (at: number, ref: Parameters<typeof getFunctionName>[0], args: Args) => {
    scheduled.push({ name: getFunctionName(ref), at, args: structuredClone(args) });
    return `scheduled-${scheduled.length}`;
  };
  const ctx = {
    auth: { getUserIdentity: async () => identity ? { subject: identity } : null },
    db: {
      get: async (id: string) => structuredClone(get(id)),
      insert: async (table: string, fields: Args) => {
        assert.ok(tables[table], `Unexpected insert: ${table}`);
        const id = `${table}-${tables[table].length + 1}`;
        tables[table].push({ ...structuredClone(fields), _id: id, _creationTime: NOW });
        writes.push({ table, id });
        return id;
      },
      patch: async (id: string, fields: Args) => {
        const row = get(id);
        assert.ok(row, `Missing patch target ${id}`);
        for (const [key, value] of Object.entries(fields)) {
          if (value === undefined) delete row[key];
          else row[key] = structuredClone(value);
        }
        writes.push({ table: Object.keys(tables).find(table => tables[table].includes(row))!, id });
      },
      query: (table: string) => {
        assert.ok(tables[table], `Unexpected query: ${table}`);
        const conditions: Args = {};
        const range = { eq(key: string, value: unknown) { conditions[key] = value; return range; } };
        const rows = () => structuredClone(tables[table].filter(row =>
          Object.entries(conditions).every(([key, value]) => row[key] === value)));
        const chain = {
          withIndex(_index: string, fn: (query: typeof range) => unknown) { fn(range); return chain; },
          filter() {
            // Only the empty unresolved-revision lookup uses a filter here.
            assert.equal(table, "published_article_revisions");
            assert.equal(tables[table].length, 0);
            return chain;
          },
          order() { return chain; },
          async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
          async first() { return rows()[0] ?? null; },
          async collect() { return rows(); },
          async take(limit: number) { return rows().slice(0, limit); },
        };
        return chain;
      },
    },
    scheduler: {
      runAfter: (delay: number, ref: Parameters<typeof getFunctionName>[0], args: Args) => schedule(NOW + delay, ref, args),
      runAt: schedule,
    },
  };
  const modules = Object.fromEntries(Object.entries(source).map(([name, code]) => {
    const runtime = { exports: {} as Record<string, Handler> };
    class FixedDate extends Date { static now() { return NOW; } }
    runInNewContext(code, { module: runtime, exports: runtime.exports,
      require: createRequire(import.meta.url), Date: FixedDate, URL, TextEncoder,
      console, process: { env: {} } });
    return [name, runtime.exports];
  }));
  const run = async (module: string, name: string, args: Args) =>
    structuredClone(await modules[module][name]._handler(ctx, args)) as Args;
  const create = (cadence: number, extra: Args = {}) => run("sites", "upsert", {
    domain: "https://www.customer.example/", createOnly: true,
    siteName: "Customer", cadencePerWeek: cadence, autopilotEnabled: true,
    approvalRequired: true, publishMethod: "github", ...extra,
  });
  const saveArgs = (cadence: number, extra: Args = {}) => ({
    siteId: "sites-1", publisherKind: "github", outreachTransport: "smtp",
    publisherMode: "connect_existing", searchMeasurementMode: "connect_existing",
    outreachMailboxMode: "connect_existing", automationMode: "full",
    publisherAutopublishConsentAccepted: true, requestedCadencePerWeek: cadence,
    managedOutreachFromName: "Customer Team",
    managedOutreachPhysicalMailingAddress: "1 Example Street, Example City 12345",
    managedOutreachAttestationVersion: 1, managedOutreachCanaryConsentVersion: 1,
    confirmsSenderIdentityAndAddress: true, authorizesManagedDeliveryEventCanary: true,
    confirmsAutonomousSendingRequiresSeparateConsent: true, ...extra,
  });
  return { tables, scheduled, writes, run, create, saveArgs,
    signIn: (user: string | null) => { identity = user; } };
}

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
