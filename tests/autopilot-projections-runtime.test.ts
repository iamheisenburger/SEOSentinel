import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { autopilotCandidateBudget } from "../convex/lib/autopilotBuffer.ts";

type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<Row> };
const bundles = Object.fromEntries(["articles", "autopilot"].map(name => [name,
  buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text,
]));
const timestamp = Date.UTC(2026, 8, 6, 12);

function fixture(name: string, site: Row, tables: Record<string, Row[]>) {
  const runtimeModule = { exports: {} as Record<string, Handler> };
  runInNewContext(bundles[name], { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return timestamp; } } });
  const reads: Array<{ table: string; index: string; limit: number }> = [];
  const ctx = { db: {
    async get(id: string) { assert.equal(id, site._id); return structuredClone(site); },
    query(table: string) {
      const predicates: Array<(row: Row) => boolean> = [];
      let index = ""; let direction = 1;
      const range = {
        eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return range; },
        gte(key: string, value: number) { predicates.push(row => Number(row[key]) >= value); return range; },
      };
      const rows = () => {
        const sortKey = index.endsWith("_scheduled") ? "scheduledAt"
          : index.endsWith("_created") ? "articleCreatedAt" : "_creationTime";
        return structuredClone((tables[table] ?? []).filter(row => predicates.every(p => p(row)))
          .sort((a, b) => direction * (Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0))));
      };
      const expressions = {
        field: (key: string) => (row: Row) => row[key],
        eq: (field: (row: Row) => unknown, value: unknown) => (row: Row) => field(row) === value,
      };
      const chain = {
        withIndex(value: string, fn: (q: typeof range) => unknown) { index = value; fn(range); return chain; },
        order(value: string) { direction = value === "desc" ? -1 : 1; return chain; },
        filter(fn: (q: typeof expressions) => (row: Row) => boolean) { predicates.push(fn(expressions)); return chain; },
        async take(limit: number) { reads.push({ table, index, limit }); return rows().slice(0, limit); },
        async first() { return rows()[0] ?? null; },
        async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
      };
      return chain;
    },
  } };
  return { reads, run: (handler: string, args: Row) => runtimeModule.exports[handler]._handler(ctx, args) };
}

test("actual scheduler projection sees the full cadence candidate budget and the correct next rolling slot", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const cadencePerWeek of [21, 14, 7, 1]) {
      for (const modern of [false, true]) {
        const site = { _id: siteId, domain: "example.org", cadencePerWeek, autopilotRolloutMode: "live",
          ...(modern ? { canonicalDomainRevision: 1 } : {}) };
        const binding = modern ? { canonicalDomain: "example.org", domainRevision: 1 } : {};
        const budget = autopilotCandidateBudget("live", cadencePerWeek);
        const candidates = Array.from({ length: budget + 3 }, (_, i) => ({
          _id: `summary-${i}`, articleId: `article-${i}`, siteId, status: "draft",
          articleCreatedAt: timestamp - i * 1_000, ...binding,
        }));
        const f = fixture("articles", site, {
          article_summaries: [...candidates,
            { ...candidates[0], siteId: "other-tenant", articleId: "foreign" },
            { ...candidates[0], articleId: "expired", articleCreatedAt: timestamp - 86_400_001 },
            ...(modern ? [{ ...candidates[0], articleId: "old-domain", canonicalDomain: "old.example.org", domainRevision: 0 }] : []),
          ],
          maintenance_state: [{ key: "publication-integrity-v4", status: "completed" }],
        });
        const result = await f.run("getAutopilotState", { siteId, since: timestamp - 86_400_000 });
        const recent = result.recent as Row[];
        assert.equal(recent.length, budget);
        assert.deepEqual(Array.from(recent, row => row._id), candidates.slice(0, budget).map(row => row.articleId));
        assert.equal(Math.min(...recent.map(row => Number(row._creationTime))), timestamp - (budget - 1) * 1_000);
        // Ready selection now also uses its original-creation index. Inspect
        // the recent-candidate range specifically, not the first *_created read.
        const recentRead = f.reads.find(read => read.index ===
          (modern ? "by_site_domain_revision_created" : "by_site_created"));
        assert.equal(recentRead?.limit, budget);
        assert.ok(budget <= 15);
      }
    }
  }
});

test("actual operator snapshot finds the exact publication deadline even behind newer history and other future wakes", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    const dueAt = timestamp + 8 * 3_600_000;
    const exact = { _id: "exact-publication", siteId, trigger: "cadence_deadline", scheduledAt: dueAt,
      status: "scheduled", _creationTime: 1, heartbeatAt: 1, detail: "private-detail", claimNonce: "private-nonce" };
    const runs = [exact,
      ...Array.from({ length: 20 }, (_, i) => ({ ...exact, _id: `recent-${i}`,
        trigger: "natural", status: "completed", _creationTime: i + 100, scheduledAt: timestamp - i - 1 })),
      ...Array.from({ length: 15 }, (_, i) => ({ ...exact, _id: `wake-${i}`,
        trigger: "cadence_refill_deadline", _creationTime: i + 200, scheduledAt: timestamp + i + 1 })),
      { ...exact, _id: "different-kind", trigger: "quality_budget_deadline", _creationTime: 300 },
      { ...exact, _id: "foreign-site", siteId: "other-tenant", _creationTime: 400 },
    ];
    const f = fixture("autopilot", { _id: siteId, domain: "example.org" }, {
      autopilot_health: [{ siteId, nextPublicationDueAt: dueAt }], autopilot_runs: runs,
    });
    const result = await f.run("getOperatorSnapshot", { siteId });
    assert.equal((result.cadenceDeadline as Row)?.runId, exact._id);
    assert.equal((result.cadenceDeadline as Row)?.deadlineKind, "cadence_deadline");
    assert.equal((result.runs as Row[]).length, 8);
    assert.equal((result.upcomingRuns as Row[]).length, 12);
    assert.deepEqual(Array.from(result.upcomingRuns as Row[], row => row.runId),
      Array.from({ length: 12 }, (_, i) => `wake-${i}`));
    const serialized = JSON.stringify(result);
    for (const forbidden of ["foreign-site", "private-detail", "private-nonce"]) assert.ok(!serialized.includes(forbidden));
    assert.ok(f.reads.some(read => read.index === "by_site_scheduled" && read.limit === 12));
  }
});

test("operator snapshot cannot invent a deadline receipt from health alone", async () => {
  for (const dueAt of [undefined, timestamp - 1, timestamp + 1]) {
    const f = fixture("autopilot", { _id: "tenant", domain: "example.org" }, {
      autopilot_health: [{ siteId: "tenant", nextPublicationDueAt: dueAt }],
    });
    assert.equal((await f.run("getOperatorSnapshot", { siteId: "tenant" })).cadenceDeadline, null);
  }
});

test("saturated legacy domain windows cannot masquerade as an empty publication buffer", async () => {
  const site = { _id: "tenant", domain: "example.org", autopilotRolloutMode: "live", cadencePerWeek: 7 };
  const f = fixture("articles", site, {
    article_summaries: Array.from({ length: 51 }, (_, i) => ({
      _id: `summary-${i}`, articleId: `old-article-${i}`, siteId: site._id,
      status: "ready", canonicalDomain: "old.example.org", domainRevision: 1,
      articleCreatedAt: timestamp - 1000 + i,
    })),
    maintenance_state: [{ key: "publication-integrity-v4", status: "completed" }],
  });
  await assert.rejects(f.run("getAutopilotState", { siteId: site._id, since: timestamp - 86400000 }),
    /article_summary_domain_window_incomplete/);
});
