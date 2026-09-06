import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";
import { correctionInputHash, validateCorrectionDestinations, validatePublishedCorrection,
  verifyLiveCorrectionBody, CORRECTION_AUDIT_TIMEOUT_MS } from "../convex/lib/publishedCorrection.ts";
import { publicationArtifactHash, publicationDeliveryConfig, publicationDeliveryConfigHash,
  PUBLICATION_AUDIT_VERSION, sha256Hex } from "../convex/lib/publicationArtifact.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";
import { verifyLivePublishedRevision, rollbackRevisionArtifact,
  type PublishedRevisionArtifact } from "../convex/lib/publishedRevision.ts";

type Args = Record<string, unknown>;
type Row = Args & { _id: string };
type Handler = { _handler(ctx: unknown, args: Args): Promise<unknown> };
const NOW = Date.UTC(2026, 8, 6, 15);
const bundles = Object.fromEntries(["publishedCorrections", "publishedRevisions", "actions/pipeline"].map(name => [name,
  buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true, platform: "node", format: "cjs",
    external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*"], write: false }).outputFiles[0].text,
]));
const body = Array.from({ length: 1250 }, (_, i) => `workflow${i}`).join(" ");
const metaDescription = "Use this practical workflow to assess your own observations, record limitations, compare alternatives, and choose a useful next step.";
function artifact(): PublishedRevisionArtifact {
  return { title: "A practical research workflow", slug: "research-workflow",
    markdown: `${body}\n\nConsider documenting your observations before deciding which language to test in your next revision.\n\nRelated reading: [research notes](/blog/research-notes).`,
    metaTitle: "A practical research workflow", metaDescription, metaKeywords: ["research workflow"],
    sources: [], internalLinks: [{ anchor: "research notes", href: "/blog/research-notes" }], factCheckScore: 91, editorialQualityScore: 92,
    mediaQualityStatus: "passed", productEvidenceStatus: "not_applicable", claimEvidenceStatus: "passed",
    claimEvidence: [], productEvidenceHash: sha256Hex(""), contentScore: undefined,
  };
}

