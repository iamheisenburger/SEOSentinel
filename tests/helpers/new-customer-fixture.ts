import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

// Actual registered mutations share one in-memory database. No production
// tenant, credentials, providers or external publishing calls are involved.
// The harness implements only the indexed boundaries used by this workflow.
type Row = Record<string, unknown> & { _id: string };
export type Args = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: Args) => Promise<unknown> };
export const NOW = Date.UTC(2026, 8, 6, 12);
const source = Object.fromEntries(["sites", "oneSetupExecutions"].map(name => [
  name,
  buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text,
]));

export function newCustomerFixture() {
  const tables: Record<string, Row[]> = {
    sites: [], managed_provisioning_requests: [], one_setup_executions: [],
    account_deletion_receipts: [], published_article_revisions: [], jobs: [], usage_log: [],
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
        const lowerBounds: Record<string, number> = {};
        const range = {
          eq(key: string, value: unknown) { conditions[key] = value; return range; },
          gte(key: string, value: number) { lowerBounds[key] = value; return range; },
        };
        const rows = () => structuredClone(tables[table].filter(row =>
          Object.entries(conditions).every(([key, value]) => row[key] === value) &&
          Object.entries(lowerBounds).every(([key, value]) => Number(row[key]) >= value)));
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
