import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BLOG_KIT_MARKER, BLOG_KIT_VERSION, blogKitConfigPaths, blogKitFiles, blogKitSitemapPath, installedBlogKit, planBlogKit,
  type BlogKitPlan,
} from "./lib/blogKit.ts";
import { siteCanonicalDomain } from "./lib/siteDomainBinding";

/** P377 (Nov 6 2026): Pentra adds a blog to a Next.js site that has none (convex/lib/blogKit.ts), when the owner asks:
 * one commit of new files to the connected repository, then a check that the site deployed it. Pentra publishes into it
 * like any GitHub blog, in the format LeadPilot's blog reads. */

export const BLOG_KIT_INSTALL_STALE_MS = 10 * 60_000;
/** After the commit: when Pentra looks for the blog on the live site (about two hours in all). */
export const BLOG_KIT_LIVE_CHECK_DELAYS_MS = [60_000, 2 * 60_000, 3 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000, 60 * 60_000];

const kitState = v.union(v.literal("installing"), v.literal("deploying"), v.literal("live"), v.literal("not_live"), v.literal("failed"));
const repoOf = (site: Pick<Doc<"sites">, "publishMethod" | "repoOwner" | "repoName">) =>
  site.publishMethod === "github" && site.repoOwner && site.repoName ? `${site.repoOwner}/${site.repoName}` : null;
const hostOf = (site: Pick<Doc<"sites">, "domain" | "canonicalDomain">) =>
  siteCanonicalDomain(site) ?? site.domain.replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "").toLowerCase();

async function hasPublished(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">) {
  const summary = await ctx.db.query("article_summaries").withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "published")).first();
  return Boolean(summary);
}

async function ownSite(ctx: MutationCtx, siteId: Id<"sites">) {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject || site.deletionStatus) throw new ConvexError("Not your site");
  return site;
}

/** The owner asks Pentra to add a blog to their site ("Add a blog to my site"). */
export const requestInstall = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownSite(ctx, siteId);
  const repo = repoOf(site);
  if (!repo || !site.repoDefaultBranch) throw new ConvexError("Connect your GitHub repository first");
  if (await hasPublished(ctx, siteId)) throw new ConvexError("Your site already has Pentra articles, so its blog stays as it is");
  const kit = site.githubBlogKit?.repo === repo ? site.githubBlogKit : undefined;
  if (kit?.state === "installing" && Date.now() - kit.requestedAt < BLOG_KIT_INSTALL_STALE_MS) return { state: kit.state };
  if (kit?.state === "deploying" || kit?.state === "live") return { state: kit.state };
  const now = Date.now();
  await ctx.db.patch(siteId, { githubBlogKit: { version: BLOG_KIT_VERSION, repo, state: "installing", requestedAt: now }, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.githubBlogKit.install, { siteId });
  return { state: "installing" as const };
} });

/** The owner fixed their deploy: look for the blog again. */
export const recheckLive = mutation({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ownSite(ctx, siteId);
  const kit = site.githubBlogKit;
  if (!kit || kit.repo !== repoOf(site) || (kit.state !== "not_live" && kit.state !== "deploying")) throw new ConvexError("There's no blog from Pentra to check");
  await ctx.db.patch(siteId, { githubBlogKit: { ...kit, state: "deploying", detail: undefined }, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.githubBlogKit.checkLive, { siteId, attempt: 0 });
  return { state: "deploying" as const };
} });

export const kitContext = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.db.get(siteId);
  if (!site) return null;
  return {
    host: hostOf(site), name: site.siteName?.trim() || hostOf(site), language: site.language ?? "en",
    repo: repoOf(site), branch: site.repoDefaultBranch ?? null, kit: site.githubBlogKit ?? null,
    deleting: Boolean(site.deletionStatus), hasPublished: await hasPublished(ctx, siteId),
  };
} });

