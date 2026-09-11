import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Synthetic serialized database fixtures.
type Row = Record<string, any>;
const source = buildSync({
  entryPoints: ["convex/growthLoop.ts"], bundle: true, platform: "node",
  format: "cjs", external: ["convex/*"], write: false,
}).outputFiles[0].text;

function fixture(migrated = true) {
  const articles: Row[] = Array.from({ length: 120 }, (_, i) => ({
    _id: `article-${i}`, _creationTime: i, siteId: "site-a",
    status: i === 0 ? "published" : i === 1 ? "ready" : "draft",
    title: `Article ${i}`, slug: `article-${i}`, createdAt: i,
    markdown: "Synthetic article body. ".repeat(3_000),
    publicationGateStatus: i === 1 ? "passed" : undefined,
    auditedContentHash: i === 1 ? "audited" : undefined,
    publicationReceipt: i === 0 ? { deliveryKey: "verified-receipt" } : undefined,
    publicUrlStatus: i === 0 ? "verified" : undefined,
    publicUrlVerifiedAt: i === 0 ? 100 : undefined,
  }));
  const tables: Record<string, Row[]> = {
    sites: [{ _id: "site-a", userId: "owner-a", domain: "example.org" }],
    articles,
    article_summaries: articles.map(article => {
      const row = { ...article }; delete row.markdown; delete row.publicationReceipt;
      return { ...row, _id: `summary-${row._id}`, articleId: row._id,
        articleCreatedAt: row.createdAt, articleUpdatedAt: row.createdAt };
    }),
    maintenance_state: migrated ? [{ key: "publication-integrity-v4", status: "completed" }] : [],
  };
  const reads = { bytes: 0, articleScans: 0, exactArticleReads: [] as string[] };
  let subject = "owner-a";
  const account = (rows: Row[]) => {
    reads.bytes += Buffer.byteLength(JSON.stringify(rows));
    return structuredClone(rows);
  };
  const ctx = {
    auth: { getUserIdentity: async () => subject ? { subject } : null },
    db: {
      async get(id: string) {
        const row = Object.values(tables).flat().find(row => row._id === id);
        if (tables.articles.some(row => row._id === id)) reads.exactArticleReads.push(id);
        return account(row ? [row] : [])[0] ?? null;
      },
      query(table: string) {
        const conditions: Array<(row: Row) => boolean> = [];
        let descending = false;
        const range = {
          eq(key: string, value: unknown) { conditions.push(row => row[key] === value); return range; },
          gte(key: string, value: number) { conditions.push(row => row[key] >= value); return range; },
        };
        const read = (limit: number) => {
          if (table === "articles") reads.articleScans++;
          return account((tables[table] ?? []).filter(row => conditions.every(fn => fn(row)))
            .sort((a, b) => ((a._creationTime ?? 0) - (b._creationTime ?? 0)) * (descending ? -1 : 1))
            .slice(0, limit));
        };
        const chain = {
          withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
          order(direction: string) { descending = direction === "desc"; return chain; },
          async take(n: number) { return read(n); },
          async first() { return read(1)[0] ?? null; },
          async unique() { const rows = read(2); assert.ok(rows.length <= 1); return rows[0] ?? null; },
        };
        return chain;
      },
    },
  };
  const runtime = { exports: {} as Record<string, { _handler(ctx: unknown, args: unknown): Promise<Row> }> };
  runInNewContext(source, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder });
  return { tables, reads, setSubject(value: string) { subject = value; },
    run: () => runtime.exports.getStatus._handler(ctx, { siteId: "site-a" }) };
}

test("migrated status reads compact rows, not every article body, and preserves verified outcomes", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.activity.articles, 120);
  assert.equal(result.verifiedOutcomes.publishedUrls, 1);
  assert.equal(f.reads.articleScans, 0, "status must not scan full article documents");
  assert.deepEqual(f.reads.exactArticleReads, ["article-0"], "only the live-publication receipt needs hydration");
  assert.ok(f.reads.bytes < 150_000, `synthetic read budget exceeded: ${f.reads.bytes}`);
  const legacy = fixture(false); await legacy.run();
  assert.ok(f.reads.bytes < legacy.reads.bytes / 50, "compact status must reduce synthetic read bytes by at least 98%");
});

test("unmigrated status retains the bounded authoritative read path", async () => {
  const f = fixture(false);
  const result = await f.run();
  assert.equal(result.activity.articles, 120);
  assert.equal(result.verifiedOutcomes.publishedUrls, 1);
  assert.equal(f.reads.articleScans, 1);
});

test("a summary is not a substitute for the current verified publication receipt", async () => {
  for (const change of [
    (row: Row) => { delete row.publicationReceipt; },
    (row: Row) => { row.status = "draft"; },
    (row: Row) => { row.publicUrlStatus = "failed"; },
    (row: Row) => { delete row.publicUrlVerifiedAt; },
    (row: Row) => { row.siteId = "foreign-site"; },
  ]) {
    const f = fixture(); change(f.tables.articles[0]);
    assert.equal((await f.run()).verifiedOutcomes.publishedUrls, 0);
  }
});

test("summary overflow preserves the original bounded article sample", async () => {
  const f = fixture();
  f.tables.article_summaries.push(...Array.from({ length: 400 }, (_, i) => ({
    _id: `extra-${i}`, articleId: `extra-article-${i}`, siteId: "site-a", status: "draft",
  })));
  const result = await f.run();
  assert.equal(result.activity.articles, 120);
  assert.equal(result.verifiedOutcomes.publishedUrls, 1);
  assert.equal(f.reads.articleScans, 1);
});

test("authentication and ownership are checked before reading inventory", async () => {
  for (const subject of ["", "different-owner"]) {
    const f = fixture(); f.setSubject(subject);
    await assert.rejects(f.run(), /Authentication required|Site not found/);
    assert.equal(f.reads.articleScans, 0);
    assert.deepEqual(f.reads.exactArticleReads, []);
  }
});

test("customer buffer readiness requires a proven minimum, never raw counts or completeness of excess inventory", async () => {
  for (const [status, lowerBound, minimumMet] of [["unknown", 0, false], ["partial", 2, false],
    ["partial", 4, true], ["partial", 25, true], ["complete", 4, true]] as const) {
    const f = fixture();
    // Enough raw ready metadata to tempt the old fallback into claiming ready.
    for (const row of f.tables.article_summaries.slice(1, 6)) {
      row.status = "ready"; row.publicationGateStatus = "passed"; row.auditedContentHash = "audited";
    }
    const inventory = { status, usableCountLowerBound: lowerBound,
      inspectedCandidates: Math.max(5, lowerBound), blockers: status === "complete" ? []
        : [lowerBound === 25 ? "publication_buffer_scan_incomplete" : "publication_history_incomplete"] };
    f.tables.autopilot_health = [{ siteId: "site-a", bufferMinimum: 3, bufferInventory: inventory,
      approvedBufferCount: status === "complete" ? 4 : undefined }];
    const result = await f.run();
    const buffer = result.stages.buffer;
    assert.equal(buffer.state, minimumMet ? "ready" : "waiting_pentra");
    assert.equal(buffer.blockerCode, minimumMet ? undefined : "publication_inventory_incomplete");
    assert.equal(result.ready, false, "Proving the buffer minimum is not whole-product readiness");
    assert.deepEqual(structuredClone(result.bufferInventory), inventory);
    assert.equal(f.reads.articleScans, 0);
    assert.deepEqual(f.reads.exactArticleReads, ["article-0"]);
    assert.ok(f.reads.bytes < 150_000, "Honest inventory must not add body scans");
  }
});
