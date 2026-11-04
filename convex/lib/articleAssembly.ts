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
/** What "on" assembles. A how-to reads each procedure page's own ordered list first (research quotes snippets of a procedure in
 * no order: batch 6's first v3 how-to put a sprinkler blowout's three steps out of order). Tutorials keep the writer for now. */
export const ASSEMBLED_ON = ["list", "guide", "comparison", "how-to"] as const;

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
/** A step with the procedure it belongs to on its page (each ordered list is one procedure). */
export type VerifiedStep = Records["steps"][number] & { procedure?: number };
export type VerifiedRecords = { options: AssembledOption[]; facts: Records["facts"]; faqs: Records["faqs"]; steps?: VerifiedStep[]; dropped: string[] };

import { ITEM_FILLER } from "./researchPasses.ts";

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
    "'facts': for each outline section, the specifics its excerpts give a reader: cost and price ranges, fees, rebates and who pays them, durations, rules (permits, requirements, deadlines), specifications, and what to look for or how it works (kind 'fact', in the quote's words). section: one outline heading copied exactly; subject: what the fact is about (for a comparison, the side it is about); kind: price, cost, fee, rebate, duration, spec, rule or fact; label: a short row name for what it is, with no owner's, maker's or source's name in it ('Permit fee', not 'Permit fee, City of Austin'); value: the figure or rule as the quote states it. One record per fact: never the same fact twice.",
    sides ? `This compares ${sides[0]} and ${sides[1]}: record each attribute the top results compare (price or cost, weight, heat or temperature limits, efficiency, lifespan, care, safety, and the like) once per side: subject exactly "${sides[0]}" or "${sides[1]}", the same label for both sides with no side's name in it ('Maximum oven temperature'), and the value as its quote states it. A fact about one maker's specific product is not a fact about the material: give that product as its subject, never a side.` : "",
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
    list && args.options.length ? `OPTIONS THE TOP LISTS NAME: ${args.options.join(", ")}. Make an option record for EVERY one the excerpts name, including any whose own price you could not verify from its own page (code prints 'No public price' beside it) — a list's width is the union of what the results name.` : "",
    sides ? `COMPARISON SIDES: ${sides[0]} and ${sides[1]}. Extract the SAME attributes for BOTH sides wherever an excerpt states them — typical price, lifespan, weight, temperature or heat limits, maintenance, care, weight of use. A side-by-side table row needs a value for each side, so when an excerpt gives an attribute for one side, look for it (or its counterpart) for the other in every excerpt; a fact only one side states still belongs in its own section.` : "",
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
/** Ordinary sentence-opening words a quote may start with: none of them names a product (comparison's foreign check). */
const QUOTE_COMMON = new Set(("This That These Those The A An It Its All Most Many Some Any No Not If When While Where What Why How " +
  "Which Who For In On At By With Without After Before During From Into Over Under Both Either Neither January February March April May " +
  "June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday Step Note Tip Yes No " +
  "Also But And Or So Then Than Once Your You We Our They Their").split(" "));
/** A date the value names ("March 5, 2026", "March 2026") that is before now. */
function pastDate(value: string, now: number): boolean {
  for (const m of value.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:(\d{1,2}),?\s+)?((?:19|20)\d{2})\b/gi)) {
    const at = Date.UTC(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), m[2] ? Number(m[2]) : 28);
    if (at < now) return true;
  }
  return false;
}
/** R9 (batch 6): a record whose quote or value states a program or period that has ended ("expired", "no longer available",
 * "2023 through 2025", "through December 31, 2025"): batch 6 promoted the 25C credit, which ended Dec 31 2025, as current. */
