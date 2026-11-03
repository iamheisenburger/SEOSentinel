// Article assembly v3 (Nov 3 2026, ops/ARTICLE-ASSEMBLY-V3.md, Cowork's order): data first, the model writes only short prose.
// Plans v1 and v2 asked one call to write the whole article and cleaned up after it: a fact the writer didn't place became a
// gap, a fact it placed twice a repeat, a fact it put on the wrong company an error, and each deletion left a hole. Here
// research gives typed records; code checks each record against the exact excerpt it quotes; code renders every fact once
// (price tables, plan lists, cost and fee tables, FAQ answers) with its source and "as of" date; a section with no record
// gets no heading; one call writes only the intro, a lead-in per section, who each option suits and the conclusion; and code
// drops any of those sentences that states a number or names a company its section's records don't.
import { z } from "zod";
import { DEFLECTION, numberStated, statedNumbers } from "./articlePlanChecks.ts";
import { namedEntities } from "./backedFacts.ts";
import { firstPartyProductPage } from "./sourceQuality.ts";

/** The formats code assembles, first where batch 4 failed hardest: "best X" lists and local-service guides, then comparisons
 * and how-tos. */
export const ASSEMBLED_FORMATS = ["list", "guide", "comparison", "how-to"] as const;
/** PENTRA_ASSEMBLY_V3: "on" assembles every format above, or a comma list ("list,guide"); unset or "off" keeps the writer. */
export function assembledFormat(env: string | undefined, format: string): boolean {
  const value = (env ?? "").trim().toLowerCase();
  if (!value || value === "off" || !(ASSEMBLED_FORMATS as readonly string[]).includes(format)) return false;
  return value === "on" ? (ASSEMBLED_ON as readonly string[]).includes(format) : value.split(",").map((f) => f.trim()).includes(format);
}
/** What "on" assembles. A how-to only when named: research quotes snippets of a procedure, not its page in order, and batch 6
 * assembled a sprinkler blowout as three steps out of order; it waits for reads of the procedure page's own ordered list. */
export const ASSEMBLED_ON = ["list", "guide", "comparison"] as const;

export const FACT_KINDS = ["price", "cost", "fee", "rebate", "duration", "spec", "rule", "fact"] as const;
const MONEY = new Set<string>(["price", "cost", "fee", "rebate"]);

const quoted = { quote: z.string(), source: z.number().int() };
export const RecordsSchema = z.object({
  options: z.array(z.object({ name: z.string(), website: z.string().default(""),
    prices: z.array(z.object({ plan: z.string().default(""), price: z.string(), billing: z.string().default(""), ...quoted })).default([]),
    features: z.array(z.object({ text: z.string(), ...quoted })).default([]),
    limits: z.array(z.object({ text: z.string(), ...quoted })).default([]) })).default([]),
  facts: z.array(z.object({ section: z.string(), subject: z.string().default(""), kind: z.string(), label: z.string(), value: z.string(), ...quoted })).default([]),
  faqs: z.array(z.object({ question: z.string(), answer: z.string(), ...quoted })).default([]),
  steps: z.array(z.object({ section: z.string(), step: z.string(), ...quoted })).default([]),
});
export type Records = z.infer<typeof RecordsSchema>;
/** An option's entry: its prices, features and limits, plus the outline's facts about it (a trial length, a contract term). */
export type AssembledOption = Records["options"][number] & { business: boolean; extras: Records["facts"] };
export type VerifiedRecords = { options: AssembledOption[]; facts: Records["facts"]; faqs: Records["faqs"]; steps?: Records["steps"]; dropped: string[] };

const str = { type: "string" };
const withQuote = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false,
  properties: { ...properties, quote: str, source: { type: "integer" } }, required: [...Object.keys(properties), "quote", "source"] });
export const RECORDS_INPUT_SCHEMA: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false } = {
  type: "object", additionalProperties: false, required: ["options", "facts", "faqs", "steps"], properties: {
    options: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "website", "prices", "features", "limits"], properties: {
      name: str, website: str,
      prices: { type: "array", items: withQuote({ plan: str, price: str, billing: str }) },
      features: { type: "array", items: withQuote({ text: str }) },
      limits: { type: "array", items: withQuote({ text: str }) } } } },
    facts: { type: "array", items: withQuote({ section: str, subject: str, kind: { type: "string", enum: [...FACT_KINDS] }, label: str, value: str }) },
    faqs: { type: "array", items: withQuote({ question: str, answer: str }) },
    steps: { type: "array", items: withQuote({ section: str, step: str }) },
  },
};

export type AssemblySource = { url: string; title?: string; excerpt: string };

/** The two things a comparison search compares ("ceramic vs cast iron cookware": ceramic cookware, cast iron cookware). */
export function comparedSides(search: string): [string, string] | null {
  const match = /^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i.exec(search.trim());
  if (!match) return null;
  let a = match[1].trim();
  const b = match[2].trim(), aWords = a.toLowerCase().split(/\s+/), bWords = b.split(/\s+/), tail = bWords[bWords.length - 1];
  if (bWords.length > aWords.length && !aWords.includes(tail.toLowerCase())) a = `${a} ${tail}`;
  return [a, b];
}
const wordsOf = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
/** Which side a fact is about: 0, 1, or -1 (both, neither). A side is known by the words the other side doesn't share. */
export function sideOf(subject: string, sides: readonly [string, string]): number {
  const words = new Set(wordsOf(subject));
  const own = sides.map((side, i) => wordsOf(side).filter((w) => !wordsOf(sides[1 - i]).includes(w)));
  const hits = own.map((distinct) => distinct.length > 0 && distinct.every((w) => words.has(w)));
  return hits[0] === hits[1] ? -1 : hits[0] ? 0 : 1;
}
export type OutlineSection = { heading: string; covers?: string };

