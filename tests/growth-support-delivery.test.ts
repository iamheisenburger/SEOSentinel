import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  growthSupportDeliveryReceiptsMatch,
  isTerminalPublishedRevisionStatus,
  legacyExecutedSupportRevisionAdmission,
  MAX_LEGACY_SUPPORT_DELIVERY_CANDIDATES,
  selectLegacySupportDeliveryAdoptionCandidate,
  SUPPORT_DELIVERY_VERIFIED_STATUS,
  verifiedGrowthSupportDelivery,
  verifiedGrowthSupportDeliveryCandidate,
  verifiedGrowthSupportDeliveryEvidence,
  type GrowthSupportDeliveryCandidate,
} from "../convex/lib/growthSupportDelivery.ts";
import { publicationDeliveryKey } from "../convex/lib/publicationArtifact.ts";

const site = {
  _id: "site-a",
  domain: "https://example.com",
  urlStructure: "/blog/[slug]",
  publishMethod: "github",
};

const action = {
  _id: "action-a",
  siteId: site._id,
  articleId: "parent-article",
  fingerprint: "growth-action-a",
  stage: "striking_distance",
  actionKind: "strengthen_cluster",
  status: "open",
  automationStatus: "executed",
};

const topic = {
  _id: "support-topic",
  siteId: site._id,
  growthParentArticleId: action.articleId,
  growthActionFingerprint: action.fingerprint,
};

const publishedAt = Date.UTC(2026, 7, 23, 13, 30);
const deliveryHash = "d".repeat(64);
const contentHash = "c".repeat(64);
const supportArticle = {
  _id: "support-article",
  siteId: site._id,
  topicId: topic._id,
  status: "published",
  title: "Support article",
  slug: "/support-article",
  publishedContentHash: contentHash,
  publicationDeliveryHash: deliveryHash,
  publishedAt,
  publicUrl: "https://example.com/blog/support-article",
  publicUrlStatus: "verified" as const,
  publicUrlLastCheckedAt: publishedAt + 30_000,
  publicUrlVerifiedAt: publishedAt + 30_000,
  publicUrlCheckAttempts: 1,
  publicationReceipt: {
    method: "github" as const,
    deliveryKey: publicationDeliveryKey(deliveryHash),
    contentHash,
    externalId: "commit-a",
    url: "https://github.com/example/site/commit/commit-a",
    status: "committed",
    receivedAt: publishedAt,
  },
};

function adoptionRecord(candidate: GrowthSupportDeliveryCandidate) {
  return {
    articleId: candidate.receipt.articleId,
    status: "published",
    publishedAt: candidate.publishedAt,
    candidate,
  };
}

test("an exact support publication receipt proves the completed support phase", () => {
  const receipt = verifiedGrowthSupportDelivery({
    site,
    action,
    topic,
    article: supportArticle,
  });

  assert.deepEqual(receipt, {
    articleId: supportArticle._id,
    method: "github",
    deliveryKey: publicationDeliveryKey(deliveryHash),
    contentHash,
    externalId: "commit-a",
    status: "committed",
    receivedAt: publishedAt,
  });
  assert.equal(growthSupportDeliveryReceiptsMatch(receipt!, receipt!), true);
  assert.equal(
    growthSupportDeliveryReceiptsMatch(receipt!, {
      ...receipt!,
      externalId: "different-commit",
    }),
    false,
  );
});

test("legacy adoption requires the exact current live tenant URL", () => {
  const evidence = verifiedGrowthSupportDeliveryEvidence({
    site,
    action,
    topic,
    article: supportArticle,
    now: publishedAt + 60_000,
  });
  assert.ok(evidence);
  assert.equal(evidence.topicId, topic._id);
  assert.equal(evidence.targetUrl, supportArticle.publicUrl);
  assert.equal(evidence.receipt.articleId, supportArticle._id);

  assert.equal(
    verifiedGrowthSupportDeliveryEvidence({
      site,
      action,
      topic,
      article: {
        ...supportArticle,
        publicUrl: "https://other.example/blog/support-article",
      },
      now: publishedAt + 60_000,
    }),
    null,
  );
  assert.equal(
    verifiedGrowthSupportDeliveryEvidence({
      site,
      action,
      topic,
      article: {
        ...supportArticle,
        publicUrlVerifiedAt: undefined,
      },
      now: publishedAt + 60_000,
    }),
    null,
  );
});

