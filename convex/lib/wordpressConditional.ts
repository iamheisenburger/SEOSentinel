"use node";
import { safeRequestPublicHttps, validatePublicHttpsUrl } from "./safeOutbound";
import { contentConnectionHash } from "./contentSelection";
export { preserveWordPressReviewedText } from "./contentSelection";
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "./publicationArtifact";

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

export async function wordpressConditionalRequest(site: Doc<"sites">, route: "connection" | "source" | "receipt" | "select" | "write" | "revoke", body?: Record<string, unknown>, read?: Record<string, string>) {
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
