// P243 (Oct 30 2026): Pentra committed every article to content/blog/<slug>.md with its own frontmatter, which a stock
// Astro blog (src/content/blog, pubDate), Jekyll (_posts/YYYY-MM-DD-*.md) or the Next.js blog starter (_posts, coverImage,
// author) never shows. The site's own layout is detected from its repository and each article mirrors its posts.
// Live proof (ops/data/github-layout-live-test.json): one real Pentra article on four stock starters, all 200.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectGithubLayout, layoutArticleLive, mdxSafeMarkdown, renderLayoutPost } from "../convex/lib/githubLayout.ts";
import { publicationDeliveryConfig } from "../convex/lib/publicationArtifact.ts";

const ASTRO_CONFIG = `import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) => z.object({ title: z.string(), description: z.string(), pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(), heroImage: z.optional(image()) }),
});
export const collections = { blog };`;
const STARTERS = {
  nextjs: { paths: ["next.config.js", "package.json", "_posts/dynamic-routing.md", "_posts/hello-world.md", "_posts/preview.md", "src/app/posts/[slug]/page.tsx"],
    files: { "_posts/hello-world.md": `---\ntitle: "Learn How to Pre-render Pages"\nexcerpt: "Lorem"\ncoverImage: "/assets/blog/hello-world/cover.jpg"\ndate: "2020-03-16T05:35:07.322Z"\nauthor:\n  name: Tim Neutkens\n  picture: "/assets/blog/authors/tim.jpeg"\nogImage:\n  url: "/assets/blog/hello-world/cover.jpg"\n---\n\nBody`,
      "_posts/preview.md": `---\ntitle: "Preview Mode"\nexcerpt: "x"\ncoverImage: "/assets/blog/preview/cover.jpg"\ndate: "2020-03-16T05:35:07.322Z"\nauthor:\n  name: Joe Haddad\n  picture: "/assets/blog/authors/joe.jpeg"\nogImage:\n  url: "/assets/blog/preview/cover.jpg"\n---\n\nBody` } },
  astro: { paths: ["astro.config.mjs", "src/content.config.ts", "src/content/blog/first-post.md", "src/content/blog/second-post.md", "src/pages/blog/[...slug].astro"],
    files: { "src/content.config.ts": ASTRO_CONFIG, "src/content/blog/first-post.md": "---\ntitle: 'First post'\ndescription: 'Lorem ipsum'\npubDate: 'Jul 08 2022'\nheroImage: '../../assets/blog-placeholder-3.jpg'\n---\n\nBody",
      "src/content/blog/second-post.md": "---\ntitle: 'Second post'\ndescription: 'Lorem ipsum'\npubDate: 'Jul 15 2022'\nheroImage: '../../assets/blog-placeholder-4.jpg'\n---\n\nBody" } },
  jekyll: { paths: ["_config.yml", "index.markdown", "_posts/2026-10-01-welcome-to-jekyll.markdown"],
    files: { "_posts/2026-10-01-welcome-to-jekyll.markdown": `---\nlayout: post\ntitle:  "Welcome to Jekyll!"\ndate:   2026-10-01 12:00:00 +0000\ncategories: jekyll update\n---\nBody` } },
  hugo: { paths: ["hugo.toml", "layouts/_default/single.html", "content/posts/my-first-post.md"],
    files: { "content/posts/my-first-post.md": "+++\ntitle = 'My First Post'\ndate = 2026-10-01T07:07:07+01:00\ndraft = false\n+++\n## Introduction" } },
  gatsby: { paths: ["gatsby-config.js", "content/blog/hello-world/index.md", "content/blog/new-beginnings/index.md"],
    files: { "content/blog/hello-world/index.md": `---\ntitle: Hello World\ndate: "2015-05-01T22:12:03.284Z"\ndescription: "Hello World"\n---\nBody`,
      "content/blog/new-beginnings/index.md": `---\ntitle: New Beginnings\ndate: "2015-05-28T22:40:32.169Z"\ndescription: This is a custom description\n---\nBody` } },
};
const ARTICLE = { slug: "competitive-keyword-research-method", title: "Competitive Keyword Research", description: "A method",
  publishedAt: Date.UTC(2026, 9, 30, 9, 37), markdown: "Competitive keyword research is the process...", deliveryKey: "pentra:abc" };