/** The one records call: every record quotes one excerpt word for word, so code can check it. */
export function recordsRequest(args: { search: string; format: string; sections: readonly OutlineSection[]; coverage: readonly string[];
  options: readonly string[]; questions: readonly string[]; productName: string; profile: string; competitors: readonly string[];
  sources: readonly AssemblySource[]; ownerPage: (url: string) => boolean; sides?: readonly [string, string] | null }): { system: string; userMessage: string } {
  const list = args.format === "list";
  const sides = args.format === "comparison" && args.sides ? args.sides : null;
  const system = [
    "You turn research excerpts into fact records for an article. The article prints its numbers, prices, names and answers exactly from your records, so each record is copied from one excerpt, never inferred.",
    "Every record has 'quote': one passage copied character for character from ONE excerpt (at most 250 characters, no ellipsis, never two passages joined), and 'source': that excerpt's number. The quote itself states the record: every number in the record appears in its quote, written the same way.",
    "Never compute, convert, round, combine or estimate a figure; never add a currency, unit or period the quote doesn't state; never use what you know. When no excerpt states something, make no record for it.",
    "An excerpt marked OWNER PAGE is the product's, program's or agency's own page: it states that owner's own prices, plans, fees, rules and features. Any other excerpt supports a fact about a product or program only when its quote names it.",
    list ? `'options': the products or services this search's readers would compare that the excerpts give facts for, at most 10, plus ${args.productName} from excerpt [0] only; never ${args.competitors.length ? args.competitors.join(", ") : "a competitor of the business"}. name: as its own site writes it. website: its own site's home page when an OWNER PAGE url gives it, else "". prices: each plan with its price exactly as the quote states it, currency included (plan "" when the quote names none; billing only the period or terms, such as "per month" or "billed annually"; a plan's limits go in limits), from its own pricing page when an excerpt gives one. features: up to 4 short things it does, in the quote's words. limits: up to 2 things it lacks or charges extra for. From any page that is not the option's own, quote the passage that names the option.`
      : "'options': [] (this article is not a list).",
    "'facts': for each outline section, the specifics its excerpts give a reader: cost and price ranges, fees, rebates and who pays them, durations, rules (permits, requirements, deadlines), specifications, and what to look for or how it works (kind 'fact', in the quote's words). section: one outline heading copied exactly; subject: what the fact is about; kind: price, cost, fee, rebate, duration, spec, rule or fact; label: a short row name that says what and whose it is ('Permit fee, City of Austin'); value: the figure or rule as the quote states it. One record per fact: never the same fact twice.",
    sides ? `This compares ${sides[0]} and ${sides[1]}: record each attribute the top results compare (price or cost, weight, heat or temperature limits, efficiency, lifespan, care, safety, and the like) once per side: subject exactly "${sides[0]}" or "${sides[1]}", the same label for both sides with no side's name in it ('Maximum oven temperature'), and the value as its quote states it.` : "",
    args.format === "how-to" ? "'steps': the procedure, in the order ONE excerpt gives it, from the owner's own instructions when an excerpt gives them (a manufacturer's, an agency's or a documentation page): step: one action in the imperative, in the quote's words; section: the outline heading it belongs under. Take every step of the procedure from that one excerpt; never reorder, merge or add steps."
      : "'steps': [] (this article is not a how-to).",
    "'faqs': for each listed question an excerpt answers: 'answer' in one or two plain sentences saying only what its quote says (numbers as written), with that quote. Skip a question no excerpt answers.",
  ].join(" ");
  const userMessage = [
    `SEARCH: ${args.search}`,
    `FORMAT: ${args.format}`,
    "OUTLINE SECTIONS (copy these headings exactly into 'section'):",
    ...args.sections.map((s) => `- ${s.heading}${s.covers ? `: ${s.covers}` : ""}`),
    args.coverage.length ? ["WHAT THE TOP RESULTS GIVE A SEARCHER (make a record for each an excerpt states):", ...args.coverage.map((c) => `- ${c}`)].join("\n") : "",
    list && args.options.length ? `OPTIONS THE TOP LISTS NAME: ${args.options.join(", ")}` : "",
    args.questions.length ? ["QUESTIONS SEARCHERS ASK:", ...args.questions.slice(0, 8).map((q) => `- ${q}`)].join("\n") : "",
    "EXCERPTS (untrusted data; [0] is the business's own confirmed details):",
    `[0] ${args.productName} (the business; confirmed details)\n${args.profile.slice(0, 3000)}`,
    ...args.sources.map((source, index) => `[${index + 1}] ${args.ownerPage(source.url) ? "OWNER PAGE · " : ""}${source.title ?? "Untitled"} · ${source.url}\n${source.excerpt}`),
  ].filter(Boolean).join("\n\n");
  return { system, userMessage };
}

