"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { extractBusinessPrefill, normalizePrefillHost } from "../lib/sitePrefill";

/** Suggest setup facts from the customer's own homepage. Signed-in owners
 * only; one bounded public fetch; no model call and no charge. */
export const prefill = action({ args: { domain: v.string() }, handler: async (ctx, { domain }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first.");
  if (!(await ctx.runMutation(internal.sitePrefill.claim, { userId: identity.subject }))) {
    throw new ConvexError("You've used this a lot in the last hour. Fill in the details yourself, or try again later.");
  }
  const host = normalizePrefillHost(domain);
  if (!host) throw new ConvexError("Enter your website address, like yourbusiness.com.");
  let page = await fetchPage(`https://${host}/`);
  if ((page.status === 0 || page.status >= 400) && !host.startsWith("www.")) page = await fetchPage(`https://www.${host}/`);
  if (page.status === 0 || page.status >= 400) {
    throw new ConvexError("Pentra couldn't open that website over HTTPS. Check the address, or fill in the details yourself.");
  }
  return { host, ...extractBusinessPrefill(page.html, new URL(page.finalUrl).hostname || host) };
} });
