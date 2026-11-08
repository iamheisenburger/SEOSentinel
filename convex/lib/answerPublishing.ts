/** Pentra Answers (Nov 2026): where an answer page goes and in what form. Pure: the file a site's own blog reads (its
 * detected layout, or Pentra's default frontmatter), the page's public address, the hosted answers address, IndexNow. */
import { renderLayoutPost, type GithubLayout } from "./githubLayout.ts";
import { hostOf } from "./answerEngine.ts";

export type AnswerPageForPublish = { title: string; slug: string; metaDescription: string; markdown: string;
  sources: ReadonlyArray<{ n: number; url: string; title?: string }>; firstPublishedAt: number; deliveryKey: string };

export const answerDeliveryKey = (pageId: string, version: number) => `answer:${pageId}:v${version}`;

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function assertSafeSlug(slug: string) {
  if (!SAFE_SLUG.test(slug)) throw new Error("The page address isn't safe to publish.");
}

/** A site's URL structure for posts ("/blog/[slug]"), defaulting to /blog. */
export function urlStructureOf(site: { urlStructure?: string | null }): string {
  const raw = (site.urlStructure ?? "").trim();
  if (!raw) return "/blog/[slug]";
  return raw.includes("[") ? raw : `${raw.replace(/\/$/, "")}/[slug]`;
}
export function publicPageUrl(domain: string, urlStructure: string, slug: string): string {
  const path = urlStructure.replace(/\[[^\]]+\]/, slug);
  return `https://${hostOf(domain)}${path.startsWith("/") ? "" : "/"}${path}`;
}
/** The content folder Pentra's default layout writes to: /blog/[slug] -> content/blog. */
export function defaultContentDir(urlStructure: string): string {
  const first = urlStructure.split("/").filter(Boolean)[0] ?? "blog";
  const segment = first.includes("[") ? "blog" : first.replace(/[^A-Za-z0-9_-]/g, "") || "blog";
  return `content/${segment}`;
}

export function isGithubLayout(value: unknown): value is GithubLayout {
  const l = value as GithubLayout | null;
  return Boolean(l && l.version === 1 && typeof l.postsDir === "string" && Array.isArray(l.fields) && typeof l.urlStructure === "string" &&
    (l.extension === ".md" || l.extension === ".markdown" || l.extension === ".mdx"));
}

/** The file for a GitHub-hosted blog: the site's own post layout when Pentra detected one (its frontmatter mirrored), else
 * Pentra's default (content/<folder>/<slug>.md with the frontmatter Pentra's blog kit and its customers' blogs read). */
export function githubAnswerFile(page: AnswerPageForPublish, site: { domain: string; urlStructure?: string | null; githubLayout?: unknown }):
  { path: string; content: string; url: string } {
  assertSafeSlug(page.slug);
  if (isGithubLayout(site.githubLayout)) {
    const layout = site.githubLayout;
    const file = renderLayoutPost(layout, { slug: page.slug, title: page.title, description: page.metaDescription, publishedAt: page.firstPublishedAt,
      markdown: page.markdown, deliveryKey: page.deliveryKey });
    if (file.path.includes("..") || !file.path.startsWith(`${layout.postsDir}/`)) throw new Error("Refusing to write outside the blog's posts folder.");
    return { ...file, url: publicPageUrl(site.domain, layout.urlStructure, page.slug) };
  }
  const structure = urlStructureOf(site);
  const url = publicPageUrl(site.domain, structure, page.slug);
  const y = (value: string) => JSON.stringify(value);
  const frontmatter = [
    "---",
    `title: ${y(page.title)}`,
    `description: ${y(page.metaDescription)}`,
    `generator: "pentra"`,
    `pentraDeliveryKey: ${y(page.deliveryKey)}`,
    `status: "published"`,
    `canonicalUrl: ${y(url)}`,
    `date: ${y(new Date(page.firstPublishedAt).toISOString())}`,
    page.sources.length ? `sources:\n${page.sources.map((s) => `  - url: ${y(s.url)}${s.title ? `\n    title: ${y(s.title)}` : ""}`).join("\n")}` : "",
    "---",
  ].filter(Boolean).join("\n");
  return { path: `${defaultContentDir(structure)}/${page.slug}.md`, content: `${frontmatter}\n\n${page.markdown.trim()}\n`, url };
}

/** The hosted answers address is always answers.<the site's own domain>: the site recognizes hosted traffic by its first
 * label, without a database read on every request. */
export const HOSTED_ANSWERS_LABEL = "answers";
export function validHostedDomain(candidate: string, siteDomain: string): string | null {
  const host = hostOf(candidate);
  const root = hostOf(siteDomain);
  if (!host || !root || host !== `${HOSTED_ANSWERS_LABEL}.${root}`) return null;
  return host;
}
export const isHostedAnswersHost = (host: string) => hostOf(host).startsWith(`${HOSTED_ANSWERS_LABEL}.`) && hostOf(host).split(".").length >= 3;
export const hostedPageUrl = (hostedDomain: string, slug: string) => `https://${hostOf(hostedDomain)}/${slug}`;

/** IndexNow (Bing and the engines that share it): the request for one site's new or changed addresses. */
export function indexNowRequest(host: string, key: string, keyLocation: string, urls: readonly string[]) {
  return { url: "https://api.indexnow.org/indexnow", body: { host: hostOf(host), key, keyLocation, urlList: [...new Set(urls)].slice(0, 100) } };
}
