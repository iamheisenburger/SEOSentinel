import { appRoot, detectFramework } from "./githubLayout.ts";
import { BLOG_KIT_SOURCES } from "./blogKitSources.ts";

/** P377 (Nov 6 2026): a Next.js site with no blog gets one from Pentra. Arshad: "imagine a new customer signs up and has
 * no blog and pentra refuses to post". A GitHub site whose repository held no Markdown posts was a dead end ("No
 * Markdown blog posts were found"): Pentra learns a blog's format from its posts, and there were none to learn from.
 * Now Pentra commits a small blog to the site (blog-kit/, no packages, nothing existing changed), in the site's own
 * layout, that shows the files Pentra publishes to content/<segment>/ in its usual format, then publishes into it. */

export const BLOG_KIT_VERSION = 1;
/** Where the blog goes: the first of these the site doesn't already use. */
export const BLOG_KIT_SEGMENTS = ["blog", "articles", "resources", "guides", "insights"] as const;
/** In the blog's HTML: how Pentra tells its own blog is live. */
export const BLOG_KIT_MARKER = "data-pentra-blog";

export type BlogKitPlan = {
  router: "app" | "pages";
  /** The site's folder in the repository ("" when the site is the repository). */
  root: string;
  /** App Router: the folder holding the site's main layout (app, src/app or a route group); Pages Router: pages or src/pages. */
  routeParent: string;
  /** Free addresses for the blog, best first. */
  segments: string[];
};
export type BlogKitPlanResult = { ok: true; plan: BlogKitPlan } | { ok: false; reason: string; detail: string };
export type BlogKitFile = { path: string; content: string };

const within = (paths: string[], dir: string) => (dir ? paths.filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)) : paths);
const LAYOUT = /^layout\.(?:js|jsx|ts|tsx)$/;
const PAGE = /^page\.(?:js|jsx|ts|tsx|mdx?)$/;
const CONFIG_FILES = ["package.json", "next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs", "next.config.mts", "vercel.json"];

function packageInfo(packageJson: string | undefined): { next: boolean; major: number | null } {
  if (!packageJson) return { next: false, major: null };
  try {
    const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const version = pkg.dependencies?.next ?? pkg.devDependencies?.next;
    if (typeof version !== "string") return { next: false, major: null };
    const major = /^[\^~>=v\s]*(\d+)/.exec(version);
    return { next: true, major: major ? Number(major[1]) : null };
  } catch {
    return { next: false, major: null };
  }
}

/** The site's folder: the framework's, else the repository when its package.json uses Next.js. */
function siteRoot(paths: string[]): string {
  return appRoot(paths) ?? "";
}

/** The files detection reads to plan the blog: package.json and the configs whose rewrites or redirects may use /blog. */
export function blogKitConfigPaths(paths: string[]): string[] {
  const root = siteRoot(paths);
  const prefixed = CONFIG_FILES.map((file) => (root ? `${root}/${file}` : file));
  return [...new Set([...prefixed, "vercel.json"])].filter((file) => paths.includes(file));
}

function segmentTaken(segment: string, rel: string[], paths: string[], configText: string): boolean {
  const s = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rel.some((p) => new RegExp(`^(?:src/)?app/(?:\\([^/]+\\)/)*${s}(?:/|$)`).test(p)) ||
    rel.some((p) => new RegExp(`^(?:src/)?pages/${s}(?:/|\\.(?:js|jsx|ts|tsx|mdx?)$)`).test(p)) ||
    rel.some((p) => new RegExp(`^public/${s}(?:/|\\.html?$)`).test(p)) ||
    // Markdown someone else keeps where Pentra would publish (content/<segment>, from the repository's root).
    paths.some((p) => new RegExp(`^content/${s}/[^/]+\\.(?:md|mdx|markdown)$`, "i").test(p)) ||
    // A rewrite or redirect for the address (an existing blog served from elsewhere).
    new RegExp(`["'\`]/${s}(?:["'\`/:?*(]|$)`, "m").test(configText);
}

/** Can Pentra add a blog to this repository, and where. `files` holds the texts of blogKitConfigPaths. */
export function planBlogKit(paths: string[], files: Record<string, string>): BlogKitPlanResult {
  const root = siteRoot(paths);
  const rel = within(paths, root);
  const prefix = root ? `${root}/` : "";
  const pkg = packageInfo(files[`${prefix}package.json`]);
  const framework = detectFramework(rel);
  if (framework !== "nextjs" && !(framework === null && pkg.next)) {
    return { ok: false, reason: "not_nextjs", detail: "Pentra can add a blog to Next.js sites, and this repository isn't one." };
  }
  if (pkg.major !== null && pkg.major < 13) {
    return { ok: false, reason: "next_too_old", detail: "This site uses Next.js 12 or older. Pentra's blog needs Next.js 13 or newer." };
  }
  // As in Next.js: an app or pages folder at the site's root wins over src/.
  const atRoot = rel.some((p) => p.startsWith("app/") || p.startsWith("pages/"));
  const appBase = atRoot ? (rel.some((p) => p.startsWith("app/")) ? "app" : null) : (rel.some((p) => p.startsWith("src/app/")) ? "src/app" : null);
  const pagesBase = atRoot ? (rel.some((p) => p.startsWith("pages/")) ? "pages" : null) : (rel.some((p) => p.startsWith("src/pages/")) ? "src/pages" : null);
  let router: BlogKitPlan["router"] | null = null, routeParent = "";
  if (appBase) {
    const inBase = within(rel, appBase);
    if (inBase.some((p) => LAYOUT.test(p))) {
      router = "app"; routeParent = appBase;
    } else {
      // Several main layouts in route groups ("(marketing)", "(app)"): the blog joins the group that holds the home page.
      const groups = [...new Set(inBase.map((p) => /^(\([^/]+\))\/layout\.(?:js|jsx|ts|tsx)$/.exec(p)?.[1]).filter((g): g is string => Boolean(g)))].sort();
      const home = groups.find((g) => inBase.some((p) => p.startsWith(`${g}/`) && PAGE.test(p.slice(g.length + 1))));
      const group = home ?? groups[0];
      if (group) { router = "app"; routeParent = `${appBase}/${group}`; }
    }
  }
  if (!router && pagesBase) { router = "pages"; routeParent = pagesBase; }
  if (!router) {
    return { ok: false, reason: "no_layout", detail: "Pentra couldn't find your site's main layout (app/layout or a pages folder), so it can't add a blog that matches your pages." };
  }
  if (router === "pages" && paths.some((p) => p.startsWith(`${prefix}${routeParent.startsWith("src/") ? "src/" : ""}pentra-blog/`))) {
    return { ok: false, reason: "path_taken", detail: "Your repository already has a pentra-blog folder." };
  }
  const configText = Object.entries(files).filter(([p]) => !p.endsWith("package.json")).map(([, text]) => text).join("\n");
  const segments = BLOG_KIT_SEGMENTS.filter((segment) => !segmentTaken(segment, rel, paths, configText));
  if (!segments.length) {
    return { ok: false, reason: "path_taken", detail: "Your site already uses /blog, /articles, /resources, /guides and /insights." };
  }
  return { ok: true, plan: { router, root, routeParent, segments } };
}

