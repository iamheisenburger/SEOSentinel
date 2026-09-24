"use node";

import { action } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { extractBusinessPrefill, normalizePrefillHost } from "../lib/sitePrefill";

/** Suggest setup facts from the customer's own homepage. Signed-in owners
 * only; one bounded public fetch; no model call and no charge. */
export const prefill = action({ args: { domain: v.string() }, handler: async (ctx, { domain }) => {
  if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Sign in first.");
  const host = normalizePrefillHost(domain);
  if (!host) throw new ConvexError("Enter your website address, like yourbusiness.com.");
  let page = await fetchPage(`https://${host}/`);
  if ((page.status === 0 || page.status >= 400) && !host.startsWith("www.")) page = await fetchPage(`https://www.${host}/`);
  if (page.status === 0 || page.status >= 400) {
    throw new ConvexError("Pentra couldn't open that website over HTTPS. Check the address, or fill in the details yourself.");
  }
  return { host, ...extractBusinessPrefill(page.html) };
} });
