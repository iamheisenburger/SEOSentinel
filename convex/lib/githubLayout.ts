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
  extension: ".md" | ".markdown";
  fields: GithubLayoutField[];
  /** Where a post is served, as a URL structure ("/blog/[slug]/"). */
  urlStructure: string;
  /** The existing post that showed the layout. */
  sample: { path: string; slug: string; title: string };
};
export type RepoSnapshot = { paths: string[]; files: Record<string, string> };
export type LayoutDetection =
  | { ok: true; layout: GithubLayout; sampleUrls: string[] }
  | { ok: false; reason: "no_posts" | "mdx_only" | "unsupported"; detail: string };

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
  } else candidates = ["_posts", "posts", "content/blog", "content/posts", "content/articles", "blog", "src/content/blog", "src/posts", "data/blog", "data/posts"];
  return candidates.map(dir => ({ dir, n: count(dir) })).filter(c => c.n > 0).sort((a, b) => b.n - a.n).map(c => c.dir);
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

/** Where the framework serves a post, as a URL structure, from its routes (the action confirms it on an existing post). */
export function urlStructureFor(framework: GithubLayoutFramework, postsDir: string, paths: string[]): string {
  const route = (re: RegExp) => paths.map(p => re.exec(p)).find(Boolean);
  if (framework === "astro") {
    const m = route(/^src\/pages\/(.*?)\/?\[(?:\.\.\.)?slug\]\.(astro|md|mdx|ts|js)$/);
    return m ? `/${m[1] ? m[1] + "/" : ""}[slug]/` : "/blog/[slug]/";
  }
  if (framework === "nextjs") {
    const m = route(/^(?:src\/)?app\/(.*?)\/?\[(?:\.\.\.)?slug\]\/page\.(tsx|ts|jsx|js|mdx)$/) ??
      route(/^(?:src\/)?pages\/(.*?)\/?\[(?:\.\.\.)?slug\]\.(tsx|ts|jsx|js|mdx)$/);
    return m ? `/${m[1] ? m[1] + "/" : ""}[slug]` : "/blog/[slug]";
  }
  if (framework === "hugo") return `/${postsDir.split("/").slice(1).join("/")}/[slug]/`;
  if (framework === "gatsby") return "/[slug]/";
  return "/blog/[slug]/"; // Jekyll: each post carries its own permalink (renderLayoutPost)
}

export function detectGithubLayout(snapshot: RepoSnapshot): LayoutDetection {
  const framework = detectFramework(snapshot.paths);
  if (!framework) return { ok: false, reason: "unsupported", detail: "No Astro, Hugo, Jekyll, Next.js or Gatsby configuration was found." };
  const folders = postFolders(framework, snapshot.paths, snapshot.files);
  if (!folders.length) return { ok: false, reason: "no_posts", detail: "No Markdown blog posts were found in the repository." };
  const postsDir = folders[0];
  const inDir = snapshot.paths.filter(p => p.startsWith(postsDir + "/") && MARKDOWN.test(p) && !IGNORED.test(p) &&
    (!NOT_A_POST.test(p) || /\/index\.(md|mdx)$/i.test(p) && p.split("/").length === postsDir.split("/").length + 2));
  const markdownOnly = inDir.filter(p => !/\.mdx$/i.test(p));
  if (!markdownOnly.length && framework !== "astro") return { ok: false, reason: "mdx_only", detail: "Your posts are MDX files; Pentra writes plain Markdown." };
  const indexStyle = inDir.every(p => /\/index\.(md|mdx|markdown)$/i.test(p) && p.split("/").length === postsDir.split("/").length + 2);
  const dated = inDir.every(p => /\/\d{4}-\d{2}-\d{2}-[^/]+$/.test(p));
  const extension = inDir.filter(p => /\.markdown$/i.test(p)).length > inDir.length / 2 ? ".markdown" : ".md";
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
  return { path: `${layout.postsDir}/${name}`, content: `---\n${lines.join("\n")}\n---\n\n${post.markdown.trim()}\n` };
}