const normal = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[‘’′`]/g, "'").replace(/[“”″]/g, '"')
  .replace(/[‐-―−]/g, "-").replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** The quote is in the excerpt word for word (case, spacing and typographic quotes and dashes aside). */
export function quotedFrom(quote: string, excerpt: string): boolean {
  const q = normal(quote).replace(/^["'(\s.…]+|["')\s.…]+$/g, "");
  return q.length >= 8 && normal(excerpt).includes(q);
}
/** Every number in the value is stated in its quote. */
export function figuresQuoted(value: string, quote: string): boolean {
  return statedNumbers(value).every((n) => numberStated(n, quote));
}
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const mentions = (text: string, name: string) => { const k = key(name); return k.length >= 3 && key(text).includes(k); };
const competitorKey = (name: string) => name.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.(?:com|io|co|ai|org|net|app)\/?$/, "").replace(/[^a-z0-9]/g, "");
function dedupe<T>(items: readonly T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const k = id(item); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** A date the value names ("March 5, 2026", "March 2026") that is before now. */
function pastDate(value: string, now: number): boolean {
  for (const m of value.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:(\d{1,2}),?\s+)?((?:19|20)\d{2})\b/gi)) {
    const at = Date.UTC(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), m[2] ? Number(m[2]) : 28);
    if (at < now) return true;
  }
  return false;
}
/** A label with the option's name taken out ("Free trial, Gymdesk" → "Free trial"), and no bracket or comma left dangling. */
export function withoutName(label: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return label.replace(new RegExp(`\\b${escaped}(?:'s|’s)?\\b`, "gi"), " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\(\s*\)/g, " ").replace(/\(([^()]*)$/g, "$1").replace(/^([^()]*)\)/g, "$1")
    .replace(/\s+([,.;:)])/g, "$1").replace(/^[\s,;:–-]+|[\s,;:(–-]+$/g, "").replace(/\s+/g, " ").trim();
}
function origin(url: string): string { try { const u = new URL(url); return `${u.protocol}//${u.hostname}`; } catch { return ""; } }

/** Code's check of every record: its quote is in the excerpt it cites, every figure is in its quote, a name it adds is in its
 * quote, a product's facts come from its own page or a quote that names it (a price from its own page wins), each fact once. */
export function verifiedRecords(raw: Omit<Records, "steps"> & { steps?: Records["steps"] }, ctx: { sources: readonly AssemblySource[]; profile: string; productName: string;
  competitors: readonly string[]; sections: readonly string[]; now?: number }): VerifiedRecords {
  const dropped: string[] = [];
  const text = (n: number) => n === 0 ? ctx.profile : ctx.sources[n - 1]?.excerpt ?? "";
  const stale = (value: string) => /\b(?:will|upcoming|from|starting|effective|beginning)\b/i.test(value) && pastDate(value, ctx.now ?? Date.now());
  const valid = (record: { quote: string; source: number }, value: string, what: string) => {
    if (stale(value)) { dropped.push(`${what}: a change dated in the past ("${value.slice(0, 80)}")`); return false; }
    if (!Number.isInteger(record.source) || record.source < 0 || record.source > ctx.sources.length || (record.source === 0 && !ctx.profile.trim())) {
      dropped.push(`${what}: no source [${record.source}]`); return false;
    }
    if (!quotedFrom(record.quote, text(record.source))) { dropped.push(`${what}: its quote is not in source [${record.source}]`); return false; }
    if (!figuresQuoted(value, record.quote)) { dropped.push(`${what}: a figure its quote doesn't state`); return false; }
    return true;
  };
  const namesQuoted = (value: string, quote: string) => namedEntities(value).every((name) => key(name).length < 3 || mentions(quote, name) || mentions(ctx.productName, name));
  const competitor = (name: string) => ctx.competitors.some((c) => { const k = competitorKey(c); return k.length >= 3 && key(name).includes(k); });
  const options: AssembledOption[] = [];
  for (const option of raw.options) {
    const name = option.name.replace(/\s+/g, " ").trim(), k = key(name);
    if (k.length < 2 || options.some((o) => key(o.name) === k)) continue;
    const business = k === key(ctx.productName);
    if (!business && competitor(name)) { dropped.push(`${name}: a competitor of the business`); continue; }
    const own = (n: number) => n === 0 ? business : !business && firstPartyProductPage(ctx.sources[n - 1]?.url ?? "", [k]);
    const about = (record: { quote: string; source: number }, what: string) => {
      const ok = own(record.source) || (!business && record.source > 0 && mentions(record.quote, name));
      if (!ok) dropped.push(`${what}: from a page that is not ${name}'s and doesn't name it`);
      return ok;
    };
    const prices = option.prices.map((p) => NOT_A_PLAN.test(p.plan.trim()) ? { ...p, plan: "" } : p).filter((p) => {
      if (!PRICE_STATED.test(p.price)) { dropped.push(`${name} price "${p.price}": no currency`); return false; }
      return valid(p, `${p.plan} ${p.price} ${p.billing}`, `${name} price`) && about(p, `${name} price`);
    });
    const ownPrices = prices.filter((p) => own(p.source));
    const notes = (records: Records["options"][number]["features"], what: string, limit: number) => dedupe(records.filter((r) =>
      valid(r, r.text, `${name} ${what}`) && namesQuoted(r.text, r.quote) && about(r, `${name} ${what}`)), (r) => key(r.text)).slice(0, limit);
    const kept = { prices: dedupe(ownPrices.length ? ownPrices : prices, (p) => `${key(p.plan)}|${key(p.price)}`).slice(0, 4),
      features: notes(option.features, "feature", 4), limits: notes(option.limits, "limit", 2) };
    if (!kept.prices.length && kept.features.length < 2) { dropped.push(`${name}: too little on record to list`); continue; }
    const website = business ? "" : firstPartyProductPage(option.website, [k]) ? origin(option.website)
      : origin(ctx.sources.find((source) => firstPartyProductPage(source.url, [k]))?.url ?? "");
    options.push({ name, website, business, ...kept, extras: [] });
  }
  options.sort((a, b) => Number(b.business) - Number(a.business));
  const sectionOf = (heading: string) => ctx.sections.find((s) => s.toLowerCase() === heading.trim().toLowerCase());
  const facts = dedupe(raw.facts.flatMap((fact) => {
    const section = sectionOf(fact.section);
    if (!section) { dropped.push(`${fact.label}: an unknown section "${fact.section}"`); return []; }
    if (!valid(fact, `${fact.label} ${fact.value}`, fact.label)) return [];
    if (!namesQuoted(fact.value, fact.quote)) { dropped.push(`${fact.label}: a name its quote doesn't give`); return []; }
    return [{ ...fact, section, kind: (FACT_KINDS as readonly string[]).includes(fact.kind) ? fact.kind : "fact" }];
  }), (fact) => `${key(fact.label)}|${key(fact.value)}`).filter((fact) => {
    // Each fact once, with its owner: a fact about a listed option joins that option's entry (a trial length, a contract
    // term), unless the entry already says it; it is never printed again in another section.
    const option = options.find((o) => mentions(`${fact.label} ${fact.subject}`, o.name));
    if (!option) return true;
    const entry = [...option.prices, ...option.features, ...option.limits, ...option.extras];
    const entryText = entry.map((r) => ("price" in r ? `${r.plan} ${r.price} ${r.billing}` : "text" in r ? r.text : `${r.label} ${r.value}`)).join("\n");
    const figures = statedNumbers(fact.value);
    const said = entry.some((r) => normal(r.quote) === normal(fact.quote)) || (figures.length > 0 && figures.every((n) => numberStated(n, entryText))) ||
      (figures.length === 0 && key(entryText).includes(key(fact.value)));
    if (said) dropped.push(`${fact.label}: already in ${option.name}'s entry`);
    else if (option.extras.length < 4) option.extras.push({ ...fact, label: withoutName(fact.label, option.name) || fact.label });
    return false;
  });
  const faqs = dedupe(raw.faqs.filter((faq) => /\?\s*$/.test(faq.question.trim()) && !DEFLECTION.test(faq.answer) &&
    valid(faq, faq.answer, `FAQ "${faq.question}"`) && namesQuoted(faq.answer, faq.quote)), (faq) => key(faq.question)).slice(0, 5);
  // P299 (how-to): a procedure's steps all come from one source, in that source's own order (Cowork's batch 4: a mixed
  // procedure reversed a spring start-up). The source with the most checked steps wins; the others' steps are not printed.
  const checkedSteps = dedupe((raw.steps ?? []).filter((step) => valid(step, step.step, `step "${step.step.slice(0, 40)}"`) && namesQuoted(step.step, step.quote) &&
    !DEFLECTION.test(step.step)), (step) => key(step.step));
  const bySource = new Map<number, typeof checkedSteps>();
  for (const step of checkedSteps) bySource.set(step.source, [...(bySource.get(step.source) ?? []), step]);
  const [procedure] = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  if (procedure && bySource.size > 1) dropped.push(`${checkedSteps.length - procedure[1].length} step(s) from other sources: one procedure, one source's order`);
  const at = (step: Records["steps"][number]) => normal(text(step.source)).indexOf(normal(step.quote).replace(/^["'(\s.…]+|["')\s.…]+$/g, ""));
  const steps = procedure ? [...procedure[1]].sort((a, b) => at(a) - at(b)).slice(0, 12) : [];
  return { options, facts, faqs, steps, dropped };
}

const NOT_A_PLAN = /^(?:starting(?: at| from)?(?: price)?|price|pricing|from|plan|base|standard price|monthly|annual)$/i;
/** A price says its currency, or that it is free ("5" alone, from a page that lost its symbol, is not a price). */
const PRICE_STATED = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|INR)\b|\bfree\b/i;
const PERIOD = /\/\s?(?:mo|month|yr|year|user|seat)\b|\b(?:per|a|an|each|every)\s+(?:month|year|user|seat|location)\b|\b(?:monthly|annually|yearly)\b/i;
const LEADING_PERIOD = /^(?:\/\s?\w+|(?:a|an|per|each|every)\s+(?:month|year|week|user|seat|location|studio|member)(?:\s+per\s+(?:user|seat|location|studio|member))?)\b/i;
const BILLING_TERM = /^(?:\/\s?\w+|(?:a|an|per|each|every)\s+\w+(?:\s+per\s+\w+)?|billed\s+\w+(?:\s+\w+)?|monthly|annually|yearly|weekly|one-time|once|paid\s+\w+)$/i;
/** "$12" + "a month" reads "$12 a month"; "$6.99" + "/mo" reads "$6.99/mo"; other terms follow a comma. */
export function priceWithBilling(price: string, billing: string): string {
  const p = price.replace(/\s+/g, " ").trim(), b = billing.replace(/\s+/g, " ").trim().replace(/^[,;]\s*/, "");
  const lead = BILLING_TERM.test(b) ? b : LEADING_PERIOD.exec(b)?.[0].trim() ?? "";
  return joinPeriod(p, lead);
}
function joinPeriod(p: string, b: string): string {
  if (!b || normal(p).includes(normal(b))) return p;
  if (PERIOD.test(p) && PERIOD.test(b) && !/\bbilled\b/i.test(b)) return p;
  if (/^\//.test(b)) return `${p}${b}`;
  if (/^(?:a|an|per|each|every|billed|monthly|annually|yearly|weekly|one-time|once)\b/i.test(b)) return `${p} ${b}`;
  return `${p}, ${b}`;
}
export function monthYear(at: number): string {
  return new Date(at).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
const cite = (n: number) => n > 0 ? ` [${n}]` : "";
const cell = (value: string) => value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const sentenceCase = (value: string) => { const v = value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, ""); return v ? v[0].toUpperCase() + v.slice(1) : v; };
const firstFigure = (value: string) => { const n = statedNumbers(value)[0]; return n === undefined ? (/\bfree\b/i.test(value) ? 0 : Infinity) : Number(n); };
function publisher(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
const LIST_HEADING = /\b(?:best|top|options|compared|picks|alternatives|choices)\b/i;
const LIST_HEADING_WEAK = /\b(?:tools|software|apps|platforms|services|providers|products)\b/i;
/** A source's excerpt with its page read in full: research's quotes first, then the page around its figures, at most max. */
export function enrichedExcerpt(excerpt: string, pageText: string, max = 6000): string {
  if (!pageText) return excerpt;
  const known = normal(excerpt);
  const pieces = pageText.split(" … ").filter((piece) => !known.includes(normal(piece).slice(0, 80)));
  let out = excerpt.trim();
  for (const piece of pieces) {
    if (out.length + piece.length + 3 > max) break;
    out += (out ? " … " : "") + piece;
  }
  return out;
}
export const FAQ_HEADING = /^(?:frequently asked questions|faqs?|common questions)$/i;

/** A section of the assembled article: its heading and the block code printed from its records; lead-ins come later. */
export type AssembledSection = { heading: string; body: string; options: string[] };
export type Skeleton = { sections: AssembledSection[]; faq: AssembledSection | null; asOf: string };

/** Code prints every fact from its record, once: a section with no record has no heading. */
export function skeletonFor(args: { format: string; sections: readonly string[]; records: VerifiedRecords; sources: readonly AssemblySource[]; readAt: number;
  sides?: readonly [string, string] | null }): Skeleton {
  const asOf = monthYear(args.readAt);
  const out: AssembledSection[] = [];
  // A comparison's attributes stated for both sides go in one side-by-side table, each fact once (single-side facts stay in
  // their sections).
  const sides = args.format === "comparison" ? args.sides ?? null : null;
  const tabled = new Set<Records["facts"][number]>();
  // A how-to's steps: numbered, in their source's order, under the section most of them name (or the outline's steps section).
  const steps = args.format === "how-to" ? args.records.steps ?? [] : [];
  const named = new Map<string, number>();
  for (const step of steps) { const heading = args.sections.find((s) => s.toLowerCase() === step.section.trim().toLowerCase()); if (heading) named.set(heading, (named.get(heading) ?? 0) + 1); }
  const stepsHeading = steps.length ? [...named.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? args.sections.find((s) => /\bsteps?\b|\bhow to\b|\bprocess\b|\bprocedure\b/i.test(s) && !FAQ_HEADING.test(s)) ?? "Step by step" : "";
  const stepList = steps.map((step, index) => `${index + 1}. ${sentenceCase(step.step)}${cite(step.source)}`).join("\n");
  let comparison = "", comparisonHeading = "";
  if (sides) {
    const attribute = (label: string) => key(wordsOf(label).filter((w) => !wordsOf(`${sides[0]} ${sides[1]}`).includes(w)).join(" "));
    const rows = new Map<string, { label: string; cells: (Records["facts"][number] | undefined)[] }>();
    for (const fact of args.records.facts) {
      const side = sideOf(`${fact.subject} ${fact.label}`, sides);
      const id = attribute(fact.label);
      if (side < 0 || !id) continue;
      const own = sides.map((side, i) => wordsOf(side).filter((w) => !wordsOf(sides[1 - i]).includes(w)).join(" ")).filter(Boolean);
      const row = rows.get(id) ?? { label: [...sides, ...own].reduce((label, name) => withoutName(label, name), fact.label), cells: [undefined, undefined] };
      if (!row.cells[side]) row.cells[side] = fact;
      rows.set(id, row);
    }
    const both = [...rows.values()].filter((row) => row.cells[0] && row.cells[1] && row.label);
    if (both.length >= 2) {
      const value = (fact: Records["facts"][number]) => `${cell(fact.value)}${cite(fact.source)}`;
      comparison = [`| | ${cell(sentenceCase(sides[0]))} | ${cell(sentenceCase(sides[1]))} |`, "| --- | --- | --- |",
        ...both.map((row) => `| ${cell(sentenceCase(row.label))} | ${value(row.cells[0]!)} | ${value(row.cells[1]!)} |`)].join("\n");
      for (const row of both) { tabled.add(row.cells[0]!); tabled.add(row.cells[1]!); }
      comparisonHeading = args.sections.find((s) => /\b(?:compar\w*|side by side|at a glance|key differences|differences|vs\.?|versus)\b/i.test(s) && !FAQ_HEADING.test(s))
        ?? args.sections.find((s) => !FAQ_HEADING.test(s)) ?? "At a glance";
    }
  }
  const faqHeading = args.sections.find((s) => FAQ_HEADING.test(s.trim())) ?? "Frequently asked questions";
  const listHeading = args.format === "list" ? args.sections.find((s) => LIST_HEADING.test(s) && !FAQ_HEADING.test(s))
    ?? args.sections.find((s) => LIST_HEADING_WEAK.test(s) && !/^(?:what|why|how)\b/i.test(s) && !FAQ_HEADING.test(s)) ?? "The options compared" : "";
  const listBlock = (): AssembledSection | null => {
    const options = args.records.options;
    if (!options.length) return null;
    const lines: string[] = [];
    const starting = new Map(options.map((o) => [o.name, [...o.prices].sort((a, b) => firstFigure(a.price) - firstFigure(b.price))[0]]));
    const priced = options.filter((o) => starting.get(o.name));
    if (priced.length) {
      lines.push(`Prices as of ${asOf}.`, "", "| Option | Starting price |", "| --- | --- |");
      for (const o of priced) {
        const p = starting.get(o.name)!;
        const plan = p.plan.trim() && !normal(p.price).includes(normal(p.plan)) ? ` (${cell(p.plan)}${/\bplan\b/i.test(p.plan) ? "" : " plan"})` : "";
        const price = `${cell(priceWithBilling(p.price, p.billing))}${plan}${cite(p.source)}`;
        lines.push(`| ${o.website ? `[${cell(o.name)}](${o.website})` : cell(o.name)} | ${price} |`);
      }
    }
    for (const o of options) {
      const first = starting.get(o.name);
      lines.push("", `### ${o.name}`, "", `{{SUITS:${o.name}}}`, "");
      const bullets = [
        ...o.prices.filter((p) => p !== first).map((p) => `- **${sentenceCase(p.plan) || "Price"}:** ${priceWithBilling(p.price, p.billing)}${cite(p.source)}`),
        ...o.features.map((f) => `- ${sentenceCase(f.text)}${cite(f.source)}`),
        ...o.extras.map((f) => `- **${sentenceCase(f.label)}:** ${f.value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")}${cite(f.source)}`),
        ...o.limits.map((l) => `- **Limit:** ${l.text.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")}${cite(l.source)}`),
      ];
      lines.push(...bullets);
    }
    return { heading: listHeading, body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), options: options.map((o) => o.name) };
  };
  const listInOutline = args.sections.some((s) => s === listHeading);
  for (const heading of args.sections) {
    if (FAQ_HEADING.test(heading.trim())) continue;
    if (args.format === "list" && heading === listHeading) { const block = listBlock(); if (block) out.push(block); continue; }
    const facts = args.records.facts.filter((f) => f.section === heading && !tabled.has(f));
    const table = heading === comparisonHeading ? comparison : heading === stepsHeading ? stepList : "";
    if (!facts.length && !table) continue;
    const money = facts.filter((f) => MONEY.has(f.kind)), other = facts.filter((f) => !MONEY.has(f.kind));
    const lines: string[] = table ? [table, ""] : [];
    if (money.length) lines.push(`Prices and fees as of ${asOf}.`, "");
    if (money.length >= 2) {
      lines.push("| Item | Amount | Source |", "| --- | --- | --- |",
        ...money.map((f) => `| ${cell(sentenceCase(f.label))} | ${cell(f.value)}${cite(f.source)} | ${f.source > 0 ? cell(publisher(args.sources[f.source - 1]?.url ?? "")) : "Our pricing"} |`), "");
    } else other.unshift(...money);
    const sideLabel = (f: Records["facts"][number]) => {
      if (!sides) return sentenceCase(f.label);
      const side = sideOf(`${f.subject} ${f.label}`, sides);
      return side < 0 || sideOf(f.label, sides) === side ? sentenceCase(f.label) : `${sentenceCase(sides[side])}, ${f.label.replace(/^./, (c) => c.toLowerCase())}`;
    };
    lines.push(...other.map((f) => `- **${sideLabel(f)}:** ${f.value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")}${cite(f.source)}`));
    out.push({ heading, body: lines.join("\n").trim(), options: [] });
  }
  if (comparison && !args.sections.includes(comparisonHeading)) out.unshift({ heading: comparisonHeading, body: comparison, options: [] });
  if (stepList && !args.sections.includes(stepsHeading)) out.unshift({ heading: stepsHeading, body: stepList, options: [] });
  if (args.format === "list" && !listInOutline) {
    const block = listBlock();
    if (block) out.splice(Math.min(1, out.length), 0, block);
  }
  const faq = args.records.faqs.length ? { heading: faqHeading, options: [],
    body: args.records.faqs.map((f) => `### ${f.question.trim()}\n\n${f.answer.replace(/\s+/g, " ").trim().replace(/[.!]?$/, (end) => `${cite(f.source)}${end || "."}`)}`).join("\n\n") } : null;
  return { sections: out, faq, asOf };
}

export const ProseSchema = z.object({ title: z.string(), metaTitle: z.string(), metaDescription: z.string(), intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), leadIn: z.string() })).default([]),
  options: z.array(z.object({ name: z.string(), suits: z.string() })).default([]), conclusion: z.string() });
export type Prose = z.infer<typeof ProseSchema>;
export const PROSE_INPUT_SCHEMA: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false } = {
  type: "object", additionalProperties: false, required: ["title", "metaTitle", "metaDescription", "intro", "sections", "options", "conclusion"],
  // The conclusion comes last: strict output follows this order, and asked for first it was once written as "placeholder".
  properties: { title: str, metaTitle: str, metaDescription: str, intro: str,
    sections: { type: "array", items: { type: "object", additionalProperties: false, properties: { heading: str, leadIn: str }, required: ["heading", "leadIn"] } },
    options: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, suits: str }, required: ["name", "suits"] } },
    conclusion: str },
};

