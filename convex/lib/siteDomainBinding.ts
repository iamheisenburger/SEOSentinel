import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DomainBoundSite = {
  domain?: string;
  canonicalDomain?: string;
  canonicalDomainRevision?: number;
  contentAnalysisCanonicalDomain?: string;
  contentAnalysisDomainRevision?: number;
  gscAccessToken?: string;
  gscProperty?: string;
  gscCanonicalDomain?: string;
  gscDomainRevision?: number;
  gscConnectionRevision?: number;
};

type DomainBoundPage = {
  url: string;
  canonicalDomain?: string;
  domainRevision?: number;
};

type DomainBoundTopic = {
  planningCanonicalDomain?: string;
  planningDomainRevision?: number;
};

type DomainBoundArticle = {
  canonicalDomain?: string;
  domainRevision?: number;
};

type GscInspectionBound = {
  gscInspectionConnectionRevision?: number;
  gscInspectionProperty?: string;
};

export function normalizeCanonicalDomain(value: string): string | null {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value.trim())
        ? value.trim()
        : `https://${value.trim()}`,
    );
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "")
      .replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function siteCanonicalDomain(
  site: Pick<DomainBoundSite, "domain" | "canonicalDomain">,
): string | null {
  return normalizeCanonicalDomain(site.canonicalDomain ?? site.domain ?? "");
}

export function siteCanonicalDomainRevision(
  site: Pick<DomainBoundSite, "canonicalDomainRevision">,
): number {
  return Number.isSafeInteger(site.canonicalDomainRevision) &&
      (site.canonicalDomainRevision ?? -1) >= 0
    ? site.canonicalDomainRevision!
    : 0;
}

export function siteGscConnectionRevision(
  site: Pick<DomainBoundSite, "gscConnectionRevision">,
): number {
  return Number.isSafeInteger(site.gscConnectionRevision) &&
      (site.gscConnectionRevision ?? -1) >= 0
    ? site.gscConnectionRevision!
    : 0;
}

export function nextGscConnectionRevision(
  site: Pick<DomainBoundSite, "gscConnectionRevision">,
): number {
  const current = siteGscConnectionRevision(site);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Search Console connection revision exhausted");
  }
  return current + 1;
}

function exactReceiptBinding(args: {
  currentDomain: string;
  currentRevision: number;
  legacyFallbackAllowed: boolean;
  receiptDomain?: string;
  receiptRevision?: number;
}): boolean {
  const receiptDomain = args.receiptDomain
    ? normalizeCanonicalDomain(args.receiptDomain)
    : null;
  if (args.receiptRevision !== undefined || receiptDomain) {
    return Number.isSafeInteger(args.receiptRevision) &&
      args.receiptRevision === args.currentRevision &&
      receiptDomain === args.currentDomain;
  }
  // Rows from before the additive receipt contract remain valid only on a
  // site that has never crossed a canonical-domain boundary.
  return args.legacyFallbackAllowed;
}

export function siteUsesLegacyDomainReceipts(
  site: Pick<DomainBoundSite, "canonicalDomainRevision">,
): boolean {
  return site.canonicalDomainRevision === undefined;
}

/** Raw Search Console rows predate both the domain and connection receipt
 * contracts. Undefined/zero is the same legacy connection (a token refresh
 * can materialize zero); a fresh OAuth establishment advances to at least one
 * and must hide every prior-connection row immediately. Asynchronous pruning
 * is cleanup, never an authorization or read fence. */
export function siteUsesLegacyGscRows(
  site: Pick<
    DomainBoundSite,
    "canonicalDomainRevision" | "gscConnectionRevision"
  >,
): boolean {
  return site.canonicalDomainRevision === undefined &&
    (site.gscConnectionRevision === undefined ||
      site.gscConnectionRevision === 0);
}

export function contentAnalysisMatchesCurrentDomain(
  site: DomainBoundSite,
): boolean {
  const currentDomain = siteCanonicalDomain(site);
  if (!currentDomain) return false;
  return exactReceiptBinding({
    currentDomain,
    currentRevision: siteCanonicalDomainRevision(site),
    legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
    receiptDomain: site.contentAnalysisCanonicalDomain,
    receiptRevision: site.contentAnalysisDomainRevision,
  });
}

export function pageMatchesCurrentDomain(
  site: DomainBoundSite,
  page: DomainBoundPage,
): boolean {
  const currentDomain = siteCanonicalDomain(site);
  if (!currentDomain) return false;
  if (
    page.canonicalDomain !== undefined ||
    page.domainRevision !== undefined
  ) {
    return exactReceiptBinding({
      currentDomain,
      currentRevision: siteCanonicalDomainRevision(site),
      legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
      receiptDomain: page.canonicalDomain,
      receiptRevision: page.domainRevision,
    });
  }
  // A legacy page has an independently checkable URL. It may be adopted only
  // before this site has ever changed canonical domains.
  return siteCanonicalDomainRevision(site) === 0 &&
    siteUsesLegacyDomainReceipts(site) &&
    normalizeCanonicalDomain(page.url) === currentDomain;
}