export function endedProgram(value: string, quote: string, now: number): boolean {
  const text = `${value} ${quote}`;
  if (/\b(?:expired|discontinued|no longer (?:offered|available|accepting \w+))\b/i.test(text)) return true;
  const year = new Date(now).getUTCFullYear();
  // "through <month?> <year>" with the year already past ("through December 31, 2025", "through 2025").
  for (const m of text.matchAll(/\b(?:through|until|till)\s+(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?)?((?:19|20)\d{2})\b/gi)) {
    if (Number(m[1]) < year) return true;
  }
  // A stated period "2023-2025", "2023 through 2025", "2023 to 2025" whose end is past.
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|\b(?:through|to)\b)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?((?:19|20)\d{2})\b/g)) {
    if (Number(m[2]) < year) return true;
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
/** P321: the authority recovery's extraction is CODE, not a model call. A sentence (or table row) of the program
 * owner's own page that carries one of the plan item's distinctive terms beside a money figure or a percentage
 * becomes a fact record whose quote is a verbatim slice of the page's excerpt — so quote verification, figure
 * verification and the R9 rules pass by construction, not by a roll. Expired programs and past-dated changes are
 * dropped by verifiedRecords like any other record. The item's own words pick the sentences and the outline
 * section; nothing here knows any city, utility or program. */
export function authorityFactsFromPage(args: { item: string; excerpt: string; source: number; owner: string;
  sections: readonly string[]; covers: ReadonlyMap<string, string> }): Records["facts"] {
  const terms = [...new Set((args.item.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !ITEM_FILLER.has(w)))];
  if (!terms.length) return [];
  const keyword = /\b(permits?|fees?|rebates?|incentives?|credits?)\b/i.exec(args.item)?.[0]?.toLowerCase() ?? "fact";
  const kind: Records["facts"][number]["kind"] = /rebate|incentive|credit/.test(keyword) ? "rebate" : /permit|fee/.test(keyword) ? "fee" : "fact";
  const labelWords: string[] = [];
  for (const word of args.item.split(/\s+/)) {
    if (/[,.;:]$/.test(word)) { labelWords.push(word.replace(/[,.;:]$/, "")); break; }
    labelWords.push(word);
    if (/\b(permits?|fees?|rebates?|incentives?|credits?)\b/i.test(word)) break;
  }
  const label = sentenceCase(labelWords.slice(0, 6).join(" ")) || sentenceCase(keyword);
  // The record prints under an outline heading; the heading (with the coverage text the planner gave it) that
  // shares the most of the item's terms is its home. No home means no record — an orphan fact prints nowhere.
  let section = "", best = 0;
  for (const heading of args.sections) {
    const text = `${heading} ${args.covers.get(heading) ?? ""}`.toLowerCase();
    const score = terms.filter((term) => text.includes(term)).length;
    if (score > best) { best = score; section = heading; }
  }
  if (!section) section = args.sections.find((h) => /\b(?:rebate|incentive|credit|permit|fee)/i.test(h)) ?? "";
  if (!section) return [];
  const FIGURE = /(?:up to |at least |maximum of )?[$€£]\s?\d[\d,]*(?:\.\d+)?|(?:up to |at least )?\b\d[\d,]*(?:\.\d+)?\s?%/i;
  const units = args.excerpt.split("\n").flatMap((line) => line.trim().startsWith("|") ? [line] : line.split(/(?<=[.;])\s+(?=[A-Z"“(])/));
  // A rebate sentence says rebate; a permit sentence says permit. The item's keyword must appear in the sentence
  // itself, so a page of install costs can never satisfy a rebate item (batch 28's heat pump pulled cost ranges
  // off a rebate-named aggregator this way).
  const keywordWord = /\b(permits?|fees?|rebates?|incentives?|credits?)\b|\b(?:receive|get|claim|offers?)\b[^.]{0,50}\bback\b/i;
  const out: Records["facts"] = [];
  for (const unit of units) {
    const clean = unit.trim().replace(/^[|\-*\s]+/, (m) => (unit.trim().startsWith("|") ? "|" : "")).trim();
    if (clean.length < 10 || out.length >= 3) continue;
    const lower = clean.toLowerCase();
    if (keyword !== "fact" && !keywordWord.test(clean)) continue;
    if (terms.filter((term) => lower.includes(term)).length < 1) continue;
    const figure = FIGURE.exec(clean);
    if (!figure) continue;
    const value = figure[0].trim();
    if (out.some((f) => key(f.value) === key(value))) continue;
    // The subject names the program's owner (the paying utility or agency, from its own page title): the record
    // attributes the figure to the organization that runs the program — R9b's own-page rule reads exactly this.
    out.push({ section, subject: args.owner, kind, label, value, quote: clean, source: args.source });
  }
  return out;
}

export function verifiedRecords(raw: Omit<Records, "steps"> & { steps?: Records["steps"] }, ctx: { sources: readonly AssemblySource[]; profile: string; productName: string;
  competitors: readonly string[]; sections: readonly string[]; now?: number }): VerifiedRecords {
  const dropped: string[] = [];
  const text = (n: number) => n === 0 ? ctx.profile : ctx.sources[n - 1]?.excerpt ?? "";
  const stale = (value: string) => /\b(?:will|upcoming|from|starting|effective|beginning)\b/i.test(value) && pastDate(value, ctx.now ?? Date.now());
  const valid = (record: { quote: string; source: number }, value: string, what: string) => {
    if (endedProgram(value, record.quote, ctx.now ?? Date.now())) { dropped.push(`${what}: a program or period that has ended ("${(value || record.quote).slice(0, 80)}")`); return false; }
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
      if (!valid(p, `${p.plan} ${p.price} ${p.billing}`, `${name} price`)) return false;
      // R10 (batch 6, V3-RESEARCH-FIXTURES): a price exists only from the option's own fetched page. A third party's page
      // naming it (Glofox "$99" from a listicle, Xero's range from an SEO site) shows as "No public price" or nothing.
      if (!own(p.source)) { dropped.push(`${name} price "${p.price}": not from its own page`); return false; }
      return true;
    });
    const ownPrices = prices.filter((p) => own(p.source));
    const notes = (records: Records["options"][number]["features"], what: string, limit: number) => dedupe(records.filter((r) =>
      valid(r, r.text, `${name} ${what}`) && namesQuoted(r.text, r.quote) && about(r, `${name} ${what}`)), (r) => key(r.text)).slice(0, limit);
    // P327 (Cowork item 4): a limit is a negative claim about a product — only its own page may state it
    // (batch 32 sourced WellnessLiving's and Zen Planner's limits from Mindbody's comparison page).
    const ownNotes = (records: Records["options"][number]["features"], what: string, limit: number) => dedupe(records.filter((r) =>
      valid(r, r.text, `${name} ${what}`) && namesQuoted(r.text, r.quote) && own(r.source)), (r) => key(r.text)).slice(0, limit);
    const kept = { prices: dedupe(ownPrices.length ? ownPrices : prices, (p) => `${key(p.plan)}|${key(p.price)}`).slice(0, 4),
      features: notes(option.features, "feature", 4), limits: ownNotes(option.limits, "limit", 2) };
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
    // R9b (batch 8): a rebate or tax-credit figure exists only from the program's own page — a government site, or a page
    // on the paying utility's own domain. Batch 8 printed 25C credit caps from a tax-software blog whose page never says
    // the program ended: the owner's page either states the figure with its dates or the record goes.
    if (/\b(?:rebate|tax credit|credit)\b/i.test(`${fact.kind} ${fact.subject} ${fact.label}`) && fact.source > 0) {
      const url = ctx.sources[fact.source - 1]?.url ?? "";
      const host = /^https?:\/\/([^\/]+)/.exec(url)?.[1] ?? "";
      const ownerKey = host.replace(/^www\./, "").split(".")[0] ?? "";
      const authority = /\.gov\b|\.edu\b|\.mil\b/i.test(host) || /energystar|irs\.gov|energy\.gov/i.test(host);
      const ownerSpeaking = ownerKey.length >= 5 && mentions(`${fact.quote} ${fact.value} ${fact.subject}`, ownerKey);
      if (!authority && !ownerSpeaking) {
        dropped.push(`${fact.label}: a rebate or credit not from the program's own page (${host || "no host"})`);
        return [];
      }
    }
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
  // Which ordered list a step comes from: each list on the page starts again at "1." (lib orderedStepsText).
  const listOf = (step: Records["steps"][number]) => (normal(text(step.source)).slice(0, Math.max(0, at(step))).match(/(?:^|\s(?:…|\.\.\.)\s)1\. /g) ?? []).length;
  // P307 (batch 8's sprinkler shut the water off at steps 1 and 4): two steps of one procedure that say the same
  // thing in different words keep the first only. Compared on content words, never order words.
  const stepWords = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []));
  const sameStep = (a: string, b: string) => { const A = stepWords(a), B = stepWords(b);
    return A.size >= 3 && B.size >= 3 && [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size) >= 0.65; };
  const steps: VerifiedStep[] = procedure ? [...procedure[1]].sort((a, b) => at(a) - at(b))
    .filter((step, i, all) => !all.slice(Math.max(0, i - 4), i)
      .some((earlier) => listOf(earlier) === listOf(step) && sameStep(earlier.step, step.step)))
    .slice(0, 12).map((step) => ({ ...step, procedure: listOf(step) })) : [];
  return { options, facts, faqs, steps, dropped };
}

const NOT_A_PLAN = /^(?:starting(?: at| from)?(?: price)?|price|pricing|from|plan|base|standard price|monthly|annual)$/i;
/** A price says its currency, or that it is free ("5" alone, from a page that lost its symbol, is not a price). */
const PRICE_STATED = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|INR)\b|\bfree\b/i;
const PERIOD = /\/\s?(?:mo|month|yr|year|user|seat)\b|\b(?:per|a|an|each|every)\s+(?:month|year|user|seat|location)\b|\b(?:monthly|annually|yearly)\b/i;
const LEADING_PERIOD = /^(?:\/\s?\w+|(?:a|an|per|each|every)\s+(?:month|year|week|user|seat|location|studio|member)(?:\s+per\s+(?:user|seat|location|studio|member))?)\b/i;
const BILLING_TERM = /^(?:\/\s?\w+|(?:a|an|per|each|every)\s+\w+(?:\s+per\s+\w+)?|billed\s+\w+(?:\s+\w+)?|monthly|annually|yearly|weekly|one-time|once|paid\s+\w+)$/i;
/** "$55 PER MONTH" (a page's shouting) reads "$55 per month"; an all-caps run of 4+ letters is shouting, "USD" is not. */
const decase = (value: string) => /[A-Z]{4,}/.test(value) && value === value.toUpperCase() ? value.toLowerCase() : value;
/** "$12" + "a month" reads "$12 a month"; "$6.99" + "/mo" reads "$6.99/mo"; other terms follow a comma. */
export function priceWithBilling(price: string, billing: string): string {
  const p = decase(price.replace(/\s+/g, " ").trim()), b = decase(billing.replace(/\s+/g, " ").trim().replace(/^[,;]\s*/, ""));
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
const cell = (value: string) => decase(value.replace(/\|/g, "/").replace(/\s+/g, " ").trim());
const sentenceCase = (value: string) => { const v = value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, ""); return v ? v[0].toUpperCase() + v.slice(1) : v; };
const firstFigure = (value: string) => { const n = statedNumbers(value)[0]; return n === undefined ? (/\bfree\b/i.test(value) ? 0 : Infinity) : Number(n); };
function publisher(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
const LIST_HEADING = /\b(?:best|top|options|compared|picks|alternatives|choices)\b/i;
const LIST_HEADING_WEAK = /\b(?:tools|software|apps|platforms|services|providers|products)\b/i;
/** A heading the options table may sit under. Batch 6 put the yoga price table under "Integrations with other tools":
 * a weak match must not start with a section-topic word that is not the list itself. */
export const LIST_HEADING_GUARD = (heading: string) => LIST_HEADING_WEAK.test(heading) &&
  !/^(?:integrations?|payments?|pricing|features?|support|reporting|onboarding|getting started|mobile|membership)\b/i.test(heading.trim());
/** A procedure as its page writes it: each ordered list (or "Step N" headings) in page order, numbered, at most max. Research
 * quotes snippets of a procedure in no order; batch 6's first v3 how-to put a sprinkler blowout's steps out of order. */
export function orderedStepsText(html: string, max = 3000): string {
  const clean = (value: string) => value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;|&#39;|&apos;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#36;/g, "$").replace(/\s+/g, " ").trim();
  const lists = [...html.matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi)].map((list) => [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((item) => clean(item[1])).filter((text) => text.length > 8));
  const headings = [...html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((h) => clean(h[1])).filter((text) => /^step\s*\d+\b/i.test(text));
  let out = "";
  for (const steps of [...lists.filter((list) => list.length >= 3), ...(headings.length >= 3 ? [headings] : [])]) {
    const block = steps.map((step, index) => `${index + 1}. ${step.slice(0, 280)}`).join(" ");
    if (out.length + block.length + 3 > max) break;
    out += (out ? " … " : "") + block;
  }
  return out;
}
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

/** v3.1 (Nov 3, batch 6): a fact the writer may state in prose, as the placeholder the model writes ({{r7}}) and code fills
 * with the record's value and citation. Facts reach the reader through language again; code still owns every figure. */
export type ProseRecord = { id: string; label: string; value: string; source: number };
/** A section of the assembled article: its heading, the data block code printed from its records (a table, a step list), and
 * the records its prose paragraph may state as placeholders. */
export type AssembledSection = { heading: string; body: string; options: string[]; records: ProseRecord[] };
export type Skeleton = { sections: AssembledSection[]; faq: AssembledSection | null; asOf: string;
  /** The records the intro may state (the headline facts: the search's answer in the first paragraph). */
  intro: ProseRecord[]; pool: Record<string, { display: string; source: number; label: string }> };

/** Code prints structured data from its records, once: a section with no record has no heading, and every other fact reaches
 * the reader as a placeholder the prose fills (records are evidence, never display text). */
export function skeletonFor(args: { format: string; sections: readonly string[]; records: VerifiedRecords; sources: readonly AssemblySource[]; readAt: number;
  sides?: readonly [string, string] | null }): Skeleton {
  const asOf = monthYear(args.readAt);
  const out: AssembledSection[] = [];
  const pool: Record<string, { display: string; source: number; label: string }> = {};
  let nextId = 0;
  const idOf = new Map<unknown, string>();
  const register = (record: unknown, display: string, source: number, label = ""): ProseRecord => {
    const id = `r${++nextId}`;
    pool[id] = { display, source, label };
    idOf.set(record, id);
    return { id, label, value: display, source };
  };
  // A comparison's attributes stated for both sides go in one side-by-side table, each fact once (single-side facts stay in
  // their sections). A fact about one maker's specific product is not a fact about the material: it stays out of the table.
  const sides = args.format === "comparison" ? args.sides ?? null : null;
  const tabled = new Set<Records["facts"][number]>();
  // A how-to's steps: numbered, in their source's order, under the section most of them name (or the outline's steps section).
  const steps = args.format === "how-to" ? args.records.steps ?? [] : [];
  const named = new Map<string, number>();
  for (const step of steps) { const heading = args.sections.find((s) => s.toLowerCase() === step.section.trim().toLowerCase()); if (heading) named.set(heading, (named.get(heading) ?? 0) + 1); }
  const stepsHeading = steps.length ? [...named.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? args.sections.find((s) => /\bsteps?\b|\bhow to\b|\bprocess\b|\bprocedure\b/i.test(s) && !FAQ_HEADING.test(s)) ?? "Step by step" : "";
  // Each section's procedure is numbered on its own (a page's drain-down and its blowout are two procedures).
  const sectionOfStep = (step: Records["steps"][number]) => args.sections.find((s) => s.toLowerCase() === step.section.trim().toLowerCase()) ?? stepsHeading;
  // One procedure split over sections keeps counting (1-4, then 5); a second procedure on the page starts again at 1.
  const counted = new Map<number, number>(), numbered = new Map<VerifiedStep, number>();
  for (const step of steps) { const n = (counted.get(step.procedure ?? 0) ?? 0) + 1; counted.set(step.procedure ?? 0, n); numbered.set(step, n); }
  const stepLists = new Map<string, string>();
  for (const heading of new Set(steps.map(sectionOfStep))) {
    stepLists.set(heading, steps.filter((step) => sectionOfStep(step) === heading).map((step) => `${numbered.get(step)}. ${sentenceCase(step.step)}${cite(step.source)}`).join("\n"));
  }
  const stepList = stepLists.get(stepsHeading) ?? "";
  let comparison = "", comparisonHeading = "";
  if (sides) {
    const sideWords = new Set(wordsOf(`${sides[0]} ${sides[1]}`));
    const attribute = (label: string) => key(wordsOf(label).filter((w) => !sideWords.has(w)).join(" "));
    const rows = new Map<string, { label: string; cells: (Records["facts"][number] | undefined)[] }>();
    for (const fact of args.records.facts) {
      const side = sideOf(`${fact.subject} ${fact.label}`, sides);
      const id = attribute(fact.label);
      // "Oven-safe up to 500°F" from one maker's Dutch oven page is not the cast iron column (batch 6): a quote naming a
      // product, brand or subtype ("Enameled…", "Lodge…") keeps the fact in its section's prose, out of the material's row.
      const allowed = new Set([...sideWords, ...wordsOf(fact.subject)]);
      const foreign = fact.quote.split(/\s+/).some((word) => {
        const clean = word.replace(/[^A-Za-z]+$/, "");
        return /^[A-Z][a-z]/.test(clean) && !QUOTE_COMMON.has(clean) && !allowed.has(clean.toLowerCase());
      });
      if (side < 0 || !id || foreign) continue;
      const own = sides.map((side, i) => wordsOf(side).filter((w) => !wordsOf(sides[1 - i]).includes(w)).join(" ")).filter(Boolean);
      const row = rows.get(id) ?? { label: [...sides, ...own].reduce((label, name) => withoutName(label, name), fact.label), cells: [undefined, undefined] };
      if (!row.cells[side]) row.cells[side] = fact;
      rows.set(id, row);
    }
    const both = [...rows.values()].filter((row) => row.cells[0] && row.cells[1] && row.label);
    if (both.length >= 2) {
      const value = (fact: Records["facts"][number]) => `${cell(fact.value).replace(/[.;,]+$/, "")}${cite(fact.source)}`;
      comparison = [`| | ${cell(sentenceCase(sides[0]))} | ${cell(sentenceCase(sides[1]))} |`, "| --- | --- | --- |",
        ...both.map((row) => `| ${cell(sentenceCase(row.label))} | ${value(row.cells[0]!)} | ${value(row.cells[1]!)} |`)].join("\n");
      for (const row of both) { tabled.add(row.cells[0]!); tabled.add(row.cells[1]!); }
      comparisonHeading = args.sections.find((s) => /\b(?:compar\w*|side by side|at a glance|key differences|differences|vs\.?|versus)\b/i.test(s) && !FAQ_HEADING.test(s)) ?? "At a glance";
    }
  }
  const faqHeading = args.sections.find((s) => FAQ_HEADING.test(s.trim())) ?? "Frequently asked questions";
  const listHeading = args.format === "list" ? args.sections.find((s) => LIST_HEADING.test(s) && !FAQ_HEADING.test(s))
    ?? args.sections.find((s) => LIST_HEADING_GUARD(s) && !/^(?:what|why|how)\b/i.test(s) && !FAQ_HEADING.test(s)) ?? "The options compared" : "";
  const introPool: ProseRecord[] = [];
  const listBlock = (): AssembledSection | null => {
    const options = [...args.records.options.filter((o) => !o.business), ...args.records.options.filter((o) => o.business)];
    if (!options.length) return null;
    const lines: string[] = [];
    const starting = new Map(options.map((o) => [o.name, [...o.prices].sort((a, b) => firstFigure(a.price) - firstFigure(b.price))[0]]));
    lines.push(`| Option | Starting price (as of ${asOf}) |`, "| --- | --- |");
    const cheapest = [...options].filter((o) => starting.get(o.name)).sort((a, b) => firstFigure(starting.get(a.name)!.price) - firstFigure(starting.get(b.name)!.price))[0];
    for (const o of [...(cheapest ? [cheapest] : []), ...options.filter((o) => o.business && starting.get(o.name))]) {
      const p = starting.get(o.name)!;
      if (introPool.length < 4 && !introPool.some((r) => r.label === o.name)) introPool.push(register(p, priceWithBilling(p.price, p.billing), p.source, o.name));
    }
    for (const o of options) {
      const p = starting.get(o.name);
      const plan = p && p.plan.trim() && !normal(p.price).includes(normal(p.plan)) ? ` (${cell(p.plan)}${/\bplan\b/i.test(p.plan) ? "" : " plan"})` : "";
      const price = p ? `${cell(priceWithBilling(p.price, p.billing))}${plan}${cite(p.source)}` : "No public price";
      lines.push(`| ${o.website ? `[${cell(o.name)}](${o.website})` : cell(o.name)} | ${price} |`);
    }
    for (const o of options) {
      const first = starting.get(o.name);
      lines.push("", `### ${o.name}`, "", `{{SUITS:${o.name}}}`, "");
      // P327 (Cowork item 3): one price per plan. When two sources give different figures for the same plan,
      // a single "sources differ" line carries both with their citations — never two values under one label.
      const byPlan = new Map<string, typeof o.prices>();
      for (const p of o.prices.filter((p) => p !== first)) {
        const pk = key(p.plan) || "price";
        byPlan.set(pk, [...(byPlan.get(pk) ?? []), p]);
      }
      const conflictLines: string[] = [];
      for (const [pk, group] of byPlan) {
        const distinct = [...new Set(group.map((p) => normal(p.price)))];
        if (distinct.length > 1) {
          const planName = sentenceCase(group[0].plan) || "Price";
          conflictLines.push(`- **${planName}:** sources differ — ${group.slice(0, 2).map((p) => `${priceWithBilling(p.price, p.billing)}${cite(p.source)}`).join("; ")}`);
          for (const p of group) register(p, priceWithBilling(p.price, p.billing), p.source, o.name);
        } else {
          const p = group[0];
          register(p, priceWithBilling(p.price, p.billing), p.source, o.name);
          conflictLines.push(`- **${sentenceCase(p.plan) || "Price"}:** ${priceWithBilling(p.price, p.billing)}${cite(p.source)}`);
        }
      }
      const bullets = [
        ...conflictLines,
        ...o.features.map((f) => `- ${sentenceCase(f.text)}${cite(f.source)}`),
        ...o.extras.map((f) => `- **${sentenceCase(withoutName(f.label, o.name) || f.label)}:** ${f.value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")}${cite(f.source)}`),
        ...o.limits.map((l) => `- **Limit:** ${l.text.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")}${cite(l.source)}`),
      ];
      lines.push(...bullets);
    }
    return { heading: listHeading, body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), options: options.map((o) => o.name), records: [] };
  };
  const listInOutline = args.sections.some((s) => s === listHeading);
  for (const heading of args.sections) {
    if (FAQ_HEADING.test(heading.trim())) continue;
    if (args.format === "list" && heading === listHeading) { const block = listBlock(); if (block) out.push(block); continue; }
    const facts = args.records.facts.filter((f) => f.section === heading && !tabled.has(f));
    const table = heading === comparisonHeading ? comparison : stepLists.get(heading) ?? "";
    const money = facts.filter((f) => MONEY.has(f.kind)), other = facts.filter((f) => !MONEY.has(f.kind));
    const lines: string[] = table ? [table, ""] : [];
    // P327 (Cowork items 1 and 2 of the batch-32 read): every section fact prints as a TABLE ROW — the bold
    // label line ("- **Subject: Label:** value") is gone entirely; a fact reaches prose only through a
    // placeholder. Money values carry the read date; every row names its source.
    if (money.length >= 2) {
      lines.push(`| Item (as of ${asOf}) | Amount | Source |`, "| --- | --- | --- |",
        ...money.map((f) => `| ${cell(sentenceCase(rowLabel(f, args.sources)))} | ${cell(proseDisplay(f.value))}${cite(f.source)} | ${f.source > 0 ? cell(publisher(args.sources[f.source - 1]?.url ?? "")) : "Our pricing"} |`), "");
      for (const f of money) register(f, proseDisplay(f.value), f.source, rowLabel(f, args.sources));
    }
    // P329 (Cowork): tables are for price lists and side-by-side comparisons only. A qualitative fact is a
    // prose record the model states through a placeholder; if the prose never states it, it does not print —
    // never a one-row table of quoted scraps.
    const records: ProseRecord[] = [];
    // The subject prefixes a fact whose label doesn't already start with it (batch 8 printed "Stone-coated steel:
    // Stone-coated steel cost per square").
    const factLabel = (f: Records["facts"][number]) => {
      const label = rowLabel(f, args.sources);
      const subject = f.subject.trim();
      return subject && !normal(f.value).includes(normal(subject).slice(0, 12)) && !normal(label).startsWith(normal(subject).slice(0, 10))
        ? `${subject}: ${label}` : label;
    };
    for (const f of [...(money.length >= 2 ? [] : money), ...other]) records.push(register(f, proseDisplay(f.value), f.source, factLabel(f)));
    // P313 (batch 16's bank and heat pump): a heading that promises a figure over only qualitative records
    // ("Adjust for bank fees, interest and errors" with no dollar anywhere) is an empty promise on the assembly
    // path too — the writer path drops these (withoutEmptyFigureSections); assembly must not print them.
    const figureRecorded = facts.some((f) => /\d/.test(f.value)) || records.some((r) => /\d/.test(r.value));
    if (/\b(?:costs?|prices?|pricing|fees?|rebates?|incentives?|tax credits?|how much|savings)\b/i.test(heading) && !figureRecorded) continue;
    if (!lines.length && !records.length) continue;
    if (out.length < 2) {
      introPool.push(...records.slice(0, 4));
      if (money.length >= 2) for (const f of money.slice(0, 2)) introPool.push({ id: idOf.get(f)!, label: rowLabel(f, args.sources), value: f.value, source: f.source });
    }
    out.push({ heading, body: lines.join("\n").trim(), options: [], records });
  }
  if (comparison && !args.sections.includes(comparisonHeading)) out.unshift({ heading: comparisonHeading, body: comparison, options: [], records: [] });
  if (stepList && !args.sections.includes(stepsHeading)) out.unshift({ heading: stepsHeading, body: stepList, options: [], records: [] });
  if (args.format === "list" && !listInOutline) {
    const block = listBlock();
    if (block) out.splice(Math.min(1, out.length), 0, block);
  }
  const faq = args.records.faqs.length ? { heading: faqHeading, options: [], records: [] as ProseRecord[],
    body: args.records.faqs.map((f) => `### ${f.question.trim()}\n\n${proseDisplay(f.answer.replace(/\s+/g, " ").trim()).replace(/[.!]?$/, (end) => `${cite(f.source)}${end || "."}`)}`).join("\n\n") } : null;
  return { sections: out, faq, asOf, intro: introPool.slice(0, 8), pool };
}
/** A table row's label: the fact's own label, with the owner's name out of it (the Source column says whose it is), and a
 * label that restates its value collapsed to the subject (batch 6: "Free roof inspections and written estimates, Summit Peak
 * Roofing" over the value "Free roof inspections and written estimates"). */
function rowLabel(fact: Records["facts"][number], sources: readonly AssemblySource[]): string {
  const owner = fact.source > 0 ? publisher(sources[fact.source - 1]?.url ?? "") : "";
  const stripped = owner ? withoutName(withoutName(fact.label, owner), owner.replace(/\./g, " ")) : fact.label;
  const label = sentenceCase(stripped || fact.subject || fact.label);
  return normal(label).includes(normal(fact.value).slice(0, 24)) && fact.value.length < 60 ? sentenceCase(fact.subject || fact.label.split(/\s+/).slice(0, 4).join(" ")) : label;
}

/** P307: the plan's figure items that no verified record carries. An item is satisfied where a fact's or an option
 * price's own words (label, value, quote) contain at least two of its distinctive terms — the same vocabulary rule
 * the pre-write lookups use, so a record either plainly answers the item or plainly doesn't. */
/** P330: an item is an AUTHORITY item only when its ASK is the program — the rebate, permit, credit or fee is
 * in the item's first clause. An item that buries "any rebates" inside a longer vendor-services sentence
 * ("Financing options from local roofers and lenders, and any rebates...") is a breadth ask; the authority
 * hold must not kill an article over a clause. */
export function authorityItem(item: string): boolean {
  const firstClause = item.split(/[,;—]/)[0] ?? item;
  // A hedged ask ("...if any apply to roofing", "any available programs") is a question about EXISTENCE: the
  // article's silence is its answer, exactly like a program the owner says ended — it never holds the article.
  if (/\b(?:if any|any available|whether any|whichever)\b/i.test(item)) return false;
  return /\b(?:permits?|rebates?|incentives?|tax credits?)\b/i.test(firstClause);
}

export function unsatisfiedFigureItems(coverage: readonly string[], records: VerifiedRecords, figureItem: RegExp, filler: Set<string>): string[] {
  const texts = [...records.facts.map((f) => `${f.label} ${f.value} ${f.quote}`),
    ...records.options.flatMap((o) => o.prices.map((p) => `${o.name} ${p.price} ${p.quote}`))];
  return coverage.filter((item) => {
    if (!figureItem.test(item)) return false;
    const terms = [...new Set((item.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !filler.has(w)))].slice(0, 6);
    return !texts.some((text) => { const t = text.toLowerCase(); return terms.filter((term) => t.includes(term)).length >= Math.min(2, terms.length); });
  });
}

export const ProseSchema = z.object({ title: z.string(), metaTitle: z.string(), metaDescription: z.string(), intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), paragraph: z.string() })).default([]),
  options: z.array(z.object({ name: z.string(), suits: z.string() })).default([]), conclusion: z.string() });
