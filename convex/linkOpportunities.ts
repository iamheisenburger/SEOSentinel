/** Phase 4 (Nov 2026), earned links: the sites that link to a site's page-one competitors but not to it, kept per site
 * (convex/lib/linkOpportunities.ts finds them in the weekly diagnosis when the owner turned link finding on). */
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Records the week's opportunities: a domain seen again is refreshed (its status kept), a new one is added. */
export const record = internalMutation({ args: { siteId: v.id("sites"), opportunities: v.array(v.object({ domain: v.string(), rank: v.number(),
  linksTo: v.array(v.string()) })) }, handler: async (ctx, { siteId, opportunities }) => {
  const site = await ctx.db.get(siteId);
  if (!site || site.deletionStatus || !site.linkOutreach) return { added: 0 };
  const now = Date.now();
  let added = 0;
  for (const o of opportunities.slice(0, 100)) {
    const existing = await ctx.db.query("link_opportunities").withIndex("by_site_domain", (q) => q.eq("siteId", siteId).eq("domain", o.domain)).first();
    if (existing) { await ctx.db.patch(existing._id, { rank: o.rank, linksTo: o.linksTo.slice(0, 5), seenAt: now }); continue; }
    await ctx.db.insert("link_opportunities", { siteId, domain: o.domain.slice(0, 200), rank: o.rank, linksTo: o.linksTo.slice(0, 5), status: "new", foundAt: now, seenAt: now });
    added++;
  }
  return { added };
} });

/** The owner's list: the sites still worth an approach, strongest first. */
export const listForSite = query({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site || site.userId !== identity.subject || !site.linkOutreach) return [];
  return (await ctx.db.query("link_opportunities").withIndex("by_site_domain", (q) => q.eq("siteId", siteId)).take(500))
    .filter((o) => o.status === "new").sort((a, b) => b.rank - a.rank).slice(0, 20)
    .map((o) => ({ domain: o.domain, rank: o.rank, linksTo: o.linksTo, foundAt: o.foundAt }));
} });
