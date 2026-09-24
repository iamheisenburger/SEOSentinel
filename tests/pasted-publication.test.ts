import assert from "node:assert/strict";
import test from "node:test";
import { articleParagraphs, matchPastedArticle, pastedUrlForSite } from "../convex/lib/pastedPublication.ts";

const markdown = `# How to fix a leaking tap

A leaking tap usually means a worn washer or cartridge, and most homeowners can replace either in under an hour with basic tools.

- Turn off the water
- Remove the handle

## Find the valve

Before you start, shut off the isolation valve under the sink, open the tap to drain the pipe, and put a towel in the basin to catch small parts.

Once the handle is off, unscrew the headgear nut and lift out the old washer; take it to a hardware shop so you can match the exact size and type.`;
const article = { title: "How to Fix a Leaking Tap (Step by Step)", markdown };

test("article paragraphs skip headings, lists and short lines", () => {
  assert.equal(articleParagraphs(markdown).length, 3);
});

test("a page with the title and most paragraphs is live, even with light edits and markup", () => {
  const html = `<html><head><title>How to Fix a Leaking Tap (Step by Step) – Acme</title></head><body><article>
<h1>How to Fix a Leaking Tap (Step by Step)</h1><p>A leaking tap usually means a worn washer or cartridge, and most homeowners can replace either in under an hour with basic tools.</p>
<p>Before you start, shut off the isolation valve under the sink, open the tap to drain the pipe, and put a <strong>towel</strong> in the basin to catch small parts!</p>
<p>Once the handle is off, remove the headgear nut and lift out the old washer. Take it with you to the shop.</p></article></body></html>`;
  const result = matchPastedArticle(html, article);
  assert.equal(result.titleFound, true); assert.equal(result.total, 3); assert.ok(result.matched >= 2); assert.equal(result.live, true);
});

test("a different page, or only the title, is not live", () => {
  assert.equal(matchPastedArticle("<h1>How to Fix a Leaking Tap (Step by Step)</h1><p>Coming soon.</p>", article).live, false);
  assert.equal(matchPastedArticle("<p>A leaking tap usually means a worn washer or cartridge, and most homeowners can replace either in under an hour with basic tools.</p>", article).live, false);
  assert.equal(matchPastedArticle("", article).live, false);
});

test("only public https addresses on the owner's own site are accepted", () => {
  assert.equal(pastedUrlForSite("https://acme.example/blog/tap#x", "acme.example"), "https://acme.example/blog/tap");
  assert.equal(pastedUrlForSite("https://www.acme.example/blog/tap", "www.acme.example"), "https://www.acme.example/blog/tap");
  assert.equal(pastedUrlForSite("https://shop.acme.example/blogs/news/tap", "acme.example"), "https://shop.acme.example/blogs/news/tap");
  for (const bad of ["http://acme.example/x", "https://acme.example.evil.com/x", "https://evilacme.example/x", "https://user:pw@acme.example/x",
    "https://acme.example:8443/x", "javascript:alert(1)", "not a url"]) assert.equal(pastedUrlForSite(bad, "acme.example"), null, bad);
});
