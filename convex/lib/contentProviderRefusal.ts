/** Provider-generated evidence only. Never infer zero billing from rejection. */
export const validProviderRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^req_[a-zA-Z0-9]{8,128}$/.test(value);

export function isProviderCreditRefusal(status: unknown, type: unknown, message: unknown) {
  return status === 400 && type === "invalid_request_error" && typeof message === "string" &&
    /^Your credit balance is too low to access the Anthropic API\.(?:\s|$)/.test(message);
}

/** The old SDK error.message representation, retained by a finalized server
 * run. Only useful with the separate exact-job/single-call lineage checks. */
export function legacyCreditRefusal(detail: string | undefined) {
  if (!detail?.startsWith("400 ") || detail.length > 2048) return null;
  try {
    const body = JSON.parse(detail.slice(4));
    if (!body || typeof body !== "object" || Array.isArray(body) || body.type !== "error" ||
      Object.keys(body).some(k => !["type", "error", "request_id"].includes(k)) ||
      !body.error || typeof body.error !== "object" || Array.isArray(body.error) ||
      Object.keys(body.error).some(k => !["type", "message"].includes(k)) ||
      !isProviderCreditRefusal(400, body.error.type, body.error.message) || !validProviderRequestId(body.request_id)) return null;
    return { requestId: body.request_id as string };
  } catch { return null; }
}

/** The API refused the request itself before any model ran: the request was
 * malformed for that model (400), the key cannot use it (401/403), the model
 * does not exist (404) or the request is too large (413). Repeating the same
 * request gets the same answer, so it is a definitive refusal, not a lost
 * response. Oct 15 2026: Sonnet 5.5 refused forced tool_choice with a 400 and,
 * unrecorded, every such job ended "ambiguous" and froze the owner's slot. */
const REQUEST_REFUSALS: Record<number, string> = { 400: "invalid_request_error", 401: "authentication_error",
  403: "permission_error", 404: "not_found_error", 413: "request_too_large" };
export function isProviderRequestRefusal(status: unknown, type: unknown) {
  return typeof status === "number" && REQUEST_REFUSALS[status] === type;
}
