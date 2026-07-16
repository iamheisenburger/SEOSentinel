import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePublicationQuality,
  normalizeSiteOrigin,
} from "../convex/lib/articleQuality.ts";

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
