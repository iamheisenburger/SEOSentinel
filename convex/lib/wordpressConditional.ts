import { safeRequestPublicHttps, validatePublicHttpsUrl } from "./safeOutbound";
import { contentConnectionHash } from "./contentSelection";
import type { Doc } from "../_generated/dataModel";

/** Entity-encode visible text, not markup. Browsers render the same reviewed
 * Unicode text, while WordPress typography/smilies cannot rewrite it later.
 * Numeric entities use WordPress KSES's canonical minimum-three-digit form. */
export function preserveWordPressReviewedText(html: string): string {
  return html.split(/(<[^>]*>)/g).map((part, index) => index % 2 ? part : part.split(/(&(?:#[0-9]+|#x[0-9a-f]+|[a-z]+);)/gi)
    .map((text, entity) => entity % 2 ? text.replace(/&#([0-9]+);/g, (_, n) => `&#${String(Number(n)).padStart(3, "0")};`)
      : Array.from(text).map(c => /\s/.test(c) ? c : `&#${String(c.codePointAt(0)).padStart(3, "0")};`).join("")).join("")).join("");
}

export async function wordpressConditionalRequest(site: Doc<"sites">, route: "connection" | "source" | "select" | "write" | "revoke", body?: Record<string, unknown>, read?: Record<string, string>) {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) throw new Error("WordPress connection is incomplete");
  const root = await validatePublicHttpsUrl(site.wpUrl), origin = root.href.replace(/\/+$/, "");
  const query = read ? "?" + new URLSearchParams({ site: origin, binding: contentConnectionHash(site), ...read }) : "";
  const payload = body ? JSON.stringify({ site: origin, binding: contentConnectionHash(site), ...body }) : undefined;
  const response = await safeRequestPublicHttps(`${origin}/wp-json/pentra/v1/${route}${query}`, {
    method: body ? "POST" : "GET", expectedHost: root.hostname,
    headers: { Authorization: `Basic ${Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64")}`,
      "Content-Type": "application/json" }, body: payload, allowedContentTypes: [/^application\/json(?:;|$)/i],
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`WordPress conditional ${route} rejected (${response.status}); reconcile source/permission before retry`);
  const result = JSON.parse(response.text);
  if (!result || typeof result !== "object") throw new Error("Invalid WordPress connector response");
  if (route === "connection" && (result.version !== 1 || result.atomic !== true || result.site !== origin || !Number.isSafeInteger(result.userId))) {
    throw new Error("Install and verify the supported Pentra conditional WordPress connector");
  }
  return result;
}
