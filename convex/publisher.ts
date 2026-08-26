"use node";

import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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
  renderSafePublicationHtmlForVersion,
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
  assertSupportedPublicationAdapterVersion,
  classifyPentraMarkdownDestination,
  publicationAdapterConfigHash,
  publicationAdapterConfigHashForVersion,
  publicationArtifactHashForAuditVersion,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryDestinationHash,
  publicationDeliveryKey,
  safeGitHubRepositoryPart,
  sha256Hex,
  type PublicationDeliveryConfig,
} from "./lib/publicationArtifact";
import {
  publishedArticlePublicUrl,
  verifiedAuthorityTarget,
  verifyLivePublicationPage,
} from "./lib/publicationLive";
import {
  evaluateTopicBusinessFit,
  tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import {
  classifyPublishedRevisionDestination,
  MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS,
  publishedRevisionDeliveryKey,
  verifyLegacyGitHubReceiptAdoptionProof,
  validatePublishedRevisionReceipt,
  webhookRevisionReceiptFromResponse,
  verifyLivePublishedRevision,
  type PublishedRevisionArtifact,
  type PublishedRevisionReceipt,
} from "./lib/publishedRevision";
import {
  articleMatchesCurrentDomain,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";
import { PUBLICATION_LEASE_MS } from "./lib/publicationLease";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import {
  expectedPublisherDestinationReceipt,
  publisherAutopublishConsentCurrent,
  publisherConnectionComplete,
  publisherDestinationReceiptVerified,
  supportedPublisherMethod,
} from "./lib/publisherProvisioning.ts";

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

type BeforeExternalMutation = () => Promise<void>;
type PublisherPreflightFence = () => Promise<void>;

type ArticleRecord = {
  _id: Id<"articles">;
  siteId: Id<"sites">;
  topicId?: Id<"topic_clusters">;
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
  publicationDeliveryHash?: string;
  publicationRolloutEpoch?: number;
  publicationLeaseHash?: string;
  publicationLeaseOwner?: string;
  publicationAttemptedAt?: number;
  publicationAdapterVersionAtAttempt?: string;
  publicationAdapterConfigHashAtAttempt?: string;
  publicationRendererVersionAtAttempt?: string;
  publicationOutcomeUnverifiedAt?: number;
  canonicalDomain?: string;
  domainRevision?: number;
  sources?: { url: string; title?: string; excerpt?: string; contentHash?: string; capturedAt?: number }[];
  internalLinks?: { anchor: string; href: string }[];
};

type SiteRecord = {
  _id: Id<"sites">;
  userId?: string;
  domain: string;
  canonicalDomain?: string;
  canonicalDomainRevision?: number;
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
  publisherConnectionGeneration?: number;
  publisherDestinationReceipt?: Doc<"sites">["publisherDestinationReceipt"];
  rendererVersion?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandFontFamily?: string;
  urlStructure?: string;
  contentDir?: string;
  autopilotEnabled?: boolean;
  autopilotRolloutMode?: string;
  autopilotRolloutEpoch?: number;
  siteType?: string;
  niche?: string;
  blogTheme?: string;
  siteSummary?: string;
  targetAudienceSummary?: string;
  productUsage?: string;
  anchorKeywords?: string[];
  keyFeatures?: string[];
  painPoints?: string[];
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

function assertAttemptedAdapterContract(
  site: SiteRecord,
  article: ArticleRecord,
): void {
  const method = article.publicationConfigSnapshot?.method;
  if (method !== "wordpress" && method !== "webhook") return;
  // Additive inference for attempts created before explicit contract fields:
  // only the still-exact verified adapter and immutable renderer seal qualify.
  const adapterVersion = article.publicationAdapterVersionAtAttempt ??
    site.publicationAdapterVersion;
  const adapterHash = article.publicationAdapterConfigHashAtAttempt ??
    site.publicationAdapterConfigHash;
  const rendererVersion = article.publicationRendererVersionAtAttempt ??
    article.publicationConfigSnapshot?.rendererVersion;
  if (
    !adapterVersion ||
    !adapterHash ||
    !rendererVersion ||
    rendererVersion !== article.publicationConfigSnapshot?.rendererVersion ||
    site.publicationAdapterVersion !== adapterVersion ||
    site.publicationAdapterConfigHash !== adapterHash ||
    publicationAdapterConfigHashForVersion(site, adapterVersion) !== adapterHash
  ) {
    throw new Error(
      "The unresolved publication no longer has its exact attempted adapter contract",
    );
  }
  assertSupportedPublicationAdapterVersion(adapterVersion);
  // This validates that the historical renderer is still intentionally
  // supported without allocating or contacting the provider.
  renderSafePublicationHtmlForVersion("", rendererVersion);
}

function sealedRevisionDeliveryConfig(article: ArticleRecord) {
  if (!article.publicationConfigSnapshot || !article.publicationConfigHash) {
    throw new Error("Published revision lost its sealed publication destination");
  }
  const config = publicationDeliveryConfig(article.publicationConfigSnapshot);
  if (publicationDeliveryConfigHash(config) !== article.publicationConfigHash) {
    throw new Error("Published revision destination seal is inconsistent");
  }
  return config;
}

function attemptedRevisionRendererVersion(
  site: SiteRecord,
  article: ArticleRecord,
  revision: RevisionDoc,
): string {
  const sealed = sealedRevisionDeliveryConfig(article);
  if (sealed.method !== revision.baseReceipt.method) {
    throw new Error("Published revision method changed after its base receipt");
  }
  const rendererVersion = revision.rendererVersionAtAttempt ??
    sealed.rendererVersion ??
    PUBLISHER_RENDERER_VERSION;
  renderSafePublicationHtmlForVersion("", rendererVersion);
  if (sealed.method !== "wordpress" && sealed.method !== "webhook") {
    return rendererVersion;
  }
  const adapterVersion = revision.adapterVersionAtAttempt ??
    site.publicationAdapterVersion;
  const adapterHash = revision.adapterConfigHashAtAttempt ??
    site.publicationAdapterConfigHash;
  if (
    !adapterVersion ||
    !adapterHash ||
    !site.publicationAdapterVerifiedAt ||
    site.publicationAdapterVersion !== adapterVersion ||
    site.publicationAdapterConfigHash !== adapterHash ||
    publicationAdapterConfigHashForVersion(site, adapterVersion) !== adapterHash
  ) {
    throw new Error(
      "The unresolved revision no longer has its exact attempted adapter contract",
    );
  }
  assertSupportedPublicationAdapterVersion(adapterVersion);
  return rendererVersion;
}

function buildMdx(
  article: ArticleRecord,
  site: SiteRecord,
  publicationDate: number,
  deliveryKey: string,
  auditVersion = PUBLICATION_AUDIT_VERSION,
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
    `qualityGateVersion: ${auditVersion}`,
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
  const data = await res.json() as {
    default_branch?: unknown;
    permissions?: { push?: unknown };
  };
  if (data.permissions?.push !== true) {
    throw new Error(
      "GitHub connection does not grant repository write access",
    );
  }
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
async function reverifyGithubConnectionHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  options?: {
    siteSnapshot?: SiteRecord;
    beforeExternalRead?: PublisherPreflightFence;
  },
) {
  const site = options?.siteSnapshot ??
    (await ctx.runQuery(internal.sites.getFull, {
      siteId,
    })) as SiteRecord | null;
  if (!site?.userId) throw new Error("Site not found");
  if (site._id !== siteId) throw new Error("Publishing snapshot mismatch");
  if ((site.publishMethod ?? "github") !== "github") {
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

  await options?.beforeExternalRead?.();
  const repoDefaultBranch = await getDefaultBranch({
    token: site.githubToken,
    owner: repoOwner,
    repo: repoName,
  });
  const connection = await ctx.runMutation(
    internal.sites.setGithubTokenInternal,
    {
      siteId,
      githubToken: site.githubToken,
      repoOwner,
      repoName,
      repoDefaultBranch,
      expectedCanonicalDomain: site.canonicalDomain ?? site.domain,
      expectedDomainRevision: site.canonicalDomainRevision ?? 0,
      expectedConnectionGeneration:
        site.publisherConnectionGeneration ?? 0,
    },
  );
  const verifiedAt = Date.now();
  const receipt = expectedPublisherDestinationReceipt({
    site: {
      ...site,
      publishMethod: "github",
      repoDefaultBranch,
      publisherConnectionGeneration:
        connection.publisherConnectionGeneration,
    } as Doc<"sites">,
    ownerAccountKey: accountDeletionKey(site.userId),
    verifiedAt,
  });
  if (!receipt) throw new Error("GitHub publication receipt is incomplete");
  await ctx.runMutation(internal.sites.recordPublisherDestinationReceiptInternal, {
    siteId,
    receipt,
  });
  return { ok: true as const, repoDefaultBranch, verifiedAt };
}

export const reverifyGithubConnectionInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) =>
    reverifyGithubConnectionHandler(ctx, siteId),
});

async function commitToMain({
  token,
  owner,
  repo,
  branch,
  message,
  file,
  deliveryKey,
  expectedCurrentContent,
  beforeExternalMutation,
}: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  file: FileContent;
  deliveryKey: string;
  expectedCurrentContent?: string;
  beforeExternalMutation: BeforeExternalMutation;
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
      expectedCurrentContent,
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
      beforeExternalMutation,
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
    expectedCurrentContent,
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

  // Blob/tree/commit objects are inert until the branch ref moves. Persist
  // the ambiguity fence immediately before that first externally visible
  // publication mutation, after every deterministic/read-only preflight.
  await beforeExternalMutation();
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
  expectedCurrentContent,
}: {
  token: string;
  owner: string;
  repo: string;
  ref: string;
  file: FileContent;
  deliveryKey: string;
  expectedCurrentContent?: string;
}): Promise<{
  disposition: "create" | "overwrite" | "idempotent";
  fileSha?: string;
  htmlUrl: string;
  observedContent?: string;
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
    if (expectedCurrentContent !== undefined) {
      throw new Error("External destination drifted from the exact revision base");
    }
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
  const disposition = expectedCurrentContent === undefined
    ? classifyPentraMarkdownDestination({
        existingContent,
        nextContent: file.content,
        deliveryKey,
      })
    : classifyPublishedRevisionDestination({
        observedContent: existingContent,
        expectedBaseContent: expectedCurrentContent,
        expectedNextContent: file.content,
      }) === "idempotent"
      ? "idempotent"
      : "overwrite";
  const htmlUrl =
    typeof existing.html_url === "string" &&
    existing.html_url.startsWith("https://github.com/")
      ? existing.html_url
      : fallbackUrl;
  return { disposition, fileSha: existing.sha, htmlUrl, observedContent: existingContent };
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
  beforeExternalMutation,
}: {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  file: FileContent;
  fileSha?: string;
  headers: Record<string, string>;
  beforeExternalMutation: BeforeExternalMutation;
}): Promise<{ commitUrl: string; sha: string }> {
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  await beforeExternalMutation();
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
  auditVersion: number,
  beforeExternalMutation: BeforeExternalMutation,
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
  const mdx = buildMdx(
    article,
    site,
    publicationDate,
    deliveryKey,
    auditVersion,
  );

  const { commitUrl, sha } = await commitToMain({
    token,
    owner: repoOwner,
    repo: repoName,
    branch: sealedDefaultBranch,
    message: `Pentra publish ${deliveryKey}: ${article.title}`,
    file: { path: filePath, content: mdx },
    deliveryKey,
    beforeExternalMutation,
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
  options?: {
    siteSnapshot?: SiteRecord;
    beforeExternalRead?: PublisherPreflightFence;
  },
): Promise<{ ok: true; method: "wordpress" | "webhook"; verifiedAt: number }> {
  const site = options?.siteSnapshot ??
    (await ctx.runQuery(internal.sites.getFull, { siteId })) as SiteRecord | null;
  if (!site?.userId) throw new Error("Site not found");
  if (site._id !== siteId) throw new Error("Publishing snapshot mismatch");
  const configHash = publicationAdapterConfigHash(site);
  if (!configHash) throw new Error("Publishing connection is incomplete");
  const verifiedAt = Date.now();
  const receipt = expectedPublisherDestinationReceipt({
    site: site as Doc<"sites">,
    ownerAccountKey: accountDeletionKey(site.userId),
    verifiedAt,
  });
  if (!receipt) throw new Error("Publishing connection is incomplete");

  if (site.publishMethod === "wordpress") {
    if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
      throw new Error("WordPress credentials are incomplete");
    }
    const wpRoot = await validatePublicHttpsUrl(site.wpUrl);
    const credentials = Buffer.from(
      `${site.wpUsername}:${site.wpAppPassword}`,
      "utf8",
    ).toString("base64");
    await options?.beforeExternalRead?.();
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
    await options?.beforeExternalRead?.();
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
  await ctx.runMutation(internal.sites.recordPublisherDestinationReceiptInternal, {
    siteId,
    receipt,
  });
  return { ok: true, method: site.publishMethod, verifiedAt };
}

export const verifyPublicationDestinationInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => verifyPublicationDestinationHandler(ctx, siteId),
});

