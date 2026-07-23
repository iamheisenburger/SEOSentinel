import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "./planLimits";
import { PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import {
  MAX_PUBLICATION_ATTEMPTS,
  nextPublicationRetry,
} from "./lib/publicationLease";
import {
  autonomousRolloutActive,
  jobAuthorizedForExecution,
} from "./lib/jobRollout";

const now = () => Date.now();
export const JOB_LEASE_MS = 30 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;

function activeRollout(site: Doc<"sites"> | null): boolean {
  return autonomousRolloutActive(site);
}

function rolloutFields(site: Doc<"sites">, manual = false) {
  if (!manual && !activeRollout(site)) {
    throw new Error(
      "Automation is in fail-closed observe mode for this site",
    );
  }
  return { rolloutEpoch: site.autopilotRolloutEpoch ?? 0 };
}

function ownsJob(job: Doc<"jobs">, workerToken: string): boolean {
  return job.status === "running" && job.workerToken === workerToken;
}

async function releaseReservedUsage(
  ctx: MutationCtx,
  job: Doc<"jobs">,
): Promise<boolean> {
  if (!job.reservationId || job.articleId) return false;
  const reservation = await ctx.db.get(job.reservationId);
  if (
    reservation?.jobId === job._id &&
    reservation.type === "article_generated" &&
    reservation.state === "reserved"
  ) {
    await ctx.db.delete(reservation._id);
    return true;
  }
  return false;
}

async function raiseJobAlert(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  kind: string,
  message: string,
  details?: unknown,
) {
  const existing = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", siteId).eq("kind", kind).eq("status", "active"),
    )
    .first();
  const updatedAt = now();
  if (existing) {
    await ctx.db.patch(existing._id, { message, details, updatedAt });
  } else {
    await ctx.db.insert("autopilot_alerts", {
      siteId,
      kind,
      status: "active",
      message,
      details,
      createdAt: updatedAt,
      updatedAt,
    });
  }
}

export const listPending = internalQuery({
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

export const listPendingBySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const currentTime = now();
    const [site, jobs] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
    ]);
    return jobs.filter(
      (job) =>
        jobAuthorizedForExecution(site, job) &&
        (job.nextAttemptAt === undefined || job.nextAttemptAt <= currentTime),
    );
  },
});

export const listActiveBySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const [site, pending, running] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .collect(),
    ]);
    return [...pending, ...running].filter((job) =>
      jobAuthorizedForExecution(site, job),
    );
  },
});

export const countRecentTopicReplenishments = internalQuery({
  args: { siteId: v.id("sites"), since: v.number() },
  handler: async (ctx, { siteId, since }) => {
    const recentPlans = await ctx.db
      .query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q.eq("siteId", siteId).eq("type", "plan").gte("createdAt", since),
      )
      .take(50);
    return recentPlans.filter((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : undefined;
      return payload?.reason === "topic_overlap_replenishment";
    }).length;
  },
});

export const listAll = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const jobs = (
      await Promise.all(
        sites.map((site) =>
          ctx.db
            .query("jobs")
            .withIndex("by_site", (q) => q.eq("siteId", site._id))
            .order("desc")
            .take(50),
        ),
      )
    ).flat();
    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },
});

export const listByStatus = internalQuery({
  args: { status: v.string() },
  handler: async (ctx, { status }) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
  },
});

