// P242 (Oct 30 2026): Pentra's screens said GitHub publishing "Works with Next.js, Astro, Hugo, Jekyll, Gatsby, and any
// SSG" when every article went to content/blog. P243/P244: the four layouts proven live (one real Pentra article on stock
// Next.js, Astro, Hugo and Jekyll starters, ops/data/github-layout-live-test.json) may be named; nothing else may.
// P247: Gatsby joined them (a real Pentra article live on the stock gatsby-starter-blog, commit b089afe).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

test("P242 no screen claims GitHub publishing beyond the layouts proven live", () => {
  const unverified = /any SSG|Eleventy|Docusaurus|Hexo|Markdown or MDX (?:files|sites)/;
  const offenders = files("src").filter((path) => unverified.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, [], "these files claim unverified GitHub layouts");
});

test("P244 the setup screen names the proven layouts and offers paste when there is no Markdown blog", () => {
  const setup = readFileSync("src/components/onboarding/content-start.tsx", "utf8");
  assert.match(setup, /<option value="github">GitHub · a Next\.js, Astro, Hugo, Jekyll or Gatsby blog with Markdown posts<\/option>/);
  assert.match(setup, /Pentra reads your repository, finds where your blog keeps its Markdown posts and writes each article the same way/);
  assert.match(setup, /If your site has no Markdown blog yet, Pentra writes each article for you to review and paste\./);
});