function legacyPublicationPreflightFailureCode(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      break;
    }
  }
  const message = messages.join(" ").toLowerCase();
  if (message.includes("connection check failed")) return "destination_http_failed";
  if (message.includes("acknowledge the signed preflight nonce")) {
    return "webhook_acknowledgement_invalid";
  }
  if (message.includes("cannot publish posts")) return "publisher_permission_missing";
  if (message.includes("credentials are incomplete") ||
      message.includes("URL and signing secret are required")) {
    return "publisher_connection_incomplete";
  }
  if (message.includes("lease lost") || message.includes("snapshot mismatch")) {
    return "publisher_preflight_stale";
  }
  if (message.includes("unsupported outbound content type")) {
    return "destination_content_type_invalid";
  }
  if (
    message.includes("unexpected token") ||
    message.includes("json") && message.includes("parse")
  ) {
    return "destination_response_invalid";
  }
  if (message.includes("must not redirect")) return "destination_redirected";
  if (message.includes("timed out") || message.includes("etimedout")) {
    return "destination_timeout";
  }
  if (
    message.includes("not an allowed public https destination") ||
    message.includes("private or reserved address") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("econnrefused") ||
    message.includes("certificate")
  ) {
    return "destination_unreachable";
  }
  return "publisher_preflight_failed";
}

/**
 * Legacy configured tenants predate One Setup's managed provisioning receipt.
 * The natural fleet may run one signed, provider-read-only preflight per day;
 * exact attempt and configuration fences prevent retries from authorizing a
 * changed destination or turning this bridge into a publication path.
 */
export const verifyLegacyPublicationDestinationInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    attemptedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.runQuery(internal.sites.getFull, {
      siteId: args.siteId,
    }) as SiteRecord & {
      publicationAdapterVerificationAttemptedAt?: number;
    } | null;
    const configHash = site ? publicationAdapterConfigHash(site) : null;
    if (
      !site ||
      !configHash ||
      site.autopilotRolloutMode !== "observe" ||
      site.approvalRequired === true ||
      !["wordpress", "webhook"].includes(site.publishMethod ?? "") ||
      site.publicationAdapterVerificationAttemptedAt !== args.attemptedAt
    ) return { verified: false as const, reason: "publisher_preflight_stale" };

    const assertAttemptCurrent: PublisherPreflightFence = async () => {
      const current = await ctx.runQuery(internal.sites.getFull, {
        siteId: args.siteId,
      }) as typeof site;
      if (
        !current ||
        current.autopilotRolloutMode !== "observe" ||
        current.approvalRequired === true ||
        current.publicationAdapterVerificationAttemptedAt !== args.attemptedAt ||
        publicationAdapterConfigHash(current) !== configHash
      ) throw new Error("Legacy publisher preflight lease lost");
    };

    try {
      await verifyPublicationDestinationHandler(ctx, args.siteId, {
        siteSnapshot: site,
        beforeExternalRead: assertAttemptCurrent,
      });
      await ctx.runMutation(
        internal.sites.settleLegacyPublicationAdapterPreflightInternal,
        {
          siteId: args.siteId,
          attemptedAt: args.attemptedAt,
          expectedConfigHash: configHash,
        },
      );
      await ctx.runMutation(
        internal.autopilot.promoteObserveSiteAfterReadinessMaintenance,
        { siteId: args.siteId },
      );
      return { verified: true as const };
    } catch (error) {
      const failureCode = legacyPublicationPreflightFailureCode(error);
      await ctx.runMutation(
        internal.sites.settleLegacyPublicationAdapterPreflightInternal,
        {
          siteId: args.siteId,
          attemptedAt: args.attemptedAt,
          expectedConfigHash: configHash,
          failureCode,
        },
      );
      return { verified: false as const, reason: failureCode };
    }
  },
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

type ManagedPublisherPreflightContext = {
  request: Doc<"managed_provisioning_requests">;
  site: Doc<"sites">;
  timestamp: number;
};
type ManagedPublisherPreflightResult = {
  resumed: boolean;
  reason: string;
};

/**
 * Lease-fenced managed resume for every installed publication adapter. The
 * action performs provider reads and writes only canonical destination proof;
 * `managedProvisioning.reconcileRequest` remains the sole ready writer.
 */
export const preflightManagedPublisherInternal = internalAction({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<ManagedPublisherPreflightResult> => {
    const context = await ctx.runQuery(
      internal.managedProvisioning.getPublisherPreflightContext,
      args,
    ) as ManagedPublisherPreflightContext | null;
    if (!context) {
      return { resumed: false as const, reason: "lease_lost" as const };
    }
    if (!publisherAutopublishConsentCurrent({ request: context.request })) {
      await ctx.runMutation(
        internal.managedProvisioning.settlePublisherPreflightActionRequired,
        { ...args, reasonCode: "publisher_autopublish_consent_required" },
      );
      return { resumed: false as const, reason: "owner_consent" as const };
    }

    const configuredMethod = context.site.publishMethod ?? "github";
    const method = supportedPublisherMethod(configuredMethod);
    if (!method) {
      const reasonCode = configuredMethod === "manual"
        ? "publisher_connection_required" as const
        : "managed_publisher_adapter_unavailable" as const;
      await ctx.runMutation(
        internal.managedProvisioning.settlePublisherPreflightActionRequired,
        { ...args, reasonCode },
      );
      return { resumed: false as const, reason: reasonCode };
    }
    if (!publisherConnectionComplete(context.site)) {
      await ctx.runMutation(
        internal.managedProvisioning.settlePublisherPreflightActionRequired,
        { ...args, reasonCode: "publisher_connection_required" },
      );
      return { resumed: false as const, reason: "owner_connection" as const };
    }

    const started = await ctx.runMutation(
      internal.managedProvisioning.markPublisherPreflightInProgress,
      args,
    ) as { started: boolean };
    if (!started.started) {
      return { resumed: false as const, reason: "lease_lost" as const };
    }
    const assertPreflightLeaseCurrent: PublisherPreflightFence = async () => {
      const liveContext = await ctx.runQuery(
        internal.managedProvisioning.getPublisherPreflightContext,
        args,
      ) as ManagedPublisherPreflightContext | null;
      if (!liveContext) throw new Error("Managed publisher lease lost");
    };

    try {
      if (method === "github") {
        await reverifyGithubConnectionHandler(ctx, context.site._id, {
          siteSnapshot: context.site,
          beforeExternalRead: assertPreflightLeaseCurrent,
        });
      } else {
        await verifyPublicationDestinationHandler(ctx, context.site._id, {
          siteSnapshot: context.site,
          beforeExternalRead: assertPreflightLeaseCurrent,
        });
      }
    } catch {
      const liveContext = await ctx.runQuery(
        internal.managedProvisioning.getPublisherPreflightContext,
        args,
      ) as ManagedPublisherPreflightContext | null;
      if (!liveContext) {
        return { resumed: false as const, reason: "lease_lost" as const };
      }
      await ctx.runMutation(
        internal.managedProvisioning.settlePublisherPreflightActionRequired,
        { ...args, reasonCode: "publisher_connection_verification_required" },
      );
      return {
        resumed: false as const,
        reason: "owner_verification" as const,
      };
    }

    const verifiedContext = await ctx.runQuery(
      internal.managedProvisioning.getPublisherPreflightContext,
      args,
    ) as ManagedPublisherPreflightContext | null;
    if (
      !verifiedContext ||
      !publisherDestinationReceiptVerified({
        site: verifiedContext.site,
        ownerAccountKey: verifiedContext.request.ownerAccountKey,
      })
    ) {
      return { resumed: false as const, reason: "lease_lost" as const };
    }
    const reconciled = await ctx.runMutation(
      internal.managedProvisioning.reconcileRequest,
      args,
    ) as { reconciled: boolean; reason?: string };
    return {
      resumed: reconciled.reconciled,
      reason: reconciled.reconciled
        ? "reconciled"
        : reconciled.reason ?? "lease_lost",
    };
  },
});

async function publishToWordPress(
  site: SiteRecord,
  article: ArticleRecord,
  deliveryKey: string,
  contentHash: string,
  rendererVersion: string,
  beforeExternalMutation: BeforeExternalMutation,
): Promise<{ method: "wordpress"; postUrl: string; postId: number; receipt: PublicationReceipt }> {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
    throw new Error("WordPress credentials not configured (wpUrl, wpUsername, wpAppPassword)");
  }

  const wpRoot = await validatePublicHttpsUrl(site.wpUrl);
  const wpApiUrl = wpRoot.href.replace(/\/+$/, "");
  const credentials = Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64");
  const htmlContent = renderSafePublicationHtmlForVersion(
    article.markdown,
    rendererVersion,
  );
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

  await beforeExternalMutation();
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
  rendererVersion: string,
  beforeExternalMutation: BeforeExternalMutation,
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
    rendererVersion,
    deliveryKey,
    contentHash,
    title: article.title,
    slug: rawSlug,
    urlPath,
    urlStructure: site.urlStructure ?? "/blog/[slug]",
    markdown: article.markdown,
    html: renderSafePublicationHtmlForVersion(article.markdown, rendererVersion),
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

  await beforeExternalMutation();
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

// ── Immutable Published Revision Adapters ──────────────

type RevisionDoc = Doc<"published_article_revisions">;

function revisionArticleRecord(
  article: ArticleRecord,
  artifact: PublishedRevisionArtifact,
): ArticleRecord {
  return { ...article, ...artifact };
}

