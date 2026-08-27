import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  aggregateOutcomeRollups,
  constantTimeHexEqual,
  isExactOrganicFunnelEventType,
  normalizeOutcomeGoalKey,
  normalizeOutcomeQueryWindow,
  outcomeAttributionOccurredAt,
  outcomeIngestUsageSnapshot,
  outcomePublicationDeliveryHash,
  outcomeUtcDay,
  OUTCOME_ACCEPTED_DAILY_LIMIT,
  OUTCOME_REJECTED_DAILY_LIMIT,
  requireOwnedArticleUrl,
  reserveOutcomeIngestUsage,
  sameOutcomeReceipt,
  sanitizeOutcomeCredential,
  validateOutcomeReceiptCandidate,
  validateOutcomeSessionTransition,
  type OutcomeEventType,
  type OutcomeReceiptCandidate,
} from "./lib/outcomeReceipts.ts";
import { publishedArticlePublicUrl } from "./lib/publicationLive.ts";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance.ts";
import {
  articleMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";

const OUTCOME_SUMMARY_ROLLUP_READ_LIMIT = 5_000;

/** Controlled release-only canary. It proves the production ingestion storage
 * boundary without touching customer growth rollups or dashboard metrics. */
export const recordControlledConversionCanaryInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    canaryKey: v.string(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.canaryKey)) {
      throw new Error("Controlled conversion canary key is invalid");
    }
    const [site, article] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.articleId),
    ]);
    const now = Date.now();
    if (
      !site || site.deletionStatus || !article ||
      article.siteId !== args.siteId || article.status !== "published" ||
      article.publicUrlStatus !== "verified" || !article.publicUrl ||
      !article.publicUrlVerifiedAt ||
      !Number.isSafeInteger(args.occurredAt) ||
      args.occurredAt < article.publicUrlVerifiedAt ||
      args.occurredAt > now + 60_000
    ) throw new Error("Controlled conversion lacks a verified publication");
    const eventId = `canary_${args.canaryKey}`;
    const prior = await ctx.db.query("outcome_receipts")
      .withIndex("by_site_event", (q) =>
        q.eq("siteId", args.siteId).eq("eventId", eventId))
      .take(2);
    if (prior.length > 1) throw new Error("Controlled conversion identity is ambiguous");
    if (prior[0]) {
      if (
        !prior[0].isCanary || prior[0].articleId !== article._id ||
        prior[0].eventType !== "qualified_action"
      ) throw new Error("Controlled conversion key was reused");
      return prior[0];
    }
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) {
      throw new Error("Controlled conversion lacks a canonical domain binding");
    }
    const receiptId = await ctx.db.insert("outcome_receipts", {
      siteId: site._id,
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(site),
      articleId: article._id,
      publicationDeliveryKey: article.publicationReceipt?.deliveryKey ?? undefined,
      eventId,
      eventType: "qualified_action",
      articleUrl: article.publicUrl,
      sessionId: `canary_${sha256Hex(`${args.canaryKey}:session`)}`,
      goalKey: "__pentra_controlled_canary__",
      occurredAt: args.occurredAt,
      receivedAt: now,
      isCanary: true,
    });
    return ctx.db.get(receiptId);
  },
});

async function requireSiteOwner(
  ctx: QueryCtx,
  siteId: Id<"sites">,
): Promise<Doc<"sites">> {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to manage this site's outcome receipts");
  }
  return site;
}

async function credentialForSite(ctx: QueryCtx, siteId: Id<"sites">) {
  const rows = await ctx.db
    .query("outcome_ingest_credentials")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .take(2);
  return rows.length === 1 ? rows[0] : null;
}

async function latestFinalPublishedRevision(
  ctx: QueryCtx | MutationCtx,
  articleId: Id<"articles">,
) {
  const [verified, rolledBack] = await Promise.all([
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_article_status_created", (q) =>
        q.eq("articleId", articleId).eq("status", "verified")
      )
      .order("desc")
      .first(),
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_article_status_created", (q) =>
        q.eq("articleId", articleId).eq("status", "rolled_back")
      )
      .order("desc")
      .first(),
  ]);
  if (!verified) return rolledBack;
  if (!rolledBack) return verified;
  return verified.createdAt >= rolledBack.createdAt ? verified : rolledBack;
}

