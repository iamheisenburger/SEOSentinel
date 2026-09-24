import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { manualPublicationBlocker, ownerApprovalDestination } from "../convex/lib/manualPublication.ts";

// Execute the real action handler, with only its external boundaries replaced.
const source = readFileSync("convex/actions/pipeline.ts", "utf8");
const start = source.indexOf("export const publishApproved = action({");
const end = source.indexOf("// Generate an article immediately", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(
  source.slice(start, end).replace("export const publishApproved", "globalThis.subject"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture(recovery: object, site = { autopilotEnabled: true, autopilotRolloutMode: "live" }) {
  const calls: string[] = [];
  const scope = {
    action: (definition: unknown) => definition,
    v: { id: () => null },
    requireOwnedSite: async () => { calls.push("authorize"); return site; },
    manualPublicationBlocker,
    ownerApprovalDestination,
    ConvexError: Error,
    PUBLICATION_AUDIT_VERSION: 1,
    internal: {
      articles: { getInternal: "article" },
      jobs: { queueQualityRetryIfAbsent: "queue" },
      actions: { pipeline: { processSpecificJob: "worker" } },
      publisher: { publishArticleInternal: "publish" },
    },
    subject: undefined as unknown as { handler: (ctx: unknown, args: unknown) => Promise<unknown> },
  };
  vm.runInNewContext(compiled, scope);
  const ctx = {
    runQuery: async () => ({ siteId: "site" }),
    runMutation: async () => recovery,
    runAction: async () => { calls.push("publish"); return {}; },
    scheduler: { runAfter: async () => { calls.push("schedule"); } },
  };
  return { calls, run: () => scope.subject.handler(ctx, { siteId: "site", articleId: "article" }) };
}

test("exhausted or missing recovery cannot report phantom queued work", async () => {
  for (const recovery of [
    { queued: false, reason: "already_attempted" },
    { queued: false, reason: "revision_limit" },
    { queued: false },
  ]) {
    const f = fixture(recovery);
    await assert.rejects(f.run());
    assert.deepEqual(f.calls, ["authorize"]);
  }
});

test("inactive publishing reports a useful reason before any queue or external write", async () => {
  for (const site of [{ autopilotEnabled: true, autopilotRolloutMode: "warm" }, { autopilotEnabled: false, autopilotRolloutMode: "live" }]) {
    const f = fixture({}, site);
    await assert.rejects(f.run(), /Publishing is not active.*approved article is retained/);
    assert.deepEqual(f.calls, ["authorize"]);
    assert.ok(manualPublicationBlocker(site));
  }
  assert.equal(manualPublicationBlocker({ autopilotEnabled: true, autopilotRolloutMode: "live" }), null);
});

test("new recovery schedules once; existing recovery is reused without rescheduling", async () => {
  for (const queued of [true, false]) {
    const f = fixture({ queued, jobId: "existing-job" });
    const result = await f.run() as { published: boolean; jobId: string };
    assert.equal(result.published, false);
    assert.equal(result.jobId, "existing-job");
    assert.deepEqual(f.calls, queued ? ["authorize", "schedule"] : ["authorize"]);
  }
});

test("a concurrent completed audit proceeds to the protected publisher", async () => {
  const f = fixture({ queued: false, reason: "already_audited" });
  assert.equal((await f.run() as { published: boolean }).published, true);
  assert.deepEqual(f.calls, ["authorize", "publish"]);
});

test("WordPress owner approval exists only on the growth-first service", async () => {
  assert.equal(ownerApprovalDestination({ publishMethod: "wordpress", serviceMode: "growth_first" }), true);
  assert.equal(ownerApprovalDestination({ publishMethod: "wordpress", serviceMode: "legacy_articles" }), false);
  assert.equal(ownerApprovalDestination({ publishMethod: "github" }), true);
  assert.equal(ownerApprovalDestination({ publishMethod: "webhook", serviceMode: "growth_first" }), false);
  assert.ok(manualPublicationBlocker({ publishMethod: "wordpress", autopilotEnabled: false, autopilotRolloutMode: "warm" }));
  assert.equal(manualPublicationBlocker({ publishMethod: "wordpress", serviceMode: "growth_first", autopilotEnabled: false }), null);
});
