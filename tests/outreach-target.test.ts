import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AUTHORITY_TARGET_PUBLIC_RECEIPT_MAX_AGE_MS,
  selectVerifiedAuthorityTargets,
  verifiedAuthorityTarget,
} from "../convex/lib/publicationLive.ts";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const CONTENT_HASH = "a".repeat(64);
const DELIVERY_HASH = "b".repeat(64);
const SITE = {
  domain: "tenant.example",
  urlStructure: "/blog/[slug]",
  publishMethod: "github",
};

function typescriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    // Convex codegen emits type-only references to every module. Generated
    // declarations cannot execute in either V8 or Node and therefore are not
    // runtime importers for this isolation assertion.
    if (entry.isDirectory() && entry.name === "_generated") return [];
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function publishedArticle(overrides: Record<string, unknown> = {}) {
  const publishedAt = NOW - 2 * 24 * 60 * 60 * 1000;
  const verifiedAt = NOW - 24 * 60 * 60 * 1000;
  return {
    _id: "article-published",
    status: "published",
    title: "Website conversion benchmarks",
    slug: "website-conversion-benchmarks",
    metaKeywords: ["website conversion", "conversion benchmarks"],
    publishedContentHash: CONTENT_HASH,
    publicationDeliveryHash: DELIVERY_HASH,
    publicationReceipt: {
      method: "github" as const,
      deliveryKey: `pentra:${DELIVERY_HASH}`,
      contentHash: CONTENT_HASH,
      externalId: "commit-sha",
      url: "https://github.com/tenant/site/commit/abc",
      status: "committed",
      receivedAt: publishedAt - 1_000,
    },
    publishedAt,
    publicUrl:
      "https://tenant.example/blog/website-conversion-benchmarks",
    publicUrlStatus: "verified" as const,
    publicUrlLastCheckedAt: verifiedAt,
    publicUrlVerifiedAt: verifiedAt,
    publicUrlCheckAttempts: 1,
    ...overrides,
  };
}

test("owner and growth authority scans share the same published-target gate", () => {
  const published = publishedArticle();
  const ready = publishedArticle({
    _id: "article-ready",
    status: "ready",
    slug: "unpublished-draft",
    publicUrl: "https://tenant.example/blog/unpublished-draft",
  });

  const ownerInventory = selectVerifiedAuthorityTargets({
    site: SITE,
    articles: [ready, published],
    now: NOW,
  });
  assert.deepEqual(ownerInventory.map((article) => article.articleId), [
    "article-published",
  ]);

  const growthReadyFocus = selectVerifiedAuthorityTargets({
    site: SITE,
    articles: [ready, published],
    now: NOW,
    focusArticleId: "article-ready",
  });
  assert.deepEqual(growthReadyFocus, []);

  const growthPublishedFocus = selectVerifiedAuthorityTargets({
    site: SITE,
    articles: [ready, published],
    now: NOW,
    focusArticleId: "article-published",
  });
  assert.equal(growthPublishedFocus.length, 1);
  assert.equal(
    growthPublishedFocus[0].targetUrl,
    "https://tenant.example/blog/website-conversion-benchmarks",
  );
});

test("stale, cross-host, and unsealed public receipts fail closed", () => {
  assert.equal(
    verifiedAuthorityTarget({
      site: SITE,
      article: publishedArticle({
        publicUrlVerifiedAt:
          NOW - AUTHORITY_TARGET_PUBLIC_RECEIPT_MAX_AGE_MS - 1,
        publicUrlLastCheckedAt:
          NOW - AUTHORITY_TARGET_PUBLIC_RECEIPT_MAX_AGE_MS - 1,
      }),
      now: NOW,
    }),
    null,
    "a stale public-page receipt cannot support fresh outreach",
  );
  assert.equal(
    verifiedAuthorityTarget({
      site: SITE,
      article: publishedArticle({
        publicUrl: "https://other.example/blog/website-conversion-benchmarks",
      }),
      now: NOW,
    }),
    null,
    "a receipt for another host cannot become the tenant replacement URL",
  );
  assert.equal(
    verifiedAuthorityTarget({
      site: SITE,
      article: publishedArticle({ publicationReceipt: undefined }),
      now: NOW,
    }),
    null,
    "published status without the exact external delivery receipt is insufficient",
  );

  const wordpressArticle = publishedArticle({
    publicationReceipt: {
      method: "wordpress" as const,
      deliveryKey: `pentra:${DELIVERY_HASH}`,
      contentHash: CONTENT_HASH,
      externalId: "42",
      url: "https://tenant.example/blog/a-different-post",
      status: "published",
      receivedAt: NOW - 2 * 24 * 60 * 60 * 1000 - 1_000,
    },
  });
  assert.equal(
    verifiedAuthorityTarget({
      site: { ...SITE, publishMethod: "wordpress" },
      article: wordpressArticle,
      now: NOW,
    }),
    null,
    "a CMS acknowledgement for a different destination is not an exact receipt",
  );
});

