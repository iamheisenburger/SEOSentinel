"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { extractBusinessPrefill, normalizePrefillHost } from "../lib/sitePrefill";
import { brandTerms, FREE_CHECK_HOME_MAX_BYTES } from "../lib/missedSearches";
import { proposeSeeds } from "./freeCheck";

/** Suggest setup facts from the customer's own homepage. Signed-in owners
 * only (12 an hour); one bounded public fetch and one small model read of the
 * homepage (the free check's, about $0.0005) for what the business sells and
 * who buys it. Headings alone made "What your product or service does" read
 * "Compost Notes. Includes: About home composting; Who these notes are for."
 * in the first outside new-user run (Oct 21 2026), and that field steers every
 * article. The page's own words stand when the read fails. */
export const prefill = action({ args: { domain: v.string() }, handler: async (ctx, { domain }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first.");
  if (!(await ctx.runMutation(internal.sitePrefill.claim, { userId: identity.subject }))) {
    throw new ConvexError("You've used this a lot in the last hour. Fill in the details yourself, or try again later.");
  }
  const host = normalizePrefillHost(domain);
  if (!host) throw new ConvexError("Enter your website address, like yourbusiness.com.");
  let page = await fetchPage(`https://${host}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  if ((page.status === 0 || page.status >= 400) && !host.startsWith("www.")) page = await fetchPage(`https://www.${host}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
  if (page.status === 0 || page.status >= 400) {
    throw new ConvexError("Pentra couldn't open that website over HTTPS. Check the address, or fill in the details yourself.");
  }
  const found = extractBusinessPrefill(page.html, new URL(page.finalUrl).hostname || host);
  try {
    const { read } = await proposeSeeds(host.replace(/^www\./, ""), page.html, found.questions, brandTerms(host.replace(/^www\./, ""), found.name), []);
    if (read) return { host, ...found, product: read.sells, audience: read.customers || found.audience };
  } catch { /* the homepage's own words stand */ }
  return { host, ...found };
} });
