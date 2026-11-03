"use node";
/** v3.1 (Nov 3 2026, ops/TREG-FOR-PENTRA.md): treg.web.extract renders JavaScript pages ($0.00015 a call) as the FALLBACK
 * when the direct pinned fetch fails or returns too little text — batch 7's brief could read 1 of 8 result pages (Google's
 * goto wrappers and JS-rendered listicles), so a list's seed options were whatever research happened to keep. A treg
 * failure or a missing token never blocks: the caller sees what the direct fetch saw (or nothing, as before). */
import { safeFetchPublicText } from "./safeOutbound.ts";

export function tregExtractedText(payload: unknown): string {
  const dig = (value: unknown, depth = 0): string => {
    if (depth > 3 || value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return "";
    if (Array.isArray(value)) return value.map((v) => dig(v, depth + 1)).join("\n");
    const obj = value as Record<string, unknown>;
    for (const key of ["content", "text", "markdown", "extracted_content", "cleaned_content", "data", "result", "items"]) {
      if (key in obj) { const got = dig(obj[key], depth + 1); if (got.length > 200) return got; }
    }
    return "";
  };
  return dig(payload);
}

export async function fetchPublicTextRendered(url: string, minChars = 600): Promise<{ url: string; text: string }> {
  let direct: { url: string; text: string } | null = null;
  try {
    direct = await safeFetchPublicText(url, { sameHostRedirects: true });
    if (direct.text.length >= minChars) return direct;
  } catch { /* the rendered fallback below is the point */ }
  const token = process.env.TREG_TOKEN;
  if (!token) return direct ?? { url, text: "" };
  try {
    const response = await fetch("https://treg.to/call/treg.web.extract", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Treg-Token": token },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(45_000) });
    const text = response.ok ? tregExtractedText(await response.json()) : "";
    if (text.length >= minChars) return { url, text };
  } catch { /* never blocks */ }
  return direct ?? { url, text: "" };
}
