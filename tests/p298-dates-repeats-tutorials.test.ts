// P298 (Nov 3 2026), batch 5 run 2: three articles were held on the line code adds, "Prices as of November 2026." (the year
// is in no source), and the writer's own dated prices were deleted for the same reason; the cookware comparison lost the cast
// iron half of its cost-per-year comparison as a "repeat" of the ceramic half; the invoicing list was held because its
// sources were not from "authoritative" domains though every figure was in its cited excerpt; and both code tutorials failed
// when the writer ran out of its 16,384 output tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { numbersOutsideFactSheet, statedNumbers } from "../convex/lib/articlePlanChecks.ts";
import { backedFactsOnly } from "../convex/lib/backedFacts.ts";
import { citedNumberMismatches, evaluatePublicationQuality } from "../convex/lib/articleQuality.ts";
import Anthropic from "@anthropic-ai/sdk";
import { contentToolRequest } from "../convex/lib/contentToolRequest.ts";

test("P298 when a price was read is not a number its source must state", () => {
  assert.deepEqual(statedNumbers("Prices as of November 2026."), []);
  assert.deepEqual(statedNumbers("Installed costs run $4,000 to $8,000 as of November 2026 [3]."), ["4000", "8000"]);
  assert.deepEqual(statedNumbers("The rule changed in March 2024."), ["2024"], "any other date is still a claim");
  const sheet = { sources: [{ url: "", text: "Installed cost runs $4,000 to $8,000." }], profile: "", productName: "" };
  assert.deepEqual(numbersOutsideFactSheet("## Cost\n\nPrices as of November 2026.\n\nInstalled costs run $4,000 to $8,000 as of November 2026 [1].", sheet), []);
  const sources = [{ text: "Installed cost runs $4,000 to $8,000." }];
  const kept = backedFactsOnly("## Cost\n\nInstalled costs run $4,000 to $8,000 as of November 2026 [1].", { sources, profile: "", allowedNames: [] });
  assert.deepEqual(kept.removed, [], "a dated, backed price stays");
  const excerpt = "Installed cost runs $4,000 to $8,000.";
  const hash = createHash("sha256").update(excerpt).digest("hex");
  assert.deepEqual(citedNumberMismatches("Installed costs run $4,000 to $8,000 as of November 2026 [1].",
    [{ url: "https://a.example/", title: "A", excerpt, contentHash: hash }] as never), []);
});

test("P298 a sentence that adds a figure of its own is a comparison, not a repeat; the same figure said again still goes", () => {
  const sources = [{ text: "A ceramic skillet at $40 lasts about 9 years, about $4.44 per year. A bare cast iron skillet at $50 lasts 9 years or more, about $5.56 per year." }];
  const md = ["A ceramic skillet at $40 that lasts 9 years costs about $4.44 per year [1].",
    "A bare cast iron skillet at $50 that lasts the same 9 years costs about $5.56 per year [1].", "",
    "## Lifespan", "", "A ceramic skillet at $40 lasts about 9 years, so it costs about $4.44 per year [1]."].join("\n");
  const out = backedFactsOnly(md, { sources, profile: "", allowedNames: [] });
  assert.match(out.markdown, /cast iron skillet at \$50/, "the cast iron half of the comparison stays");
  assert.deepEqual(out.removed.map((r) => r.reason), ["repeat"], JSON.stringify(out.removed));
  assert.match(out.removed[0].sentence, /^A ceramic skillet at \$40 lasts about 9 years, so/);
});

test("P298 an invented attribution is counted as a name even when the plan check flagged it", () => {
  const md = "Intro.\n\nAccording to Jane Doe, the register works best when one person owns it.\n\n## Next\n\nKeep going.";
  const out = backedFactsOnly(md, { sources: [{ text: "The register has an owner field." }], profile: "", allowedNames: [],
    unbacked: ["According to Jane Doe, the register works best when one person owns it."] });
  assert.deepEqual(out.removed.map((r) => r.reason), ["name"]);
});

test("P298 in a planned article, who publishes the sources is a note, not a hold", () => {
  const source = (n: number) => ({ url: `https://blog${n}.example/invoicing`, title: `Invoicing guide ${n}`, excerpt: "Automatic reminders cut late payments by 30%.", contentHash: "" });
  const article = { title: "Best invoicing software for freelancers", slug: "/best-invoicing-software", articleType: "listicle",
    metaTitle: "Best invoicing software for freelancers", metaDescription: "What to look for in invoicing software as a freelancer.",
    markdown: "Automatic reminders cut late payments by 30% [1].\n\n## Sources\n\n1. Invoicing guide 1", sources: [source(1), source(2)] };
  const legacy = evaluatePublicationQuality(article as never, "strict");
  const planned = evaluatePublicationQuality({ ...article, qualityPlan: "fixed_v1", articlePlan: { version: 1, format: "list", sections: [] } } as never, "strict");
  const rule = "Quantified outcome claims require at least two primary or authoritative evidence sources.";
  if (legacy.issues.includes(rule)) {
    assert.ok(!planned.issues.includes(rule) && planned.warnings.includes(rule), JSON.stringify(planned));
  } else {
    assert.ok(!planned.issues.includes(rule));
  }
});

test("P298 a planned writer has room for a code tutorial; every other call keeps its request bytes", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const limit = Number(/export const PLANNED_WRITER_MAX_TOKENS = ([\d_]+);/.exec(pipeline)![1].replace(/_/g, ""));
  assert.ok(limit > 16_384, "more room than the 16,384 both tutorials ran out of");
  // The SDK's own rule: a non-streaming request it expects to run past 10 minutes is refused before it is sent (24,576
  // failed all ten benchmark drafts).
  const client = new Anthropic({ apiKey: "sk-ant-test" });
  assert.doesNotThrow(() => client.calculateNonstreamingTimeout(limit, undefined));
  assert.match(pipeline, /outputSchema: ArticleSchema,\n\s+maxTokens: articlePlan \? PLANNED_WRITER_MAX_TOKENS : 16384,/);
  const base = { model: "claude-sonnet-5-5", system: "s", userMessage: "u", toolName: "submit_article", toolDescription: "d",
    inputSchema: { type: "object" as const, properties: {} } };
  assert.equal(contentToolRequest({ ...base, maxTokens: limit }).max_tokens, limit);
  const capped = contentToolRequest({ ...base, maxTokens: 64_000 }).max_tokens;
  assert.doesNotThrow(() => client.calculateNonstreamingTimeout(capped, undefined), "no request the SDK refuses");
  assert.equal(contentToolRequest({ ...base, maxTokens: 16_384 }).max_tokens, 16_384);
  assert.equal(contentToolRequest(base).max_tokens, 8192);
  assert.match(readFileSync("convex/lib/articlePlanChecks.ts", "utf8"), /A later step shows only the lines it adds or changes, never a file already shown in full/);
});