test("404s, cross-host redirects, and soft 404s cannot become live target receipts", () => {
  const liveVerifier = readFileSync(
    "convex/lib/outreachTargetLive.ts",
    "utf8",
  );
  const transport = readFileSync("convex/lib/safeOutbound.ts", "utf8");
  assert.match(liveVerifier, /safeFetchPublicText\(expected\.href/);
  assert.match(liveVerifier, /expectedHost: expected\.hostname/);
  assert.match(liveVerifier, /sameHostRedirects: true/);
  assert.match(liveVerifier, /verifyLivePublicationPage/);
  assert.match(
    transport,
    /response\.status < 200 \|\| response\.status >= 300/,
    "the bounded transport must throw rather than return a 404 body",
  );
});

test("the live target transport stays isolated to the Node action runtime", () => {
  const verifierPath = "convex/lib/outreachTargetLive.ts";
  const verifier = readFileSync(verifierPath, "utf8");
  assert.match(verifier, /^"use node";\n/);

  const importers = typescriptFiles("convex")
    .filter((path) => path !== verifierPath)
    .filter((path) => readFileSync(path, "utf8").includes("outreachTargetLive"))
    .sort();
  assert.deepEqual(importers, [
    "convex/actions/backlinks.ts",
    "convex/actions/outreach.ts",
  ]);
  for (const importer of importers) {
    assert.match(
      readFileSync(importer, "utf8"),
      /^"use node";\n/,
      `${importer} must remain a Node action module`,
    );
  }
});

test("target proof occurs before persistence, drafting, and the delivery claim", () => {
  const discovery = readFileSync("convex/actions/backlinks.ts", "utf8");
  const drafting = readFileSync("convex/actions/outreach.ts", "utf8");
  const backend = readFileSync("convex/outreach.ts", "utf8");

  assert.doesNotMatch(discovery, /status === "ready"/);
  assert.match(discovery, /listVerifiedAuthorityTargetsInternal/);
  assert.match(discovery, /mentionCandidateLimit/);
  assert.match(discovery, /mentionPageFetchLimit/);
  assert.match(
    discovery,
    /isSameOrganisationHost\(candidate\.hostname, finalUrl\.hostname\)/,
  );
  assert.match(discovery, /hasExactUnlinkedMention/);
  assert.ok(
    discovery.indexOf("await targetIsStillLive(bestMatch)") <
      discovery.indexOf("internal.seoAuthority.upsertVerifiedBatch"),
  );
  const prepare = drafting.slice(
    drafting.indexOf("async function prepareHandler"),
    drafting.indexOf("export const prepareOutreach"),
  );
  assert.ok(
    prepare.indexOf("fetchLiveAuthorityTarget({") >= 0 &&
      prepare.indexOf("fetchLiveAuthorityTarget({") <
        prepare.indexOf("const draft = draftOutreachMessage({"),
  );
  const liveEvidence = drafting.slice(
    drafting.indexOf("async function liveOpportunityEvidence"),
    drafting.indexOf("async function deliver"),
  );
  assert.match(liveEvidence, /fetchLiveAuthorityTarget/);
  assert.match(liveEvidence, /targetReceiptUrl/);
  assert.match(backend, /verifiedAuthorityTarget\(\{ site, article, now \}\)/);
  assert.match(backend, /targetPublicationMatches/);
});
