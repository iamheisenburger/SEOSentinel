import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

// Export the real private transport only inside an in-memory test bundle.
// No production API is added and every HTTP boundary is simulated locally.
const bundled = buildSync({ stdin: {
  contents: `${readFileSync("convex/publisher.ts", "utf8")}\nexport { commitToMain };`,
  resolveDir: `${process.cwd()}/convex`, sourcefile: "publisher.ts", loader: "ts",
}, bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
const BASE = "a".repeat(40), BLOB = "b".repeat(40), TREE = "c".repeat(40);
const COMMIT = "d".repeat(40), MOVED = "e".repeat(40);
const KEY = `pentra:${"f".repeat(64)}`;
const CONTENT = `---\ngenerator: "pentra"\npentraDeliveryKey: "${KEY}"\n---\n\nA reviewed new article.\n`;
type Row = Record<string, unknown>;
type CommitArgs = {
  token: string; owner: string; repo: string; branch: string; message: string;
  file: { path: string; content: string }; deliveryKey: string;
  beforeExternalMutation: () => Promise<void>;
};

function fixture(options: {
  owner?: string; repo?: string; branch?: string; empty?: boolean;
  existing?: string; moveDuringConfirmation?: boolean;
  refFailure?: boolean; rejectFence?: boolean; lostAcknowledgement?: boolean;
} = {}) {
  const owner = options.owner ?? "customer-a", repo = options.repo ?? "website";
  const branch = options.branch ?? "main";
  const file = { path: "content/guides/useful-article.md", content: CONTENT };
  const requests: Array<{ method: string; path: string; body?: Row }> = [];
  const events: string[] = [];
  let headReads = 0, delivered = false;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, statusText: status === 422 ? "Unprocessable Entity" : status === 404 ? "Not Found" : "OK",
    headers: { "Content-Type": "application/json" },
  });
  const fetchMock: typeof fetch = async (input, init) => {
    assert.equal(typeof input, "string");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.github.com");
    const prefix = `/repos/${owner}/${repo}`;
    assert.ok(url.pathname.startsWith(`${prefix}/`), "Never cross a tenant repository");
    const path = url.pathname.slice(prefix.length);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Row : undefined;
    requests.push({ method, path: `${path}${url.search}`, body });
    events.push(`${method} ${path}`);
    if (method === "GET" && path === `/git/ref/heads/${branch}`) {
      headReads += 1;
      if (options.empty && !delivered) return response({}, 409);
      return response({ object: { sha: delivered ? COMMIT : options.moveDuringConfirmation && headReads === 3 ? MOVED : BASE } });
    }
    if (method === "GET" && path === `/contents/${file.path}`) {
      assert.ok([BASE, COMMIT, branch].includes(url.searchParams.get("ref") ?? ""));
      const existing = delivered ? file.content : options.existing;
      return existing === undefined ? response({}, 404) : response({
        type: "file", encoding: "base64", sha: BLOB,
        content: Buffer.from(existing).toString("base64"),
        html_url: `https://github.com/${owner}/${repo}/blob/${BASE}/${file.path}`,
      });
    }
    if (method === "POST" && path === "/git/blobs") {
      assert.equal(body?.encoding, "base64");
      assert.equal(Buffer.from(String(body?.content), "base64").toString(), file.content);
      return response({ sha: BLOB }, 201);
    }
    if (method === "POST" && path === "/git/trees") {
      assert.deepEqual(body, { base_tree: BASE, tree: [{ path: file.path, mode: "100644", type: "blob", sha: BLOB }] });
      return response({ sha: TREE }, 201);
    }
    if (method === "POST" && path === "/git/commits") {
      assert.deepEqual(body?.parents, [BASE]); assert.equal(body?.tree, TREE);
      return response({ sha: COMMIT }, 201);
    }
    if (method === "PATCH" && path === `/git/refs/heads/${branch}`) {
      assert.equal(events[events.length - 2], "ownership fence");
      assert.deepEqual(body, { sha: COMMIT, force: false });
      if (options.refFailure) return response({}, 422);
      delivered = true;
      if (options.lostAcknowledgement) throw new Error("Simulated lost acknowledgement");
      return response({ object: { sha: COMMIT } });
    }
    if (method === "PUT" && path === `/contents/${file.path}`) {
      assert.equal(events[events.length - 2], "ownership fence");
      assert.equal(body?.branch, branch); assert.equal(body?.sha, undefined);
      assert.equal(Buffer.from(String(body?.content), "base64").toString(), file.content);
      delivered = true;
      return response({ commit: { sha: COMMIT, html_url: `https://github.com/${owner}/${repo}/commit/${COMMIT}` } }, 201);
    }
    assert.fail(`Unexpected HTTP request: ${method} ${path}`);
  };
  const runtime = { exports: {} as { commitToMain: (args: CommitArgs) => Promise<{ sha: string; commitUrl: string }> } };
  runInNewContext(bundled, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, Buffer, TextEncoder, Response,
    fetch: fetchMock, console, process: { env: {} } });
  const run = () => runtime.exports.commitToMain({
    token: "local-test-only", owner, repo, branch, file,
    deliveryKey: KEY, message: "Controlled local acceptance",
    beforeExternalMutation: async () => {
      events.push("ownership fence");
      if (options.rejectFence) throw new Error("Publication lease lost");
    },
  });
  const visibleWrites = () => requests.filter(r => r.method === "PATCH" || r.method === "PUT");
  return { run, requests, events, visibleWrites };
}

