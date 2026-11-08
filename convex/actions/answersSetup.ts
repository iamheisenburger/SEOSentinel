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

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000, fetch });
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export const readSite = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const site = await ctx.runQuery(internal.answers.setupSite, { siteId });
  if (!site) return;
  let page = await fetchPage(`https://${site.domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  if ((page.status === 0 || page.status >= 400) && !site.domain.startsWith("www.")) page = await fetchPage(`https://www.${site.domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  if (page.status === 0 || page.status >= 400) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, error: `Pentra couldn't open ${site.domain} over HTTPS. Check the address, or fill in the details yourself.` });
    return;
  }
  if (botWall(page.html)) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, error: `${site.domain} showed Pentra a security check instead of its homepage. Fill in the details yourself.` });
    return;
  }
  const prefill = extractBusinessPrefill(page.html, site.domain) as { name?: string; questions?: string[] };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(page.html)?.[1]?.trim() ?? "";
  const headings = [...page.html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => visibleText(m[1])).filter((h) => h.length > 2).slice(0, 25);
  const text = visibleText(page.html);
  if (!process.env.ANTHROPIC_API_KEY) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
    return;
  }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "read", microUsd: SETUP_READ_HOLD_MICRO_USD });
  if (!hold.ok) {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
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
    await ctx.runMutation(internal.answers.saveSetupRead, read ? { siteId, read }
      : { siteId, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [], country: "", local: false, location: "", competitors: [] } });
  } catch {
    await ctx.runMutation(internal.answers.saveSetupRead, { siteId, read: { name: prefill.name || site.domain, sells: description || title, buyers: "", offerings: [],
      country: "", local: false, location: "", competitors: [] } });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });
