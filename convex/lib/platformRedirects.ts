/** Redirects on every platform Pentra publishes to (Nov 2026): when Pentra merges a duplicate article into the stronger
 * one, the old address must lead to the kept article wherever the site's pages are served. Delivery is in
 * convex/actions/siteDiagnosis.ts; this file holds the pure parts, each through the connection Pentra already has:
 *   - GitHub sites: Pentra's entries in the file the site's host reads (vercel.json in convex/lib/vercelRedirects.ts;
 *     netlify.toml, forced so it wins over the old article's page; a _redirects file for Cloudflare Pages);
 *   - webhook sites: a signed "pentra.redirect.create.v1" event, signed like every article the endpoint receives;
 *   - WordPress (Pentra's connector 1.3.0), Shopify, Webflow Enterprise: a real permanent redirect through their APIs;
 *   - Ghost (an integration key can't add server redirects): the old post forwards on load with an instant refresh and
 *     names the kept article as its canonical page, which Google treats as a permanent redirect.
 * Every delivery is then checked by loading the old address. */

import type { RedirectEntry } from "./vercelRedirects";
export type { RedirectEntry } from "./vercelRedirects";

/** A plain path: no wildcards or placeholders, so an entry matches exactly the one address. */
const PLAIN_PATH = /^\/[A-Za-z0-9._~\-/%]*$/;
const NETLIFY_MARK = "# Pentra: permanent redirect for a merged duplicate article";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (path: string) => path.replace(/\/+$/, "") || "/";

export type FileEdit = { changed: boolean; text: string; skipped: string[] };

/** The WordPress connector's form of a path (connectors/wordpress, key()): decoded, lowercase, no trailing slash. */
export const wordpressRedirectKey = (path: string) => `/${decodeURIComponent(path).replace(/^\/+|\/+$/g, "")}`.toLowerCase();

/** Pentra's entries in a netlify.toml: added after everything else, or re-pointed where Pentra wrote them before (its
 * blocks carry a marker line). The owner's own settings and redirects stay exactly as written. A source the owner already
 * redirects is left to the owner's rule. */
export function editNetlifyToml(current: string | null, entries: readonly RedirectEntry[]): FileEdit {
  let text = current ?? "";
  const skipped: string[] = [];
  let changed = false;
  for (const { source, destination } of entries) {
    if (!PLAIN_PATH.test(source) || !PLAIN_PATH.test(destination) || source === destination) { skipped.push(source); continue; }
    const block = `${NETLIFY_MARK}\n[[redirects]]\n  from = "${source}"\n  to = "${destination}"\n  status = 301\n  force = true\n`;
    const ours = new RegExp(`${escape(NETLIFY_MARK)}\\n\\[\\[redirects\\]\\]\\n  from = "${escape(source)}"\\n  to = "([^"\\n]*)"\\n  status = 301\\n  force = true\\n`);
    const mine = ours.exec(text);
    if (mine) {
      if (mine[1] !== destination) { text = text.replace(mine[0], block); changed = true; }
      continue;
    }
    if (new RegExp(`from\\s*=\\s*["']${escape(bare(source))}/?["']`).test(text)) { skipped.push(source); continue; }
    text = `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}${block}`;
    changed = true;
  }
  return { changed, text, skipped };
}

const REDIRECTS_MARK = "# Pentra: merged duplicate article";

/** Pentra's lines in a _redirects file (Cloudflare Pages reads it from the site's static folder; its rules apply even
 * where a page exists). Each of Pentra's lines follows a marker comment, so it is re-pointed in place; a source the owner
 * already redirects is left to the owner's line; everything else stays as written. */
