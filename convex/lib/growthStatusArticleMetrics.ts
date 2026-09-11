import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const ARTICLE_READ_LIMIT = 500;

function verifiedPublication(article: Doc<"articles"> | null) {
  return Boolean(article?.status === "published" && article.publicationReceipt &&
    article.publicUrlStatus === "verified" && article.publicUrlVerifiedAt);
}

function readyArticle(article: Doc<"articles"> | Doc<"article_summaries">) {
  return article.status === "ready" && article.publicationGateStatus === "passed" &&
    Boolean(article.auditedContentHash);
}

/** Status needs counts, not every draft body. Summary writes are atomic with
 * article writes after the existing integrity migration. Publication claims
 * still require the current authoritative receipt, never a summary alone. */
export async function growthStatusArticleMetrics(ctx: QueryCtx, siteId: Id<"sites">) {
  const migration = await ctx.db.query("maintenance_state")
    .withIndex("by_key", q => q.eq("key", "publication-integrity-v4")).first();
  if (migration?.status === "completed") {
    const summaries = await ctx.db.query("article_summaries")
      .withIndex("by_site", q => q.eq("siteId", siteId)).take(ARTICLE_READ_LIMIT + 1);
    // On overflow retain the legacy bounded sample's ordering/semantics.
    if (summaries.length <= ARTICLE_READ_LIMIT) {
      const candidates = summaries.filter(row => row.status === "published" &&
        row.publicUrlStatus === "verified" && row.publicUrlVerifiedAt);
      const originals = await Promise.all(candidates.map(row => ctx.db.get(row.articleId)));
      return {
        articleCount: summaries.length,
        readyBuffer: summaries.filter(readyArticle).length,
        publishedUrls: originals.filter(row => row?.siteId === siteId && verifiedPublication(row)).length,
      };
    }
  }
  const articles = await ctx.db.query("articles")
    .withIndex("by_site", q => q.eq("siteId", siteId)).take(ARTICLE_READ_LIMIT);
  return {
    articleCount: articles.length,
    readyBuffer: articles.filter(readyArticle).length,
    publishedUrls: articles.filter(verifiedPublication).length,
  };
}
