import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { STRICT_EVIDENCE_SEARCH_DOMAINS } from "../convex/lib/sourceQuality.ts";

// Run the real research function and real SDK serialization against a local
// transport. This must catch an incompatible request, not just a source regex.
const bundled = buildSync({ stdin: {
  contents: `${readFileSync("convex/actions/pipeline.ts", "utf8")}\nexport { webResearch };`,
  resolveDir: `${process.cwd()}/convex/actions`, sourcefile: "pipeline.ts", loader: "ts",
}, bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Topic = { label: string; primaryKeyword: string };
type Result = { researchSummary: string; sources: Array<{ url: string; title?: string }> };

function fixture(options: { empty?: boolean; failure?: boolean } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    requests.push(JSON.parse(String(init?.body)));
    if (options.failure) return new Response(JSON.stringify({
      error: { message: "Unsupported research request", type: "invalid_request_error", code: "unsupported_parameter" },
    }), { status: 400, headers: { "Content-Type": "application/json" } });
    const annotations = options.empty ? [] : [
      { type: "url_citation", url: "https://www.nist.gov/research#method", title: "Primary evidence", start_index: 0, end_index: 10 },
      { type: "url_citation", url: "https://www.nist.gov/research#same", title: "Duplicate", start_index: 0, end_index: 10 },
      { type: "url_citation", url: "http://www.nist.gov/insecure", title: "Insecure", start_index: 0, end_index: 10 },
      { type: "url_citation", url: "not-a-url", title: "Invalid", start_index: 0, end_index: 10 },
    ];
    return new Response(JSON.stringify({ id: "resp_local_test", object: "response", status: "completed", output: [
      { id: "ws_local", type: "web_search_call", status: "completed", action: { type: "search", query: "primary evidence" } },
      { id: "msg_local", type: "message", role: "assistant", status: "completed", content: [{
        type: "output_text", text: "Research brief. https://invented.example/unsupported is model prose, not evidence.", annotations,
      }] },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const runtime = { exports: {} as { webResearch: (topic: Topic, niche?: string, competitors?: string[], strict?: boolean) => Promise<Result> } };
  runInNewContext(bundled, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, Buffer, TextEncoder, TextDecoder,
    Response, Request, Headers, AbortSignal, fetch: fetchMock,
    console: { log() {}, warn() {}, error() {} },
    process: { env: { OPENAI_API_KEY: "test-not-a-credential" } },
  });
  return { requests, run: runtime.exports.webResearch };
}

for (const strict of [false, true]) {
  test(`research uses the supported search capability and preserves citation provenance (strict=${strict})`, async () => {
    const f = fixture();
    const result = await f.run({ label: "Generic customer workflow", primaryKeyword: "workflow design" }, "customer software", ["competitor.example"], strict);
    assert.equal(f.requests.length, 1);
    const request = f.requests[0];
    assert.equal(request.model, strict ? "gpt-5-mini" : "gpt-4o-mini");
    assert.equal(request.tool_choice, "required");
    assert.equal(request.max_output_tokens, strict ? 4096 : 1600);
    assert.deepEqual(request.reasoning, strict ? { effort: "low" } : undefined);
    assert.deepEqual(request.tools, [{ type: strict ? "web_search" : "web_search_preview", search_context_size: "high",
      ...(strict ? { filters: { allowed_domains: STRICT_EVIDENCE_SEARCH_DOMAINS } } : {}),
    }]);
    assert.match(JSON.stringify(request.input), /competitor\.example/);
    assert.match(JSON.stringify(request.input), /Returning no sources is valid/);
    assert.deepEqual(JSON.parse(JSON.stringify(result.sources)), [{ url: "https://www.nist.gov/research", title: "Primary evidence" }]);
    assert.match(result.researchSummary, /model prose/);
  });
}

test("research does not manufacture citations when search finds no evidence", async () => {
  const f = fixture({ empty: true });
  const result = await f.run({ label: "A niche workflow", primaryKeyword: "niche workflow" }, undefined, undefined, true);
  assert.equal(result.sources.length, 0);
  assert.equal(f.requests.length, 1);
});

test("unsupported research requests remain visible and are not silently replayed", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(f.run({ label: "Workflow", primaryKeyword: "workflow" }, undefined, undefined, true), /Unsupported research request/);
  assert.equal(f.requests.length, 1);
});
