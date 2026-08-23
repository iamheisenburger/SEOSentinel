import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  acquirePublishedRevisionLease,
  classifyPublishedRevisionDestination,
  deterministicInternalLinkRevision,
  deterministicSnippetRevision,
  legacyGitHubReceiptAdoptionKey,
  publishedRevisionDeliveryKey,
  publishedRevisionKey,
  PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
  rollbackRevisionArtifact,
  selectPreparedPublishedRevision,
  validatePublishedRevisionReceipt,
  verifyLegacyGitHubReceiptAdoptionProof,
  verifyLivePublishedRevision,
  webhookRevisionReceiptFromResponse,
  type PublishedRevisionArtifact,
} from "../convex/lib/publishedRevision.ts";
import {
  publicationArtifactHash,
  publicationArtifactHashForAuditVersion,
  sha256Hex,
} from "../convex/lib/publicationArtifact.ts";

const longBody = Array.from(
  { length: 1_250 },
  (_, index) => `workflow${index}`,
).join(" ");

function artifact(
  overrides: Partial<PublishedRevisionArtifact> = {},
): PublishedRevisionArtifact {
  return {
    title: "A practical website lead qualification workflow",
    slug: "website-lead-qualification-workflow",
    markdown:
      `${longBody}\n\n` +
      "Related reading: [qualification routing workflow](/resources/qualification-routing).",
    metaTitle: "A practical website lead qualification workflow",
    metaDescription:
      "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
    metaKeywords: ["website lead qualification", "qualification routing"],
    featuredImage: "https://example.com/hero.webp",
    reviewedMediaUrls: ["https://example.com/hero.webp"],
    factCheckScore: 91,
    editorialQualityScore: 92,
    mediaQualityStatus: "passed",
    productEvidenceStatus: "not_applicable",
    claimEvidenceStatus: "passed",
    publicationConfigHash: "c".repeat(64),
    internalLinks: [
      { anchor: "qualification routing workflow", href: "/resources/qualification-routing" },
    ],
    ...overrides,
  };
}

const baseReceipt = {
  method: "github" as const,
  deliveryKey: `pentra:${"a".repeat(64)}`,
  contentHash: "b".repeat(64),
  externalId: "base-commit",
  url: "https://github.com/example/site/commit/base",
  status: "committed",
  receivedAt: Date.UTC(2026, 7, 20),
};

test("snippet actuator uses only the measured keyword and existing customer copy", () => {
  const base = artifact({
    metaTitle: "A practical qualification workflow",
    metaDescription:
      "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
  });
  const next = deterministicSnippetRevision({
    artifact: base,
    measuredKeyword: "website lead qualification",
  });
  assert.ok(next);
  assert.equal(next.markdown, base.markdown);
  assert.equal(next.title, base.title);
  assert.match(next.metaTitle ?? "", /website lead qualification/i);
  assert.match(next.metaDescription ?? "", /website lead qualification/i);
  assert.doesNotMatch(next.metaDescription ?? "", /best|guaranteed|increase|boost/i);
});

test("snippet actuator fails closed when no safe measured phrase can change metadata", () => {
  const base = artifact({
    metaTitle: "Website lead qualification workflow",
    metaDescription:
      "Website lead qualification helps teams answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
  });
  assert.equal(
    deterministicSnippetRevision({
      artifact: base,
      measuredKeyword: "website lead qualification",
    }),
    null,
  );
  assert.equal(
    deterministicSnippetRevision({ artifact: base, measuredKeyword: "AI" }),
    null,
  );
});

test("internal-link actuator adds one exact relevant live destination and nothing else", () => {
  const base = artifact();
  const next = deterministicInternalLinkRevision({
    artifact: base,
    urlStructure: "/resources/[slug]",
    liveDestinations: [
      {
        href: "/resources/website-lead-qualification-metrics",
        title: "Website lead qualification metrics",
        keywords: ["website lead qualification"],
      },
    ],
  });
  assert.ok(next);
  assert.equal(next.metaTitle, base.metaTitle);
  assert.equal(next.metaDescription, base.metaDescription);
  assert.match(next.markdown, /\/resources\/website-lead-qualification-metrics/);
  assert.equal((next.internalLinks?.length ?? 0) - (base.internalLinks?.length ?? 0), 1);

  assert.equal(
    deterministicInternalLinkRevision({
      artifact: base,
      urlStructure: "/resources/[slug]",
      liveDestinations: [
        { href: "/resources/payroll-tax", title: "Payroll tax filing" },
      ],
    }),
    null,
  );
});

