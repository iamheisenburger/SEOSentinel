/** P370 (Nov 6 2026): search title tests are placed on WordPress, Ghost, Shopify and Webflow sites too. A GitHub site's
 * tests go through Autopilot's repair round (spaced two hours: each change is a deploy); every other platform's are placed
 * one at a time, 30 minutes apart, never within two hours of a publishing slot, only while Autopilot runs. Fictional sites. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { serpBriefPrompt } from "../convex/lib/serpBrief.ts";

function bundle(entry: string): Record<string, unknown> {
  const text = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const mod = { exports: {} as Record<string, unknown> };
  runInNewContext(text, { module: mod, exports: mod.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder, console,
    process: { env: {} }, Buffer, setTimeout, clearTimeout });
  return mod.exports;
}

test("a non-GitHub site gets its title tests while Autopilot runs: one at a time, 30 minutes apart, never near a slot", () => {
  const { snippetPlacementAllowed } = bundle("convex/lib/contentCorrection.ts") as { snippetPlacementAllowed: (site: unknown, now: number) => boolean };
  const now = Date.UTC(2026, 10, 9, 15);
  const site = (extra: Record<string, unknown> = {}, schedule: Record<string, unknown> = {}) => ({ serviceMode: "growth_first", autopilotEnabled: true,
    publishMethod: "wordpress", ...extra, contentSchedule: { autopilotSelectedAt: 1, autopublishConsentAt: 1, paused: false, nextDeadlineAt: now + 5 * 3_600_000, ...schedule } });
  assert.equal(snippetPlacementAllowed(site(), now), true);
  for (const method of ["ghost", "shopify", "webflow"]) assert.equal(snippetPlacementAllowed(site({ publishMethod: method }), now), true, method);
  assert.equal(snippetPlacementAllowed(site({ publishMethod: "github" }), now), false, "GitHub sites use the repair round");
  assert.equal(snippetPlacementAllowed(site({}, { paused: true }), now), false);
  assert.equal(snippetPlacementAllowed(site({ approvalRequired: true }), now), false);
  assert.equal(snippetPlacementAllowed(site({}, { nextDeadlineAt: now + 3_600_000 }), now), false, "never within two hours of a slot");
  assert.equal(snippetPlacementAllowed(site({}, { snippetPlacedAt: now - 10 * 60_000 }), now), false, "30 minutes after the last test");
  assert.equal(snippetPlacementAllowed(site({}, { snippetPlacedAt: now - 31 * 60_000 }), now), true);
});

test("the weekly run hands each platform's tests to the right placer, and offers waiting ones again", () => {
  const snippets = readFileSync("convex/searchSnippets.ts", "utf8");
  assert.match(snippets, /if \(\(site\.publishMethod \?\? "github"\) === "github"\) await bringRepairForward\(ctx, site\._id\);\n  else await ctx\.scheduler\.runAfter\(0, internal\.contentImprovements\.requestSnippetTests, \{ siteId: site\._id \}\);/);
  assert.match(snippets, /if \(waiting\) await placeTests\(ctx, site\);/);
  assert.match(snippets, /if \(restores && site\) await placeTests\(ctx, site\);/);
  const improvements = readFileSync("convex/contentImprovements.ts", "utf8");
  assert.match(improvements, /export const requestSnippetTests = internalMutation/);
  assert.match(improvements, /const patch = planCorrectiveChange\(site, page, \{ kind: "search_snippet", before: encodeSnippet\(test\.before\), replacement: encodeSnippet\(test\.after\),/,
    "the same exact correction path, checked live and reversible");
  assert.match(improvements, /await ctx\.scheduler\.runAfter\(SNIPPET_PLACEMENT_SPACING_MS, internal\.contentImprovements\.requestSnippetTests, \{ siteId \}\);/);
});

test("Phase 3: every new article adds one useful thing none of Google's first page gives, from verified facts only", () => {
  const prompt = serpBriefPrompt({ observedAt: 1, locationCode: 2840, languageCode: "en", format: "list", questions: [],
    results: [{ title: "20 Best Lead Scoring Tools", url: "https://example.com/best" }] });
  assert.match(prompt, /Be at least as useful as the first three results/);
  assert.match(prompt, /Then add one useful thing none of these results gives the reader \(a checklist, a template, a worked example or a comparison table\), built only from the verified sources and the business's confirmed facts: no invented numbers, names or results\./);
});