export function editRedirectsFile(current: string | null, entries: readonly RedirectEntry[]): FileEdit {
  const lines = (current ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const skipped: string[] = [];
  let changed = false;
  for (const { source, destination } of entries) {
    if (!PLAIN_PATH.test(source) || !PLAIN_PATH.test(destination) || source === destination) { skipped.push(source); continue; }
    const line = `${source} ${destination} 301`;
    const at = lines.findIndex((l, i) => i > 0 && lines[i - 1] === REDIRECTS_MARK && l.trim().split(/\s+/)[0] === source);
    if (at >= 0) {
      if (lines[at] !== line) { lines[at] = line; changed = true; }
      continue;
    }
    if (lines.some((l) => !l.trim().startsWith("#") && bare(l.trim().split(/\s+/)[0] ?? "") === bare(source))) { skipped.push(source); continue; }
    lines.push(REDIRECTS_MARK, line);
    changed = true;
  }
  return { changed, text: lines.length ? `${lines.join("\n")}\n` : "", skipped };
}

/** Who serves a page, from its response headers: where a repository's redirect file takes effect. */
export type ServingHost = "vercel" | "netlify" | "cloudflare" | "github_pages" | "other";
export function servingHost(headers: Record<string, string | string[] | undefined>): ServingHost {
  const header = (name: string) => { const value = headers[name]; return (Array.isArray(value) ? value.join(" ") : value ?? "").toLowerCase(); };
  const server = header("server");
  if (headers["x-vercel-id"] || /\bvercel\b/.test(server)) return "vercel";
  if (headers["x-nf-request-id"] || /\bnetlify\b/.test(server)) return "netlify";
  if (/^github\.com$/.test(server.trim())) return "github_pages";
  if (/\bcloudflare\b/.test(server) && headers["cf-ray"]) return "cloudflare";
  return "other";
}

/** The signed redirect event for a webhook site (same signature as its article deliveries: HMAC-SHA256 of
 * "<timestamp>.<body>" with the site's signing secret). */
export function webhookRedirectEvent(entries: readonly RedirectEntry[], siteHost: string, timestampSeconds: number,
  sign: (input: string) => string): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({ event: "pentra.redirect.create.v1", site: siteHost,
    redirects: entries.map((e) => ({ from: e.source, to: e.destination, permanent: true, status: 301 })) });
  const timestamp = String(timestampSeconds);
  return { body, headers: { "Content-Type": "application/json", "X-Pentra-Timestamp": timestamp,
    "X-Pentra-Signature-256": `sha256=${sign(`${timestamp}.${body}`)}` } };
}

const FORWARD_START = "<!-- Pentra: merged into a stronger article -->";
const FORWARD_END = "<!-- /Pentra -->";
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Ghost post's head code with Pentra's forward to the kept article: an instant refresh (Google treats it as a
 * permanent redirect) and the kept article as canonical page. The owner's own head code stays; a forward Pentra added
 * before is replaced, never doubled. */
export function forwardHead(current: string | null | undefined, targetUrl: string): string {
  const own = (current ?? "").replace(new RegExp(`${escape(FORWARD_START)}[\\s\\S]*?${escape(FORWARD_END)}\\n?`, "g"), "").trim();
  const block = `${FORWARD_START}\n<meta http-equiv="refresh" content="0; url=${attr(targetUrl)}">\n${FORWARD_END}`;
  return own ? `${block}\n${own}` : block;
}

/** Whether a page forwards to the target at once: an instant refresh to it, and it as canonical page. */
export function pageForwardsTo(html: string, targetUrl: string): boolean {
  const head = html.slice(0, 200_000);
  const target = (value: string) => {
    try { const url = new URL(value.replace(/&amp;/g, "&"), targetUrl); const want = new URL(targetUrl);
      return url.host.replace(/^www\./, "") === want.host.replace(/^www\./, "") && bare(url.pathname) === bare(want.pathname); } catch { return false; }
  };
  const refresh = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /http-equiv\s*=\s*["']?refresh/i.test(tag));
  const content = refresh?.match(/content\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  const refreshed = /^\s*0\s*[;,]\s*url\s*=\s*['"]?([^'"]+)['"]?\s*$/i.exec(content);
  const canonical = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /rel\s*=\s*["']?canonical/i.test(tag))
    ?.match(/href\s*=\s*(["'])(.*?)\1/i)?.[2];
  return Boolean(refreshed && target(refreshed[1]) && canonical && target(canonical));
}
