"use node";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { planCorrectiveChange } from "../lib/contentCorrection";
import { verifyBrokenLinkEvidence } from "../lib/contentCorrectionProof";
import { validateCorrectionDestinations } from "../lib/publishedCorrection";
import { exactReplacement } from "../lib/contentSelection";

export const correct = action({ args: { siteId: v.id("sites"), pageId: v.id("pages"), baseRevision: v.string(), confirm: v.boolean(),
  kind: v.union(v.literal("factual_correction"), v.literal("technical_repair")), before: v.string(), reason: v.string(),
  field: v.optional(v.union(v.literal("siteSummary"), v.literal("productUsage"))), targetPageId: v.optional(v.id("pages")) },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    if (!args.confirm) throw new Error("Explicit owner confirmation required for an exact correction");
    const { confirm: _confirm, ...request } = args;
    void _confirm;
    const prior = await ctx.runQuery(internal.contentImprovements.priorCorrection, request);
    if (prior) return prior;
    const { site, page, target } = await ctx.runQuery(internal.contentImprovements.correctionContext, {
      siteId: args.siteId, pageId: args.pageId, ...(args.targetPageId ? { targetPageId: args.targetPageId } : {}) });
    if (page.editable!.sourceRevision !== args.baseRevision) throw new Error("Correction source changed since owner confirmation");
    const patch = planCorrectiveChange(site, page, { kind: args.kind, before: args.before, reason: args.reason,
      ...(args.field ? { field: args.field } : {}), ...(target ? { targetUrl: target.url } : {}) });
    if (patch.kind === "factual_correction") validateCorrectionDestinations(page.editable!.markdown,
      exactReplacement(page.editable!.markdown, patch.before, patch.after));
    await verifyBrokenLinkEvidence(patch);
    return ctx.runMutation(internal.contentImprovements.requestCorrection, { siteId: site._id, pageId: page._id,
      baseRevision: page.editable!.sourceRevision, permissionVersion: page.editable!.version, patch, observedAt: Date.now(),
      ...(target ? { targetPageId: target._id } : {}) });
  } });
