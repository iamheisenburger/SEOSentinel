"use node";
import { safeRequestPublicHttps } from "./safeOutbound.ts";
import { unified } from "unified";
import rehypeRaw from "rehype-raw";
import type { Root } from "hast";
import type { CorrectivePatch } from "./contentCorrection";

export async function verifyBrokenLinkEvidence(patch: CorrectivePatch) {
  if (patch.kind !== "technical_repair") return;
  if (!patch.brokenUrl || !patch.targetUrl) throw new Error("Missing corrective link evidence");
  const options = { expectedHost: new URL(patch.targetUrl).hostname, maxBytes: 250_000,
    allowedContentTypes: [/^text\/(?:html|plain)(?:;|$)/i], headers: { Accept: "text/html" } };
  const [broken, target] = await Promise.all([safeRequestPublicHttps(patch.brokenUrl, options), safeRequestPublicHttps(patch.targetUrl, options)]);
  if (![404, 410].includes(broken.status) || target.status !== 200) throw new Error("Correction requires a demonstrated missing link and a currently reachable verified destination");
}

/** Text equality alone cannot prove a repaired href. Inspect visible anchors,
 * never a hydration/script copy, alongside the existing full-body verifier. */
export function verifyCorrectedLink(html: string, patch: CorrectivePatch) {
  if (patch.kind !== "technical_repair") return;
  const expectedAnchor = /\[([^\]]+)\]\(/.exec(patch.before)?.[1];
  type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
  const tree = unified().use(rehypeRaw).runSync({ type: "root", children: [{ type: "raw", value: html }] } as unknown as Root) as Node;
  const links: Array<{ href: string; text: string }> = [];
  const visit = (node: Node): string => {
    const p = node.properties ?? {};
    if (["head", "script", "style", "noscript", "template", "svg"].includes(node.tagName ?? "") || p.hidden ||
      p.ariaHidden === true || p.ariaHidden === "true" || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(String(p.style ?? ""))) return "";
    if (node.type === "text") return node.value ?? "";
    const text = (node.children ?? []).map(visit).join("");
    if (node.tagName === "a") links.push({ href: String(p.href), text: text.replace(/\s+/g, " ").trim() });
    return text;
  };
  visit(tree);
  if (!links.some(a => a.href === patch.targetUrl && a.text === expectedAnchor) || links.some(a => a.href === patch.brokenUrl)) throw new Error("Live page does not expose the exact repaired internal link");
}
