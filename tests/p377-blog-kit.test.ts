// P377 (Nov 6 2026): Arshad: "imagine a new customer signs up and has no blog and pentra refuses to post". A Next.js site
// with no Markdown posts was a dead end ("No Markdown blog posts were found"). Pentra now offers to add a blog to the site
// (convex/lib/blogKit.ts, blog-kit/): one commit of new files, no packages, shown in the site's own layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BLOG_KIT_SOURCES } from "../convex/lib/blogKitSources.ts";
import { blogKitConfigPaths, blogKitFiles, blogKitSitemapPath, installedBlogKit, planBlogKit } from "../convex/lib/blogKit.ts";
import { currentGithubBlog, githubBlogNote } from "../convex/lib/githubBlogState.ts";

const createNextApp = ["package.json", "next.config.ts", "tsconfig.json", "src/app/layout.tsx", "src/app/page.tsx", "src/app/globals.css", "public/next.svg"];
const pkg = (next = "16.0.0") => JSON.stringify({ dependencies: { next, react: "19.0.0" } });
const plan = (paths: string[], files: Record<string, string> = { "package.json": pkg() }) => planBlogKit(paths, files);

test("the packed sources are exactly the files in blog-kit/ (run node scripts/blog-kit-sources.mjs after editing them)", () => {
  const dir = path.join(import.meta.dirname, "..", "blog-kit");
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(".js")).sort();
  assert.deepEqual(Object.keys(BLOG_KIT_SOURCES).sort(), names);
  for (const name of names) assert.equal(BLOG_KIT_SOURCES[name], fs.readFileSync(path.join(dir, name), "utf8"), name);
});

test("a fresh Next.js site with no blog gets one at /blog in its own layout", () => {
  const result = plan(createNextApp);
  assert.ok(result.ok);
  assert.deepEqual(result.plan, { router: "app", root: "", routeParent: "src/app", segments: ["blog", "articles", "resources", "guides", "insights"] });
  const files = blogKitFiles(result.plan, "blog", { name: "Dawnlist", origin: "https://dawnlist.io/", language: "en" });
  assert.deepEqual(files.map((f) => f.path), ["src/app/blog/page.js", "src/app/blog/[slug]/page.js", "src/app/blog/sitemap.js",
    "src/app/blog/_pentra/site.js", "src/app/blog/_pentra/posts.js", "src/app/blog/_pentra/markdown.js"]);
  assert.ok(files.every((f) => !createNextApp.includes(f.path)), "only new files");
  const site = files.find((f) => f.path.endsWith("site.js"))!.content;
  assert.match(site, /"name": "Dawnlist"/);
  assert.match(site, /"origin": "https:\/\/dawnlist.io"/);
  assert.match(site, /"path": "\/blog"/);
  assert.match(files.find((f) => f.path.endsWith("posts.js"))!.content, /path\.join\(process\.cwd\(\), "content", "blog"\); \/\/ pentra:folder/);
  assert.equal(blogKitSitemapPath("app", "blog"), "/blog/sitemap.xml");
});

test("the blog never takes an address the site already uses", () => {
  const taken = (extra: string[], files: Record<string, string> = { "package.json": pkg() }) => {
    const r = planBlogKit([...createNextApp, ...extra], files);
    return r.ok ? r.plan.segments[0] : r.reason;
  };
  assert.equal(taken(["src/app/blog/page.tsx"]), "articles");
  assert.equal(taken(["src/app/(marketing)/blog/page.tsx"]), "articles", "a route group doesn't change the address");
  assert.equal(taken(["public/blog/index.html"]), "articles");
  assert.equal(taken(["content/blog/someone-elses-post.md"]), "articles", "someone else's Markdown where Pentra publishes");
  assert.equal(taken([], { "package.json": pkg(), "next.config.ts": `export default { async rewrites() { return [{ source: "/blog/:path*", destination: "https://blog.example.com/:path*" }]; } };` }),
    "articles", "a rewrite to a blog hosted elsewhere");
  assert.equal(taken(["src/app/blog/page.tsx", "src/app/articles/page.tsx", "src/app/resources/page.tsx", "src/app/guides/page.tsx", "src/app/insights/page.tsx"]), "path_taken");
  assert.deepEqual(blogKitConfigPaths([...createNextApp, "vercel.json", "src/proxy.ts"]), ["package.json", "next.config.ts", "vercel.json"]);
});

