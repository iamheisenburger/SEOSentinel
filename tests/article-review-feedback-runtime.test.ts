import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

// Run the real review handler, SDK serialization, schemas and quality gate.
// Only transport and durable query/mutation boundaries are substituted.
const bundled = buildSync({ stdin: {
  contents: `${readFileSync("convex/actions/pipeline.ts", "utf8")}\nexport { reviewExistingArticleHandler };`,
  resolveDir: `${process.cwd()}/convex/actions`, sourcefile: "pipeline.ts", loader: "ts",
}, bundle: true, platform: "node", format: "cjs",
external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*"], write: false }).outputFiles[0].text;

const corrections = [
  "Replace the incomplete evaluation procedure with reader inputs, an observable output, and a decision rule.",
  "Remove the unsupported comparison premise.",
];
const markdown = `# Archive review workflow\n\n${Array.from({ length: 45 }, () =>
  "Write down the outcome you need before comparing possible approaches. Inspect your own records and note what remains unknown. Choose a next action only after reviewing those observations with the people responsible for the work.",
).join("\n\n")}`;
type Audit = { score: number; notes: string[]; materialDefects: string[]; claimEvidence: [] };
type ProviderRequest = { tool_choice: { name: string }; messages: Array<{ content: string }>; model: string };
type ReviewArgs = { siteId: string; articleId: string; incrementRevision: boolean };
type ReviewResult = { readyForPublication: boolean; editorialQualityScore: number; factCheckScore: number; qualityRevisionCount: number };
type PersistedReview = { editorialQualityNotes: string[]; markdown: string; qualityRevisionCount: number };

function fixture(siteId: string, audit: Audit) {
  const article = { _id: `${siteId}-article`, siteId, status: "review", articleType: "standard",
    title: "Archive review workflow", markdown, sources: [], qualityRevisionCount: 0,
    editorialQualityNotes: [] as string[], publicationGateIssues: [] as string[],
    featuredImage: "https://assets.example/verified.png", reviewedMediaUrls: ["https://assets.example/verified.png"],
  };
  const requests: ProviderRequest[] = [];
  const writes: PersistedReview[] = [];
  const mutations: string[] = [];
  const nextAudits: Audit[] = [];
  const behavior: { remediationMarkdown?: string; auditFor?: (request: ProviderRequest) => Audit;
    factScoreFor?: (markdown: string) => number } = {};
  const transport: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    const request: ProviderRequest = JSON.parse(String(init?.body));
    requests.push(request);
    assert.ok(requests.length <= 20, "Provider replay must remain bounded");
    const name = request.tool_choice.name;
    const reviewedMarkdown = name === "review_article"
      ? request.messages[0].content.split("Article to review:\n")[1] : markdown;
    const factualScore = behavior.factScoreFor?.(reviewedMarkdown) ?? 95;
    const response = name === "audit_final_article" ? behavior.auditFor?.(request) ?? nextAudits.shift() ?? audit
      : name === "review_article" ? { markdown: reviewedMarkdown, notes: "Controlled factual review.", confidenceScore: factualScore,
          claimCount: 100, verifiedCount: factualScore, citations: [] }
      : name === "remediate_final_article" ? { markdown: behavior.remediationMarkdown ?? markdown, notes: ["Controlled recovery edit."] }
      : name === "submit_final_metadata" ? { title: article.title, metaTitle: article.title,
          metaDescription: "Review your archive workflow using observed requirements, practical evaluation questions, and a clearly documented next action." }
      : undefined;
    assert.ok(response, `Unexpected provider operation: ${name}`);
    return new Response(JSON.stringify({ id: `msg_local_${requests.length}`, type: "message", role: "assistant",
      model: request.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 20, output_tokens: 20 },
      content: [{ type: "tool_use", id: `local_${requests.length}`, name, input: response }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const actualRequire = createRequire(import.meta.url);
  const runtime = { exports: {} as { reviewExistingArticleHandler: (ctx: unknown, args: ReviewArgs) => Promise<ReviewResult> } };
  runInNewContext(bundled, { module: runtime, exports: runtime.exports,
    require: (name: string) => name === "node:dns/promises" ? { lookup: async () => [] }
      : name === "node:https" ? { request() { throw new Error("Unexpected live network request"); } }
      : actualRequire(name),
    URL, Buffer, TextEncoder, TextDecoder, Response, Request, Headers, AbortSignal, fetch: transport,
    setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
    process: { env: { ANTHROPIC_API_KEY: "test-not-a-credential" } },
  });
  const ctx = {
    async runQuery(ref: Parameters<typeof getFunctionName>[0], args: Record<string, string>) {
      switch (getFunctionName(ref)) {
        case "sites:getFull":
          assert.equal(args.siteId, siteId);
          return { _id: siteId, siteName: `${siteId} Archive`, domain: `${siteId}.example`,
            publishMethod: "github", repoOwner: siteId, repoName: "archive", repoDefaultBranch: "main" };
        case "articles:getInternal":
          assert.equal(args.articleId, article._id);
          return structuredClone(article);
        default: throw new Error(`Unexpected query: ${getFunctionName(ref)}`);
      }
    },
    async runMutation(ref: Parameters<typeof getFunctionName>[0], args: PersistedReview & { articleId: string; issues: string[] }) {
      const name = getFunctionName(ref);
      mutations.push(name);
      assert.equal(args.articleId, article._id);
      if (name === "articles:applyQualityReview") {
        writes.push(structuredClone(args));
        Object.assign(article, structuredClone(args));
      } else if (name === "articles:recordPublicationCheck") {
        article.publicationGateIssues = [...args.issues];
      } else throw new Error(`Unexpected mutation: ${name}`);
    },
  };
  return { article, requests, writes, mutations, audit, nextAudits, behavior,
    run: (incrementRevision = false) => runtime.exports.reviewExistingArticleHandler(ctx,
      { siteId, articleId: article._id, incrementRevision }),
  };
}

test("required editorial corrections survive persistence and reach the next bounded review before general notes", async () => {
  for (const siteId of ["harbor", "cedar"]) {
    const f = fixture(siteId, { score: 82, notes: Array.from({ length: 25 }, (_, i) => `General review observation ${i}.`),
      materialDefects: [...corrections], claimEvidence: [] });
    const first = await f.run();
    assert.equal(first.readyForPublication, false, "The test must not promote an editorially failed draft");
    assert.equal(first.editorialQualityScore, 82);
    assert.equal(first.qualityRevisionCount, 0);
    for (const correction of corrections) {
      assert.ok(f.writes[0].editorialQualityNotes.some(note => note.includes(correction)),
        `Required correction was lost at persistence: ${correction}`);
    }
    const firstRequestCount = f.requests.length;
    assert.equal(firstRequestCount, 6, "The unchanged candidate must terminate after one guarded pass");
    const second = await f.run(true);
    const edit = f.requests[firstRequestCount + 2];
    assert.equal(edit.tool_choice.name, "remediate_final_article");
    const notes = edit.messages[0].content.split("INDEPENDENT AUDIT NOTES:\n")[1].split("\n\nFIRST-PARTY PRODUCT EVIDENCE:")[0];
    for (const correction of corrections) assert.ok(notes.includes(correction), "Next attempt must receive every material correction in this fixture");
    assert.ok(notes.indexOf(corrections[0]) < notes.indexOf("General review observation 0"));
    assert.ok(notes.split("\n").length <= 20, "Keep the existing persisted feedback bound");
    assert.equal(f.requests.length - firstRequestCount, 9, "The fresh baseline replaces a later pass and stays below the old ten-call maximum");
    assert.equal(second.readyForPublication, false);
    assert.equal(second.qualityRevisionCount, 1);
    assert.deepEqual(f.mutations, ["articles:applyQualityReview", "articles:recordPublicationCheck",
      "articles:applyQualityReview", "articles:recordPublicationCheck"]);
  }
});

test("a later exact audit replaces resolved corrections instead of preserving historical failure notes", async () => {
  const f = fixture("oak", { score: 82, notes: ["Current general observation."], materialDefects: [...corrections], claimEvidence: [] });
  await f.run();
  const currentCorrection = "Add a concrete decision rule for the unresolved handoff.";
  f.audit.materialDefects = [currentCorrection];
  await f.run(true);
  assert.ok(f.writes[1].editorialQualityNotes.some(note => note.includes(currentCorrection)));
  for (const resolved of corrections) assert.ok(f.writes[1].editorialQualityNotes.every(note => !note.includes(resolved)));
});

test("legacy explicit corrections outrank long generic gate summaries and duplicate notes", async () => {
  const f = fixture("maple", { score: 82, notes: [], materialDefects: [...corrections], claimEvidence: [] });
  const correction = `Remaining material editorial defect 1: ${corrections[0]}`;
  const ledger = "Remaining deterministic evidence defect 1: Remove the unsupported benchmark.";
  f.article.publicationGateIssues = Array.from({ length: 25 }, (_, i) => `Generic gate summary ${i}.`);
  f.article.editorialQualityNotes = ["General comment.", correction, ledger, correction];
  await f.run(true);
  const notes = f.requests[2].messages[0].content.split("INDEPENDENT AUDIT NOTES:\n")[1]
    .split("\n\nFIRST-PARTY PRODUCT EVIDENCE:")[0].split("\n");
  assert.equal(notes.length, 20);
  assert.equal(notes[0], `- ${correction}`);
  assert.equal(notes[1], `- ${ledger}`);
  assert.equal(notes.filter(note => note.includes(correction)).length, 1);
});

test("a rejected candidate cannot replace the selected artifact's material feedback", async () => {
  const f = fixture("birch", { score: 82, notes: [], materialDefects: [...corrections], claimEvidence: [] });
  f.nextAudits.push(f.audit, { score: 80, notes: [], materialDefects: ["Rejected candidate introduced an unrelated defect."], claimEvidence: [] });
  const result = await f.run();
  assert.equal(result.editorialQualityScore, 82);
  assert.equal(result.readyForPublication, false);
  assert.equal(f.requests.length, 6);
  for (const correction of corrections) assert.ok(f.writes[0].editorialQualityNotes.some(note => note.includes(correction)));
  assert.ok(f.writes[0].editorialQualityNotes.every(note => !note.includes("unrelated defect")));
});

test("a clean current audit neither fabricates nor retains resolved material defects", async () => {
  const f = fixture("elm", { score: 92, notes: ["Current prose is complete."], materialDefects: [], claimEvidence: [] });
  f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
  await f.run();
  assert.equal(f.requests.length, 3, "Clean prose needs no remediation or extra provider call");
  assert.ok(f.writes[0].editorialQualityNotes.every(note => !note.includes(corrections[0]) && !note.startsWith("Material editorial defect")));
});

test("the first recovery edit cannot replace a freshly stronger exact draft", async () => {
  for (const [siteId, candidateEditorial, candidateFactual] of [
    ["juniper", 80, 95], ["aspen", 92, 70],
  ] as const) {
    const f = fixture(siteId, { score: 82, notes: [], materialDefects: [corrections[0]], claimEvidence: [] });
    Object.assign(f.article, { editorialQualityScore: 99, factCheckScore: 100 });
    f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
    f.behavior.remediationMarkdown = `${markdown}\n\nInspect the candidate handoff separately.`;
    f.behavior.auditFor = request => request.messages[0].content.split("EXACT FINISHED ARTICLE:\n")[1]
      .includes("candidate handoff")
      ? { score: candidateEditorial, notes: [], materialDefects: candidateEditorial < 85 ? ["Candidate remains incomplete."] : [], claimEvidence: [] }
      : f.audit;
    f.behavior.factScoreFor = body => body.includes("candidate handoff") ? candidateFactual : 95;
    const result = await f.run(true);
    assert.equal(result.editorialQualityScore, 82, "Select the freshly audited baseline, not the weaker initial edit");
    assert.equal(result.factCheckScore, 95);
    assert.equal(result.qualityRevisionCount, 1);
    assert.equal(result.readyForPublication, false);
    assert.equal(f.writes[0].markdown, markdown);
    assert.ok(f.requests.length <= 10, "Do not increase the old ten-call maximum for a length-valid recovery");
  }
});

test("a non-regressing first recovery improvement is still retained", async () => {
  const f = fixture("willow", { score: 82, notes: [], materialDefects: [corrections[0]], claimEvidence: [] });
  f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
  const candidate = `${markdown}\n\nInspect the improved handoff separately.`;
  f.behavior.remediationMarkdown = candidate;
  f.behavior.auditFor = request => request.messages[0].content.split("EXACT FINISHED ARTICLE:\n")[1]
    .includes("improved handoff") ? { score: 92, notes: [], materialDefects: [], claimEvidence: [] } : f.audit;
  const result = await f.run(true);
  assert.equal(result.editorialQualityScore, 92);
  assert.equal(result.factCheckScore, 95);
  assert.equal(f.writes[0].markdown, candidate);
  assert.equal(f.requests.length, 6, "Passing recovery needs no later editing pass");
});

test("a truncated first edit preserves a complete fresh baseline without paid length reconstruction", async () => {
  const f = fixture("fir", { score: 82, notes: [], materialDefects: [corrections[0]], claimEvidence: [] });
  f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
  f.behavior.remediationMarkdown = "Review your own requirements before choosing the next step.";
  const result = await f.run(true);
  assert.equal(result.readyForPublication, false);
  assert.equal(f.writes[0].markdown, markdown);
  assert.ok(f.writes[0].editorialQualityNotes.some(note => note.includes("broke the length contract")));
  assert.equal(f.requests.length, 7);
  assert.ok(f.requests.every(request => !request.messages[0].content.includes("Evidence-safe length recovery pass")));
});

test("a higher editorial score cannot conceal newly introduced deterministic evidence defects", async () => {
  for (const incrementRevision of [false, true]) {
    const f = fixture("poplar", { score: 80, notes: [], materialDefects: [corrections[0]], claimEvidence: [] });
    f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
    f.behavior.remediationMarkdown = `${markdown}\n\npoplar Archive synchronizes records with every connected inbox automatically.`;
    f.behavior.auditFor = request => request.messages[0].content.split("EXACT FINISHED ARTICLE:\n")[1]
      .includes("synchronizes records")
      ? { score: 84, notes: [], materialDefects: ["Clarify the handoff."], claimEvidence: [] } : f.audit;
    const result = await f.run(incrementRevision);
    assert.equal(result.editorialQualityScore, 80);
    assert.equal(f.writes[0].markdown, markdown, "A missing claim receipt must not trade away for a higher subjective score");
    assert.equal(result.readyForPublication, false);
    assert.ok(f.requests.length <= 10);
  }
});

test("an already incomplete stored draft cannot be selected as a fallback over a complete recovery", async () => {
  const f = fixture("larch", { score: 82, notes: [], materialDefects: [corrections[0]], claimEvidence: [] });
  f.article.markdown = "A short unfinished draft.";
  f.article.editorialQualityNotes = [`Material editorial defect 1: ${corrections[0]}`];
  const result = await f.run(true);
  assert.equal(f.requests[0].tool_choice.name, "remediate_final_article");
  assert.equal(f.writes[0].markdown, markdown);
  assert.equal(result.readyForPublication, false);
  assert.equal(result.qualityRevisionCount, 1);
  assert.equal(f.requests.length, 7);
});
