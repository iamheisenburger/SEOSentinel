import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMetaDescription,
  evaluatePublicationQuality,
  normalizeSiteOrigin,
} from "../convex/lib/articleQuality.ts";
import {
  injectInternalLinks,
  validateInternalLinkSuggestions,
} from "../convex/lib/internalLinks.ts";

const body = Array.from(
  { length: 950 },
  (_, index) => `useful${index}`,
).join(" ");

test("normalizes bare and fully-qualified site domains", () => {
  assert.equal(normalizeSiteOrigin("leadpilot.chat/"), "https://leadpilot.chat");
  assert.equal(
    normalizeSiteOrigin("https://leadpilot.chat/"),
    "https://leadpilot.chat",
  );
});

test("clamps meta descriptions cleanly without cutting through a word", () => {
  const description = clampMetaDescription(
    "Learn how to deploy a lead qualification chatbot, score buyer fit in real time, and hand warm leads to sales with a practical step-by-step workflow that keeps going.",
    120,
  );

  assert.ok(description);
  assert.ok(description.length <= 120);
  assert.match(description, /\.$/);
  assert.doesNotMatch(description, /\s\.$/);
});

test("accepts a grounded strict article", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A practical website lead qualification workflow",
      metaDescription:
        "A practical workflow for answering buyer questions and routing useful sales context.",
      markdown: `${body}\n\nThe workflow reduced review time by 12% in the documented test [1].`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 91,
      sources: [
        { url: "https://example.com/research", title: "Research" },
        { url: "https://docs.example.org/method", title: "Method" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("rejects unsupported marketing outcomes in strict metadata and body", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A website agent that boosts conversions by 400%",
      metaDescription: "Proven software that increases revenue by 25%.",
      markdown: `${body}\n\nCustomers increase conversion by 40% after setup.`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 95,
      sources: [{ url: "https://example.com/research" }],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("quantified outcome")));
  assert.ok(result.issues.some((issue) => issue.includes("promotional language")));
  assert.ok(result.issues.some((issue) => issue.includes("inline citation")));
});

test("rejects malformed URLs and executable scripts", () => {
  const result = evaluatePublicationQuality({
    title: "Safe article",
    metaDescription: "A safe description.",
    markdown: `${body}\n<script>alert(1)</script>\nhttps://https://example.com\n<iframe src="https://attacker.example/embed"></iframe>`,
    sources: [{ url: "http://localhost/source" }],
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("script tag")));
  assert.ok(result.issues.some((issue) => issue.includes("duplicated URL")));
  assert.ok(result.issues.some((issue) => issue.includes("source URL")));
  assert.ok(result.issues.some((issue) => issue.includes("unsupported iframe")));
});

test("validates contextual internal-link suggestions against crawled pages", () => {
  const links = validateInternalLinkSuggestions(
    [
      { anchor: "Blog", href: "/blog" },
      { anchor: "lead qualification workflow", href: "/#features" },
      { anchor: "LeadPilot pricing options", href: "/#pricing" },
      { anchor: "external destination", href: "https://example.com" },
      { anchor: "current article guide", href: "/current-article" },
    ],
    ["/blog", "/#features", "/#pricing", "/current-article"],
    "/current-article",
  );

  assert.deepEqual(links, [
    { anchor: "lead qualification workflow", href: "/#features" },
    { anchor: "LeadPilot pricing options", href: "/#pricing" },
  ]);
});

test("injects links only into eligible article prose", () => {
  const markdown = [
    "# Lead qualification workflow",
    "",
    "## Table of Contents",
    "",
    "- [Lead qualification workflow](#workflow)",
    "",
    "## Workflow",
    "",
    "A lead qualification workflow helps sales teams route serious buyers.",
    "",
    "An [existing qualification guide](https://example.com/guide) stays intact.",
    "",
    "`lead qualification workflow` remains code.",
    "",
    "## Sources",
    "",
    "[1] Blog source — https://blog.happyfox.com/lead-qualification-workflow/",
  ].join("\n");

  const result = injectInternalLinks(markdown, [
    { anchor: "lead qualification workflow", href: "/#features" },
    { anchor: "Blog source", href: "/blog" },
  ]);

  assert.equal(result.inserted.length, 1);
  assert.match(
    result.markdown,
    /A \[lead qualification workflow\]\(\/#features\) helps sales teams/,
  );
  assert.match(result.markdown, /https:\/\/blog\.happyfox\.com\/lead-qualification-workflow\//);
  assert.doesNotMatch(result.markdown, /https:\/\/\[Blog\]/);
  assert.match(result.markdown, /`lead qualification workflow` remains code/);
});

test("publication quality blocks markdown inserted inside an external URL", () => {
  const result = evaluatePublicationQuality({
    title: "Safe article",
    metaDescription: "A safe description.",
    markdown: `${body}\n\nhttps://[Blog](/blog).example.com/source`,
    sources: [{ url: "https://example.com/source" }],
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("inside an external URL")));
});
