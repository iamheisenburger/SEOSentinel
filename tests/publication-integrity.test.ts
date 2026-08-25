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
  MAX_NEW_CANDIDATES_PER_24H,
  autopilotCandidateBudget,
  autopilotCandidateWindowStart,
  effectivePublishedAt,
} from "../convex/lib/autopilotBuffer.ts";
import {
  acquirePublicationLease,
  nextPublicationRetry,
  ownsPublicationLease,
  PUBLICATION_LEASE_MS,
  reviewedAmbiguityDispositionAllowed,
} from "../convex/lib/publicationLease.ts";
import {
  acquirePublishedRevisionLease,
  PUBLISHED_REVISION_LEASE_MS,
} from "../convex/lib/publishedRevision.ts";
import {
  publishedArticlePublicUrl,
  verifyLivePublicationPage,
} from "../convex/lib/publicationLive.ts";

test("public publication URLs use each tenant's sealed URL structure", () => {
  assert.equal(
    publishedArticlePublicUrl({
      domain: "https://Example.com/ignored",
      urlStructure: "/resources/[slug]",
      slug: "qualified-lead-routing",
    }),
    "https://example.com/resources/qualified-lead-routing",
  );
  assert.throws(
    () => publishedArticlePublicUrl({
      domain: "https://example.com",
      urlStructure: "/blog/[slug]",
      slug: "../admin",
    }),
    /safe path segment/,
  );
});

test("public publication verification requires the exact live page and visible title", () => {
  const expectedUrl = "https://example.com/blog/lead-routing";
  assert.doesNotThrow(() => verifyLivePublicationPage({
    expectedUrl,
    fetchedUrl: `${expectedUrl}/`,
    title: "Lead Routing & Qualification",
    html: "<html><head><title>Different metadata</title></head><body><main><h1>Lead Routing &amp; Qualification</h1></main></body></html>",
  }));
  assert.throws(
    () => verifyLivePublicationPage({
      expectedUrl,
      fetchedUrl: "https://example.com/blog/another-page",
      title: "Lead Routing & Qualification",
      html: "<body><h1>Lead Routing &amp; Qualification</h1></body>",
    }),
    /different canonical URL/,
  );
  assert.throws(
    () => verifyLivePublicationPage({
      expectedUrl,
      fetchedUrl: expectedUrl,
      title: "Lead Routing & Qualification",
      html: "<head><title>Lead Routing &amp; Qualification</title></head><body><p>Not deployed.</p></body>",
    }),
    /does not contain the published article title/,
  );
});

test("warm rollout ignores pre-rollout candidates and can fill its bounded buffer", () => {
  const now = Date.UTC(2026, 6, 21, 12);
  const rolloutStartedAt = now - 60_000;
  assert.equal(
    autopilotCandidateWindowStart({ now, rolloutMode: "warm", rolloutStartedAt }),
    rolloutStartedAt,
  );
  assert.equal(
    autopilotCandidateBudget("warm"),
    MAX_NEW_CANDIDATES_PER_24H,
  );
  assert.equal(
    autopilotCandidateBudget("live"),
    MAX_NEW_CANDIDATES_PER_24H,
  );
});

