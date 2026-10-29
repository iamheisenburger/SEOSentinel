import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** P240 (Oct 29 2026): Convex disabled the deployment (free plan limits) at about 06:00Z and every pentra.dev article and
 * the sitemap answered 500, because each is read from Convex on every request. pentra.dev's articles are also committed
 * to this repository by Pentra's GitHub publisher (content/blog/<slug>.md or .mdx). When the Convex read fails, the
 * article page and the sitemap serve those files instead. A file never overrides a working Convex answer: an article
 * Convex says is not published stays a 404. */
export const COMMITTED_BLOG_DOMAIN = "pentra.dev";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const blogDir = (root: string) => path.join(root, "content", "blog");

export type CommittedArticle = {
  _id: string;
  title: string;
  metaTitle?: string;
  slug: string;
  markdown: string;
  metaDescription?: string;
  metaKeywords?: string[];
  featuredImage?: string;
  readingTime?: number;
  wordCount?: number;
  sources: { url: string; title?: string }[];
  internalLinks: { anchor: string; href: string }[];
  factCheckScore?: number;
  createdAt: number;
  publishedAt?: number;
  updatedAt?: number;
  siteName?: string;
  domain: string;
  urlStructure: string;
};

function scalar(raw: string): string | number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (value.startsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return undefined; }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^'(.*)'$/, "$1");
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** The publisher adds raw HTML to the file (JSON-LD scripts, video embeds, a call to action) that the page either renders
 * itself or not at all; react-markdown would print it as text. An HTML block runs to the next blank line (CommonMark),
 * a script to its closing tag; HTML inside a fenced code example is the article's own text and stays. The file's own
 * H1 repeats the page's title. */
export function readerMarkdown(body: string, title: string): string {
  const out: string[] = [];
  let fence: string | null = null, skip: "script" | "html" | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      out.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (skip === "script") { if (/<\/script>/i.test(line)) skip = null; continue; }
    if (skip === "html") { if (!line.trim()) { skip = null; out.push(line); } continue; }
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opener) { fence = opener[1]; out.push(line); continue; }
    if (/^\s*<script\b/i.test(line)) { if (!/<\/script>/i.test(line)) skip = "script"; continue; }
    if (/^\s*<[A-Za-z/!]/.test(line)) { skip = "html"; continue; }
    out.push(line);
  }
  const first = out.findIndex((line) => line.trim());
  if (first >= 0 && /^#\s+/.test(out[first].trim()) && out[first].trim().replace(/^#\s+/, "").toLowerCase() === title.toLowerCase()) {
    out.splice(first, 1);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One committed article file in the shape the article page reads from Convex (convex/blog.ts getPublishedBySlug). */
export function parseCommittedArticle(raw: string, slug: string): CommittedArticle | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return null;
  const fields: Record<string, string | number | undefined> = {};
  const lists: Record<string, Record<string, string>[]> = {};
  let list: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = /^\s+(-\s+)?([A-Za-z]+):\s*(.*)$/.exec(line);
    if (item) {
      if (!list) return null;
      if (item[1] || lists[list].length === 0) lists[list].push({});
      lists[list][lists[list].length - 1][item[2]] = String(scalar(item[3]) ?? "");
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!entry) return null;
    if (!entry[2].trim()) { list = entry[1]; lists[list] = []; continue; }
    list = null;
    fields[entry[1]] = scalar(entry[2]);
  }
  const title = text(fields.title);
  const date = text(fields.date) ? Date.parse(String(fields.date)) : NaN;
  if (!title || !Number.isFinite(date)) return null;
  const markdown = readerMarkdown(match[2], title);
  if (!markdown) return null;
  return {
    _id: `committed:${slug}`,
    title,
    metaTitle: text(fields.metaTitle),
    slug,
    markdown,
    metaDescription: text(fields.description),
    featuredImage: text(fields.featuredImage),
    readingTime: number(fields.readingTime),
    wordCount: number(fields.wordCount),
    sources: (lists.sources ?? []).filter((source) => source.url).map((source) => ({ url: source.url, ...(source.title ? { title: source.title } : {}) })),
    internalLinks: (lists.internalLinks ?? []).filter((link) => link.anchor && link.href).map((link) => ({ anchor: link.anchor, href: link.href })),
    factCheckScore: number(fields.factCheckScore),
    createdAt: date,
    publishedAt: date,
    updatedAt: date,
    siteName: "Pentra",
    domain: COMMITTED_BLOG_DOMAIN,
    urlStructure: "/blog/[slug]",
  };
}

/** The committed file for one pentra.dev article, or null (another domain, an unsafe slug, no such file). */
export async function readCommittedArticle(domain: string, slug: string, root = process.cwd()): Promise<CommittedArticle | null> {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  if (domain !== COMMITTED_BLOG_DOMAIN || !SLUG.test(normalized)) return null;
  for (const extension of [".md", ".mdx"]) {
    try {
      return parseCommittedArticle(await readFile(path.join(blogDir(root), normalized + extension), "utf8"), normalized);
    } catch { /* try the next extension */ }
  }
  return null;
}

/** Every committed pentra.dev article's slug and date, for the sitemap when Convex cannot be read. */
export async function listCommittedArticles(root = process.cwd()): Promise<{ slug: string; updatedAt: number }[]> {
  const files = (await readdir(blogDir(root))).filter((file) => /\.(md|mdx)$/.test(file)).sort();
  const articles = await Promise.all(files.map(async (file) => {
    const slug = file.replace(/\.(md|mdx)$/, "");
    if (!SLUG.test(slug)) return null;
    const article = parseCommittedArticle(await readFile(path.join(blogDir(root), file), "utf8"), slug);
    return article ? { slug, updatedAt: article.updatedAt ?? article.createdAt } : null;
  }));
  return articles.filter((article): article is { slug: string; updatedAt: number } => article !== null);
}

/** Convex's answer when it gives one (an article or null); the committed file only when the read itself fails. */
export async function publishedOrCommitted<T>(domain: string, slug: string, read: () => Promise<T>,
  committed: (domain: string, slug: string) => Promise<CommittedArticle | null> = readCommittedArticle): Promise<T | CommittedArticle> {
  try {
    return await read();
  } catch (error) {
    const file = await committed(domain, slug);
    if (file) return file;
    throw error;
  }
}
