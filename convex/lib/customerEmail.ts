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

const WEEK_MS = 7 * 86_400_000;
/** A date in the site's own time zone (UTC when it has none or an invalid one). */
function siteDate(at: number, timeZone: string | undefined): string {
  const format = (zone: string) => new Date(at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone });
  try { return format(timeZone || "UTC"); } catch { return format("UTC"); }
}

const settingsFooter = (domain: string) =>
  `You get this email because Pentra publishes for ${domain}. You can turn these emails off in Settings: https://pentra.dev/settings`;

/** D4: the email a site's owner gets when Pentra's first article on the site is live. */
export function firstArticleEmail(input: { domain: string; title: string; url: string; nextAt: number | null; intervalMs: number | null;
  timeZone?: string; searchConsole: boolean }): { subject: string; text: string } {
  const perWeek = input.intervalMs && input.intervalMs > 0 ? Math.max(1, Math.round(WEEK_MS / input.intervalMs)) : null;
  const lines = [
    `Pentra just published your first article on ${input.domain}:`,
    "",
    `"${input.title}"`,
    input.url,
    "",
    "It was written from the business facts you confirmed, checked against its sources, and confirmed live on your site.",
    "",
    "What happens next:",
    input.nextAt ? `- Pentra publishes your next article around ${siteDate(input.nextAt, input.timeZone)}, then keeps to your schedule${perWeek ? ` (about ${perWeek} a week)` : ""}.`
      : "- Pentra keeps publishing on your schedule.",
    "- New articles usually take a few weeks to start showing in Google.",
    input.searchConsole
      ? "- Your Google Search Console is connected, so Pentra can see which searches show your pages and improve the ones closest to page one."
      : "- Connect Google Search Console in your dashboard so Pentra can see which searches show your pages and improve the ones closest to page one.",
    "",
    "Your dashboard: https://pentra.dev/dashboard",
    "",
    "Pentra",
    "",
    settingsFooter(input.domain),
  ];
  return { subject: `Your first article is live on ${input.domain}`, text: lines.join("\n") };
}
