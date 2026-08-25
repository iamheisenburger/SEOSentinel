import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { takeCurrentGscPageRows } from
  "../convex/lib/currentGscRows.ts";

const schema = readFileSync("convex/schema.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const outreach = readFileSync("convex/outreach.ts", "utf8");
const outcomes = readFileSync("convex/outcomes.ts", "utf8");
const publishedRevisions = readFileSync(
  "convex/publishedRevisions.ts",
  "utf8",
);
const articles = readFileSync("convex/articles.ts", "utf8");
const seoAuthority = readFileSync("convex/seoAuthority.ts", "utf8");
const seoGrowth = readFileSync("convex/seoGrowth.ts", "utf8");
const searchPerformance = readFileSync("convex/searchPerformance.ts", "utf8");
const publisher = readFileSync("convex/publisher.ts", "utf8");
const autopilot = readFileSync("convex/autopilot.ts", "utf8");
const articleDetail = readFileSync(
  "src/app/(dashboard)/articles/[id]/page.tsx",
  "utf8",
);

test("current GSC reads use exact receipt epoch/date partitions before capacity", async () => {
  const partitions = new Map([
    ["epoch-recent:2026-08-24", [{ _id: "recent", date: "2026-08-24" }]],
    ["epoch-backfill:2026-07-01", [{ _id: "backfill", date: "2026-07-01" }]],
    // This superseded row is intentionally not addressable through either
    // current receipt partition and therefore cannot consume the limit.
    ["epoch-old:2026-08-24", Array.from({ length: 5_000 }, (_, index) => ({
      _id: `old-${index}`,
      date: "2026-08-24",
    }))],
  ]);
  const reads: string[] = [];
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (indexName: string, build: (q: unknown) => unknown) => {
          assert.equal(table, "search_page_daily");
          assert.equal(indexName, "by_site_epoch_date");
          const values: Record<string, unknown> = {};
          const q = {
            eq(field: string, value: unknown) {
              values[field] = value;
              return q;
            },
          };
          build(q);
          const key = `${values.syncEpoch}:${values.date}`;
          reads.push(key);
          return {
            take: async (limit: number) =>
              (partitions.get(key) ?? []).slice(0, limit),
          };
        },
      }),
    },
  } as unknown as Parameters<typeof takeCurrentGscPageRows>[0];
  const site = {
    _id: "site-1",
    gscDateEpochs: [
      { date: "2026-08-24", syncEpoch: "epoch-recent" },
      { date: "2026-07-01", syncEpoch: "epoch-backfill" },
    ],
  } as Parameters<typeof takeCurrentGscPageRows>[1];

  const result = await takeCurrentGscPageRows(ctx, site, 3);
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.rows.map((row) => String(row._id)), [
    "backfill",
    "recent",
  ]);
  assert.deepEqual(reads, [
    "epoch-backfill:2026-07-01",
    "epoch-recent:2026-08-24",
  ]);
  assert.equal(reads.includes("epoch-old:2026-08-24"), false);

  const recentOnly = await takeCurrentGscPageRows(ctx, site, 3, {
    startDate: "2026-08-01",
  });
  assert.deepEqual(recentOnly.rows.map((row) => String(row._id)), ["recent"]);

  const bounded = await takeCurrentGscPageRows(ctx, site, 1);
  assert.equal(bounded.exhausted, true);
  assert.equal(bounded.rows.length, 1);
});

