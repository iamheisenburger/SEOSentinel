// Pentra blog (https://pentra.dev): reads the articles Pentra publishes to SITE.contentDir. Pentra added this file with
// the blog; it needs no packages. Only files Pentra marked as published are shown.
import fs from "node:fs";
import path from "node:path";
import { SITE } from "./site.js";
import { renderMarkdown } from "./markdown.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The folder is written out in full (Pentra sets it when it adds the blog), so Next.js bundles only this folder.
const FOLDER = path.join(process.cwd(), "content", "blog"); // pentra:folder

function scalar(raw) {
  const value = raw.trim();
  if (/^".*"$/.test(value)) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

/** The frontmatter Pentra writes: one `key: value` per line, and lists of `- key: value` entries. */
export function parseFrontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(file);
  if (!match) return null;
  const data = {};
  let list = null, entry = null;
  for (const line of match[1].split(/\r?\n/)) {
    let m;
    if ((m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line))) {
      entry = null;
      if (m[2].trim() === "") { list = []; data[m[1]] = list; } else { list = null; data[m[1]] = scalar(m[2]); }
    } else if (list && (m = /^[ \t]+-[ \t]+([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line))) {
      entry = { [m[1]]: scalar(m[2]) };
      list.push(entry);
    } else if (list && (m = /^[ \t]+-[ \t]+(.*)$/.exec(line))) {
      entry = null;
      list.push(scalar(m[1]));
    } else if (entry && (m = /^[ \t]+([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line))) {
      entry[m[1]] = scalar(m[2]);
    }
  }
  return { data, body: file.slice(match[0].length) };
}

const text = (value) => (typeof value === "string" ? value.trim() : "");
const isoDate = (value) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);
function https(value) {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function parsePost(slug, file, withHtml = true) {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  const parsed = parseFrontmatter(file);
  if (!parsed) return null;
  const data = parsed.data;
  if (data.generator !== "pentra" || data.status !== "published") return null;
  const title = text(data.title), date = isoDate(data.date);
  if (!title || !date) return null;
  const body = parsed.body.trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map((s) => (typeof s === "string" ? { url: https(s), title: null } : s && typeof s === "object" ? { url: https(s.url), title: text(s.title) || null } : null))
    .filter((s) => s && s.url);
  const post = {
    slug,
    title,
    metaTitle: text(data.metaTitle) || null,
    description: text(data.description),
    date,
    updatedAt: isoDate(data.updatedAt),
    image: https(data.featuredImage),
    readingTime: typeof data.readingTime === "number" && data.readingTime > 0 ? Math.round(data.readingTime) : Math.max(1, Math.round(words / 230)),
    path: `${SITE.path}/${slug}`,
    canonicalUrl: https(data.canonicalUrl) || `${SITE.origin}${SITE.path}/${slug}`,
    sources,
  };
  if (withHtml) {
    post.html = renderMarkdown(body, SITE.origin);
    // An article with its own sources or related-reading section doesn't get a second one from the page.
    post.hasSources = /<h[2-6][^>]*>[^<]*(?:sources|references|quellen|fuentes|fontes|fonti|bronnen)/i.test(post.html);
    post.hasRelated = /<h[2-6][^>]*>[^<]*(?:related|read next|further reading|weiterlesen|à lire|leia também|letture|meer lezen)/i.test(post.html);
  }
  return post;
}

function read(slug) {
  try {
    return fs.readFileSync(path.join(FOLDER, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

/** One article with its HTML, or null. */
export function getPost(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  const file = read(slug);
  return file ? parsePost(slug, file, true) : null;
}

/** Every published article, newest first, without HTML. */
export function getPosts() {
  let names = [];
  try {
    names = fs.readdirSync(FOLDER);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && SLUG.test(name.slice(0, -3)))
    .map((name) => {
      const file = read(name.slice(0, -3));
      return file ? parsePost(name.slice(0, -3), file, false) : null;
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.slug.localeCompare(b.slug));
}

const STOP = new Set(["about", "after", "and", "are", "best", "can", "for", "from", "guide", "how", "into", "more", "that", "the", "their", "this", "what", "when", "which", "why", "with", "you", "your"]);
const words = (post) => new Set(`${post.title} ${post.description}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));

/** Up to three other articles that share the most words with this one, so no article is a dead end. */
export function relatedPosts(post, posts, limit = 3) {
  const mine = words(post);
  return posts
    .filter((other) => other.slug !== post.slug)
    .map((other) => ({ other, score: [...words(other)].filter((w) => mine.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.other.date) - Date.parse(a.other.date))
    .slice(0, limit)
    .map((x) => x.other);
}

/** Article and breadcrumb structured data for search engines. */
export function structuredData(post) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
        ...(post.image ? { image: post.image } : {}),
        author: { "@type": "Organization", name: SITE.name, url: SITE.origin },
        publisher: { "@type": "Organization", name: SITE.name, url: SITE.origin },
        mainEntityOfPage: post.canonicalUrl,
        url: post.canonicalUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE.name, item: SITE.origin },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE.origin}${SITE.path}` },
          { "@type": "ListItem", position: 3, name: post.title, item: post.canonicalUrl },
        ],
      },
    ],
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
