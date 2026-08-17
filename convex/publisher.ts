"use node";

import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createHmac, randomUUID } from "crypto";
import {
  evaluatePublicationQuality,
  normalizeSiteOrigin,
  type PublicationQualityMode,
} from "./lib/articleQuality";
import {
  assertSafePublishableMarkdown,
  PUBLISHER_RENDERER_VERSION,
  renderSafePublicationHtml,
} from "./lib/safeMarkdownHtml";
import {
  safeFetchPublicText,
  safeRequestPublicHttps,
  validatePublicHttpsUrl,
} from "./lib/safeOutbound";
import {
  PUBLICATION_ADAPTER_VERSION,
  type PublicationReceipt,
  webhookReceiptFromResponse,
  wordpressReceiptFromResponse,
} from "./lib/publicationReceipts";
import { stripLeadingDocumentTitle } from "./lib/markdownPublishing";
import {
  PUBLICATION_AUDIT_VERSION,
  classifyPentraMarkdownDestination,
  publicationAdapterConfigHash,
  publicationArtifactHash,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryKey,
  safeGitHubRepositoryPart,
  type PublicationDeliveryConfig,
} from "./lib/publicationArtifact";
import {
  publishedArticlePublicUrl,
  verifyLivePublicationPage,
} from "./lib/publicationLive";

const PUBLIC_URL_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

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
  userId?: string;
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
  publicationAdapterVerifiedAt?: number;
  publicationAdapterVersion?: string;
  publicationAdapterConfigHash?: string;
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

function assertProductionAdapterVerified(site: SiteRecord): void {
  if (site.publishMethod !== "wordpress" && site.publishMethod !== "webhook") return;
  const expectedHash = publicationAdapterConfigHash(site);
  if (
    !expectedHash ||
    site.publicationAdapterVersion !== PUBLICATION_ADAPTER_VERSION ||
    site.publicationAdapterConfigHash !== expectedHash ||
    (site.publicationAdapterVerifiedAt ?? 0) <= 0
  ) {
    throw new Error("Publishing destination has not passed its signed production preflight");
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
  contentHash: string,
): Promise<{ method: "github"; commitUrl: string; filePath: string; receipt: PublicationReceipt }> {
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

  const { commitUrl, sha } = await commitToMain({
    token,
    owner: repoOwner,
    repo: repoName,
    branch: sealedDefaultBranch,
    message: `Pentra publish ${deliveryKey}: ${article.title}`,
    file: { path: filePath, content: mdx },
    deliveryKey,
  });

  const receipt: PublicationReceipt = {
    method: "github",
    deliveryKey,
    contentHash,
    externalId: sha || filePath,
    url: commitUrl,
    status: "committed",
    receivedAt: Date.now(),
  };
  return { method: "github", commitUrl, filePath, receipt };
}

// ── WordPress Adapter ───────────────────────────────────

async function verifyPublicationDestinationHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<{ ok: true; method: "wordpress" | "webhook"; verifiedAt: number }> {
  const site = (await ctx.runQuery(internal.sites.getFull, { siteId })) as SiteRecord | null;
  if (!site) throw new Error("Site not found");
  const configHash = publicationAdapterConfigHash(site);
  if (!configHash) throw new Error("Publishing connection is incomplete");
  const verifiedAt = Date.now();

  if (site.publishMethod === "wordpress") {
    if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
      throw new Error("WordPress credentials are incomplete");
    }
    const wpRoot = await validatePublicHttpsUrl(site.wpUrl);
    const credentials = Buffer.from(
      `${site.wpUsername}:${site.wpAppPassword}`,
      "utf8",
    ).toString("base64");
    const response = await safeRequestPublicHttps(
      `${wpRoot.href.replace(/\/+$/, "")}/wp-json/wp/v2/users/me?context=edit`,
      {
        method: "GET",
        expectedHost: wpRoot.hostname,
        headers: { Authorization: `Basic ${credentials}` },
        allowedContentTypes: [/^application\/json(?:;|$)/i],
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WordPress connection check failed (${response.status})`);
    }
    const user = JSON.parse(response.text) as Record<string, unknown>;
    const capabilities = user.capabilities as Record<string, unknown> | undefined;
    if (!Number.isInteger(user.id) || capabilities?.publish_posts !== true) {
      throw new Error("WordPress account cannot publish posts");
    }
  } else if (site.publishMethod === "webhook") {
    if (!site.webhookUrl || !site.webhookSecret) {
      throw new Error("Webhook URL and signing secret are required");
    }
    if (Buffer.byteLength(site.webhookSecret, "utf8") < 32) {
      throw new Error("Webhook signing secret must contain at least 32 bytes");
    }
    const endpoint = await validatePublicHttpsUrl(site.webhookUrl);
    const nonce = randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      event: "pentra.preflight.v1",
      adapterVersion: PUBLICATION_ADAPTER_VERSION,
      nonce,
    });
    const signature = createHmac("sha256", site.webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const response = await safeRequestPublicHttps(endpoint.href, {
      method: "POST",
      expectedHost: endpoint.hostname,
      body: payload,
      headers: {
        "Content-Type": "application/json",
        "X-Pentra-Timestamp": timestamp,
        "X-Pentra-Signature-256": `sha256=${signature}`,
      },
      allowedContentTypes: [/^application\/json(?:;|$)/i],
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook connection check failed (${response.status})`);
    }
    const acknowledgement = JSON.parse(response.text) as Record<string, unknown>;
    if (
      acknowledgement.accepted !== true ||
      acknowledgement.event !== "pentra.preflight.v1" ||
      acknowledgement.nonce !== nonce
    ) {
      throw new Error("Webhook did not acknowledge the signed preflight nonce");
    }
  } else {
    throw new Error("Only WordPress and webhook destinations require this verification");
  }

  await ctx.runMutation(internal.sites.setPublicationAdapterVerificationInternal, {
    siteId,
    configHash,
    adapterVersion: PUBLICATION_ADAPTER_VERSION,
    verifiedAt,
  });
  return { ok: true, method: site.publishMethod, verifiedAt };
}

