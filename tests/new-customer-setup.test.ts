import assert from "node:assert/strict";
import test from "node:test";
import { githubContentFolder, pacesFor } from "../src/lib/content-setup.ts";
import { corePipelineFixture, START, type Fields } from "./helpers/core-pipeline-fixture.ts";

// From the first outside new-user run (Compost Notes, Oct 21 2026): GitHub
// "Connect" failed silently, the product description was the page's headings,
// and a free plan was offered paces it can't keep.

const HOST = "compostnotes.co";
const HOME = `<!doctype html><html lang="en"><head><title>Compost Notes: plain guides to home composting</title>
<meta name="description" content="Compost Notes is a small test publication run by Pentra, with plain, practical articles about home composting for home gardeners."></head>
<body><h1>Compost Notes</h1><h2>About home composting</h2><p>${"Home composting turns kitchen scraps and garden waste into a material that improves soil. ".repeat(6)}</p>
<h2>Who these notes are for</h2><p>The notes are written for home gardeners with a garden, a shared plot or a few containers on a balcony.</p></body></html>`;

function world(seedAnswer: unknown = { sells: "Plain, practical articles about home composting, from a small test publication.",
  customers: "Home gardeners who want to compost kitchen and garden waste.", topics: ["home composting", "compost bin"],
  searches: ["how to start composting", "compost bin for small garden"], places: [], free_plan: "unknown" }) {
  const seedCalls: string[] = [];
  const f = corePipelineFixture(async (url, init) => {
    if (url.hostname === HOST || url.hostname === `www.${HOST}`) {
      return new Response(url.pathname === "/" ? HOME : "not found", { status: url.pathname === "/" ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.origin === "https://api.anthropic.com") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.tools?.[0]?.name, "submit_search_seeds");
      seedCalls.push(String(body.messages[0].content));
      return new Response(JSON.stringify({ id: "synthetic", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "tool_use", id: "t", name: "submit_search_seeds", input: seedAnswer }] }),
      { headers: { "content-type": "application/json" } });
    }
    assert.fail(`Unexpected network ${url.href}`);
  }, {}, { syntheticHosts: [HOST, `www.${HOST}`] });
  return { f, seedCalls };
}

function site(f: ReturnType<typeof corePipelineFixture>, fields: Fields = {}) {
  const userId = "synthetic-new-owner";
  if (!f.tables.account_plan_entitlements?.some(row => row.userId === userId)) {
    f.add("account_plan_entitlements", { userId, status: "completed", maxSites: 1, maxArticles: 3, planFeatures: [] });
  }
  return f.add("sites", { userId, domain: HOST, siteName: "Compost Notes", createdAt: START, updatedAt: START, publishMethod: "github",
    contentSetupRequestedAt: START, ...fields });
}

test("setup fills in what the business sells from a reading of its homepage, not its headings", async () => {
  const { f, seedCalls } = world();
  f.setIdentity("synthetic-new-owner");
  const found = await f.invoke("actions/onboardingPrefill:prefill", { domain: `https://${HOST}/` });
  assert.equal(found.product, "Plain, practical articles about home composting, from a small test publication.");
  assert.doesNotMatch(found.product, /Includes:/, "never the site name plus its section headings");
  assert.equal(found.audience, "Home gardeners who want to compost kitchen and garden waste.");
  assert.match(found.summary, /small test publication run by Pentra/, "the page's own description stays the summary");
  assert.equal(seedCalls.length, 1);
  // When the reading fails, the homepage's own words still fill the form.
  const fallback = world({ sells: "", customers: "", topics: [], searches: [], places: [], free_plan: "unknown" });
  fallback.f.setIdentity("synthetic-new-owner");
  assert.match((await fallback.f.invoke("actions/onboardingPrefill:prefill", { domain: HOST })).product, /Compost Notes/);
});

test("GitHub connects before a repository is chosen, so the repository list can appear", async () => {
  const { f } = world();
  const siteId = site(f);
  await f.invoke("sites:setGithubTokenOnlyInternal", { siteId, githubToken: "synthetic-only-token" });
  const saved = f.get(siteId)!;
  assert.equal(saved.githubToken, "synthetic-only-token");
  assert.equal(saved.repoOwner, undefined); assert.equal(saved.repoDefaultBranch, undefined, "a branch is learned only from the chosen repository");
  assert.equal(saved.autopilotRolloutMode, "observe", "nothing publishes until the repository is verified");
  // A site that already has a repository saved verifies it in the full flow instead.
  const withRepo = site(f, { repoOwner: "acme", repoName: "blog" });
  await assert.rejects(f.invoke("sites:setGithubTokenOnlyInternal", { siteId: withRepo, githubToken: "synthetic-only-token" }), /already has a GitHub repository saved/);
});

test("a plan is offered only paces it can keep, and the article folder is shown", () => {
  assert.deepEqual(pacesFor(3, null), [1], "free: 3 a month");
  assert.deepEqual(pacesFor(10, null), [1, 2]);
  assert.deepEqual(pacesFor(25, null), [1, 2, 4]);
  assert.deepEqual(pacesFor(60, null), [1, 2, 4, 7, 14]);
  assert.deepEqual(pacesFor(150, null), [1, 2, 4, 7, 14, 21]);
  assert.deepEqual(pacesFor(3, 7), [1, 7], "a pace already chosen stays listed");
  assert.deepEqual(pacesFor(null, null), [1, 2, 4, 7, 14, 21]);
  assert.equal(githubContentFolder("/blog/[slug]"), "content/blog");
  assert.equal(githubContentFolder("/resources/guides/[slug]"), "content/resources/guides");
  assert.equal(githubContentFolder("/[slug]"), "content/posts");
  assert.equal(githubContentFolder(undefined), "content/blog");
});
