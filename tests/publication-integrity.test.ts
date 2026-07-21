import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLICATION_AUDIT_VERSION,
  classifyPentraMarkdownDestination,
  publicationArtifactHash,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryKey,
  requireSafeGitHubDefaultBranch,
} from "../convex/lib/publicationArtifact.ts";
import {
  acquirePublicationLease,
  nextPublicationRetry,
  ownsPublicationLease,
} from "../convex/lib/publicationLease.ts";

const artifact = {
  title: "Grounded workflow",
  slug: "/grounded-workflow",
  markdown: "## Answer\n\nUseful, audited prose.",
  metaTitle: "Grounded workflow",
  metaDescription: "A complete description of the grounded workflow for qualified website conversations.",
  featuredImage: "https://example.com/hero.webp",
  reviewedMediaUrls: ["https://example.com/hero.webp"],
  readingTime: 5,
  wordCount: 1000,
  factCheckScore: 91,
  contentScore: 88,
  editorialQualityScore: 92,
  mediaQualityStatus: "passed",
  productEvidenceStatus: "not_applicable",
  claimEvidenceStatus: "passed",
  sources: [{ url: "https://www.nber.org/papers/w12345", title: "Study" }],
  internalLinks: [{ anchor: "qualified website conversations", href: "/features" }],
};

test("publication digest is stable for the same exact artifact", () => {
  assert.equal(publicationArtifactHash(artifact), publicationArtifactHash({ ...artifact }));
});

test("the V8-safe publication digest is real SHA-256", () => {
  const canonical = JSON.stringify({
    auditVersion: PUBLICATION_AUDIT_VERSION,
    title: artifact.title,
    slug: artifact.slug,
    markdown: artifact.markdown,
    articleType: null,
    metaTitle: artifact.metaTitle,
    metaDescription: artifact.metaDescription,
    language: null,
    featuredImage: artifact.featuredImage,
    reviewedMediaUrls: artifact.reviewedMediaUrls,
    readingTime: artifact.readingTime,
    wordCount: artifact.wordCount,
    factCheckScore: artifact.factCheckScore,
    contentScore: artifact.contentScore,
    editorialQualityScore: artifact.editorialQualityScore,
    mediaQualityStatus: artifact.mediaQualityStatus,
    productEvidenceStatus: artifact.productEvidenceStatus,
    claimEvidenceStatus: artifact.claimEvidenceStatus,
    claimEvidence: [],
    researchEvidenceSummary: null,
    productEvidenceHash: null,
    publicationConfigHash: null,
    sources: artifact.sources.map((source) => ({
      url: source.url,
      title: source.title,
      excerpt: null,
      contentHash: null,
      capturedAt: null,
    })),
    internalLinks: artifact.internalLinks.map((link) => ({
      anchor: link.anchor,
      href: link.href,
    })),
  });
  assert.equal(
    publicationArtifactHash(artifact),
    createHash("sha256").update(canonical).digest("hex"),
  );
});

test("publication digest changes for prose, metadata, media, and links", () => {
  const original = publicationArtifactHash(artifact);
  const mutations = [
    { ...artifact, markdown: `${artifact.markdown}\n\nChanged.` },
    { ...artifact, metaDescription: `${artifact.metaDescription} Changed.` },
    { ...artifact, featuredImage: "https://example.com/other.webp" },
    { ...artifact, internalLinks: [{ anchor: "other", href: "/other" }] },
    { ...artifact, claimEvidenceStatus: "failed" },
  ];
  for (const changed of mutations) {
    assert.notEqual(publicationArtifactHash(changed), original);
  }
});