function fixture() {
  let now = NOW;
  const scheduled: Array<{ name: string; args: Args; at: number }> = [];
  const requests: Args[] = [];
  const replies: Args[] = [];
  const tables: Record<string, Row[]> = {
    sites: [{ _id: "site", userId: "owner", domain: "https://example.org", repoOwner: "owner", repoName: "repo",
      repoDefaultBranch: "main", publishMethod: "github", autopilotEnabled: true, autopilotRolloutMode: "live",
      autopilotRolloutEpoch: 3, cadencePerWeek: 7, createdAt: NOW - 86400000 }],
    articles: [], published_article_revisions: [], published_correction_audits: [],
    account_deletion_receipts: [], account_plan_entitlements: [],
    autopilot_health: [{ _id: "health", siteId: "site", lastPublishedAt: 100, nextPublicationDueAt: 500 }],
  };
  const site = tables.sites[0];
  const base = { ...artifact(), publicationConfigHash: publicationDeliveryConfigHash(publicationDeliveryConfig(site as never)) };
  const hash = publicationArtifactHash(base);
  const receipt = { method: "github", deliveryKey: `pentra:${"a".repeat(64)}`, contentHash: hash,
    externalId: "base-commit", status: "committed", url: "https://github.com/owner/repo/commit/base", receivedAt: NOW - 1000 };
  tables.articles.push({ ...base, _id: "article", siteId: "site", status: "published", publicationDate: NOW - 1000,
    productEvidenceSnapshot: "", publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    publicationReceipt: receipt, publishedContentHash: hash });
  const get = (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null;
  const ctx = {
    db: {
      get: async (id: string) => structuredClone(get(id)),
      insert: async (table: string, fields: Args) => {
        assert.ok(tables[table], `Unexpected insert ${table}`);
        const id = `${table}-${tables[table].length + 1}`;
        tables[table].push({ ...structuredClone(fields), _id: id, _creationTime: now }); return id;
      },
      patch: async (id: string, fields: Args) => {
        const row = get(id); assert.ok(row);
        for (const [key, value] of Object.entries(fields)) {
          if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
        }
      },
      query: (table: string) => {
        assert.ok(tables[table], `Unexpected query ${table}`);
        const conditions: Array<(row: Row) => boolean> = [];
        let descending = false;
        const range = {
          eq(key: string, value: unknown) { conditions.push(row => row[key] === value); return range; },
          gte(key: string, value: number) { conditions.push(row => Number(row[key]) >= value); return range; },
        };
        const rows = () => structuredClone(tables[table].filter(row => conditions.every(fn => fn(row)))
          .sort((a, b) => (Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)) * (descending ? -1 : 1)));
        const chain = {
          withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
          filter() { assert.equal(rows().length, 0, "Unexpected nonempty filter"); return chain; },
          order(direction: string) { descending = direction === "desc"; return chain; },
          async take(n: number) { return rows().slice(0, n); },
          async first() { return rows()[0] ?? null; },
          async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
        }; return chain;
      },
    },
    scheduler: { runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: Args) => {
      scheduled.push({ name: getFunctionName(ref), args: structuredClone(args), at: now + delay }); return `wake-${scheduled.length}`;
    } },
  };
  const modules = Object.fromEntries(Object.entries(bundles).map(([name, source]) => {
    const runtime = { exports: {} as Record<string, Handler> };
    class FixedDate extends Date { static now() { return now; } }
    const transport: typeof fetch = async (url, init) => {
      assert.equal(String(url), "https://api.anthropic.com/v1/messages");
      assert.ok(init?.signal);
      const request = JSON.parse(String(init?.body)); requests.push(request);
      const reply = replies.shift(); assert.ok(reply, "Unexpected paid replay");
      return new Response(JSON.stringify({ id: "local-audit", type: "message", role: "assistant", model: request.model,
        stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "local-tool", name: request.tool_choice.name, input: reply }],
      }), { headers: { "Content-Type": "application/json" } });
    };
    runInNewContext(source, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url),
      Date: FixedDate, URL, Buffer, TextEncoder, TextDecoder, Response, Request, Headers, AbortSignal,
      setTimeout, clearTimeout, fetch: transport, console: { log() {}, warn() {}, error() {} },
      process: { env: { ANTHROPIC_API_KEY: "test-not-a-credential" } } });
    return [name, runtime.exports];
  }));
  const run = async (module: string, name: string, args: Args): Promise<Args> =>
    structuredClone(await modules[module][name]._handler(ctx, args)) as Args;
  const call = (ref: Parameters<typeof getFunctionName>[0], args: Args) => {
    const [module, name] = getFunctionName(ref).split(":"); return run(module, name, args);
  };
  Object.assign(ctx, { runQuery: call, runMutation: call });
  const proposal = { title: "A practical observation worksheet", metaTitle: "A practical observation worksheet", metaDescription,
    markdown: base.markdown + "\n\nBefore choosing a phrase, consider writing down what would make you reject it and what additional evidence you would need." };
  const request = (extra: Args = {}) => run("publishedCorrections", "requestAuditInternal", {
    siteId: "site", articleId: "article", expectedBaseArtifactHash: hash, reason: "Correct unsupported claims", proposal, ...extra });
  const reviewed = () => {
    replies.push({ markdown: proposal.markdown, notes: "Reviewed", confidenceScore: 95, claimCount: 0, verifiedCount: 0, citations: [] },
      { score: 92, materialDefects: [], notes: ["Ready"], claimEvidence: [] });
  };
  return { run, request, base, proposal, tables, scheduled, requests, replies, reviewed, get,
    advance(ms: number) { now += ms; } };
}

