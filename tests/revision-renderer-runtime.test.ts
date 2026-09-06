import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { publicationArtifactHash, publicationDeliveryConfig, publicationDeliveryConfigHash } from "../convex/lib/publicationArtifact.ts";
import { revisionArticleRecord } from "../convex/lib/revisionArtifact.ts";

const source = buildSync({ stdin: { contents: readFileSync("convex/publisher.ts", "utf8") + "\nexport { buildMdx, reviseGitHub };",
  resolveDir: `${process.cwd()}/convex`, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["convex/*"], write: false }).outputFiles[0].text;
function fixture() {
  const site = { _id: "site", domain: "example.org", publishMethod: "github", repoOwner: "owner", repoName: "repo",
    repoDefaultBranch: "main", githubToken: "fake-local-token", urlStructure: "/blog/[slug]" };
  const config = publicationDeliveryConfig(site);
  const base = { title: "Original title", slug: "workflow", markdown: "## Workflow\n\nPlease record observations.",
    metaTitle: "Original title", metaDescription: "Old description", contentScore: 78, factCheckScore: 86, publicationConfigHash: publicationDeliveryConfigHash(config) };
  const next = JSON.parse(JSON.stringify({ ...base, title: "Corrected worksheet", metaTitle: "Corrected worksheet", contentScore: undefined,
    markdown: "## Workflow\n\nPlease record your own observations before choosing which language to test in the next draft.", factCheckScore: 100 }));
  const baseHash = publicationArtifactHash(base), nextHash = publicationArtifactHash(next);
  const article = { ...base, _id: "article", siteId: "site", status: "published", createdAt: 1000, auditedContentHash: baseHash, publicationConfigSnapshot: config };
  let observed = "", staged = "", head = "a".repeat(40), fences = 0;
  const writes: Array<{ method: string; path: string }> = [];
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? "GET";
    if (method !== "GET") writes.push({ method, path });
    let response: unknown;
    if (path === "/repos/owner/repo") response = { default_branch: "main", permissions: { push: true } };
    else if (path.endsWith("/git/ref/heads/main")) response = { object: { sha: head } };
    else if (path.includes("/contents/")) response = { type: "file", sha: "b".repeat(40), encoding: "base64", content: Buffer.from(observed).toString("base64") };
    else if (path.endsWith("/git/blobs")) { staged = Buffer.from(JSON.parse(String(init?.body)).content, "base64").toString(); response = { sha: "c".repeat(40) }; }
    else if (path.endsWith("/git/trees")) response = { sha: "d".repeat(40) };
    else if (path.endsWith("/git/commits")) response = { sha: "e".repeat(40) };
    else if (path.endsWith("/git/refs/heads/main")) {
      assert.ok(fences > 0, "CAS must be authorized before the visible write");
      assert.equal(JSON.parse(String(init?.body)).force, false);
      observed = staged; head = "e".repeat(40); response = {};
    } else throw new Error(`Unexpected transport ${method} ${path}`);
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  };
  const runtime = { exports: {} as { buildMdx(a: unknown, s: unknown, d: number, key: string): string; reviseGitHub(args: unknown): Promise<unknown> } };
  runInNewContext(source, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), Buffer, URL, TextEncoder, TextDecoder,
    Response, Request, Headers, AbortSignal, setTimeout, clearTimeout, fetch: transport, process: { env: {} }, console });
  const key = "f".repeat(64);
  const revision = { baseArtifact: next, nextArtifact: next, baseArtifactHash: nextHash, nextArtifactHash: nextHash,
    baseArtifactRendererVersion: 1, nextArtifactRendererVersion: 2, revisionKey: key, publicationDate: 1000,
    baseReceipt: { method: "github", deliveryKey: `pentra:${"1".repeat(64)}`, externalId: head, contentHash: nextHash } };
  const render = runtime.exports.buildMdx;
  observed = render(revisionArticleRecord(article, next, 1, nextHash), site, 1000, revision.baseReceipt.deliveryKey);
  const run = () => runtime.exports.reviseGitHub({ site, article, revision, beforeExternalMutation: async () => { fences++; } });
  return { run, render, site, article, next, nextHash, revision, writes, get observed() { return observed; }, set observed(value: string) { observed = value; } };
}

test("authoritative revision rendering clears serialized omissions and uses the new audit hash", () => {
  const f = fixture();
  const record = revisionArticleRecord(f.article, f.next, 2, f.nextHash);
  assert.equal(record.contentScore, undefined);
  assert.equal(record.auditedContentHash, f.nextHash);
  const markdown = f.render(record, f.site, 1000, "pentra:" + "f".repeat(64));
  assert.doesNotMatch(markdown, /contentScore:/);
  assert.match(markdown, new RegExp(`auditedContentHash: "${f.nextHash}"`));
  assert.match(markdown, /factCheckScore: 100/);
});

test("legacy renderer retains exact old bytes for reconciliation, including absent-version rows", () => {
  const f = fixture();
  assert.match(f.observed, /contentScore: 78/);
  assert.match(f.observed, new RegExp(f.article.auditedContentHash));
  assert.equal(f.render(revisionArticleRecord(f.article, f.next), f.site, 1000, f.revision.baseReceipt.deliveryKey), f.observed);
  assert.throws(() => revisionArticleRecord(f.article, f.next, 999, f.nextHash), /Unsupported/);
});

test("real GitHub renderer repair performs one exact conditional update and receipt-only replay", async () => {
  const f = fixture(), beforeArticle = structuredClone(f.article);
  await f.run();
  assert.doesNotMatch(f.observed, /contentScore:/);
  assert.match(f.observed, new RegExp(`auditedContentHash: "${f.nextHash}"`));
  assert.equal(f.writes.filter(w => w.method === "PATCH").length, 1);
  const writes = f.writes.length;
  await f.run();
  assert.equal(f.writes.length, writes);
  assert.deepEqual(f.article, beforeArticle);
});

test("a customer edit or unknown renderer rejects before any external write", async () => {
  const f = fixture(); f.observed += "\nCustomer edit";
  await assert.rejects(f.run(), /drifted/); assert.equal(f.writes.length, 0);
  const unknown = fixture(); unknown.revision.nextArtifactRendererVersion = 999;
  await assert.rejects(unknown.run(), /Unsupported/); assert.equal(unknown.writes.length, 0);
});