test("multiple exact support topics adopt the immutable first external receipt", () => {
  const laterTopic = { ...topic, _id: "support-topic-later" };
  const laterDeliveryHash = "e".repeat(64);
  const laterArticle = {
    ...supportArticle,
    _id: "support-article-later",
    topicId: laterTopic._id,
    slug: "/support-article-later",
    publicUrl: "https://example.com/blog/support-article-later",
    publishedAt: publishedAt + 3_600_000,
    publicUrlLastCheckedAt: publishedAt + 3_660_000,
    publicUrlVerifiedAt: publishedAt + 3_660_000,
    publicationDeliveryHash: laterDeliveryHash,
    publicationReceipt: {
      ...supportArticle.publicationReceipt,
      deliveryKey: publicationDeliveryKey(laterDeliveryHash),
      externalId: "commit-later",
      receivedAt: publishedAt + 3_600_000,
    },
  };
  const earlier = verifiedGrowthSupportDeliveryEvidence({
    site,
    action,
    topic,
    article: supportArticle,
    now: publishedAt + 7_200_000,
  });
  const later = verifiedGrowthSupportDeliveryEvidence({
    site,
    action,
    topic: laterTopic,
    article: laterArticle,
    now: publishedAt + 7_200_000,
  });
  assert.ok(earlier && later);
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [adoptionRecord(later), adoptionRecord(earlier)],
    })?.receipt.articleId,
    supportArticle._id,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action: { ...action, fingerprint: "other-action" },
      records: [adoptionRecord(earlier)],
    }),
    null,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        adoptionRecord(earlier),
        adoptionRecord({ ...later, publishedAt: earlier.publishedAt }),
      ],
    }),
    null,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action: { ...action, publishedRevisionId: "revision-a" },
      records: [adoptionRecord(earlier)],
    }),
    null,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        adoptionRecord(earlier),
        adoptionRecord({
          ...later,
          receipt: {
            ...later.receipt,
            articleId: earlier.receipt.articleId,
          },
        }),
      ],
    }),
    null,
  );
  const overflow = Array.from(
    { length: MAX_LEGACY_SUPPORT_DELIVERY_CANDIDATES + 1 },
    (_, index) => ({
      ...earlier,
      topicId: `support-topic-${index}`,
      receipt: {
        ...earlier.receipt,
        articleId: `support-article-${index}`,
      },
    }),
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: overflow.map(adoptionRecord),
    }),
    null,
  );
});

test("an older exact receipt without current live proof cannot fall through", () => {
  const month = 31 * 24 * 60 * 60 * 1000;
  const freshPublishedAt = publishedAt + month;
  const freshTopic = { ...topic, _id: "fresh-support-topic" };
  const freshDeliveryHash = "f".repeat(64);
  const freshArticle = {
    ...supportArticle,
    _id: "fresh-support-article",
    topicId: freshTopic._id,
    slug: "/fresh-support-article",
    publicUrl: "https://example.com/blog/fresh-support-article",
    publishedAt: freshPublishedAt,
    publicUrlLastCheckedAt: freshPublishedAt + 30_000,
    publicUrlVerifiedAt: freshPublishedAt + 30_000,
    publicationDeliveryHash: freshDeliveryHash,
    publicationReceipt: {
      ...supportArticle.publicationReceipt,
      deliveryKey: publicationDeliveryKey(freshDeliveryHash),
      externalId: "commit-fresh",
      receivedAt: freshPublishedAt,
    },
  };
  const timestamp = freshPublishedAt + 60_000;
  const olderCandidate = verifiedGrowthSupportDeliveryCandidate({
    site,
    action,
    topic,
    article: supportArticle,
  });
  const freshCandidate = verifiedGrowthSupportDeliveryCandidate({
    site,
    action,
    topic: freshTopic,
    article: freshArticle,
  });
  const freshEvidence = verifiedGrowthSupportDeliveryEvidence({
    site,
    action,
    topic: freshTopic,
    article: freshArticle,
    now: timestamp,
  });
  assert.ok(olderCandidate && freshCandidate && freshEvidence);
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        adoptionRecord(freshCandidate),
        adoptionRecord(olderCandidate),
      ],
    })?.receipt.articleId,
    supportArticle._id,
  );
  assert.equal(
    verifiedGrowthSupportDeliveryEvidence({
      site,
      action,
      topic,
      article: supportArticle,
      now: timestamp,
    }),
    null,
  );
  assert.equal(freshEvidence.receipt.articleId, freshArticle._id);
});

test("an earlier linked published row without exact receipt proof blocks adoption", () => {
  const candidate = verifiedGrowthSupportDeliveryCandidate({
    site,
    action,
    topic,
    article: supportArticle,
  });
  assert.ok(candidate);
  const verifiedRecord = adoptionRecord(candidate);
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        {
          articleId: "earlier-receiptless",
          status: "published",
          publishedAt: candidate.publishedAt - 1,
          candidate: null,
        },
        verifiedRecord,
      ],
    }),
    null,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        {
          articleId: "unknown-time-receiptless",
          status: "published",
          publishedAt: undefined,
          candidate: null,
        },
        verifiedRecord,
      ],
    }),
    null,
  );
  assert.equal(
    selectLegacySupportDeliveryAdoptionCandidate({
      action,
      records: [
        {
          articleId: "earlier-draft",
          status: "draft",
          publishedAt: candidate.publishedAt - 1,
          candidate: null,
        },
        verifiedRecord,
      ],
    })?.receipt.articleId,
    candidate.receipt.articleId,
  );
});

