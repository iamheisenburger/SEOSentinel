// P240 (Oct 29 2026): Convex disabled the deployment (free plan limits) at about 06:00Z and every pentra.dev article and
// the sitemap answered 500, because each is read from Convex on every request. When the Convex read fails, pentra.dev
// serves its committed article files (content/blog, written by Pentra's GitHub publisher) instead.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { listCommittedArticles, parseCommittedArticle, publishedOrCommitted, readCommittedArticle, readerMarkdown } from "../src/lib/committed-articles.ts";

const FILE = `---
title: "Blog Publishing Services: What They Are and How to Choose One"
metaTitle: "Blog Publishing Services: Types and How to Choose"
description: "Blog publishing services explained."
generator: "pentra"
readingTime: 9
wordCount: 1992
factCheckScore: 68
date: "2026-10-28T09:37:28.681Z"
sources:
  - url: "https://ghost.org/help/manual/"
    title: "The Ghost Manual"
internalLinks:
  - anchor: "AI SEO Tools"
    href: "/blog/ai-seo-tools-comparison-guide"
---

# Blog Publishing Services: What They Are and How to Choose One

Blog publishing services put a finished article live.

<div style="padding:0"><iframe src="https://www.youtube.com/embed/x"></iframe></div>

## Types

Hosted platforms, connectors and pipelines.

<script type="application/ld+json">
{"@type": "Article"}
</script>
`;

test("P240 a committed article file reads as the page's article, without the publisher's raw HTML", () => {
  const article = parseCommittedArticle(FILE, "blog-publishing-services-how-to-choose")!;
  assert.equal(article.title, "Blog Publishing Services: What They Are and How to Choose One");
  assert.equal(article.metaTitle, "Blog Publishing Services: Types and How to Choose");
  assert.equal(article.metaDescription, "Blog publishing services explained.");
  assert.deepEqual([article.readingTime, article.wordCount, article.factCheckScore], [9, 1992, 68]);
  assert.equal(article.createdAt, Date.parse("2026-10-28T09:37:28.681Z"));
  assert.deepEqual(article.sources, [{ url: "https://ghost.org/help/manual/", title: "The Ghost Manual" }]);
  assert.deepEqual(article.internalLinks, [{ anchor: "AI SEO Tools", href: "/blog/ai-seo-tools-comparison-guide" }]);
  assert.deepEqual([article.domain, article.urlStructure, article.slug], ["pentra.dev", "/blog/[slug]", "blog-publishing-services-how-to-choose"]);
  assert.equal(article.markdown, "Blog publishing services put a finished article live.\n\n## Types\n\nHosted platforms, connectors and pipelines.");
  assert.equal(parseCommittedArticle("No frontmatter here.", "x"), null);
  assert.equal(readerMarkdown("# Another heading\n\nText.", "Title"), "# Another heading\n\nText.", "only the title's own H1 is dropped");
  const example = "Embed it like this:\n\n```html\n<div class=\"video\">\n\n<iframe src=\"https://www.youtube.com/embed/x\"></iframe>\n</div>\n```\n\nDone.";
  assert.equal(readerMarkdown(example, "Title"), example, "HTML in a fenced code example is the article's text");
});

test("P240 every committed pentra.dev article can be served from its file", async () => {
  const files = readdirSync("content/blog").filter((file) => /\.(md|mdx)$/.test(file));
  assert.ok(files.length > 100, String(files.length));
  for (const file of files) {
    const slug = file.replace(/\.(md|mdx)$/, "");
    const article = await readCommittedArticle("pentra.dev", slug);
    assert.ok(article && article.title && article.markdown.length > 200 && Number.isFinite(article.createdAt), file);
    // HTML inside a fenced code example is the article's own text.
    const prose = article!.markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
    assert.doesNotMatch(prose, /^\s*<(?:script|div|iframe|p)\b/im, `${file} keeps raw HTML a reader would see as text`);
  }
  const listed = await listCommittedArticles();
  assert.equal(listed.length, files.length);
  assert.ok(listed.every((item) => /^[a-z0-9-]+$/.test(item.slug) && item.updatedAt > 0));
});

test("P240 the file is used only when the Convex read fails, only for pentra.dev, and only for a committed slug", async () => {
  const down = () => Promise.reject(new Error("You have exceeded the free plan limits"));
  const slug = readdirSync("content/blog").find((file) => file.endsWith(".md"))!.replace(/\.md$/, "");
  assert.deepEqual(await publishedOrCommitted("pentra.dev", slug, async () => ({ title: "From Convex" })), { title: "From Convex" });
  assert.equal(await publishedOrCommitted("pentra.dev", slug, async () => null), null, "an article Convex says is not published stays a 404");
  const served = await publishedOrCommitted("pentra.dev", slug, down);
  assert.equal((served as { slug: string }).slug, slug);
  await assert.rejects(publishedOrCommitted("leadpilot.chat", slug, down), /free plan limits/, "another domain is never served from these files");
  await assert.rejects(publishedOrCommitted("pentra.dev", "no-such-article-anywhere", down), /free plan limits/);
  await assert.rejects(publishedOrCommitted("pentra.dev", "../package", down), /free plan limits/, "a slug never reaches outside content/blog");
  assert.equal(await readCommittedArticle("pentra.dev", "../../package"), null);
});

test("P240 the article page and the sitemap fall back to the committed files, which ship with their functions", () => {
  const page = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.match(page, /publishedOrCommitted\(domain, slug, \(\) => convexHttp\.query\(api\.blog\.getPublishedBySlug, \{ domain, slug \}\)\)/);
  const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
  assert.match(sitemap, /catch \(error\) \{\s*if \(domain\.replace\(\/\^www\\\.\/, ""\) !== COMMITTED_BLOG_DOMAIN\) throw error;\s*result = \{ urlStructure: "\/blog\/\[slug\]", articles: await listCommittedArticles\(\) \};/);
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /outputFileTracingIncludes: \{\s*"\/blog\/\*": \["\.\/content\/blog\/\*\*\/\*"\],\s*"\/sitemap\.xml": \["\.\/content\/blog\/\*\*\/\*"\],/);
});
