"use node";
import { safeRequestPublicHttps, validatePublicHttpsUrl } from "./safeOutbound";
import { contentConnectionHash } from "./contentSelection";
export { preserveWordPressReviewedText } from "./contentSelection";
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "./publicationArtifact";
import { wordpressRedirectKey } from "./platformRedirects";
export { wordpressRedirectKey } from "./platformRedirects";

function writePayload(site: Doc<"sites">, origin: string, body: Record<string, unknown>) {
  return JSON.stringify({ site: origin, binding: contentConnectionHash(site), ...body });
}
/** Historical proof only. Absence/conflict never authorizes another write. */
export async function wordpressConditionalReceipt(site: Doc<"sites">, body: Record<string, unknown>) {
  const connection = await wordpressConditionalRequest(site, "connection");
  if (connection.receiptLookup !== 1) throw new Error("wordpress_receipt_update_required: Update the Pentra WordPress connector to 1.1.0 or newer before receipt recovery. Do not republish this work.");
  const root = await validatePublicHttpsUrl(site.wpUrl!), origin = root.href.replace(/\/+$/, "");
  const requestHash = sha256Hex(writePayload(site, origin, body));
  const result = await wordpressConditionalRequest(site, "receipt", undefined, { key: String(body.key), requestHash,
    ...(body.operation === "create" ? { type: String(body.type), slug: String(body.slug) } : { id: String(body.id) }) });
  if (result.key !== body.key || result.requestHash !== requestHash || result.binding !== contentConnectionHash(site) ||
    !Number.isSafeInteger(result.id) || result.id <= 0 || !/^[a-f0-9]{64}$/.test(result.revision) || !/^[a-f0-9]{64}$/.test(result.permission) ||
    typeof result.permissionActive !== "boolean" || result.content !== body.content ||
    (body.operation === "create" ? result.slug !== body.slug || result.type !== body.type || result.title !== body.title : result.id !== body.id || result.permission !== body.permission)) throw new Error("WordPress exact receipt mismatch; no replay is authorized");
  return result;
}


/** Nov 2026: permanent redirects for articles Pentra merged, through the connector's redirects route (1.3.0+): each
 * address is answered on its own (accepted, with the kept article's current address, or rejected: not Pentra's post, not
 * a published target). An older connector says so, and the owner is asked to update it; nothing changes on the site. */
export async function wordpressRedirects(site: Doc<"sites">, redirects: readonly { from: string; to: string }[]):
  Promise<{ ok: true; added: Map<string, string>; rejected: Set<string> } | { ok: false; reason: string }> {
  const connection = await wordpressConditionalRequest(site, "connection");
  if (connection.redirects !== 1) {
    return { ok: false, reason: "Pentra's WordPress plugin on this site is older than 1.3.0: update it (pentra.dev/pentra-wordpress-plugin.zip) so merged articles forward" };
  }
  const result = await wordpressConditionalRequest(site, "redirects", { redirects });
  const added = new Map<string, string>();
  for (const entry of Array.isArray(result.redirects) ? result.redirects : []) {
    if (entry && typeof entry.from === "string" && typeof entry.to === "string") added.set(entry.from, entry.to);
  }
  const rejected = new Set<string>((Array.isArray(result.rejected) ? result.rejected : []).filter((r: unknown): r is string => typeof r === "string")
    .map((r: string) => { try { return wordpressRedirectKey(r); } catch { return r; } }));
  return { ok: true, added, rejected };
}

export async function wordpressConditionalRequest(site: Doc<"sites">, route: "connection" | "source" | "receipt" | "select" | "write" | "revoke" | "redirects", body?: Record<string, unknown>, read?: Record<string, string>) {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) throw new Error("WordPress connection is incomplete");
  const root = await validatePublicHttpsUrl(site.wpUrl), origin = root.href.replace(/\/+$/, "");
  const query = read ? "?" + new URLSearchParams({ site: origin, binding: contentConnectionHash(site), ...read }) : "";
  const payload = body ? writePayload(site, origin, body) : undefined;
  const response = await safeRequestPublicHttps(`${origin}/wp-json/pentra/v1/${route}${query}`, {
    method: body ? "POST" : "GET", expectedHost: root.hostname,
    headers: { Authorization: `Basic ${Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64")}`,
      "Content-Type": "application/json" }, body: payload, allowedContentTypes: [/^application\/json(?:;|$)/i], ...(route === "receipt" ? { maxBytes: 1_500_000 } : {}),
  });
  if (route === "receipt" && response.status === 404 && JSON.parse(response.text)?.code === "rest_no_route") throw new Error("wordpress_receipt_update_required: Update the Pentra WordPress connector to 1.1.0 or newer; the receipt route is unavailable. Do not republish this work.");
  if (response.status < 200 || response.status >= 300) throw new Error(`WordPress conditional ${route} rejected (${response.status}); reconcile source/permission before retry`);
  const result = JSON.parse(response.text);
  if (!result || typeof result !== "object") throw new Error("Invalid WordPress connector response");
  if (route === "connection" && (result.version !== 1 || result.atomic !== true || result.site !== origin || !Number.isSafeInteger(result.userId))) {
    throw new Error("Install and verify the supported Pentra conditional WordPress connector");
  }
  if (route === "connection" && result.receiptLookup !== 1) throw new Error("wordpress_receipt_update_required: Update the Pentra WordPress connector to 1.1.0 or newer before publishing or recovering this delivery. Do not publish another copy.");
  return result;
}
