import { ConvexError } from "convex/values";

/** The reason a customer-driven step failed, in words the owner can act on.
 * Production Convex hides a plain server Error as "Server Error"; the server
 * sends actionable reasons as ConvexError text, shown here. Anything else
 * falls back to the caller's sentence instead of a raw technical message. */
export function userErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string" && error.data.trim()) return error.data;
  return fallback;
}
