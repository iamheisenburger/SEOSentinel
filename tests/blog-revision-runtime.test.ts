import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { publicationArtifactHash, publicationDeliveryConfig, publicationDeliveryConfigHash, PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";
import { publishedRevisionKey, verifyLivePublishedRevision } from "../convex/lib/publishedRevision.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deliberately malformed serialized database fixtures.
type Row = Record<string, any>;
const source = buildSync({ entryPoints: ["convex/blog.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["convex/*"], write: false }).outputFiles[0].text;
function fixture(summaryMode = false) {
  const site: Row = { _id: "site", domain: "example.org", publishMethod: "github", repoOwner: "owner", repoName: "repo", repoDefaultBranch: "main" };
  const config = publicationDeliveryConfig(site as never);
  const configHash = publicationDeliveryConfigHash(config);
  const base = { title: "Original article", slug: "workflow", markdown: "Old unsupported paragraph ".repeat(80),
    metaTitle: "Original search title", metaDescription: "Original description", publicationConfigHash: configHash,
    factCheckScore: 86, contentScore: 78, readingTime: 4, wordCount: 1600 };
  const next = { ...base, title: "Seller's worksheet", metaTitle: "Seller's research worksheet", markdown: "Please record your own observations before deciding which language to test in your next draft. ".repeat(80),
    metaDescription: "Revised description", factCheckScore: 100, contentScore: undefined, readingTime: 3, wordCount: 1300 };
  const baseHash = publicationArtifactHash(base), nextHash = publicationArtifactHash(next);
  const baseReceipt = { method: "github", deliveryKey: `pentra:${"a".repeat(64)}`, contentHash: baseHash,
    externalId: "base-commit", status: "committed", url: "https://github.com/owner/repo/commit/base", receivedAt: 1000 };
  const revisionKey = publishedRevisionKey({ siteId: "site", articleId: "article", actionFingerprint: "audit", kind: "editorial_correction",
    baseArtifactHash: baseHash, nextArtifactHash: nextHash, baseReceipt: baseReceipt as never });
  const article: Row = { ...base, _id: "article", siteId: "site", status: "published", publishedAt: 1000, publicationDate: 900, createdAt: 800,
    publicationConfigSnapshot: config, publicationAuditVersion: PUBLICATION_AUDIT_VERSION, publicationReceipt: baseReceipt, publishedContentHash: baseHash };
  const revision: Row = { _id: "revision", siteId: "site", articleId: "article", status: "verification_pending", kind: "editorial_correction",
    revisionKey, actionFingerprint: "audit", publicationConfigHash: configHash, expectedPublicUrl: "https://example.org/blog/workflow", publicationDate: 900,
    baseArtifact: base, nextArtifact: next, baseArtifactHash: baseHash, nextArtifactHash: nextHash, baseReceipt,
    createdAt: 2000, attemptedAt: 2100, receipt: { method: "github", revisionKey, deliveryKey: `pentra:${revisionKey}`,
      baseContentHash: baseHash, baseExternalId: "base-commit", contentHash: nextHash, externalId: "new-commit",
      status: "committed", url: "https://github.com/owner/repo/commit/new", receivedAt: 2200 } };
  // Convex drops undefined fields. Do not let an in-memory spread hide that fact.
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify({ sites: [site], articles: [article], published_article_revisions: [revision],
    article_summaries: [{ ...article, _id: "summary", articleId: "article", articleCreatedAt: 800 }],
    maintenance_state: summaryMode ? [{ key: "publication-integrity-v4", status: "completed" }] : [] }));
  const ctx = { db: {
    get: async (id: string) => structuredClone(Object.values(tables).flat().find(row => row._id === id) ?? null),
    query(table: string) {
      const conditions: Array<(row: Row) => boolean> = [];
      let descending = false;
      const range = { eq(key: string, value: unknown) { conditions.push(row => row[key] === value); return range; } };
      const rows = () => structuredClone(tables[table].filter(row => conditions.every(fn => fn(row)))
        .sort((a, b) => (Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)) * (descending ? -1 : 1)));
      const chain = { withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        order(direction: string) { descending = direction === "desc"; return chain; },
        async first() { return rows()[0] ?? null; }, async take(n: number) { return rows().slice(0, n); }, async collect() { return rows(); } };
      return chain;
    },
  } };
  const runtime = { exports: {} as Record<string, { _handler(ctx: unknown, args: unknown): Promise<Row> }> };
  runInNewContext(source, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder });
  return { tables, base, next, revision: tables.published_article_revisions[0],
    run: (name: string, args: Row = {}) => runtime.exports[name]._handler(ctx, { domain: "example.org", slug: "workflow", ...args }) };
}

test("public detail serves committed corrections before live verification, without changing publication history", async () => {
  const f = fixture(), before = structuredClone(f.tables.articles);
  const result = await f.run("getPublishedBySlug");
  assert.equal(result.title, f.next.title);
  assert.equal(result.metaTitle, f.next.metaTitle);
  assert.equal(result.markdown, f.next.markdown);
  assert.equal(result.factCheckScore, 100);
  assert.equal(result.publishedAt, 1000);
  assert.equal(result.updatedAt, 2200);
  assert.deepEqual(f.tables.articles, before);
  assert.equal("receipt" in result, false);
});

test("listing and sitemap use the same acknowledged projection with and without summary migration", async () => {
  for (const summaryMode of [false, true]) {
    const f = fixture(summaryMode);
    const list = await f.run("listPublishedByDomain");
    assert.equal(list[0].title, f.next.title);
    assert.equal(list[0].metaDescription, f.next.metaDescription);
    assert.equal(list[0].createdAt, 1000);
    assert.equal((await f.run("listPublishedSlugs")).articles[0].updatedAt, 2200);
  }
});

test("prepared, attempted and receiptless revisions cannot leak into public pages", async () => {
  for (const status of ["prepared", "leased", "attempted", "failed", "unverified"]) {
    const f = fixture(); f.revision.status = status; delete f.revision.receipt;
    assert.equal((await f.run("getPublishedBySlug")).title, f.base.title);
  }
});

test("public revision proof rejects tampered tenant, destination, hashes, date, key and receipt", async () => {
  const mutations = [
    (r: Row) => { r.siteId = "other"; }, (r: Row) => { r.expectedPublicUrl = "https://other.org/blog/workflow"; },
    (r: Row) => { r.nextArtifact.markdown = "tampered"; }, (r: Row) => { r.baseArtifact.title = "tampered"; },
    (r: Row) => { r.publicationDate = 5000; }, (r: Row) => { r.publicationConfigHash = "bad"; },
    (r: Row) => { r.revisionKey = "b".repeat(64); }, (r: Row) => { r.receipt.baseExternalId = "wrong"; },
    (r: Row) => { r.receipt.status = "failed"; }, (r: Row) => { r.nextArtifact.metaKeywords = ["unaudited"]; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.revision);
    assert.equal(await f.run("getPublishedBySlug"), null);
    assert.equal((await f.run("listPublishedByDomain")).length, 0);
  }
});

test("React numeric HTML entities satisfy exact live revision metadata", () => {
  const f = fixture();
  const html = `<html><head><title>Seller&#x27;s research worksheet</title><meta name="description" content="Revised description"><link rel="canonical" href="https://example.org/blog/workflow"></head><body><h1>Seller&#x27;s worksheet</h1>${renderSafePublicationHtml(f.next.markdown)}</body></html>`;
  verifyLivePublishedRevision({ html, expectedUrl: "https://example.org/blog/workflow", fetchedUrl: "https://example.org/blog/workflow", base: f.base, next: f.next, kind: "editorial_correction" });
});

test("latest acknowledged content wins over old verified rows and a newer unacknowledged attempt", async () => {
  const f = fixture();
  const old = structuredClone(f.revision); old._id = "old"; old.status = "verified"; old.createdAt = 1500;
  old.nextArtifact.title = "Must not win";
  const future = structuredClone(f.revision); future._id = "future"; future.status = "attempted"; future.createdAt = 3000; delete future.receipt;
  f.tables.published_article_revisions.push(old, future);
  assert.equal((await f.run("getPublishedBySlug")).title, f.next.title);
  f.revision.status = "unverified";
  assert.equal((await f.run("getPublishedBySlug")).title, f.next.title);
});

test("unchanged summary listings do not load full article bodies", async () => {
  const f = fixture(true); f.tables.published_article_revisions = []; f.tables.articles = [];
  assert.equal((await f.run("listPublishedByDomain"))[0].title, f.base.title);
});

test("an acknowledged revision cannot expose an unpublished original or an unrelated domain", async () => {
  const f = fixture(); f.tables.articles[0].status = "draft";
  assert.equal(await f.run("getPublishedBySlug"), null);
  assert.equal((await f.run("listPublishedByDomain")).length, 0);
  f.tables.articles[0].status = "published";
  assert.equal(await f.run("getPublishedBySlug", { domain: "unrelated.example" }), null);
});
