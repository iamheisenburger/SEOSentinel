/** Redirects in a site's vercel.json (Nov 2026): how Pentra delivers a merge to a site that renders its own pages from a
 * GitHub repository on Vercel. Vercel applies them before the site's own code, so the old address redirects whatever
 * framework the site uses. Pentra writes only the entries for addresses it merged: it adds them, and re-points one when
 * the page it pointed to is merged again (never a chain). Every other entry and setting stays exactly as written. A file
 * Pentra can't edit safely (not JSON, legacy "routes", redirects that aren't a list) is never touched. */

export type RedirectEntry = { source: string; destination: string };
export type VercelRedirectsEdit =
  | { ok: true; changed: false; skipped: string[] }
  | { ok: true; changed: true; text: string; skipped: string[] }
  | { ok: false; reason: string };

/** A plain path: no path-to-regexp tokens (":", "(", "*", "+", "?"), so the entry matches exactly the one address. */
const PLAIN_PATH = /^\/[A-Za-z0-9._~\-/%]*$/;
/** Vercel's limit on redirects in one file. */
export const VERCEL_MAX_REDIRECTS = 2048;

export function editVercelRedirects(current: string | null, entries: readonly RedirectEntry[]): VercelRedirectsEdit {
  let config: Record<string, unknown> = {};
  if (current !== null && current.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(current); } catch { return { ok: false, reason: "vercel.json isn't valid JSON" }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "vercel.json isn't a JSON object" };
    config = parsed as Record<string, unknown>;
  }
  if ("routes" in config) return { ok: false, reason: "vercel.json uses routes, which Vercel doesn't allow beside redirects" };
  if (config.redirects !== undefined && !Array.isArray(config.redirects)) return { ok: false, reason: "vercel.json redirects isn't a list" };
  const redirects: unknown[] = [...((config.redirects as unknown[] | undefined) ?? [])];
  const skipped: string[] = [];
  let changed = false;
  for (const { source, destination } of entries) {
    if (!PLAIN_PATH.test(source) || !PLAIN_PATH.test(destination) || source === destination) { skipped.push(source); continue; }
    const entry = { source, destination, permanent: true };
    const at = redirects.findIndex((r) => Boolean(r) && typeof r === "object" && (r as { source?: unknown }).source === source);
    if (at >= 0) {
      const existing = redirects[at] as Record<string, unknown>;
      const same = existing.destination === destination && existing.permanent === true && Object.keys(existing).length === 3;
      if (!same) { redirects[at] = entry; changed = true; }
      continue;
    }
    if (redirects.length >= VERCEL_MAX_REDIRECTS) { skipped.push(source); continue; }
    redirects.push(entry);
    changed = true;
  }
  if (!changed) return { ok: true, changed: false, skipped };
  return { ok: true, changed: true, text: `${JSON.stringify({ ...config, redirects }, null, 2)}\n`, skipped };
}