function revisionReceipt(args: {
  revision: RevisionDoc;
  externalId: string;
  url: string;
  status: string;
}): PublishedRevisionReceipt {
  const receipt: PublishedRevisionReceipt = {
    method: args.revision.baseReceipt.method,
    revisionKey: args.revision.revisionKey,
    deliveryKey: publishedRevisionDeliveryKey(args.revision.revisionKey),
    baseContentHash: args.revision.baseArtifactHash,
    baseExternalId: args.revision.baseReceipt.externalId,
    contentHash: args.revision.nextArtifactHash,
    externalId: args.externalId,
    url: args.url,
    status: args.status,
    receivedAt: Date.now(),
  };
  return validatePublishedRevisionReceipt({
    receipt,
    method: args.revision.baseReceipt.method,
    revisionKey: args.revision.revisionKey,
    baseArtifactHash: args.revision.baseArtifactHash,
    nextArtifactHash: args.revision.nextArtifactHash,
    baseExternalId: args.revision.baseReceipt.externalId,
  });
}

async function reviseGitHub(args: {
  site: SiteRecord;
  article: ArticleRecord;
  revision: RevisionDoc;
  beforeExternalMutation: BeforeExternalMutation;
}): Promise<PublishedRevisionReceipt> {
  const token = args.site.githubToken;
  const owner = args.site.repoOwner;
  const repo = args.site.repoName;
  const branch = args.site.repoDefaultBranch;
  const contentDir = sealedRevisionDeliveryConfig(args.article).contentDir;
  if (!token || !owner || !repo || !branch || !contentDir) {
    throw new Error("GitHub revision destination is incomplete");
  }
  if (await getDefaultBranch({ token, owner, repo }) !== branch) {
    throw new Error("GitHub default branch drifted from the sealed revision destination");
  }
  const slug = args.article.slug.replace(/^\//, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Article slug is unsafe for a GitHub revision path");
  }
  const filePath = `${contentDir}/${slug}.md`;
  if (!filePath.startsWith(`${contentDir}/`) || filePath.includes("..")) {
    throw new Error("Refusing to revise outside the sealed content directory");
  }
  const base = revisionArticleRecord(
    args.article,
    args.revision.baseArtifact as PublishedRevisionArtifact,
  );
  const next = revisionArticleRecord(
    args.article,
    args.revision.nextArtifact as PublishedRevisionArtifact,
  );
  const expectedCurrentContent = buildMdx(
    base,
    args.site,
    args.revision.publicationDate,
    args.revision.baseReceipt.deliveryKey,
    args.revision.baseAuditVersion ?? PUBLICATION_AUDIT_VERSION,
  );
  const deliveryKey = publishedRevisionDeliveryKey(args.revision.revisionKey);
  const nextContent = buildMdx(
    next,
    args.site,
    args.revision.publicationDate,
    deliveryKey,
    args.revision.nextAuditVersion ?? PUBLICATION_AUDIT_VERSION,
  );
  const result = await commitToMain({
    token,
    owner,
    repo,
    branch,
    message: `Pentra revise ${deliveryKey}: ${args.article.title}`,
    file: { path: filePath, content: nextContent },
    deliveryKey,
    expectedCurrentContent,
    beforeExternalMutation: args.beforeExternalMutation,
  });
  return revisionReceipt({
    revision: args.revision,
    externalId: result.sha || filePath,
    url: result.commitUrl,
    status: "committed",
  });
}

async function reviseWordPress(args: {
  site: SiteRecord;
  article: ArticleRecord;
  revision: RevisionDoc;
}): Promise<PublishedRevisionReceipt> {
  // WordPress core exposes a read-then-update REST flow, not an atomic
  // conditional write. Exact response bytes cannot undo a customer edit that
  // landed between GET and POST, so post-publication automation must fail
  // closed until a tenant configures a CAS-capable plugin/endpoint contract.
  void args;
  throw new Error(
    "Automatic WordPress revisions are unsupported without atomic conditional-write CAS",
  );
}

