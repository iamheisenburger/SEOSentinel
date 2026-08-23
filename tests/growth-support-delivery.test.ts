import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  growthSupportDeliveryReceiptsMatch,
  isTerminalPublishedRevisionStatus,
  legacyExecutedSupportRevisionAdmission,
  SUPPORT_DELIVERY_VERIFIED_STATUS,
  verifiedGrowthSupportDelivery,
} from "../convex/lib/growthSupportDelivery.ts";
import { publicationDeliveryKey } from "../convex/lib/publicationArtifact.ts";

const site = {
  _id: "site-a",
  publishMethod: "github",
};

const action = {
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
  publishedContentHash: contentHash,
  publicationDeliveryHash: deliveryHash,
  publishedAt,
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
});
