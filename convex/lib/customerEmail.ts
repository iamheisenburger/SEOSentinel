/**
 * Transactional email to a person who asked for it (P123, Oct 20 2026): from
 * hello@pentra.dev through Resend (pentra.dev is verified there), replies to
 * the support inbox. Only ever sent on request; never a marketing sequence.
 * Never throws: a failed send is reported to the caller, not raised.
 */
type Env = Record<string, string | undefined>;

export const CUSTOMER_EMAIL_FROM = "Pentra <hello@pentra.dev>";
export const CUSTOMER_EMAIL_REPLY_TO = "pentrahelp@gmail.com";

/** A deliverable-looking address, lowercased, or null. */
export function plausibleEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email) ? email : null;
}

export async function sendCustomerEmail(message: { to: string; subject: string; text: string }, env: Env = process.env): Promise<{ sent: boolean; error?: string }> {
  const key = env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.PENTRA_CUSTOMER_EMAIL_FROM || CUSTOMER_EMAIL_FROM, to: [message.to], reply_to: CUSTOMER_EMAIL_REPLY_TO,
        subject: message.subject.slice(0, 200), text: message.text.slice(0, 20_000) }),
    });
    return response.ok ? { sent: true } : { sent: false, error: `resend_http_${response.status}` };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" };
  }
}
