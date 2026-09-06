import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

// Execute the real auditor, SDK request serialization, schema parsing and
// deterministic remediation. Only the provider transport is substituted.
const bundled = buildSync({ stdin: {
  contents: `${readFileSync("convex/actions/pipeline.ts", "utf8")}\nexport { auditFinalArticleWithUnsupportedClaimRemoval };`,
  resolveDir: `${process.cwd()}/convex/actions`, sourcefile: "pipeline.ts", loader: "ts",
}, bundle: true, platform: "node", format: "cjs",
external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*"],
write: false }).outputFiles[0].text;

type Claim = { claim: string; citationNumbers: number[]; supported: boolean; reason: string };
type Audit = { score: number; notes: string[]; materialDefects: string[]; claimEvidence: Claim[] };
type Args = { markdown: string; articleType: string; primaryKeyword: string; productName: string;
  productEvidence: string; researchEvidence: string; sources: []; minWords: number; maxWords: number };

function fixture(audits: Audit[]) {
  const requests: Array<{ system: string; messages: Array<{ content: string }>; model: string; max_tokens: number }> = [];
  const transport: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const audit = audits[requests.length - 1];
    assert.ok(audit, "No unbounded provider replay is permitted");
    return new Response(JSON.stringify({ id: `msg_local_${requests.length}`, type: "message", role: "assistant",
      model: request.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 20, output_tokens: 20 },
      content: [{ type: "tool_use", id: "audit-local", name: "audit_final_article", input: audit }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const runtime = { exports: {} as { auditFinalArticleWithUnsupportedClaimRemoval: (args: Args) => Promise<{
    markdown: string; audit: Audit; deterministicPruningApplied: boolean;
  }> } };
  runInNewContext(bundled, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, Buffer, TextEncoder, TextDecoder,
    Response, Request, Headers, AbortSignal, fetch: transport,
    setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    process: { env: { ANTHROPIC_API_KEY: "test-not-a-credential" } },
  });
  return { requests, run: runtime.exports.auditFinalArticleWithUnsupportedClaimRemoval };
}

const clean: Audit = { score: 91, notes: [], materialDefects: [], claimEvidence: [] };
const args = (markdown: string): Args => ({ markdown, articleType: "standard", primaryKeyword: "evaluation workflow",
  productName: "ExampleApp", productEvidence: "", researchEvidence: "", sources: [], minWords: 10, maxWords: 1000 });

test("an empty deterministic list does not silence independent factual auditing", async () => {
  const claim = "Letters arrive instantly across every network without any delivery failures.";
  const advice = "Write down the outcome you need, compare it against your own observations, and record the limitations before making a decision.";
  const f = fixture([{ score: 70, notes: [], materialDefects: ["Unsupported delivery guarantee."],
    claimEvidence: [{ claim, citationNumbers: [], supported: false, reason: "No preserved evidence supports the delivery guarantee." }],
  }, clean]);
  const result = await f.run(args(`${advice}\n\n${claim}`));
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[0].system, /not exhaustive/);
  assert.match(f.requests[0].system, /additional.*factual.*paragraph/i);
  assert.doesNotMatch(f.requests[0].messages[0].content, /Return an empty claimEvidence array/);
  assert.match(f.requests[0].system, /untrusted data/);
  assert.ok(f.requests.every(request => request.max_tokens <= 16384));
  assert.equal(result.markdown.trim(), advice);
  assert.equal(result.deterministicPruningApplied, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.audit)), clean);
  const lastArticle = f.requests[1].messages[0].content.split("EXACT FINISHED ARTICLE:\n")[1];
  assert.equal(lastArticle, result.markdown, "the second audit must cover the exact pruned artifact");
});

test("a missing ledger entry alone never deletes useful prose", async () => {
  const markdown = "ExampleApp publishes approved articles through a connected repository and retains the publication record.";
  const f = fixture([{ ...clean, score: 80, materialDefects: ["The required claim ledger is incomplete."] }]);
  const result = await f.run({ ...args(markdown), productEvidence: "Name: ExampleApp\nDomain: example.invalid" });
  assert.equal(f.requests.length, 1);
  assert.equal(result.markdown, markdown);
  assert.equal(result.deterministicPruningApplied, false);
  assert.match(f.requests[0].messages[0].content, /REQUIRED CLAIM UNITS/);
  assert.match(f.requests[0].messages[0].content, /ExampleApp publishes/);
});

test("the runtime harness audits real Markdown links and checklists without changing them", async () => {
  const markdown = "Read the [setup notes](https://example.invalid/docs) before evaluating the workflow.\n\n- [ ] What evidence supports the fit classification?\n- [ ] What information is still unknown?";
  const f = fixture([clean]);
  const result = await f.run(args(markdown));
  assert.equal(f.requests.length, 1);
  assert.equal(result.markdown, markdown);
});

test("contradictory audit scores receive one provider clarification rather than local promotion", async () => {
  for (const contradiction of [
    { ...clean, score: 83 },
    { ...clean, materialDefects: ["Unsupported platform-wide assertion."] },
  ]) {
    const corrected = { ...clean, score: 82, materialDefects: ["Unsupported platform-wide assertion."] };
    const f = fixture([contradiction, corrected]);
    const result = await f.run(args("Compare the workflow against your own requirements and record the limitations before choosing the next action."));
    assert.equal(f.requests.length, 2);
    assert.match(f.requests[1].messages[0].content, /CORRECTION/);
    assert.match(f.requests[1].messages[0].content, /score below 85 requires a concrete material defect/);
    assert.equal(result.audit.score, 82);
    assert.equal(result.audit.materialDefects.length, 1);
  }
});

test("a second contradictory audit fails closed without more provider calls", async () => {
  const contradiction = { ...clean, score: 83 };
  const f = fixture([contradiction, contradiction]);
  await assert.rejects(f.run(args("Compare the workflow against your own requirements and record the limitations before choosing the next action.")));
  assert.equal(f.requests.length, 2);
});
