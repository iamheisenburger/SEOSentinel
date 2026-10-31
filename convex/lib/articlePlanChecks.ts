/** P260 (Oct 31 2026): Arshad's fixed article plan (ops/ARTICLE-PLAN-V1.md). A draft is checked with code, never AI judgement:
 * every number appears in the fact sheet (or the confirmed business profile), product facts match the confirmed
 * profile, no person or company appears that the sources, the profile or the search don't name, every outline section
 * is present, and the format's required elements are present. A failed check gets at most one targeted fix; then the
 * draft goes to its owner with the flagged lines marked. No scores, no regenerate loops. */

export type PlanFormat = "list" | "tutorial" | "how-to" | "guide" | "comparison";
export type FactSheet = { sources: { url: string; title?: string; text: string }[]; profile: string; productName: string };
export type ArticleOutline = { format: PlanFormat; sections: string[]; minItems?: number };
export type PlanCheckFailure = { check: "number" | "product" | "name" | "section" | "format"; line?: string; detail: string };

const SOURCES_HEADING = /^#{2,3}\s+(?:Sources|References|Related reading)\s*$/im;
/** Article prose: no code (blocks or inline), no headings, no Sources section, no link targets. */
function prose(markdown: string): string {
  return markdown.split(SOURCES_HEADING)[0]
    .replace(/^```[\s\S]*?^```\s*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    // A citation link ("[1](url)") is a marker, not a number; any other link reads as its text.
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]\([^)\n]*\)/g, " ")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    // List and table markers and emphasis are layout, not words: "2." alone is not a claim, and "**Tip.** Tell" starts a sentence.
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/\*\*|__|(?<![\w*])[*_](?=\S)|(?<=\S)[*_](?![\w*])/g, "")
    .replace(/\s*\|\s*/g, ". ");
}
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?:])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0 && /[A-Za-z]/.test(s));
}
const normalize = (value: string) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/** The numbers a sentence states, as digits (list and step numbering, citation markers and ordinals in headings are not
 * claims). "40 %", "40%" and "40 percent" are one number; "$1,200" and "1200" too. */
export function statedNumbers(sentence: string): string[] {
  const text = sentence.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ").replace(/\bstep\s+\d+\b/gi, " ");
  return [...new Set([...text.matchAll(/(?<![\w.])\$?\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/[$,]/g, "")).filter((n) => n !== ""))];
}
function numberStated(number: string, haystack: string): boolean {
  const digits = number.replace(/\.0+$/, "");
  return new RegExp(`(?<![\\d.])${digits.replace(/\./g, "\\.")}(?![\\d])`).test(haystack.replace(/(\d),(\d{3})/g, "$1$2"));
}

export function numbersOutsideFactSheet(markdown: string, sheet: FactSheet): PlanCheckFailure[] {
  const haystack = [...sheet.sources.map((s) => s.text), sheet.profile].join("\n");
  const failures: PlanCheckFailure[] = [];
  for (const sentence of sentences(prose(markdown))) {
    const missing = statedNumbers(sentence).filter((n) => !numberStated(n, haystack));
    if (missing.length) failures.push({ check: "number", line: sentence, detail: `${missing.join(", ")} is not in the fact sheet or your confirmed details` });
  }
  return failures;
}

/** Sentences about the business's own product: every number must be in the confirmed profile. */
export function productFactsOutsideProfile(markdown: string, sheet: FactSheet): PlanCheckFailure[] {
  const name = sheet.productName.trim();
  if (name.length < 2) return [];
  const named = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const failures: PlanCheckFailure[] = [];
  for (const sentence of sentences(prose(markdown))) {
    if (!named.test(sentence)) continue;
    const missing = statedNumbers(sentence).filter((n) => !numberStated(n, sheet.profile));
    if (missing.length) failures.push({ check: "product", line: sentence, detail: `${missing.join(", ")} about ${name} is not in your confirmed details` });
  }
  return failures;
}

/** Capitalised words a reader takes for a person, company or product. Sentence-initial words, headings, common
 * capitalised words and everyday technical names are not counted. */
const COMMON = new Set(("I A An The This That These Those It Its If In On At For To Of And Or But With Without When While Where What Which Who Why How " +
  "Your You We Our Their They He She His Her Each Every Some Any All Most Many More Less Use Using Step Steps Note Tip Example Examples " +
  "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
  "US USA UK EU UAE API APIs URL URLs HTML CSS JSON XML PDF CSV SEO AI FAQ FAQs SaaS CRM CMS HTTP HTTPS SQL ID IDs VAT GST IRS HMRC Q A B C").split(/\s+/));