test("P243 each stock starter's own blog layout is detected and an article is written the way its posts are", () => {
  const expected: Record<string, [string, string, RegExp]> = {
    nextjs: ["_posts/competitive-keyword-research-method.md", "/posts/[slug]", /^title: "Competitive Keyword Research"\nexcerpt: "A method"\ncoverImage: "\/assets\/blog\/preview\/cover\.jpg"\ndate: "2026-10-30T09:37:00\.000Z"\nauthor:\n  name: Joe Haddad/m],
    astro: ["src/content/blog/competitive-keyword-research-method.md", "/blog/[slug]/", /^title: "Competitive Keyword Research"\ndescription: "A method"\npubDate: "2026-10-30T09:37:00\.000Z"\nheroImage: '\.\.\/\.\.\/assets\/blog-placeholder-4\.jpg'/m],
    jekyll: ["_posts/2026-10-30-competitive-keyword-research-method.markdown", "/blog/[slug]/", /^layout: post\ntitle: "Competitive Keyword Research"\ndate: "2026-10-30T09:37:00\.000Z"\ncategories: \[\]\npermalink: "\/blog\/competitive-keyword-research-method\/"/m],
    hugo: ["content/posts/competitive-keyword-research-method.md", "/posts/[slug]/", /^title: "Competitive Keyword Research"\ndate: "2026-10-30T09:37:00\.000Z"\ndraft: false/m],
    gatsby: ["content/blog/competitive-keyword-research-method/index.md", "/[slug]/", /^title: "Competitive Keyword Research"\ndate: "2026-10-30T09:37:00\.000Z"\ndescription: "A method"/m],
  };
  for (const [name, snapshot] of Object.entries(STARTERS)) {
    const detection = detectGithubLayout(snapshot);
    assert.ok(detection.ok, `${name}: ${JSON.stringify(detection)}`);
    const file = renderLayoutPost(detection.layout, ARTICLE);
    assert.equal(file.path, expected[name][0], name);
    assert.equal(detection.layout.urlStructure, expected[name][1], name);
    assert.match(file.content, expected[name][2], name);
    assert.match(file.content, /^pentraDeliveryKey: "pentra:abc"\n---\n\nCompetitive keyword research is the process\.\.\.\n$/m, `${name}: keeps Pentra's ownership key and the body`);
  }
});

test("P243 a repository Pentra cannot publish to says why in plain words", () => {
  assert.deepEqual(detectGithubLayout({ paths: ["index.html", "style.css"], files: {} }).ok, false);
  const none = detectGithubLayout({ paths: ["next.config.js", "src/app/page.tsx"], files: {} });
  assert.equal(!none.ok && none.reason, "no_posts");
  // P249: an MDX-only blog is written in MDX (it was "mdx_only" until then).
  const mdx = detectGithubLayout({ paths: ["next.config.js", "posts/a.mdx", "posts/b.mdx"], files: { "posts/a.mdx": "---\ntitle: A\n---\nx" } });
  assert.equal(mdx.ok && mdx.layout.extension, ".mdx");
});

test("P243 a site without a detected layout keeps today's exact delivery config (pentra.dev and LeadPilot)", () => {
  const site = { publishMethod: "github", domain: "leadpilot.chat", urlStructure: "/blog/[slug]", repoOwner: "owner", repoName: "repo", repoDefaultBranch: "main" };
  const plain = publicationDeliveryConfig(site as never);
  assert.equal("githubLayout" in plain, false, "no new key, so the sealed config and its hash are unchanged");
  assert.equal(plain.contentDir, "content/blog");
  const layout = (detectGithubLayout(STARTERS.astro) as { layout: unknown }).layout;
  assert.deepEqual(publicationDeliveryConfig({ ...site, githubLayout: layout } as never).githubLayout, layout);
});

test("P243 the publisher writes in the detected layout, detection follows GitHub verification, and setup offers paste", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /const \{ path: filePath, content: mdx \} = githubArticleFile\(article, site, site, publicationDate, deliveryKey, auditVersion\);/);
  assert.match(publisher, /const \{ path: filePath, content: expectedCurrentContent \} = githubArticleFile\(base, args\.site, sealed,/);
  assert.match(publisher, /await ctx\.scheduler\.runAfter\(0, internal\.githubLayoutDetect\.detectSiteGithubLayout, \{ siteId \}\);/);
  const detect = readFileSync("convex/githubLayoutDetect.ts", "utf8");
  assert.match(detect, /if \(published\.length\) return \{ recorded: false \};/, "a site that has published keeps its layout");
  const setup = readFileSync("src/components/pentra-setup-choice.tsx", "utf8");
  assert.match(setup, /We couldn&apos;t find a Markdown blog in your repository that Pentra can publish to automatically\./);
  assert.match(setup, />Review and paste instead<\/button>/);
  assert.match(setup, /const ready = state\.destination\.verified && state\.entitlement && !noBlog;/);
});