/** Records what happened to the blog. A new blog also sets where articles go (content/<segment>, /<segment>/<slug>)
 * and clears the old "no blog" note; a site that has published keeps its address. */
export const recordKit = internalMutation({ args: { siteId: v.id("sites"), repo: v.string(), state: kitState,
  segment: v.optional(v.string()), router: v.optional(v.union(v.literal("app"), v.literal("pages"))), sitemapPath: v.optional(v.string()),
  commitSha: v.optional(v.string()), detail: v.optional(v.string()) },
  handler: async (ctx, { siteId, repo, state, segment, router, sitemapPath, commitSha, detail }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus || repoOf(site) !== repo) return { recorded: false, urlChanged: false };
    const now = Date.now();
    const previous = site.githubBlogKit?.repo === repo ? site.githubBlogKit : undefined;
    const kit = {
      version: BLOG_KIT_VERSION, repo, state, requestedAt: previous?.requestedAt ?? now,
      segment: segment ?? previous?.segment, router: router ?? previous?.router, sitemapPath: sitemapPath ?? previous?.sitemapPath,
      commitSha: commitSha ?? previous?.commitSha, installedAt: state === "deploying" && segment ? now : previous?.installedAt,
      liveAt: state === "live" ? now : previous?.liveAt, checkedAt: state === "installing" ? previous?.checkedAt : now, detail,
    };
    const patch: Record<string, unknown> = { githubBlogKit: kit, updatedAt: now };
    let urlChanged = false;
    if (state === "deploying" && segment && !(await hasPublished(ctx, siteId))) {
      const urlStructure = `/${segment}/[slug]`;
      urlChanged = (site.urlStructure ?? "/blog/[slug]") !== urlStructure;
      Object.assign(patch, { urlStructure, githubLayout: undefined, githubLayoutFailure: undefined });
    }
    await ctx.db.patch(siteId, patch);
    return { recorded: true, urlChanged };
  } });

