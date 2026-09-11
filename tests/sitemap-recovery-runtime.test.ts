import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

const source = buildSync({ entryPoints: ["src/app/sitemap.ts"], bundle: true,
  platform: "node", format: "cjs", external: ["@/lib/convexHttpClient", "../../convex/_generated/api"],
  write: false }).outputFiles[0].text;

function fixture(domain: string) {
  let unavailable = true;
  let articles = [{ slug: "fresh-article", updatedAt: 1000 }];
  let queries = 0;
  const runtimeModule = { exports: {} as { dynamic: string; default(): Promise<Array<{ url: string }>> } };
  runInNewContext(source, { module: runtimeModule, exports: runtimeModule.exports, process: { env: { NEXT_PUBLIC_SITE_URL: `https://${domain}` } },
    require(name: string) {
      if (name === "@/lib/convexHttpClient") return { convexHttp: { async query(_ref: unknown, args: { domain: string }) {
        assert.equal(args.domain, domain); queries++;
        if (unavailable) throw new Error("Backend unavailable");
        return { articles, urlStructure: "/articles/[slug]" };
      } } };
      assert.equal(name, "../../convex/_generated/api");
      return { api: { blog: { listPublishedSlugs: "slugs" } } };
    },
  });
  return { runtime: runtimeModule.exports, restore() { unavailable = false; }, fail() { unavailable = true; },
    revoke() { articles = []; }, queryCount: () => queries };
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
  }
});