test("support delivery proof fails closed across tenant, action, topic, or receipt drift", () => {
  assert.equal(
    verifiedGrowthSupportDelivery({
      site,
      action,
      topic: { ...topic, growthActionFingerprint: "different-action" },
      article: supportArticle,
    }),
    null,
  );
  assert.equal(
    verifiedGrowthSupportDelivery({
      site,
      action,
      topic,
      article: {
        ...supportArticle,
        publicationReceipt: {
          ...supportArticle.publicationReceipt,
          status: "accepted",
        },
      },
    }),
    null,
  );
  assert.equal(
    verifiedGrowthSupportDelivery({
      site: { ...site, _id: "site-b" },
      action,
      topic,
      article: supportArticle,
    }),
    null,
  );
});

test("only the exact open legacy executed-support collision enters revision once", () => {
  assert.deepEqual(
    legacyExecutedSupportRevisionAdmission({
      action,
      verifiedSupportDelivery: true,
      anyRevisionExists: false,
    }),
    { allowed: true, reason: "legacy_support_delivery_verified" },
  );
  assert.deepEqual(
    legacyExecutedSupportRevisionAdmission({
      action: {
        ...action,
        automationStatus: SUPPORT_DELIVERY_VERIFIED_STATUS,
      },
      verifiedSupportDelivery: true,
      anyRevisionExists: false,
    }),
    { allowed: true, reason: "legacy_support_delivery_verified" },
  );

  for (const actionOverride of [
    { status: "resolved" },
    { stage: "low_ctr" },
    { actionKind: "improve_snippet" },
    { automationStatus: "no_safe_candidate" },
  ]) {
    assert.equal(
      legacyExecutedSupportRevisionAdmission({
        action: { ...action, ...actionOverride },
        verifiedSupportDelivery: true,
        anyRevisionExists: false,
      }).allowed,
      false,
    );
  }
  assert.deepEqual(
    legacyExecutedSupportRevisionAdmission({
      action,
      verifiedSupportDelivery: false,
      anyRevisionExists: false,
    }),
    { allowed: false, reason: "support_delivery_receipt_missing" },
  );
  assert.deepEqual(
    legacyExecutedSupportRevisionAdmission({
      action: { ...action, publishedRevisionId: "revision-a" },
      verifiedSupportDelivery: true,
      anyRevisionExists: false,
    }),
    { allowed: false, reason: "revision_already_exists" },
  );
});

test("verified and failed terminal revisions can never replay through support admission", () => {
  for (const terminalRevisionStatus of ["verified", "failed"] as const) {
    assert.equal(isTerminalPublishedRevisionStatus(terminalRevisionStatus), true);
    assert.deepEqual(
      legacyExecutedSupportRevisionAdmission({
        action,
        verifiedSupportDelivery: true,
        terminalRevisionStatus,
        anyRevisionExists: false,
      }),
      { allowed: false, reason: "terminal_revision_exists" },
    );
  }
  assert.equal(isTerminalPublishedRevisionStatus("rolled_back"), true);
  assert.equal(isTerminalPublishedRevisionStatus("unverified"), false);
});

test("executed and failed are not made globally retryable", () => {
  const source = readFileSync(
    new URL("../convex/seoGrowth.ts", import.meta.url),
    "utf8",
  );
  const retrySet = source.match(
    /const RETRYABLE_REVISION_AUTOMATION = new Set\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(retrySet, "revision retry set must remain explicit");
  assert.doesNotMatch(retrySet[1]!, /["']executed["']/);
  assert.doesNotMatch(retrySet[1]!, /["']revision_failed["']/);
  assert.match(source, /legacyExecutedSupportRevisionAdmission/);
  assert.match(source, /terminalRevisionStatus/);
  assert.match(source, /getPublishedRevisionReadinessInternal/);
  assert.match(source, /revisionAdapterReadiness/);
  assert.match(source, /publicationAdapterConfigHash/);
  assert.match(source, /MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION \+ 1/);
  assert.match(source, /withIndex\("by_site_growth_action_parent"/);
  assert.match(source, /verifiedGrowthSupportDeliveryCandidate/);
  assert.match(
    source,
    /const selected = selectLegacySupportDeliveryAdoptionCandidate[\s\S]*?const liveEvidence = verifiedGrowthSupportDeliveryEvidence/,
  );
  assert.match(source, /bounded_first_receipt_adoption/);
  assert.match(source, /currentPublicUrl: supportDelivery\?\.targetUrl/);
  assert.match(source, /sourceTopicId: supportDelivery\?\.topicId/);

  const schema = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    schema,
    /\.index\("by_site_growth_action_parent", \[[\s\S]*?"siteId",[\s\S]*?"growthActionFingerprint",[\s\S]*?"growthParentArticleId",[\s\S]*?\]\)/,
  );
});