async function reviseWebhook(args: {
  site: SiteRecord;
  article: ArticleRecord;
  revision: RevisionDoc;
  rendererVersion: string;
  beforeExternalMutation: BeforeExternalMutation;
}): Promise<PublishedRevisionReceipt> {
  if (!args.site.webhookUrl || !args.site.webhookSecret) {
    throw new Error("Webhook revision destination is incomplete");
  }
  if (Buffer.byteLength(args.site.webhookSecret, "utf8") < 32) {
    throw new Error("Webhook revision signing secret is too short");
  }
  const endpoint = await validatePublicHttpsUrl(args.site.webhookUrl);
  const next = revisionArticleRecord(
    args.article,
    args.revision.nextArtifact as PublishedRevisionArtifact,
  );
  const deliveryKey = publishedRevisionDeliveryKey(args.revision.revisionKey);
  const payload = JSON.stringify({
    event: "pentra.article.revise.v1",
    rendererVersion: args.rendererVersion,
    revisionKey: args.revision.revisionKey,
    deliveryKey,
    baseDeliveryKey: args.revision.baseReceipt.deliveryKey,
    baseContentHash: args.revision.baseArtifactHash,
    baseExternalId: args.revision.baseReceipt.externalId,
    contentHash: args.revision.nextArtifactHash,
    externalId: args.revision.baseReceipt.externalId,
    title: next.title,
    slug: next.slug.replace(/^\//, ""),
    markdown: next.markdown,
    html: renderSafePublicationHtmlForVersion(
      next.markdown,
      args.rendererVersion,
    ),
    metaTitle: next.metaTitle ?? "",
    metaDescription: next.metaDescription ?? "",
    internalLinks: next.internalLinks ?? [],
    canonicalUrl: publishedArticlePublicUrl({
      domain: args.site.domain,
      urlStructure: args.site.urlStructure,
      slug: next.slug,
    }),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", args.site.webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  await args.beforeExternalMutation();
  const response = await safeRequestPublicHttps(endpoint.href, {
    method: "POST",
    expectedHost: endpoint.hostname,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": deliveryKey,
      "X-Pentra-Delivery-Key": deliveryKey,
      "X-Pentra-Timestamp": timestamp,
      "X-Pentra-Signature-256": `sha256=${signature}`,
    },
    body: payload,
    allowedContentTypes: [/^application\/json(?:;|$)/i],
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook revision was not acknowledged (${response.status})`);
  }
  return webhookRevisionReceiptFromResponse({
    response: JSON.parse(response.text),
    expectedRevisionKey: args.revision.revisionKey,
    expectedDeliveryKey: deliveryKey,
    expectedBaseContentHash: args.revision.baseArtifactHash,
    expectedNextContentHash: args.revision.nextArtifactHash,
    expectedExternalId: args.revision.baseReceipt.externalId,
    expectedSiteHost: new URL(normalizeSiteOrigin(args.site.domain)).hostname,
    receivedAt: Date.now(),
  });
}

const REVISION_LIVE_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

/**
 * Read-only recovery for legacy v4 GitHub publications. It never calls a
 * mutating provider endpoint: the receipt is adopted only after exact current
 * branch/file bytes, the embedded delivery key, and the live canonical page
 * have all passed, with the branch head unchanged across the proof window.
 */
export const adoptLegacyGitHubPublicationReceiptInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, args): Promise<{
    status: "verified" | "bounded_wait" | "not_eligible" | "failed";
    detail: string;
  }> => {
    const leaseOwner = randomUUID();
    const claim = await ctx.runMutation(
      internal.publishedRevisions.claimLegacyGitHubReceiptAdoption,
      { ...args, leaseOwner },
    );
    if (claim.status === "verified") {
      return {
        status: "verified",
        detail: "The exact legacy GitHub receipt was already adopted from live evidence.",
      };
    }
    if (claim.status === "bounded_wait") {
      return {
        status: "bounded_wait",
        detail: "This tenant has reached its bounded legacy receipt proof allowance for the last 24 hours.",
      };
    }
    if (claim.status !== "claimed" || !claim.adoptionId) {
      return {
        status: "not_eligible",
        detail: "The legacy article does not satisfy the exact GitHub receipt-adoption contract.",
      };
    }

    try {
      const context = await ctx.runQuery(
        internal.publishedRevisions.getLegacyGitHubReceiptAdoptionContext,
        { adoptionId: claim.adoptionId },
      );
      if (!context) throw new Error("Legacy adoption tenant is unavailable");
      const { adoption, site, article } = context;
      if (
        adoption.status !== "leased" ||
        adoption.leaseOwner !== leaseOwner ||
        adoption.auditVersion !== 4 ||
        (site.publishMethod ?? "github") !== "github"
      ) {
        throw new Error("Legacy adoption lost its exact read-only lease");
      }
      const token = site.githubToken;
      const owner = site.repoOwner;
      const repo = site.repoName;
      const branch = site.repoDefaultBranch;
      const contentDir = publicationDeliveryConfig(site).contentDir;
      if (!token || !owner || !repo || !branch || !contentDir) {
        throw new Error("Legacy GitHub receipt destination is incomplete");
      }
      if (await getDefaultBranch({ token, owner, repo }) !== branch) {
        throw new Error("Legacy GitHub default branch drifted from the sealed destination");
      }
      const slug = article.slug.replace(/^\//, "");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error("Legacy article slug is unsafe for a GitHub content path");
      }
      const filePath = `${contentDir}/${slug}.md`;
      if (!filePath.startsWith(`${contentDir}/`) || filePath.includes("..")) {
        throw new Error("Legacy GitHub proof escaped the sealed content directory");
      }
      const expectedContent = buildMdx(
        article as ArticleRecord,
        site as SiteRecord,
        adoption.publicationDate,
        adoption.deliveryKey,
        adoption.auditVersion,
      );
      const expectedExternalContentHash = sha256Hex(expectedContent);
      await ctx.runMutation(
        internal.publishedRevisions.sealLegacyGitHubExpectedContent,
        {
          adoptionId: adoption._id,
          leaseOwner,
          expectedExternalContentHash,
        },
      );

      const branchHeadBefore = await readGitHubBranchHead({
        token,
        owner,
        repo,
        branch,
      });
      const destination = await inspectGitHubDestination({
        token,
        owner,
        repo,
        ref: branchHeadBefore,
        file: { path: filePath, content: expectedContent },
        deliveryKey: adoption.deliveryKey,
      });
      if (
        destination.disposition !== "idempotent" ||
        !destination.fileSha ||
        destination.observedContent === undefined
      ) {
        throw new Error("Legacy GitHub file is not the exact immutable Pentra delivery");
      }

      const fetched = await safeFetchPublicText(adoption.expectedPublicUrl, {
        expectedHost: new URL(adoption.expectedPublicUrl).hostname,
        sameHostRedirects: true,
        maxRedirects: 3,
        maxBytes: 1_000_000,
        timeoutMs: 15_000,
        allowedContentTypes: [
          /^text\/html(?:;|$)/i,
          /^application\/xhtml\+xml(?:;|$)/i,
        ],
        headers: {
          "User-Agent": "Pentra/1.0 (legacy publication receipt verifier)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      });
      const artifact = revisionArticleRecord(
        article as ArticleRecord,
        article as unknown as PublishedRevisionArtifact,
      ) as unknown as PublishedRevisionArtifact;
      verifyLivePublishedRevision({
        expectedUrl: adoption.expectedPublicUrl,
        fetchedUrl: fetched.url,
        html: fetched.text,
        base: artifact,
        next: artifact,
        kind: "improve_snippet",
      });
      const branchHeadAfter = await readGitHubBranchHead({
        token,
        owner,
        repo,
        branch,
      });
      const proof = verifyLegacyGitHubReceiptAdoptionProof({
        expectedContent,
        observedContent: destination.observedContent,
        deliveryKey: adoption.deliveryKey,
        branchHeadBefore,
        branchHeadAfter,
        fileSha: destination.fileSha,
      });
      if (proof.externalContentHash !== expectedExternalContentHash) {
        throw new Error("Legacy GitHub external bytes changed after sealing");
      }
      const verifiedAt = Date.now();
      const receipt = {
        method: "github" as const,
        deliveryKey: adoption.deliveryKey,
        contentHash: adoption.artifactHash,
        externalId: destination.fileSha,
        url: destination.htmlUrl,
        status: "adopted_verified",
        receivedAt: verifiedAt,
      };
      await ctx.runMutation(
        internal.publishedRevisions.completeLegacyGitHubReceiptAdoption,
        {
          adoptionId: adoption._id,
          leaseOwner,
          externalBranchHead: branchHeadBefore,
          externalFileSha: destination.fileSha,
          externalContentHash: proof.externalContentHash,
          receipt,
          publicUrlVerifiedAt: verifiedAt,
        },
      );
      return {
        status: "verified",
        detail: "Adopted the exact current GitHub file and live canonical page as a legacy publication receipt without an external write.",
      };
    } catch (error) {
      const detail = error instanceof Error
        ? error.message
        : "Legacy GitHub receipt proof failed closed";
      await ctx.runMutation(
        internal.publishedRevisions.failLegacyGitHubReceiptAdoption,
        {
          adoptionId: claim.adoptionId,
          leaseOwner,
          code: "legacy_receipt_proof_failed",
          detail,
        },
      );
      return {
        status: "failed",
        detail:
          "Legacy GitHub receipt proof failed closed; no external write was attempted and the article remains immutable.",
      };
    }
  },
});

export const executePublishedRevisionInternal = internalAction({
  args: { revisionId: v.id("published_article_revisions") },
  handler: async (ctx, { revisionId }) => {
    const context = await ctx.runQuery(
      internal.publishedRevisions.getExecutionContext,
      { revisionId },
    );
    if (!context) throw new Error("Published revision tenant is unavailable");
    const { site, article, revision } = context;
    if (revision.status === "verified" || revision.status === "rolled_back") {
      return { status: "verified", idempotent: true };
    }
    if (revision.status === "verification_pending") {
      return { status: "verification_pending", idempotent: true };
    }
    if (revision.status === "failed") {
      return { status: "failed", idempotent: true };
    }
    if (
      revision.status === "unverified" &&
      revision.attempts >=
        MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS
    ) {
      return {
        status: "unverified",
        idempotent: true,
        requiresOwnerReview: true,
      };
    }
    const recoveringAttemptedDelivery = Boolean(revision.attemptedAt);
    if (!recoveringAttemptedDelivery) {
      if (
        !site.autopilotEnabled ||
        !["warm", "live"].includes(site.autopilotRolloutMode ?? "") ||
        site.deletionStatus
      ) {
        throw new Error("Published revision is blocked outside a warm/live tenant rollout");
      }
      assertProductionAdapterVerified(site as SiteRecord);
    } else {
      // A prior provider mutation is a receipt-reconciliation workflow, not a
      // fresh growth authorization. It may inspect the exact destination
      // under a later plan/measurement state, but the mutation callback below
      // still requires current authorization before any new external write.
      attemptedRevisionRendererVersion(
        site as SiteRecord,
        article as ArticleRecord,
        revision,
      );
    }
    const leaseOwner = randomUUID();
    const claimed = await ctx.runMutation(
      internal.publishedRevisions.claimExecution,
      { revisionId, leaseOwner },
    );
    if (claimed.idempotent) return { status: "verified", idempotent: true };
    if (claimed.retiredPristine) {
      return {
        status: "failed",
        idempotent: false,
        detail:
          "The expired worker lease was retired because no provider mutation had started.",
      };
    }
    if (claimed.reconciliationExhausted) {
      return {
        status: "unverified",
        idempotent: false,
        requiresOwnerReview: true,
      };
    }

    let deliveryAttempted = Boolean(revision.attemptedAt);
    let attemptMarkedForLease = false;
    const beforeExternalMutation = async () => {
      if (attemptMarkedForLease) return;
      if (recoveringAttemptedDelivery) {
        throw new Error(
          "A prior provider attempt may only be reconciled by an exact read receipt; Pentra will not replay the mutation blindly.",
        );
      }
      if (revision.kind === "strengthen_cluster") {
        if (!revision.targetArticleId || !revision.targetUrl) {
          throw new Error("Internal-link revision lost its exact target receipt");
        }
        const target = await ctx.runQuery(internal.articles.getInternal, {
          articleId: revision.targetArticleId,
        });
        const verifiedTarget = target
          ? verifiedAuthorityTarget({
              site,
              article: target,
              now: Date.now(),
            })
          : null;
        if (
          !verifiedTarget ||
          verifiedTarget.articleId !== revision.targetArticleId ||
          new URL(verifiedTarget.targetUrl).pathname !== revision.targetUrl
        ) {
          throw new Error(
            "Internal-link target is no longer an exact recently verified tenant page",
          );
        }
        const fetchedTarget = await safeFetchPublicText(verifiedTarget.targetUrl, {
          expectedHost: new URL(verifiedTarget.targetUrl).hostname,
          sameHostRedirects: true,
          maxRedirects: 3,
          maxBytes: 1_000_000,
          timeoutMs: 15_000,
          allowedContentTypes: [
            /^text\/html(?:;|$)/i,
            /^application\/xhtml\+xml(?:;|$)/i,
          ],
        });
        verifyLivePublicationPage({
          expectedUrl: verifiedTarget.targetUrl,
          fetchedUrl: fetchedTarget.url,
          html: fetchedTarget.text,
          title: verifiedTarget.title,
        });
      }
      await ctx.runMutation(internal.publishedRevisions.recordAttempted, {
        revisionId,
        leaseOwner,
      });
      attemptMarkedForLease = true;
      deliveryAttempted = true;
    };
    try {
      let receipt: PublishedRevisionReceipt;
      const rendererVersion = attemptedRevisionRendererVersion(
        site as SiteRecord,
        article as ArticleRecord,
        revision,
      );
      switch (site.publishMethod ?? "github") {
        case "github":
          receipt = await reviseGitHub({
            site: site as SiteRecord,
            article: article as ArticleRecord,
            revision,
            beforeExternalMutation,
          });
          break;
        case "wordpress":
          receipt = await reviseWordPress({
            site: site as SiteRecord,
            article: article as ArticleRecord,
            revision,
          });
          break;
        case "webhook":
          receipt = await reviseWebhook({
            site: site as SiteRecord,
            article: article as ArticleRecord,
            revision,
            rendererVersion,
            beforeExternalMutation,
          });
          break;
        default:
          throw new Error("Published revision adapter is unsupported");
      }
      // An exact idempotency read from a prior attempt is settlement, not a
      // new mutation. `recordDelivery` accepts it only when the immutable
      // attempted boundary already exists; never call the mutation-authority
      // callback after the provider has returned read-only proof.
      await ctx.runMutation(internal.publishedRevisions.recordDelivery, {
        revisionId,
        leaseOwner,
        receipt,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.publisher.verifyPublishedRevisionInternal,
        { revisionId, expectedNextArtifactHash: revision.nextArtifactHash, attempt: 0 },
      );
      return { status: "verification_pending", idempotent: false };
    } catch (error) {
      const detail = error instanceof Error
        ? error.message
        : "Published revision failed without an exact receipt";
      const deterministicFailure = !deliveryAttempted;
      await ctx.runMutation(internal.publishedRevisions.recordFailure, {
        revisionId,
        leaseOwner,
        status: deterministicFailure ? "failed" : "unverified",
        code: deterministicFailure ? "precondition_failed" : "delivery_outcome_unverified",
        detail: deterministicFailure
          ? detail
          : "The destination did not return a conclusive receipt. Pentra will only reconcile by reading the exact idempotency key and bytes; it will not blind-write.",
      });
      throw error;
    }
  },
});

export const verifyPublishedRevisionInternal = internalAction({
  args: {
    revisionId: v.id("published_article_revisions"),
    expectedNextArtifactHash: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<{
    status: "verified" | "verification_pending" | "unverified" | "stale";
    retryInMs?: number;
  }> => {
    const context = await ctx.runQuery(
      internal.publishedRevisions.getExecutionContext,
      { revisionId: args.revisionId },
    );
    if (!context || context.revision.nextArtifactHash !== args.expectedNextArtifactHash) {
      return { status: "stale" };
    }
    const { revision } = context;
    if (revision.status === "verified" || revision.status === "rolled_back") {
      return { status: "verified" };
    }
    if (!revision.receipt) return { status: "stale" };
    const leaseOwner = randomUUID();
    const claim = await ctx.runMutation(
      internal.publishedRevisions.claimLiveVerification,
      {
        revisionId: args.revisionId,
        expectedNextArtifactHash: args.expectedNextArtifactHash,
        leaseOwner,
        now: Date.now(),
      },
    );
    if (!claim.claimed) return { status: "verification_pending" };
    const expectedUrl = revision.expectedPublicUrl;
    try {
      const fetched = await safeFetchPublicText(expectedUrl, {
        expectedHost: new URL(expectedUrl).hostname,
        sameHostRedirects: true,
        maxRedirects: 3,
        maxBytes: 1_000_000,
        timeoutMs: 15_000,
        allowedContentTypes: [/^text\/html(?:;|$)/i, /^application\/xhtml\+xml(?:;|$)/i],
        headers: {
          "User-Agent": "Pentra/1.0 (published revision verifier)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      });
      verifyLivePublishedRevision({
        expectedUrl,
        fetchedUrl: fetched.url,
        html: fetched.text,
        base: revision.baseArtifact as PublishedRevisionArtifact,
        next: revision.nextArtifact as PublishedRevisionArtifact,
        kind: revision.kind,
        targetUrl: revision.targetUrl,
      });
      await ctx.runMutation(internal.publishedRevisions.recordLiveVerification, {
        revisionId: args.revisionId,
        expectedNextArtifactHash: args.expectedNextArtifactHash,
        status: "verified",
        attempts: args.attempt + 1,
        leaseOwner,
      });
      return { status: "verified" };
    } catch {
      const retryInMs = REVISION_LIVE_RETRY_DELAYS_MS[args.attempt];
      const status = retryInMs === undefined ? "unverified" : "verification_pending";
      await ctx.runMutation(internal.publishedRevisions.recordLiveVerification, {
        revisionId: args.revisionId,
        expectedNextArtifactHash: args.expectedNextArtifactHash,
        status,
        attempts: args.attempt + 1,
        leaseOwner,
        nextAttemptAt: retryInMs === undefined ? undefined : Date.now() + retryInMs,
        detail: status === "unverified"
          ? "The exact revised artifact could not be verified at the tenant URL after bounded retries."
          : "The destination acknowledged the revision, but the exact live page is not visible yet.",
      });
      if (retryInMs !== undefined) {
        await ctx.scheduler.runAfter(
          retryInMs,
          internal.publisher.verifyPublishedRevisionInternal,
          { ...args, attempt: args.attempt + 1 },
        );
      }
      return { status, retryInMs };
    }
  },
});

// Durable, globally bounded recovery for the narrow window where an exact
// delivery receipt was stored but its immediate verifier could not be
// enqueued. Per-attempt leases make duplicate cron/scheduler delivery safe.
export const recoverPublishedRevisionVerifications = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    considered: number;
    scheduled: number;
    failed: number;
  }> => {
    const due: Array<{
      revisionId: Id<"published_article_revisions">;
      expectedNextArtifactHash: string;
      attempt: number;
    }> = await ctx.runMutation(
      internal.publishedRevisions.listDueLiveVerifications,
      { now: Date.now() },
    );
    let scheduled = 0;
    let failed = 0;
    for (const revision of due) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.publisher.verifyPublishedRevisionInternal,
          revision,
        );
        scheduled += 1;
      } catch {
        // The receipt remains due and will be retried by the next bounded
        // sweep. Never re-deliver the external write from this recovery path.
        failed += 1;
      }
    }
    return { considered: due.length, scheduled, failed };
  },
});

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
  options?: { readOnlyRecoveryOnly?: boolean },
): Promise<PublishResult> {
    const site = await ctx.runQuery(
      internal.sites.getPublicationRecoverySite,
      { siteId: args.siteId },
    );
    if (!site) throw new Error("Site not found");
    const article = await ctx.runQuery(internal.articles.getInternal, {
      articleId: args.articleId,
    });
    if (!article) throw new Error("Article not found");

    if (
      article.siteId !== args.siteId ||
      !articleMatchesCurrentDomain(site, article)
    ) {
      throw new Error("Article does not belong to this site");
    }
    const recoveringUnverifiedPublication = Boolean(
      article.publicationAttemptedAt &&
      article.publicationLeaseOwner &&
      article.publicationLeaseHash &&
      article.publicationDate &&
      article.publicationDeliveryHash &&
      Number.isSafeInteger(article.publicationRolloutEpoch),
    );
    const retainedPristinePublication = Boolean(
      !article.publicationAttemptedAt &&
      !article.publicationOutcomeUnverifiedAt &&
      article.publicationLeaseOwner &&
      article.publicationLeaseHash &&
      article.publicationDate &&
      article.publicationDeliveryHash &&
      Number.isSafeInteger(article.publicationRolloutEpoch),
    );
    if (retainedPristinePublication) {
      const released = await ctx.runMutation(
        internal.articles.releaseExpiredPristinePublication,
        {
          articleId: article._id,
          expectedContentHash: article.publicationLeaseHash!,
          expectedLeaseOwner: article.publicationLeaseOwner!,
        },
      );
      throw new Error(
        released.released
          ? "An expired pre-provider publication lease was safely released; retry after the current audit is rechecked."
          : "The publication lease is still active before its provider boundary.",
      );
    }
    const recoveryAuthorization = recoveringUnverifiedPublication
      ? await ctx.runQuery(
          internal.articles.getPublicationRecoveryAuthorization,
          { articleId: article._id },
        )
      : { receiptOnlyPlanTransition: false };
    if (
      (!site.autopilotEnabled || site.autopilotRolloutMode !== "live") &&
      !recoveryAuthorization.receiptOnlyPlanTransition
    ) {
      throw new Error(
        "External publication is blocked unless this exact tenant is in live canary mode",
      );
    }
    const rolloutEpoch = recoveryAuthorization.receiptOnlyPlanTransition
      ? article.publicationRolloutEpoch!
      : site.autopilotRolloutEpoch ?? 0;

    // Mutable policy is an authorization gate only before the first provider
    // mutation. Once an exact sealed envelope may already exist externally,
    // recovery is receipt reconciliation: current profile, approval, or topic
    // edits cannot strand the immutable delivery outcome.
    if (!recoveringUnverifiedPublication) {
      if (!article.topicId) {
        await ctx.runMutation(internal.articles.setWorkflowStatusInternal, {
          articleId: article._id,
          status: "review",
        });
        throw new Error(
          "Publication quality gate blocked this article: autonomous delivery requires a tenant-scoped measured topic.",
        );
      }
      const topic = await ctx.runQuery(internal.topics.getInternal, {
        topicId: article.topicId,
      });
      if (
        !topic ||
        topic.siteId !== args.siteId ||
        !topicMatchesCurrentDomain(site, topic)
      ) {
        await ctx.runMutation(internal.articles.setWorkflowStatusInternal, {
          articleId: article._id,
          status: "review",
        });
        throw new Error(
          "Publication quality gate blocked this article: its measured topic is missing or belongs to another tenant.",
        );
      }
      const topicFit = evaluateTopicBusinessFit({
        keyword: topic.primaryKeyword,
        label: article.title,
        ...tenantTopicBusinessSignals(site),
      });
      if (!topicFit.eligible) {
        const issue =
          `Measured topic "${topic.primaryKeyword}" failed the current tenant product-fit gate: ${topicFit.reasons.join("; ")}`;
        await ctx.runMutation(internal.articles.recordPublicationCheck, {
          articleId: article._id,
          status: "blocked",
          issues: [issue],
          warnings: [],
        });
        await ctx.runMutation(internal.articles.setWorkflowStatusInternal, {
          articleId: article._id,
          status: "review",
        });
        throw new Error(`Publication quality gate blocked this article: ${issue}`);
      }
    }
    let recoveryMutationAuthorized = true;
    if (recoveringUnverifiedPublication) {
      if (!article.topicId) {
        recoveryMutationAuthorized = false;
      } else {
        const currentTopic = await ctx.runQuery(internal.topics.getInternal, {
          topicId: article.topicId,
        });
        recoveryMutationAuthorized = Boolean(
          currentTopic &&
          currentTopic.siteId === args.siteId &&
          topicMatchesCurrentDomain(site, currentTopic) &&
          evaluateTopicBusinessFit({
            keyword: currentTopic.primaryKeyword,
            label: article.title,
            ...tenantTopicBusinessSignals(site),
          }).eligible,
        );
      }
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
    const recoveryDestinationMatches = recoveringUnverifiedPublication &&
      publicationDeliveryDestinationHash(currentConfig) ===
        publicationDeliveryDestinationHash(sealedConfig);
    if (
      sealedConfigHash !== article.publicationConfigHash ||
      (currentConfigHash !== article.publicationConfigHash &&
        !recoveryDestinationMatches)
    ) {
      throw new Error("Publication destination changed after quality audit");
    }
    if (recoveringUnverifiedPublication) {
      assertAttemptedAdapterContract(site as SiteRecord, article as ArticleRecord);
    } else {
      assertProductionAdapterVerified(site as SiteRecord);
    }
    if (site.publishMethod === "manual") {
      throw new Error(
        "Manual delivery cannot be marked published without an external publication receipt.",
      );
    }
    if (article.status !== "review" && article.status !== "ready" && article.status !== "published") {
      if (!recoveringUnverifiedPublication) {
        throw new Error(`Article workflow status '${article.status}' is not publishable`);
      }
      recoveryMutationAuthorized = false;
    }
    if (
      !recoveringUnverifiedPublication &&
      site.approvalRequired &&
      article.status !== "ready" &&
      article.status !== "published"
    ) {
      throw new Error("Article requires explicit owner approval before publication");
    }
    if (
      recoveringUnverifiedPublication &&
      site.approvalRequired &&
      article.status !== "ready" &&
      article.status !== "published"
    ) {
      recoveryMutationAuthorized = false;
    }

    // Autonomous quality is tenant-independent. A hostname must never weaken
    // the publication contract for a customer.
    const mode: PublicationQualityMode = "strict";
    const quality = evaluatePublicationQuality(article, mode);
    if (!recoveringUnverifiedPublication) {
      await ctx.runMutation(internal.articles.recordPublicationCheck, {
        articleId: article._id,
        status: quality.passed ? "passed" : "blocked",
        issues: quality.issues,
        warnings: quality.warnings,
      });
    }
    if (!quality.passed) {
      if (!recoveringUnverifiedPublication) {
        await ctx.runMutation(internal.articles.setWorkflowStatusInternal, {
          articleId: article._id,
          status: "review",
        });
        throw new Error(
          `Publication quality gate blocked this article: ${quality.issues.join(" ")}`,
        );
      }
    }

    const auditVersion = article.publicationAuditVersion;
    if (!Number.isInteger(auditVersion) || !article.auditedContentHash) {
      throw new Error(
        "Publication quality gate blocked this article: the exact final artifact has no supported audit seal.",
      );
    }
    if (
      !recoveringUnverifiedPublication &&
      auditVersion !== PUBLICATION_AUDIT_VERSION
    ) {
      throw new Error(
        "Publication quality gate blocked this article: the exact final artifact has not completed the current audit.",
      );
    }
    const contentHash = publicationArtifactHashForAuditVersion(
      article,
      auditVersion!,
    );
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
    const hadPriorAttempt = lease.deliveryPreviouslyAttempted === true;
    if (
      !lease.publicationDate ||
      !lease.publicationDeliveryHash ||
      !Number.isSafeInteger(lease.publicationRolloutEpoch)
    ) {
      if (!hadPriorAttempt) {
        await ctx.runMutation(internal.articles.releasePublication, {
          articleId: article._id,
          expectedContentHash: contentHash,
          leaseOwner,
        });
      }
      throw new Error("Publication lease did not return a sealed delivery envelope");
    }
    const deliveryRolloutEpoch = lease.publicationRolloutEpoch!;
    const deliveryKey = publicationDeliveryKey(lease.publicationDeliveryHash);

    const lockedSite = await ctx.runQuery(internal.sites.getPublicationRecoverySite, {
      siteId: args.siteId,
    });
    if (
      !lockedSite ||
      !articleMatchesCurrentDomain(lockedSite, article) ||
      (!recoveryAuthorization.receiptOnlyPlanTransition &&
        (lockedSite.autopilotRolloutMode !== "live" ||
          (lockedSite.autopilotRolloutEpoch ?? 0) !== deliveryRolloutEpoch)) ||
      (publicationDeliveryConfigHash(publicationDeliveryConfig(lockedSite)) !==
          article.publicationConfigHash &&
        !(hadPriorAttempt &&
          publicationDeliveryDestinationHash(
            publicationDeliveryConfig(lockedSite),
          ) === publicationDeliveryDestinationHash(sealedConfig)))
    ) {
      if (hadPriorAttempt) {
        await ctx.runMutation(
          internal.articles.recordPublicationOutcomeUnverified,
          {
            articleId: article._id,
            expectedContentHash: contentHash,
            leaseOwner,
            detail:
              "The prior external publication outcome is still unresolved; a retry lost its rollout or destination boundary before provider access.",
          },
        );
      } else {
        await ctx.runMutation(internal.articles.releasePublication, {
          articleId: article._id,
          expectedContentHash: contentHash,
          leaseOwner,
        });
      }
      throw new Error("Rollout or publication configuration changed before delivery");
    }
    if (hadPriorAttempt) {
      assertAttemptedAdapterContract(
        lockedSite as SiteRecord,
        article as ArticleRecord,
      );
    } else {
      assertProductionAdapterVerified(lockedSite as SiteRecord);
    }

    const deliverySite: SiteRecord = {
      ...(lockedSite as SiteRecord),
      ...sealedConfig,
    };

    let deliveryAttempted = hadPriorAttempt;
    let attemptMarkedForLease = false;
    const beforeExternalMutation = async () => {
      if (attemptMarkedForLease) return;
      if (options?.readOnlyRecoveryOnly) {
        throw new Error(
          "The scheduled publication watchdog is receipt-only and cannot replay an external write.",
        );
      }
      if (hadPriorAttempt && !recoveryMutationAuthorized) {
        throw new Error(
          "Current owner policy permits read-only reconciliation only; a new external publication mutation is blocked.",
        );
      }
      await ctx.runMutation(internal.articles.recordPublicationAttempted, {
        articleId: article._id,
        expectedContentHash: contentHash,
        leaseOwner,
      });
      attemptMarkedForLease = true;
      deliveryAttempted = true;
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
            auditVersion!,
            beforeExternalMutation,
          );
          break;
        case "wordpress":
          result = await publishToWordPress(
            deliverySite,
            article as ArticleRecord,
            deliveryKey,
            contentHash,
            sealedConfig.rendererVersion ?? PUBLISHER_RENDERER_VERSION,
            beforeExternalMutation,
          );
          break;
        case "webhook":
          result = await publishToWebhook(
            deliverySite,
            article as ArticleRecord,
            deliveryKey,
            contentHash,
            lease.publicationDate,
            sealedConfig.rendererVersion ?? PUBLISHER_RENDERER_VERSION,
            beforeExternalMutation,
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
        expectedRolloutEpoch: deliveryRolloutEpoch,
        leaseOwner,
        receipt: result.receipt,
      });
      return result;
    } catch (error) {
      if (deliveryAttempted) {
        const detail = error instanceof Error
          ? error.message
          : "Publication delivery outcome is unverified";
        await ctx.runMutation(
          internal.articles.recordPublicationOutcomeUnverified,
          {
            articleId: article._id,
            expectedContentHash: contentHash,
            leaseOwner,
            detail:
              `The destination did not return a conclusive receipt. ` +
              `Pentra retained the exact delivery key and configuration lock for idempotent reconciliation. ${detail}`,
          },
        );
      } else {
        await ctx.runMutation(internal.articles.releasePublication, {
          articleId: article._id,
          expectedContentHash: contentHash,
          leaseOwner,
        });
      }
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
    if (
      !site ||
      !article ||
      article.siteId !== args.siteId ||
      !articleMatchesCurrentDomain(site, article)
    ) {
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

/** Exact-generation watchdog armed by the first publication lease. It is
 * deliberately separate from the ordinary publisher entry point: pristine
 * worker death is provider-free cleanup, and a durable prior attempt may only
 * perform an idempotent destination read. A stale generation is a no-op. */
export const recoverInitialPublicationLeaseInternal = internalAction({
  args: {
    ...publishArgs,
    expectedContentHash: v.string(),
    expectedLeaseOwner: v.string(),
  },
  handler: async (ctx, args): Promise<{
    status: "stale" | "active" | "released_pristine" | "settled" | "unverified";
  }> => {
    const [site, article] = await Promise.all([
      ctx.runQuery(internal.sites.getPublicationRecoverySite, {
        siteId: args.siteId,
      }),
      ctx.runQuery(internal.articles.getInternal, {
        articleId: args.articleId,
      }),
    ]);
    if (
      !site ||
      !article ||
      article.siteId !== args.siteId ||
      article.publicationLeaseHash !== args.expectedContentHash ||
      article.publicationLeaseOwner !== args.expectedLeaseOwner ||
      site.publicationLeaseOwner !== args.expectedLeaseOwner
    ) {
      return { status: "stale" };
    }
    const leaseExpiry = Math.max(
      (article.publicationLeaseStartedAt ?? Number.POSITIVE_INFINITY) +
        PUBLICATION_LEASE_MS,
      site.publicationLeaseExpiresAt ?? Number.POSITIVE_INFINITY,
    );
    if (leaseExpiry > Date.now()) return { status: "active" };

    if (!article.publicationAttemptedAt) {
      const released = await ctx.runMutation(
        internal.articles.releaseExpiredPristinePublication,
        {
          articleId: article._id,
          expectedContentHash: args.expectedContentHash,
          expectedLeaseOwner: args.expectedLeaseOwner,
        },
      );
      return { status: released.released ? "released_pristine" : "stale" };
    }

    try {
      await publishArticleHandler(
        ctx,
        { siteId: args.siteId, articleId: article._id },
        { readOnlyRecoveryOnly: true },
      );
      return { status: "settled" };
    } catch {
      // The handler durably retains an unverified attempted envelope when no
      // exact receipt exists. Owner-reviewed disposition remains available
      // after the newly acquired recovery lease expires.
      return { status: "unverified" };
    }
  },
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