test("UI and public status mutation cannot bypass a publisher rejection", () => {
  const ui = readFileSync(
    "src/app/(dashboard)/articles/page.tsx",
    "utf8",
  );
  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.doesNotMatch(ui, /updateStatus\(\{[\s\S]{0,120}status:\s*["']published/);
  assert.match(
    articles,
    /Published artifacts are immutable; create a new revision/,
  );
});

test("external delivery completes before the internal published transition", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const delivery = publisher.indexOf("result = await publishToGitHub");
  const completion = publisher.indexOf("internal.articles.completePublication");
  const release = publisher.lastIndexOf("internal.articles.releasePublication");
  assert.ok(delivery >= 0 && completion > delivery);
  assert.ok(release > completion);
  assert.match(publisher, /Not authorized to publish this site/);
});

test("GitHub delivery commits non-executable plain Markdown", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /filePath = `\$\{contentDir\}\/\$\{slug\}\.md`/);
  assert.doesNotMatch(publisher, /filePath = `\$\{contentDir\}\/\$\{slug\}\.mdx`/);
  assert.match(publisher, /containsExecutableMdx\(markdown\)/);
  assert.match(publisher, /pentraDeliveryKey:/);
});

test("GitHub default branch is part of the sealed publication config", () => {
  const base = {
    domain: "https://example.com",
    publishMethod: "github",
    repoOwner: "example",
    repoName: "site",
  };
  assert.throws(
    () => publicationDeliveryConfig(base),
    /default branch must be discovered and sealed/,
  );
  const main = publicationDeliveryConfig({
    ...base,
    repoDefaultBranch: "main",
  });
  const production = publicationDeliveryConfig({
    ...base,
    repoDefaultBranch: "production",
  });
  assert.equal(main.repoDefaultBranch, "main");
  assert.equal(production.repoDefaultBranch, "production");
  assert.notEqual(
    publicationDeliveryConfigHash(main),
    publicationDeliveryConfigHash(production),
  );
  assert.throws(
    () =>
      publicationDeliveryConfig({
        ...base,
        repoDefaultBranch: "../unsafe",
      }),
    /Invalid GitHub default branch/,
  );
});

test("GitHub branch seals reject ambiguous or non-ref-safe values", () => {
  for (const branch of [
    "",
    "../main",
    "feature//escape",
    "feature/.hidden",
    "feature/release.lock",
    "release.",
    "release~1",
    "release@{1}",
  ]) {
    assert.throws(() => requireSafeGitHubDefaultBranch(branch));
  }
  assert.equal(
    requireSafeGitHubDefaultBranch("release/2026.07"),
    "release/2026.07",
  );
});

test("GitHub setup discovers and persists the repository's actual default branch", () => {
  const http = readFileSync("convex/http.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const callback = readFileSync("src/app/api/github/callback/route.ts", "utf8");
  const wizard = readFileSync("src/components/onboarding/setup-wizard.tsx", "utf8");

  assert.match(http, /api\.github\.com\/repos\/\$\{encodeURIComponent\(repoOwner\)\}\/\$\{encodeURIComponent\(repoName\)\}/);
  assert.match(http, /metadata\.default_branch/);
  assert.match(http, /requireSafeGitHubDefaultBranch/);
  assert.match(http, /setGithubTokenInternal,[\s\S]{0,260}repoOwner,[\s\S]{0,80}repoName,[\s\S]{0,80}repoDefaultBranch/);

  const upsert = sites.slice(
    sites.indexOf("export const upsert = mutation"),
    sites.indexOf("export const updateSite = mutation"),
  );
  const update = sites.slice(
    sites.indexOf("export const updateSite = mutation"),
    sites.indexOf("export const deleteSite = mutation"),
  );
  const trustedConnection = sites.slice(
    sites.indexOf("export const setGithubTokenInternal"),
    sites.indexOf("export const setGscTokenInternal"),
  );
  assert.doesNotMatch(upsert, /repoDefaultBranch:\s*v\./);
  assert.doesNotMatch(update, /repoDefaultBranch:\s*v\./);
  assert.match(trustedConnection, /repoDefaultBranch:\s*v\.string\(\)/);
  assert.match(trustedConnection, /requireSafeGitHubDefaultBranch/);
  assert.match(trustedConnection, /currentRepoOwner !== repoOwner \|\| currentRepoName !== repoName/);
  assert.ok([...sites.matchAll(/clearStaleGitHubBranch\(/g)].length >= 4);

  assert.match(callback, /renderPage\(msg, saved,/);
  assert.match(wizard, /await upsert\([\s\S]{0,180}repoOwner:[\s\S]{0,180}popup\.location\.href/);
  assert.doesNotMatch(wizard, /setGithubConnected\(true\)/);
});

test("operators can re-verify a stored GitHub destination without exposing its token", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(publisher, /export const reverifyGithubConnectionInternal = internalAction/);
  assert.match(
    publisher,
    /ctx\.runQuery\(internal\.sites\.getFull,[\s\S]{0,1200}getDefaultBranch\([\s\S]{0,700}internal\.sites\.setGithubTokenInternal/,
  );
  assert.doesNotMatch(
    publisher,
    /return \{ ok: true, repoDefaultBranch, githubToken/,
  );
});

test("sealed delivery key is deterministic and rejects unsealed input", () => {
  const deliveryHash = "a".repeat(64);
  assert.equal(publicationDeliveryKey(deliveryHash), `pentra:${deliveryHash}`);
  assert.throws(() => publicationDeliveryKey("not-a-seal"), /Invalid sealed/);
});

test("GitHub destination ownership and lost-ack retry are fail-closed", () => {
  const deliveryKey = publicationDeliveryKey("b".repeat(64));
  const nextContent = [
    "---",
    'generator: "pentra"',
    `pentraDeliveryKey: ${JSON.stringify(deliveryKey)}`,
    "---",
    "",
    "Audited content.",
    "",
  ].join("\n");

  assert.equal(
    classifyPentraMarkdownDestination({
      nextContent,
      deliveryKey,
    }),
    "create",
  );
  assert.equal(
    classifyPentraMarkdownDestination({
      existingContent: nextContent,
      nextContent,
      deliveryKey,
    }),
    "idempotent",
  );
  assert.equal(
    classifyPentraMarkdownDestination({
      existingContent: nextContent.replace(deliveryKey, `pentra:${"c".repeat(64)}`),
      nextContent,
      deliveryKey,
    }),
    "overwrite",
  );
  assert.throws(
    () =>
      classifyPentraMarkdownDestination({
        existingContent: "---\ntitle: Customer file\n---\n\nDo not overwrite.\n",
        nextContent,
        deliveryKey,
      }),
    /not marked as Pentra-owned/,
  );
  assert.throws(
    () =>
      classifyPentraMarkdownDestination({
        existingContent: `${nextContent}tampered`,
        nextContent,
        deliveryKey,
      }),
    /sealed delivery key but different content/,
  );
});

test("GitHub publisher verifies the sealed branch and reuses exact deliveries", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  assert.match(
    publisher,
    /actualDefaultBranch !== sealedDefaultBranch/,
  );
  assert.match(
    publisher,
    /publicationDeliveryKey\(lease\.publicationDeliveryHash\)/,
  );
  assert.match(
    publisher,
    /destination\.disposition === "idempotent"/,
  );
  assert.match(publisher, /classifyPentraMarkdownDestination/);
  assert.match(publisher, /force: false/);
});

test("lost-ack success is CAS-confirmed at the current GitHub branch head", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const start = publisher.indexOf("async function confirmIdempotentDeliveryAtCurrentHead");
  const end = publisher.indexOf("/** Fallback for empty repos", start);
  assert.ok(start >= 0 && end > start);
  const confirmation = publisher.slice(start, end);
  assert.equal(
    [...confirmation.matchAll(/readGitHubBranchHead\(args\)/g)].length,
    2,
  );
  assert.match(confirmation, /ref: beforeSha/);
  assert.match(confirmation, /destination\.disposition !== "idempotent"/);
  assert.match(confirmation, /afterSha !== beforeSha/);
  assert.equal(
    [...publisher.matchAll(/return confirmIdempotentDeliveryAtCurrentHead\(/g)].length,
    2,
  );
});

test("publication lease excludes a concurrent same-artifact publisher", () => {
  const initial = { status: "ready", auditedContentHash: "hash" };
  const first = acquirePublicationLease(initial, {
    expectedContentHash: "hash",
    leaseOwner: "worker-a",
    now: 1_000,
  });
  assert.equal(first.alreadyPublished, false);
  const leased = { ...initial, ...first.patch };
  assert.throws(
    () =>
      acquirePublicationLease(leased, {
        expectedContentHash: "hash",
        leaseOwner: "worker-b",
        now: 1_001,
      }),
    /already in progress/,
  );
});

test("only the lease owner can complete or release publication", () => {
  const leased = {
    status: "ready",
    auditedContentHash: "hash",
    publicationLeaseHash: "hash",
    publicationLeaseOwner: "worker-a",
    publicationLeaseStartedAt: 1_000,
  };
  assert.equal(
    ownsPublicationLease(leased, {
      expectedContentHash: "hash",
      leaseOwner: "worker-b",
    }),
    false,
  );
  assert.equal(
    ownsPublicationLease(leased, {
      expectedContentHash: "hash",
      leaseOwner: "worker-a",
    }),
    true,
  );
});

test("publication completion rechecks live epoch, configuration, and unexpired leases", () => {
  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /site\.autopilotRolloutMode !== "live"/);
  assert.match(articles, /site\.autopilotRolloutEpoch[\s\S]{0,100}expectedRolloutEpoch/);
  assert.match(articles, /currentConfigHash !== expectedConfigHash/);
  assert.match(articles, /publicationLeaseExpiresAt \?\? 0\) <= completedAt/);
  assert.match(articles, /completedAt - article\.publicationLeaseStartedAt >= PUBLICATION_LEASE_MS/);
  assert.match(articles, /expectedEnvelope !== expectedDeliveryHash/);
});

test("external publication retries are bounded and back off", () => {
  assert.deepEqual(nextPublicationRetry(0), {
    attempts: 1,
    willRetry: true,
    retryDelayMs: 5 * 60 * 1000,
  });
  assert.deepEqual(nextPublicationRetry(1), {
    attempts: 2,
    willRetry: true,
    retryDelayMs: 10 * 60 * 1000,
  });
  assert.deepEqual(nextPublicationRetry(2), {
    attempts: 3,
    willRetry: false,
    retryDelayMs: 15 * 60 * 1000,
  });
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  assert.match(jobs, /internal\.autopilot\.dispatchSiteFollowup/);
  assert.match(jobs, /publishOnly:\s*true/);
});
