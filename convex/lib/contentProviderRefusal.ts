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