test("revision key is immutable, action-scoped, and tenant-scoped", () => {
  const base = artifact();
  const next = { ...base, metaTitle: "Website lead qualification: practical workflow" };
  const args = {
    siteId: "site-a",
    articleId: "article-a",
    actionFingerprint: "action-a",
    kind: "improve_snippet" as const,
    baseArtifactHash: publicationArtifactHash(base),
    nextArtifactHash: publicationArtifactHash(next),
    baseReceipt,
  };
  const key = publishedRevisionKey(args);
  assert.equal(key, publishedRevisionKey(args));
  assert.notEqual(key, publishedRevisionKey({ ...args, siteId: "site-b" }));
  assert.notEqual(key, publishedRevisionKey({ ...args, actionFingerprint: "action-b" }));
  assert.equal(publishedRevisionDeliveryKey(key), `pentra:${key}`);
});

test("bounded candidate selection skips receiptless failures and reaches the next safe revision", async () => {
  const prepared: string[] = [];
  const skipped: Array<{ request: string; status: string; detail: string }> = [];
  const selected = await selectPreparedPublishedRevision({
    requests: ["legacy", "weak", "safe", "unused"],
    prepare: async (request) => {
      prepared.push(request);
      if (request === "legacy") throw new Error("missing legacy receipt");
      if (request === "weak") {
        return { status: "no_safe_candidate" as const, detail: "no deterministic change" };
      }
      return {
        status: "prepared" as const,
        detail: "exact receipt",
        revisionId: `revision-${request}`,
      };
    },
    onSkipped: async (request, outcome) => {
      skipped.push({ request, status: outcome.status, detail: outcome.detail });
    },
  });
  assert.deepEqual(prepared, ["legacy", "weak", "safe"]);
  assert.equal(selected.selected?.request, "safe");
  assert.equal(selected.selected?.prepared.revisionId, "revision-safe");
  assert.deepEqual(skipped, [
    {
      request: "legacy",
      status: "no_safe_candidate",
      detail: PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
    },
    {
      request: "weak",
      status: "no_safe_candidate",
      detail: "no deterministic change",
    },
  ]);
});

test("bounded candidate selection stops on tenant allowance instead of preparing later work", async () => {
  const prepared: string[] = [];
  const selected = await selectPreparedPublishedRevision({
    requests: ["bounded", "must-not-run"],
    prepare: async (request) => {
      prepared.push(request);
      return { status: "bounded_wait" as const, detail: "tenant daily bound" };
    },
    onSkipped: async () => undefined,
  });
  assert.deepEqual(prepared, ["bounded"]);
  assert.equal(selected.selected, undefined);
  assert.equal(selected.lastSkipped?.status, "bounded_wait");
});

test("a terminal failed existing revision is skipped so the next safe candidate can execute", async () => {
  const skipped: string[] = [];
  const selected = await selectPreparedPublishedRevision({
    requests: ["failed-existing", "next-safe"],
    prepare: async (request) => request === "failed-existing"
      ? {
          status: "no_safe_candidate" as const,
          detail: "terminal failed revision",
        }
      : {
          status: "prepared" as const,
          detail: "next exact receipt",
          revisionId: "revision-next-safe",
        },
    onSkipped: async (request) => {
      skipped.push(request);
    },
  });
  assert.deepEqual(skipped, ["failed-existing"]);
  assert.equal(selected.selected?.request, "next-safe");
  assert.equal(
    selected.selected?.prepared.revisionId,
    "revision-next-safe",
  );
});

