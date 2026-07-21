"use node";

import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createHmac, randomUUID } from "crypto";
import {
  containsExecutableMdx,
  evaluatePublicationQuality,
  normalizeSiteOrigin,
  type PublicationQualityMode,
} from "./lib/articleQuality";
import { stripLeadingDocumentTitle } from "./lib/markdownPublishing";
import {
  PUBLICATION_AUDIT_VERSION,
  classifyPentraMarkdownDestination,
  publicationArtifactHash,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryKey,
  safeGitHubRepositoryPart,
  type PublicationDeliveryConfig,
} from "./lib/publicationArtifact";

type FileContent = {
  path: string;
  content: string;
};

type ArticleRecord = {
  _id: Id<"articles">;
  title: string;
  slug: string;
  markdown: string;
  metaTitle?: string;
  metaDescription?: string;
  language?: string;
  featuredImage?: string;
  readingTime?: number;
  wordCount?: number;
  factCheckScore?: number;
  contentScore?: number;
  editorialQualityScore?: number;
  editorialQualityNotes?: string[];
  mediaQualityStatus?: string;
  mediaQualityNotes?: string[];
  productEvidenceStatus?: string;
  claimEvidenceStatus?: string;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
  publicationConfigHash?: string;
  publicationConfigSnapshot?: PublicationDeliveryConfig;
  articleType?: string;
  status: string;
  createdAt: number;
  publicationDate?: number;
  sources?: { url: string; title?: string; excerpt?: string; contentHash?: string; capturedAt?: number }[];
  internalLinks?: { anchor: string; href: string }[];
};

type SiteRecord = {
  _id: Id<"sites">;
  domain: string;
  publishMethod?: string;
  approvalRequired?: boolean;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  githubToken?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandFontFamily?: string;
  urlStructure?: string;
  contentDir?: string;
  autopilotEnabled?: boolean;
  autopilotRolloutMode?: string;
  autopilotRolloutEpoch?: number;
};

// ── Shared Utilities ────────────────────────────────────

/**
 * Build the canonical Pentra MDX contract consumed by GitHub-backed sites.
 */
function assertSafePublishableMarkdown(markdown: string): void {
  if (containsExecutableMdx(markdown)) {
    throw new Error("Raw HTML and executable MDX are disabled in publication content");
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      throw new Error("Article images must use absolute HTTPS URLs");
    }
    if (url.protocol !== "https:") {
      throw new Error("Article images must use absolute HTTPS URLs");
    }
  }
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1];
    if (target.startsWith("/")) continue;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new Error("Article links must be relative paths or absolute HTTPS URLs");
    }
    if (url.protocol !== "https:") {
      throw new Error("Article links must be relative paths or absolute HTTPS URLs");
    }
  }
}