export type BlogKitSite = { name: string; origin: string; language?: string };

/** The files of the blog, with their paths from the repository's root. */
export function blogKitFiles(plan: BlogKitPlan, segment: string, site: BlogKitSite): BlogKitFile[] {
  if (!plan.segments.includes(segment)) throw new Error("The blog's address isn't free in this repository");
  const prefix = plan.root ? `${plan.root}/` : "";
  const settings = {
    name: site.name,
    origin: site.origin.replace(/\/+$/, ""),
    path: `/${segment}`,
    contentDir: `content/${segment}`,
    repoRoot: plan.root ? plan.root.split("/").map(() => "..").join("/") : ".",
    language: (site.language || "en").trim() || "en",
  };
  // Next.js bundles only the folder named in full (a computed path would bundle the whole project into the server).
  const folderParts = [...settings.repoRoot.split("/").filter((part) => part && part !== "."), "content", segment];
  const folderLine = `path.join(process.cwd(), ${folderParts.map((part) => JSON.stringify(part)).join(", ")}); // pentra:folder`;
  const postsFile = BLOG_KIT_SOURCES["posts.js"].replace(/path\.join\(process\.cwd\(\)[^;\n]*\); \/\/ pentra:folder/, () => folderLine);
  if (!postsFile.includes(folderLine)) throw new Error("The blog kit's posts folder could not be set");
  const siteFile = BLOG_KIT_SOURCES["site.js"].replace(/\/\* pentra:site \*\/[\s\S]*?\/\* pentra:end \*\//,
    () => `/* pentra:site */ ${JSON.stringify(settings, null, 2)} /* pentra:end */`);
  if (plan.router === "app") {
    const dir = `${prefix}${plan.routeParent}/${segment}`;
    return [
      { path: `${dir}/page.js`, content: BLOG_KIT_SOURCES["app-index.js"] },
      { path: `${dir}/[slug]/page.js`, content: BLOG_KIT_SOURCES["app-post.js"] },
      { path: `${dir}/sitemap.js`, content: BLOG_KIT_SOURCES["app-sitemap.js"] },
      { path: `${dir}/_pentra/site.js`, content: siteFile },
      { path: `${dir}/_pentra/posts.js`, content: postsFile },
      { path: `${dir}/_pentra/markdown.js`, content: BLOG_KIT_SOURCES["markdown.js"] },
    ];
  }
  const pagesDir = `${prefix}${plan.routeParent}/${segment}`;
  const lib = `${prefix}${plan.routeParent.startsWith("src/") ? "src/" : ""}pentra-blog`;
  const page = (name: string) => BLOG_KIT_SOURCES[name].replace(/__PENTRA_LIB__/g, "../../pentra-blog");
  return [
    { path: `${pagesDir}/index.js`, content: page("pages-index.js") },
    { path: `${pagesDir}/[slug].js`, content: page("pages-post.js") },
    { path: `${lib}/site.js`, content: siteFile },
    { path: `${lib}/posts.js`, content: postsFile },
    { path: `${lib}/markdown.js`, content: BLOG_KIT_SOURCES["markdown.js"] },
  ];
}

/** The blog's own sitemap (App Router only), to submit to Search Console. */
export function blogKitSitemapPath(router: BlogKitPlan["router"], segment: string): string | null {
  return router === "app" ? `/${segment}/sitemap.xml` : null;
}

/** Pentra's blog, when the repository already has it: its router and address. */
export function installedBlogKit(paths: string[]): { router: BlogKitPlan["router"]; segment: string } | null {
  for (const p of paths) {
    const app = /(?:^|\/)([^/]+)\/_pentra\/posts\.js$/.exec(p);
    if (app && paths.some((q) => q === p.replace(/_pentra\/posts\.js$/, "[slug]/page.js"))) return { router: "app", segment: app[1] };
  }
  if (paths.some((p) => /(?:^|\/)pentra-blog\/posts\.js$/.test(p))) {
    const page = paths.map((p) => /(?:^|\/)pages\/([^/]+)\/\[slug\]\.js$/.exec(p)).find((m) => m);
    if (page) return { router: "pages", segment: page[1] };
  }
  return null;
}
