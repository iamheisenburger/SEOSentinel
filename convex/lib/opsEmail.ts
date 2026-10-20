/**
 * Operator alerts by email (A5, Oct 19 2026). Off until the owner sets
 * RESEND_API_KEY and PENTRA_ALERT_EMAIL_TO in the Convex environment.
 * PENTRA_ALERT_EMAIL_FROM is optional: Resend's test sender reaches only the
 * Resend account's own address, a verified domain reaches anyone. Telegram
 * is reserved for the X reply system, so this is the only operator channel.
 * Never throws: a failed alert is reported to the caller, not raised.
 */
type Env = Record<string, string | undefined>;

export function opsEmailConfigured(env: Env = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && opsEmailRecipients(env).length > 0);
}

function opsEmailRecipients(env: Env): string[] {
  return (env.PENTRA_ALERT_EMAIL_TO ?? "").split(",").map((value) => value.trim()).filter((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

export async function sendOpsEmail(subject: string, text: string, env: Env = process.env): Promise<{ sent: boolean; error?: string }> {
  const key = env.RESEND_API_KEY, to = opsEmailRecipients(env);
  if (!key || to.length === 0) return { sent: false, error: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.PENTRA_ALERT_EMAIL_FROM || "Pentra alerts <onboarding@resend.dev>", to,
        subject: subject.slice(0, 200), text: text.slice(0, 20_000) }),
    });
    return response.ok ? { sent: true } : { sent: false, error: `resend_http_${response.status}` };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" };
  }
}

/** The same problems are emailed again only after a day; a new or cleared one
 * changes this fingerprint and is emailed at once. Hour counts are ignored so
 * "53h overdue" and "54h overdue" are the same problem. */
export function healthFingerprint(sites: ReadonlyArray<{ siteId: string; status: string; problems: string[] }>): string {
  return JSON.stringify(sites.filter((site) => site.status === "attention")
    // Topic supply is counted only in the daily check, so it is left out here:
    // otherwise every six-hourly watch would look like a change.
    .map((site) => [site.siteId, site.problems.filter((problem) => !/^(?:no topics left|topics run out)/.test(problem))
      .map((problem) => problem.replace(/\d+(?:\.\d+)?\s*(?:h|d|days?|hours?)\b/g, "#"))] as const)
    .filter(([, problems]) => problems.length > 0)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
