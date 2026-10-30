/** P243 (Oct 30 2026): GitHub publishing that fits the user's site (ops/GITHUB-LAYOUTS-PLAN.md).
 * Pentra committed every article to content/blog/<slug>.md with its own frontmatter, which a stock Astro blog
 * (src/content/blog, pubDate), Jekyll (_posts/YYYY-MM-DD-*.md) or the Next.js blog starter (_posts, coverImage, author)
 * never shows. Detection reads the repository once (its files, its framework's config and a few existing posts) and
 * the result decides where each article goes, its file name and its frontmatter, mirroring the site's own posts.
 * Pure: the GitHub and HTTP reads happen in convex/actions/githubLayout.ts. */

export type GithubLayoutFramework = "astro" | "hugo" | "jekyll" | "nextjs" | "gatsby";
export type GithubLayoutField =
  | { key: string; from: "title" | "description" | "date" | "updated" | "slug" | "permalink" | "draft" | "tags" }
  /** A block copied verbatim from the site's own posts (layout, author, a cover image path): keeps the build working. */
  | { key: string; from: "copy"; raw: string };
export type GithubLayout = {
  version: 1;
  framework: GithubLayoutFramework;
  postsDir: string;
  fileName: "slug" | "date-slug" | "slug-index";
  extension: ".md" | ".markdown" | ".mdx";
  fields: GithubLayoutField[];
  /** Where a post is served, as a URL structure ("/blog/[slug]/"). */
  urlStructure: string;
  /** The existing post that showed the layout. */
  sample: { path: string; slug: string; title: string };
};
export type RepoSnapshot = { paths: string[]; files: Record<string, string> };
export type LayoutDetection =
  | { ok: true; layout: GithubLayout; sampleUrls: string[] }
  | { ok: false; reason: "no_posts" | "mdx_only" | "unsupported" | "headless_cms"; detail: string };

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const IGNORED = /(^|\/)(node_modules|\.git|\.github|vendor|public|dist|build|out|\.next|_site|resources|themes)\//;
const NOT_A_POST = /(^|\/)(README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|_index|index)\.(md|markdown|mdx)$/i;