export function topicMatchesCurrentDomain(
  site: DomainBoundSite,
  topic: DomainBoundTopic,
): boolean {
  const currentDomain = siteCanonicalDomain(site);
  if (!currentDomain) return false;
  return exactReceiptBinding({
    currentDomain,
    currentRevision: siteCanonicalDomainRevision(site),
    legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
    receiptDomain: topic.planningCanonicalDomain,
    receiptRevision: topic.planningDomainRevision,
  });
}

export function articleMatchesCurrentDomain(
  site: DomainBoundSite,
  article: DomainBoundArticle,
): boolean {
  const currentDomain = siteCanonicalDomain(site);
  if (!currentDomain) return false;
  return exactReceiptBinding({
    currentDomain,
    currentRevision: siteCanonicalDomainRevision(site),
    legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
    receiptDomain: article.canonicalDomain,
    receiptRevision: article.domainRevision,
  });
}

export function gscPropertyMatchesCanonicalDomain(
  property: string | undefined,
  canonicalDomain: string,
): boolean {
  if (!property) return false;
  const expected = normalizeCanonicalDomain(canonicalDomain);
  if (!expected) return false;
  const candidate = property.trim().toLowerCase();
  if (candidate.startsWith("sc-domain:")) {
    const hostname = candidate.slice("sc-domain:".length).replace(/\.$/, "");
    return Boolean(hostname) &&
      !hostname.includes("/") &&
      hostname === expected;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase().replace(/\.$/, "") === expected &&
      url.port === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "";
  } catch {
    return false;
  }
}

export function gscConnectionMatchesCurrentDomain(
  site: DomainBoundSite,
): boolean {
  const currentDomain = siteCanonicalDomain(site);
  if (
    !currentDomain ||
    !site.gscAccessToken ||
    !gscPropertyMatchesCanonicalDomain(site.gscProperty, currentDomain)
  ) return false;
  return exactReceiptBinding({
    currentDomain,
    currentRevision: siteCanonicalDomainRevision(site),
    legacyFallbackAllowed: siteUsesLegacyDomainReceipts(site),
    receiptDomain: site.gscCanonicalDomain,
    receiptRevision: site.gscDomainRevision,
  });
}

export function gscInspectionMatchesCurrentConnection(
  site: DomainBoundSite,
  receipt: GscInspectionBound,
): boolean {
  if (!gscConnectionMatchesCurrentDomain(site)) return false;
  if (
    receipt.gscInspectionConnectionRevision !== undefined ||
    receipt.gscInspectionProperty !== undefined
  ) {
    return receipt.gscInspectionConnectionRevision ===
        siteGscConnectionRevision(site) &&
      receipt.gscInspectionProperty === site.gscProperty;
  }
  return site.canonicalDomainRevision === undefined &&
    site.gscConnectionRevision === undefined;
}

export function nextCanonicalDomainRevision(
  site: Pick<DomainBoundSite, "canonicalDomainRevision">,
): number {
  const current = siteCanonicalDomainRevision(site);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Canonical-domain revision exhausted");
  }
  return current + 1;
}

type DomainQueryCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

/**
 * Read only the active canonical-domain topic epoch. The legacy fallback is
 * intentionally available only before the first domain transition; once a
 * stamped epoch exists it becomes the complete source of current inventory.
 */
export async function takeCurrentDomainTopics(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  limit: number,
): Promise<Doc<"topic_clusters">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .order("asc")
      .take(limit);
    return legacyEpoch.filter((topic) =>
      topicMatchesCurrentDomain(site, topic)
    );
  }
  const stamped = await ctx.db
    .query("topic_clusters")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", site._id)
        .eq("planningCanonicalDomain", canonicalDomain)
        .eq("planningDomainRevision", domainRevision)
    )
    .order("asc")
    .take(limit);
  return stamped;
}

/**
 * Read one lifecycle slice of the active topic epoch without hydrating large
 * historical planning checkpoints. Cadence admission uses this instead of a
 * tenant-wide topic scan, whose cost otherwise grows with immutable history.
 */
export async function takeCurrentDomainTopicsByStatus(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  status: string | undefined,
  limit: number,
): Promise<Doc<"topic_clusters">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .order("asc")
      .take(limit);
    return legacyEpoch.filter((topic) =>
      topicMatchesCurrentDomain(site, topic)
    );
  }
  return ctx.db
    .query("topic_clusters")
    .withIndex("by_site_domain_revision_status", (q) =>
      q
        .eq("siteId", site._id)
        .eq("planningCanonicalDomain", canonicalDomain)
        .eq("planningDomainRevision", domainRevision)
        .eq("status", status)
    )
    .order("asc")
    .take(limit);
}

