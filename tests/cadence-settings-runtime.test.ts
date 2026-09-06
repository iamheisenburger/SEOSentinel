import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";
import { retainsRolloutForCadenceEdit } from "../convex/lib/cadenceSettings.ts";

const bundled = buildSync({
  entryPoints: ["convex/sites.ts"], bundle: true, platform: "node",
  format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;

function fixture(overrides: Record<string, unknown> = {}, owner = "owner") {
  const runtimeModule = { exports: {} as { updateSite: { _handler: (ctx: unknown, args: unknown) => Promise<unknown> } } };
  runInNewContext(bundled, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} } });
  const site: Record<string, unknown> = {
    _id: "site", userId: "owner", domain: "example.org", cadencePerWeek: 7,
    autopilotEnabled: true, approvalRequired: false, autopilotRolloutMode: "live",
    autopilotRolloutEpoch: 5, publishMethod: "github", repoOwner: "customer", repoName: "blog",
    repoDefaultBranch: "main", publicationAdapterVersion: "verified-version",
    publicationAdapterVerifiedAt: 123, publicationAdapterConfigHash: "verified-config",
    ...overrides,
  };
  const job: Record<string, unknown> = {
    _id: "old-publication-job", siteId: "site", type: "publish", status: "pending",
    payload: { automatic: true }, rolloutEpoch: 5,
  };
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ name: string; delay: number; args: Record<string, unknown> }> = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: owner }) },
    db: {
      get: async (id: string) => {
        assert.equal(id, "site");
        return structuredClone(site);
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        assert.ok(id === "site" || id === "old-publication-job");
        writes.push({ id, patch: structuredClone(patch) });
        const row = id === "site" ? site : job;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete row[key];
          else row[key] = structuredClone(value);
        }
      },
      query: (table: string) => {
        assert.ok(["account_deletion_receipts", "account_plan_entitlements", "published_article_revisions", "jobs", "managed_provisioning_requests"].includes(table), `Unexpected table ${table}`);
        const conditions: Record<string, unknown> = {};
        const range = { eq(key: string, value: unknown) { conditions[key] = value; return range; } };
        const chain = {
          withIndex(_name: string, fn: (query: typeof range) => unknown) { fn(range); return chain; },
          filter() { return chain; },
          async unique() { return table === "account_plan_entitlements" ? { status: "completed", maxArticles: 150 } : null; },
          async first() { return null; },
          async collect() {
            assert.equal(table, "jobs");
            return conditions.status === job.status ? [structuredClone(job)] : [];
          },
        };
        return chain;
      },
    },
    scheduler: {
      async runAfter(delay: number, ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) {
        assert.equal(args.siteId, "site");
        scheduled.push({ name: getFunctionName(ref), delay, args: structuredClone(args) });
      },
    },
  };
  return { site, job, writes, scheduled, run: (patch: Record<string, unknown>) => runtimeModule.exports.updateSite._handler(ctx, { siteId: "site", ...patch }) };
}

test("actual cadence edit preserves verified rollout, cancels stale jobs and immediately rearms current scheduling", async () => {
  for (const cadence of [1, 4, 14, 21]) {
    for (const mode of ["live", "warm"]) {
      const f = fixture({ autopilotRolloutMode: mode });
      await f.run({ cadencePerWeek: cadence });
      assert.equal(f.site.cadencePerWeek, cadence);
      assert.equal(f.site.autopilotRolloutMode, mode);
      assert.equal(f.site.autopilotRolloutEpoch, 6);
      assert.equal(f.site.publicationAdapterVerifiedAt, 123);
      assert.equal(f.site.publicationAdapterConfigHash, "verified-config");
      assert.equal(f.job.status, "failed");
      assert.ok(f.writes.findIndex(w => w.id === "old-publication-job") < f.writes.findIndex(w => w.id === "site"));
      assert.deepEqual(f.scheduled.map(s => [s.delay, s.name]), [
        [0, "autopilot:refreshSiteCadenceHealth"], [0, "autopilot:dispatchSiteFollowup"],
      ]);
    }
  }
});

test("unchanged verified non-GitHub connections are not erased by a schedule edit", async () => {
  for (const method of ["wordpress", "webhook"]) {
    const f = fixture({ publishMethod: method });
    await f.run({ cadencePerWeek: 14 });
    assert.equal(f.site.autopilotRolloutMode, "live");
    assert.equal(f.site.publicationAdapterConfigHash, "verified-config");
  }
});

test("disabling automation cancels old jobs and cannot schedule paid work or publication", async () => {
  const f = fixture();
  await f.run({ autopilotEnabled: false });
  assert.equal(f.site.autopilotRolloutMode, "observe");
  assert.equal(f.job.status, "failed");
  assert.deepEqual(f.scheduled, []);
});

test("resuming pause requires canonical readiness instead of self-promoting to live", async () => {
  const f = fixture({ cadencePerWeek: 0, autopilotRolloutMode: "observe" });
  await f.run({ cadencePerWeek: 7 });
  assert.equal(f.site.autopilotRolloutMode, "observe");
  assert.deepEqual(f.scheduled.map(s => s.name), ["autopilot:refreshSiteCadenceHealth", "actions/scheduler:reclaimStrandedPublicationInventory"]);
});

test("mixed authorization or publisher changes do not retain the old rollout", async () => {
  for (const extra of [{ approvalRequired: true }, { repoName: "different-repo" }, { autopilotEnabled: false }]) {
    const f = fixture();
    await f.run({ cadencePerWeek: 14, ...extra });
    assert.equal(f.site.autopilotRolloutMode, "observe");
    assert.equal(f.site.publicationAdapterConfigHash, undefined);
    assert.ok(!f.scheduled.some(s => s.name === "autopilot:dispatchSiteFollowup"));
  }
});

test("cadence changes retain owner, active delivery, and valid-cadence fences", async () => {
  for (const [f, patch, message] of [
    [fixture({}, "not-the-owner"), { cadencePerWeek: 14 }, /Site not found/],
    [fixture({ publicationLeaseOwner: "in-flight-delivery" }), { cadencePerWeek: 14 }, /locked/],
    [fixture(), { cadencePerWeek: 22 }, /target cadence/],
    [fixture(), { cadencePerWeek: 0 }, /target cadence/],
  ] as const) {
    await assert.rejects(f.run(patch), message);
    assert.equal(f.writes.length, 0);
    assert.equal(f.scheduled.length, 0);
  }
});

test("saving unchanged cadence does not churn the epoch or queue duplicate follow-ups", async () => {
  const f = fixture();
  await f.run({ cadencePerWeek: 7 });
  assert.equal(f.site.autopilotRolloutEpoch, 5);
  assert.equal(f.job.status, "pending");
  assert.equal(f.scheduled.length, 0);
});

test("cadence retention is conservative for any other changed field or lifecycle fence", () => {
  const base = fixture().site;
  for (const extra of [{ language: "de" }, { targetCountry: "DE" }, { futureSecurityField: true }, { cadenceRequestedPerWeek: 21 }]) {
    assert.equal(retainsRolloutForCadenceEdit(base, { cadencePerWeek: 14, ...extra }), false);
  }
  for (const extra of [{ planParkedAt: 1 }, { deletionStatus: "pending" }, { accountDeletionRequestedAt: 1 }]) {
    assert.equal(retainsRolloutForCadenceEdit({ ...base, ...extra }, { cadencePerWeek: 14 }), false);
  }
});