test("legacy GitHub adoption requires exact renderer bytes, embedded key, file SHA, and stable branch", () => {
  const deliveryKey = `pentra:${"1".repeat(64)}`;
  const content = [
    "---",
    'generator: "pentra"',
    `pentraDeliveryKey: "${deliveryKey}"`,
    "qualityGateVersion: 4",
    'canonicalUrl: "https://example.com/blog/legacy"',
    "---",
    "",
    "Legacy article",
    "",
  ].join("\n");
  const proof = verifyLegacyGitHubReceiptAdoptionProof({
    expectedContent: content,
    observedContent: content,
    deliveryKey,
    branchHeadBefore: "a".repeat(40),
    branchHeadAfter: "a".repeat(40),
    fileSha: "b".repeat(40),
  });
  assert.equal(proof.externalContentHash, sha256Hex(content));
  assert.throws(
    () => verifyLegacyGitHubReceiptAdoptionProof({
      expectedContent: content,
      observedContent: `${content}customer edit\n`,
      deliveryKey,
      branchHeadBefore: "a".repeat(40),
      branchHeadAfter: "a".repeat(40),
      fileSha: "b".repeat(40),
    }),
    /sealed delivery key but different content/,
  );
  assert.throws(
    () => verifyLegacyGitHubReceiptAdoptionProof({
      expectedContent: content,
      observedContent: content,
      deliveryKey,
      branchHeadBefore: "a".repeat(40),
      branchHeadAfter: "c".repeat(40),
      fileSha: "b".repeat(40),
    }),
    /branch changed/,
  );
});

test("legacy adoption and artifact seals are audit-version aware and tenant scoped", () => {
  const base = artifact();
  assert.notEqual(
    publicationArtifactHashForAuditVersion(base, 4),
    publicationArtifactHash(base),
  );
  const args = {
    siteId: "site-a",
    articleId: "article-a",
    artifactHash: publicationArtifactHashForAuditVersion(base, 4),
    deliveryHash: "d".repeat(64),
    publicationConfigHash: "e".repeat(64),
  };
  assert.equal(
    legacyGitHubReceiptAdoptionKey(args),
    legacyGitHubReceiptAdoptionKey(args),
  );
  assert.notEqual(
    legacyGitHubReceiptAdoptionKey(args),
    legacyGitHubReceiptAdoptionKey({ ...args, siteId: "site-b" }),
  );
});

class FakeCasDestination {
  content: string;
  writes = 0;

  constructor(content: string) {
    this.content = content;
  }

  revise(base: string, next: string, loseAck = false) {
    const decision = classifyPublishedRevisionDestination({
      observedContent: this.content,
      expectedBaseContent: base,
      expectedNextContent: next,
    });
    if (decision === "apply") {
      this.content = next;
      this.writes += 1;
      if (loseAck) throw new Error("connection closed after write");
    }
    return decision;
  }
}

for (const adapter of ["GitHub", "WordPress"] as const) {
  test(`${adapter} fake uses exact CAS, survives a lost acknowledgement, and blocks customer drift`, () => {
    const destination = new FakeCasDestination("base bytes");
    assert.throws(
      () => destination.revise("base bytes", "next bytes", true),
      /connection closed/,
    );
    assert.equal(destination.revise("base bytes", "next bytes"), "idempotent");
    assert.equal(destination.writes, 1);

    const drifted = new FakeCasDestination("customer edit");
    assert.throws(
      () => drifted.revise("base bytes", "next bytes"),
      /drifted from the exact revision base/,
    );
    assert.equal(drifted.content, "customer edit");
    assert.equal(drifted.writes, 0);
  });
}