/** Topic-quality tombstones participate in overlap avoidance even though
 * their lifecycle status is disqualified. Query them through their compact
 * discriminator rather than loading unrelated historical plan receipts. */
export async function takeCurrentDomainTopicsByContentFeasibility(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  contentFeasibilityStatus: string,
  limit: number,
): Promise<Doc<"topic_clusters">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site_content_feasibility", (q) =>
        q.eq("siteId", site._id).eq(
          "contentFeasibilityStatus",
          contentFeasibilityStatus,
        )
      )
      .order("asc")
      .take(limit);
    return legacyEpoch.filter((topic) =>
      topicMatchesCurrentDomain(site, topic)
    );
  }
  return ctx.db
    .query("topic_clusters")
    .withIndex("by_site_domain_revision_content_feasibility", (q) =>
      q
        .eq("siteId", site._id)
        .eq("planningCanonicalDomain", canonicalDomain)
        .eq("planningDomainRevision", domainRevision)
        .eq("contentFeasibilityStatus", contentFeasibilityStatus)
    )
    .order("asc")
    .take(limit);
}

export async function takeCurrentDomainArticles(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  limit: number,
): Promise<Doc<"articles">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .order("desc")
      .take(limit);
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  return ctx.db
    .query("articles")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
    )
    .order("desc")
    .take(limit);
}

export async function collectCurrentDomainArticles(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
): Promise<Doc<"articles">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  const rows = siteUsesLegacyDomainReceipts(site)
    ? await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect()
    : await ctx.db
      .query("articles")
      .withIndex("by_site_domain_revision", (q) =>
        q
          .eq("siteId", site._id)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", domainRevision)
      )
      .collect();
  return rows.filter((article) =>
    articleMatchesCurrentDomain(site, article)
  );
}

export async function takeCurrentDomainArticleSummaries(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  limit: number,
): Promise<Doc<"article_summaries">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_created", (q) => q.eq("siteId", site._id))
      .order("desc")
      .take(limit);
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_created", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
    )
    .order("desc")
    .take(limit);
}

export async function collectCurrentDomainArticleSummaries(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
): Promise<Doc<"article_summaries">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  const rows = siteUsesLegacyDomainReceipts(site)
    ? await ctx.db
      .query("article_summaries")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect()
    : await ctx.db
      .query("article_summaries")
      .withIndex("by_site_domain_revision", (q) =>
        q
          .eq("siteId", site._id)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", domainRevision)
      )
      .collect();
  return rows.filter((article) =>
    articleMatchesCurrentDomain(site, article)
  );
}

export async function takeCurrentDomainArticleSummariesByStatus(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  status: string,
  limit: number,
): Promise<Doc<"article_summaries">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .order("desc")
      .take(limit);
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_status", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
        .eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export async function latestCurrentDomainPublishedSummaries(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  publicationAuditVersion: number,
): Promise<Array<Doc<"article_summaries"> | null>> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [null, null];
  if (siteUsesLegacyDomainReceipts(site)) {
    const [modern, created] = await Promise.all([
      ctx.db
        .query("article_summaries")
        .withIndex("by_site_status_audit_published", (q) =>
          q
            .eq("siteId", site._id)
            .eq("status", "published")
            .eq("publicationAuditVersion", publicationAuditVersion)
        )
        .order("desc")
        .first(),
      ctx.db
        .query("article_summaries")
        .withIndex("by_site_status_created", (q) =>
          q.eq("siteId", site._id).eq("status", "published")
        )
        .order("desc")
        .first(),
    ]);
    return [modern, created].map((article) =>
      article && articleMatchesCurrentDomain(site, article) ? article : null
    );
  }
  return Promise.all([
    ctx.db
      .query("article_summaries")
      .withIndex("by_site_domain_revision_status_audit_published", (q) =>
        q
          .eq("siteId", site._id)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", domainRevision)
          .eq("status", "published")
          .eq("publicationAuditVersion", publicationAuditVersion)
      )
      .order("desc")
      .first(),
    ctx.db
      .query("article_summaries")
      .withIndex("by_site_domain_revision_status_created", (q) =>
        q
          .eq("siteId", site._id)
          .eq("canonicalDomain", canonicalDomain)
          .eq("domainRevision", domainRevision)
          .eq("status", "published")
      )
      .order("desc")
      .first(),
  ]);
}

export async function collectCurrentDomainPublishedSummariesSince(
  ctx: DomainQueryCtx,
  site: Doc<"sites">,
  publishedAfter: number,
): Promise<Doc<"article_summaries">[]> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return [];
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status_published", (q) =>
        q
          .eq("siteId", site._id)
          .eq("status", "published")
          .gte("publishedAt", publishedAfter)
      )
      .order("desc")
      .collect();
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_status_published", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
        .eq("status", "published")
        .gte("publishedAt", publishedAfter)
    )
    .order("desc")
    .collect();
}