const GITHUB = "https://api.github.com";
async function github<T>(token: string, path: string, init?: { method: string; body: unknown }): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${GITHUB}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(init ? { "Content-Type": "application/json" } : {}) },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: res.ok ? await res.json() as T : null };
}
async function githubText(token: string, repo: string, path: string, ref: string): Promise<string | null> {
  const res = await fetch(`${GITHUB}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" }, signal: AbortSignal.timeout(20_000) });
  return res.ok ? res.text() : null;
}

type Probe = "free" | "ours" | "taken" | "unknown";
async function probe(url: string): Promise<Probe> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Pentra/1.0 (blog check)" }, signal: AbortSignal.timeout(10_000) });
    if (new URL(res.url || url).host.replace(/^www\./, "") !== new URL(url).host.replace(/^www\./, "")) return "taken";
    if (res.status === 404 || res.status === 410) return "free";
    if (res.status >= 200 && res.status < 300) return (await res.text()).includes(BLOG_KIT_MARKER) ? "ours" : "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** The first address the live site doesn't already serve. A site that answers every address (a catch-all page) proves
 * nothing, so then the repository's own routes decide. */
async function freeSegment(origin: string, segments: string[]): Promise<string | null> {
  if ((await probe(`${origin}/pentra-check-${Date.now().toString(36)}`)) === "taken") return segments[0] ?? null;
  for (const segment of segments) if ((await probe(`${origin}/${segment}`)) !== "taken") return segment;
  return null;
}

/** Whether the live site shows Pentra's blog at /<segment>. */
export async function blogIsLive(origin: string, segment: string): Promise<boolean> {
  for (const url of [`${origin}/${segment}`, `${origin}/${segment}/`]) if ((await probe(url)) === "ours") return true;
  return false;
}

export const install = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<{ ok: boolean; reason?: string }> => {
  const context = await ctx.runQuery(internal.githubBlogKit.kitContext, { siteId });
  if (!context || context.deleting || !context.repo || !context.branch) return { ok: false, reason: "not_connected" };
  const repo = context.repo, branch = context.branch;
  if (context.kit?.repo !== repo || context.kit.state !== "installing") return { ok: false, reason: "not_requested" };
  const fail = async (reason: string, detail: string) => {
    await ctx.runMutation(internal.githubBlogKit.recordKit, { siteId, repo, state: "failed", detail });
    return { ok: false, reason };
  };
  if (context.hasPublished) return fail("published", "Your site already has Pentra articles, so its blog stays as it is.");
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  const token = site?.githubToken;
  if (!token) return fail("no_token", "Pentra can't reach your repository. Connect GitHub again in Settings.");
  const origin = `https://${context.host}`;
  const deployed = async (router: BlogKitPlan["router"], segment: string, commitSha?: string) => {
    const recorded = await ctx.runMutation(internal.githubBlogKit.recordKit, { siteId, repo, state: "deploying", segment, router,
      sitemapPath: blogKitSitemapPath(router, segment) ?? undefined, commitSha });
    // The address is part of the verified publishing connection: verify it again for the new one.
    if (recorded.urlChanged) await ctx.scheduler.runAfter(0, internal.publisher.reverifyGithubConnectionInternal, { siteId });
    await ctx.scheduler.runAfter(BLOG_KIT_LIVE_CHECK_DELAYS_MS[0], internal.githubBlogKit.checkLive, { siteId, attempt: 0 });
    return { ok: true };
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await github<{ object?: { sha?: string } }>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const headSha = head.data?.object?.sha;
      if (!headSha) return fail("unreadable", "Pentra couldn't read your repository's main branch. Check its access in Settings.");
      const tree = await github<{ tree: { path: string; type: string }[]; truncated?: boolean }>(token, `/repos/${repo}/git/trees/${headSha}?recursive=1`);
      if (!tree.data) return fail("unreadable", "Pentra couldn't read your repository's files. Check its access in Settings.");
      if (tree.data.truncated) return fail("too_large", "Your repository is too large for Pentra to read in one go.");
      const paths = tree.data.tree.filter((t) => t.type === "blob").map((t) => t.path);
      // An earlier attempt whose answer never came back may have added the blog already: never add it twice.
      const present = installedBlogKit(paths);
      if (present) return deployed(present.router, present.segment);
      const files: Record<string, string> = {};
      for (const path of blogKitConfigPaths(paths)) {
        const text = await githubText(token, repo, path, headSha);
        if (text !== null) files[path] = text;
      }
      const planned = planBlogKit(paths, files);
      if (!planned.ok) return fail(planned.reason, planned.detail);
      const segment = await freeSegment(origin, planned.plan.segments);
      if (!segment) return fail("path_taken", `Your site already shows pages at ${planned.plan.segments.map((s) => `/${s}`).join(", ")}.`);
      const kitFiles = blogKitFiles(planned.plan, segment, { name: context.name, origin, language: context.language });
      if (kitFiles.some((file) => paths.includes(file.path))) return fail("path_taken", `Your repository already has files where the blog would go (/${segment}).`);
      const newTree = await github<{ sha: string }>(token, `/repos/${repo}/git/trees`, { method: "POST", body: {
        base_tree: headSha, tree: kitFiles.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })) } });
      if (!newTree.data?.sha) return fail("refused", "GitHub refused the new files. Check that Pentra can write to your repository in Settings.");
      const commit = await github<{ sha: string }>(token, `/repos/${repo}/git/commits`, { method: "POST", body: {
        message: `Add a blog at /${segment} for articles from Pentra\n\nPentra (https://pentra.dev) publishes articles to content/${segment}/ and this blog shows them.\nNo packages were added and no existing file was changed.`,
        tree: newTree.data.sha, parents: [headSha] } });
      if (!commit.data?.sha) return fail("refused", "GitHub refused the commit. Check that Pentra can write to your repository in Settings.");
      const moved = await github<unknown>(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: { sha: commit.data.sha, force: false } });
      if (moved.status === 422 && attempt === 0) continue; // the branch moved meanwhile: plan again on its new head
      if (moved.status < 200 || moved.status >= 300) {
        return fail("refused", `GitHub refused the commit to ${branch}. If the branch is protected, allow Pentra to push to it, then try again.`);
      }
      return deployed(planned.plan.router, segment, commit.data.sha);
    }
    return fail("busy", "Your repository changed while Pentra was adding the blog. Try again.");
  } catch {
    return fail("error", "Pentra couldn't finish adding the blog. Try again: Pentra checks first, so it never adds the blog twice.");
  }
} });