// P244: a stock Next.js blog sets its own <title> and description, so the exact renderer check failed a live article.
test("P244 an article on a site's own blog layout is live when its page shows the article's opening words", () => {
  const markdown = "Competitive keyword research is the process of finding which searches other sites already win, then deciding.\n\n## Next";
  const page = "<html><head><title>Competitive Keyword Research | Next.js Blog Example</title></head><body><article><h1>Competitive Keyword Research</h1>" +
    "<div><p>Competitive keyword research is the process of finding which searches other sites already win, then deciding.</p></div></article></body></html>";
  assert.equal(layoutArticleLive(page, markdown), true);
  assert.equal(layoutArticleLive(page.replace("Competitive keyword research is the process", "Something else entirely is"), markdown), false);
  assert.match(readFileSync("convex/publisher.ts", "utf8"), /if \(site\.serviceMode === "growth_first" && site\.githubLayout\) \{\n        if \(!layoutArticleLive\(fetched\.text, article\.markdown\)\)/);
});

// P248 (Oct 30 2026): a Next.js blog whose posts come from Sanity (or another headless CMS) has no posts in the repository;
// a commit there would never show, so setup names the CMS and offers review and paste.
test("P248 a blog whose posts come from a headless CMS is named, never connected", () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "site", dependencies: { next: "15.0.0", ...deps } });
  const sanity = detectGithubLayout({ paths: ["next.config.js", "package.json", "app/blog/[slug]/page.tsx", "sanity.config.ts"], files: { "package.json": pkg({ "next-sanity": "9.0.0" }) } });
  assert.equal(!sanity.ok && sanity.reason, "headless_cms");
  assert.equal(!sanity.ok && sanity.detail, "Your blog's posts come from Sanity, not from files in this repository, so Pentra can't publish them automatically yet.");
  const contentful = detectGithubLayout({ paths: ["package.json", "src/pages/blog.tsx"], files: { "package.json": pkg({ contentful: "10.0.0" }) } });
  assert.equal(!contentful.ok && contentful.reason, "headless_cms", "no framework config, but the CMS is still named");
  assert.equal(detectGithubLayout({ paths: ["next.config.js", "package.json"], files: { "package.json": pkg({}) } }).ok, false);
  assert.equal((detectGithubLayout({ paths: ["next.config.js", "package.json"], files: { "package.json": pkg({}) } }) as { reason: string }).reason, "no_posts");
  const withPosts = { ...STARTERS.nextjs, files: { ...STARTERS.nextjs.files, "package.json": pkg({ "@sanity/client": "6.0.0" }) } };
  assert.equal(detectGithubLayout(withPosts).ok, true, "Markdown posts in the repository still win");
  assert.match(readFileSync("convex/githubLayoutDetect.ts", "utf8"), /"src\/content\/config\.ts", "package\.json"\]\) \{/);
  assert.match(readFileSync("src/components/pentra-setup-choice.tsx", "utf8"), /\{noBlog\.reason === "headless_cms" \? noBlog\.detail : <>We couldn&apos;t find/);
});

// P249 (Oct 30 2026): the most-used Next.js blog template (tailwind-nextjs-starter-blog) keeps its posts as MDX in
// data/blog; Pentra refused it ("Your posts are MDX files"). It now writes an MDX post whose body MDX compiles.
test("P249 an MDX-only blog gets an MDX post with its own frontmatter and a body MDX compiles", () => {
  const post = `---\ntitle: 'Release of Tailwind Nextjs Starter Blog v2.0'\ndate: '2023-08-05'\nlastmod: '2023-08-05'\ntags: ['next-js', 'tailwind']\ndraft: false\nsummary: 'Release of Tailwind Nextjs Starter Blog template v2.0'\nimages: ['/static/images/twitter-card.png']\nauthors: ['default']\nlayout: PostBanner\n---\n\nBody`;
  const detection = detectGithubLayout({ paths: ["next.config.js", "package.json", "app/blog/[...slug]/page.tsx", "data/blog/release-of-tailwind-nextjs-starter-blog-v2.0.mdx", "data/blog/code-sample.mdx"],
    files: { "data/blog/release-of-tailwind-nextjs-starter-blog-v2.0.mdx": post, "data/blog/code-sample.mdx": post } });
  assert.ok(detection.ok, JSON.stringify(detection));
  assert.equal(detection.layout.postsDir, "data/blog");
  assert.equal(detection.layout.urlStructure, "/blog/[slug]");
  const file = renderLayoutPost(detection.layout, { ...ARTICLE, markdown: "Costs fell {sharply} for sites < 50 pages, see <https://example.com/a>.\n\n<div style=\"padding:1px\"><iframe src=\"https://www.youtube.com/embed/x\"></iframe></div>\n\n```ts\nconst a = { b: 1 } < 2;\n```\n\nUse `{ slug }` here." });
  assert.equal(file.path, "data/blog/competitive-keyword-research-method.mdx");
  assert.match(file.content, /^title: "Competitive Keyword Research"\ndate: "2026-10-30T09:37:00\.000Z"\nlastmod: "2026-10-30T09:37:00\.000Z"\ntags: \[\]\ndraft: false\nsummary: "A method"\nimages: \['\/static\/images\/twitter-card\.png'\]\nauthors: \['default'\]\nlayout: PostBanner/m);
  assert.match(file.content, /Costs fell \\\{sharply\\\} for sites &lt; 50 pages, see \[https:\/\/example\.com\/a\]\(https:\/\/example\.com\/a\)\./);
  assert.doesNotMatch(file.content, /<iframe|<div/, "a raw HTML block is left out");
  assert.match(file.content, /```ts\nconst a = \{ b: 1 \} < 2;\n```/, "code is untouched");
  assert.match(file.content, /Use `\{ slug \}` here\./, "inline code is untouched");
  assert.equal(mdxSafeMarkdown("Plain text stays plain."), "Plain text stays plain.");
});