// Reclaim only expired worker leases. Resetting a job invalidates the old token
// before another worker can claim it. Exhausted leases become terminal instead
// of remaining "running" forever and deadlocking the tenant scheduler.
export const resetStuckJobs = internalMutation({
  args: { siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { siteId }) => {
    const currentTime = now();
    const legacyStaleAt = currentTime - JOB_LEASE_MS;
    let reset = 0;
    let terminal = 0;
    let reservationsReleased = 0;

    const runningJobs = siteId
      ? await ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "running"),
          )
          .collect()
      : await ctx.db
          .query("jobs")
          .withIndex("by_status", (q) => q.eq("status", "running"))
          .collect();
    
    for (const job of runningJobs) {
      const expired = job.leaseExpiresAt !== undefined
        ? job.leaseExpiresAt <= currentTime
        : job.updatedAt <= legacyStaleAt;
      if (!expired) continue;

      const attempts = (job.workerAttempts ?? 0) + 1;
      if (await releaseReservedUsage(ctx, job)) reservationsReleased += 1;
      const ownershipReset = {
        workerToken: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        reservationId: job.articleId ? job.reservationId : undefined,
        updatedAt: currentTime,
      };
      if (attempts <= MAX_JOB_ATTEMPTS) {
        await ctx.db.patch(job._id, {
          ...ownershipReset,
          status: "pending",
          nextAttemptAt: currentTime + attempts * 60_000,
          workerAttempts: attempts,
          error: `Worker lease expired; retry ${attempts}/${MAX_JOB_ATTEMPTS} is delayed and eligible to resume.`,
        });
        reset += 1;
      } else {
        await ctx.db.patch(job._id, {
          ...ownershipReset,
          status: "failed",
          nextAttemptAt: undefined,
          workerAttempts: attempts,
          error: `Worker lease exhausted after ${attempts} attempts; terminal failure requires operator review.`,
        });
        terminal += 1;
        if (job.siteId) {
          await raiseJobAlert(
            ctx,
            job.siteId,
            "job_lease_exhausted",
            "A content worker exhausted its lease retries and was moved to terminal failure.",
            { jobId: job._id, attempts, reservationsReleased },
          );
        }
      }
    }

    return { reset, terminal, reservationsReleased };
  },
});

export const cleanupExpiredGenerationReservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    const expired = await ctx.db
      .query("usage_log")
      .withIndex("by_state_expires", (q) =>
        q.eq("state", "reserved").lt("expiresAt", currentTime),
      )
      .take(50);
    let deleted = 0;
    for (const reservation of expired) {
      const job = reservation.jobId ? await ctx.db.get(reservation.jobId) : null;
      if (
        job &&
        job.reservationId === reservation._id &&
        job.status === "running" &&
        (job.leaseExpiresAt ?? 0) > currentTime
      ) {
        await ctx.db.patch(reservation._id, {
          expiresAt: (job.leaseExpiresAt ?? currentTime) + 5 * 60 * 1000,
        });
        continue;
      }
      if (
        !job ||
        job.articleId ||
        job.reservationId !== reservation._id ||
        job.status !== "running" ||
        (job.leaseExpiresAt ?? 0) <= currentTime
      ) {
        await ctx.db.delete(reservation._id);
        if (job?.reservationId === reservation._id && !job.articleId) {
          await ctx.db.patch(job._id, {
            reservationId: undefined,
            updatedAt: currentTime,
          });
        }
        deleted += 1;
      }
    }
    return { inspected: expired.length, deleted };
  },
});

export const create = internalMutation({
  args: {
    siteId: v.optional(v.id("sites")),
    type: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, type, payload }) => {
    const allowedTypes = new Set(["onboarding", "plan", "article", "links", "scheduler"]);
    if (!allowedTypes.has(type)) throw new Error("Unsupported job type");
    const site = siteId ? await ctx.db.get(siteId) : null;
    if (siteId && !site) throw new Error("Site not found");
    const record = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : undefined;
    if (record?.topicId) {
      const topicId = ctx.db.normalizeId("topic_clusters", String(record.topicId));
      const topic = topicId ? await ctx.db.get(topicId) : null;
      if (!topic || !siteId || topic.siteId !== siteId) {
        throw new Error("Topic does not belong to the job site");
      }
    }
    if (record?.articleId) {
      const articleId = ctx.db.normalizeId("articles", String(record.articleId));
      const article = articleId ? await ctx.db.get(articleId) : null;
      if (!article || !siteId || article.siteId !== siteId) {
        throw new Error("Article does not belong to the job site");
      }
    }
    return await ctx.db.insert("jobs", {
      siteId,
      type,
      status: "pending",
      payload,
      ...(site ? rolloutFields(site, payload?.manual === true) : {}),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

async function activeJobsForSite(ctx: MutationCtx, siteId: Id<"sites">) {
  const [site, pending, running] = await Promise.all([
    ctx.db.get(siteId),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "pending"),
      )
      .collect(),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "running"),
      )
      .collect(),
  ]);
  return [...pending, ...running].filter((job) =>
    jobAuthorizedForExecution(site, job),
  );
}

