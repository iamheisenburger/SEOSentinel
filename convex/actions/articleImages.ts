"use node";
/** The paid step of adding images to articles published without one (convex/articleImages.ts): run only on the owner's
 * yes. Each image is made and looked at for visible defects (the same maker as a new article's), recorded, then added to
 * the live page by the repair chain. A dry run says how many articles and what they would cost, and buys nothing. Images
 * are made a few at a time, the next batch scheduled after this one, under one spend hold per batch settled at what was
 * charged. Nov 5 2026: the first run made none (each image took longer than the batch allowed, and the action hit its
 * ten-minute limit before recording one), so a batch now stops starting images after BATCH_TIME_MS, every provider call
 * ends inside the action's window, and the reasons an image was turned away come back with the result. */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { makeReviewedHeroImage } from "./pipeline";
import { withArticleExecutionBudget } from "../lib/articleExecutionBudget";
import { HERO_IMAGE_CEILING_MICRO_USD, heroImageCostMicroUsd } from "./contentWorkProvider";

/** Images per action run, and the time after which a batch starts no new image: an image and its look can take a few
 * minutes, and the action has ten. */
export const IMAGE_BATCH = 6;
export const BATCH_TIME_MS = 5 * 60_000;
const PROVIDER_WINDOW_MS = 8 * 60_000;
/** What one image is expected to cost: a medium 1536x1024 gpt-image-1.5 image and its look ($0.05 + $0.001). */
export const IMAGE_EXPECTED_MICRO_USD = 52_200;

type Result = { skipped: string } | { articles: number; batch: number; made: number; turnedAway: number; costMicroUsd: number; estimateMicroUsd?: number;
  sample?: string[]; reasons?: string[] };

export const prepareArticleImages = internalAction({ args: { siteId: v.id("sites"), limit: v.number(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, limit, dryRun }): Promise<Result> => {
    const want = Math.max(0, Math.min(200, Math.floor(limit)));
    const plan = await ctx.runQuery(internal.articleImages.candidates, { siteId, limit: dryRun ? want : Math.min(want, IMAGE_BATCH) });
    if (!plan) return { skipped: "site not active" };
    if (dryRun) return { articles: Math.min(plan.total, want), batch: 0, made: 0, turnedAway: 0, costMicroUsd: 0,
      estimateMicroUsd: Math.min(plan.total, want) * IMAGE_EXPECTED_MICRO_USD, sample: plan.pages.slice(0, 8).map((p) => p.url) };
    if (!plan.pages.length) return { articles: 0, batch: 0, made: 0, turnedAway: 0, costMicroUsd: 0 };
    const hold = await ctx.runMutation(internal.articleImages.reserve, { siteId, reservedMicroUsd: plan.pages.length * HERO_IMAGE_CEILING_MICRO_USD });
    if (!hold.ok) return { skipped: `provider budget: ${hold.reason}` };
    const started = Date.now();
    let spent = 0, made = 0, turnedAway = 0, tried = 0;
    const reasons: string[] = [];
    await withArticleExecutionBudget(async () => {
      for (const page of plan.pages) {
        if (Date.now() - started > BATCH_TIME_MS) break;
        tried++;
        try {
          const image = await makeReviewedHeroImage(ctx, { title: page.title, niche: plan.niche, brandingPrompt: plan.brandingPrompt, brandColor: plan.brandColor });
          const cost = Math.min(HERO_IMAGE_CEILING_MICRO_USD, heroImageCostMicroUsd(image.attempts));
          spent += cost;
          if (image.url) {
            await ctx.runMutation(internal.articleImages.record, { siteId, pageId: page.pageId, url: image.url, alt: page.title, costMicroUsd: cost });
            made++;
          } else { turnedAway++; reasons.push(...image.notes.slice(0, 2)); }
        } catch (error) {
          // A lost provider answer is charged at its ceiling, never assumed free.
          spent += HERO_IMAGE_CEILING_MICRO_USD;
          turnedAway++;
          reasons.push(error instanceof Error ? error.message.slice(0, 160) : "no answer");
        }
      }
    }, PROVIDER_WINDOW_MS);
    await ctx.runMutation(internal.articleImages.close, { siteId, reservationId: hold.reservationId, actualMicroUsd: spent });
    if (made) await ctx.scheduler.runAfter(0, internal.contentImprovements.requestRelatedReadingRepair, { siteId });
    const remaining = want - tried;
    if (remaining > 0 && made > 0) await ctx.scheduler.runAfter(0, internal.actions.articleImages.prepareArticleImages, { siteId, limit: remaining });
    return { articles: plan.total, batch: tried, made, turnedAway, costMicroUsd: spent, ...(reasons.length ? { reasons: reasons.slice(0, 6) } : {}) };
  } });
