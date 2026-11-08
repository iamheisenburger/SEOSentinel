/**
 * A new account's site, created with the owner's email so the first hour's "ready" email reaches them
 * (api.answers.createSite({ domain, email? })). Pure, so the fallback is tested without a backend.
 */
import { ConvexError } from "convex/values";

export async function createSiteWithEmail<T>(
  call: (args: { domain: string; email?: string }) => Promise<T>,
  domain: string,
  email?: string | null,
): Promise<T> {
  const address = email?.trim();
  if (!address) return call({ domain });
  try {
    return await call({ domain, email: address });
  } catch (error) {
    // A sentence meant for the owner (one site per account, a bad address) stands. Anything else, such as a backend that
    // doesn't take the email yet, is retried without it: the site matters more than the email.
    if (error instanceof ConvexError) throw error;
    return call({ domain });
  }
}