export const verifyPublicationDestinationInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => verifyPublicationDestinationHandler(ctx, siteId),
});

export const verifyPublicationDestination = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to verify this site");
    }
    return verifyPublicationDestinationHandler(ctx, siteId);
  },
});

async function publishToWordPress(
  site: SiteRecord,
  article: ArticleRecord,
  deliveryKey: string,
  contentHash: string,
): Promise<{ method: "wordpress"; postUrl: string; postId: number; receipt: PublicationReceipt }> {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
    throw new Error("WordPress credentials not configured (wpUrl, wpUsername, wpAppPassword)");
  }

  const wpRoot = await validatePublicHttpsUrl(site.wpUrl);
  const wpApiUrl = wpRoot.href.replace(/\/+$/, "");
  const credentials = Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64");
  const htmlContent = renderSafePublicationHtml(article.markdown);
  const slug = article.slug.replace(/^\//, "").replace(/\//g, "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Article slug is unsafe for WordPress publication");
  }
  const siteHost = new URL(normalizeSiteOrigin(site.domain)).hostname;
  const authHeaders = { Authorization: `Basic ${credentials}` };

  // Resolve by the stable slug before writing.  Retrying after a lost Convex
  // acknowledgement confirms the exact stored bytes instead of creating a
  // duplicate. An unrelated post with the same slug is never overwritten.
  const lookup = await safeRequestPublicHttps(
    `${wpApiUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=any&context=edit&per_page=2`,
    {
      method: "GET",
      expectedHost: wpRoot.hostname,
      headers: authHeaders,
      allowedContentTypes: [/^application\/json(?:;|$)/i],
    },
  );
  if (lookup.status < 200 || lookup.status >= 300) {
    throw new Error(`WordPress idempotency lookup failed (${lookup.status})`);
  }
  const matches = JSON.parse(lookup.text) as unknown;
  if (!Array.isArray(matches) || matches.length > 1) {
    throw new Error("WordPress returned an ambiguous slug lookup");
  }
  if (matches.length === 1) {
    const existing = matches[0] as Record<string, unknown>;
    const existingTitle = existing.title as Record<string, unknown> | undefined;
    const existingContent = existing.content as Record<string, unknown> | undefined;
    if (
      existingTitle?.raw !== article.title ||
      existingContent?.raw !== htmlContent ||
      existing.status !== "publish"
    ) {
      throw new Error("WordPress slug already belongs to a different publication");
    }
    const receipt = wordpressReceiptFromResponse({
      response: existing,
      expectedSlug: slug,
      expectedHost: siteHost,
      deliveryKey,
      contentHash,
      receivedAt: Date.now(),
    });
    return {
      method: "wordpress",
      postUrl: receipt.url,
      postId: Number(receipt.externalId),
      receipt,
    };
  }

  const response = await safeRequestPublicHttps(`${wpApiUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    expectedHost: wpRoot.hostname,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: article.title,
      content: htmlContent,
      slug,
      status: "publish",
      excerpt: article.metaDescription ?? "",
    }),
    allowedContentTypes: [/^application\/json(?:;|$)/i],
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`WordPress API error (${response.status}): ${response.text.slice(0, 300)}`);
  }
  const receipt = wordpressReceiptFromResponse({
    response: JSON.parse(response.text),
    expectedSlug: slug,
    expectedHost: siteHost,
    deliveryKey,
    contentHash,
    receivedAt: Date.now(),
  });

  return {
    method: "wordpress",
    postUrl: receipt.url,
    postId: Number(receipt.externalId),
    receipt,
  };
}

// ── Webhook Adapter ─────────────────────────────────────

async function publishToWebhook(
  site: SiteRecord,
  article: ArticleRecord,
  deliveryKey: string,
  contentHash: string,
  publicationDate: number,
): Promise<{ method: "webhook"; status: number; response: string; receipt: PublicationReceipt }> {
  if (!site.webhookUrl || !site.webhookSecret) {
    throw new Error("Webhook URL and signing secret are required");
  }
  if (Buffer.byteLength(site.webhookSecret, "utf8") < 32) {
    throw new Error("Webhook signing secret must contain at least 32 bytes");
  }

  const webhookEndpoint = await validatePublicHttpsUrl(site.webhookUrl);
  const rawSlug = article.slug.replace(/^\//, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSlug)) {
    throw new Error("Article slug is unsafe for webhook publication");
  }
  // Build full URL path from urlStructure (e.g. "/blog/[slug]" -> "/blog/my-article")
  const urlPath = site.urlStructure
    ? site.urlStructure!.replace(/\[slug\]/i, rawSlug)
    : "/blog/" + rawSlug;

  const payload = JSON.stringify({
    event: "pentra.article.publish.v1",
    rendererVersion: PUBLISHER_RENDERER_VERSION,
    deliveryKey,
    contentHash,
    title: article.title,
    slug: rawSlug,
    urlPath,
    urlStructure: site.urlStructure ?? "/blog/[slug]",
    markdown: article.markdown,
    html: renderSafePublicationHtml(article.markdown),
    metaDescription: article.metaDescription ?? "",
    featuredImage: article.featuredImage ?? "",
    language: article.language ?? "en",
    date: new Date(publicationDate).toISOString(),
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

  const timestamp = String(Math.floor(Date.now() / 1000));
  headers["X-Pentra-Timestamp"] = timestamp;
  const signature = createHmac("sha256", site.webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  headers["X-Pentra-Signature-256"] = `sha256=${signature}`;

  const response = await safeRequestPublicHttps(webhookEndpoint.href, {
    method: "POST",
    expectedHost: webhookEndpoint.hostname,
    headers,
    body: payload,
    allowedContentTypes: [/^application\/json(?:;|$)/i],
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook failed (${response.status}): ${response.text.slice(0, 300)}`);
  }
  const receipt = webhookReceiptFromResponse({
    response: JSON.parse(response.text),
    expectedDeliveryKey: deliveryKey,
    expectedContentHash: contentHash,
    expectedSiteHost: new URL(normalizeSiteOrigin(site.domain)).hostname,
    receivedAt: Date.now(),
  });

  return {
    method: "webhook",
    status: response.status,
    response: response.text.slice(0, 200),
    receipt,
  };
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
  receipt?: PublicationReceipt;
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
    assertProductionAdapterVerified(site as SiteRecord);
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
    assertProductionAdapterVerified(lockedSite as SiteRecord);

    const deliverySite: SiteRecord = {
      ...(lockedSite as SiteRecord),
      ...sealedConfig,
    };

    try {
      let result: PublishResult;
      switch (method) {
        case "github":
          result = await publishToGitHub(
            deliverySite,
            article as ArticleRecord,
            lease.publicationDate,
            deliveryKey,
            contentHash,
          );
          break;
        case "wordpress":
          result = await publishToWordPress(
            deliverySite,
            article as ArticleRecord,
            deliveryKey,
            contentHash,
          );
          break;
        case "webhook":
          result = await publishToWebhook(
            deliverySite,
            article as ArticleRecord,
            deliveryKey,
            contentHash,
            lease.publicationDate,
          );
          break;
        default:
          throw new Error(`Unsupported automatic publication method: ${method}`);
      }
      if (!result.receipt) {
        throw new Error("Publisher did not return a verified external receipt");
      }
      await ctx.runMutation(internal.articles.completePublication, {
        articleId: article._id,
        publishedContentHash: contentHash,
        expectedDeliveryHash: lease.publicationDeliveryHash,
        expectedConfigHash: article.publicationConfigHash,
        expectedRolloutEpoch: rolloutEpoch,
        leaseOwner,
        receipt: result.receipt,
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

export const verifyPublicPublicationInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<{
    status: "stale" | "pending" | "failed" | "verified";
    reason?: string;
    publicUrl?: string;
    retryInMs?: number;
  }> => {
    if (!Number.isInteger(args.attempt) || args.attempt < 0) {
      throw new Error("Invalid public publication verification attempt");
    }
    const [site, article] = await Promise.all([
      ctx.runQuery(internal.sites.getFull, { siteId: args.siteId }),
      ctx.runQuery(internal.articles.getInternal, { articleId: args.articleId }),
    ]);
    if (!site || !article || article.siteId !== args.siteId) {
      return { status: "stale", reason: "tenant_mismatch" };
    }
    if (
      article.status !== "published" ||
      article.publishedContentHash !== args.expectedContentHash
    ) {
      return { status: "stale", reason: "artifact_mismatch" };
    }
    if (article.publicUrlStatus === "verified") {
      return { status: "verified", publicUrl: article.publicUrl };
    }

    const publicUrl = publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    try {
      const fetched = await safeFetchPublicText(publicUrl, {
        expectedHost: new URL(publicUrl).hostname,
        sameHostRedirects: true,
        maxRedirects: 3,
        maxBytes: 1_000_000,
        timeoutMs: 15_000,
        allowedContentTypes: [
          /^text\/html(?:;|$)/i,
          /^application\/xhtml\+xml(?:;|$)/i,
        ],
        headers: {
          "User-Agent": "Pentra/1.0 (public publication verifier)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      });
      verifyLivePublicationPage({
        expectedUrl: publicUrl,
        fetchedUrl: fetched.url,
        html: fetched.text,
        title: article.title,
      });
      const recorded = await ctx.runMutation(
        internal.articles.recordPublicPublicationCheck,
        {
          siteId: args.siteId,
          articleId: args.articleId,
          expectedContentHash: args.expectedContentHash,
          publicUrl,
          status: "verified",
          attempts: args.attempt + 1,
        },
      );
      if (recorded.recorded) {
        await ctx.runMutation(internal.autopilot.dispatchSiteFollowup, {
          siteId: args.siteId,
          trigger: "public_url_verified",
          reason: "exact_publication_url_verified_live",
        });
      }
      return { status: "verified", publicUrl };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Public page verification failed";
      const nextDelay = PUBLIC_URL_RETRY_DELAYS_MS[args.attempt];
      const status = nextDelay === undefined ? "failed" : "pending";
      if (nextDelay !== undefined) {
        await ctx.scheduler.runAfter(
          nextDelay,
          internal.publisher.verifyPublicPublicationInternal,
          { ...args, attempt: args.attempt + 1 },
        );
      }
      const recorded = await ctx.runMutation(
        internal.articles.recordPublicPublicationCheck,
        {
          siteId: args.siteId,
          articleId: args.articleId,
          expectedContentHash: args.expectedContentHash,
          publicUrl,
          status,
          attempts: args.attempt + 1,
          error: message,
        },
      );
      if (status === "failed" && recorded.recorded) {
        await ctx.runMutation(internal.autopilot.dispatchSiteFollowup, {
          siteId: args.siteId,
          trigger: "public_url_failed",
          reason: "exact_publication_url_verification_exhausted",
        });
      }
      return { status, publicUrl, retryInMs: nextDelay };
    }
  },
});

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