test("webhook fake must acknowledge the exact base, next artifact, idempotency key, and destination", () => {
  const revisionKey = "d".repeat(64);
  const deliveryKey = publishedRevisionDeliveryKey(revisionKey);
  const receipt = webhookRevisionReceiptFromResponse({
    response: {
      accepted: true,
      revisionKey,
      deliveryKey,
      baseContentHash: "e".repeat(64),
      contentHash: "f".repeat(64),
      baseExternalId: "cms-42",
      externalId: "cms-42",
      url: "https://example.com/resources/qualification",
    },
    expectedRevisionKey: revisionKey,
    expectedDeliveryKey: deliveryKey,
    expectedBaseContentHash: "e".repeat(64),
    expectedNextContentHash: "f".repeat(64),
    expectedExternalId: "cms-42",
    expectedSiteHost: "example.com",
    receivedAt: Date.now(),
  });
  assert.equal(receipt.baseExternalId, "cms-42");
  assert.throws(
    () => webhookRevisionReceiptFromResponse({
      response: {
        accepted: true,
        revisionKey,
        deliveryKey,
        baseContentHash: "0".repeat(64),
        contentHash: "f".repeat(64),
        baseExternalId: "cms-42",
        externalId: "cms-42",
        url: "https://example.com/resources/qualification",
      },
      expectedRevisionKey: revisionKey,
      expectedDeliveryKey: deliveryKey,
      expectedBaseContentHash: "e".repeat(64),
      expectedNextContentHash: "f".repeat(64),
      expectedExternalId: "cms-42",
      expectedSiteHost: "example.com",
      receivedAt: Date.now(),
    }),
    /exact external CAS/,
  );
});

test("GitHub revision receipt preserves the base commit while accepting the new commit id", () => {
  const revisionKey = "1".repeat(64);
  const receipt = validatePublishedRevisionReceipt({
    receipt: {
      method: "github",
      revisionKey,
      deliveryKey: publishedRevisionDeliveryKey(revisionKey),
      baseContentHash: "2".repeat(64),
      baseExternalId: "old-commit",
      contentHash: "3".repeat(64),
      externalId: "new-commit",
      url: "https://github.com/example/site/commit/new-commit",
      status: "committed",
      receivedAt: Date.now(),
    },
    method: "github",
    revisionKey,
    baseArtifactHash: "2".repeat(64),
    nextArtifactHash: "3".repeat(64),
    baseExternalId: "old-commit",
  });
  assert.equal(receipt.externalId, "new-commit");
  assert.equal(receipt.baseExternalId, "old-commit");
});

test("revision lease is exclusive, bounded, and final states are idempotent", () => {
  const now = Date.now();
  const first = acquirePublishedRevisionLease(
    { status: "prepared", attempts: 0 },
    { leaseOwner: "worker-a", now },
  );
  assert.equal(first.patch?.attempts, 1);
  assert.throws(
    () => acquirePublishedRevisionLease(
      {
        status: "leased",
        leaseOwner: "worker-a",
        leaseStartedAt: now,
        attempts: 1,
      },
      { leaseOwner: "worker-b", now: now + 1 },
    ),
    /already in progress/,
  );
  assert.deepEqual(
    acquirePublishedRevisionLease(
      { status: "verified", attempts: 1 },
      { leaseOwner: "worker-b", now },
    ),
    { idempotent: true },
  );
  assert.throws(
    () => acquirePublishedRevisionLease(
      { status: "failed", attempts: 1 },
      { leaseOwner: "worker-b", now },
    ),
    /not executable/,
  );
  assert.throws(
    () => acquirePublishedRevisionLease(
      { status: "verification_pending", attempts: 1 },
      { leaseOwner: "worker-b", now },
    ),
    /waiting for exact live verification/,
  );
});

test("rollback uses the preserved immutable base and rejects cross-article data", () => {
  const base = artifact();
  const current = { ...base, metaTitle: "Website lead qualification workflow" };
  assert.deepEqual(
    rollbackRevisionArtifact({ current, preservedBase: base }),
    base,
  );
  assert.throws(
    () => rollbackRevisionArtifact({
      current,
      preservedBase: { ...base, slug: "another-article" },
    }),
    /immutable publication boundary/,
  );
});