test("reviewed ambiguity cannot race a newly reacquired recovery lease", () => {
  const now = Date.UTC(2026, 7, 25, 14);
  const oldAttempt = now - 2 * PUBLICATION_LEASE_MS;
  assert.equal(
    reviewedAmbiguityDispositionAllowed({
      attemptedAt: oldAttempt,
      receiptPresent: false,
      workflowLeaseOwner: "recovery-2",
      workflowLeaseStartedAt: now - 1_000,
      siteLeaseOwner: "recovery-2",
      siteLeaseExpiresAt: now + PUBLICATION_LEASE_MS,
      now,
      leaseMs: PUBLICATION_LEASE_MS,
    }),
    false,
  );
  assert.equal(
    reviewedAmbiguityDispositionAllowed({
      attemptedAt: oldAttempt,
      receiptPresent: false,
      workflowLeaseOwner: "recovery-2",
      workflowLeaseStartedAt: now - PUBLICATION_LEASE_MS - 1,
      siteLeaseOwner: "recovery-2",
      siteLeaseExpiresAt: now - 1,
      now,
      leaseMs: PUBLICATION_LEASE_MS,
    }),
    true,
  );
  assert.equal(
    reviewedAmbiguityDispositionAllowed({
      attemptedAt: oldAttempt,
      receiptPresent: false,
      workflowLeaseOwner: undefined,
      workflowLeaseStartedAt: undefined,
      siteLeaseOwner: undefined,
      siteLeaseExpiresAt: undefined,
      now,
      leaseMs: PUBLICATION_LEASE_MS,
    }),
    true,
  );
  assert.equal(
    reviewedAmbiguityDispositionAllowed({
      attemptedAt: oldAttempt,
      receiptPresent: false,
      workflowLeaseOwner: "revision-recovery",
      workflowLeaseStartedAt: now - PUBLISHED_REVISION_LEASE_MS - 1,
      siteLeaseOwner: "different-generation",
      siteLeaseExpiresAt: now - 1,
      now,
      leaseMs: PUBLISHED_REVISION_LEASE_MS,
    }),
    false,
  );
});

test("revision recovery reclaims only an expired lease and preserves prior-attempt evidence", () => {
  const now = Date.UTC(2026, 7, 25, 14);
  const priorAttemptedAt = now - 2 * PUBLISHED_REVISION_LEASE_MS;
  const state = {
    status: "attempted",
    leaseOwner: "worker-1",
    leaseStartedAt: now - PUBLISHED_REVISION_LEASE_MS - 1,
    attempts: 1,
    attemptedAt: priorAttemptedAt,
  };
  const lease = acquirePublishedRevisionLease(state, {
    leaseOwner: "worker-2",
    now,
  });
  assert.equal(lease.idempotent, false);
  assert.deepEqual(lease.patch, {
    status: "leased",
    leaseOwner: "worker-2",
    leaseStartedAt: now,
    attempts: 2,
  });
  // The patch is additive: applying it must not erase the immutable boundary.
  assert.equal(({ ...state, ...lease.patch }).attemptedAt, priorAttemptedAt);
});

test("only a sealed modern receipt can advance the publication clock", () => {
  const createdAt = Date.UTC(2026, 6, 16, 12);
  const maintenanceTimestamp = Date.UTC(2026, 6, 20, 12);
  assert.equal(
    effectivePublishedAt({
      createdAt,
      publishedAt: maintenanceTimestamp,
    }),
    createdAt,
  );
  assert.equal(
    effectivePublishedAt({
      createdAt,
      publishedAt: maintenanceTimestamp,
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "sealed-content-hash",
    }),
    maintenanceTimestamp,
  );
});

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

test("final delivery revalidates current tenant topic fit", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(publisher, /internal\.topics\.getInternal/);
  assert.match(publisher, /evaluateTopicBusinessFit/);
  assert.match(publisher, /\.\.\.tenantTopicBusinessSignals\(site\)/);
  assert.match(publisher, /autonomous delivery requires a tenant-scoped measured topic/);
  assert.match(jobs, /Terminal publication product-fit rejection/);
  assert.match(jobs, /status: "disqualified"/);
  assert.match(jobs, /terminalTopicFit: true/);
  assert.match(pipeline, /qualityQuarantined: terminalTopicFit/);
  assert.match(scheduler, /hasTerminalTopicFitFailure/);
  assert.ok(PUBLICATION_AUDIT_VERSION >= 5);
});

test("external delivery completes before the internal published transition", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const attempted = publisher.indexOf("internal.articles.recordPublicationAttempted");
  const delivery = publisher.indexOf("result = await publishToGitHub");
  const completion = publisher.indexOf("internal.articles.completePublication");
  const release = publisher.lastIndexOf("internal.articles.releasePublication");
  assert.ok(attempted >= 0 && delivery > attempted && completion > delivery);
  assert.ok(release > completion);
  assert.match(publisher, /if \(deliveryAttempted\)/);
  assert.match(publisher, /internal\.articles\.recordPublicationOutcomeUnverified/);
  assert.match(publisher, /retained the exact delivery key and configuration lock/);
  assert.match(publisher, /Not authorized to publish this site/);
});