/** The one prose call: it sees the article code built and writes only the short parts marked WRITE. */
export function proseRequest(args: { search: string; productName: string; businessSummary: string; audience: string; profile: string;
  skeleton: Skeleton; records: VerifiedRecords }): { system: string; userMessage: string } {
  const system = [
    "You write the short prose of an article whose facts code has already placed. You see the article as code built it: its tables, price lists, figures and answers are final and read-only.",
    "Write only: 'intro', 2-4 sentences that answer the search directly and say what the reader will find; for each section, 'leadIn', 1-3 sentences that tell the reader what the block below shows and how to use it for their decision; for each option, 'suits', 1-2 sentences on who it suits, from its own records below (what it does, what it lacks, what it costs, said in words); 'conclusion', 2-4 sentences on how to decide, then at most one sentence on what the business does, from its confirmed details; the 'title' (under 65 characters, in the search's words, no number or year); 'metaTitle' (under 60 characters); and 'metaDescription' (under 155 characters: what the reader gets).",
    "Never write a number, price, percentage, date or year, nor how many options there are: the blocks give every figure, so a lead-in says 'the table compares starting prices', never the prices. Name no company, product, program, agency or person except one the section's own records name (and the business itself in the conclusion). Never tell the reader to check, confirm, verify, ask, call or contact anyone. Never mention records, data, sources or what the article lacks: write about the options and the reader's decision. Don't restate what a block says. Plain words, second person, no hype.",
  ].join(" ");
  const recordNames = (section: AssembledSection) => section.options.length ? section.options.map((name) => {
    const o = args.records.options.find((x) => x.name === name)!;
    return `- ${name}: ${[...o.features.map((f) => f.text), ...o.extras.map((f) => `${f.label}: ${f.value}`), ...o.limits.map((l) => `not included: ${l.text}`), ...o.prices.map((p) => `${p.plan} ${p.price}`.trim())].join("; ")}`;
  }).join("\n") : "";
  const userMessage = [
    `SEARCH: ${args.search}`,
    `BUSINESS: ${args.productName}: ${args.businessSummary}`.slice(0, 600),
    args.audience ? `READERS: ${args.audience}`.slice(0, 400) : "",
    `BUSINESS CONFIRMED DETAILS:\n${args.profile.slice(0, 1500)}`,
    "THE ARTICLE AS CODE BUILT IT (read-only except the WRITE markers):",
    "[WRITE intro]",
    ...args.skeleton.sections.map((section) => [`## ${section.heading}`, `[WRITE leadIn for "${section.heading}"]`,
      section.body.replace(/\{\{SUITS:([^}]+)\}\}/g, (_m, name: string) => `[WRITE suits for "${name}"]`),
      section.options.length ? `RECORDS FOR THE OPTIONS ABOVE:\n${recordNames(section)}` : ""].filter(Boolean).join("\n\n")),
    "[WRITE conclusion]",
    args.skeleton.faq ? `## ${args.skeleton.faq.heading}\n\n${args.skeleton.faq.body}` : "",
  ].filter(Boolean).join("\n\n");
  return { system, userMessage };
}