test("live metadata revision requires exact URL, canonical, title, and description", () => {
  const base = artifact();
  const next = {
    ...base,
    metaTitle: "Website lead qualification workflow",
    metaDescription:
      "Website lead qualification helps teams answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
  };
  const expectedUrl = "https://example.com/resources/website-lead-qualification-workflow";
  const html = `<html><head><title>${next.metaTitle}</title><meta name="description" content="${next.metaDescription}"><link rel="canonical" href="${expectedUrl}"></head><body><h1>${next.title}</h1></body></html>`;
  assert.doesNotThrow(() => verifyLivePublishedRevision({
    expectedUrl,
    fetchedUrl: expectedUrl,
    html,
    base,
    next,
    kind: "improve_snippet",
  }));
  assert.throws(
    () => verifyLivePublishedRevision({
      expectedUrl,
      fetchedUrl: expectedUrl,
      html: html.replace(next.metaDescription, "stale description"),
      base,
      next,
      kind: "improve_snippet",
    }),
    /exact revised meta description/,
  );
  assert.throws(
    () => verifyLivePublishedRevision({
      expectedUrl,
      fetchedUrl: expectedUrl,
      html: html
        .replace(
          `<title>${next.metaTitle}</title>`,
          `<title>${base.metaTitle}</title><meta property="og:title" content="${next.metaTitle}">`,
        ),
      base,
      next,
      kind: "improve_snippet",
    }),
    /exact revised meta title/,
  );
});

test("live internal-link revision requires the exact verified destination href", () => {
  const base = artifact();
  const targetUrl = "/resources/website-lead-qualification-metrics";
  const next = deterministicInternalLinkRevision({
    artifact: base,
    urlStructure: "/resources/[slug]",
    liveDestinations: [{
      href: targetUrl,
      title: "Website lead qualification metrics",
      keywords: ["website lead qualification"],
    }],
  });
  assert.ok(next);
  const expectedUrl = "https://example.com/resources/website-lead-qualification-workflow";
  const html = `<html><head><link rel="canonical" href="${expectedUrl}"></head><body><h1>${next.title}</h1><h2>Related reading</h2><ul><li><a href="${targetUrl}">Website lead qualification metrics</a></li></ul></body></html>`;
  assert.doesNotThrow(() => verifyLivePublishedRevision({
    expectedUrl,
    fetchedUrl: expectedUrl,
    html,
    base,
    next,
    kind: "strengthen_cluster",
    targetUrl,
  }));
  assert.throws(
    () => verifyLivePublishedRevision({
      expectedUrl,
      fetchedUrl: expectedUrl,
      html: `<html><head><link rel="canonical" href="${expectedUrl}"></head><body><nav><a href="${targetUrl}">Website lead qualification metrics</a></nav><h1>${next.title}</h1></body></html>`,
      base,
      next,
      kind: "strengthen_cluster",
      targetUrl,
    }),
    /exact verified internal target and anchor in Related reading/,
  );
});

test("live rollback proves exact restored metadata before marking it rolled back", () => {
  const next = artifact({ metaTitle: undefined });
  const base = {
    ...next,
    metaTitle: next.title,
    metaDescription:
      "Website lead qualification helps teams answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
  };
  const expectedUrl = "https://example.com/resources/website-lead-qualification-workflow";
  const exactHtml = `<html><head><title>${next.title}</title><meta name="description" content="${next.metaDescription}"><link rel="canonical" href="${expectedUrl}"></head><body><h1>${next.title}</h1></body></html>`;
  assert.doesNotThrow(() => verifyLivePublishedRevision({
    expectedUrl,
    fetchedUrl: expectedUrl,
    html: exactHtml,
    base,
    next,
    kind: "rollback",
  }));
  assert.throws(
    () => verifyLivePublishedRevision({
      expectedUrl,
      fetchedUrl: expectedUrl,
      html: exactHtml.replace(next.metaDescription ?? "", base.metaDescription ?? ""),
      base,
      next,
      kind: "rollback",
    }),
    /exact revised meta description/,
  );
});

