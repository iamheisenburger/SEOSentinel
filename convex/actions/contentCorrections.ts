"use node";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { planCorrectiveChange } from "../lib/contentCorrection";
import { verifyBrokenLinkEvidence } from "../lib/contentCorrectionProof";
import { validateCorrectionDestinations } from "../lib/publishedCorrection";
import { exactReplacement, contentConsentToken } from "../lib/contentSelection";
import { sha256Hex } from "../lib/publicationArtifact";

const previewArgs = { siteId: v.id("sites"), pageId: v.id("pages"), baseRevision: v.string(),
  kind: v.union(v.literal("factual_correction"), v.literal("technical_repair")), before: v.string(), reason: v.string(),
  field: v.optional(v.union(v.literal("siteSummary"), v.literal("productUsage"))), targetPageId: v.optional(v.id("pages")) };
export const preview = action({ args: previewArgs, handler: async (ctx, args): Promise<{ before: string; after: string; url: string; reviewToken: string }> => {
  const { site, page, target } = await ctx.runQuery(internal.contentImprovements.correctionContext, {
    siteId: args.siteId, pageId: args.pageId, ...(args.targetPageId ? { targetPageId: args.targetPageId } : {}) });
  if (page.editable!.sourceRevision !== args.baseRevision) throw new Error("Source changed. Reload the selected page.");
  const patch = planCorrectiveChange(site, page, { kind: args.kind, before: args.before, reason: args.reason,
    ...(args.field ? { field: args.field } : {}), ...(target ? { targetUrl: target.url } : {}) });
  await verifyBrokenLinkEvidence(patch);
  return { before: patch.before, after: patch.after, url: page.url,
    reviewToken: sha256Hex(JSON.stringify([contentConsentToken(site), args.baseRevision, patch])) };
} });

export const correct = action({ args: { siteId: v.id("sites"), pageId: v.id("pages"), baseRevision: v.string(), confirm: v.boolean(),
  reviewToken: v.optional(v.string()),
  kind: v.union(v.literal("factual_correction"), v.literal("technical_repair")), before: v.string(), reason: v.string(),
  field: v.optional(v.union(v.literal("siteSummary"), v.literal("productUsage"))), targetPageId: v.optional(v.id("pages")) },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    if (!args.confirm) throw new Error("Explicit owner confirmation required for an exact correction");
    const { confirm: _confirm, reviewToken: _reviewToken, ...request } = args;
    void _confirm;
    void _reviewToken;
    const prior = await ctx.runQuery(internal.contentImprovements.priorCorrection, request);
    if (prior) return prior;
    const { site, page, target } = await ctx.runQuery(internal.contentImprovements.correctionContext, {
      siteId: args.siteId, pageId: args.pageId, ...(args.targetPageId ? { targetPageId: args.targetPageId } : {}) });
    if (page.editable!.sourceRevision !== args.baseRevision) throw new Error("Correction source changed since owner confirmation");
    const patch = planCorrectiveChange(site, page, { kind: args.kind, before: args.before, reason: args.reason,
      ...(args.field ? { field: args.field } : {}), ...(target ? { targetUrl: target.url } : {}) });
    if (args.reviewToken && args.reviewToken !== sha256Hex(JSON.stringify([contentConsentToken(site), args.baseRevision, patch]))) throw new Error("Correction preview changed. Review the exact replacement again.");
    if (patch.kind === "factual_correction") validateCorrectionDestinations(page.editable!.markdown,
      exactReplacement(page.editable!.markdown, patch.before, patch.after));
    await verifyBrokenLinkEvidence(patch);
    return ctx.runMutation(internal.contentImprovements.requestCorrection, { siteId: site._id, pageId: page._id,
      baseRevision: page.editable!.sourceRevision, permissionVersion: page.editable!.version, patch, observedAt: Date.now(),
      ...(target ? { targetPageId: target._id } : {}) });
  } });