test("real GitHub transport publishes exact bytes to either tenant's sealed branch and path", async () => {
  for (const [owner, repo, branch] of [["customer-a", "website", "main"], ["customer-b", "docs", "production"]]) {
    const f = fixture({ owner, repo, branch });
    const result = await f.run();
    assert.equal(result.sha, COMMIT);
    assert.equal(result.commitUrl, `https://github.com/${owner}/${repo}/commit/${COMMIT}`);
    assert.equal(f.visibleWrites().length, 1);
    assert.equal(f.visibleWrites()[0].path, `/git/refs/heads/${branch}`);
  }
});

test("empty repositories use one fenced first-commit request with the sealed branch", async () => {
  const f = fixture({ empty: true, branch: "production" });
  assert.equal((await f.run()).sha, COMMIT);
  assert.equal(f.visibleWrites().length, 1);
  assert.equal(f.visibleWrites()[0].method, "PUT");
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
});

test("a lost GitHub acknowledgement recovers the exact current file without a second publication", async () => {
  const f = fixture({ lostAcknowledgement: true });
  await assert.rejects(f.run(), /lost acknowledgement/);
  assert.equal(f.visibleWrites().length, 1);
  const writesBeforeRetry = f.requests.filter(r => r.method !== "GET").length;
  assert.equal((await f.run()).sha, COMMIT);
  assert.equal(f.requests.filter(r => r.method !== "GET").length, writesBeforeRetry);
  assert.equal(f.visibleWrites().length, 1);
});

test("current-head drift and non-fast-forward rejection cannot be reported as delivery", async () => {
  const drift = fixture({ existing: CONTENT, moveDuringConfirmation: true });
  await assert.rejects(drift.run(), /branch changed/);
  assert.equal(drift.visibleWrites().length, 0);
  const conflict = fixture({ refFailure: true });
  await assert.rejects(conflict.run(), /Failed to update branch/);
  assert.equal(conflict.visibleWrites().length, 1);
  assert.equal(conflict.visibleWrites()[0].body?.force, false);
});

test("customer-owned files, sealed-content drift and lost ownership fail closed before visible writes", async () => {
  for (const existing of ["An existing customer page", `${CONTENT}tampered`]) {
    const f = fixture({ existing });
    await assert.rejects(f.run(), /not marked as Pentra-owned|different content/);
    assert.equal(f.requests.filter(r => r.method !== "GET").length, 0);
  }
  for (const empty of [false, true]) {
    const f = fixture({ rejectFence: true, empty });
    await assert.rejects(f.run(), /Publication lease lost/);
    assert.equal(f.visibleWrites().length, 0);
  }
});