test("correction destinations use parsed Markdown, including nested and reference links", () => {
  const base = "Read [the guide](https://example.org/guide) and ![photo](https://example.org/image.png).";
  validateCorrectionDestinations(base, "[**Revised guide**](https://example.org/guide)");
  for (const next of ["[x](<https://evil.example/x>)", "[**nested**](https://evil.example/x)",
    "https://evil.example", "www.evil.example", "[x][id]\n\n[id]: https://evil.example",
    "![changed kind](https://example.org/guide)", "[x](https://example.org/guide\\(other\\))"]) {
    assert.throws(() => validateCorrectionDestinations(base, next));
  }
});

test("complete live prose cannot be substituted with a title, hidden copy, or hydration data", () => {
  const next = "Please record your own observations and review the limitations before choosing which language to test in your next draft.";
  const old = "This is the earlier unsupported paragraph that should no longer appear on the published page after the correction is verified.";
  const args = { renderedNext: `<p>${next}</p>`, renderedBaseParagraphs: [`<p>${old}</p>`] };
  verifyLiveCorrectionBody({ ...args, html: `<article><p>${next}</p></article>` });
  for (const html of [`<script>${next}</script>`, `<div hidden>${next}</div>`, `<div style="display:none">${next}</div>`,
    `<div aria-hidden="true">${next}</div>`, `<template>${next}</template>`, `<p>${next}</p><p>${old}</p>`]) {
    assert.throws(() => verifyLiveCorrectionBody({ ...args, html }));
  }
});

test("correction input identity binds every owner proposal and tenant field", () => {
  const input = { siteId: "site", articleId: "article", baseArtifactHash: "a", productEvidenceHash: "b",
    reason: "correction", proposal: { title: "title", metaTitle: "meta", metaDescription: "description", markdown: "body" } };
  for (const key of ["siteId", "articleId", "baseArtifactHash", "productEvidenceHash", "reason"] as const) {
    assert.notEqual(correctionInputHash(input), correctionInputHash({ ...input, [key]: "changed" }));
  }
  assert.notEqual(correctionInputHash(input), correctionInputHash({ ...input, proposal: { ...input.proposal, markdown: "changed" } }));
});

test("real correction workflow audits exact prose, preserves history and schedules one CAS revision", async () => {
  const f = fixture(); const before = structuredClone(f.tables.articles);
  const requested = await f.request();
  assert.deepEqual(await f.request(), { ...requested, existing: true });
  assert.equal(f.scheduled.filter(w => w.name === "actions/pipeline:auditPublishedCorrectionInternal").length, 1);
  f.reviewed();
  const result = await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: requested.auditId });
  assert.equal(result.status, "prepared"); assert.equal(f.requests.length, 2);
  assert.equal(f.tables.published_correction_audits[0].status, "passed");
  const revision = f.tables.published_article_revisions[0];
  assert.equal(revision.kind, "editorial_correction");
  assert.equal(revision.publicationDate, before[0].publicationDate);
  assert.deepEqual(f.tables.articles, before);
  assert.equal((revision.nextArtifact as Args).contentScore, undefined);
  assert.match(JSON.stringify(f.requests[1]), /EXACT PUBLICATION METADATA/);
  assert.ok(f.scheduled.some(w => w.name === "publisher:executePublishedRevisionInternal"));
  assert.deepEqual(await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: requested.auditId }), { status: "not_claimed" });
  assert.equal(f.requests.length, 2);
  const claimed = await f.run("publishedRevisions", "claimExecution", { revisionId: revision._id, leaseOwner: "publisher" });
  assert.equal(claimed.idempotent, false);
});

test("stale authorization settles before paid work and cross-tenant requests never start", async () => {
  const f = fixture();
  await assert.rejects(f.request({ siteId: "other" }));
  await assert.rejects(f.request({ expectedBaseArtifactHash: "stale" }));
  const request = await f.request(); f.tables.sites[0].autopilotRolloutEpoch = 4;
  assert.deepEqual(await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: request.auditId }), { status: "not_claimed" });
  assert.equal(f.tables.published_correction_audits[0].status, "failed");
  assert.equal(f.requests.length, 0);
});