test("route groups, the Pages Router, monorepos and sites without next.config are handled", () => {
  const groups = plan(["package.json", "next.config.js", "app/(marketing)/layout.tsx", "app/(marketing)/page.tsx", "app/(app)/layout.tsx", "app/(app)/dashboard/page.tsx"]);
  assert.ok(groups.ok);
  assert.equal(groups.plan.routeParent, "app/(marketing)", "the group with the home page");

  const pages = plan(["package.json", "next.config.js", "pages/_app.js", "pages/index.js"]);
  assert.ok(pages.ok);
  const pageFiles = blogKitFiles(pages.plan, "blog", { name: "Site", origin: "https://site.example" });
  assert.deepEqual(pageFiles.map((f) => f.path), ["pages/blog/index.js", "pages/blog/[slug].js", "pentra-blog/site.js", "pentra-blog/posts.js", "pentra-blog/markdown.js"]);
  assert.match(pageFiles[0].content, /from "\.\.\/\.\.\/pentra-blog\/site\.js"/);
  assert.equal(blogKitSitemapPath("pages", "blog"), null);
  const srcPages = plan(["package.json", "next.config.js", "src/pages/_app.tsx", "src/pages/index.tsx"]);
  assert.ok(srcPages.ok);
  assert.ok(blogKitFiles(srcPages.plan, "blog", { name: "S", origin: "https://s.example" }).some((f) => f.path === "src/pentra-blog/posts.js"));

  const mono = planBlogKit(["package.json", "turbo.json", "apps/web/package.json", "apps/web/next.config.mjs", "apps/web/app/layout.tsx", "apps/web/app/page.tsx"],
    { "apps/web/package.json": pkg("^14.2.3") });
  assert.ok(mono.ok);
  assert.equal(mono.plan.root, "apps/web");
  const monoFiles = blogKitFiles(mono.plan, "blog", { name: "M", origin: "https://m.example" });
  assert.equal(monoFiles[0].path, "apps/web/app/blog/page.js");
  assert.match(monoFiles.find((f) => f.path.endsWith("posts.js"))!.content, /path\.join\(process\.cwd\(\), "\.\.", "\.\.", "content", "blog"\)/,
    "Pentra publishes to content/blog at the repository's root");

  const noConfig = plan(["package.json", "app/layout.js", "app/page.js"], { "package.json": pkg("latest") });
  assert.ok(noConfig.ok, "a Next.js site without next.config is still Next.js");
});

test("sites Pentra can't add a blog to say why", () => {
  assert.equal((planBlogKit(["package.json", "astro.config.mjs", "src/pages/index.astro"], {}) as { reason: string }).reason, "not_nextjs");
  assert.equal((plan(createNextApp, { "package.json": pkg("12.3.4") }) as { reason: string }).reason, "next_too_old");
  assert.equal((plan(["package.json", "next.config.js", "app/[locale]/layout.tsx", "app/[locale]/page.tsx"]) as { reason: string }).reason, "no_layout");
  assert.equal((plan(["package.json", "next.config.js", "pages/index.js", "pentra-blog/notes.md"]) as { reason: string }).reason, "path_taken");
});

