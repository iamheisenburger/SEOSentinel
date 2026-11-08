/**
 * Domain entry for the free snapshot. Pure functions, shared by the hero field (client) and /start (server).
 * The field strips a pasted protocol right away and validates only on submit, never per keystroke.
 */

/** What the field keeps when someone pastes a full URL: the host, without protocol, path or query. */
export function stripPastedUrl(raw: string): string {
  const text = raw.trim();
  const withoutProtocol = text.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
  if (withoutProtocol === text && !/^www\./i.test(text) && !/[/?#]/.test(text)) return text;
  return withoutProtocol.replace(/^[^@/?#]*@/, "").split(/[/?#]/, 1)[0] ?? "";
}

const LABEL = /^(?!-)[a-z\d-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$/;

/**
 * The registrable host a person typed, lowercased, without protocol, credentials, port, path, a trailing dot
 * or "www.", or null when it isn't a public website address (no dot, an IP address, localhost, bad labels).
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  let host: string;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (host.length < 4 || host.length > 253) return null;
  if (host === "localhost" || /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;
  if (!TLD.test(labels[labels.length - 1]!)) return null;
  return host;
}

/** Where a checked domain goes next. */
export function startHref(domain: string): string {
  return `/start?domain=${encodeURIComponent(domain)}`;
}

export const DOMAIN_ERROR = "Enter your website address, like yourbusiness.com.";