function buildMdx(
  article: ArticleRecord,
  site: SiteRecord,
  publicationDate: number,
  deliveryKey: string,
): string {
  assertSafePublishableMarkdown(article.markdown);
  const slug = article.slug.replace(/^\//, "");
  const origin = normalizeSiteOrigin(site.domain);
  const pathTemplate = site.urlStructure || "/blog/[slug]";
  const canonicalPath = pathTemplate.includes("[")
    ? pathTemplate.replace(/\[[^\]]+\]/, slug)
    : `${pathTemplate.replace(/\/$/, "")}/${slug}`;
  const canonicalUrl = `${origin}${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}`;
  const yamlString = (value: string) => JSON.stringify(value);
  const body = stripLeadingDocumentTitle(article.markdown, article.title);

  const frontmatter = [
    "---",
    `title: ${yamlString(article.title)}`,
    article.metaTitle ? `metaTitle: ${yamlString(article.metaTitle)}` : undefined,
    article.metaDescription
      ? `description: ${yamlString(article.metaDescription)}`
      : undefined,
    `generator: "pentra"`,
    `pentraDeliveryKey: ${yamlString(deliveryKey)}`,
    `status: "published"`,
    `qualityGateVersion: ${PUBLICATION_AUDIT_VERSION}`,
    article.auditedContentHash
      ? `auditedContentHash: ${yamlString(article.auditedContentHash)}`
      : undefined,
    `canonicalUrl: ${yamlString(canonicalUrl)}`,
    article.featuredImage ? `featuredImage: ${yamlString(article.featuredImage)}` : undefined,
    article.readingTime ? `readingTime: ${article.readingTime}` : undefined,
    article.wordCount ? `wordCount: ${article.wordCount}` : undefined,
    article.factCheckScore !== undefined
      ? `factCheckScore: ${article.factCheckScore}`
      : undefined,
    article.contentScore !== undefined
      ? `contentScore: ${article.contentScore}`
      : undefined,
    article.editorialQualityScore !== undefined
      ? `editorialQualityScore: ${article.editorialQualityScore}`
      : undefined,
    article.mediaQualityStatus
      ? `mediaQualityStatus: ${yamlString(article.mediaQualityStatus)}`
      : undefined,
    article.language ? `language: ${yamlString(article.language)}` : undefined,
    `date: "${new Date(publicationDate).toISOString()}"`,
    article.sources && article.sources.length
      ? `sources:\n${article.sources
          .map(
            (s) =>
              `  - url: ${yamlString(s.url)}${s.title ? `\n    title: ${yamlString(s.title)}` : ""}`,
          )
          .join("\n")}`
      : undefined,
    article.internalLinks && article.internalLinks.length
      ? `internalLinks:\n${article.internalLinks
          .map((l) => `  - anchor: ${yamlString(l.anchor)}\n    href: ${yamlString(l.href)}`)
          .join("\n")}`
      : undefined,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  return `${frontmatter}\n\n${body}\n`;
}

type BrandStyle = {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
};

/**
 * Convert markdown to styled HTML for WordPress/Webhook.
 * Injects brand colors as inline styles when available.
 */
function markdownToHtml(md: string, brand?: BrandStyle): string {
  let html = md;

  const primary = brand?.primaryColor || "#0EA5E9";
  const accent = brand?.accentColor || "#22D3EE";
  const font = brand?.fontFamily || "system-ui, -apple-system, sans-serif";

  // Images (before headings to avoid conflicts)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:8px;margin:1.5em 0">');

  // Headings (must come before bold processing)
  html = html.replace(/^######\s+(.+)$/gm, `<h6 style="font-family:${font};color:${primary};margin:1em 0 0.5em">$1</h6>`);
  html = html.replace(/^#####\s+(.+)$/gm, `<h5 style="font-family:${font};color:${primary};margin:1em 0 0.5em">$1</h5>`);
  html = html.replace(/^####\s+(.+)$/gm, `<h4 style="font-family:${font};color:${primary};margin:1.2em 0 0.5em">$1</h4>`);
  html = html.replace(/^###\s+(.+)$/gm, `<h3 style="font-family:${font};font-size:1.15em;margin:1.5em 0 0.5em">$1</h3>`);
  html = html.replace(/^##\s+(.+)$/gm, `<h2 style="font-family:${font};color:${primary};font-size:1.4em;margin:1.8em 0 0.6em;padding-bottom:0.3em;border-bottom:2px solid ${primary}20">$1</h2>`);
  html = html.replace(/^#\s+(.+)$/gm, `<h1 style="font-family:${font};color:${primary};font-size:1.8em;margin:0 0 0.8em">$1</h1>`);

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links — styled with brand accent color
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${accent};text-decoration:underline">$1</a>`);

  // Blockquotes — styled with brand primary border
  html = html.replace(/^>\s+(.+)$/gm, `<blockquote style="border-left:4px solid ${primary};padding:0.5em 1em;margin:1em 0;color:#555;background:#f9f9f9">$1</blockquote>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:0.15em 0.4em;border-radius:4px;font-size:0.9em">$1</code>');

  // Horizontal rules
  html = html.replace(/^---$/gm, `<hr style="border:none;border-top:2px solid ${primary}20;margin:2em 0">`);

  // Unordered lists (simple — handles single-level)
  html = html.replace(
    /(?:^[-*]\s+.+\n?)+/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => `<li style="margin:0.3em 0">${line.replace(/^[-*]\s+/, "")}</li>`)
        .join("\n");
      return `<ul style="padding-left:1.5em;margin:1em 0">\n${items}\n</ul>\n`;
    },
  );

  // Ordered lists
  html = html.replace(
    /(?:^\d+\.\s+.+\n?)+/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => `<li style="margin:0.3em 0">${line.replace(/^\d+\.\s+/, "")}</li>`)
        .join("\n");
      return `<ol style="padding-left:1.5em;margin:1em 0">\n${items}\n</ol>\n`;
    },
  );

  // Paragraphs — wrap remaining lines that aren't already tags
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<[a-z]/.test(trimmed)) return trimmed;
      return `<p style="font-family:${font};line-height:1.7;margin:1em 0;color:#1a1a1a">${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n\n");

  return html;
}


// ── GitHub Adapter ──────────────────────────────────────

/** Detect the default branch of a GitHub repo (handles main, master, or empty repos). */
async function getDefaultBranch({
  token,
  owner,
  repo,
}: {
  token: string;
  owner: string;
  repo: string;
}): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub repo not found: ${owner}/${repo} (${res.statusText})`);
  const data = await res.json();
  const branch = data.default_branch;
  if (
    typeof branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) ||
    branch.includes("..") ||
    branch.endsWith("/")
  ) {
    throw new Error("GitHub returned an unsafe default branch name");
  }
  return branch;
}

/**
 * Re-verify an existing GitHub publication destination without returning or
 * replacing its stored credential. This is internal-only so rollout operators
 * can seal the repository's current default branch after a security upgrade;
 * ordinary tenants must still use the authenticated OAuth connection flow.
 */
export const reverifyGithubConnectionInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = (await ctx.runQuery(internal.sites.getFull, {
      siteId,
    })) as SiteRecord | null;
    if (!site) throw new Error("Site not found");
    if (site.publishMethod !== "github") {
      throw new Error("Site is not configured for GitHub publication");
    }
    if (!site.githubToken) {
      throw new Error("GitHub must be connected before it can be re-verified");
    }

    const repoOwner = safeGitHubRepositoryPart(site.repoOwner, "owner");
    const repoName = safeGitHubRepositoryPart(
      site.repoName,
      "repository name",
    );
    if (!repoOwner || !repoName) {
      throw new Error("GitHub owner and repository are required");
    }

    const repoDefaultBranch = await getDefaultBranch({
      token: site.githubToken,
      owner: repoOwner,
      repo: repoName,
    });
    await ctx.runMutation(internal.sites.setGithubTokenInternal, {
      siteId,
      githubToken: site.githubToken,
      repoOwner,
      repoName,
      repoDefaultBranch,
    });
    return { ok: true, repoDefaultBranch };
  },
});

async function commitToMain({
  token,
  owner,
  repo,
  branch,
  message,
  file,
  deliveryKey,
}: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  file: FileContent;
  deliveryKey: string;
}): Promise<{ commitUrl: string; sha: string }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Check if the branch exists (non-empty repo)
  const branchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers },
  );

  // Empty repo (409) or branch not found (404) → use Contents API (handles empty repos natively).
  if (!branchRes.ok) {
    if (branchRes.status !== 404 && branchRes.status !== 409) {
      throw new Error(
        `Failed to read sealed GitHub branch: ${branchRes.statusText}`,
      );
    }
    const destination = await inspectGitHubDestination({
      token,
      owner,
      repo,
      ref: branch,
      file,
      deliveryKey,
    });
    if (destination.disposition === "idempotent") {
      return confirmIdempotentDeliveryAtCurrentHead({
        token,
        owner,
        repo,
        branch,
        file,
        deliveryKey,
      });
    }
    return commitViaContentsApi({
      owner,
      repo,
      branch,
      message,
      file,
      fileSha: destination.fileSha,
      headers,
    });
  }

  // Non-empty repo → use Git Data API for atomic multi-file commits
  const branchData = await branchRes.json();
  const baseSha = branchData?.object?.sha;
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40,64}$/i.test(baseSha)) {
    throw new Error("GitHub returned an invalid sealed branch head");
  }

  // Read the path from the exact base commit used below. If the branch moves
  // after this check, the non-force ref update fails rather than clobbering it.
  const destination = await inspectGitHubDestination({
    token,
    owner,
    repo,
    ref: baseSha,
    file,
    deliveryKey,
  });
  if (destination.disposition === "idempotent") {
    return confirmIdempotentDeliveryAtCurrentHead({
      token,
      owner,
      repo,
      branch,
      file,
      deliveryKey,
    });
  }

  const blobRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: Buffer.from(file.content).toString("base64"),
        encoding: "base64",
      }),
    },
  );
  if (!blobRes.ok)
    throw new Error(`Failed to create blob: ${blobRes.statusText}`);
  const blob = await blobRes.json();
  if (typeof blob?.sha !== "string") {
    throw new Error("GitHub did not return a blob SHA");
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: baseSha,
        tree: [{
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        }],
      }),
    },
  );
  if (!treeRes.ok)
    throw new Error(`Failed to create tree: ${treeRes.statusText}`);
  const tree = await treeRes.json();

  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [baseSha],
      }),
    },
  );
  if (!commitRes.ok)
    throw new Error(`Failed to create commit: ${commitRes.statusText}`);
  const commit = await commitRes.json();

  const updateRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );
  if (!updateRefRes.ok)
    throw new Error(`Failed to update branch: ${updateRefRes.statusText}`);

  return {
    commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    sha: commit.sha,
  };
}

async function inspectGitHubDestination({
  token,
  owner,
  repo,
  ref,
  file,
  deliveryKey,
}: {
  token: string;
  owner: string;
  repo: string;
  ref: string;
  file: FileContent;
  deliveryKey: string;
}): Promise<{
  disposition: "create" | "overwrite" | "idempotent";
  fileSha?: string;
  htmlUrl: string;
}> {
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  const fallbackUrl = `https://github.com/${owner}/${repo}`;
  if (res.status === 404) {
    return { disposition: "create", htmlUrl: fallbackUrl };
  }
  if (!res.ok) {
    throw new Error(
      `Failed to verify the existing GitHub destination: ${res.statusText}`,
    );
  }

  const existing = await res.json();
  if (
    existing?.type !== "file" ||
    typeof existing.sha !== "string" ||
    existing.encoding !== "base64" ||
    typeof existing.content !== "string"
  ) {
    throw new Error(
      "Existing GitHub destination could not be verified as a regular file",
    );
  }
  const existingContent = Buffer.from(
    existing.content.replace(/\s/g, ""),
    "base64",
  ).toString("utf8");
  const disposition = classifyPentraMarkdownDestination({
    existingContent,
    nextContent: file.content,
    deliveryKey,
  });
  const htmlUrl =
    typeof existing.html_url === "string" &&
    existing.html_url.startsWith("https://github.com/")
      ? existing.html_url
      : fallbackUrl;
  return { disposition, fileSha: existing.sha, htmlUrl };
}

async function readGitHubBranchHead({
  token,
  owner,
  repo,
  branch,
}: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to confirm the current sealed GitHub branch: ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const sha = payload?.object?.sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40,64}$/i.test(sha)) {
    throw new Error("GitHub returned an invalid current branch head");
  }
  return sha;
}

/** A historical commit is insufficient proof of a lost-ack delivery. Read the
 * current branch, verify the exact file/key/bytes there, then compare-and-check
 * the ref again so a concurrent branch move cannot be acknowledged as success. */
async function confirmIdempotentDeliveryAtCurrentHead(args: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  file: FileContent;
  deliveryKey: string;
}): Promise<{ commitUrl: string; sha: string }> {
  const beforeSha = await readGitHubBranchHead(args);
  const destination = await inspectGitHubDestination({
    ...args,
    ref: beforeSha,
  });
  if (destination.disposition !== "idempotent") {
    throw new Error(
      "Sealed delivery is not present at the current GitHub branch head",
    );
  }
  const afterSha = await readGitHubBranchHead(args);
  if (afterSha !== beforeSha) {
    throw new Error(
      "GitHub branch changed while confirming an idempotent delivery",
    );
  }
  return { commitUrl: destination.htmlUrl, sha: beforeSha };
}

/** Fallback for empty repos — Contents API handles first-commit scenarios natively. */
async function commitViaContentsApi({
  owner,
  repo,
  branch,
  message,
  file,
  fileSha,
  headers,
}: {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  file: FileContent;
  fileSha?: string;
  headers: Record<string, string>;
}): Promise<{ commitUrl: string; sha: string }> {
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message,
        content: Buffer.from(file.content).toString("base64"),
        branch,
        ...(fileSha ? { sha: fileSha } : {}),
      }),
    },
  );
  if (!putRes.ok) {
    const errBody = await putRes.text();
    throw new Error(
      `Failed to commit ${file.path}: ${putRes.statusText} — ${errBody}`,
    );
  }
  const result = await putRes.json();
  return {
    commitUrl:
      result.commit?.html_url ?? `https://github.com/${owner}/${repo}`,
    sha: result.commit?.sha ?? "",
  };
}

async function publishToGitHub(
  site: SiteRecord,
  article: ArticleRecord,
  publicationDate: number,
  deliveryKey: string,
): Promise<{ method: "github"; commitUrl: string; filePath: string }> {
  const token = site.githubToken;
  if (!token) throw new Error("GitHub token not configured. Go to Settings → Publishing to add your GitHub personal access token.");

  const repoOwner = site.repoOwner;
  const repoName = site.repoName;
  if (!repoOwner || !repoName) throw new Error("GitHub repository not configured. Go to Settings → Publishing to set your repo owner and name.");

  const sealedDefaultBranch = site.repoDefaultBranch;
  if (!sealedDefaultBranch) {
    throw new Error("GitHub default branch was not sealed by the quality audit");
  }
  const actualDefaultBranch = await getDefaultBranch({
    token,
    owner: repoOwner,
    repo: repoName,
  });
  if (actualDefaultBranch !== sealedDefaultBranch) {
    throw new Error(
      "GitHub default branch changed after the publication destination was sealed",
    );
  }
  // Derive contentDir from site urlStructure (e.g. "/blog/[slug]" -> "content/blog")
  const contentDir = site.contentDir;
  if (!contentDir || !/^content\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(contentDir)) {
    throw new Error("Sealed GitHub content directory is missing or unsafe");
  }

  const slug = article.slug.replace(/^\//, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Article slug is unsafe for a GitHub content path");
  }
  // Use a plain Markdown extension so the destination build cannot interpret
  // article prose as executable MDX even if its content loader supports MDX.
  const filePath = `${contentDir}/${slug}.md`;
  if (!filePath.startsWith(`${contentDir}/`) || filePath.includes("..")) {
    throw new Error("Refusing to write outside the sealed content directory");
  }
  const mdx = buildMdx(article, site, publicationDate, deliveryKey);

  const { commitUrl } = await commitToMain({
    token,
    owner: repoOwner,
    repo: repoName,
    branch: sealedDefaultBranch,
    message: `Pentra publish ${deliveryKey}: ${article.title}`,
    file: { path: filePath, content: mdx },
    deliveryKey,
  });

  return { method: "github", commitUrl, filePath };
}

// ── WordPress Adapter ───────────────────────────────────

async function publishToWordPress(
  site: SiteRecord,
  article: ArticleRecord,
  deliveryKey: string,
): Promise<{ method: "wordpress"; postUrl: string; postId: number }> {
  throw new Error(
    "WordPress publication is disabled until the sanitized renderer completes security review",
  );
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
    throw new Error("WordPress credentials not configured (wpUrl, wpUsername, wpAppPassword)");
  }

  const wpApiUrl = site.wpUrl!.replace(/\/+$/, "");
  const credentials = Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64");
  const brand: BrandStyle = {
    primaryColor: site.brandPrimaryColor,
    accentColor: site.brandAccentColor,
    fontFamily: site.brandFontFamily,
  };
  const htmlContent = markdownToHtml(article.markdown, brand);
  const slug = article.slug.replace(/^\//, "").replace(/\//g, "-");

  // Resolve by the stable slug before writing.  Retrying after a lost Convex
  // acknowledgement updates the same post instead of creating a duplicate.
  const lookup = await fetch(
    `${wpApiUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=any&context=edit&per_page=1`,
    { headers: { Authorization: `Basic ${credentials}` } },
  );
  if (!lookup.ok) {
    throw new Error(`WordPress idempotency lookup failed (${lookup.status})`);
  }
  const matches = (await lookup.json()) as Array<{ id: number }>;
  const existingPostId = matches[0]?.id;
  const endpoint = existingPostId
    ? `${wpApiUrl}/wp-json/wp/v2/posts/${existingPostId}`
    : `${wpApiUrl}/wp-json/wp/v2/posts`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: article.title,
      content: htmlContent,
      slug,
      status: "publish",
      excerpt: article.metaDescription ?? "",
      meta: { pentra_delivery_key: deliveryKey },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const post = await res.json();

  return {
    method: "wordpress",
    postUrl: post.link ?? `${wpApiUrl}/?p=${post.id}`,
    postId: post.id,
  };
}

// ── Webhook Adapter ─────────────────────────────────────

async function publishToWebhook(
  site: SiteRecord,
  article: ArticleRecord,
  deliveryKey: string,
): Promise<{ method: "webhook"; status: number; response: string }> {
  throw new Error(
    "Webhook publication is disabled until the sanitized renderer completes security review",
  );
  if (!site.webhookUrl) {
    throw new Error("Webhook URL not configured");
  }

  const rawSlug = article.slug.replace(/^\//, "");
  // Build full URL path from urlStructure (e.g. "/blog/[slug]" -> "/blog/my-article")
  const urlPath = site.urlStructure
    ? site.urlStructure!.replace(/\[slug\]/i, rawSlug)
    : "/blog/" + rawSlug;

  const payload = JSON.stringify({
    title: article.title,
    slug: rawSlug,
    urlPath,
    urlStructure: site.urlStructure ?? "/blog/[slug]",
    markdown: article.markdown,
    html: markdownToHtml(article.markdown, {
      primaryColor: site.brandPrimaryColor,
      accentColor: site.brandAccentColor,
      fontFamily: site.brandFontFamily,
    }),
    metaDescription: article.metaDescription ?? "",
    featuredImage: article.featuredImage ?? "",
    language: article.language ?? "en",
    date: new Date(article.createdAt).toISOString(),
    sources: (article.sources ?? []).map((source) => ({
      url: source.url,
      title: source.title,
    })),
    internalLinks: article.internalLinks ?? [],
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": deliveryKey,
    "X-Pentra-Delivery-Key": deliveryKey,
  };

  // HMAC signature if secret is configured
  if (site.webhookSecret) {
    const signature = createHmac("sha256", site.webhookSecret!)
      .update(payload)
      .digest("hex");
    headers["X-Signature-256"] = `sha256=${signature}`;
  }

  const res = await fetch(site.webhookUrl!, {
    method: "POST",
    headers,
    body: payload,
  });

  const responseText = await res.text();

  if (!res.ok) {
    throw new Error(`Webhook failed (${res.status}): ${responseText.slice(0, 300)}`);
  }

  return { method: "webhook", status: res.status, response: responseText.slice(0, 200) };
}

// ── Main Publisher (Router) ─────────────────────────────

type PublishResult = {
  method: string;
  commitUrl?: string;
  filePath?: string;
  postUrl?: string;
  postId?: number;
  status?: number;
  response?: string;
};

const publishArgs = {
  siteId: v.id("sites"),
  articleId: v.id("articles"),
};

type PublishArgs = {
      siteId: Id<"sites">;
      articleId: Id<"articles">;
};

async function publishArticleHandler(
  ctx: ActionCtx,
  args: PublishArgs,
): Promise<PublishResult> {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId: args.siteId });
    if (!site) throw new Error("Site not found");
    if (
      !site.autopilotEnabled ||
      site.autopilotRolloutMode !== "live"
    ) {
      throw new Error(
        "External publication is blocked unless this exact tenant is in live canary mode",
      );
    }
    const rolloutEpoch = site.autopilotRolloutEpoch ?? 0;

    const article = await ctx.runQuery(internal.articles.getInternal, {
      articleId: args.articleId,
    });
    if (!article) throw new Error("Article not found");

    if (article.siteId !== args.siteId) {
      throw new Error("Article does not belong to this site");
    }

    if (!article.publicationConfigSnapshot || !article.publicationConfigHash) {
      throw new Error("Publication destination was not sealed by the quality audit");
    }
    const sealedConfig = publicationDeliveryConfig(
      article.publicationConfigSnapshot,
    );
    const sealedConfigHash = publicationDeliveryConfigHash(sealedConfig);
    const currentConfig = publicationDeliveryConfig(site);
    const currentConfigHash = publicationDeliveryConfigHash(currentConfig);
    if (
      sealedConfigHash !== article.publicationConfigHash ||
      currentConfigHash !== article.publicationConfigHash
    ) {
      throw new Error("Publication destination changed after quality audit");
    }
    if (currentConfig.method !== "github") {
      throw new Error(
        `${currentConfig.method} publication is disabled during the security-reviewed canary`,
      );
    }

    if (site.publishMethod === "manual") {
      throw new Error(
        "Manual delivery cannot be marked published without an external publication receipt.",
      );
    }
    if (article.status !== "review" && article.status !== "ready" && article.status !== "published") {
      throw new Error(`Article workflow status '${article.status}' is not publishable`);
    }
    if (site.approvalRequired && article.status !== "ready" && article.status !== "published") {
      throw new Error("Article requires explicit owner approval before publication");
    }

    // Autonomous quality is tenant-independent. A hostname must never weaken
    // the publication contract for a customer.
    const mode: PublicationQualityMode = "strict";
    const quality = evaluatePublicationQuality(article, mode);
    await ctx.runMutation(internal.articles.recordPublicationCheck, {
      articleId: article._id,
      status: quality.passed ? "passed" : "blocked",
      issues: quality.issues,
      warnings: quality.warnings,
    });
    if (!quality.passed) {
      await ctx.runMutation(internal.articles.setWorkflowStatusInternal, {
        articleId: article._id,
        status: "review",
      });
      throw new Error(
        `Publication quality gate blocked this article: ${quality.issues.join(" ")}`,
      );
    }

    if (
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      !article.auditedContentHash
    ) {
      throw new Error(
        "Publication quality gate blocked this article: the exact final artifact has not completed the current audit.",
      );
    }
    const contentHash = publicationArtifactHash(article);
    if (contentHash !== article.auditedContentHash) {
      throw new Error(
        "Publication quality gate blocked this article: content changed after audit.",
      );
    }

    const leaseOwner = randomUUID();
    const lease = await ctx.runMutation(internal.articles.beginPublication, {
      articleId: article._id,
      expectedContentHash: contentHash,
      expectedConfigHash: article.publicationConfigHash,
      expectedRolloutEpoch: rolloutEpoch,
      leaseOwner,
    });
    if (lease.alreadyPublished) {
      return { method: "already_published" };
    }

    const method = site.publishMethod ?? "github";
    if (!lease.publicationDate || !lease.publicationDeliveryHash) {
      await ctx.runMutation(internal.articles.releasePublication, {
        articleId: article._id,
        expectedContentHash: contentHash,
        leaseOwner,
      });
      throw new Error("Publication lease did not return a sealed delivery envelope");
    }
    const deliveryKey = publicationDeliveryKey(lease.publicationDeliveryHash);

    const lockedSite = await ctx.runQuery(internal.sites.getFull, {
      siteId: args.siteId,
    });
    if (
      !lockedSite ||
      lockedSite.autopilotRolloutMode !== "live" ||
      (lockedSite.autopilotRolloutEpoch ?? 0) !== rolloutEpoch ||
      publicationDeliveryConfigHash(publicationDeliveryConfig(lockedSite)) !==
        article.publicationConfigHash
    ) {
      await ctx.runMutation(internal.articles.releasePublication, {
        articleId: article._id,
        expectedContentHash: contentHash,
        leaseOwner,
      });
      throw new Error("Rollout or publication configuration changed before delivery");
    }

    const deliverySite: SiteRecord = {
      ...(lockedSite as SiteRecord),
      ...sealedConfig,
    };

    try {
      let result: PublishResult;
      switch (method) {
        case "github":
        default:
          result = await publishToGitHub(
            deliverySite,
            article as ArticleRecord,
            lease.publicationDate,
            deliveryKey,
          );
          break;
      }
      await ctx.runMutation(internal.articles.completePublication, {
        articleId: article._id,
        publishedContentHash: contentHash,
        expectedDeliveryHash: lease.publicationDeliveryHash,
        expectedConfigHash: article.publicationConfigHash,
        expectedRolloutEpoch: rolloutEpoch,
        leaseOwner,
      });
      return result;
    } catch (error) {
      await ctx.runMutation(internal.articles.releasePublication, {
        articleId: article._id,
        expectedContentHash: contentHash,
        leaseOwner,
      });
      throw error;
    }
}

export const publishArticleInternal = internalAction({
  args: publishArgs,
  handler: publishArticleHandler,
});

export const publishArticle = action({
  args: publishArgs,
  handler: async (ctx, args) => {
    const site = await ctx.runQuery(internal.sites.getFull, {
      siteId: args.siteId,
    });
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to publish this site");
    }
    return publishArticleHandler(ctx, args);
  },
});