/** Resolve a sealed delivery key. A new organic landing requires the key that
 * is currently visible on the live article. Later stages may keep the exact
 * historical key captured by that landing so a legitimate conversion is not
 * broken when Pentra revises the article mid-funnel. */
async function articleForPublicationDeliveryKey(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  publicationDeliveryKey: string,
  requireCurrent: boolean,
): Promise<Doc<"articles"> | null> {
  let keyHash: string;
  try {
    keyHash = outcomePublicationDeliveryHash(publicationDeliveryKey);
  } catch {
    return null;
  }
  const [baseMatches, revisionMatches] = await Promise.all([
    ctx.db
      .query("articles")
      .withIndex("by_site_delivery_hash", (q) =>
        q
          .eq("siteId", siteId)
          .eq("publicationDeliveryHash", keyHash)
      )
      .take(2),
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_key", (q) => q.eq("revisionKey", keyHash))
      .take(2),
  ]);
  const revisions = revisionMatches.filter((row) => row.siteId === siteId);
  if (baseMatches.length + revisions.length !== 1) return null;

  if (baseMatches[0]) {
    const article = baseMatches[0];
    if (
      article.publicationReceipt?.deliveryKey !== publicationDeliveryKey ||
      (
        requireCurrent &&
        await latestFinalPublishedRevision(ctx, article._id)
      )
    ) {
      return null;
    }
    return article;
  }

  const revision = revisions[0];
  if (
    !revision ||
    (revision.status !== "verified" && revision.status !== "rolled_back") ||
    !revision.liveVerifiedAt ||
    revision.receipt?.deliveryKey !== publicationDeliveryKey
  ) {
    return null;
  }
  const latest = await latestFinalPublishedRevision(ctx, revision.articleId);
  if (requireCurrent && latest?._id !== revision._id) return null;
  const article = await ctx.db.get(revision.articleId);
  return article?.siteId === siteId &&
      article.publicUrl === revision.expectedPublicUrl
    ? article
    : null;
}

function credentialStatus(
  credential: Doc<"outcome_ingest_credentials"> | null,
) {
  const safe = sanitizeOutcomeCredential(credential);
  if (!safe) {
    return {
      configured: false,
      status: "not_configured",
      version: 0,
    };
  }
  return {
    configured: safe.configured,
    status: safe.status,
    version: safe.version,
    qualifiedActionGoalKey: safe.qualifiedActionGoalKey,
    createdAt: safe.createdAt,
    rotatedAt: safe.rotatedAt,
    revokedAt: safe.revokedAt,
    lastUsedAt: safe.lastUsedAt,
    updatedAt: safe.updatedAt,
  };
}

export const canManageCredentialInternal = internalQuery({
  args: { siteId: v.id("sites"), ownerUserId: v.string() },
  handler: async (ctx, { siteId, ownerUserId }) => {
    const site = await ctx.db.get(siteId);
    return Boolean(
      site?.userId && !site.deletionStatus && site.userId === ownerUserId,
    );
  },
});

export const getIngestTenantReadinessInternal = internalQuery({
  args: { siteId: v.id("sites"), ownerUserId: v.string() },
  handler: async (ctx, { siteId, ownerUserId }) => {
    const site = await ctx.db.get(siteId);
    const owned = Boolean(
      site?.userId && !site.deletionStatus && site.userId === ownerUserId,
    );
    return {
      owned,
      executionAuthorized:
        owned && siteExecutionActive(site) &&
        await siteExecutionAuthorized(ctx, site),
    };
  },
});