export const checkLive = internalAction({ args: { siteId: v.id("sites"), attempt: v.number() }, handler: async (ctx, { siteId, attempt }): Promise<{ live: boolean }> => {
  const context = await ctx.runQuery(internal.githubBlogKit.kitContext, { siteId });
  const kit = context?.kit;
  if (!context || !kit || kit.state !== "deploying" || kit.repo !== context.repo || !kit.segment) return { live: false };
  if (await blogIsLive(`https://${context.host}`, kit.segment)) {
    await ctx.runMutation(internal.githubBlogKit.recordKit, { siteId, repo: kit.repo, state: "live" });
    return { live: true };
  }
  const next = attempt + 1;
  if (next < BLOG_KIT_LIVE_CHECK_DELAYS_MS.length) {
    await ctx.scheduler.runAfter(BLOG_KIT_LIVE_CHECK_DELAYS_MS[next], internal.githubBlogKit.checkLive, { siteId, attempt: next });
    return { live: false };
  }
  await ctx.runMutation(internal.githubBlogKit.recordKit, { siteId, repo: kit.repo, state: "not_live",
    detail: `Pentra added the blog to ${kit.repo}, but ${context.host}/${kit.segment} doesn't show it yet. Check that ${context.branch ?? "the main branch"} deploys to your site and that /${kit.segment} doesn't ask visitors to sign in, then check again.` });
  return { live: false };
} });

/** Detection found Pentra's blog in the repository (a reconnection, or a commit whose answer was lost). */
export const notePresent = internalMutation({ args: { siteId: v.id("sites"), repo: v.string(), segment: v.string(), router: v.union(v.literal("app"), v.literal("pages")) },
  handler: async (ctx, { siteId, repo, segment, router }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus || repoOf(site) !== repo) return { recorded: false };
    const kit = site.githubBlogKit?.repo === repo ? site.githubBlogKit : undefined;
    if (kit && kit.state !== "installing" && kit.state !== "failed") {
      if (site.githubLayoutFailure) await ctx.db.patch(siteId, { githubLayoutFailure: undefined, updatedAt: Date.now() });
      return { recorded: false };
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { githubLayoutFailure: undefined, githubLayout: undefined, updatedAt: now,
      githubBlogKit: { version: BLOG_KIT_VERSION, repo, state: "deploying" as const, requestedAt: kit?.requestedAt ?? now, segment, router,
        sitemapPath: blogKitSitemapPath(router, segment) ?? undefined, installedAt: now, checkedAt: now } };
    const urlStructure = `/${segment}/[slug]`;
    const urlChanged = !(await hasPublished(ctx, siteId)) && (site.urlStructure ?? "/blog/[slug]") !== urlStructure;
    if (urlChanged) patch.urlStructure = urlStructure;
    await ctx.db.patch(siteId, patch);
    // The address is part of the verified publishing connection: verify it again for the new one.
    if (urlChanged) await ctx.scheduler.runAfter(0, internal.publisher.reverifyGithubConnectionInternal, { siteId });
    await ctx.scheduler.runAfter(0, internal.githubBlogKit.checkLive, { siteId, attempt: 0 });
    return { recorded: true };
  } });