// The topic transition and job insert share one serializable mutation. Two
// overlapping cadence ticks therefore cannot enqueue the same topic twice.
export const queueTopicArticleIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.id("topic_clusters"),
    bufferFill: v.boolean(),
    manual: v.optional(v.boolean()),
    options: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, topicId, bufferFill, manual, options }) => {
    const [site, topic] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(topicId),
    ]);
    if (!site || !topic || topic.siteId !== siteId) {
      throw new Error("Topic does not belong to the site");
    }
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return job.type === "article" && payload.topicId === topicId;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    if (!manual && ["used", "queued", "cannibalizing"].includes(topic.status ?? "")) {
      return { queued: false, reason: "topic_not_available" as const };
    }
    const timestamp = now();
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId, bufferFill, manual: manual === true, options },
      ...rolloutFields(site, manual === true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(topicId, { status: "queued", updatedAt: timestamp });
    return { queued: true, jobId };
  },
});

export const queueManualArticleIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    options: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, options }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      if (job.type !== "article") return false;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return payload.manual === true && !payload.topicId;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    const timestamp = now();
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { manual: true, options },
      ...rolloutFields(site, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { queued: true, jobId };
  },
});

export const queueQualityRetryIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    bufferFill: v.boolean(),
  },
  handler: async (ctx, { siteId, articleId, bufferFill }) => {
    const [article, site] = await Promise.all([
      ctx.db.get(articleId),
      ctx.db.get(siteId),
    ]);
    if (!site) throw new Error("Site not found");
    if (!article || article.siteId !== siteId || article.status === "published") {
      throw new Error("Article is not eligible for quality recovery");
    }
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return payload.qualityRetry === true && payload.articleId === articleId;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    const timestamp = now();
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { articleId, qualityRetry: true, bufferFill },
      articleId,
      ...rolloutFields(site),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { queued: true, jobId };
  },
});

export const queuePlanIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    reason: v.optional(v.string()),
    cannibalizingTopicIds: v.optional(v.array(v.id("topic_clusters"))),
    since: v.optional(v.number()),
    maximumRecent: v.optional(v.number()),
    manual: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("Site not found");
    const active = await activeJobsForSite(ctx, args.siteId);
    const duplicate = active.find((job) => job.type === "plan");
    if (duplicate) return { queued: false, jobId: duplicate._id, reason: "active" as const };

    let recentCount = 0;
    if (args.reason && args.since !== undefined && args.maximumRecent !== undefined) {
      const recent = await ctx.db
        .query("jobs")
        .withIndex("by_site_type_created", (q) =>
          q.eq("siteId", args.siteId).eq("type", "plan").gte("createdAt", args.since!),
        )
        .take(50);
      const count = recent.filter((job) => {
        const payload = job.payload && typeof job.payload === "object"
          ? (job.payload as Record<string, unknown>)
          : {};
        return payload.reason === args.reason;
      }).length;
      recentCount = count;
      if (recentCount >= args.maximumRecent) {
        return { queued: false, reason: "recent_limit" as const, recent: recentCount };
      }
    }

    for (const topicId of args.cannibalizingTopicIds ?? []) {
      const topic = await ctx.db.get(topicId);
      if (topic?.siteId === args.siteId && topic.status !== "used") {
        await ctx.db.patch(topicId, { status: "cannibalizing", updatedAt: now() });
      }
    }
    const timestamp = now();
    const payload = args.reason || args.manual
      ? {
          ...(args.reason ? {
            reason: args.reason,
            replenishmentSequence: recentCount + 1,
          } : {}),
          ...(args.manual === true ? { manual: true } : {}),
        }
      : undefined;
    const jobId = await ctx.db.insert("jobs", {
      siteId: args.siteId,
      type: "plan",
      status: "pending",
      payload,
      ...rolloutFields(site, args.manual === true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { queued: true, jobId, recent: recentCount };
  },
});

export const queuePublicationIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { siteId, articleId }) => {
    const [article, site] = await Promise.all([
      ctx.db.get(articleId),
      ctx.db.get(siteId),
    ]);
    if (!site) throw new Error("Site not found");
    if (
      !article ||
      article.siteId !== siteId ||
      article.status !== "ready" ||
      article.publicationGateStatus !== "passed" ||
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      !article.auditedContentHash
    ) {
      throw new Error("Only a strict-quality sealed ready article can enter the delivery queue");
    }
    const [pending, running] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .collect(),
    ]);
    const duplicate = [...pending, ...running].find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : undefined;
      return payload?.publishOnly === true;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: {
        articleId,
        publishOnly: true,
        bufferDelivery: true,
      },
      ...rolloutFields(site),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    if (!article.publicationDate) {
      await ctx.db.patch(articleId, { publicationDate: now(), updatedAt: now() });
    }
    return { queued: true, jobId };
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job?.siteId) return null;
    const site = await ctx.db.get(job.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this job");
    }
    return job;
  },
});

