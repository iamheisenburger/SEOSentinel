// P242 (Oct 30 2026): before a cold email to 60 founders of Next.js/Astro/Hugo/Jekyll sites, Pentra's own screens said
// GitHub publishing "Works with Next.js, Astro, Hugo, Jekyll, Gatsby, and any SSG". It doesn't: every article is committed
// to content/blog/<slug>.md, which a stock Astro blog (src/content/blog, pubDate) or Jekyll (_posts) never shows. Until
// those layouts ship and pass live tests (ops/GITHUB-LAYOUTS-PLAN.md), no screen claims them.
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

test("P242 no screen claims GitHub publishing for site layouts Pentra has not verified", () => {
  const unverified = /any SSG|Next\.js, Astro|Astro, Hugo|Hugo, Jekyll|Jekyll, Gatsby|Markdown or MDX (?:files|sites)/;
  const offenders = files("src").filter((path) => unverified.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, [], "these files still claim unverified GitHub layouts");
});

test("P242 the setup screen says where Pentra writes and offers paste for other layouts", () => {
  const setup = readFileSync("src/components/onboarding/content-start.tsx", "utf8");
  assert.match(setup, /<option value="github">GitHub · a blog that shows Markdown files from content\/blog<\/option>/);
  assert.match(setup, /Pentra commits each article to <code>content\/blog\/&lt;slug&gt;\.md<\/code>/);
  assert.match(setup, /Astro, Jekyll, Hugo and other blog layouts are being added: until then, choose “Another platform”/);
  const instructions = readFileSync("src/components/onboarding/platform-instructions.tsx", "utf8");
  assert.match(instructions, /Pentra commits each article to content\/blog\/\[slug\]\.md in your repository/);
});
