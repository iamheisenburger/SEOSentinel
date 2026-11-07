// P379 (Nov 7 2026), watchdog: LeadPilot's Nov 7 article was held twice for "a numbered list jumps from 4 to 6". The
// list was its Sources: since P335 the Sources tail lists only the sources the body cites, each under its original
// number, so a body citing [1]-[4] and [6] got "4." then "6.". Markdown numbers a list from its first item, so readers
// saw source 6 as "5" beside a body citing [6], and the reader check rightly held every such article. Now the list
// restarts after a gap with the other delimiter ("6)"): a new list that starts at 6, in every Markdown renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { rebuildSourcesSection } from "../convex/lib/backedFacts.ts";
import { CONTENT_CHECKS_VERSION, readerVisibleIssues, renumberOrderedLists } from "../convex/lib/articleQuality.ts";

const sources = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ url: `https://s${n}.example/page`, title: `Source ${n}` }));
const body = "Chatbots route leads [1]. Scores need criteria [2]. Pricing varies [3][4]. One vendor publishes its plans [6]. Another [8].";
const article = rebuildSourcesSection(`${body}\n\n## Sources\n\n1. old`, sources);

test("each cited source keeps its number, and the list restarts after every gap", () => {
  assert.match(article, /## Sources\n\n1\. \[Source 1\]\(https:\/\/s1\.example\/page\)\n2\. \[Source 2\][^\n]*\n3\. \[Source 3\][^\n]*\n4\. \[Source 4\][^\n]*\n6\) \[Source 6\][^\n]*\n8\. \[Source 8\][^\n]*\n$/);
  assert.match(article, /\[6\]\. Another \[8\]\./, "the body's citations never shift");
});

test("the reader check reads the restarted lists as Markdown does: no jump", () => {
  assert.deepEqual(readerVisibleIssues({ markdown: article, sources }).filter((issue) => /jumps/.test(issue)), []);
  assert.equal(renumberOrderedLists(article), article, "nothing to renumber: each list counts up by one");
});

test("a list in the article that really skips a number is still caught, and still repaired", () => {
  const skipped = "Steps:\n\n1. Pick\n2. Map\n4. Route\n\nDone.";
  assert.ok(readerVisibleIssues({ markdown: skipped, sources: [] }).includes("Reader-visible defect: a numbered list jumps from 2 to 4."));
  assert.equal(renumberOrderedLists(skipped), "Steps:\n\n1. Pick\n2. Map\n3. Route\n\nDone.");
  const mixed = "1. a\n2. b\n4) c\n5) d";
  assert.equal(renumberOrderedLists(mixed), mixed, "a list after a delimiter change is its own list, never renumbered into the first");
});

test("Markdown renderers show source 6 as 6 (Pentra's own HTML pipeline and the blog Pentra adds to sites)", async () => {
  const require = createRequire(path.join(import.meta.dirname, "..", "package.json"));
  const { unified } = await import(require.resolve("unified"));
  const remarkParse = (await import(require.resolve("remark-parse"))).default;
  const remarkGfm = (await import(require.resolve("remark-gfm"))).default;
  const remarkRehype = (await import(require.resolve("remark-rehype"))).default;
  const rehypeStringify = (await import(require.resolve("rehype-stringify"))).default;
  const html = String(unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify).processSync(article));
  assert.match(html, /<ol start="6">\s*<li><a href="https:\/\/s6\.example\/page">Source 6<\/a><\/li>\s*<\/ol>/);
  assert.match(html, /<ol start="8">/);
  const kit = await import(path.join(import.meta.dirname, "..", "blog-kit", "markdown.js")) as { renderMarkdown: (md: string) => string };
  const kitHtml = kit.renderMarkdown(article);
  assert.match(kitHtml, /<ol start="6">\n<li><a href="https:\/\/s6\.example\/page"[^>]*>Source 6<\/a><\/li>\n<\/ol>/);
});

test("drafts held for the old gapped Sources list are judged again", () => {
  assert.ok(CONTENT_CHECKS_VERSION >= 5);
});