export const getInternal = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const markRunning = internalMutation({
  args: {
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const currentTime = now();
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "pending" ||
      !jobAuthorizedForExecution(site, job) ||
      (job.nextAttemptAt !== undefined && job.nextAttemptAt > currentTime)
    ) return null;
    await ctx.db.patch(args.jobId, {
      status: "running",
      workerToken: args.workerToken,
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      nextAttemptAt: undefined,
      updatedAt: currentTime,
    });
    return { ...job, status: "running", workerToken: args.workerToken };
  },
});

// Atomically transition one exact pending job to running. Convex mutations are
// serializable, so overlapping natural/follow-up ticks cannot both claim the
// same generation job and consume duplicate provider/quota work.
export const claimPending = internalMutation({
  args: {
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    workerToken: v.string(),
  },
  handler: async (ctx, { jobId, siteId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    const updatedAt = now();
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    const runningJobs = job
      ? await ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "running"),
          )
          .collect()
      : [];
    const otherRunning = runningJobs.find(
      (candidate) =>
        candidate._id !== jobId &&
        jobAuthorizedForExecution(site, candidate),
    );
    if (
      !job ||
      job.siteId !== siteId ||
      job.status !== "pending" ||
      !jobAuthorizedForExecution(site, job) ||
      otherRunning !== undefined ||
      (job.nextAttemptAt !== undefined && job.nextAttemptAt > updatedAt)
    ) {
      return null;
    }
    const leaseExpiresAt = updatedAt + JOB_LEASE_MS;
    await ctx.db.patch(jobId, {
      status: "running",
      workerToken,
      heartbeatAt: updatedAt,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      updatedAt,
    });
    return {
      ...job,
      status: "running",
      workerToken,
      heartbeatAt: updatedAt,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      updatedAt,
    };
  },
});

export const heartbeatWorker = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string() },
  handler: async (ctx, { jobId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    if (
      !job ||
      !ownsJob(job, workerToken) ||
      !jobAuthorizedForExecution(site, job)
    ) return { owned: false };
    const currentTime = now();
    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === jobId) {
        await ctx.db.patch(reservation._id, {
          expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
        });
      }
    }
    await ctx.db.patch(jobId, {
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      updatedAt: currentTime,
    });
    return { owned: true, leaseExpiresAt: currentTime + JOB_LEASE_MS };
  },
});

export const reserveGenerationSlot = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    userId: v.string(),
    siteId: v.id("sites"),
    maxArticles: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.siteId !== args.siteId || !ownsJob(job, args.workerToken)) {
      return { ok: false, reason: "Worker lease lost" };
    }
    if (job.articleId) {
      return { ok: true, reason: "Article checkpoint already exists", articleId: job.articleId };
    }
    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === job._id) {
        await ctx.db.patch(reservation._id, {
          expiresAt: now() + JOB_LEASE_MS + 5 * 60 * 1000,
        });
        return { ok: true, reason: "Existing reservation", reservationId: reservation._id };
      }
    }

    const currentTime = now();
    const date = new Date(currentTime);
    const monthStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    ).getTime();
    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", args.userId)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart),
      )
      .collect();
    const count = logs.filter(
      (log) => log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
    ).length;
    if (count >= args.maxArticles) {
      return { ok: false, reason: `Limit reached (${count}/${args.maxArticles})` };
    }
    const reservationId = await ctx.db.insert("usage_log", {
      userId: args.userId,
      siteId: args.siteId,
      jobId: args.jobId,
      type: "article_generated",
      state: "reserved",
      expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
      createdAt: currentTime,
    });
    await ctx.db.patch(args.jobId, { reservationId, updatedAt: currentTime });
    return { ok: true, reason: "", reservationId };
  },
});

