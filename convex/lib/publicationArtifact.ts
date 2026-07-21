export const PUBLICATION_AUDIT_VERSION = 4;

// Convex mutations run in the default V8 runtime, where Node's `crypto`
// module is unavailable.  Keep the digest synchronous because the exact same
// helper is used while constructing and while checking the publication seal.
// This is a small, self-contained SHA-256 implementation over UTF-8 bytes.
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotateRight = (value: number, bits: number) =>
    (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(w[index - 15], 7) ^
        rotateRight(w[index - 15], 18) ^
        (w[index - 15] >>> 3);
      const s1 =
        rotateRight(w[index - 2], 17) ^
        rotateRight(w[index - 2], 19) ^
        (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + sigma1 + choice + k[index] + w[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h, (value) => value.toString(16).padStart(8, "0")).join("");
}

export type PublicationArtifact = {
  title: string;
  slug: string;
  markdown: string;
  articleType?: string;
  metaTitle?: string;
  metaDescription?: string;
  language?: string;
  featuredImage?: string;
  reviewedMediaUrls?: string[];
  readingTime?: number;
  wordCount?: number;
  factCheckScore?: number;
  contentScore?: number;
  editorialQualityScore?: number;
  mediaQualityStatus?: string;
  productEvidenceStatus?: string;
  claimEvidenceStatus?: string;
  claimEvidence?: {
    claim: string;
    citationNumbers: number[];
    supported: boolean;
    reason: string;
  }[];
  researchEvidenceSummary?: string;
  productEvidenceHash?: string;
  publicationConfigHash?: string;
  sources?: {
    url: string;
    title?: string;
    excerpt?: string;
    contentHash?: string;
    capturedAt?: number;
  }[];
  internalLinks?: { anchor: string; href: string }[];
};

export type PublicationDeliveryConfig = {
  method: string;
  domain: string;
  urlStructure: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  contentDir?: string;
  wpUrl?: string;
  webhookUrl?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandFontFamily?: string;
};

export type PublicationSiteConfig = {
  domain: string;
  publishMethod?: string;
  urlStructure?: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  wpUrl?: string;
  webhookUrl?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandFontFamily?: string;
};

function normalizedEndpoint(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\/+$/, "");
  return normalized || undefined;
}

function safeUrlStructure(value?: string): {
  urlStructure: string;
  contentDir: string;
} {
  const urlStructure = value?.trim() || "/blog/[slug]";
  if (
    !urlStructure.startsWith("/") ||
    /[?#\\\u0000-\u001f]/.test(urlStructure) ||
    /%(?:2f|5c|00)/i.test(urlStructure)
  ) {
    throw new Error("Publishing URL structure must be a safe absolute web path");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlStructure);
  } catch {
    throw new Error("Publishing URL structure contains invalid encoding");
  }
  const segments = decoded.slice(1).split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.filter((segment) => segment === "[slug]").length !== 1 ||
    segments.at(-1) !== "[slug]" ||
    segments.some(
      (segment) =>
        segment !== "[slug]" && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(segment),
    )
  ) {
    throw new Error(
      "Publishing URL structure must end in exactly one safe [slug] segment",
    );
  }
  const directorySegments = segments.slice(0, -1);
  return {
    urlStructure: `/${segments.join("/")}`,
    contentDir:
      directorySegments.length > 0
        ? `content/${directorySegments.join("/")}`
        : "content/posts",
  };
}

export function safeGitHubRepositoryPart(
  value: string | undefined,
  label: string,
) {
  const normalized = value?.trim();
  if (
    normalized &&
    (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(normalized) ||
      normalized === "." ||
      normalized === "..")
  ) {
    throw new Error(`Invalid GitHub ${label}`);
  }
  return normalized || undefined;
}

export function requireSafeGitHubDefaultBranch(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      "GitHub default branch must be discovered and sealed before publication",
    );
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(normalized) ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".") ||
    normalized
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error("Invalid GitHub default branch");
  }
  return normalized;
}

export function publicationDeliveryConfig(
  site: PublicationSiteConfig,
): PublicationDeliveryConfig {
  const method = site.publishMethod ?? "github";
  if (!["github", "wordpress", "webhook", "manual"].includes(method)) {
    throw new Error(`Unsupported publication method: ${method}`);
  }
  const { urlStructure, contentDir } = safeUrlStructure(site.urlStructure);
  const repoOwner = safeGitHubRepositoryPart(site.repoOwner, "owner");
  const repoName = safeGitHubRepositoryPart(site.repoName, "repository name");
  const repoDefaultBranch =
    method === "github"
      ? requireSafeGitHubDefaultBranch(site.repoDefaultBranch)
      : undefined;
  if (method === "github" && (!repoOwner || !repoName)) {
    throw new Error("GitHub owner and repository are required for publication");
  }
  return {
    method,
    domain: normalizedEndpoint(site.domain)?.toLowerCase() ?? site.domain.trim().toLowerCase(),
    urlStructure,
    repoOwner,
    repoName,
    repoDefaultBranch,
    contentDir: method === "github" ? contentDir : undefined,
    wpUrl: normalizedEndpoint(site.wpUrl),
    webhookUrl: normalizedEndpoint(site.webhookUrl),
    brandPrimaryColor: site.brandPrimaryColor?.trim() || undefined,
    brandAccentColor: site.brandAccentColor?.trim() || undefined,
    brandFontFamily: site.brandFontFamily?.trim() || undefined,
  };
}

