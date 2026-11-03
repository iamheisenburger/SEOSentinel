// P290 + P291 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md steps 0 and 6, holes 4 and 7): the customer only ever sees a finished
// article, and Pentra picks topics it can write well. A slot whose first article was held after its one fix takes the next
// topic once; no line is handed to the customer to check. Before any writing, research must have found what the search's
// format needs (a list its options' own pages, a tutorial the official docs, three usable sources otherwise), or the topic
// is skipped for the cost of its research. A tutorial's code may use only what its documentation sources show.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourcingGaps, TopicNotSourceable, undocumentedCodeNames } from "../convex/lib/topicSourcing.ts";

test("P291 step 0: a topic is written only when research found what its format needs", () => {
  assert.match(sourcingGaps("list", { owner: 3, publication: 2, context: 1 }).join(), /own pricing or product pages \(found 3, needs 4\)/);
  assert.deepEqual(sourcingGaps("list", { owner: 4, publication: 0, context: 0 }), []);
  assert.match(sourcingGaps("tutorial", { owner: 1, publication: 3, context: 0 }).join(), /official documentation/);
  assert.deepEqual(sourcingGaps("tutorial", { owner: 2, publication: 0, context: 0 }), []);
  assert.match(sourcingGaps("comparison", { owner: 1, publication: 0, context: 3 }).join(), /each side's facts/);
  assert.match(sourcingGaps("how-to", { owner: 0, publication: 1, context: 1 }).join(), /kept 2 usable source\(s\), needs 3/);
  assert.deepEqual(sourcingGaps("guide", { owner: 0, publication: 1, context: 2 }), []);
  assert.match(new TopicNotSourceable(["x"]).message, /^Topic skipped before writing: x$/);
});

test("P291 hole 4: a tutorial's code names that its documentation doesn't show go to the one fix", () => {
  const md = "Intro.\n\n```js\nconst logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });\nlogger.child({ id }).info('x');\n" +
    "console.log(JSON.stringify(x));\npino.destination('./app.log');\n```\n";
  assert.deepEqual(undocumentedCodeNames(md, "pino(options) accepts level. logger.child(bindings) returns a child. pino.destination(path)"), []);
  assert.deepEqual(undocumentedCodeNames(md, "pino(options) accepts level. pino.destination(path)"), ["child"]);
});

test("P290 step 6: one replacement for a held first article, never homework; P291 wiring", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /\(cw\.failure !== "bounded_content_quality_exhausted" \|\| rejudged \|\| !cw\.replacesJobId\) &&\n    \(!cw\.replacesJobId \|\| HELD_BACK_FAILURES\.has\(cw\.failure \?\? ""\) \|\| rejudged\)/,
    "the slot's first held article is replaced once; a held replacement is not");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /factCheckNotes: `Code checks \(fixed plan v1\): \$\{failures\.length \? `\$\{failures\.length\} to fix` : "passed"\}\.`,/,
    "no 'Unverified claim' line reaches the owner's marked draft");
  assert.match(pipeline, /if \(articlePlan && contentProviderAutopilotDraft\(\) && contentWebResearchEnabled\(\)\) \{\n\s+const gaps = sourcingGaps\(articlePlan\.format, plannedSourcing \?\? \{ owner: 0, publication: 0, context: researchSources\.length \}\);\n\s+if \(gaps\.length\) throw new TopicNotSourceable\(gaps\);/);
  assert.ok(pipeline.indexOf("throw new TopicNotSourceable(gaps)") < pipeline.indexOf("// ── Step 1b: YouTube Video Search"), "before any writing");
  assert.match(pipeline, /if \(!\(error instanceof TopicNotSourceable\) \|\| !payload\?\.topicId\) throw error;\n\s+const settlement = await ctx\.runMutation\(internal\.topics\.markTopicUnsourceableInternal,/);
  assert.match(pipeline, /Use only functions, options and commands the excerpts show\./);
  const topics = readFileSync("convex/topics.ts", "utf8");
  assert.match(topics, /contentFeasibilityStatus: "too_thin", contentFeasibilityVersion: CONTENT_FEASIBILITY_VERSION,/);
});