test("GitHub delivery commits non-executable plain Markdown", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const renderer = readFileSync("convex/lib/safeMarkdownHtml.ts", "utf8");
  assert.match(publisher, /filePath = `\$\{contentDir\}\/\$\{slug\}\.md`/);
  assert.doesNotMatch(publisher, /filePath = `\$\{contentDir\}\/\$\{slug\}\.mdx`/);
  assert.match(renderer, /containsExecutableMdx\(markdown\)/);
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

test("non-GitHub publication seals survive normalization without method drift", () => {
  const webhook = publicationDeliveryConfig({
    domain: "https://example.com",
    publishMethod: "webhook",
    webhookUrl: "https://example.com/api/pentra",
  });
  assert.equal(webhook.method, "webhook");
  assert.deepEqual(publicationDeliveryConfig(webhook), webhook);
  assert.equal(
    publicationDeliveryConfigHash(publicationDeliveryConfig(webhook)),
    publicationDeliveryConfigHash(webhook),
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
  const settings = readFileSync(
    "src/app/(dashboard)/sites/[siteId]/page.tsx",
    "utf8",
  );

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
  assert.match(wizard, /Publishing settings/);
  assert.match(wizard, /\/sites\/\$\{siteId\}\?tab=settings/);
  assert.doesNotMatch(wizard, /repoOwner|repoName|github-oauth/);
  assert.match(settings, /\/api\/github\/auth\?siteId=/);
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

test("every quality terminal state immediately re-enters the bounded scheduler", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const articles = readFileSync("convex/articles.ts", "utf8");
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  assert.match(
    pipeline,
    /processed\.buffered \|\|[\s\S]{0,120}processed\.planCompleted \|\|[\s\S]{0,120}processed\.planContinuationSettled \|\|[\s\S]{0,120}processed\.qualityQuarantined \|\|[\s\S]{0,120}processed\.publicationSucceeded/,
  );
  assert.match(pipeline, /const pendingUnderfilledPlan = activeJobs\.some/);
  assert.match(pipeline, /quality_gate_authorized_bounded_revision/);
  assert.match(pipeline, /strict_gate_authorized_deterministic_mechanical_repair/);
  assert.match(
    pipeline,
    /payload\.metadataOnlyRepair \|\| payload\.deterministicRepair[\s\S]{0,180}applyDeterministicQualityRepair/,
  );
  assert.match(
    articles,
    /applyDeterministicQualityRepair[\s\S]{0,1800}evaluatePublicationQuality\(candidate, "strict"\)/,
  );
  assert.match(
    articles,
    /applyDeterministicQualityRepair[\s\S]{0,1800}candidate = \{[\s\S]{0,300}publicationConfigHash: deliveryConfigHash[\s\S]{0,500}publicationArtifactHash\(candidate\)/,
  );
  assert.match(
    articles,
    /recoverLegacyDeterministicSeal[\s\S]{0,1000}publicationConfigHash: undefined[\s\S]{0,900}article\.auditedContentHash !== legacyContentHash[\s\S]{0,600}evaluatePublicationQuality\(article, "strict"\)/,
  );
  assert.match(pipeline, /sealed_buffer_below_target/);
  assert.match(pipeline, /publication_succeeded_buffer_replenishment/);
  assert.match(
    autopilot,
    /args\.outcome === "publication_succeeded"[\s\S]{0,1500}lastPublishedAt[\s\S]{0,1000}nextPublicationDueAt/,
  );
  assert.match(
    autopilot,
    /refreshSiteCadenceHealth[\s\S]{0,3500}lastPublishedAt[\s\S]{0,1400}nextPublicationDueAt[\s\S]{0,1600}approvedBufferCount/,
  );
  assert.match(
    pipeline,
    /await continueAutopilotAfterProcessedJob\(ctx, args\.siteId, result\)/,
  );
});

test("bounded worker retries schedule their own exact wake-up", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  assert.match(pipeline, /ctx\.scheduler\.runAt\(\s*retry\.nextAttemptAt/);
  assert.match(pipeline, /trigger:\s*"job_retry"/);
  assert.match(jobs, /return \{ updated: true, willRetry, attempts, nextAttemptAt \}/);
});
