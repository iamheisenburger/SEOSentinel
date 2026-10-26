import assert from "node:assert/strict";
import test from "node:test";
import { detectSitePlatform, extractBusinessPrefill, normalizePrefillHost } from "../convex/lib/sitePrefill.ts";

const home = `<!doctype html><html><head><title>Emergency Plumbers in Leeds | Acme Plumbing</title>
<meta name="description" content="Acme Plumbing fixes leaks, boilers and blocked drains across Leeds with same-day visits and fixed prices.">
<meta property="og:site_name" content="Acme Plumbing"></head><body>
<h1>Same-day plumbing for homeowners in Leeds</h1>
<h2>Leak repair</h2><h2>Boiler servicing</h2><h2>Blocked drains</h2>
<h3>How fast can you get here?</h3><details><summary>Do you charge a call-out fee?</summary></details>
<h3>How fast can you get here?</h3><script>var x = "Is this a question?";</script>
<a href="https://evil.example/book">Book a visit</a><a href="/book-a-visit">Book a visit →</a></body></html>`;

test("a homepage becomes suggested setup facts", () => {
  const found = extractBusinessPrefill(home);
  assert.equal(found.name, "Acme Plumbing");
  assert.match(found.summary, /^Acme Plumbing fixes leaks/);
  assert.equal(found.product, "Same-day plumbing for homeowners in Leeds. Includes: Leak repair; Boiler servicing; Blocked drains.");
  assert.equal(found.audience, "Homeowners");
  assert.deepEqual(found.questions, ["How fast can you get here?", "Do you charge a call-out fee?"]);
  assert.equal(found.ctaUrl, "", "no host, no link");
  const withHost = extractBusinessPrefill(home, "www.acme.example");
  assert.equal(withHost.ctaUrl, "https://www.acme.example/book-a-visit", "only the site's own link");
  assert.equal(withHost.ctaText, "Book a visit");
});

test("missing tags produce empty suggestions, never invented ones", () => {
  const found = extractBusinessPrefill("<html><body><div>Hi</div></body></html>");
  assert.deepEqual(found, { name: "", summary: "", product: "", audience: "", questions: [], ctaText: "", ctaUrl: "" });
});

test("only public website hostnames are fetched", () => {
  assert.equal(normalizePrefillHost(" https://Www.Acme.co.uk/about?x=1 "), "www.acme.co.uk");
  assert.equal(normalizePrefillHost("acme.com:8443"), "acme.com");
  for (const bad of ["localhost", "127.0.0.1", "10.0.0.5", "intranet", "acme.local", "a.internal", "", "http://"]) assert.equal(normalizePrefillHost(bad), null, bad);
});

test("slogans and page sections are not mistaken for an audience or services", () => {
  const pentraLike = `<title>Pentra — Autopilot SEO for your website</title><meta name="description" content="Add your website and Pentra takes it from there.">
<h1>More customers from Google. On autopilot.</h1><h2>How it works</h2><h2>What you get</h2><h2>Simple, transparent pricing</h2><h2>Questions</h2><h2>Weekly site health</h2>
<p>Buyer&#x27;s guide &#39;quoted&#39;</p>`;
  const found = extractBusinessPrefill(pentraLike);
  assert.equal(found.audience, "");
  assert.equal(found.product, "More customers from Google. On autopilot. Includes: Weekly site health.");
  assert.equal(extractBusinessPrefill("<title>Plumbing for landlords | Acme</title>").audience, "Landlords");
});

// P213 (Oct 26 2026): setup preselected GitHub, and the first real signups' sites all became GitHub sites (one owner
// connected GitHub and stopped at the repository picker). Setup now suggests the destination from the homepage.
test("P213 the homepage tells setup where a website runs", () => {
  const page = (body: string) => `<!doctype html><html><head><title>Acme</title>${body}</head><body><h1>Acme</h1></body></html>`;
  const method = (html: string) => detectSitePlatform(html)?.method ?? null;
  assert.equal(method(page('<link rel="stylesheet" href="https://acme.example/wp-content/themes/acme/style.css">')), "wordpress");
  assert.equal(method(page('<meta name="generator" content="WordPress 6.6.2">')), "wordpress");
  assert.equal(method(page('<script src="https://acme.example/wp-includes/js/jquery.js"></script><script src="https://cdn.shopify.com/buy-button/v2.js"></script>')),
    "wordpress", "a WordPress site with a Shopify buy button runs on WordPress");
  assert.equal(method(page('<script src="//cdn.shopify.com/s/files/1/0001/theme.js"></script>')), "shopify");
  assert.equal(method('<html data-wf-site="64a1" data-wf-page="64a2"><head></head></html>'), "webflow");
  assert.equal(method(page('<meta name="generator" content="Ghost 5.80">')), "ghost");
  assert.deepEqual(detectSitePlatform(page('<img src="https://static.wixstatic.com/media/a.jpg">')), { method: "manual", name: "Wix" });
  assert.deepEqual(detectSitePlatform(page('<link href="https://static1.squarespace.com/static/site.css" rel="stylesheet">')), { method: "manual", name: "Squarespace" });
  assert.deepEqual(detectSitePlatform(page('<script id="__NEXT_DATA__" type="application/json">{}</script><script src="//js.hs-scripts.com/123.js"></script>')),
    { method: "github", name: "Next.js" }, "HubSpot's tracking script doesn't make a site a HubSpot site");
  assert.equal(method(page('<meta name="generator" content="Astro v4.5.0">')), "github");
  assert.equal(detectSitePlatform(page('<link rel="stylesheet" href="/styles.css">')), null, "nothing named: the owner chooses");
});