const HOMEWORK = /\b(?:check|confirm|verify|ask|call|contact|consult|request|get)\b[^.!?]{0,40}\b(?:quotes?|estimates?|providers?|vendors?|installers?|contractors?|plumbers?|roofers?|city|county|utility|utilities|pricing pages?|websites?|sites?|sales teams?|support)\b/i;
/** Prose about the article's own making ("the records give no price", "the data shows") is not for readers. */
const COUNTED = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:\w+\s+)?(?:options|tools|apps|platforms|picks|choices|vendors|providers|products|programs|services)\b/i;
const MAKING = /\b(?:records?|the data|our data|data (?:given|shown|provided|here)|(?:these|the|our) sources?|excerpts?|not (?:listed|given|shown|stated) here|no (?:price|pricing|figure)s? (?:is |are )?(?:given|listed|shown|stated|published)|hard(?:er)? to judge)\b/i;
/** The prose sentences code keeps: none that states a number, or names a company, its scope's records don't give, and none
 * that sends the reader to find something out. */
export function keptProse(text: string, scope: { allowedText: string }): { kept: string; dropped: string[] } {
  // A stand-in the model left ("placeholder", "TBD") or a fragment is not prose.
  if (/^\W*(?:placeholder|tbd|todo|to be written|n\/a|none|lorem ipsum)\W*$/i.test(text.trim()) || text.trim().split(/\s+/).length < 3) {
    return { kept: "", dropped: text.trim() ? [text.trim()] : [] };
  }
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/).filter(Boolean);
  const dropped: string[] = [];
  const kept = sentences.filter((sentence) => {
    const plain = sentence.replace(/\*\*|__|`/g, "");
    const bad = DEFLECTION.test(plain) || HOMEWORK.test(plain) || MAKING.test(plain) || COUNTED.test(plain) || /https?:\/\/|www\.|\.example\b/i.test(plain) ||
      statedNumbers(plain).some((n) => !numberStated(n, scope.allowedText)) ||
      namedEntities(plain).some((name) => key(name).length >= 3 && !mentions(scope.allowedText, name));
    if (bad) dropped.push(sentence);
    return !bad;
  });
  return { kept: kept.join(" "), dropped };
}

/** The article: intro, each section's lead-in over its block, the conclusion with the business's next step, the FAQ last. */
export function assembledArticle(args: { skeleton: Skeleton; prose: Prose; records: VerifiedRecords; productName: string; profile: string;
  search: string; cta: { label: string; url: string } }): { markdown: string; dropped: string[] } {
  const dropped: string[] = [];
  const recordText = (records: { quote: string }[], more: string[] = []) => [...records.map((r) => r.quote), ...more].join("\n");
  const everything = recordText([...args.records.facts, ...args.records.faqs, ...args.records.options.flatMap((o) => [...o.prices, ...o.features, ...o.limits, ...o.extras])],
    [...args.records.options.map((o) => o.name), ...args.records.facts.map((f) => `${f.label} ${f.subject}`), args.productName, args.profile, args.search,
      ...args.skeleton.sections.map((s) => s.heading)]);
  const keep = (text: string, allowedText: string) => { const r = keptProse(text, { allowedText }); dropped.push(...r.dropped); return r.kept; };
  const parts: string[] = [];
  const intro = keep(args.prose.intro, everything);
  if (intro) parts.push(intro);
  for (const section of args.skeleton.sections) {
    const facts = args.records.facts.filter((f) => f.section === section.heading);
    const options = args.records.options.filter((o) => section.options.includes(o.name));
    const local = recordText([...facts, ...options.flatMap((o) => [...o.prices, ...o.features, ...o.limits, ...o.extras])],
      [...options.map((o) => o.name), ...facts.map((f) => `${f.label} ${f.subject}`), args.productName, args.search, section.heading]);
    const lead = keep(args.prose.sections.find((s) => s.heading.trim().toLowerCase() === section.heading.toLowerCase())?.leadIn ?? "", local);
    const body = section.body.replace(/\{\{SUITS:([^}]+)\}\}\n*/g, (_m, name: string) => {
      const option = options.find((o) => o.name === name);
      const own = option ? recordText([...option.prices, ...option.features, ...option.limits, ...option.extras], [option.name, args.productName, args.search, option.business ? args.profile : ""]) : "";
      const suits = option ? keep(args.prose.options.find((o) => key(o.name) === key(name))?.suits ?? "", own) : "";
      return suits ? `${suits}\n\n` : "";
    });
    parts.push(`## ${section.heading}`, ...(lead ? [lead] : []), body);
  }
  const conclusion = keep(args.prose.conclusion, everything);
  parts.push("## The bottom line", ...(conclusion ? [conclusion] : []), `[${args.cta.label}](${args.cta.url})`);
  if (args.skeleton.faq) parts.push(`## ${args.skeleton.faq.heading}`, args.skeleton.faq.body);
  return { markdown: parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), dropped };
}