test("Pentra recognises its blog in a repository (a reconnection, or a commit whose answer was lost)", () => {
  assert.deepEqual(installedBlogKit([...createNextApp, "src/app/articles/[slug]/page.js", "src/app/articles/_pentra/posts.js"]), { router: "app", segment: "articles" });
  assert.deepEqual(installedBlogKit(["pages/blog/[slug].js", "pages/blog/index.js", "pentra-blog/posts.js"]), { router: "pages", segment: "blog" });
  assert.equal(installedBlogKit(createNextApp), null);
  assert.equal(installedBlogKit(["src/app/x/_pentra/posts.js"]), null, "only with its article page");
});

async function kitModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pentra-blog-kit-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const result = plan(createNextApp);
  assert.ok(result.ok);
  for (const file of blogKitFiles(result.plan, "blog", { name: "Test", origin: "https://test.example" }).filter((f) => f.path.includes("/_pentra/"))) {
    fs.writeFileSync(path.join(dir, path.basename(file.path)), file.content);
  }
  const markdown = await import(path.join(dir, "markdown.js")) as { renderMarkdown: (md: string, origin?: string) => string };
  const posts = await import(path.join(dir, "posts.js")) as { parsePost: (slug: string, file: string, withHtml?: boolean) => Record<string, unknown> | null };
  return { markdown, posts };
}

test("articles render as safe HTML: headings, lists, tables, links, code, embeds", async () => {
  const { renderMarkdown } = (await kitModules()).markdown;
  const html = renderMarkdown([
    "## What it costs", "", "Plain **bold**, *italic*, `a < b` and a [link](https://example.com \"Example\") or [ours](/blog/other).", "",
    "## What it costs", "", "1. **Timeline**: when?", "  - \"Selling in three months\" is actionable.", "2. Budget", "", "- [ ] Task to do", "- [x] Done", "",
    "3. Third step starts at three", "", "| Plan | Price |", "|:-----|------:|", "| Pro | $99 |", "", "> A quote", "",
    "```js", "const x = '<b>';", "```", "", "Write to sales@example.com or see https://example.org/path_with_underscores.", "",
    "<div class=\"video\"><iframe src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\"></iframe></div>", "", "Text with snake_case_words stays.",
  ].join("\n"), "https://test.example");
  assert.match(html, /<h2 id="what-it-costs">What it costs<\/h2>[\s\S]*<h2 id="what-it-costs-1">/);
  assert.match(html, /<strong>bold<\/strong>, <em>italic<\/em>, <code>a &lt; b<\/code>/);
  assert.match(html, /<a href="https:\/\/example.com" title="Example" target="_blank" rel="noopener noreferrer">link<\/a>/);
  assert.match(html, /<a href="\/blog\/other">ours<\/a>/);
  assert.match(html, /<ol>\n<li><strong>Timeline<\/strong>: when\?\n<ul>\n<li>&quot;Selling in three months&quot; is actionable.<\/li>\n<\/ul><\/li>\n<li>Budget<\/li>\n<\/ol>/,
    "a list indented under a numbered step stays nested");
  assert.match(html, /<li class="pentra-task"><input type="checkbox" disabled> Task to do<\/li>/);
  assert.match(html, /<input type="checkbox" disabled checked> Done/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<th style="text-align:left">Plan<\/th><th style="text-align:right">Price<\/th>/);
  assert.match(html, /<blockquote>\n<p>A quote<\/p>\n<\/blockquote>/);
  assert.match(html, /<pre><code class="language-js">const x = '&lt;b&gt;';<\/code><\/pre>/);
  assert.match(html, /<a href="mailto:sales@example.com">sales@example.com<\/a>/);
  assert.match(html, /<a href="https:\/\/example.org\/path_with_underscores"[^>]*>https:\/\/example.org\/path_with_underscores<\/a>\./);
  assert.match(html, /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /snake_case_words/);
});