test("live rollback proves the exact deterministic related link was removed", () => {
  const next = artifact();
  const target = {
    anchor: "Website lead qualification metrics",
    href: "/resources/website-lead-qualification-metrics",
  };
  const base = {
    ...next,
    markdown: `${next.markdown}\n\n## Related reading\n\n- [${target.anchor}](${target.href})\n`,
    internalLinks: [...(next.internalLinks ?? []), target],
  };
  const expectedUrl = "https://example.com/resources/website-lead-qualification-workflow";
  const exactHtml = `<html><head><link rel="canonical" href="${expectedUrl}"></head><body><h1>${next.title}</h1></body></html>`;
  assert.doesNotThrow(() => verifyLivePublishedRevision({
    expectedUrl,
    fetchedUrl: expectedUrl,
    html: exactHtml,
    base,
    next,
    kind: "rollback",
  }));
  assert.throws(
    () => verifyLivePublishedRevision({
      expectedUrl,
      fetchedUrl: expectedUrl,
      html: exactHtml.replace(
        "</body>",
        `<h2>Related reading</h2><a href="${target.href}">${target.anchor}</a></body>`,
      ),
      base,
      next,
      kind: "rollback",
    }),
    /still contains the exact reverted internal link/,
  );
});

test("revision persistence, dispatch, deletion, and adapter code remain tenant-scoped and fail-closed", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const revisions = readFileSync("convex/publishedRevisions.ts", "utf8");
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const growth = readFileSync("convex/seoGrowth.ts", "utf8");
  const growthAction = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const crons = readFileSync("convex/crons.ts", "utf8");

  assert.match(schema, /published_article_revisions: defineTable/);
  for (const state of [
    "prepared",
    "attempted",
    "verification_pending",
    "verified",
    "failed",
    "unverified",
    "rolled_back",
  ]) {
    assert.match(schema, new RegExp(`v\\.literal\\("${state}"\\)`));
  }
  assert.match(revisions, /article\.siteId !== args\.siteId/);
  assert.match(revisions, /action\.siteId !== args\.siteId/);
  assert.match(revisions, /MAX_PUBLISHED_REVISIONS_PER_TENANT_24H/);
  assert.match(revisions, /Not authorized to access this site's published revisions/);
  assert.match(revisions, /Published article rows are immutable|artifactSnapshot/);
  assert.match(revisions, /WordPress core GET then POST cannot protect a concurrent customer edit/);
  assert.match(revisions, /expectedPublicUrl/);
  assert.match(revisions, /baseReceipt: rollbackBaseReceipt/);
  assert.doesNotMatch(revisions, /baseReceipt: source\.receipt/);
  assert.match(
    revisions,
    /existing\.status === "prepared"[\s\S]*existing\.status === "unverified"[\s\S]*staleDeliveryLease/,
  );
  assert.match(revisions, /listDueLiveVerifications/);
  assert.match(revisions, /claimLiveVerification/);
  assert.match(
    revisions,
    /recordDelivery[\s\S]*action\.publishedRevisionId === revision\._id[\s\S]*automationStatus: "revision_verification_pending"/,
  );
  assert.match(publisher, /expectedCurrentContent/);
  assert.match(
    publisher,
    /Automatic WordPress revisions are unsupported without atomic conditional-write CAS/,
  );
  assert.match(publisher, /pentra\.article\.revise\.v1/);
  assert.match(publisher, /X-Pentra-Signature-256/);
  assert.match(publisher, /safeRequestPublicHttps/);
  assert.match(publisher, /verifyLivePublishedRevision/);
  assert.match(publisher, /const expectedUrl = revision\.expectedPublicUrl/);
  assert.match(publisher, /recoverPublishedRevisionVerifications/);
  assert.match(growth, /revisionRequests/);
  assert.match(growthAction, /executePublishedRevisionInternal/);
  assert.match(
    growthAction,
    /if \(executed\.status === "verified"\) \{[\s\S]*recordAutomationResult/,
  );
  assert.match(growthAction, /no_safe_candidate/);
  assert.match(sites, /"published_article_revisions"/);
  assert.match(
    sites,
    /Cannot delete a site while a published revision delivery is in progress/,
  );
  assert.match(
    sites,
    /published revision has an unverified external delivery outcome/,
  );
  assert.match(sites, /q\.field\("receipt"\), undefined/);
  assert.match(crons, /published-revision-verification-recovery/);
  assert.doesNotMatch(revisions, /OpenAI|Anthropic|generateText|chat\.completions/);
});
