/** Pentra Answers (Nov 2026): reading a new site for the owner to confirm. One small model call turns the homepage into
 * what the business sells, who buys it, its market and its likely competitors; the owner corrects any of it before Pentra
 * asks a single assistant (wrong competitors would poison every count). Pure. */
import { hostOf } from "./answerEngine.ts";
import { countryCode } from "./aiAnswers.ts";
import { forcedToolChoiceSupported, toolOnlyInstruction } from "./toolChoice.ts";

/** Sonnet 5.5 (Nov 8 2026; Haiku left dawnlist with no competitors): the read sets the competitors every count uses.
 * Thinking is on (effort high) and counts toward max_tokens: at most ~9K tokens in and 12K out ($0.14). */
export const SETUP_READ_MODEL = "claude-sonnet-5-5";
export const SETUP_READ_TOOL = "submit_business_read";
export const SETUP_READ_MAX_TOKENS = 12_000;
export const SETUP_READ_HOLD_MICRO_USD = 150_000;
export const SETUP_READ_PRICE = { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
export const setupReadCost = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * SETUP_READ_PRICE.inputUsdPerMillion + Math.max(0, usage?.output_tokens ?? 0) * SETUP_READ_PRICE.outputUsdPerMillion);

/** A domain as a new site stores it: a bare host, or null when it isn't one. */
export function normalizeNewDomain(raw: string): string | null {
  const host = hostOf(raw);
  if (!host || host.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
  if (/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
  return host;
}

export function setupReadRequest(args: { domain: string; title: string; description: string; headings: readonly string[]; text: string; nameHint: string }) {
  const system = [
    "You read a business's homepage and describe it plainly for its owner to confirm.",
    "Rules: use only what the page shows, except competitors. `sells`: one or two plain sentences on what it offers and the outcome for the customer. `buyers`: who pays for it. `offerings`: up to 8 short phrases.",
    "`country`: the two-letter code of the market it serves if the page makes it clear, else empty. `local`: true only if it serves one city or region in person; then `location` names it.",
    "`competitors`: up to 5 real companies a buyer would compare it with, that you are confident exist, each with its real website domain. Leave the list empty rather than guess.",
    ...(forcedToolChoiceSupported(SETUP_READ_MODEL) ? [] : [toolOnlyInstruction(SETUP_READ_TOOL)]),
  ].join("\n");
  const userMessage = [
    `Domain: ${args.domain}`, args.nameHint ? `Name on the page: ${args.nameHint}` : "", args.title ? `Title: ${args.title}` : "",
    args.description ? `Description: ${args.description}` : "", args.headings.length ? `Headings: ${args.headings.slice(0, 25).join(" | ")}` : "",
    `Page text:\n${args.text.slice(0, 7000)}`,
  ].filter(Boolean).join("\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["name", "sells", "buyers", "offerings", "country", "local", "location", "competitors"],
    properties: {
      name: { type: "string" as const }, sells: { type: "string" as const }, buyers: { type: "string" as const },
      offerings: { type: "array" as const, items: { type: "string" as const } }, country: { type: "string" as const }, local: { type: "boolean" as const },
      location: { type: "string" as const },
      competitors: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["name", "domain"],
        properties: { name: { type: "string" as const }, domain: { type: "string" as const } } } },
    },
  };
  return { system, userMessage, inputSchema };
}

export type SetupRead = { name: string; sells: string; buyers: string; offerings: string[]; country: string; local: boolean; location: string;
  competitors: Array<{ name: string; domain: string }> };

export function parseSetupRead(raw: unknown, domain: string): SetupRead | null {
  const r = raw as Partial<Record<keyof SetupRead, unknown>> | null;
  if (!r || typeof r.sells !== "string" || !r.sells.trim()) return null;
  const own = hostOf(domain);
  const competitors = (Array.isArray(r.competitors) ? r.competitors : []).flatMap((c) => {
    const item = c as { name?: unknown; domain?: unknown };
    if (typeof item.name !== "string" || typeof item.domain !== "string") return [];
    const host = normalizeNewDomain(item.domain);
    if (!host || host === own || host.endsWith(`.${own}`) || item.name.trim().length < 2) return [];
    return [{ name: item.name.trim().slice(0, 60), domain: host }];
  }).slice(0, 5);
  const country = typeof r.country === "string" && /^[A-Za-z]{2}$/.test(r.country.trim()) ? countryCode(r.country.trim()) : "";
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : own,
    sells: r.sells.trim().slice(0, 500), buyers: typeof r.buyers === "string" ? r.buyers.trim().slice(0, 300) : "",
    offerings: (Array.isArray(r.offerings) ? r.offerings : []).filter((o): o is string => typeof o === "string" && o.trim().length > 1).map((o) => o.trim().slice(0, 120)).slice(0, 8),
    country, local: r.local === true, location: typeof r.location === "string" ? r.location.trim().slice(0, 80) : "", competitors,
  };
}