export const releaseGenerationReservation = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string() },
  handler: async (ctx, { jobId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken) || job.articleId) {
      return { released: false };
    }
    const released = await releaseReservedUsage(ctx, job);
    if (released) {
      await ctx.db.patch(jobId, { reservationId: undefined, updatedAt: now() });
    }
    return { released };
  },
});

export const markDone = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    result: v.optional(v.any()),
  },
  handler: async (ctx, { jobId, workerToken, result }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) return { updated: false };
    await ctx.db.patch(jobId, {
      status: "done",
      result,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: now(),
    });
    return { updated: true };
  },
});

export const markFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) return { updated: false };
    await releaseReservedUsage(ctx, job);
    await ctx.db.patch(jobId, {
      status: "failed",
      error,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: now(),
    });
    return { updated: true };
  },
});

export const markRetryableFailure = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) return { updated: false, willRetry: false };
    const attempts = (job.workerAttempts ?? 0) + 1;
    const willRetry = attempts <= MAX_JOB_ATTEMPTS;
    if (!job.articleId && await releaseReservedUsage(ctx, job)) {
      job.reservationId = undefined;
    }
    const currentTime = now();
    await ctx.db.patch(jobId, {
      status: willRetry ? "pending" : "failed",
      workerAttempts: attempts,
      error: willRetry
        ? `Transient worker failure; retry ${attempts}/${MAX_JOB_ATTEMPTS}: ${error}`
        : `Worker failure exhausted after ${attempts} attempts: ${error}`,
      nextAttemptAt: willRetry
        ? currentTime + Math.min(15, 2 ** attempts) * 60_000
        : undefined,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    if (!willRetry && job.siteId) {
      await raiseJobAlert(
        ctx,
        job.siteId,
        "job_retry_exhausted",
        "A content job exhausted its bounded retry attempts.",
        { jobId, attempts, articleId: job.articleId, error },
      );
    }
    return { updated: true, willRetry, attempts };
  },
});

// Preserve the generated article when only delivery failed. The retry worker
// can publish this exact approved draft instead of generating another article
// for the same topic and consuming a second monthly quota slot.
export const markPublishFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    articleId: v.id("articles"),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, articleId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!ownsJob(job, workerToken)) return { updated: false, willRetry: false, attempts: job.publicationAttempts ?? 0, maxAttempts: MAX_PUBLICATION_ATTEMPTS };
    const article = await ctx.db.get(articleId);
    if (!job.siteId || !article || article.siteId !== job.siteId) {
      throw new Error("Article does not belong to the job site");
    }
    const existingPayload =
      job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
    const { attempts, willRetry, retryDelayMs } = nextPublicationRetry(
      job.publicationAttempts ?? 0,
    );
    const currentTime = now();
    await ctx.db.patch(jobId, {
      status: willRetry ? "pending" : "failed",
      error: willRetry
        ? `Publication attempt ${attempts}/${MAX_PUBLICATION_ATTEMPTS} failed: ${error}`
        : `Publication retry exhausted after ${attempts}/${MAX_PUBLICATION_ATTEMPTS} attempts: ${error}`,
      publicationAttempts: attempts,
      payload: {
        ...existingPayload,
        articleId,
        publishOnly: true,
      },
      articleId,
      nextAttemptAt: willRetry ? currentTime + retryDelayMs : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    if (willRetry) {
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internal.autopilot.dispatchSiteFollowup,
        {
          siteId: job.siteId,
          trigger: "publication_retry",
          reason: `publication_retry_${attempts}`,
        },
      );
    }
    return {
      updated: true,
      willRetry,
      attempts,
      maxAttempts: MAX_PUBLICATION_ATTEMPTS,
    };
  },
});

export const updateProgress = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    current: v.number(),
    total: v.number(),
    stepLabel: v.string(),
    topicLabel: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, workerToken, current, total, stepLabel, topicLabel }) => {
    const job = await ctx.db.get(jobId);
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    if (
      !job ||
      !ownsJob(job, workerToken) ||
      !jobAuthorizedForExecution(site, job)
    ) {
      throw new Error("Worker lease lost");
    }
    const currentTime = now();
    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === jobId) {
        await ctx.db.patch(reservation._id, {
          expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
        });
      }
    }
    await ctx.db.patch(jobId, {
      stepProgress: { current, total, stepLabel, topicLabel },
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      updatedAt: currentTime,
    });
    return { owned: true };
  },
});

