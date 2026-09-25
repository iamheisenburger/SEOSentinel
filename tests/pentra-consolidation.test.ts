import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PENTRA_CONSOLIDATED, consolidatedTarget, servedOnItsOwnUrl } from "../src/lib/pentra-consolidation.ts";

test("pentra.dev consolidation: one hop to a served article, never a chain or a loop", () => {
  const entries = Object.entries(PENTRA_CONSOLIDATED);
  assert.ok(entries.length >= 60);
  for (const [from, to] of entries) {
    assert.notEqual(from, to);
    assert.match(from, /^[a-z0-9-]+$/); assert.match(to, /^[a-z0-9-]+$/);
    assert.equal(PENTRA_CONSOLIDATED[to], undefined, `${to} must be served, not redirected again`);
  }
  assert.equal(consolidatedTarget("pentra.dev", "keyword-clustering-explained"), "keyword-clustering-strategy-organize-by-intent");
  assert.equal(consolidatedTarget("www.pentra.dev", "/keyword-clustering-explained/"), "keyword-clustering-strategy-organize-by-intent");
  assert.equal(consolidatedTarget("leadpilot.chat", "keyword-clustering-explained"), null, "customer sites are never affected");
  assert.equal(consolidatedTarget("pentra.dev", "niche-detection-practical-guide"), null);
  assert.equal(consolidatedTarget("pentra.dev", "constructor"), null);
  assert.equal(servedOnItsOwnUrl("pentra.dev", "keyword-clustering-strategy-organize-by-intent"), true);
});

test("consolidated slugs redirect permanently and leave the sitemap, the blog index and the homepage", () => {
  const post = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.equal(post.match(/permanentRedirect\(`\/blog\/\$\{merged\}`\)/g)?.length, 2, "metadata and page both redirect before reading the article");
  for (const file of ["src/app/blog/page.tsx", "src/app/sitemap.ts", "src/app/page.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /servedOnItsOwnUrl\(/, file);
  }
});

test("the IndexNow key file is public and matches its script", () => {
  const script = readFileSync("scripts/indexnow-submit.mjs", "utf8");
  const key = /const KEY = "([a-f0-9]{32})"/.exec(script)?.[1];
  assert.ok(key);
  assert.equal(readFileSync(`public/${key}.txt`, "utf8").trim(), key);
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.ok(new RegExp(/PUBLIC_VERIFICATION_FILE = \/(.+)\/;/.exec(proxy)![1].replace(/\\\//g, "/")).test(`/${key}.txt`));
});