export const storeRotatedCredentialInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    ownerUserId: v.string(),
    tokenHash: v.string(),
    qualifiedActionGoalKey: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (
      !site?.userId ||
      site.deletionStatus ||
      site.userId !== args.ownerUserId ||
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      throw new Error("Outcome credential rotation tenant mismatch");
    }
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) {
      throw new Error("Outcome credential digest is invalid");
    }
    const qualifiedActionGoalKey = normalizeOutcomeGoalKey(
      args.qualifiedActionGoalKey,
    );
    const existingRows = await ctx.db
      .query("outcome_ingest_credentials")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .take(2);
    if (existingRows.length > 1) {
      throw new Error("Outcome credential state is ambiguous");
    }
    const timestamp = Date.now();
    const existing = existingRows[0];
    if (existing) {
      await ctx.db.patch(existing._id, {
        tokenHash: args.tokenHash,
        status: "active",
        version: existing.version + 1,
        qualifiedActionGoalKey,
        rotatedAt: timestamp,
        revokedAt: undefined,
        updatedAt: timestamp,
      });
      return credentialStatus({
        ...existing,
        tokenHash: args.tokenHash,
        status: "active",
        version: existing.version + 1,
        qualifiedActionGoalKey,
        rotatedAt: timestamp,
        revokedAt: undefined,
        updatedAt: timestamp,
      });
    }
    const credentialId = await ctx.db.insert("outcome_ingest_credentials", {
      siteId: args.siteId,
      tokenHash: args.tokenHash,
      status: "active",
      version: 1,
      qualifiedActionGoalKey,
      createdAt: timestamp,
      rotatedAt: timestamp,
      updatedAt: timestamp,
    });
    const created = await ctx.db.get(credentialId);
    return credentialStatus(created);
  },
});

export const getIngestCredentialStatus = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    return credentialStatus(await credentialForSite(ctx, siteId));
  },
});

export const getIngestCredentialStatusInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) =>
    credentialStatus(await credentialForSite(ctx, siteId)),
});

export const revokeIngestCredential = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const credential = await credentialForSite(ctx, siteId);
    if (!credential || credential.status === "revoked") {
      return { revoked: false };
    }
    const timestamp = Date.now();
    await ctx.db.patch(credential._id, {
      tokenHash: undefined,
      status: "revoked",
      revokedAt: timestamp,
      updatedAt: timestamp,
    });
    return { revoked: true, revokedAt: timestamp };
  },
});

type IngestResult =
  | { accepted: false; code: string; retryAfterSeconds?: number }
  | { accepted: true; duplicate: boolean; eventId: string };

async function reserveIngestRequest(
  ctx: MutationCtx,
  credential: Doc<"outcome_ingest_credentials">,
  kind: "accepted" | "rejected" | "token_failure",
  now: number,
): Promise<IngestResult | null> {
  const reservation = reserveOutcomeIngestUsage({
    state: credential,
    kind,
    now,
  });
  if (!reservation.allowed) {
    return {
      accepted: false,
      code: "rate_limited",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(reservation.retryAfterMs / 1_000),
      ),
    };
  }
  await ctx.db.patch(credential._id, {
    ...reservation.patch,
    updatedAt: now,
  });
  return null;
}

async function rejectIngestRequest(
  ctx: MutationCtx,
  credential: Doc<"outcome_ingest_credentials">,
  code: string,
  now: number,
  tokenFailure = false,
): Promise<IngestResult> {
  const limited = await reserveIngestRequest(
    ctx,
    credential,
    tokenFailure ? "token_failure" : "rejected",
    now,
  );
  return limited ?? { accepted: false, code };
}

