import { ConvexError } from "convex/values";

/** Production Convex shows a plain thrown Error to the browser only as
 * "Server Error", so a new user saving setup or connecting a website never
 * saw why it failed ("the application password was rejected", "this domain
 * is already set up"). Steps a customer drives directly rethrow their reason
 * as a ConvexError; the client shows its text. A ConvexError passes through
 * unchanged. The text is bounded and never carries a stack. */
export function userFacingError(error: unknown, fallback: string): ConvexError<string> {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error as ConvexError<string> : new ConvexError(fallback);
  }
  const message = error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : "";
  return new ConvexError(message ? message.slice(0, 400) : fallback);
}

/** Run a customer-driven step so its failure reason reaches the customer. */
export async function withUserFacingErrors<T>(fallback: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw userFacingError(error, fallback);
  }
}
