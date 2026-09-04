import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION,
  isSealedReady,
  needsDeterministicInternalLinkRepair,
  needsPublicationAuditRefresh,
} from "../convex/lib/autopilotBuffer.ts";
import { PUBLICATION_AUDIT_VERSION } from "../convex/lib/publicationArtifact.ts";
import {
  appendRelatedInternalLinks,
  selectRelatedInternalLinks,
} from "../convex/lib/internalLinks.ts";

/**
 * Regression for stranded sealed inventory.
 *
 * When PUBLICATION_AUDIT_VERSION increments, an article that was sealed under
 * the previous version keeps status "ready" and gate "passed" but stops
 * satisfying isSealedReady. Nothing reclaimed it: the scheduler's quality and
 * mechanical-repair paths only inspect articles in "review", so the article
 * counted toward no buffer, blocked nothing, and was never re-audited.
 *
 * Estiflow sat on exactly this for 51 days with two otherwise publishable
 * articles. It is tenant-generic: it strands every customer holding ready
 * inventory at the moment of an audit-version bump.
 */

const STALE_VERSION = PUBLICATION_AUDIT_VERSION - 1;
const autopilotSource = readFileSync(
  new URL("../convex/autopilot.ts", import.meta.url),
  "utf8",
);
const schedulerSource = readFileSync(
  new URL("../convex/actions/scheduler.ts", import.meta.url),
  "utf8",
);
const articlesSource = readFileSync(
  new URL("../convex/articles.ts", import.meta.url),
  "utf8",
);

function readyArticle(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    publicationGateStatus: "passed",
    publicationAuditVersion: STALE_VERSION,
    auditedContentHash: "hash-from-previous-version",
    ...overrides,
  };
}

test("an article sealed under a previous audit version is not sealed now", () => {
  assert.equal(isSealedReady(readyArticle()), false);
  assert.equal(
    isSealedReady(readyArticle({
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      auditedContentHash: "current",
    })),
    true,
  );
});

test("stranded ready inventory is identified for re-audit", () => {
  // The exact Estiflow shape: ready, gate passed, audit version 4.
  assert.equal(needsPublicationAuditRefresh(readyArticle()), true);
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({ publicationAuditVersion: undefined })),
    true,
    "an article never stamped with a version is also stranded",
  );
});

test("the natural fleet reaches provider-free refresh before observe promotion", () => {
  const observeBranch = autopilotSource.indexOf(
    'if (currentMode === "observe")',
  );
  const refreshDispatch = autopilotSource.indexOf(
    "internal.actions.scheduler.reclaimStrandedPublicationInventory",
    observeBranch,
  );
  const promotionReadiness = autopilotSource.indexOf(
    "oneSetupPromotionBlockers(ctx, site)",
    observeBranch,
  );

  assert.ok(observeBranch >= 0);
  assert.ok(refreshDispatch > observeBranch);
  assert.ok(promotionReadiness > refreshDispatch);
  assert.match(
    schedulerSource,
    /export const reclaimStrandedPublicationInventory = internalAction\([\s\S]*reclaimStrandedInventory/,
  );
});

test("an exhausted orphan gets one provider-free same-tenant related-link repair", () => {
  const issue =
    "Strict publication requires at least one internal link so the page joins a topic cluster.";
  const article = {
    status: "review",
    publicationGateStatus: "blocked",
    publicationGateIssues: [issue],
  };
  assert.equal(needsDeterministicInternalLinkRepair(article), true);
  assert.equal(
    needsDeterministicInternalLinkRepair({
      ...article,
      deterministicInternalLinkRepairVersion:
        DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION,
    }),
    false,
  );

  const links = selectRelatedInternalLinks({
    currentTitle: "How to Create a Construction Programme for Residential Projects",
    destinations: [{
      href: "/deliverables",
      title: "Deliverables",
      keywords: ["construction programme", "subcontractor pricing"],
    }],
    limit: 1,
  });
  assert.deepEqual(links, [{
    anchor: "construction programme",
    href: "/deliverables",
  }]);
  const repaired = appendRelatedInternalLinks("# Programme\n\nBody.", links);
  assert.match(repaired.markdown, /\[construction programme\]\(\/deliverables\)/);
  assert.match(
    articlesSource,
    /deterministicInternalLinkRepair[\s\S]*evaluatePublicationQuality\(candidate, "strict"\)/,
  );
});

test("current, blocked and unfinished work is never re-audited", () => {
  // Already current: nothing to reclaim.
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    })),
    false,
  );
  // A blocked article belongs to the quality-revision path, not this one.
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({ publicationGateStatus: "blocked" })),
    false,
  );
  for (const status of ["review", "draft", "published", "generating"]) {
    assert.equal(
      needsPublicationAuditRefresh(readyArticle({ status })),
      false,
      status,
    );
  }
});

test("an article mid-delivery or holding a reviewed ambiguity is untouchable", () => {
  // These mirror assertNotPublishing: re-auditing here could race a live
  // publication or discard an operator-reviewed external ambiguity.
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({ publicationLeaseOwner: "worker-1" })),
    false,
  );
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({ publicationLeaseHash: "abc" })),
    false,
  );
  assert.equal(
    needsPublicationAuditRefresh(
      readyArticle({ publicationAmbiguityDispositionAt: 1787000000000 }),
    ),
    false,
  );
  assert.equal(
    needsPublicationAuditRefresh(readyArticle({ publicationAttemptedAt: 1787000000000 })),
    false,
    "an article that already attempted delivery keeps its contract",
  );
});

test("re-audit is the only way stranded inventory can rejoin the buffer", () => {
  const stranded = readyArticle();
  assert.equal(isSealedReady(stranded), false);
  assert.equal(needsPublicationAuditRefresh(stranded), true);

  // A successful re-audit stamps the current version and a fresh hash.
  const resealed = {
    ...stranded,
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
    auditedContentHash: "freshly-audited-hash",
  };
  assert.equal(isSealedReady(resealed), true);
  assert.equal(needsPublicationAuditRefresh(resealed), false);

  // A re-audit that fails strict quality must demote, never seal.
  const demoted = {
    ...stranded,
    status: "review",
    publicationGateStatus: "blocked",
    publicationAuditVersion: undefined,
    auditedContentHash: undefined,
  };
  assert.equal(isSealedReady(demoted), false);
  assert.equal(
    needsPublicationAuditRefresh(demoted),
    false,
    "a demoted article belongs to the quality path, not another re-audit",
  );
});

test("re-audit binds stale sealed inventory to current tenant product fit", () => {
  const refresh = articlesSource.slice(
    articlesSource.indexOf("export const refreshPublicationAudit"),
    articlesSource.indexOf("export const applyDeterministicQualityRepair"),
  );
  const fit = refresh.indexOf("evaluateTopicBusinessFit");
  const quality = refresh.indexOf("evaluatePublicationQuality");
  assert.ok(fit >= 0, "refresh must re-evaluate the measured topic");
  assert.ok(quality > fit, "topic fit must fail before prose can be resealed");
  assert.match(refresh, /reason: "business_fit_failed"/);
  assert.match(refresh, /terminalTopicFitSettlement/);
  assert.match(refresh, /publicationAuditVersion: undefined/);
});