export type Prose = z.infer<typeof ProseSchema>;
export const PROSE_INPUT_SCHEMA: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false } = {
  type: "object", additionalProperties: false, required: ["title", "metaTitle", "metaDescription", "intro", "sections", "options", "conclusion"],
  // The conclusion comes last: strict output follows this order, and asked for first it was once written as "placeholder".
  properties: { title: str, metaTitle: str, metaDescription: str, intro: str,
    sections: { type: "array", items: { type: "object", additionalProperties: false, properties: { heading: str, paragraph: str }, required: ["heading", "paragraph"] } },
    options: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, suits: str }, required: ["name", "suits"] } },
    conclusion: str },
};

/** The one prose call (v3.1): the model writes the article's language with the facts as placeholders ({{r7}}) that code
 * fills with the record's value and citation. Batch 6's prose was forbidden every figure and name, so it could only write
 * about the page ("this block shows…"); the intro never answered the search. */
export function proseRequest(args: { search: string; productName: string; businessSummary: string; audience: string; profile: string;
  skeleton: Skeleton; records: VerifiedRecords; sources: readonly AssemblySource[] }): { system: string; userMessage: string } {
  const system = [
    "You write the prose of an article whose tables, prices and answers code has already placed from checked fact records. You write normal, readable paragraphs — and you finally may state the facts: every figure, price, percentage, date, plan name and product attribute in your paragraphs MUST be written as the placeholder shown, exactly like {{r7}}. Code replaces each placeholder with the fact and its citation, so never write a figure, price, year or percentage in your own words: use the placeholder.",
    "State each record in its own clause. Never join two records into a range or ladder of your own ('from {{r1}} to {{r2}}', 'between {{r1}} and {{r2}}'): a range exists only inside a record's own value. Each price gets its own clause with its own verb.",
    "Write: 'intro', 2-4 sentences that answer the search directly — state the headline facts from INTRO FACTS by placeholder in the first sentence or two — then say what the reader will find; for each section, 'paragraph', 2-4 sentences that give the section's substance in flowing prose, using that section's facts by placeholder (a table below already lists some facts: your paragraph explains and connects, it does not read the table aloud); for each option, 'suits', 1-2 sentences on who it suits, from its own facts by placeholder; 'conclusion', 2-4 sentences on how to decide between the options or approaches, then at most one sentence on what the business does, from its confirmed details; 'title' (under 65 characters, in the search's words, no number or year); 'metaTitle' (under 60); 'metaDescription' (under 155: what the reader gets).",
    "Use each fact at most once in the whole article (the headline fact at most twice); a fact code already printed in a table above may appear in your paragraph only when the table's number needs saying in the sentence. Name no company, product, program, agency or person except through a placeholder or one the section's records name (and the business itself in the conclusion). Never tell the reader to check, confirm, verify, ask, call, contact or get a quote or estimate. Never write about the article, its blocks, tables, records or data ('this section covers', 'the table below shows', 'use it to', 'below you'll find'): write about the subject. Plain words, second person, no hype.",
  ].join(" ");
  const recordLine = (r: ProseRecord) => {
    const record = args.skeleton.pool[r.id];
    const origin0 = r.source > 0 ? publisher(args.sources[r.source - 1]?.url ?? "") : args.productName;
    return `- {{${r.id}}} = ${record?.display ?? r.value}${origin0 ? ` (${origin0})` : ""}`;
  };
  const optionFacts = (name: string): string[] => {
    const o = args.records.options.find((x) => x.name === name);
    if (!o) return [];
    const own = Object.entries(args.skeleton.pool).filter(([, entry]) => entry.label === name);
    const prices = [...o.prices].sort((a, b) => firstFigure(a.price) - firstFigure(b.price));
    const lines = prices.slice(0, 2).map((p) => `${p.plan ? `${p.plan}: ` : ""}${priceWithBilling(p.price, p.billing)}`);
    return [`FACTS FOR ${name} (state any of these in 'suits' as its placeholder):`,
      ...own.map(([id, entry]) => `- {{${id}}} = ${entry.display}`),
      ...[...o.features.map((f) => f.text), ...o.extras.map((f) => `${f.label}: ${f.value}`), ...o.limits.map((l) => `not included: ${l.text}`)].slice(0, 5).map((t) => `- ${t}`),
      ...(lines.length ? [`plans: ${lines.join("; ")}`] : ["no public price"])];
  };
  const userMessage = [
    `SEARCH: ${args.search}`,
    `BUSINESS: ${args.productName}: ${args.businessSummary}`.slice(0, 600),
    args.audience ? `READERS: ${args.audience}`.slice(0, 400) : "",
    `BUSINESS CONFIRMED DETAILS:\n${args.profile.slice(0, 1500)}`,
    args.skeleton.intro.length ? `INTRO FACTS (placeholders the intro may use):\n${args.skeleton.intro.map((r) => recordLine(r)).join("\n")}` : "",
    "THE ARTICLE AS CODE BUILT IT (read-only except the WRITE markers):",
    "[WRITE intro]",
    ...args.skeleton.sections.flatMap((section) => {
      const facts = section.records.length ? [`FACTS FOR THIS SECTION (write each as its placeholder):\n${section.records.map((r) => recordLine(r)).join("\n")}`] : [];
      const options = section.options.flatMap((name) => optionFacts(name));
      return [[`## ${section.heading}`], `[WRITE paragraph for "${section.heading}"]`, ...facts, ...options,
        section.body.replace(/\{\{SUITS:([^}]+)\}\}/g, (_m, name: string) => `[WRITE suits for "${name}"]`)].filter((x) => x !== "").join("\n\n");
    }),
    "[WRITE conclusion]",
    args.skeleton.faq ? `## ${args.skeleton.faq.heading}\n\n${args.skeleton.faq.body}` : "",
  ].filter(Boolean).join("\n\n");
  return { system, userMessage: userMessage.replace(/\n{3,}/g, "\n\n") };
}