export const ingestReceiptInternal = internalMutation({
  args: {
    siteId: v.string(),
    articleId: v.optional(v.string()),
    publicationDeliveryKey: v.optional(v.string()),
    presentedTokenHash: v.string(),
    eventId: v.string(),
    eventType: v.union(
      v.literal("landing_session"),
      v.literal("qualified_action"),
      v.literal("organic_landing"),
      v.literal("signup"),
      v.literal("activation"),
      v.literal("paid_conversion"),
    ),
    articleUrl: v.string(),
    sessionId: v.string(),
    goalKey: v.string(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args): Promise<IngestResult> => {
    const requestNow = Date.now();
    const siteId = ctx.db.normalizeId("sites", args.siteId);
    if (!siteId) return { accepted: false, code: "unauthorized" };
    const credentials = await ctx.db
      .query("outcome_ingest_credentials")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    const credential = credentials.length === 1 ? credentials[0] : null;
    const tokenMatches = Boolean(
      credential?.tokenHash &&
      credential.status === "active" &&
      constantTimeHexEqual(credential.tokenHash, args.presentedTokenHash),
    );
    if (!tokenMatches) {
      // A valid token is checked before the persisted backoff, so hostile
      // failures can never lock out the tenant's real backend.
      return credential
        ? rejectIngestRequest(
            ctx,
            credential,
            "unauthorized",
            requestNow,
            true,
          )
        : { accepted: false, code: "unauthorized" };
    }
    // Narrow the type after the constant-time credential check above.
    if (!credential) return { accepted: false, code: "unauthorized" };
    const usage = outcomeIngestUsageSnapshot(credential, requestNow);
    if (usage.accepted >= OUTCOME_ACCEPTED_DAILY_LIMIT) {
      const limited = reserveOutcomeIngestUsage({
        state: credential,
        kind: "accepted",
        now: requestNow,
      });
      return {
        accepted: false,
        code: "rate_limited",
        retryAfterSeconds:
          limited.allowed
            ? 1
            : Math.max(1, Math.ceil(limited.retryAfterMs / 1_000)),
      };
    }
    if (usage.rejected >= OUTCOME_REJECTED_DAILY_LIMIT) {
      const limited = reserveOutcomeIngestUsage({
        state: credential,
        kind: "rejected",
        now: requestNow,
      });
      return {
        accepted: false,
        code: "rate_limited",
        retryAfterSeconds:
          limited.allowed
            ? 1
            : Math.max(1, Math.ceil(limited.retryAfterMs / 1_000)),
      };
    }

    // New customer connectors resolve the sealed, non-secret
    // `pentraDeliveryKey` already embedded in every published artifact. The
    // internal Convex id remains a compatibility path for installed v1
    // connectors and is never required in public page metadata.
    if (Boolean(args.articleId) === Boolean(args.publicationDeliveryKey)) {
      return rejectIngestRequest(
        ctx,
        credential,
        "invalid_article",
        requestNow,
      );
    }
    if (
      isExactOrganicFunnelEventType(args.eventType) &&
      !args.publicationDeliveryKey
    ) {
      return rejectIngestRequest(
        ctx,
        credential,
        "invalid_article",
        requestNow,
      );
    }
    let article: Doc<"articles"> | null = null;
    if (args.articleId) {
      const normalizedArticleId = ctx.db.normalizeId(
        "articles",
        args.articleId,
      );
      article = normalizedArticleId
        ? await ctx.db.get(normalizedArticleId)
        : null;
    } else if (args.publicationDeliveryKey) {
      article = await articleForPublicationDeliveryKey(
        ctx,
        siteId,
        args.publicationDeliveryKey,
        args.eventType === "organic_landing",
      );
    }
    const site = await ctx.db.get(siteId);
    if (
      !site ||
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !article ||
      article.siteId !== siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      article.status !== "published" ||
      article.publicUrlStatus !== "verified" ||
      !article.publicationReceipt
    ) {
      return rejectIngestRequest(
        ctx,
        credential,
        "invalid_article",
        requestNow,
      );
    }
    const articleId = article._id;

    const expectedArticleUrl = article.publicUrl ?? publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    let articleUrl: string;
    try {
      articleUrl = requireOwnedArticleUrl({
        siteDomain: site.domain,
        expectedArticleUrl,
        reportedArticleUrl: args.articleUrl,
      });
    } catch {
      return rejectIngestRequest(
        ctx,
        credential,
        "invalid_article_url",
        requestNow,
      );
    }

    let candidate;
    try {
      candidate = validateOutcomeReceiptCandidate({
        candidate: {
          siteId: String(siteId),
          articleId: String(articleId),
          publicationDeliveryKey: args.publicationDeliveryKey,
          eventId: args.eventId,
          eventType: args.eventType as OutcomeEventType,
          articleUrl,
          sessionId: args.sessionId,
          goalKey: args.goalKey,
          occurredAt: args.occurredAt,
        },
        expectedGoalKey: credential.qualifiedActionGoalKey,
        now: requestNow,
        articlePublishedAt: article.publishedAt,
      });
    } catch {
      return rejectIngestRequest(
        ctx,
        credential,
        "invalid_receipt",
        requestNow,
      );
    }

    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) {
      return rejectIngestRequest(ctx, credential, "invalid_site_domain", requestNow);
    }
    const domainRevision = siteCanonicalDomainRevision(site);
    const existingRows = siteUsesLegacyDomainReceipts(site)
      ? await ctx.db
        .query("outcome_receipts")
        .withIndex("by_site_event", (q) =>
          q.eq("siteId", siteId).eq("eventId", candidate.eventId)
        )
        .take(2)
      : await ctx.db
        .query("outcome_receipts")
        .withIndex("by_site_domain_revision_event", (q) =>
          q
            .eq("siteId", siteId)
            .eq("canonicalDomain", canonicalDomain)
            .eq("domainRevision", domainRevision)
            .eq("eventId", candidate.eventId)
        )
        .take(2);
    if (existingRows.length > 1) {
      return rejectIngestRequest(
        ctx,
        credential,
        "event_conflict",
        requestNow,
      );
    }
    const existing = existingRows[0];
    if (existing) {
      const duplicate = sameOutcomeReceipt(
        {
          siteId: String(existing.siteId),
          articleId: String(existing.articleId),
          publicationDeliveryKey: existing.publicationDeliveryKey,
          eventId: existing.eventId,
          eventType: existing.eventType,
          articleUrl: existing.articleUrl,
          sessionId: existing.sessionId,
          goalKey: existing.goalKey,
          occurredAt: existing.occurredAt,
        },
        candidate,
      );
      if (!duplicate) {
        return rejectIngestRequest(
          ctx,
          credential,
          "event_conflict",
          requestNow,
        );
      }
    }

    const sessionRows = siteUsesLegacyDomainReceipts(site)
      ? await ctx.db
        .query("outcome_receipts")
        .withIndex("by_site_session", (q) =>
          q.eq("siteId", siteId).eq("sessionId", candidate.sessionId)
        )
        .take(5)
      : await ctx.db
        .query("outcome_receipts")
        .withIndex("by_site_domain_revision_session", (q) =>
          q
            .eq("siteId", siteId)
            .eq("canonicalDomain", canonicalDomain)
            .eq("domainRevision", domainRevision)
            .eq("sessionId", candidate.sessionId)
        )
        .take(5);
    const sessionCandidates = sessionRows.map(
      (row): OutcomeReceiptCandidate => ({
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        publicationDeliveryKey: row.publicationDeliveryKey,
        eventId: row.eventId,
        eventType: row.eventType,
        articleUrl: row.articleUrl,
        sessionId: row.sessionId,
        goalKey: row.goalKey,
        occurredAt: row.occurredAt,
      }),
    );
    let sessionTransition;
    try {
      sessionTransition = validateOutcomeSessionTransition(
        sessionCandidates,
        candidate,
      );
    } catch (error) {
      return rejectIngestRequest(
        ctx,
        credential,
        error instanceof Error &&
          error.message === "Qualified action requires a prior landing session"
          ? "missing_landing_session"
          : "session_conflict",
        requestNow,
      );
    }
    if (sessionTransition.kind === "duplicate") {
      const limited = await reserveIngestRequest(
        ctx,
        credential,
        "accepted",
        requestNow,
      );
      if (limited) return limited;
      const usedAt = requestNow;
      await ctx.db.patch(credential._id, {
        lastUsedAt: usedAt,
        updatedAt: usedAt,
      });
      return {
        accepted: true,
        duplicate: true,
        eventId: sessionTransition.eventId,
      };
    }

    const limited = await reserveIngestRequest(
      ctx,
      credential,
      "accepted",
      requestNow,
    );
    if (limited) return limited;
    const receivedAt = requestNow;
    await ctx.db.insert("outcome_receipts", {
      siteId,
      canonicalDomain,
      domainRevision,
      articleId,
      publicationDeliveryKey: candidate.publicationDeliveryKey,
      eventId: candidate.eventId,
      eventType: candidate.eventType,
      articleUrl: candidate.articleUrl,
      sessionId: candidate.sessionId,
      goalKey: candidate.goalKey,
      occurredAt: candidate.occurredAt,
      receivedAt,
    });

    const date = outcomeUtcDay(
      outcomeAttributionOccurredAt(sessionCandidates, candidate),
    );
    const rollupRows = siteUsesLegacyDomainReceipts(site)
      ? await ctx.db
        .query("outcome_daily_rollups")
        .withIndex("by_site_article_goal_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("articleId", articleId)
            .eq("goalKey", candidate.goalKey)
            .eq("date", date)
        )
        .take(2)
      : await ctx.db
        .query("outcome_daily_rollups")
        .withIndex("by_site_domain_revision_article_goal_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("canonicalDomain", canonicalDomain)
            .eq("domainRevision", domainRevision)
            .eq("articleId", articleId)
            .eq("goalKey", candidate.goalKey)
            .eq("date", date)
        )
        .take(2);
    if (rollupRows.length > 1) {
      throw new Error("Outcome daily rollup state is ambiguous");
    }
    const rollup = rollupRows[0];
    // Keep the legacy column legacy-only. Organic landings have their own
    // field so summary readers can combine them once without double-counting.
    const landingIncrement = candidate.eventType === "landing_session" ? 1 : 0;
    const actionIncrement = candidate.eventType === "qualified_action" ? 1 : 0;
    const organicLandingIncrement =
      candidate.eventType === "organic_landing" ? 1 : 0;
    const signupIncrement = candidate.eventType === "signup" ? 1 : 0;
    const activationIncrement = candidate.eventType === "activation" ? 1 : 0;
    const paidConversionIncrement =
      candidate.eventType === "paid_conversion" ? 1 : 0;
    if (rollup) {
      await ctx.db.patch(rollup._id, {
        canonicalDomain,
        domainRevision,
        landingSessions: rollup.landingSessions + landingIncrement,
        qualifiedActions: rollup.qualifiedActions + actionIncrement,
        organicLandingSessions:
          (rollup.organicLandingSessions ?? 0) + organicLandingIncrement,
        signups: (rollup.signups ?? 0) + signupIncrement,
        activations: (rollup.activations ?? 0) + activationIncrement,
        paidConversions:
          (rollup.paidConversions ?? 0) + paidConversionIncrement,
        firstOccurredAt: Math.min(rollup.firstOccurredAt, candidate.occurredAt),
        lastOccurredAt: Math.max(rollup.lastOccurredAt, candidate.occurredAt),
        updatedAt: receivedAt,
      });
    } else {
      await ctx.db.insert("outcome_daily_rollups", {
        siteId,
        canonicalDomain,
        domainRevision,
        articleId,
        date,
        goalKey: candidate.goalKey,
        landingSessions: landingIncrement,
        qualifiedActions: actionIncrement,
        organicLandingSessions: organicLandingIncrement,
        signups: signupIncrement,
        activations: activationIncrement,
        paidConversions: paidConversionIncrement,
        firstOccurredAt: candidate.occurredAt,
        lastOccurredAt: candidate.occurredAt,
        updatedAt: receivedAt,
      });
    }
    await ctx.db.patch(credential._id, {
      lastUsedAt: receivedAt,
      updatedAt: receivedAt,
    });
    return { accepted: true, duplicate: false, eventId: candidate.eventId };
  },
});

