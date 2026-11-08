"use node";
/** Pentra Answers (Nov 2026): reading a new site's homepage for the owner to confirm (one bounded fetch, one small model
 * call). A site Pentra can't open or read says so plainly; the owner can still fill the details in. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { extractBusinessPrefill } from "../lib/sitePrefill";
import { botWall, FREE_CHECK_HOME_MAX_BYTES } from "../lib/missedSearches";
import { parseSetupRead, SETUP_READ_HOLD_MICRO_USD, SETUP_READ_MAX_TOKENS, SETUP_READ_MODEL, SETUP_READ_TOOL, setupReadCost, setupReadRequest } from "../lib/answersSetup";
import { structuredToolChoice } from "../lib/toolChoice";
import { fetchPublicTextRendered } from "../lib/tregFetch";
import { challengePage, profileLinks, siteLinks } from "../lib/siteLinks";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000, fetch });
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export const readSite = internalAction({ args: { siteId: v.id("sites"), force: v.optional(v.boolean()), then: v.optional(v.literal("snapshot")),
  competitorsOnly: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, force, then, competitorsOnly }) => {
  const site = await ctx.runQuery(internal.answers.setupSite, { siteId });
  if (!site) return;
  let page = await fetchPage(`https://${site.domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  if ((page.status === 0 || page.status >= 400) && !site.domain.startsWith("www.")) page = await fetchPage(`https://www.${site.domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  // Nov 8 2026 (Cowork's test): a host can answer Pentra's servers with a hidden bot check (SiteGround's sgcaptcha) while
  // visitors see the full site, so a thin or blocked homepage is read again through a real browser (treg's renderer).
  const blocked = page.status === 0 || page.status >= 400 || botWall(page.html) || challengePage(page.html);
  const html = blocked ? "" : page.html;
  let homeText = html ? visibleText(html) : "";
  if (homeText.length < 600) {
    const rendered = await fetchPublicTextRendered(`https://${site.domain}/`, 600).catch(() => null);
    if (rendered && rendered.text.length > homeText.length) homeText = rendered.text.replace(/\s+/g, " ").trim();
  }
  if (homeText.length < 120) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, error: page.status === 0 || page.status >= 400
      ? `Pentra couldn't open ${site.domain} over HTTPS. Check the address, or fill in the details yourself.`
      : `${site.domain} showed Pentra a security check instead of its homepage. Fill in the details yourself.` });
    return;
  }
  // The pages that say what the business does (services, about, pricing), read too: a homepage alone is often a slogan.
  const links = html ? profileLinks(siteLinks(html, site.domain), 3)
    : ["/services", "/about"].map((path) => ({ url: `https://${site.domain}${path}`, text: path }));
  const more = await Promise.all(links.map((link) => fetchPublicTextRendered(link.url, 300)
    .then((p) => p.text.length >= 200 ? `Page ${new URL(link.url).pathname}:\n${p.text.replace(/\s+/g, " ").trim().slice(0, 3500)}` : "").catch(() => "")));
  const prefill = extractBusinessPrefill(html, site.domain) as { name?: string; questions?: string[] };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ?? "";
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => visibleText(m[1])).filter((h) => h.length > 2).slice(0, 25);
  const text = [`Homepage:\n${homeText.slice(0, 7000)}`, ...more.filter(Boolean)].join("\n\n");
  if (!process.env.ANTHROPIC_API_KEY) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
    return;
  }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "read", microUsd: SETUP_READ_HOLD_MICRO_USD });
  if (!hold.ok) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
    return;
  }
  let cost = 0, sent = false;
  try {
    const request = setupReadRequest({ domain: site.domain, title, description, headings, text, nameHint: prefill.name ?? "" });
    sent = true;
    const response = await anthropic().messages.create({ model: SETUP_READ_MODEL, max_tokens: SETUP_READ_MAX_TOKENS, system: request.system,
      messages: [{ role: "user", content: request.userMessage }],
      tools: [{ name: SETUP_READ_TOOL, description: "Record what the business is.", input_schema: request.inputSchema }],
      tool_choice: structuredToolChoice(SETUP_READ_MODEL, SETUP_READ_TOOL) });
    cost = setupReadCost(response.usage);
    const tool = response.content.find((b) => b.type === "tool_use" && b.name === SETUP_READ_TOOL);
    const read = parseSetupRead(tool && tool.type === "tool_use" ? tool.input : null, site.domain);
    await ctx.runMutation(internal.answers.saveSetupRead, read ? { siteId, force, then, competitorsOnly, read }
      : { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [], country: "", local: false, location: "", competitors: [] } });
  } catch {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });

/** Competitors the owner entered as a bare domain get the name their own site uses (og:site_name, else the title's first
 * part), so answers are matched by the name assistants actually write ("Riverview Dental", not "Boiseriverviewdental"). */
export const nameCompetitors = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const competitors = await ctx.runQuery(internal.answers.competitorsToName, { siteId });
  for (const c of competitors) {
    const page = await fetchPage(`https://${c.domain}/`, { maxBytes: 2_000_000 }).catch(() => null);
    const html = page?.html ?? "";
    const raw = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,80})["']/i.exec(html)?.[1]
      ?? /<title[^>]*>([^<]{2,200})<\/title>/i.exec(html)?.[1]?.split(/\s[|–—-]\s|:\s/)[0];
    const name = raw?.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
    if (name && name.length >= 2 && name.length <= 60 && !/^(home|welcome|index)$/i.test(name)) {
      await ctx.runMutation(internal.answers.renameCompetitor, { siteId, domain: c.domain, name });
    }
  }
} });