test("domain and connection transitions retire old GSC and cadence receipts", () => {
  assert.match(sites, /async function scheduleRetiredGscEpochPruning/);
  assert.ok(
    (sites.match(/scheduleRetiredGscEpochPruning\(ctx,/g) ?? []).length >= 5,
  );
  assert.match(sites, /table: "query" as const/);
  assert.match(sites, /table: "page" as const/);
  assert.match(sites, /async function invalidateAuxiliaryCadenceJobs/);
  assert.match(sites, /query\("autopilot_runs"\)/);
  assert.match(sites, /outcomeCredentials/);
  assert.match(sites, /gsc_connection_invalidated/);
  assert.match(sites, /async function assertConfigUnlocked/);
  assert.match(sites, /for \(const status of \["leased", "attempted"\]/);
  assert.match(sites, /eq\(q\.field\("receipt"\), undefined\)/);
  assert.match(sites, /eq\("status", "delivery_unverified"\)/);
  assert.match(articles, /export const recordPublicationAttempted/);
  assert.match(articles, /export const recordPublicationOutcomeUnverified/);
  assert.match(publishedRevisions, /assertNoOtherUnresolvedPublication/);
  assert.match(schema, /by_site_domain_revision_event/);
  assert.match(schema, /by_site_domain_revision_session/);
  assert.match(schema, /by_site_domain_revision_article_goal_date/);
  assert.match(schema, /by_site_domain_revision_date/);
  assert.match(outcomes, /by_site_domain_revision_event/);
  assert.match(outcomes, /by_site_domain_revision_session/);
  assert.match(outcomes, /withIndex\("by_site_domain_revision_date"/);
  assert.match(
    outcomes,
    /withIndex\("by_site_domain_revision_article_goal_date"/,
  );
  assert.match(seoGrowth, /takeCurrentGscPageRows\(ctx, site, 5_000/);
  assert.match(
    searchPerformance,
    /takeCurrentGscQueryRows\([\s\S]{0,100}DISCOVERY_GSC_READ_LIMIT/,
  );
  assert.ok(
    (searchPerformance.match(/takeCurrentGscQueryRows\(/g) ?? []).length >= 6,
  );
  assert.ok(
    (searchPerformance.match(/takeCurrentGscPageRows\(/g) ?? []).length >= 2,
  );
  assert.match(searchPerformance, /function completeCurrentGscRows/);
  assert.match(searchPerformance, /Current Search Console \$\{label\} read limit exceeded/);
});

test("publication ambiguity is fenced at the provider mutation boundary", () => {
  assert.match(schema, /publicationRolloutEpoch: v\.optional\(v\.number\(\)\)/);
  assert.match(publisher, /type BeforeExternalMutation = \(\) => Promise<void>/);
  assert.match(
    publisher,
    /await beforeExternalMutation\(\);[\s\S]{0,180}method: "PATCH"/,
  );
  assert.match(
    publisher,
    /await beforeExternalMutation\(\);[\s\S]{0,180}method: "PUT"/,
  );
  assert.ok(
    (publisher.match(/await beforeExternalMutation\(\);/g) ?? []).length >= 4,
  );
  assert.match(publisher, /const hadPriorAttempt = lease\.deliveryPreviouslyAttempted === true/);
  assert.match(
    publisher,
    /let deliveryAttempted = hadPriorAttempt;[\s\S]{0,800}recordPublicationAttempted/,
  );
  assert.match(
    publisher,
    /const recoveringUnverifiedPublication = Boolean\([\s\S]{0,350}publicationAttemptedAt[\s\S]{0,350}publicationDeliveryHash/,
  );
  assert.match(
    publisher,
    /if \(!recoveringUnverifiedPublication\) \{[\s\S]{0,180}recordPublicationCheck/,
  );
  assert.match(
    publisher,
    /Mutable policy is an authorization gate only before the first provider[\s\S]{0,30}mutation/,
  );
  assert.match(
    publisher,
    /!recoveringUnverifiedPublication &&[\s\S]{0,100}site\.approvalRequired/,
  );
  assert.match(
    publisher,
    /hadPriorAttempt && !recoveryMutationAuthorized[\s\S]{0,180}read-only reconciliation only/,
  );
  assert.match(
    articles,
    /deliveryPreviouslyAttempted[\s\S]{0,900}publicationRolloutEpoch !== expectedRolloutEpoch/,
  );
  assert.match(
    articles,
    /assertNoUnresolvedPublishedRevision\(ctx, site\._id\)/,
  );
  assert.match(
    articles,
    /!deliveryPreviouslyAttempted && article\.topicId/,
  );
  assert.match(
    articles,
    /recordPublicationAttempted[\s\S]{0,1200}siteExecutionAuthorized\(ctx, site\)[\s\S]{0,300}publicationRolloutEpoch/,
  );
  assert.match(
    articles,
    /Cannot release an initial publication with an unresolved external outcome/,
  );
  assert.match(
    publishedRevisions,
    /const timestamp = revision\.attemptedAt \?\? Date\.now\(\)/,
  );
  assert.match(
    publishedRevisions,
    /recordAttempted = internalMutation[\s\S]{0,2600}growthRevisionMeasurementCurrent[\s\S]{0,1200}revisionTargetStillCurrent/,
  );
  assert.match(
    publishedRevisions,
    /recordDelivery = internalMutation[\s\S]{0,1800}revision\.attemptedAt/,
  );
  assert.match(
    publisher,
    /An exact idempotency read from a prior attempt is settlement[\s\S]{0,300}recordDelivery/,
  );
  assert.doesNotMatch(
    publisher,
    /An exact idempotency read from a prior attempt[\s\S]{0,300}beforeExternalMutation\(\)/,
  );
  assert.match(articles, /export const abandonUnverifiedPublication = mutation/);
  assert.match(
    publishedRevisions,
    /export const abandonUnverifiedDelivery = mutation/,
  );
  assert.match(articles, /reviewedAmbiguityDispositionAllowed/);
  assert.match(publishedRevisions, /reviewedAmbiguityDispositionAllowed/);

  const initialBegin = articles.slice(
    articles.indexOf("export const beginPublication"),
    articles.indexOf("export const recordPublicationAttempted"),
  );
  assert.match(
    initialBegin,
    /!deliveryPreviouslyAttempted[\s\S]{0,300}PUBLICATION_LEASE_MS \+ 1_000[\s\S]{0,180}recoverInitialPublicationLeaseInternal/,
  );
  assert.match(
    initialBegin,
    /expectedContentHash,[\s\S]{0,100}expectedLeaseOwner: leaseOwner/,
  );
  const initialWatchdog = publisher.slice(
    publisher.indexOf("export const recoverInitialPublicationLeaseInternal"),
    publisher.indexOf("export const publishArticle = action"),
  );
  assert.match(initialWatchdog, /publicationLeaseHash !== args\.expectedContentHash/);
  assert.match(initialWatchdog, /publicationLeaseOwner !== args\.expectedLeaseOwner/);
  assert.match(initialWatchdog, /releaseExpiredPristinePublication/);
  assert.match(initialWatchdog, /readOnlyRecoveryOnly: true/);
  assert.match(
    publisher,
    /options\?\.readOnlyRecoveryOnly[\s\S]{0,180}cannot replay an external write/,
  );

  // Recovery scheduling belongs only to the durable failure transition. A
  // previous moving-tree edit accidentally placed this branch in
  // `recordDelivery` and referenced the browser-only global `status`; TypeScript
  // accepted it because the DOM library declares that global, while Convex
  // would have rolled back the exact receipt mutation at runtime.
  const revisionDelivery = publishedRevisions.slice(
    publishedRevisions.indexOf("export const recordDelivery"),
    publishedRevisions.indexOf("export const recordFailure"),
  );
  const revisionFailure = publishedRevisions.slice(
    publishedRevisions.indexOf("export const recordFailure"),
    publishedRevisions.indexOf("export const abandonUnverifiedDelivery"),
  );
  assert.doesNotMatch(revisionDelivery, /status === "unverified"/);
  assert.doesNotMatch(
    revisionDelivery,
    /executePublishedRevisionInternal/,
  );
  assert.match(revisionFailure, /const status = revision\.attemptedAt/);
  assert.match(
    revisionFailure,
    /status === "unverified"[\s\S]{0,900}executePublishedRevisionInternal/,
  );
});

test("rollout epochs cannot move around an unresolved publication envelope", () => {
  assert.match(autopilot, /publicationCommitBlocksRolloutTransition/);
  assert.ok(
    (autopilot.match(/publicationCommitBlocksRolloutTransition\(ctx, site\)/g) ?? [])
      .length >= 2,
  );
  assert.match(sites, /schedulePublicationReceiptRecovery\(ctx, site\)/);
  assert.ok((sites.match(/await assertConfigUnlocked\(ctx, site\)/g) ?? []).length >= 7);
});

test("owners can reach the fail-closed ambiguity disposition from the product", () => {
  const reviewQuery = articles.slice(
    articles.indexOf("export const getPublicationAmbiguityReview"),
    articles.indexOf("export const getInternal"),
  );
  assert.match(reviewQuery, /requireArticleOwner\(ctx, article\)/);
  assert.match(reviewQuery, /articleMatchesCurrentDomain\(site, article\)/);
  assert.match(reviewQuery, /withIndex\("by_article_created"/);
  assert.match(reviewQuery, /candidate\.siteId === site\._id/);
  assert.match(reviewQuery, /!candidate\.receipt/);
  assert.match(reviewQuery, /ambiguityReviewAt/);
  assert.doesNotMatch(reviewQuery, /githubToken|wpAppPassword|webhookSecret/);

  assert.match(articleDetail, /api\.articles\.getPublicationAmbiguityReview/);
  assert.match(articleDetail, /api\.articles\.abandonUnverifiedPublication/);
  assert.match(articleDetail, /api\.publishedRevisions\.abandonUnverifiedDelivery/);
  assert.match(
    articleDetail,
    /ABANDON UNVERIFIED DELIVERY AND RETAIN AUDIT/,
  );
  assert.match(articleDetail, /will not replay it or count it as a success/);
  assert.match(articleDetail, /future publication, configuration, domain, and deletion work/);
  assert.match(articleDetail, /reviewAt > reviewNow/);
  assert.match(
    articles,
    /abandonUnverifiedPublication[\s\S]{0,900}articleMatchesCurrentDomain\(site, article\)/,
  );
  assert.match(
    publishedRevisions,
    /abandonUnverifiedDelivery[\s\S]{0,700}currentRevisionArticle\(ctx, revision\)/,
  );
});

test("outreach projection and delivery select the current domain epoch before limits", () => {
  const messagesSchema = schema.slice(schema.indexOf("outreach_messages: defineTable"));
  assert.match(
    messagesSchema,
    /canonicalDomain: v\.optional\(v\.string\(\)\)[\s\S]{0,500}opportunityId:/,
  );
  assert.match(schema, /by_site_epoch_owner_status/);
  assert.match(
    schema,
    /by_site_epoch_owner_auto_sequence_scheduled/,
  );
  assert.match(
    schema,
    /by_site_epoch_owner_approval_sequence_scheduled/,
  );
  assert.match(outreach, /function outreachMessageMatchesCurrentDomain/);
  assert.match(outreach, /const record = \{[\s\S]{0,120}canonicalDomain,[\s\S]{0,80}domainRevision: siteCanonicalDomainRevision\(site\)/);
  assert.match(outreach, /!outreachMessageMatchesCurrentDomain\(site, message\)/);
  assert.match(outreach, /!authorityOpportunityMatchesCurrentDomain\(site, opportunity\)/);
  assert.match(
    outreach,
    /LIVE\.includes\(m\.status\) &&[\s\S]{0,120}outreachMessageMatchesCurrentDomain\(site, m\)/,
  );
  assert.match(sites, /withIndex\("by_site_epoch_owner_status"/);
  assert.match(
    sites,
    /withIndex\("by_site_epoch_owner_auto_sequence_scheduled"/,
  );
});

test("growth revisions, actions, and authority work keep immutable attempt epochs", () => {
  assert.match(schema, /growthMeasurementKey: v\.optional\(v\.string\(\)\)/);
  assert.match(schema, /measurementGscConnectionRevision/);
  assert.match(schema, /growthActionFingerprint: v\.optional\(v\.string\(\)\)/);
  assert.match(seoGrowth, /function growthMeasurementMatchesCurrentSite/);
  assert.match(seoGrowth, /function actionHasUnresolvedRevisionDelivery/);
  assert.match(
    seoGrowth,
    /if \(await actionHasUnresolvedRevisionDelivery\(ctx, existing\)\) \{[\s\S]{0,40}continue/,
  );
  assert.match(seoGrowth, /measurementKey,/);
  assert.match(publishedRevisions, /existing\.status === "prepared"/);
  assert.match(publishedRevisions, /existing\.attempts === 0/);
  assert.match(publishedRevisions, /existing\.receipt === undefined/);
  assert.match(
    publishedRevisions,
    /growthMeasurementKey: args\.measurementKey/,
  );
  assert.match(publishedRevisions, /recoveringAttemptedDelivery/);
  assert.match(
    publishedRevisions,
    /measurementStillCurrent[\s\S]{0,220}rolloutStillEligible/,
  );
  assert.match(
    publishedRevisions,
    /listDueLiveVerifications = internalMutation[\s\S]{0,1500}live_verification_epoch_retired/,
  );
  assert.match(
    publisher,
    /let deliveryAttempted = Boolean\(revision\.attemptedAt\)/,
  );
  assert.match(seoAuthority, /function authorityRunMatchesCurrentDomain/);
  assert.match(seoAuthority, /growthMeasurementKey/);
  assert.match(seoAuthority, /by_site_domain_revision_status/);
});
