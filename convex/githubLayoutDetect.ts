import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { detectGithubLayout, layoutConfigPaths, layoutSamplePaths, urlStructureCandidates, type GithubLayout } from "./lib/githubLayout";

/** P243 (Oct 30 2026): after a site's GitHub repository is verified, read the repository once and record where its own
 * blog keeps posts (convex/lib/githubLayout.ts), so articles land where the site shows them. A site that has published
 * articles keeps its layout as it is (pentra.dev and LeadPilot never change); a failure is recorded with a plain reason
 * and the setup screen offers review and paste. Read-only towards GitHub and the website. */
export const layoutContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  const published = await ctx.db.query("article_summaries").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published")).take(1);
  const layout = site.githubLayout as (GithubLayout & { repo?: string }) | undefined;
  return { hasPublished: published.length > 0, domain: site.domain, repo: site.repoOwner && site.repoName ? `${site.repoOwner}/${site.repoName}` : null,
    branch: site.repoDefaultBranch ?? null, publishMethod: site.publishMethod ?? "github", layoutRepo: layout?.repo ?? null,
    failureAt: site.githubLayoutFailure?.at ?? null };
} });

export const recordLayout = internalMutation({ args: { siteId: v.id("sites"), repo: v.string(), layout: v.optional(v.any()),
  failure: v.optional(v.object({ reason: v.string(), detail: v.string() })) }, handler: async (ctx, { siteId, repo, layout, failure }) => {
  const site = await ctx.db.get(siteId);
  if (!site || `${site.repoOwner}/${site.repoName}` !== repo) return { recorded: false };
  const published = await ctx.db.query("article_summaries").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published")).take(1);
  if (published.length) return { recorded: false };
  if (layout) {
    await ctx.db.patch(siteId, { githubLayout: { ...layout, repo }, githubLayoutFailure: undefined,
      urlStructure: (layout as GithubLayout).urlStructure, updatedAt: Date.now() });
  } else if (failure) {
    await ctx.db.patch(siteId, { githubLayout: undefined, githubLayoutFailure: { ...failure, at: Date.now() }, updatedAt: Date.now() });
  }
  return { recorded: true };
} });

const GITHUB = "https://api.github.com";
async function githubJson(token: string, path: string) {
  const res = await fetch(`${GITHUB}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}
async function githubText(token: string, owner: string, repo: string, path: string, ref: string) {
  const res = await fetch(`${GITHUB}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.text();
}
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#x27;|&#39;|&rsquo;|&lsquo;|[‘’]/g, "'").replace(/&quot;|&ldquo;|&rdquo;|[“”]/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").toLowerCase();

export const detectSiteGithubLayout = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const context = await ctx.runQuery(internal.githubLayoutDetect.layoutContext, { siteId });
  if (!context || context.hasPublished || context.publishMethod !== "github" || !context.repo || !context.branch) return { detected: false };
  if (context.layoutRepo === context.repo || (context.failureAt && Date.now() - context.failureAt < 10 * 60_000)) return { detected: false };
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  const token = site?.githubToken;
  if (!token) return { detected: false };
  const [owner, repo] = context.repo.split("/");
  const fail = (reason: string, detail: string) => ctx.runMutation(internal.githubLayoutDetect.recordLayout, { siteId, repo: context.repo!, failure: { reason, detail } });
  let paths: string[];
  try {
    const tree = await githubJson(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(context.branch)}?recursive=1`) as { tree: { path: string; type: string }[] };
    paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
  } catch {
    await fail("unreadable", "Pentra could not read the repository's files.");
    return { detected: false };
  }
  const files: Record<string, string> = {};
  // P248: package.json names a headless CMS when the blog's posts live there instead of in the repository. P252: in a
  // monorepo, the configs and posts are read in the site's own folder (apps/web, www, ...).
  for (const config of layoutConfigPaths(paths)) {
    try { files[config] = await githubText(token, owner, repo, config, context.branch); } catch { /* optional */ }
  }
  for (const post of layoutSamplePaths(paths, files)) {
    try { files[post] = await githubText(token, owner, repo, post, context.branch); } catch { /* skipped */ }
  }
  const detection = detectGithubLayout({ paths, files });
  if (!detection.ok) {
    await fail(detection.reason, detection.detail);
    return { detected: false, reason: detection.reason };
  }
  // The layout counts only when one of the site's own posts is live where the layout says posts are served. P253: when
  // the routes don't say, the usual structures are tried in turn and the one that serves the post is kept.
  const origin = `https://${context.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const sampleUrl = origin + detection.layout.urlStructure.replace("[slug]", detection.layout.sample.slug);
  let served: string | null = null;
  for (const structure of detection.layout.framework === "jekyll" ? [] : urlStructureCandidates(detection.layout)) {
    const url = origin + structure.replace("[slug]", detection.layout.sample.slug);
    for (const attempt of [url, url.endsWith("/") ? url.slice(0, -1) : `${url}/`]) {
      try {
        const res = await fetch(attempt, { redirect: "follow", headers: { "User-Agent": "Pentra/1.0 (blog layout check)" } });
        if (res.ok && visibleText(await res.text()).includes(detection.layout.sample.title.toLowerCase())) { served = structure; break; }
      } catch { /* next */ }
    }
    if (served) break;
  }
  if (!served && detection.layout.framework !== "jekyll") {
    await fail("sample_not_live", `Pentra found your posts in ${detection.layout.postsDir} but could not find "${detection.layout.sample.title}" at ${sampleUrl}.`);
    return { detected: false, reason: "sample_not_live" };
  }
  const layout = served && served !== detection.layout.urlStructure ? { ...detection.layout, urlStructure: served } : detection.layout;
  await ctx.runMutation(internal.githubLayoutDetect.recordLayout, { siteId, repo: context.repo, layout });
  return { detected: true, framework: layout.framework };
} });