/** Readable text of a fetched page around its figures (an owner's pricing, fee, rebate or rules page), for a records excerpt:
 * research quotes a line or two of a page, and a table of plans or fees needs all of it. */
export function pricingText(html: string, max = 6000): string { return figureText(html, max, PRICE_HIT); }
const PRICE_HIT = /[$€£]\s?\d|\bfree\b|\bper (?:month|year|user)\b|\/\s?mo\b/gi;
const FIGURE_HIT = /[$€£]\s?\d|\d\s?%|\bfree\b|\bper (?:month|year|user)\b|\/\s?mo\b|\b\d[\d,.]*\s?(?:days?|weeks?|months?|years?|hours?|°\s?[FC]|gpm|gallons?|sq\.? ?ft|square feet)\b|\b(?:required|requires|must|permit|rebate|incentive|eligible|deadline)\b/gi;
export function ownerPageText(html: string, max = 6000): string { return figureText(html, max, FIGURE_HIT); }
function figureText(html: string, max: number, hit: RegExp): string {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(?:nav|footer|header|svg)[\s\S]*?<\/(?:nav|footer|header|svg)>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<\/(?:p|div|li|h\d|tr|td|th|section)>/gi, ". ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s*\.\s*(?:\.\s*)+/g, ". ").replace(/\s+/g, " ").trim();
  const hits = [...text.matchAll(hit)].map((m) => m.index ?? 0);
  if (!hits.length) return "";
  const windows: [number, number][] = [];
  for (const at of hits) {
    const start = Math.max(0, at - 300), end = Math.min(text.length, at + 300);
    const last = windows[windows.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else windows.push([start, end]);
  }
  let out = "";
  for (const [start, end] of windows) {
    const piece = text.slice(start, end).trim();
    if (out.length + piece.length + 3 > max) break;
    out += (out ? " … " : "") + piece;
  }
  return out;
}
