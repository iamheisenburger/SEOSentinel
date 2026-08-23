import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  articleReservesTopicIntent,
  reconciledTopicStatus,
} from "./topicLifecycle.ts";

function jobRecord(job: Doc<"jobs">): Record<string, unknown> {
  return job.payload && typeof job.payload === "object"
    ? (job.payload as Record<string, unknown>)
    : {};
}

export async function reconcileTopicLifecycle(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    topicId: Id<"topic_clusters">;
    apply?: boolean;
  },
): Promise<{
  found: boolean;
  changed: boolean;
  previousStatus?: string;
  nextStatus?: string;
  linkedArticles: number;
  reservingArticles: number;
  activeArticleJobs: number;
}> {
  const topic = await ctx.db.get(args.topicId);
  if (!topic) {
    return {
      found: false,
      changed: false,
      linkedArticles: 0,
      reservingArticles: 0,
      activeArticleJobs: 0,
    };
  }
  if (topic.siteId !== args.siteId) {
    throw new Error("Topic lifecycle reconciliation tenant mismatch");
  }

  const [linkedRows, pendingJobs, runningJobs] = await Promise.all([
    ctx.db
      .query("articles")
      .withIndex("by_topic", (q) => q.eq("topicId", args.topicId))
      .collect(),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", args.siteId).eq("status", "pending")
      )
      .collect(),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", args.siteId).eq("status", "running")
      )
      .collect(),
  ]);
  const linkedArticles = linkedRows.filter(
    (article) => article.siteId === args.siteId,
  );
  const linkedArticleIds = new Set(
    linkedArticles.map((article) => String(article._id)),
  );
  const activeArticleJobs = [...pendingJobs, ...runningJobs].filter((job) => {
    if (job.type !== "article" || job.siteId !== args.siteId) return false;
    const payload = jobRecord(job);
    return (
      String(payload.topicId ?? "") === String(args.topicId) ||
      linkedArticleIds.has(String(job.articleId ?? "")) ||
      linkedArticleIds.has(String(payload.articleId ?? ""))
    );
  });
  const reservingArticles = linkedArticles.filter(articleReservesTopicIntent);
  const previousStatus = topic.status ?? "planned";
  const nextStatus = reconciledTopicStatus({
    currentStatus: previousStatus,
    businessFitEligible: topic.businessFitEligible,
    hasLinkedArticles: linkedArticles.length > 0,
    hasReservingArticle: reservingArticles.length > 0,
    hasActiveArticleJob: activeArticleJobs.length > 0,
  });
  const changed = previousStatus !== nextStatus;
  if (changed && args.apply !== false) {
    await ctx.db.patch(args.topicId, {
      status: nextStatus,
      updatedAt: Date.now(),
    });
  }

  return {
    found: true,
    changed,
    previousStatus,
    nextStatus,
    linkedArticles: linkedArticles.length,
    reservingArticles: reservingArticles.length,
    activeArticleJobs: activeArticleJobs.length,
  };
}

export async function reconcileJobTopicLifecycle(
  ctx: MutationCtx,
  job: Doc<"jobs">,
): Promise<void> {
  if (!job.siteId || job.type !== "article") return;
  const payload = jobRecord(job);
  let topicId = ctx.db.normalizeId(
    "topic_clusters",
    String(payload.topicId ?? ""),
  );
  if (!topicId) {
    const rawArticleId = job.articleId ?? payload.articleId;
    const articleId = ctx.db.normalizeId("articles", String(rawArticleId ?? ""));
    const article = articleId ? await ctx.db.get(articleId) : null;
    if (article?.siteId === job.siteId) topicId = article.topicId ?? null;
  }
  if (!topicId) return;
  await reconcileTopicLifecycle(ctx, {
    siteId: job.siteId,
    topicId,
  });
}