async function outcomeSummary(
  ctx: QueryCtx,
  siteId: Id<"sites">,
  since?: number,
  until?: number,
) {
  const window = normalizeOutcomeQueryWindow({
    now: Date.now(),
    since,
    until,
  });
  const startDate = outcomeUtcDay(window.since);
  const endDate = outcomeUtcDay(window.until);
  const site = await ctx.db.get(siteId);
  if (!site) throw new Error("Site not found");
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  const rows = siteUsesLegacyDomainReceipts(site)
    ? await ctx.db
      .query("outcome_daily_rollups")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", startDate).lte("date", endDate)
      )
      .take(OUTCOME_SUMMARY_ROLLUP_READ_LIMIT + 1)
    : canonicalDomain
      ? await ctx.db
        .query("outcome_daily_rollups")
        .withIndex("by_site_domain_revision_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("canonicalDomain", canonicalDomain)
            .eq("domainRevision", domainRevision)
            .gte("date", startDate)
            .lte("date", endDate)
        )
        .take(OUTCOME_SUMMARY_ROLLUP_READ_LIMIT + 1)
      : [];
  if (rows.length > OUTCOME_SUMMARY_ROLLUP_READ_LIMIT) {
    throw new Error(
      "Current-domain outcome summary exceeds the bounded rollup read limit",
    );
  }
  const articleIdsForRows = [...new Set(rows.map((row) => String(row.articleId)))];
  const currentArticles = new Map(
    (await Promise.all(articleIdsForRows.map(async (rawId) => {
      const articleId = ctx.db.normalizeId("articles", rawId);
      const article = articleId ? await ctx.db.get(articleId) : null;
      return article &&
          article.siteId === siteId &&
          articleMatchesCurrentDomain(site, article)
        ? [rawId, article] as const
        : null;
    })))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const currentRows = rows.filter((row) =>
    currentArticles.has(String(row.articleId))
  );
  const aggregate = aggregateOutcomeRollups(
    String(siteId),
    currentRows.flatMap((row) => [
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "landing_session" as const,
        goalKey: row.goalKey,
        count: row.landingSessions,
      },
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "qualified_action" as const,
        goalKey: row.goalKey,
        count: row.qualifiedActions,
      },
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "organic_landing" as const,
        goalKey: row.goalKey,
        count: row.organicLandingSessions ?? 0,
      },
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "signup" as const,
        goalKey: row.goalKey,
        count: row.signups ?? 0,
      },
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "activation" as const,
        goalKey: row.goalKey,
        count: row.activations ?? 0,
      },
      {
        siteId: String(row.siteId),
        articleId: String(row.articleId),
        eventType: "paid_conversion" as const,
        goalKey: row.goalKey,
        count: row.paidConversions ?? 0,
      },
    ]),
  );
  const articleIds = new Set(aggregate.byArticle.map((row) => row.articleId));
  const articles = [...articleIds].map((rawId) => {
      const article = currentArticles.get(rawId);
      if (!article) return null;
      return {
        articleId: rawId,
        title: article.title,
        articleUrl: article.publicUrl,
      };
    });
  const articleById = new Map(
    articles
      .filter((article): article is NonNullable<typeof article> => Boolean(article))
      .map((article) => [article.articleId, article]),
  );
  return {
    siteId,
    windowStart: window.since,
    windowEnd: window.until,
    landingSessions: aggregate.landingSessions,
    qualifiedActions: aggregate.qualifiedActions,
    organicLandingSessions: aggregate.organicLandingSessions,
    signups: aggregate.signups,
    activations: aggregate.activations,
    paidConversions: aggregate.paidConversions,
    conversionRate: aggregate.conversionRate,
    organicLandingToSignupRate: aggregate.organicLandingToSignupRate,
    signupToActivationRate: aggregate.signupToActivationRate,
    activationToPaidRate: aggregate.activationToPaidRate,
    organicLandingToPaidRate: aggregate.organicLandingToPaidRate,
    byGoal: aggregate.byGoal,
    byArticle: aggregate.byArticle
      .map((row) => ({ ...row, ...articleById.get(row.articleId) }))
      .sort((left, right) =>
        right.paidConversions - left.paidConversions ||
        right.activations - left.activations ||
        right.signups - left.signups ||
        right.qualifiedActions - left.qualifiedActions ||
        right.landingSessions - left.landingSessions
      ),
  };
}

