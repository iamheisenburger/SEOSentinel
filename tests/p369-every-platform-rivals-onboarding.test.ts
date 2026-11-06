/** P369 (Nov 6 2026): Phase 3's search title tests reach WordPress (the Pentra plugin's 1.4.0 metadata write: the title and
 * description Pentra serves change, the post's text never), Phase 5 says who the AI assistants name instead of the
 * business, and Phase 6's onboarding runs a new site's first diagnosis the minute it chooses Autopilot (rollout sites).
 * Fictional sites only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiAnswerTotals, rivalMatchers, rivalsNamed, topRivals, type AiAnswerCheck } from "../convex/lib/aiAnswers.ts";
import { weeklyReportEmail } from "../convex/lib/customerNotices.ts";

test("WordPress: a search title test is a metadata-only write, refused by an older plugin before anything changes", () => {
  const plugin = readFileSync("connectors/wordpress/pentra-conditional-publisher.php", "utf8");
  assert.match(plugin, / \* Version: 1\.4\.0/);
  assert.match(plugin, /'redirects'=>1, 'metadata'=>1,/, "the connection says it can");
  assert.match(plugin, /\['create','append','replace','rollback','metadata'\]/);
  assert.match(plugin, /if \(\(\$body\['content'\] \?\? null\) !== \$content \|\| !is_array\(\$body\['metadata'\] \?\? null\)\) \{ throw new RuntimeException\('invalid_request'\); \}/,
    "the post's text is sent back unchanged");
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /if \(correction\?\.kind === "search_snippet"\) return \{ key: revision\.revisionKey, operation: "metadata",/);
  assert.match(publisher, /if \(correction\?\.kind === "search_snippet" && connection\.metadata !== 1\) throw new Error\("Search title tests need the Pentra WordPress plugin 1\.4\.0 or later"\);/);
  assert.ok(publisher.indexOf('connection.metadata !== 1') < publisher.indexOf('await beforeExternalMutation(); delivered = await wordpressConditionalRequest(site, "write", body);'),
    "checked before the write is recorded as attempted");
  assert.match(readFileSync("connectors/wordpress/README.md", "utf8"), /Version 1\.4\.0 lets Pentra test a new search title/);
});

const check = (text: string, rivals: string[], extra: Partial<AiAnswerCheck> = {}): AiAnswerCheck =>
  ({ question: "q", assistant: "chatgpt", answered: true, named: false, cited: false, rivals: rivalsNamed(text, rivalMatchers(rivals, { domain: "quillpad.example" })), ...extra });

test("Phase 5: the rivals an answer names, by address or as a name (capitalised), never the business itself", () => {
  const rivals = ["instantly.ai", "LeadGenApp", "https://www.leadgenapp.io/", "quillpad.example", "ai"];
  const m = rivalMatchers(rivals, { domain: "quillpad.example" });
  assert.deepEqual(m.map((r) => r.name), ["instantly.ai", "LeadGenApp"], "one rival per company, never the business, never a two-letter name");
  assert.deepEqual(rivalsNamed("For small teams, Instantly and LeadGenApp are popular choices.", m), ["instantly.ai", "LeadGenApp"]);
  assert.deepEqual(rivalsNamed("It scores leads instantly, without any setup.", m), [], "an everyday word is not a brand");
  assert.deepEqual(rivalsNamed("See instantly.ai for cold email.", m), ["instantly.ai"]);
  const checks = [check("Instantly is a good pick.", rivals), check("Try Instantly or LeadGenApp.", rivals), check("LeadGenApp works.", rivals),
    check("Instantly again.", rivals, { answered: false })];
  assert.deepEqual(topRivals(checks), [{ name: "instantly.ai", answers: 2 }, { name: "LeadGenApp", answers: 2 }]);
  assert.deepEqual(aiAnswerTotals(checks).namedInstead, topRivals(checks));
  const email = weeklyReportEmail({ domain: "quillpad.example", search: "not_connected", factors: { ai: "failing" }, problems: [], fixed: [], published: [], improved: [],
    aiNamed: { named: 0, asked: 12 }, namedInstead: [{ name: "instantly.ai", answers: 7 }, { name: "LeadGenApp", answers: 4 }], next: null });
  assert.match(email.text, /\(they name these instead: instantly\.ai in 7, LeadGenApp in 4\)/);
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /rivals: rivalsNamed\(got\.answer\.text, rivals\) \}/);
  assert.match(readFileSync("convex/siteDiagnosis.ts", "utf8"), /rivals: \[\.\.\.\(site\.competitors \?\? \[\]\), \.\.\.linkCompetitors\(latest\?\.pageOne \?\? \[\], site\.domain, 5\)\],/);
  assert.match(readFileSync("convex/lib/siteDiagnosis.ts", "utf8"), /; named instead: \$\{input\.aiAnswers\.namedInstead!\.map/);
});

test("Phase 6: a rollout site's first diagnosis runs a minute after it chooses Autopilot, once; others wait for their rollout", () => {
  const diagnosis = readFileSync("convex/siteDiagnosis.ts", "utf8");
  assert.match(diagnosis, /export async function scheduleFirstDiagnosis\(ctx: MutationCtx, site: Doc<"sites">\) \{\n  if \(!onNewSystem\(site\)\) return;/);
  assert.match(diagnosis, /if \(await ctx\.db\.query\("site_diagnoses"\)\.withIndex\("by_site_created", \(q\) => q\.eq\("siteId", site\._id\)\)\.first\(\)\) return;/);
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.equal((work.match(/await scheduleFirstDiagnosis\(ctx, /g) ?? []).length, 3, "the setup choice, adopting Autopilot, and switching to it");
});

test("Phase 4: switching link building on finds pages at once from the latest diagnosis, under a small hold", () => {
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /if \(wasOff && mode !== "off" && !\(await rows\(ctx, siteId\)\)\.some\(\(o\) => o\.url\)\) await ctx\.scheduler\.runAfter\(0, internal\.actions\.linkOutreach\.findNow, \{ siteId \}\);/);
  const action = readFileSync("convex/actions/linkOutreach.ts", "utf8");
  assert.match(action, /reservedMicroUsd: FIND_HOLD_MICRO_USD/);
  assert.match(action, /meterDataForSeoCost\(\(\) => pageIntersection\(pageIntersectionRequest\(pair, siteDomain\)\)\)/);
});