export function publicationDeliveryKey(deliveryHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(deliveryHash)) {
    throw new Error("Invalid sealed publication delivery hash");
  }
  return `pentra:${deliveryHash}`;
}

function frontmatterString(markdown: string, key: string): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return undefined;
  const prefix = `${key}:`;
  const line = frontmatter[1]
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  if (!line) return undefined;
  const raw = line.slice(prefix.length).trim();
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" ? value : undefined;
  } catch {
    return raw || undefined;
  }
}

/**
 * Fail-closed classification for a GitHub path that Pentra is about to write.
 * Existing customer-authored files are never overwritten. An exact retry of
 * the same sealed delivery is acknowledged without making another commit.
 */
export function classifyPentraMarkdownDestination(args: {
  existingContent?: string;
  nextContent: string;
  deliveryKey: string;
}): "create" | "overwrite" | "idempotent" {
  if (args.existingContent === undefined) return "create";

  const generator = frontmatterString(args.existingContent, "generator");
  if (generator !== "pentra") {
    throw new Error(
      "Refusing to overwrite a GitHub file that is not marked as Pentra-owned",
    );
  }

  const existingDeliveryKey = frontmatterString(
    args.existingContent,
    "pentraDeliveryKey",
  );
  if (existingDeliveryKey === args.deliveryKey) {
    if (args.existingContent !== args.nextContent) {
      throw new Error(
        "Existing GitHub file has the sealed delivery key but different content",
      );
    }
    return "idempotent";
  }

  return "overwrite";
}

export function publicationDeliveryEnvelopeHash(args: {
  contentHash: string;
  configHash: string;
  publicationDate: number;
  rolloutEpoch: number;
}): string {
  return sha256Hex(JSON.stringify(args));
}

export function publicationDeliveryConfigHash(
  config: PublicationDeliveryConfig,
): string {
  return sha256Hex(JSON.stringify(config));
}

/**
 * Hash the exact artifact handed to a publisher. Keep this explicit: adding a
 * publishable field must be an intentional audit-version change, not an
 * accidental side effect of serialising a database document.
 */
export function publicationArtifactHash(
  article: PublicationArtifact,
): string {
  const canonical = JSON.stringify({
    auditVersion: PUBLICATION_AUDIT_VERSION,
    title: article.title,
    slug: article.slug,
    markdown: article.markdown,
    articleType: article.articleType ?? null,
    metaTitle: article.metaTitle ?? null,
    metaDescription: article.metaDescription ?? null,
    language: article.language ?? null,
    featuredImage: article.featuredImage ?? null,
    reviewedMediaUrls: article.reviewedMediaUrls ?? [],
    readingTime: article.readingTime ?? null,
    wordCount: article.wordCount ?? null,
    factCheckScore: article.factCheckScore ?? null,
    contentScore: article.contentScore ?? null,
    editorialQualityScore: article.editorialQualityScore ?? null,
    mediaQualityStatus: article.mediaQualityStatus ?? null,
    productEvidenceStatus: article.productEvidenceStatus ?? null,
    claimEvidenceStatus: article.claimEvidenceStatus ?? null,
    claimEvidence: (article.claimEvidence ?? []).map((entry) => ({
      claim: entry.claim,
      citationNumbers: entry.citationNumbers,
      supported: entry.supported,
      reason: entry.reason,
    })),
    researchEvidenceSummary: article.researchEvidenceSummary ?? null,
    productEvidenceHash: article.productEvidenceHash ?? null,
    publicationConfigHash: article.publicationConfigHash ?? null,
    // Citation order is semantically meaningful, so arrays are not sorted.
    sources: (article.sources ?? []).map((source) => ({
      url: source.url,
      title: source.title ?? null,
      excerpt: source.excerpt ?? null,
      contentHash: source.contentHash ?? null,
      capturedAt: source.capturedAt ?? null,
    })),
    internalLinks: (article.internalLinks ?? []).map((link) => ({
      anchor: link.anchor,
      href: link.href,
    })),
  });

  return sha256Hex(canonical);
}
