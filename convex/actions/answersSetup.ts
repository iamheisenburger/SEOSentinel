"use node";
/** Pentra Answers (Nov 2026): reading a new site's homepage for the owner to confirm (one bounded fetch, one small model
 * call). A site Pentra can't open or read says so plainly; the owner can still fill the details in. */
import Anthropic from "@anthropic-ai/sdk";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { extractBusinessPrefill } from "../lib/sitePrefill";
import {
  normalizeNewDomain, parseSetupRead, SETUP_READ_HOLD_MICRO_USD, SETUP_READ_MAX_TOKENS, SETUP_READ_MODEL, SETUP_READ_TOOL, setupReadCost, setupReadRequest, sitePageNames,
} from "../lib/answersSetup";
import { structuredToolChoice } from "../lib/toolChoice";
import { competitorName, fetchReadable, mapsSearch, sitemapLinks } from "../lib/tregFetch";
import { keyLinks } from "../lib/siteLinks";
import { htmlToText, mergeLinks } from "../lib/pageText";
import { localCompetitors, LOOKUP_HOLD_MICRO_USD, mapsQuery, mergeCompetitors } from "../lib/localCompetitors";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000, fetch });
/** A missing page a renderer still returns ("Page not found"), never read as the business's words. */
const NOT_FOUND = /\b(?:page not found|404 error|error 404|nothing (?:was )?found|this page (?:doesn['’]t|does not) exist)\b/i;

export const readSite = internalAction({ args: { siteId: v.id("sites"), force: v.optional(v.boolean()), then: v.optional(v.literal("snapshot")),
  competitorsOnly: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, force, then, competitorsOnly }) => {
  const site = await ctx.runQuery(internal.answers.setupSite, { siteId });
  if (!site) return;
  // Nov 8-9 2026 (Cowork's tests): a host can answer Pentra's servers with a hidden bot check (SiteGround's sgcaptcha) while
  // visitors see the full site; fetchReadable reads such a page through treg's renderer (a US browser) and always returns
  // the page's words, never its raw HTML.
  let page = await fetchReadable(`https://${site.domain}/`, 600, site.domain);
  if (page.text.length < 120 && !site.domain.startsWith("www.")) {
    const www = await fetchReadable(`https://www.${site.domain}/`, 600, site.domain);
    if (www.text.length > page.text.length) page = www;
  }
  const homeText = page.text;
  if (homeText.length < 120) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, error: page.blocked
      ? `${site.domain} showed Pentra a security check instead of its homepage. Fill in the details yourself.`
      : `Pentra couldn't open ${site.domain} over HTTPS. Check the address, or fill in the details yourself.` });
    return;
  }
  // The pages that say what the business does (services, prices, about, questions), found from the homepage's links and
  // the sitemap (a dentist's service pages are often only in its menu and sitemap): a homepage alone is often a slogan.
  const allLinks = mergeLinks(page.links, await sitemapLinks(site.domain).catch(() => []));
  const found = keyLinks(allLinks, 4);
  // Nothing to follow (a blocked host's renderer copy without links, no readable sitemap): the usual addresses are tried.
  const links = found.length ? found : ["/services", "/about", "/pricing"].map((path) => ({ url: `https://${site.domain}${path}`, text: path }));
  const more = await Promise.all(links.map((link) => fetchReadable(link.url, 300, site.domain)
    .then((p) => p.text.length >= 200 && !NOT_FOUND.test(p.text.slice(0, 400)) ? `Page ${new URL(link.url).pathname}:\n${p.text.slice(0, 3500)}` : "").catch(() => "")));
  const html = page.html;
  const prefill = extractBusinessPrefill(html, site.domain) as { name?: string; questions?: string[] };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ?? "";
  const headings = html ? [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => htmlToText(m[1]).replace(/\s+/g, " ")).filter((h) => h.length > 2).slice(0, 25)
    : homeText.split("\n").filter((line) => line.length > 2 && line.length < 90).slice(0, 12);
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
    const request = setupReadRequest({ domain: site.domain, title, description, headings, text, nameHint: prefill.name ?? "", sitePages: sitePageNames(allLinks) });
    sent = true;
    const response = await anthropic().messages.create({ model: SETUP_READ_MODEL, max_tokens: SETUP_READ_MAX_TOKENS, system: request.system,
      messages: [{ role: "user", content: request.userMessage }],
      tools: [{ name: SETUP_READ_TOOL, description: "Record what the business is.", input_schema: request.inputSchema }],
      tool_choice: structuredToolChoice(SETUP_READ_MODEL, SETUP_READ_TOOL) });
    cost = setupReadCost(response.usage);
    const tool = response.content.find((b) => b.type === "tool_use" && b.name === SETUP_READ_TOOL);
    const parsed = parseSetupRead(tool && tool.type === "tool_use" ? tool.input : null, site.domain);
    // What the owner confirms (the Maps search term is used here only).
    let read = parsed ? { name: parsed.name, sells: parsed.sells, buyers: parsed.buyers, offerings: parsed.offerings, country: parsed.country, local: parsed.local,
      location: parsed.location, competitors: parsed.competitors } : null;
    // A local business's competitors are the businesses Google Maps lists for what its buyers search in its city (the
    // model's memory rarely knows one city's businesses, so a local snapshot often counted nobody named instead of it).
    const query = parsed?.local && parsed.searchTerm ? mapsQuery(parsed.searchTerm, parsed.location, parsed.country) : null;
    if (read && query) {
      const maps = await mapsSearch(query, parsed?.country || "us");
      cost += maps.costMicroUsd;
      const local = localCompetitors(maps.places, { name: read.name, domain: site.domain });
      if (local.length) read = { ...read, competitors: mergeCompetitors(local, read.competitors) };
    }
    await ctx.runMutation(internal.answers.saveSetupRead, read ? { siteId, force, then, competitorsOnly, read }
      : { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [], country: "", local: false, location: "", competitors: [] } });
  } catch {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, force, then, competitorsOnly, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });

/** Competitors saved with a run-together domain label as their name get the name their own site or Maps listing uses, so
 * answers are matched by the name assistants actually write. The setup screen looks names up as they're typed
 * (lookupCompetitor); this is the backstop for a list saved before a lookup came back. */
export const nameCompetitors = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const competitors = await ctx.runQuery(internal.answers.competitorsToName, { siteId });
  for (const c of competitors) {
    const found = await competitorName(c.domain);
    if (found.name) await ctx.runMutation(internal.answers.renameCompetitor, { siteId, domain: c.domain, name: found.name, verified: true });
  }
} });

/** The owner typed a competitor's address whose label runs several words together: its real name, from its homepage or
 * its Google Maps listing. The screens ask only for run-together labels (a short brand label is already the name answers
 * write). `null` when neither says. Held against the account's spend like every paid call (at most a Maps search, $0.005). */
export const lookupCompetitor = action({ args: { siteId: v.id("sites"), domain: v.string() }, handler: async (ctx, { siteId, domain }): Promise<{ name: string; domain: string } | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first.");
  const host = normalizeNewDomain(domain);
  if (!host) return null;
  if (!(await ctx.runQuery(internal.answers.ownsAnswersSite, { siteId, userId: identity.subject }))) throw new ConvexError("Site not found.");
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "lookup", microUsd: LOOKUP_HOLD_MICRO_USD });
  if (!hold.ok) return null;
  let cost = 0;
  try {
    const found = await competitorName(host);
    cost = found.costMicroUsd;
    return found.name ? { name: found.name, domain: host } : null;
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent: cost > 0 });
  }
} });
