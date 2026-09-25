import assert from "node:assert/strict";
import test from "node:test";

import { stripLeadingDocumentTitle } from "../convex/lib/markdownPublishing.ts";

test("removes a matching leading H1 from a published Markdown body", () => {
  const markdown = `# Chatbot for Lead Generation: Does It Actually Work?\n\nOpening paragraph.\n\n## First section`;

  assert.equal(
    stripLeadingDocumentTitle(
      markdown,
      "Chatbot for Lead Generation: Does It Actually Work?",
    ),
    "Opening paragraph.\n\n## First section",
  );
});

test("preserves a non-matching leading H1", () => {
  const markdown = `# A Different Heading\n\nOpening paragraph.`;

  assert.equal(
    stripLeadingDocumentTitle(markdown, "Canonical Article Title"),
    markdown,
  );
});

test("handles blank lines and simple inline Markdown in a matching title", () => {
  const markdown = `\n\n# **Canonical** Article Title\n\nBody.`;

  assert.equal(
    stripLeadingDocumentTitle(markdown, "Canonical Article Title"),
    "Body.",
  );
});

test("an article body keeps exactly one H1, and it is the title publishing strips", async () => {
  const { normalizeArticleHeadings } = await import("../convex/lib/markdownPublishing.ts");
  const markdown = "# What Is a KW Research Tool?\n\nIntro.\n\n# A second top-level heading\n\n```\n# not a heading\n```\n\n## Kept";
  const normalized = normalizeArticleHeadings(markdown, "What Is a KW Research Tool? A Plain-English Guide");
  assert.equal(normalized, "# What Is a KW Research Tool? A Plain-English Guide\n\nIntro.\n\n## A second top-level heading\n\n```\n# not a heading\n```\n\n## Kept");
  assert.equal(stripLeadingDocumentTitle(normalized, "What Is a KW Research Tool? A Plain-English Guide").startsWith("Intro."), true);
  assert.equal(normalizeArticleHeadings("Intro without a title.\n\n# Section", "T"), "Intro without a title.\n\n## Section");
});