export const getRunningBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access jobs for this site");
    }
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "running"),
      )
      .collect();
    return (
      jobs.find((j) => j.status === "running" && (j.type === "article" || j.type === "plan")) ?? null
    );
  },
});

/**
 * Create an article job and immediately schedule autopilotTick to process it.
 * Clients call this instead of invoking generateArticle directly — avoids
 * WebSocket timeout errors on long-running actions.
 */
// Find the pending job for a specific topic
export const getPendingByTopic = query({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return null;
    const site = await ctx.db.get(topic.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this topic's jobs");
    }
    const pending = await ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", topic.siteId).eq("status", "pending"),
      )
      .collect();
    return pending.find(
      (j) => j.siteId === topic.siteId && (j.payload as any)?.topicId === topicId,
    ) ?? null;
  },
});

// Run a specific queued topic NOW — finds its pending job and schedules processing
export const runQueuedTopic = mutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const requestedTopic = await ctx.db.get(topicId);
    if (!requestedTopic) throw new Error("Topic not found.");
    const requestedSite = await ctx.db.get(requestedTopic.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (
      !requestedSite?.userId ||
      !identity ||
      identity.subject !== requestedSite.userId
    ) {
      throw new Error("Not authorized to run this topic");
    }
    const active = await activeJobsForSite(ctx, requestedTopic.siteId);
    const existing = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return job.type === "article" && payload.topicId === topicId;
    });
    if (existing) {
      if (existing.status === "pending" && (existing.nextAttemptAt ?? 0) <= now()) {
        await ctx.scheduler.runAfter(0, internal.actions.pipeline.processSpecificJob, {
          jobId: existing._id,
        });
      }
      return existing._id;
    }
    if (requestedTopic.status === "used") {
      throw new Error("This topic already has a generated article");
    }
    const siteId = requestedTopic.siteId;

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId, manual: true },
      ...rolloutFields(requestedSite, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    await ctx.db.patch(topicId, { status: "queued", updatedAt: now() });

    await ctx.scheduler.runAfter(0, internal.actions.pipeline.processSpecificJob, {
      jobId,
    });
    return jobId;
  },
});

export const queueArticleNow = mutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
  },
  handler: async (ctx, { siteId, topicId }) => {
    // ── Article quota check (uses immutable usage_log — survives deletions) ──
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to queue content for this site");
    }
    if (site?.userId) {
      const features = (site as any).planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);

      // Count from usage_log (immutable — deletions cannot reduce count)
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartMs = monthStart.getTime();

      const logs = await ctx.db
        .query("usage_log")
        .withIndex("by_user_type_created", (q) =>
          q
            .eq("userId", site.userId!)
            .eq("type", "article_generated")
            .gte("createdAt", monthStartMs),
        )
        .collect();
      const currentTime = now();
      const articlesThisMonth = logs.filter(
        (log) =>
          log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
      ).length;

      if (articlesThisMonth >= limits.maxArticles) {
        throw new Error(
          `Article limit reached (${limits.maxArticles}/month). Upgrade your plan for more articles.`,
        );
      }

      // ── Site over-limit check (downgrade protection) ──
      const userSites = await ctx.db
        .query("sites")
        .withIndex("by_user", (q) => q.eq("userId", site.userId!))
        .take(limits.maxSites + 1);
      if (userSites.length > limits.maxSites) {
        throw new Error(
          `You have ${userSites.length} sites but your plan allows ${limits.maxSites}. Remove excess sites or upgrade to continue.`,
        );
      }
    }

    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      if (job.type !== "article") return false;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return topicId ? payload.topicId === topicId : payload.manual === true;
    });
    if (duplicate) return duplicate._id;

    if (topicId) {
      const topic = await ctx.db.get(topicId);
      if (!topic || topic.siteId !== siteId) {
        throw new Error("Topic does not belong to this site");
      }
      if (topic.status === "used") {
        throw new Error("This topic already has a generated article");
      }
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId: topicId ?? undefined, manual: true },
      ...rolloutFields(site, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    if (topicId) {
      await ctx.db.patch(topicId, { status: "queued", updatedAt: now() });
    }

    // Schedule processSpecificJob to run ONLY this job — no autopilotTick
    // This prevents scheduleCadence from creating extra jobs or auto-generating past limits
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.processSpecificJob, { jobId });

    return jobId;
  },
});