test("abandoned audit is ambiguous and cannot be replayed by a new worker", async () => {
  const f = fixture(); const request = await f.request();
  await f.run("publishedCorrections", "claimAuditInternal", { auditId: request.auditId, workerToken: "worker" });
  assert.deepEqual(await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: request.auditId }), { status: "not_claimed" });
  f.advance(CORRECTION_AUDIT_TIMEOUT_MS);
  await f.run("publishedCorrections", "expireAuditInternal", { auditId: request.auditId });
  assert.equal(f.tables.published_correction_audits[0].status, "ambiguous");
  assert.equal((await f.request()).existing, true);
  assert.equal(f.requests.length, 0);
});

test("independent rejection cannot queue a revision or inflate its editorial score", async () => {
  const f = fixture(); const request = await f.request(); f.reviewed();
  f.replies[1] = { score: 72, materialDefects: ["Unsupported platform claim"], notes: [], claimEvidence: [] };
  assert.equal((await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: request.auditId })).status, "failed");
  assert.equal(f.tables.published_article_revisions.length, 0);
  assert.equal(f.tables.published_correction_audits[0].status, "failed");
});

test("operator correction attempts are bounded per tenant, not per input string", async () => {
  const f = fixture();
  const request = await f.request();
  await assert.rejects(f.request({ reason: "another input" }), /already active/);
  await f.run("publishedCorrections", "claimAuditInternal", { auditId: request.auditId, workerToken: "worker" });
  await f.run("publishedCorrections", "failAuditInternal", { auditId: request.auditId, workerToken: "worker", detail: "Rejected" });
  for (let i = 1; i <= 2; i++) {
    const r = await f.request({ reason: `distinct correction ${i}` });
    await f.run("publishedCorrections", "claimAuditInternal", { auditId: r.auditId, workerToken: "worker" });
    await f.run("publishedCorrections", "failAuditInternal", { auditId: r.auditId, workerToken: "worker", detail: "Rejected" });
  }
  await assert.rejects(f.request({ reason: "fourth input" }), /allowance is exhausted/);
  assert.equal(f.requests.length, 0);
});

test("a prepared audit expires without a provider call even if its worker never runs", async () => {
  const f = fixture(); const request = await f.request(); f.advance(CORRECTION_AUDIT_TIMEOUT_MS);
  await f.run("publishedCorrections", "expireAuditInternal", { auditId: request.auditId });
  assert.equal(f.get(String(request.auditId))?.status, "failed");
  assert.equal(f.requests.length, 0);
});

test("completed correction proof is revalidated at the publisher lease boundary", async () => {
  for (const tamper of ["articleId", "nextArtifactHash", "rolloutEpoch", "proposal", "audit"]) {
    const f = fixture(); const request = await f.request(); f.reviewed();
    await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: request.auditId });
    const row = f.tables.published_correction_audits[0];
    row[tamper] = tamper === "rolloutEpoch" ? 4 : tamper === "proposal" ? { ...f.proposal, title: "different" } :
      tamper === "audit" ? { ...(row.audit as Args), editorialScore: 100 } : "tampered";
    await assert.rejects(f.run("publishedRevisions", "claimExecution", {
      revisionId: f.tables.published_article_revisions[0]._id, leaseOwner: "publisher" }), /independent audit/);
  }
});

test("a lost completion acknowledgement cannot demote a passed audit into failure", async () => {
  const f = fixture(); const request = await f.request(); f.reviewed();
  await f.run("actions/pipeline", "auditPublishedCorrectionInternal", { auditId: request.auditId });
  const row = f.tables.published_correction_audits[0];
  assert.deepEqual(await f.run("publishedCorrections", "failAuditInternal", {
    auditId: request.auditId, workerToken: row.workerToken, detail: "Response lost" }), { recorded: false, status: "passed" });
  assert.equal(f.tables.published_article_revisions.length, 1);
});

