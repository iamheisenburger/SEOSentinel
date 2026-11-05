/** Permanent redirects Pentra makes for a site (Nov 2026): a duplicate article merged into the stronger page on its
 * searches (convex/lib/duplicatePages.ts, chosen by the weekly diagnosis). A published address never changes what it is:
 * both articles stay published in Pentra, and the weaker address answers with a permanent redirect, one hop, never a
 * chain. How each one reaches readers is recorded on its row: Pentra's own blog route serves it at once; a site that
 * renders its own pages from GitHub on Vercel gets it in its vercel.json (convex/actions/siteDiagnosis.ts); any other
 * platform is shown the action until Pentra can deliver it there. */
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { articleMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { MAX_MERGES_PER_RUN, slugKey } from "./lib/duplicatePages";

export const redirectDelivery = v.union(v.literal("pending"), v.literal("pentra_blog"), v.literal("repository"), v.literal("not_delivered"));

/** The site's redirects in force (a reverted one is history). Bounded: at most five merges a week. */
export async function activeRedirects(ctx: QueryCtx, siteId: Id<"sites">): Promise<Doc<"site_redirects">[]> {
  return (await ctx.db.query("site_redirects").withIndex("by_site_from", (q) => q.eq("siteId", siteId)).take(1000))
    .filter((row) => row.revertedAt === undefined);
}

/** The slugs merged away on a site: never listed, never in the sitemap, never a link target, never improved. */
export async function mergedSlugs(ctx: QueryCtx, siteId: Id<"sites">): Promise<Set<string>> {
  return new Set((await activeRedirects(ctx, siteId)).map((row) => row.fromSlug));
}

/** Where a merged slug now lives, or null. */
export async function redirectTarget(ctx: QueryCtx, siteId: Id<"sites">, slug: string): Promise<string | null> {
  const rows = await ctx.db.query("site_redirects").withIndex("by_site_from", (q) => q.eq("siteId", siteId).eq("fromSlug", slugKey(slug))).take(5);
  return rows.find((row) => row.revertedAt === undefined)?.toSlug ?? null;
}

async function isPublished(ctx: QueryCtx, site: Doc<"sites">, slug: string): Promise<boolean> {
  for (const candidate of [slug, `/${slug}`]) {
    const rows = await ctx.db.query("article_summaries").withIndex("by_site_slug", (q) => q.eq("siteId", site._id).eq("slug", candidate)).take(20);
    if (rows.some((row) => row.status === "published" && articleMatchesCurrentDomain(site, row))) return true;
  }
  return false;
}

/** Records the week's merges. Each is checked again here: both articles published on the site, the old address not
 * already redirected, and the new one not itself redirected (never a chain). Pages already merged into the old address
 * are re-pointed straight at its new home. */
export const recordMerges = internalMutation({
  args: { siteId: v.id("sites"), merges: v.array(v.object({ fromSlug: v.string(), toSlug: v.string(), evidence: v.string() })) },
  handler: async (ctx, { siteId, merges }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) return [];
    const active = await activeRedirects(ctx, siteId);
    const redirected = new Set(active.map((row) => row.fromSlug));
    const recorded: Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string }> = [];
    const now = Date.now();
    for (const merge of merges.slice(0, MAX_MERGES_PER_RUN)) {
      const fromSlug = slugKey(merge.fromSlug), toSlug = slugKey(merge.toSlug);
      if (!fromSlug || !toSlug || fromSlug === toSlug || redirected.has(fromSlug) || redirected.has(toSlug)) continue;
      if (!(await isPublished(ctx, site, fromSlug)) || !(await isPublished(ctx, site, toSlug))) continue;
      for (const row of active) {
        if (row.toSlug !== fromSlug) continue;
        await ctx.db.patch(row._id, { toSlug, repointedAt: now,
          ...(row.delivery === "repository" ? { delivery: "pending" as const, verifiedAt: undefined, verifyFailedAt: undefined } : {}) });
        row.toSlug = toSlug;
      }
      const id = await ctx.db.insert("site_redirects", { siteId, fromSlug, toSlug, reason: "merged_duplicate",
        evidence: merge.evidence.slice(0, 600), delivery: "pending", createdAt: now });
      redirected.add(fromSlug);
      recorded.push({ id, fromSlug, toSlug });
    }
    return recorded;
  },
});

/** The redirects still waiting to reach readers (new ones, re-pointed ones, and ones a failed delivery left). */
export const pendingDelivery = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) =>
  (await activeRedirects(ctx, siteId)).filter((row) => row.delivery === "pending").map((row) => ({ id: row._id, fromSlug: row.fromSlug, toSlug: row.toSlug })) });

/** The site's redirects in force, with how each reaches readers. */
export const activeInternal = internalQuery({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) =>
  (await activeRedirects(ctx, siteId)).map((row) => ({ id: row._id, fromSlug: row.fromSlug, toSlug: row.toSlug, delivery: row.delivery,
    verifiedAt: row.verifiedAt ?? null })) });

export const markDelivery = internalMutation({
  args: { siteId: v.id("sites"), rows: v.array(v.object({ id: v.id("site_redirects"), delivery: redirectDelivery, note: v.optional(v.string()),
    commitSha: v.optional(v.string()), verified: v.optional(v.boolean()) })) },
  handler: async (ctx, { siteId, rows }) => {
    const now = Date.now();
    for (const row of rows) {
      const current = await ctx.db.get(row.id);
      if (!current || current.siteId !== siteId || current.revertedAt !== undefined) continue;
      await ctx.db.patch(row.id, { delivery: row.delivery, ...(row.note ? { deliveryNote: row.note.slice(0, 300) } : {}),
        ...(row.commitSha ? { commitSha: row.commitSha } : {}),
        ...(row.verified === true ? { verifiedAt: now, verifyFailedAt: undefined } : row.verified === false ? { verifyFailedAt: now } : {}) });
    }
  },
});

/** The owner's view: what Pentra redirected on their site, why, and whether it's live. */
export const listForSite = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject) return [];
  return (await activeRedirects(ctx, siteId)).map((row) => ({ fromSlug: row.fromSlug, toSlug: row.toSlug, evidence: row.evidence ?? null,
    delivery: row.delivery, deliveryNote: row.deliveryNote ?? null, verifiedAt: row.verifiedAt ?? null, createdAt: row.createdAt }));
} });