const HOMEWORK = /\b(?:check|confirm|verify|ask|call|contact|consult|request|get)\b[^.!?]{0,40}\b(?:quotes?|estimates?|providers?|vendors?|installers?|contractors?|plumbers?|roofers?|city|county|utility|utilities|pricing pages?|websites?|sites?|sales teams?|support)\b/i;
/** Prose about the article's own making ("the records give no price", "the data shows") is not for readers. */
// P327 (Cowork's batch-32 read): a counted phrase is meta-talk only in its "list promises" shape — "six things
// to consider below", "3 points". A plain count in a real sentence ("six options compare", "plans start at
// three tiers") is normal writing; dropping every paragraph containing one is why batch 32's yoga lost its
// intro and opened on a heading.
const COUNTED = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:things|items|points|steps|ways|tips|reasons|factors|considerations|takeaways?|examples?)\b|\b(?:things|items|points|steps|ways|tips|reasons|factors)\s+to\s+(?:consider|compare|know|cover)\b/i;
/** v3.1 (batch 6): the meta lead-ins the model wrote because the old prompt asked for them. */
const MAKING = /\b(?:records?|the data|our data|data (?:given|shown|provided|here)|(?:these|the|our) sources?|excerpts?|not (?:listed|given|shown|stated) here|no (?:price|pricing|figure)s? (?:is |are )?(?:given|listed|shown|stated|published)|hard(?:er)? to judge|this (?:block|table|section|article|list|guide)|this (?:guide|article|post) covers?|the (?:table|list|block|item|items|point|points|note) below|below you(?:'?ll| will) find|use it to)\b/i;
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

const PLACEHOLDER = /\{\{(r\d+)\}\}/g;
/** P305 (batch 9, roof): a record's prose display is its value normalized, never its evidence wording. "$4 and $11" is the
 * range "$4–$11"; a space before a range dash goes; digits are only ever reformatted, never new — a normalization whose
 * numbers are not all in the value falls back to the trimmed value. */
export function proseDisplay(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "");
  // A range normalizes to an en dash only where the wording says range: "X to Y" always, "between X and Y",
  // or a unit directly after the second number ("$4 and $11 per square foot"). "$400 and $650 rebate tiers"
  // is two separate amounts, not a range, and stays as written (P307).
  // P311: the dash form keeps the currency on BOTH numbers ("$1,187–$3,491"): the reader check canonicalizes
  // "$3,491" and "3,491" as different numbers, and the excerpt writes "$1,187 and $3,491".
  const dash = (_m: string, c1: string, n1: string, c2: string, n2: string) => `${c1}${n1}–${c2 || c1}${n2}`;
  let out = trimmed
    .replace(/([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)\s+to\s+([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)/g, dash)
    .replace(/between\s+([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)\s+and\s+([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)/gi, dash)
    .replace(/([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)\s+and\s+([€£$]?)\s?(\d[\d,]*(?:\.\d+)?)(?=\s+(?:per|a|an|each)\s+\w)/g, dash);
  out = out.replace(/\s+([–—])/g, "$1");
  const digits = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]).join(" ");
  const had = new Set(digits(trimmed).split(" "));
  return digits(out).split(" ").every((d) => had.has(d)) ? out : trimmed;
}
/** Content words (≥4 letters) a fill and its sentence would both carry, EXCLUDING the topic's own words:
 * "ceramic" appears in every sentence and every value of a ceramic-vs-cast-iron article — it is the subject,
 * not a repetition (P331: batch 38's intro died on exactly this). */
const overlapWords = (a: string, b: string, topicWords?: ReadonlySet<string>) => {
  const words = (s: string) => new Set([...s.toLowerCase().matchAll(/[a-z][a-z'-]{3,}/g)].map((m) => m[0]).filter((w) => !topicWords?.has(w)));
  const other = words(b);
  return [...words(a)].filter((w) => other.has(w));
};
/** v3.1: one prose paragraph with placeholders. The unit of deletion is the whole paragraph (batch 6's rule): a paragraph
 * that states a raw figure, references an unknown record, overuses a fact, names something its records don't, or talks
 * about the article is dropped whole and its facts fall back to the section's data block. P305: a record is stated in
 * prose at most once (batch 9's roof article printed the same record sentence in two sections — the used map was cleared
 * after every paragraph, so it never accumulated), and a value that repeats the sentence's own words is a paragraph
 * defect (its parenthetical aside goes first). */
export function proseParagraphs(text: string, args: { pool: Record<string, { display: string; source: number; label?: string }>; scope: readonly ProseRecord[];
  used: Map<string, number>; allowedText: string; limit?: number; topicWords?: ReadonlySet<string> }): { kept: string; dropped: string[] } {
  const paragraph = text.replace(/\s+/g, " ").trim();
  if (!paragraph || /^\W*(?:placeholder|tbd|todo|to be written|n\/a|none|lorem ipsum)\W*$/i.test(paragraph) || paragraph.split(/\s+/).length < 3) {
    return { kept: "", dropped: paragraph ? [paragraph] : [] };
  }
  const ids = [...paragraph.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const dropped: string[] = [];
  const bad = (why: string) => { dropped.push(`${paragraph.slice(0, 120)} (${why})`); return { kept: "", dropped }; };
  if (ids.some((id) => !args.pool[id])) return bad("a placeholder with no record");
  const bare = paragraph.replace(PLACEHOLDER, " ");
  if (statedNumbers(bare).length) return bad("a figure written in its own words");
  for (const sentence of paragraph.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)) {
    const plain = sentence.replace(/\*\*|__|`/g, "");
    if (DEFLECTION.test(plain) || HOMEWORK.test(plain) || MAKING.test(plain) || COUNTED.test(plain) || /https?:\/\/|www\.|\.example\b/i.test(plain)) {
      return bad("prose about the article or a reader sent elsewhere");
    }
  }
  if (namedEntities(bare).some((name) => key(name).length >= 3 && !mentions(args.allowedText, name))) return bad("a name its records don't give");
  const limit = args.limit ?? 1;
  if (ids.some((id) => (args.used.get(id) ?? 0) >= limit)) return bad("a fact stated already");
  // The fills, normalized and checked against the sentence around them (P305).
  const fills: { match: RegExpMatchArray; text: string }[] = [];
  for (const match of [...paragraph.matchAll(PLACEHOLDER)]) {
    const record = args.pool[match[1]]!;
    let display = proseDisplay(record.display);
    const aside = /\s*\(([^)]*)\)/.exec(display);
    if (aside && overlapWords(aside[1], bare, args.topicWords).length >= 2) display = proseDisplay(display.replace(aside[0], ""));
    if (overlapWords(display, bare, args.topicWords).length >= 2) return bad("a value repeating the sentence's words");
    fills.push({ match, text: display });
  }
  // Fill each placeholder with its value and citation, walking the original text with a cursor (replacement lengths
  // shift later indices); a value landing mid-sentence or after a colon reads as prose ("… deals with automated
  // waitlists…", "pattern: almost always full tear-offs"), so its first letter follows the sentence's case.
  let filled = "", cursor = 0;
  for (const { match, text: display } of fills) {
    const record = args.pool[match[1]]!;
    const at = match.index ?? 0;
    // The model writes "between {{r5}}" around a record that is itself "$2,500 and $10,000": fold the two into
    // one dashed range instead of leaving "between $2,500 and $10,000" (P307, batch 11's heat pump and roof).
    let text = display, cut = at;
    const between = /\bbetween\s+$/i.exec(paragraph.slice(Math.max(0, cursor), at));
    const amounts = /^([$€£]?\s?\d[\d,]*(?:\.\d+)?)\s+and\s+[$€£]?\s?(\d[\d,]*(?:\.\d+)?)$/.exec(display);
    const dashed = /^[€£$]?\s?\d[\d,]*(?:\.\d+)?–[€£$]?\s?\d[\d,]*(?:\.\d+)?$/.test(display);
    if (between && amounts) { const cur = /^[$€£]/.exec(amounts[1])?.[0] ?? ""; text = `${amounts[1]}–${cur}${amounts[2]}`; cut = at - between[0].length; }
    else if (between && dashed) { cut = at - between[0].length; }
    const before = paragraph.slice(0, cut).replace(/[\s(\[]+$/, "");
    const follow = before.length > 0 && /[a-z,;:]$/.test(before) && /^[A-Z][a-z]/.test(text)
      ? text.charAt(0).toLowerCase() + text.slice(1) : text;
    filled += paragraph.slice(cursor, cut) + `${follow}${cite(record.source)}`;
    cursor = at + match[0].length;
  }
  const kept = filled + paragraph.slice(cursor);
  for (const id of ids) args.used.set(id, (args.used.get(id) ?? 0) + 1);
  return { kept: kept.replace(/\s+([,.;:])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s{2,}/g, " ").trim(), dropped: [] };
}

/** The article: intro, each section's paragraph over its block, the conclusion with the business's next step, the FAQ last.
 * A section fact its paragraph never stated falls back to one line in the block (never a "label: quote" dump). */
export function assembledArticle(args: { skeleton: Skeleton; prose: Prose; records: VerifiedRecords; productName: string; profile: string;
  search: string; cta: { label: string; url: string } }): { markdown: string; dropped: string[]; heldIntro: boolean; introDropped: string[] } {
  const dropped: string[] = [];
  const recordText = (records: { quote: string }[], more: string[] = []) => [...records.map((r) => r.quote), ...more].join("\n");
  const everything = recordText([...args.records.facts, ...args.records.faqs, ...args.records.options.flatMap((o) => [...o.prices, ...o.features, ...o.limits, ...o.extras])],
    [...args.records.options.map((o) => o.name), ...args.records.facts.map((f) => `${f.label} ${f.subject}`), args.productName, args.profile, args.search,
      ...args.skeleton.sections.map((s) => s.heading)]);
  const used = new Map<string, number>();
  const pool = args.skeleton.pool;
  const parts: string[] = [];
  const topicWords = new Set((args.search.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []));
  const intro = proseParagraphs(args.prose.intro, { pool, scope: args.skeleton.intro, used, allowedText: everything, topicWords });
  const introDropped = [...intro.dropped];
  dropped.push(...intro.dropped);
  if (intro.kept) parts.push(intro.kept);
  // P329 (Cowork's read of the final five): there is NO machine-written intro. When the prose intro fails its
  // checks, heldIntro marks the article and the pipeline holds it — a broken glue sentence never prints.
  for (const section of args.skeleton.sections) {
    const facts = args.records.facts.filter((f) => f.section === section.heading);
    const options = args.records.options.filter((o) => section.options.includes(o.name));
    const local = recordText([...facts, ...options.flatMap((o) => [...o.prices, ...o.features, ...o.limits, ...o.extras])],
      [...options.map((o) => o.name), ...facts.map((f) => `${f.label} ${f.subject}`), args.productName, args.search, section.heading]);
    const paragraph = proseParagraphs(args.prose.sections.find((s) => s.heading.trim().toLowerCase() === section.heading.toLowerCase())?.paragraph ?? "",
      { pool, scope: section.records, used, allowedText: local, topicWords });
    dropped.push(...paragraph.dropped);
    // P327: facts the paragraph never state live in the section's table (built in skeletonFor) — no label lines.
    const body = section.body.replace(/\{\{SUITS:([^}]+)\}\}\n*/g, (_m, name: string) => {
      const option = options.find((o) => o.name === name);
      const ownPool: typeof pool = {};
      if (option) for (const [id, entry] of Object.entries(pool)) if (entry.label === option.name) ownPool[id] = entry;
      const ownScope: ProseRecord[] = Object.entries(ownPool).map(([id, entry]) => ({ id, label: entry.label, value: entry.display, source: entry.source }));
      const suits = option ? proseParagraphs(args.prose.options.find((o) => key(o.name) === key(name))?.suits ?? "",
        { pool: ownPool, scope: ownScope, used, allowedText: recordText([...option.prices, ...option.features, ...option.limits, ...option.extras], [option.name, args.productName, args.search, option.business ? args.profile : ""]) }) : { kept: "", dropped: [] as string[] };
      dropped.push(...suits.dropped);
      return suits.kept ? `${suits.kept}\n\n` : "";
    });
    // A heading with nothing left under it (its one record went to the intro, its table never formed) never prints.
    if (paragraph.kept || body.trim()) parts.push(`## ${section.heading}`, ...(paragraph.kept ? [paragraph.kept] : []), ...(body.trim() ? [body] : []));
  }
  const conclusion = keptProse(args.prose.conclusion, { allowedText: everything });
  dropped.push(...conclusion.dropped);
  parts.push("## The bottom line", ...(conclusion.kept ? [conclusion.kept] : []), `[${args.cta.label}](${args.cta.url})`);
  if (args.skeleton.faq) parts.push(`## ${args.skeleton.faq.heading}`, args.skeleton.faq.body);
  const heldIntro = !intro.kept && args.skeleton.intro.length > 0;
  return { markdown: parts.filter((p) => p !== "").join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), dropped, heldIntro, introDropped };
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