export function namesOutsideSources(markdown: string, sheet: FactSheet, allowed: readonly string[] = []): PlanCheckFailure[] {
  const known = normalize([...sheet.sources.flatMap((s) => [s.text, s.title ?? "", (() => { try { return new URL(s.url).hostname; } catch { return ""; } })()]),
    sheet.profile, sheet.productName, ...allowed].join("\n"));
  const failures: PlanCheckFailure[] = [];
  for (const sentence of sentences(prose(markdown))) {
    // A word after an opening quote or bracket starts a phrase, like the sentence's first word.
    const [first, ...rest] = sentence.split(/\s+/);
    // A sentence's first word is capitalised anyway; it counts as a name only when it looks like a brand
    // ("QuickBooks", "HubSpot", "Next.js").
    const lead = (first ?? "").replace(/^[^A-Za-z]+|[^A-Za-z0-9]+$/g, "");
    const words = [...(/^[A-Z][a-z0-9]+[A-Z]|^[A-Z][A-Za-z0-9]*\.[a-z]/.test(lead) ? [lead] : []), ...rest.filter((w) => !/^["“'‘(\[]/.test(w))];
    // A name ending a sentence or a link ("Doe.", "Doe],") is still a name.
    const names = [...new Set(words.map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z0-9]+$/g, ""))
      .filter((w) => /^[A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*$/.test(w) && w.length > 1 && !COMMON.has(w)))];
    const unknown = names.filter((n) => !known.includes(n.toLowerCase()));
    if (unknown.length) failures.push({ check: "name", line: sentence, detail: `${unknown.join(", ")} is not named in the sources or your details` });
  }
  return failures;
}

const headingKey = (value: string) => normalize(value).replace(/^#+\s*/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function missingOutlineSections(markdown: string, outline: ArticleOutline): PlanCheckFailure[] {
  const present = new Set([...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => headingKey(m[1])));
  return outline.sections.filter((s) => !present.has(headingKey(s)))
    .map((s) => ({ check: "section" as const, detail: `The outline's section "${s}" is missing` }));
}

export function missingFormatElements(markdown: string, outline: ArticleOutline): PlanCheckFailure[] {
  const body = markdown.split(SOURCES_HEADING)[0];
  const failures: PlanCheckFailure[] = [];
  if (outline.format === "tutorial" && !/^```/m.test(body)) failures.push({ check: "format", detail: "A tutorial needs at least one code, command or settings block" });
  if ((outline.format === "tutorial" || outline.format === "how-to") && !/^\s*1[.)]\s+\S/m.test(body) && !/^#{2,3}\s+Step\s+1\b/im.test(body)) {
    failures.push({ check: "format", detail: "Step-by-step instructions need numbered steps" });
  }
  if (outline.format === "list") {
    const items = [...body.matchAll(/^###\s+\S/gm)].length || [...body.matchAll(/^\s*\d+[.)]\s+\S/gm)].length;
    const needed = outline.minItems ?? 5;
    if (items < needed) failures.push({ check: "format", detail: `A list needs at least ${needed} items (it has ${items})` });
  }
  if (outline.format === "comparison" && !/^\|.*\|\s*\n\|\s*:?-{3,}/m.test(body)) {
    failures.push({ check: "format", detail: "A comparison needs a side-by-side table" });
  }
  return failures;
}

export function runPlanChecks(markdown: string, sheet: FactSheet, outline: ArticleOutline, allowedNames: readonly string[] = []): PlanCheckFailure[] {
  return [
    ...numbersOutsideFactSheet(markdown, sheet),
    ...productFactsOutsideProfile(markdown, sheet),
    ...namesOutsideSources(markdown, sheet, allowedNames),
    ...missingOutlineSections(markdown, outline),
    ...missingFormatElements(markdown, outline),
  ];
}

/** The lines a failed check points at, for the owner's marked draft ("Unverified claim: «…»", as the fact check wrote them). */
export function flaggedLines(failures: readonly PlanCheckFailure[]): string[] {
  return [...new Set(failures.map((f) => f.line?.trim()).filter((line): line is string => Boolean(line && line.length >= 12)))];
}
/** One plain issue per failed check, for the publication gate (blocking) and the owner's "Before you publish" box. */
export function planCheckIssues(failures: readonly PlanCheckFailure[]): string[] {
  const count = (check: PlanCheckFailure["check"]) => failures.filter((f) => f.check === check).length;
  return [
    count("number") ? `Plan check: ${count("number")} sentence(s) state a number that is not in the fact sheet or the confirmed details.` : "",
    count("product") ? `Plan check: ${count("product")} sentence(s) state a product fact that is not in the confirmed details.` : "",
    count("name") ? `Plan check: ${count("name")} sentence(s) name a person or company the sources and details don't.` : "",
    ...failures.filter((f) => f.check === "section" || f.check === "format").map((f) => `Plan check: ${f.detail}.`),
  ].filter(Boolean);
}

/** The writer's outline: the sections in order with their exact headings, and the format's required elements. */
export function articleOutlinePrompt(plan: { format: PlanFormat; sections: string[]; minItems?: number }, covers: ReadonlyMap<string, string>): string {
  const formatRule = {
    list: `FORMAT: a list. In the section that holds the list, give at least ${plan.minItems ?? 5} named options, each as an H3 (### Name) saying what it is, who it suits and the specifics its own page in the fact sheet gives.`,
    tutorial: "FORMAT: a tutorial. Give numbered steps (1., 2., 3.) and at least one fenced code, command or settings block taken from the official documentation in the fact sheet; never invent an API, option or command.",
    "how-to": "FORMAT: step by step. Give the steps as a numbered list (1., 2., 3.).",
    comparison: "FORMAT: a comparison. Include a markdown table comparing the options side by side, then say which suits whom.",
    guide: "FORMAT: a guide. Answer the search in the first paragraph, then follow the sections.",
  }[plan.format];
  return [
    "OUTLINE (the fixed plan, built from Google's top results for this search: follow it exactly):",
    "Open with one short paragraph that answers the search directly. Then write these H2 sections, in this order, with exactly these headings:",
    ...plan.sections.map((heading) => `## ${heading}${covers.get(heading) ? ` (covers: ${covers.get(heading)})` : ""}`),
    "Add no other H2 section, except a Sources section when you cite sources.",
    formatRule,
  ].join("\n");
}
