import assert from "node:assert/strict";
import test from "node:test";
import { extractBusinessPrefill, normalizePrefillHost } from "../convex/lib/sitePrefill.ts";

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
