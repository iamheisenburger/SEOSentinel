import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

const source = buildSync({ entryPoints: ["src/app/sitemap.ts"], bundle: true,
  platform: "node", format: "cjs", external: ["@/lib/convexHttpClient", "../../convex/_generated/api", "@/lib/committed-articles", "@/lib/hosted-answers"],
  write: false }).outputFiles[0].text;

function fixture(domain: string, requestHost = "") {
  let unavailable = true;
  let articles = [{ slug: "fresh-article", updatedAt: 1000 }];
  let queries = 0, committedReads = 0;
  const runtimeModule = { exports: {} as { dynamic: string; default(): Promise<Array<{ url: string }>> } };
  runInNewContext(source, { module: runtimeModule, exports: runtimeModule.exports, process: { env: { NEXT_PUBLIC_SITE_URL: `https://${domain}` } },
    require(name: string) {
      // Pentra Answers (Nov 2026): a hosted answers address (answers.<customer domain>) lists its own answer pages.
      if (name === "@/lib/hosted-answers") return { requestHost: async () => requestHost,
        isHostedAnswersHost: (host: string) => host.startsWith("answers.") };
      if (name === "@/lib/convexHttpClient") return { convexHttp: { async query(ref: unknown, args: { domain?: string; host?: string }) {
        if (ref === "hostedIndex") return { pages: [{ slug: "find-web-design-clients", updatedAt: 2000 }], business: { name: "Acme", domain: "acme.example" } };
        assert.equal(args.domain, domain); queries++;
        if (unavailable) throw new Error("Backend unavailable");
        return { articles, urlStructure: "/articles/[slug]" };
      } } };
      // P240: pentra.dev lists its committed articles when Convex cannot be read; no other domain does.
      if (name === "@/lib/committed-articles") return { COMMITTED_BLOG_DOMAIN: "pentra.dev",
        async listCommittedArticles() { committedReads++; return [{ slug: "committed-article", updatedAt: 500 }]; } };
      assert.equal(name, "../../convex/_generated/api");
      return { api: { blog: { listPublishedSlugs: "slugs" }, answerPublish: { hostedIndex: "hostedIndex" } } };
    },
  });
  return { runtime: runtimeModule.exports, restore() { unavailable = false; }, fail() { unavailable = true; },
    revoke() { articles = []; }, queryCount: () => queries, committedReads: () => committedReads };
}

test("sitemap recovers without redeployment and respects fresh publication/revocation for either domain", async () => {
  for (const domain of ["tenant-a.example", "tenant-b.example"]) {
    const f = fixture(domain);
    assert.equal(f.runtime.dynamic, "force-dynamic", "must not prerender a permanent build-time snapshot");
    await assert.rejects(f.runtime.default(), /Backend unavailable/, "outage must not masquerade as a complete sitemap");
    f.restore();
    assert.equal((await f.runtime.default()).at(-1)?.url, `https://${domain}/articles/fresh-article`);
    f.revoke();
    assert.equal((await f.runtime.default()).some(row => row.url.includes("fresh-article")), false);
    f.fail();
    await assert.rejects(f.runtime.default(), /Backend unavailable/);
    assert.equal(f.queryCount(), 4, "must not reuse a stale success or failure");
    assert.equal(f.committedReads(), 0, "another domain never lists pentra.dev's committed files");
  }
});

// P240 (Oct 29 2026): Convex disabled the deployment and pentra.dev's sitemap answered 500 with it.
test("P240 pentra.dev's sitemap lists its committed articles while Convex cannot be read, and Convex's own list once it can", async () => {
  const f = fixture("pentra.dev");
  const during = await f.runtime.default();
  assert.equal(during.at(-1)?.url, "https://pentra.dev/blog/committed-article");
  f.restore();
  const after = await f.runtime.default();
  assert.equal(after.at(-1)?.url, "https://pentra.dev/articles/fresh-article");
  assert.equal(after.some(row => row.url.includes("committed-article")), false, "a working Convex answer wins");
  assert.deepEqual([f.queryCount(), f.committedReads()], [2, 1]);
});

test("a hosted answers address's sitemap lists its own answer pages, never Pentra's", async () => {
  const site = fixture("pentra.dev", "answers.acme.example");
  const urls = JSON.parse(JSON.stringify((await site.runtime.default()).map((entry) => entry.url)));
  assert.deepEqual(urls, ["https://answers.acme.example/", "https://answers.acme.example/find-web-design-clients"]);
  assert.equal(site.queryCount(), 0, "Pentra's own blog list is never read for a customer's address");
});
