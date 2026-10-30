// P246 (Oct 30 2026): Cowork's launch audit found /blog/saas-seo-without-team (old engine) quoting "Lily Ray, Head of
// SEO, Pentra" (a real SEO professional, never Pentra staff), an invented Brian Dean quote and "$10,000-$30,000
// annually"; and the free check, which Arshad does not trust yet, linked from every page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { retiredArticle, retiredHref, servedDestinations, servedOnItsOwnUrl } from "../convex/lib/pentraConsolidation.ts";

test("P246 a retired pentra.dev article is gone: 404, out of every listing, and no link leads to it", () => {
  assert.equal(retiredArticle("pentra.dev", "saas-seo-without-team"), true);
  assert.equal(retiredArticle("https://www.pentra.dev/", "/saas-seo-without-team/"), true);
  assert.equal(retiredArticle("leadpilot.chat", "saas-seo-without-team"), false, "only pentra.dev's own blog");
  assert.equal(servedOnItsOwnUrl("pentra.dev", "saas-seo-without-team"), false);
  assert.equal(servedOnItsOwnUrl("pentra.dev", "competitive-keyword-research-method"), true);
  assert.equal(retiredHref("pentra.dev", "https://pentra.dev/blog/saas-seo-without-team"), true);
  assert.deepEqual(servedDestinations("pentra.dev", [{ href: "/blog/saas-seo-without-team" }, { href: "/blog/competitive-keyword-research-method" }]),
    [{ href: "/blog/competitive-keyword-research-method" }]);
  const page = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.match(page, /if \(retiredArticle\(domain, slug\)\) notFound\(\);/);
  assert.match(page, /if \(href && retiredHref\(domain, href\)\) return <>\{children\}<\/>;/);
});

test("P246 the free check is out of the navigation and the homepage", () => {
  assert.doesNotMatch(readFileSync("src/components/layout/landing-nav.tsx", "utf8"), /Free SEO check|href: "\/check"/);
  assert.doesNotMatch(readFileSync("src/app/page.tsx", "utf8"), /href="\/check"/);
});
