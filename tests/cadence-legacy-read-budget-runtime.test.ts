import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { CADENCE_MICRO_SEED_VERSION } from "../convex/lib/cadenceMicroSeed.ts";

type Row = Record<string, unknown>;
const source = buildSync({ entryPoints: ["convex/cadenceMicroSeed.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;

function fixture(topics: Row[]) {
  const site = { _id: "site-a", userId: "owner-a", domain: "example.org", planFeatures: [] };
  const tables: Record<string, Row[]> = {
    topic_clusters: topics.map(row => ({ _id: "topic-a", siteId: site._id, ...row })),
    articles: [{ _id: "article-a", siteId: site._id, topicId: "topic-a", status: "published",
      markdown: "Synthetic published body. ".repeat(3_000) }],
  };
  const readTables: string[] = [];
  const ctx = { db: {
    async get(id: string) { assert.equal(id, site._id); return site; },
    query(table: string) {
      const range = { eq(key: string, value: unknown) {
        if (key === "siteId") assert.equal(value, site._id); return range;
      } };
      const read = () => { readTables.push(table); return tables[table] ?? []; };
      const chain = {
        withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        order() { return chain; },
        async unique() { return read()[0] ?? null; },
        async take(limit: number) { return read().slice(0, limit); },
      }; return chain;
    },
  } };
  const runtimeModule = { exports: {} as Record<string, { _handler(ctx: unknown, args: unknown): Promise<{ topicIds: string[]; reason?: string }> }> };
  runInNewContext(source, { module: runtimeModule, exports: runtimeModule.exports, require: createRequire(import.meta.url),
    process: { env: {} }, URL, TextEncoder });
  return { readTables, run: () => runtimeModule.exports.listLegacyAnchorMismatchRepairsInternal._handler(ctx, { siteId: site._id }) };
}

test("legacy repair does not read article bodies or active jobs when no legacy candidate exists", async () => {
  for (const topics of [[], [{}], [{ cadenceMicroSeedJobId: "seed", cadenceMicroSeedVersion: CADENCE_MICRO_SEED_VERSION }],
    [{ cadenceMicroSeedJobId: "seed", cadenceMicroSeedVersion: 1, cadenceMicroSeedAnchorEligible: false }]]) {
    const f = fixture(topics);
    assert.equal((await f.run()).topicIds.length, 0);
    assert.equal(f.readTables.includes("articles"), false, "no candidate means no body scan");
    assert.equal(f.readTables.includes("jobs"), false, "no candidate means no job scan");
  }
});

test("legacy candidate still requires authoritative published-article and active-job checks", async () => {
  const f = fixture([{ cadenceMicroSeedJobId: "seed", cadenceMicroSeedVersion: 1 }]);
  assert.equal((await f.run()).topicIds.length, 0, "published articles must never be quarantined");
  assert.equal(f.readTables.includes("articles"), true);
  assert.equal(f.readTables.includes("jobs"), true);
});
