import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityEvidenceReceipt,
  extractAnchorReceipts,
  hasExactAnchorHref,
  hasExactAuthorityLink,
  hasExactUnlinkedMention,
} from "../convex/lib/linkReceipts.ts";

const SOURCE = "https://publisher.test/resources/page";
const TARGET = "https://tenant.test/blog/guide";

test("only an exact real anchor counts as an authority receipt", () => {
  const html = `<a class="useful" href="${TARGET}/">Guide</a>`;
  assert.equal(hasExactAuthorityLink({ html, sourceUrl: SOURCE, targetUrl: TARGET }), true);
});

test("unlinked mention evidence binds exact prose and rejects a real tenant link", () => {
  const context = "LeadPilot helps teams answer buyer questions before the handoff.";
  assert.equal(
    hasExactUnlinkedMention({
      html: `<article><p>${context}</p></article>`,
      sourceUrl: SOURCE,
      targetUrl: "https://leadpilot.chat",
      context,
    }),
    true,
  );
  assert.equal(
    hasExactUnlinkedMention({
      html: `<p>${context}</p><a href="https://leadpilot.chat/pricing">LeadPilot</a>`,
      sourceUrl: SOURCE,
      targetUrl: "https://leadpilot.chat",
      context,
    }),
    false,
  );
});

test("authority evidence receipt ignores unrelated page chrome", () => {
  const evidence = {
    type: "broken_link",
    sourceUrl: SOURCE,
    targetUrl: TARGET,
    context: "https://old.test/guide",
    anchorText: "Old guide",
  };
  assert.equal(authorityEvidenceReceipt(evidence), authorityEvidenceReceipt(evidence));
  assert.doesNotMatch(authorityEvidenceReceipt(evidence), /csrf|advert/i);
});

test("relative anchors resolve against the exact fetched source URL", () => {
  const receipts = extractAnchorReceipts(
    '<a href="/reference?source=article&amp;medium=link">Reference</a>',
    SOURCE,
  );
  assert.equal(
    receipts[0]?.href,
    "https://publisher.test/reference?source=article&medium=link",
  );
});

test("comments, scripts, data attributes, and non-anchor href text never count", () => {
  const html = [
    `<!-- <a href="${TARGET}">comment</a> -->`,
    `<script>const sample = '<a href="${TARGET}">script</a>';</script>`,
    `<div data-href="${TARGET}">data</div>`,
    `<link href="${TARGET}">`,
  ].join("\n");
  assert.equal(hasExactAuthorityLink({ html, sourceUrl: SOURCE, targetUrl: TARGET }), false);
});

test("broken-link evidence requires the exact anchor href, not matching page text", () => {
  const broken = "https://competitor.test/retired-guide";
  const anchor = "conversion guide";
  const falseEvidence = [
    `<p>${anchor}</p>`,
    `<div data-href="${broken}">${anchor}</div>`,
    `<!-- <a href="${broken}">${anchor}</a> -->`,
    `<a href="https://other.test/page">${anchor}</a>`,
  ].join("\n");
  assert.equal(
    hasExactAnchorHref({
      html: falseEvidence,
      sourceUrl: SOURCE,
      targetUrl: broken,
      expectedAnchorText: anchor,
    }),
    false,
  );
  assert.equal(
    hasExactAnchorHref({
      html: `<a href="${broken}"><strong>Conversion</strong> guide</a>`,
      sourceUrl: SOURCE,
      targetUrl: broken,
      expectedAnchorText: anchor,
    }),
    true,
  );
});

test("provider anchor text must agree when it is available", () => {
  const broken = "https://competitor.test/retired-guide";
  assert.equal(
    hasExactAnchorHref({
      html: `<a href="${broken}">unrelated pricing page</a>`,
      sourceUrl: SOURCE,
      targetUrl: broken,
      expectedAnchorText: "conversion guide",
    }),
    false,
  );
});

test("nofollow, sponsored, and ugc anchors do not prove acquired authority", () => {
  for (const rel of ["nofollow", "sponsored", "ugc", "external nofollow"]) {
    assert.equal(
      hasExactAuthorityLink({
        html: `<a href="${TARGET}" rel="${rel}">Guide</a>`,
        sourceUrl: SOURCE,
        targetUrl: TARGET,
      }),
      false,
    );
  }
});

test("lookalike paths, query strings, and hosts do not count", () => {
  for (const href of [
    `${TARGET}-copy`,
    `${TARGET}?affiliate=true`,
    "https://tenant.test.evil.test/blog/guide",
    "https://other.test/blog/guide",
  ]) {
    assert.equal(
      hasExactAuthorityLink({
        html: `<a href="${href}">Guide</a>`,
        sourceUrl: SOURCE,
        targetUrl: TARGET,
      }),
      false,
    );
  }
});