export const getOutcomeSummary = query({
  args: {
    siteId: v.id("sites"),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, since, until }) => {
    await requireSiteOwner(ctx, siteId);
    return outcomeSummary(ctx, siteId, since, until);
  },
});

export const getOutcomeSummaryInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, since, until }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    return outcomeSummary(ctx, siteId, since, until);
  },
});

// Topic planning needs only a small, recent conversion-priority projection,
// never the full outcome ledger. An overflow returns no feedback rather than
// ranking from a silently biased suffix; strict keyword gates continue without
// this optional tie-breaker.
export const getCadencePrioritySignalsInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, limit }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const cutoff = outcomeUtcDay(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const readLimit = 500;
    const canonicalDomain = siteCanonicalDomain(site);
    const domainRevision = siteCanonicalDomainRevision(site);
    const rows = siteUsesLegacyDomainReceipts(site)
      ? await ctx.db
        .query("outcome_daily_rollups")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).gte("date", cutoff)
        )
        .order("desc")
        .take(readLimit + 1)
      : canonicalDomain
        ? await ctx.db
          .query("outcome_daily_rollups")
          .withIndex("by_site_domain_revision_date", (q) =>
            q
              .eq("siteId", siteId)
              .eq("canonicalDomain", canonicalDomain)
              .eq("domainRevision", domainRevision)
              .gte("date", cutoff)
          )
          .order("desc")
          .take(readLimit + 1)
        : [];
    if (rows.length > readLimit) {
      return { truncated: true, signals: [] };
    }
    const distinctArticleIds = [...new Set(
      rows.map((row) => String(row.articleId)),
    )];
    const currentArticleIds = new Set(
      (await Promise.all(distinctArticleIds.map(async (rawId) => {
        const articleId = ctx.db.normalizeId("articles", rawId);
        const article = articleId ? await ctx.db.get(articleId) : null;
        return article &&
            article.siteId === siteId &&
            articleMatchesCurrentDomain(site, article)
          ? rawId
          : null;
      }))).filter((rawId): rawId is string => rawId !== null),
    );
    const byArticle = new Map<string, {
      qualifiedActions: number;
      organicLandingSessions: number;
      signups: number;
      activations: number;
      paidConversions: number;
    }>();
    for (const row of rows) {
      const key = String(row.articleId);
      if (!currentArticleIds.has(key)) continue;
      const aggregate = byArticle.get(key) ?? {
        qualifiedActions: 0,
        organicLandingSessions: 0,
        signups: 0,
        activations: 0,
        paidConversions: 0,
      };
      aggregate.qualifiedActions += row.qualifiedActions;
      aggregate.organicLandingSessions += row.organicLandingSessions ?? 0;
      aggregate.signups += row.signups ?? 0;
      aggregate.activations += row.activations ?? 0;
      aggregate.paidConversions += row.paidConversions ?? 0;
      byArticle.set(key, aggregate);
    }
    const maximum = Math.max(1, Math.min(limit ?? 50, 50));
    const ranked = [...byArticle.entries()]
      .sort((left, right) =>
        right[1].paidConversions - left[1].paidConversions ||
        right[1].activations - left[1].activations ||
        right[1].signups - left[1].signups ||
        right[1].qualifiedActions - left[1].qualifiedActions ||
        right[1].organicLandingSessions - left[1].organicLandingSessions
      )
      .slice(0, maximum);
    const signals = (await Promise.all(ranked.map(async ([rawId, counts]) => {
      const articleId = ctx.db.normalizeId("articles", rawId);
      const article = articleId ? await ctx.db.get(articleId) : null;
      const topic = article?.topicId ? await ctx.db.get(article.topicId) : null;
      if (
        !article ||
        article.siteId !== siteId ||
        !articleMatchesCurrentDomain(site, article) ||
        !topic ||
        topic.siteId !== siteId ||
        !topicMatchesCurrentDomain(site, topic)
      ) return null;
      return { keyword: topic.primaryKeyword, ...counts };
    }))).filter((signal): signal is NonNullable<typeof signal> =>
      Boolean(signal)
    );
    return { truncated: false, signals };
  },
});
