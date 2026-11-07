/** P257 (Oct 30 2026): what Pentra read about the blog in the site's current GitHub repository. Cowork's fresh account
 * picked a Contentful template first, then its Jekyll blog: the dashboard kept "Your blog's posts come from Contentful",
 * Settings said articles go to content/blog (the check had not run for the new repository), and Start did nothing. A
 * result read from another repository is never shown or used. */
export type GithubBlogKitRecord = { repo: string; state: "installing" | "deploying" | "live" | "not_live" | "failed"; requestedAt: number;
  segment?: string; commitSha?: string; detail?: string };
export type GithubBlogSite = { publishMethod?: string; repoOwner?: string; repoName?: string; githubLayout?: unknown;
  githubLayoutFailure?: { reason: string; detail: string; at: number; repo?: string }; githubBlogKit?: GithubBlogKitRecord };

/** P377: the blog Pentra added (or is adding) to the site, as the dashboard shows it. */
export type GithubBlogKitView = { state: GithubBlogKitRecord["state"]; segment: string | null; commit: string | null; detail: string | null };

export function currentGithubBlog(site: GithubBlogSite): { layout: { framework: string; postsDir: string } | null;
  failure: { reason: string; detail: string } | null; kit?: GithubBlogKitView } {
  const repo = site.publishMethod === "github" && site.repoOwner && site.repoName ? `${site.repoOwner}/${site.repoName}` : null;
  if (!repo) return { layout: null, failure: null };
  const layout = site.githubLayout as { framework?: unknown; postsDir?: unknown; repo?: string } | undefined;
  const failure = site.githubLayoutFailure;
  const kit = site.githubBlogKit?.repo === repo ? site.githubBlogKit : undefined;
  return {
    layout: layout && (layout.repo ?? repo) === repo ? { framework: String(layout.framework ?? ""), postsDir: String(layout.postsDir ?? "") } : null,
    // A failure recorded before P257 names no repository: it stands until the next check, which now always runs.
    failure: failure && (failure.repo ?? repo) === repo ? { reason: failure.reason, detail: failure.detail } : null,
    ...(kit ? { kit: { state: kit.state, segment: kit.segment ?? null, commit: kit.commitSha ? kit.commitSha.slice(0, 7) : null, detail: kit.detail ?? null } } : {}),
  };
}

/** What Settings says about where articles go in the repository. */
export type GithubBlogNote = { state: "detected"; postsDir: string } | { state: "failed"; reason: string; detail: string; kit?: GithubBlogKitView }
  | { state: "unchecked" } | { state: "existing" } | { state: "kit"; kit: GithubBlogKitView };
export function githubBlogNote(site: GithubBlogSite, hasPublished: boolean): GithubBlogNote | null {
  if (site.publishMethod !== "github" || !site.repoOwner || !site.repoName) return null;
  const { layout, failure, kit } = currentGithubBlog(site);
  if (layout?.postsDir) return { state: "detected", postsDir: layout.postsDir };
  if (failure) return { state: "failed", ...failure, ...(kit ? { kit } : {}) };
  if (kit) return { state: "kit", kit };
  // A site that already publishes keeps the folder it publishes to (pentra.dev and LeadPilot: content/blog).
  return hasPublished ? { state: "existing" } : { state: "unchecked" };
}