test("nothing in an article can run script or point a link at script", async () => {
  const { renderMarkdown } = (await kitModules()).markdown;
  const html = renderMarkdown([
    "[click](javascript:alert(1)) and ![img](javascript:alert(2)) and <a href=\"javascript:x\">raw</a>", "",
    "<script>alert(3)</script>", "", "<img src=\"https://ok.example/a.png\" onerror=\"alert(4)\">", "",
    "<iframe src=\"https://evil.example/\"></iframe>", "", "Inline <span onclick=\"alert(5)\">text</span> and \"quotes\".",
  ].join("\n"));
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror|onclick/i);
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /<img src="https:\/\/ok.example\/a.png" alt="" loading="lazy" decoding="async">/);
  assert.match(html, /<p>click and img and raw<\/p>/, "unsafe links keep their words only");
  assert.match(html, /<p>Inline text and &quot;quotes&quot;.<\/p>/, "unknown tags are dropped, their text kept");
});

test("the blog shows only what Pentra published, in Pentra's frontmatter", async () => {
  const { parsePost } = (await kitModules()).posts;
  const file = [
    "---", 'title: "How to Find Clients: a Guide"', 'metaTitle: "Find Clients Fast"', 'description: "Where to look, and how to prove the need."',
    'generator: "pentra"', 'pentraDeliveryKey: "pentra:' + "a".repeat(64) + '"', 'status: "published"', "qualityGateVersion: 5",
    'canonicalUrl: "https://test.example/blog/find-clients"', 'featuredImage: "https://wary-starfish-773.convex.cloud/api/storage/abc"',
    "readingTime: 7", 'date: "2026-11-06T10:00:00.000Z"', "sources:", '  - url: "https://pagespeed.web.dev/"', '    title: "PageSpeed Insights"',
    "internalLinks:", '  - anchor: "Other"', '    href: "/blog/other"', "---", "", "Intro.", "", "## Related reading", "", "- [Other](/blog/other)", "",
  ].join("\n");
  const post = parsePost("find-clients", file)!;
  assert.equal(post.title, "How to Find Clients: a Guide");
  assert.equal(post.metaTitle, "Find Clients Fast");
  assert.equal(post.canonicalUrl, "https://test.example/blog/find-clients");
  assert.equal(post.image, "https://wary-starfish-773.convex.cloud/api/storage/abc");
  assert.equal(post.readingTime, 7);
  assert.deepEqual(post.sources, [{ url: "https://pagespeed.web.dev/", title: "PageSpeed Insights" }]);
  assert.equal(post.hasRelated, true, "its own related-reading section: the page adds no second one");
  assert.equal(post.hasSources, false);
  assert.equal(parsePost("find-clients", file.replace('status: "published"', 'status: "draft"')), null);
  assert.equal(parsePost("find-clients", file.replace('generator: "pentra"', 'generator: "hugo"')), null);
  assert.equal(parsePost("../secrets", file), null);
  assert.equal(parsePost("find-clients", file, false)!.html, undefined, "lists don't render every article");
});

test("the dashboard shows the blog Pentra added for the current repository only", () => {
  const site = { publishMethod: "github", repoOwner: "acme", repoName: "web" };
  const kit = { repo: "acme/web", state: "deploying" as const, requestedAt: 1, segment: "blog", commitSha: "0123456789abcdef" };
  assert.deepEqual(currentGithubBlog({ ...site, githubBlogKit: kit }).kit, { state: "deploying", segment: "blog", commit: "0123456", detail: null });
  assert.equal(currentGithubBlog({ ...site, githubBlogKit: { ...kit, repo: "acme/old" } }).kit, undefined);
  assert.deepEqual(githubBlogNote({ ...site, githubBlogKit: kit }, false), { state: "kit", kit: { state: "deploying", segment: "blog", commit: "0123456", detail: null } });
  const offer = { reason: "no_blog", detail: "Your site doesn't have a blog yet. Pentra can add one at web.example/blog.", at: 1, repo: "acme/web" };
  assert.deepEqual(githubBlogNote({ ...site, githubLayoutFailure: offer }, false), { state: "failed", reason: "no_blog", detail: offer.detail });
});
