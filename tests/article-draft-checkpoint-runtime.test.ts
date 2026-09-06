import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { publicationArtifactHash } from "../convex/lib/publicationArtifact.ts";

const bundled = buildSync({ entryPoints: ["convex/articles.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<string> };

function fixture(owner = "tenant-a") {
  let timestamp = Date.UTC(2026, 8, 6, 12);
  const runtimeModule = { exports: {} as Record<string, Handler> };
  runInNewContext(bundled, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return timestamp; } } });
  const site: Row = { _id: "site", userId: owner, domain: "example.org",
    autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 4 };
  const job: Row = { _id: "job", siteId: "site", type: "article", status: "running",
    rolloutEpoch: 4, workerToken: "first-worker", leaseExpiresAt: timestamp + 60_000,
    reservationId: "usage", payload: { bufferFill: true } };
  const tables: Record<string, Row[]> = {
    sites: [site], jobs: [job], articles: [], article_summaries: [],
    usage_log: [{ _id: "usage", jobId: "job", siteId: "site", state: "reserved" }],
    account_deletion_receipts: [], account_plan_entitlements: [],
  };
  const find = (id: string) => Object.values(tables).flat().find(row => row._id === id);
  const writes: string[] = [];
  const ctx = { db: {
    async get(id: string) { return structuredClone(find(id) ?? null); },
    async patch(id: string, patch: Row) {
      const row = find(id); assert.ok(row); writes.push(id);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
    },
    async insert(table: string, values: Row) {
      assert.ok(tables[table], table);
      const id = `${table}-${tables[table].length}`;
      tables[table].push({ _id: id, ...structuredClone(values) }); writes.push(id); return id;
    },
    query(table: string) {
      assert.ok(tables[table], `Unexpected table ${table}`);
      const predicates: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) {
        predicates.push(row => row[key] === value); return range;
      } };
      const rows = () => structuredClone(tables[table].filter(row => predicates.every(p => p(row))));
      const chain = {
        withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
        async first() { return rows()[0] ?? null; },
      };
      return chain;
    },
  } };
  const draft = { jobId: "job", workerToken: "first-worker", siteId: "site",
    title: "A useful article", slug: "/useful-article", markdown: "Original paid writer output",
    sources: [{ url: "https://example.org/source", excerpt: "Verified source excerpt", contentHash: "hash" }],
    researchEvidenceSummary: "Preserved evidence", productEvidenceSnapshot: "Product snapshot", productEvidenceHash: "product-hash" };
  const run = (args: Row) => runtimeModule.exports.createDraftForJob._handler(ctx, args);
  return { site, job, tables, writes, draft, run,
    advance() { timestamp += 1; },
    async create() {
      const id = await run(draft);
      const article = find(id)!;
      const expected = { expectedCheckpointUpdatedAt: article.updatedAt,
        expectedCheckpointHash: publicationArtifactHash(article as Parameters<typeof publicationArtifactHash>[0]) };
      return { article, expected, id };
    },
  };
}

test("actual generated-draft checkpoint survives review failure, settles quota once and is idempotent", async () => {
  for (const owner of ["tenant-a", "tenant-b"]) {
    const f = fixture(owner); const { article, id } = await f.create();
    assert.equal(f.job.articleId, id);
    assert.equal(article.status, "draft");
    assert.equal(article.publicationGateStatus, undefined);
    assert.equal(article.markdown, f.draft.markdown);
    assert.equal(JSON.stringify(article.sources), JSON.stringify(f.draft.sources));
    assert.equal(article.productEvidenceSnapshot, f.draft.productEvidenceSnapshot);
    assert.equal(f.tables.usage_log[0].state, "settled");
    assert.equal(f.tables.usage_log[0].articleId, id);
    const writes = f.writes.length;
    assert.equal(await f.run(f.draft), id);
    assert.equal(f.writes.length, writes);
    assert.equal(f.tables.articles.length, 1);
    assert.equal(f.tables.article_summaries.length, 1);
  }
});

test("actual reviewed update replaces only the matching unsealed draft without creating or charging twice", async () => {
  const f = fixture(); const { article, expected, id } = await f.create(); f.advance();
  assert.equal(await f.run({ ...f.draft, ...expected, markdown: "Reviewed writer output", editorialQualityScore: 90 }), id);
  assert.equal(article.markdown, "Reviewed writer output");
  assert.equal(article.editorialQualityScore, 90);
  assert.equal(article.status, "draft"); // Still requires the independent seal.
  assert.equal(f.tables.articles.length, 1);
  assert.equal(f.tables.usage_log.length, 1);
  assert.equal(f.tables.article_summaries[0].editorialQualityScore, 90);
});

test("actual checkpoint updates reject stale workers, changed ownership/configuration and edited or sealed content", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>, a: Row) => { a.markdown = "Owner edit"; },
    (f: ReturnType<typeof fixture>, a: Row) => { a.updatedAt = Number(a.updatedAt) + 1; },
    (f: ReturnType<typeof fixture>, a: Row) => { a.status = "published"; },
    (f: ReturnType<typeof fixture>, a: Row) => { a.auditedContentHash = "sealed"; },
    (f: ReturnType<typeof fixture>, a: Row) => { a.publicationLeaseOwner = "publisher"; },
    (f: ReturnType<typeof fixture>) => { f.job.workerToken = "replacement-worker"; },
    (f: ReturnType<typeof fixture>) => { f.job.leaseExpiresAt = 1; },
    (f: ReturnType<typeof fixture>) => { f.job.siteId = "another-site"; },
    (f: ReturnType<typeof fixture>) => { f.site.domain = "changed.example.org"; },
    (f: ReturnType<typeof fixture>) => { f.site.autopilotRolloutEpoch = 5; },
    (f: ReturnType<typeof fixture>) => { f.site.planParkedAt = 1; },
  ]) {
    const f = fixture(); const { article, expected } = await f.create(); change(f, article);
    const before = structuredClone(f.tables); const writes = f.writes.length;
    await assert.rejects(f.run({ ...f.draft, ...expected, markdown: "Late overwrite" }), /checkpoint|lease/i);
    assert.deepEqual(f.tables, before); assert.equal(f.writes.length, writes);
  }
});