test("destination changes during review prevent revision creation", async () => {
  const f = fixture(); const request = await f.request();
  await f.run("publishedCorrections", "claimAuditInternal", { auditId: request.auditId, workerToken: "worker" });
  f.tables.sites[0].repoName = "other";
  await assert.rejects(f.run("publishedCorrections", "completeAuditInternal", { auditId: request.auditId,
    workerToken: "worker", nextArtifact: { ...f.base, ...f.proposal },
    audit: { editorialScore: 92, factCheckScore: 91, materialDefects: [], notes: [], claimEvidence: [] } }), /sealed destination/);
  assert.equal(f.tables.published_article_revisions.length, 0);
});

test("legacy and editorial live callbacks cannot advance the new-article cadence clock", async () => {
  for (const kind of ["strengthen_cluster", "editorial_correction"]) {
    const f = fixture(); const before = structuredClone(f.tables.autopilot_health);
    f.tables.published_article_revisions.push({ _id: "revision", siteId: "site", articleId: "article", kind,
      status: "verification_pending", nextArtifactHash: "next", receipt: {}, liveVerificationLeaseOwner: "verifier",
      publicationConfigHash: f.base.publicationConfigHash, rolloutEpoch: 3, liveVerificationAttempts: 0,
      cadenceMicroSeedJobId: "legacy-attempt", cadenceDueAt: 500 });
    const result = await f.run("publishedRevisions", "recordLiveVerification", { revisionId: "revision",
      expectedNextArtifactHash: "next", status: "verified", attempts: 1, leaseOwner: "verifier" });
    assert.equal(result.recorded, true);
    assert.deepEqual(f.tables.autopilot_health, before);
  }
});

test("correction strict guards reject changed sources, stale scores and unsupported claim ledgers", () => {
  const base = artifact(); const next = { ...base, markdown: base.markdown + "\n\nConsider recording your own assumptions." };
  validatePublishedCorrection({ base, next, productEvidence: "" });
  for (const overrides of [{ contentScore: 95 }, { factCheckScore: NaN }, { editorialQualityScore: 84 },
    { sources: [{ url: "https://new.example", title: "unaudited" }] }, { productEvidenceHash: "stale" },
    { claimEvidence: [{ claim: "unsupported", citationNumbers: [], supported: false, reason: "No evidence" }] }]) {
    assert.throws(() => validatePublishedCorrection({ base, next: { ...next, ...overrides }, productEvidence: "" }));
  }
});

test("editorial title rollback is explicit and complete prose is verified at the live destination", () => {
  const base = artifact(); const next = { ...base, title: "A corrected research workflow", metaTitle: "A corrected research workflow",
    markdown: base.markdown + "\n\nConsider recording your own assumptions." };
  assert.throws(() => rollbackRevisionArtifact({ current: next, preservedBase: base }));
  assert.equal(rollbackRevisionArtifact({ current: next, preservedBase: base, allowEditorialTitleChange: true }), base);
  const url = "https://example.org/blog/research-workflow";
  const html = `<html><head><title>${next.metaTitle}</title><meta name="description" content="${metaDescription}"><link rel="canonical" href="${url}"></head><body><h1>${next.title}</h1>${renderSafePublicationHtml(next.markdown)}</body></html>`;
  verifyLivePublishedRevision({ expectedUrl: url, fetchedUrl: url, html, base, next, kind: "editorial_correction" });
  assert.throws(() => verifyLivePublishedRevision({ expectedUrl: url, fetchedUrl: url,
    html: html.replace(renderSafePublicationHtml(next.markdown), ""), base, next, kind: "editorial_correction" }));
});
