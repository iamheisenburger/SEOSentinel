// P258 (Oct 30 2026): weekend mandate, Webflow publishing proven live. Pentra's own Webflow publisher put a real article
// on pentra-webflow-test.webflow.io (200, title and opening shown; ops/scripts/webflow-live-test.mjs), but the platform's
// page has no single canonical link, so the exact renderer check Pentra used for every non-GitHub growth site would never
// have marked it live. A hosted platform renders the post in its own template, like a GitHub blog layout (P244): it is
// live when its URL serves the title and the opening of the first paragraph; the platform's item receipt proves the write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { layoutArticleLive } from "../convex/lib/githubLayout.ts";

// The live page, as Pentra's verifier fetched it on Oct 30 2026, and the article Pentra sent.
const page = readFileSync("tests/fixtures/webflow-live-post.html", "utf8");
const markdown = readFileSync("content/blog/competitive-keyword-research-method.md", "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();

test("P258 a hosted platform's live post is checked by its title and opening text, not Pentra's exact renderer", () => {
  assert.doesNotMatch(page, /rel="canonical"/, "the platform's page has no canonical link: the exact check could never pass");
  assert.equal(layoutArticleLive(page, markdown), true, "the live Webflow post shows the article's title and opening");
  assert.equal(layoutArticleLive(page.replace(/Competitive keyword research is the process/g, "Something else entirely is"), markdown), false);
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /if \(site\.serviceMode === "growth_first" && \(site\.githubLayout \|\| isApiCmsMethod\(site\.publishMethod\)\)\) \{\n        if \(!layoutArticleLive\(fetched\.text, article\.markdown\)\)/);
});
