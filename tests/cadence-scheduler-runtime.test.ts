import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName, type FunctionReference } from "convex/server";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";

// Execute the actual registered scheduler, not a copied decision algorithm.
// Only its database/service boundaries are faked; unexpected calls fail.
// esbuild is installed by Convex and writes no files for this harness.
const source = buildSync({
  entryPoints: ["convex/actions/scheduler.ts"],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;
const NOW = Date.UTC(2026, 8, 6);
const REFILL = new Error("reached current inventory audit");

function runtime(cadence: number, overdue: boolean, ready: boolean, readiness = true) {
  const schedulerModule = { exports: {} as { scheduleCadence: { _handler: (ctx: unknown, args: unknown) => Promise<unknown> } } };
  class FixedDate extends Date { static now() { return NOW; } }
  runInNewContext(source, { module: schedulerModule, exports: schedulerModule.exports, require: createRequire(import.meta.url), Date: FixedDate, URL, console, process: { env: {} } });
  const siteId = `tenant-${cadence}`;
  const interval = Math.floor(604_800_000 / cadence);
  const publishedAt = NOW - interval + (overdue ? 0 : 1);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const article = {
    _id: "new-article", status: "ready", createdAt: NOW - 10_000,
    publicationGateStatus: "passed", publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "a".repeat(64),
  };
  const call = (ref: FunctionReference<"query" | "mutation">, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    assert.equal(args.siteId, siteId);
    switch (name) {
      case "sites:getFull": return {
        _id: siteId, domain: "example.org", userId: "owner", createdAt: NOW - 10 * interval,
        cadencePerWeek: cadence, autopilotEnabled: true, autopilotRolloutMode: "live",
        approvalRequired: false, publishMethod: "github",
      };
      case "sites:enforceLiveReadiness": return { ready: readiness, blockers: ["credentials_expired"] };
      case "articles:getAutopilotState": return {
        migrationPending: false, ready: ready ? [article] : [], review: [], recent: [], published: [],
        latestPublished: { ...article, _id: "previous", status: "published", createdAt: publishedAt, publishedAt, publicUrlStatus: "verified" },
      };
      case "jobs:settleExhaustedArticleQualityFailuresForSiteInternal":
      case "articles:settleRecoveredTopicQualityForSiteInternal":
      case "autopilot:raiseAlert":
      case "autopilot:resolveAlertKind":
      case "autopilot:scheduleCadenceDeadline": return {};
      case "jobs:queuePublicationIfAbsent": return { queued: true };
      case "topics:getInventoryAuditInternal": throw REFILL;
      default: throw new Error(`Unexpected scheduler call: ${name}`);
    }
  };
  return {
    calls,
    run: async () => structuredClone(await schedulerModule.exports.scheduleCadence._handler({ runQuery: call, runMutation: call }, { siteId })),
  };
}

test("actual scheduler delivers sealed new articles at every supported integer cadence", async () => {
  for (let cadence = 1; cadence <= 21; cadence += 1) {
    const harness = runtime(cadence, true, true);
    assert.deepEqual(await harness.run(), { scheduled: 1, mode: "buffer_delivery", bufferCount: 1 });
    assert.equal(harness.calls.filter(c => c.name === "jobs:queuePublicationIfAbsent").length, 1);
  }
});

test("actual scheduler arms exact future deadline instead of publishing early", async () => {
  for (let cadence = 1; cadence <= 21; cadence += 1) {
    const harness = runtime(cadence, false, true);
    await assert.rejects(harness.run(), error => error === REFILL);
    assert.equal(harness.calls.find(c => c.name === "autopilot:scheduleCadenceDeadline")?.args.dueAt, NOW + 1);
    assert.ok(!harness.calls.some(c => c.name === "jobs:queuePublicationIfAbsent"));
  }
});

test("empty buffer remains a due new-article deficit and continues into refill, never revision", async () => {
  const harness = runtime(7, true, false);
  await assert.rejects(harness.run(), error => error === REFILL);
  assert.ok(harness.calls.some(c => c.name === "autopilot:raiseAlert" && c.args.kind === "buffer_empty"));
  assert.ok(!harness.calls.some(c => /publishedRevisions|queuePublication/.test(c.name)));
});

test("expired publishing readiness cannot turn deadline pressure into an unauthorized write", async () => {
  const harness = runtime(21, true, true, false);
  assert.deepEqual(await harness.run(), { scheduled: 0, mode: "readiness_regressed", blockers: ["credentials_expired"] });
  assert.ok(!harness.calls.some(c => c.name === "jobs:queuePublicationIfAbsent"));
});