export function detectFramework(paths: string[]): GithubLayoutFramework | null {
  const root = new Set(paths.filter(p => !p.includes("/")));
  const has = (re: RegExp) => [...root].some(p => re.test(p));
  if (has(/^astro\.config\.(mjs|js|ts|cjs|mts)$/)) return "astro";
  if (has(/^gatsby-config\.(js|ts|mjs)$/)) return "gatsby";
  if (has(/^hugo\.(toml|yaml|yml|json)$/) || (has(/^config\.(toml|yaml|yml)$/) && paths.some(p => p.startsWith("content/")) &&
    paths.some(p => /^(archetypes|layouts|themes)\//.test(p)))) return "hugo";
  if (root.has("_config.yml") && paths.some(p => p.startsWith("_posts/"))) return "jekyll";
  if (has(/^next\.config\.(js|mjs|ts|cjs)$/)) return "nextjs";
  return null;
}

const BLOG_FOLDER = /^(?:blog|blogs|posts|articles|news|writing|journal|insights)$/i;
const FIXED_POST_DIR = /^(?:_posts|posts|content\/(?:blog|posts|articles)|blog|src\/content\/blog|src\/posts|data\/(?:blog|posts)|src\/content\/[^/]+|src\/data\/[^/]+|content\/[^/]+)$/;
/** Folders holding the framework's posts, the most-populated first. */
export function postFolders(framework: GithubLayoutFramework, paths: string[], files: Record<string, string>): string[] {
  const posts = paths.filter(p => MARKDOWN.test(p) && !IGNORED.test(p));
  const count = (dir: string) => posts.filter(p => p.startsWith(dir + "/") && !NOT_A_POST.test(p) || p.startsWith(dir + "/") && /\/index\.(md|mdx)$/i.test(p) && p.split("/").length === dir.split("/").length + 2).length;
  let candidates: string[];
  if (framework === "jekyll") candidates = ["_posts"];
  else if (framework === "hugo") candidates = [...new Set(posts.filter(p => p.startsWith("content/")).map(p => p.split("/").slice(0, 2).join("/")))].filter(d => d.split("/").length === 2);
  else if (framework === "astro") {
    const config = files["src/content.config.ts"] ?? files["src/content.config.mjs"] ?? files["src/content/config.ts"] ?? "";
    const bases = [...config.matchAll(/base:\s*["'`]\.?\/?([^"'`]+?)\/?["'`]/g)].map(m => m[1]);
    candidates = bases.length ? bases : [...new Set(posts.filter(p => /^src\/(content|data)\/[^/]+\//.test(p)).map(p => p.split("/").slice(0, 3).join("/")))];
  } else {
    // P252 (Oct 30 2026): Next.js and Gatsby blogs keep posts wherever their loader reads them (openstatus:
    // src/content/pages/blog, midday: src/app/updates/posts); any folder named like a blog with two or more posts counts.
    const named = [...new Set(posts.map(p => p.split("/").slice(0, -1).join("/")).flatMap(dir => {
      const parts = dir.split("/"), at = parts.findIndex(part => BLOG_FOLDER.test(part));
      return at >= 0 && !parts.some(part => /^(?:docs?|documentation|changelogs?|releases?)$/i.test(part)) ? [parts.slice(0, at + 1).join("/")] : [];
    }))];
    candidates = [...new Set(["_posts", "posts", "content/blog", "content/posts", "content/articles", "blog", "src/content/blog", "src/posts", "data/blog", "data/posts",
      ...named])];
  }
  return candidates.map(dir => ({ dir, n: count(dir) })).filter(c => c.n > 0 && (c.n >= 2 || !c.dir.includes("/") || FIXED_POST_DIR.test(c.dir)))
    .sort((a, b) => b.n - a.n).map(c => c.dir);
}

/** One post's frontmatter: its top-level keys in order, each with its raw YAML block. Hugo's TOML (+++) is converted for
 * the simple key = value lines it uses. */
export function frontmatterBlocks(source: string): { key: string; raw: string; value: string }[] | null {
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const toml = !yaml ? /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+(?:\r?\n|$)/.exec(source) : null;
  if (!yaml && !toml) return null;
  const lines = (yaml ?? toml)![1].split(/\r?\n/);
  const blocks: { key: string; raw: string; value: string }[] = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const entry = toml ? /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(line) : /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (entry && !/^\s/.test(line)) {
      const value = toml ? entry[2].trim() : entry[2].trim();
      blocks.push({ key: entry[1], value, raw: toml ? `${entry[1]}: ${value}` : line });
    } else if (blocks.length && /^\s/.test(line) && !toml) {
      blocks[blocks.length - 1].raw += "\n" + line;
    }
  }
  return blocks;
}

const TITLE = /^title$/i;
const DESCRIPTION = /^(description|excerpt|summary|subtitle|desc|abstract|metaDescription|seoDescription)$/i;
const DATE = /^(date|pubDate|publishDate|published_?at|publishedAt|pubdate|created_?at|createdAt|created)$/i;
const UPDATED = /^(updatedDate|updated|lastmod|modified|updatedAt|updated_at|lastModified|dateModified)$/i;
const DRAFT = /^draft$/i;
const TAGS = /^(tags|categories|keywords)$/i;
const SLUG = /^slug$/i;
const PERMALINK = /^(permalink|url)$/i;

export function mirroredFields(posts: string[]): GithubLayoutField[] | null {
  const parsed = posts.map(frontmatterBlocks).filter((b): b is NonNullable<typeof b> => Boolean(b));
  if (!parsed.length) return null;
  // Keys every sample post has, in the newest sample's order.
  const shared = parsed[0].filter(block => parsed.every(p => p.some(b => b.key === block.key)));
  const fields: GithubLayoutField[] = [];
  for (const block of shared) {
    if (TITLE.test(block.key)) fields.push({ key: block.key, from: "title" });
    else if (DESCRIPTION.test(block.key)) fields.push({ key: block.key, from: "description" });
    else if (DATE.test(block.key)) fields.push({ key: block.key, from: "date" });
    else if (UPDATED.test(block.key)) fields.push({ key: block.key, from: "updated" });
    else if (DRAFT.test(block.key)) fields.push({ key: block.key, from: "draft" });
    else if (TAGS.test(block.key)) fields.push({ key: block.key, from: "tags" });
    else if (SLUG.test(block.key)) fields.push({ key: block.key, from: "slug" });
    else if (PERMALINK.test(block.key)) fields.push({ key: block.key, from: "permalink" });
    else fields.push({ key: block.key, from: "copy", raw: block.raw });
  }
  if (!fields.some(f => f.from === "title")) fields.unshift({ key: "title", from: "title" });
  return fields;
}

/** P252 (Oct 30 2026): the URL segments in front of a post route's slug parameter. Next.js route groups ("(marketing)")
 * never appear in the URL; a route with another dynamic segment ("[lang]") cannot name one URL, so it is left out.
 * shadcn-ui/taxonomy serves content/blog posts at app/(marketing)/blog/[...slug] and had been read as /(docs)/guides. */
function routeSegments(paths: string[], re: RegExp): string[][] {
  return paths.map(p => re.exec(p)).filter((m): m is RegExpExecArray => Boolean(m))
    .map(m => m[1].split("/").filter(Boolean).filter(segment => !/^\(.*\)$/.test(segment)))
    .filter(segments => segments.every(segment => !/^\[.*\]$/.test(segment)));
}
/** The route serving the posts folder: the one named like it ("blog" for content/blog), then a usual blog name, then any. */
function postRoute(candidates: string[][], postsDir: string): string[] | undefined {
  const leaf = (postsDir.split("/").at(-1) ?? "").toLowerCase(), last = (segments: string[]) => (segments.at(-1) ?? "").toLowerCase();
  return candidates.find(segments => last(segments) === leaf) ??
    candidates.find(segments => ["blog", "posts", "articles", "news", "writing", "journal", "insights", "updates"].includes(last(segments))) ?? candidates[0];
}
const SLUG_PARAM = String.raw`\[\[?(?:\.\.\.)?slug\]\]?`;

/** Where the framework serves a post, as a URL structure, from its routes (the action confirms it on an existing post). */
export function urlStructureFor(framework: GithubLayoutFramework, postsDir: string, paths: string[]): string {
  if (framework === "astro") {
    const segments = postRoute(routeSegments(paths, new RegExp(String.raw`^src/pages/(.*?)/?${SLUG_PARAM}\.(astro|md|mdx|ts|js)$`)), postsDir);
    return segments ? `/${segments.length ? segments.join("/") + "/" : ""}[slug]/` : "/blog/[slug]/";
  }
  if (framework === "nextjs") {
    const segments = postRoute([...routeSegments(paths, new RegExp(String.raw`^(?:src/)?app/(.*?)/?${SLUG_PARAM}/page\.(tsx|ts|jsx|js|mdx)$`)),
      ...routeSegments(paths, new RegExp(String.raw`^(?:src/)?pages/(.*?)/?${SLUG_PARAM}\.(tsx|ts|jsx|js|mdx)$`))], postsDir);
    return segments ? `/${segments.length ? segments.join("/") + "/" : ""}[slug]` : "/blog/[slug]";
  }
  if (framework === "hugo") return `/${postsDir.split("/").slice(1).join("/")}/[slug]/`;
  if (framework === "gatsby") return "/[slug]/";
  return "/blog/[slug]/"; // Jekyll: each post carries its own permalink (renderLayoutPost)
}

/** P248 (Oct 30 2026): many Next.js and Gatsby blogs load their posts from a headless CMS, not from files in the
 * repository, so a commit would never show. The CMS is named from the site's own package.json. */
const HEADLESS_CMS: [RegExp, string][] = [
  [/^(sanity|next-sanity|@sanity\/client)$/, "Sanity"], [/^(contentful|@contentful\/rich-text-react-renderer)$/, "Contentful"],
  [/^(@notionhq\/client|notion-client|react-notion-x|notion-to-md)$/, "Notion"], [/^@tryghost\/(content|admin)-api$/, "Ghost"],
  [/^@prismicio\/(client|next|react)$/, "Prismic"], [/^(@storyblok\/(react|js)|storyblok-js-client)$/, "Storyblok"],
  [/^(react-datocms|@datocms\/cma-client)$/, "DatoCMS"], [/^(payload|@payloadcms\/next)$/, "Payload"],
  [/^@faustwp\/(core|cli)$/, "WordPress (headless)"], [/^@builder\.io\/(react|sdk)$/, "Builder.io"],
  [/^@directus\/sdk$/, "Directus"], [/^(contentstack|@contentstack\/delivery-sdk)$/, "Contentstack"],
  [/^@strapi\/(client|strapi)$/, "Strapi"], [/^@hubspot\/api-client$/, "HubSpot"],
];
export function headlessCms(packageJson: string | undefined): string | null {
  if (!packageJson) return null;
  try {
    const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    return HEADLESS_CMS.find(([re]) => names.some(name => re.test(name)))?.[1] ?? null;
  } catch { return null; }
}

/** P252 (Oct 30 2026): a monorepo keeps its site in a folder (Turborepo's apps/web or apps/www, or web/, site/,
 * marketing/): the folder holding a framework's config is the site's root and its posts are found inside it. The
 * repository root wins when it holds the site itself; null when no folder does. */
const SITE_FOLDER = /^(?:apps\/[^/]+|web|www|site|website|marketing|frontend|landing|blog)$/;
const within = (paths: string[], dir: string) => paths.filter(p => p.startsWith(dir + "/")).map(p => p.slice(dir.length + 1));
const relativeFiles = (files: Record<string, string>, dir: string) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(dir + "/")).map(([path, text]) => [path.slice(dir.length + 1), text]));
/** Several apps (midday: apps/dashboard and apps/website): the one whose blog holds the most posts, then the one named
 * like a website. */
const SITE_NAME_ORDER = ["website", "www", "web", "marketing", "site", "landing", "blog", "frontend"];
export function appRoot(paths: string[]): string | null {
  if (detectFramework(paths)) return "";
  const dirs = [...new Set(paths.map(p => p.split("/").slice(0, -1).join("/")).filter(dir => SITE_FOLDER.test(dir)))]
    .filter(dir => detectFramework(within(paths, dir)));
  const posts = (dir: string) => {
    const rel = within(paths, dir), folder = postFolders(detectFramework(rel)!, rel, {})[0];
    return folder ? rel.filter(p => p.startsWith(folder + "/") && MARKDOWN.test(p)).length : 0;
  };
  const rank = (dir: string) => { const at = SITE_NAME_ORDER.indexOf(dir.split("/").at(-1)!.toLowerCase()); return at < 0 ? SITE_NAME_ORDER.length : at; };
  return dirs.map(dir => ({ dir, n: posts(dir), r: rank(dir) })).sort((a, b) => b.n - a.n || a.r - b.r || a.dir.localeCompare(b.dir))[0]?.dir ?? null;
}
/** What detection reads first: Astro's content config and package.json (P248's CMS check), in the site's folder. */
export function layoutConfigPaths(paths: string[]): string[] {
  const root = appRoot(paths) ?? "";
  return ["src/content.config.ts", "src/content.config.mjs", "src/content/config.ts", "package.json"]
    .map(file => root ? `${root}/${file}` : file).filter(file => paths.includes(file));
}
/** Then up to three of the newest posts in the folder those point to. */
export function layoutSamplePaths(paths: string[], files: Record<string, string>): string[] {
  const root = appRoot(paths);
  if (root === null) return [];
  const rel = root ? within(paths, root) : paths, framework = detectFramework(rel)!;
  const folder = postFolders(framework, rel, root ? relativeFiles(files, root) : files)[0];
  if (!folder) return [];
  const prefix = root ? `${root}/${folder}/` : `${folder}/`;
  return paths.filter(p => p.startsWith(prefix) && MARKDOWN.test(p)).sort().reverse().slice(0, 3);
}

export function detectGithubLayout(snapshot: RepoSnapshot): LayoutDetection {
  const root = appRoot(snapshot.paths);
  if (!root) return detectSiteLayout(snapshot);
  const inner = detectSiteLayout({ paths: within(snapshot.paths, root), files: relativeFiles(snapshot.files, root) });
  return inner.ok ? { ...inner, layout: { ...inner.layout, postsDir: `${root}/${inner.layout.postsDir}`,
    sample: { ...inner.layout.sample, path: `${root}/${inner.layout.sample.path}` } } } : inner;
}

function detectSiteLayout(snapshot: RepoSnapshot): LayoutDetection {
  const framework = detectFramework(snapshot.paths);
  const cms = headlessCms(snapshot.files["package.json"]);
  const fromCms = (name: string): LayoutDetection => ({ ok: false, reason: "headless_cms",
    detail: `Your blog's posts come from ${name}, not from files in this repository, so Pentra can't publish them automatically yet.` });
  if (!framework) return cms ? fromCms(cms) : { ok: false, reason: "unsupported", detail: "No Astro, Hugo, Jekyll, Next.js or Gatsby configuration was found." };
  const folders = postFolders(framework, snapshot.paths, snapshot.files);
  if (!folders.length) return cms ? fromCms(cms) : { ok: false, reason: "no_posts", detail: "No Markdown blog posts were found in the repository." };
  const postsDir = folders[0];
  const inDir = snapshot.paths.filter(p => p.startsWith(postsDir + "/") && MARKDOWN.test(p) && !IGNORED.test(p) &&
    (!NOT_A_POST.test(p) || /\/index\.(md|mdx)$/i.test(p) && p.split("/").length === postsDir.split("/").length + 2));
  const markdownOnly = inDir.filter(p => !/\.mdx$/i.test(p));
  // P249 (Oct 30 2026): a blog that keeps only MDX posts (the Tailwind Next.js starter, many Gatsby blogs) gets MDX files
  // whose body MDX compiles (mdxSafeMarkdown); its posts' YAML frontmatter is mirrored as for Markdown.
  const mdx = !markdownOnly.length && framework !== "astro";
  const indexStyle = inDir.every(p => /\/index\.(md|mdx|markdown)$/i.test(p) && p.split("/").length === postsDir.split("/").length + 2);
  const dated = inDir.every(p => /\/\d{4}-\d{2}-\d{2}-[^/]+$/.test(p));
  const extension = mdx ? ".mdx" : inDir.filter(p => /\.markdown$/i.test(p)).length > inDir.length / 2 ? ".markdown" : ".md";
  const samples = inDir.filter(p => snapshot.files[p]).sort().reverse().slice(0, 3);
  const fields = mirroredFields(samples.map(p => snapshot.files[p]));
  if (!fields || !samples.length) return { ok: false, reason: "no_posts", detail: "The posts found have no frontmatter Pentra can follow." };
  const sampleSlug = slugOf(samples[0], indexStyle);
  const titleBlock = frontmatterBlocks(snapshot.files[samples[0]])?.find(b => TITLE.test(b.key));
  const layout: GithubLayout = { version: 1, framework, postsDir, fileName: indexStyle ? "slug-index" : dated ? "date-slug" : "slug",
    extension, fields: framework === "jekyll" && !fields.some(f => f.from === "permalink") ? [...fields, { key: "permalink", from: "permalink" }] : fields,
    urlStructure: urlStructureFor(framework, postsDir, snapshot.paths),
    sample: { path: samples[0], slug: sampleSlug, title: unquote(titleBlock?.value ?? "") } };
  return { ok: true, layout, sampleUrls: [] };
}

export function slugOf(path: string, indexStyle: boolean): string {
  const parts = path.split("/");
  const name = indexStyle ? parts[parts.length - 2] : parts[parts.length - 1].replace(/\.(md|markdown|mdx)$/i, "");
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export function unquote(value: string): string {
  const v = value.trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v) as string; } catch { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** One article as a file in the site's layout. The date is the article's first publication, so the path never moves. */
export function renderLayoutPost(layout: GithubLayout, post: { slug: string; title: string; description: string; publishedAt: number;
  markdown: string; deliveryKey: string }): { path: string; content: string } {
  const iso = new Date(post.publishedAt).toISOString();
  const day = iso.slice(0, 10);
  const name = layout.fileName === "slug-index" ? `${post.slug}/index${layout.extension}` :
    layout.fileName === "date-slug" ? `${day}-${post.slug}${layout.extension}` : `${post.slug}${layout.extension}`;
  const url = layout.urlStructure.replace("[slug]", post.slug);
  const lines: string[] = [];
  for (const field of layout.fields) {
    if (field.from === "copy") { lines.push(field.raw); continue; }
    const value = field.from === "title" ? JSON.stringify(post.title) : field.from === "description" ? JSON.stringify(post.description) :
      field.from === "date" || field.from === "updated" ? JSON.stringify(iso) : field.from === "draft" ? "false" :
      field.from === "tags" ? "[]" : field.from === "slug" ? JSON.stringify(post.slug) : JSON.stringify(url);
    lines.push(`${field.key}: ${value}`);
  }
  lines.push(`pentraDeliveryKey: ${JSON.stringify(post.deliveryKey)}`);
  const body = layout.extension === ".mdx" ? mdxSafeMarkdown(post.markdown.trim()) : post.markdown.trim();
  return { path: `${layout.postsDir}/${name}`, content: `---\n${lines.join("\n")}\n---\n\n${body}\n` };
}

/** P249 (Oct 30 2026): Markdown that MDX compiles. MDX reads `{` and `}` as code and `<` as a component tag, and a
 * malformed one fails the site's whole build. Outside fenced and inline code they are escaped, an autolink becomes a
 * plain link, and a raw HTML block (an embedded video) is left out. */
export function mdxSafeMarkdown(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null, htmlBlock = false;
  for (const line of markdown.split("\n")) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { out.push(line); if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null; continue; }
    if (opener) { fence = opener[1]; out.push(line); continue; }
    if (htmlBlock) { if (!line.trim()) { htmlBlock = false; out.push(line); } continue; }
    if (/^\s*<(?!https?:\/\/)[A-Za-z!\/]/.test(line)) { htmlBlock = true; continue; }
    out.push(line.split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part
      : part.replace(/<(https?:\/\/[^>\s]+)>/g, "[$1]($1)").replace(/[{}]/g, c => `\\${c}`).replace(/</g, "&lt;")).join(""));
  }
  return out.join("\n");
}

/** P244 (Oct 30 2026): a site whose own blog layout Pentra writes into renders the article with its own templates (page
 * title, description, Markdown renderer, typography), so the exact renderer check Pentra uses for pages it formats
 * itself cannot apply. The article counts as live when its URL serves its title (checked by the caller) and the opening
 * words of its first paragraph. */
export function layoutArticleLive(html: string, markdown: string): boolean {
  const visible = (text: string) => text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;|&lsquo;|[\u2018\u2019]/g, "'").replace(/&quot;|&ldquo;|&rdquo;|[\u201c\u201d]/g, '"')
    .replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  const paragraph = markdown.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(#|>|\||-|\*|\d+\.|!\[|```|<)/.test(p));
  if (!paragraph) return false;
  const plain = visible(paragraph.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""));
  const opening = plain.split(" ").slice(0, 10).join(" ");
  return opening.length > 20 && visible(html).includes(opening);
}

