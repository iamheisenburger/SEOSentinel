import assert from "node:assert/strict";
import test from "node:test";

import {
  articleWordCeiling,
  clampMetaDescription,
  clampMetaTitle,
  evaluatePublicationQuality,
  normalizeSiteOrigin,
} from "../convex/lib/articleQuality.ts";
import {
  classifyEvidenceSource,
  normalizeEvidenceUrl,
  strictEvidenceSources,
} from "../convex/lib/sourceQuality.ts";
import {
  injectInternalLinks,
  validateInternalLinkSuggestions,
} from "../convex/lib/internalLinks.ts";
import {
  buildHeroImagePrompt,
  buildSupportingImagePrompt,
  insertImageUnderSection,
  insertYouTubeAfterSection,
} from "../convex/lib/mediaQuality.ts";

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
  assert.doesNotMatch(description, /\b(?:and|or|to|with)\.$/i);
  assert.equal(clampMetaTitle("A useful title that is deliberately far too long to fit inside a clean search result"), "A useful title that is deliberately far too long to fit");
});

test("classifies and normalizes strict evidence sources", () => {
  assert.equal(
    normalizeEvidenceUrl("https://developers.google.com/search/docs?utm_source=test#section"),
    "https://developers.google.com/search/docs",
  );
  assert.equal(
    classifyEvidenceSource("https://developers.google.com/search/docs").strictEligible,
    true,
  );
  assert.equal(
    classifyEvidenceSource("https://vendor.example/blog/chatbot-statistics").strictEligible,
    false,
  );
  const filtered = strictEvidenceSources([
    { url: "https://www.nber.org/papers/w12345", title: "Study" },
    { url: "https://vendor.example/blog/results", title: "Vendor blog" },
  ]);
  assert.equal(filtered.accepted.length, 1);
  assert.equal(filtered.rejected.length, 1);
});

test("uses format-specific people-first word ceilings", () => {
  assert.equal(articleWordCeiling("checklist"), 2400);
  assert.equal(articleWordCeiling("how-to"), 2800);
  assert.equal(articleWordCeiling("ultimate-guide"), 3600);
});

test("accepts a grounded strict article", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A practical website lead qualification workflow",
      metaTitle: "A practical website lead qualification workflow",
      metaDescription:
        "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
      markdown: `${body}\n\nThe workflow reduced review time by 12% in the documented test [1].`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 91,
      editorialQualityScore: 92,
      mediaQualityStatus: "passed",
      sources: [
        { url: "https://www.nber.org/papers/w12345", title: "Research" },
        { url: "https://developers.google.com/search/docs", title: "Method" },
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
      editorialQualityScore: 90,
      mediaQualityStatus: "passed",
      sources: [{ url: "https://example.com/research" }],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("quantified outcome")));
  assert.ok(result.issues.some((issue) => issue.includes("promotional language")));
  assert.ok(result.issues.some((issue) => issue.includes("inline citation")));
});

test("rejects stale metadata years and vendor-only evidence for numerical outcomes", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A practical lead qualification workflow",
      metaTitle: "Lead qualification workflow in 2024",
      metaDescription:
        "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful context to the right next step.",
      markdown: `${body}\n\nThe workflow increased conversion by 12% [1].`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 93,
      editorialQualityScore: 91,
      mediaQualityStatus: "passed",
      sources: [
        { url: "https://vendor.example/blog/customer-results", title: "Vendor results" },
        { url: "https://another-vendor.example/blog/benchmarks", title: "Vendor benchmark" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("unsupported year 2024")));
  assert.ok(result.issues.some((issue) => issue.includes("primary or authoritative")));
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

test("strict publication requires editorial and media review signals", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A grounded article",
      metaDescription: "A useful description for a grounded article.",
      markdown: body,
      factCheckScore: 93,
      sources: [{ url: "https://example.com/source" }],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("editorial review")));
  assert.ok(result.issues.some((issue) => issue.includes("media-quality")));
});

test("strict publication blocks overlong non-guide articles", () => {
  const result = evaluatePublicationQuality(
    {
      title: "An overlong how-to",
      articleType: "how-to",
      metaDescription: "A practical but unnecessarily long how-to article.",
      markdown: Array.from({ length: 3500 }, (_, index) => `word${index}`).join(" "),
      factCheckScore: 93,
      editorialQualityScore: 91,
      mediaQualityStatus: "passed",
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("overlong")));
});

test("publication quality blocks malformed tables and multiple videos", () => {
  const result = evaluatePublicationQuality({
    title: "Broken media article",
    metaDescription: "An article with structurally broken rich content.",
    markdown: `${body}\n\n| Column one | Column two | Value | Extra |\n\n<div><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></div>\n<div><iframe src="https://www.youtube.com/embed/lmnopqrstuv"></iframe></div>`,
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("separator row")));
  assert.ok(result.issues.some((issue) => issue.includes("maximum is one")));
});

test("custom hero style cannot remove hard truthfulness constraints", () => {
  const prompt = buildHeroImagePrompt({
    title: "Lead qualification workflow",
    niche: "sales software",
    brandingPrompt: "Bright orange editorial lighting",
    brandColor: "#F97316",
  });

  assert.match(prompt, /Bright orange editorial lighting/);
  assert.match(prompt, /Do not include text/);
  assert.match(prompt, /Do not invent or imitate a product interface/);
});

test("inserts one verified video after its exact relevant section", () => {
  const markdown = [
    "# Guide",
    "",
    "## Qualification questions",
    "",
    "Ask concise questions.",
    "",
    "## Next steps",
    "",
    "Route the buyer.",
  ].join("\n");
  const result = insertYouTubeAfterSection(markdown, {
    videoId: "abcdefghijk",
    title: "Qualification questions explained",
    sectionHeading: "Qualification questions",
  });

  assert.equal((result.match(/youtube-nocookie\.com\/embed/g) ?? []).length, 1);
  assert.ok(result.indexOf("youtube-nocookie.com/embed") < result.indexOf("## Next steps"));
});

test("grounds a supporting visual in an exact article section", () => {
  const prompt = buildSupportingImagePrompt({
    title: "Lead qualification guide",
    primaryKeyword: "lead qualification framework",
    niche: "sales software",
    sectionHeading: "Separate fit from buying intent",
    visualConcept: "Two distinct paths that converge only for qualified buyers",
  });
  assert.match(prompt, /Separate fit from buying intent/);
  assert.match(prompt, /Two distinct paths/);
  assert.match(prompt, /not an infographic/i);
  assert.match(prompt, /Do not include text/);

  const markdown = [
    "# Guide",
    "",
    "## Separate fit from buying intent",
    "",
    "Fit and intent answer different questions.",
    "",
    "## Next step",
    "",
    "Route qualified buyers.",
  ].join("\n");
  const result = insertImageUnderSection(
    markdown,
    "Separate fit from buying intent",
    "![Qualified buyer paths](https://example.com/image.webp)",
  );
  assert.ok(result.indexOf("image.webp") < result.indexOf("Fit and intent"));
  assert.equal(
    insertImageUnderSection(markdown, "Missing heading", "![x](https://example.com/x)"),
    markdown,
  );
});
