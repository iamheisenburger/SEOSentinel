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
const CODE_BLOCK = /^[ \t]{0,6}```[\s\S]*?^[ \t]{0,6}```[ \t]*$/gm;
const HAS_CODE = /^[ \t]{0,6}```/m;
/** Article prose: no code (blocks or inline), no headings, no Sources section, no link targets. */
function prose(markdown: string): string {
  return markdown.split(SOURCES_HEADING)[0]
    // P268: a fence indented inside a numbered step is code too (batch 2's tutorial: its JSON output read as claims).
    .replace(CODE_BLOCK, " ")
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
  // P267 (Oct 31 2026): a day of the month ("on the 29th") and a clock time ("9:00 a.m.") are not claims: the live
  // trial's how-to drew a finding for "A check you wrote on the 29th that clears on the 3rd is outstanding on the 31st."
  const text = sentence.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ").replace(/\bstep\s+\d+\b/gi, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return [...new Set([...text.matchAll(/(?<![\w.])\$?\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/[$,]/g, "")).filter((n) => n !== ""))];
}
function numberStated(number: string, haystack: string): boolean {
  const digits = number.replace(/\.0+$/, "");
  return new RegExp(`(?<![\\d.])${digits.replace(/\./g, "\\.")}(?![\\d])`).test(haystack.replace(/(\d),(\d{3})/g, "$1$2"));
}

/** P264 (Oct 31 2026): a worked example's illustrative amounts need no source (they must add up). Cowork judged the
 * how-to's example "stops halfway"; the next draft renamed it a "worked template" with no amounts at all, because every
 * number had to come from a source. A section headed as an example (H2 or H3) is exempt from the number check; real
 * statistics elsewhere still need their source, and product facts their confirmed details. */
export const EXAMPLE_HEADING = /\b(?:worked\s+)?examples?\b|\bsample\b|\bscenarios?\b|\billustrat/i;
export function exampleSections(markdown: string): string[] {
  const lines = markdown.split("\n"), sections: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = /^(#{2,3})\s+(.+)$/.exec(lines[i]);
    if (!heading || !EXAMPLE_HEADING.test(heading[2])) continue;
    const level = heading[1].length, body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = /^(#{1,6})\s/.exec(lines[j]);
      if (next && next[1].length <= level) break;
      body.push(lines[j]);
    }
    sections.push(body.join("\n"));
  }
  return sections;
}
function withoutExampleSections(markdown: string): string {
  return exampleSections(markdown).reduce((text, body) => body.trim() ? text.replace(body, "\n") : text, markdown);
}

/** P266 (Oct 31 2026): the worked example's amounts, wherever the article reuses them. The live trial's how-to drew 10
 * findings, all of them its example's own amounts reused after it ("Debit Bank Fees Expense $35.00", "In the example
 * above, $540.00 versus $450.00 is a $90.00 difference, and 90 ÷ 9 = 10"); the one fix then turned the whole example into
 * letters. Arshad's rule is about made-up statistics, not illustrations. Only amounts count (10 or more, or with
 * decimals), and a percentage is never illustrative. */
export function illustrativeNumbers(markdown: string): Set<number> {
  const values = new Set<number>();
  for (const body of exampleSections(markdown)) {
    for (const sentence of sentences(prose(body))) {
      for (const n of statedNumbers(sentence)) {
        const value = Number.parseFloat(n);
        if (Number.isFinite(value) && (value >= 10 || n.includes("."))) values.add(value);
      }
    }
  }
  return values;
}
const REFERS_TO_EXAMPLE = /\b(?:in|from|of|for)\s+(?:the|this|our|that)\s+(?:worked\s+)?example\b|\bexample\s+(?:above|below)\b/i;
const ARITHMETIC = /\d[\d,.]*\s*[÷×*/+−–-]\s*\$?\d[\d,.]*\s*=\s*\$?\d/;
const statedAsPercent = (sentence: string, n: string) =>
  new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?:\\.0+)?\\s*(?:%|percent)`).test(sentence.replace(/(\d),(\d{3})/g, "$1$2"));

export function numbersOutsideFactSheet(markdown: string, sheet: FactSheet, illustrative: ReadonlySet<number> = illustrativeNumbers(markdown)): PlanCheckFailure[] {
  const haystack = [...sheet.sources.map((s) => s.text), sheet.profile].join("\n");
  const failures: PlanCheckFailure[] = [];
  const example = (sentence: string, n: string) => illustrative.has(Number.parseFloat(n)) && !statedAsPercent(sentence, n);
  for (const sentence of sentences(prose(withoutExampleSections(markdown)))) {
    // A sentence about the example, or its arithmetic, that uses the example's amounts is part of the illustration.
    if ((REFERS_TO_EXAMPLE.test(sentence) || ARITHMETIC.test(sentence)) && statedNumbers(sentence).some((n) => example(sentence, n))) continue;
    const missing = statedNumbers(sentence).filter((n) => !numberStated(n, haystack) && !example(sentence, n));
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

/** P261 (Oct 31 2026): a person or a company the article attributes something to, or names as an organisation: "according
 * to Jane Doe", "Jane Doe said", "Dr. Lee", "Brightway Labs Inc.". Arshad's rule is about invented people, quotes and
 * companies; every capitalised word was too wide (the live trial flagged "United States", "ESM", and the logging libraries
 * a Pino tutorial compared). */
const NAME = String.raw`[A-Z][a-zA-Z'’.-]+(?:\s+(?:de|van|von|da|del|la|le|[A-Z][a-zA-Z'’.-]+)){0,3}`;
const ATTRIBUTION = [
  new RegExp(String.raw`\b[Aa]ccording to (${NAME})`, "g"),
  new RegExp(String.raw`(?:^|[.;:!?]\s+|,\s+|\s)(${NAME}),?\s+(?:said|says|told|wrote|writes|explains|explained|notes|noted|recommends|recommended|argues|argued|adds|added|warns|warned)\b`, "g"),
  new RegExp(String.raw`\b(?:said|says|wrote|writes|explains|added|adds)\s+(${NAME})`, "g"),
  new RegExp(String.raw`\b(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+(${NAME})`, "g"),
];
const ORGANISATION = new RegExp(String.raw`\b((?:[A-Z][\w&'’.-]*\s+){1,4}(?:Inc|LLC|Ltd|Corp|Corporation|Company|Group|Agency|Foundation|Institute|Association|Labs|Partners|Consulting)\b\.?)`, "g");
const NOT_A_NAME = /^(?:The|This|That|These|Those|It|Its|Your|You|We|Our|They|Their|He|She|A|An|Each|Every|Some|Most|Many|Research|Studies|Data|Experts?|Analysts?|Google|Users?|Customers?|Owners?|Teams?)$/;
export function namesOutsideSources(markdown: string, sheet: FactSheet, allowed: readonly string[] = []): PlanCheckFailure[] {
  const known = normalize([...sheet.sources.flatMap((s) => [s.text, s.title ?? "", (() => { try { return new URL(s.url).hostname; } catch { return ""; } })()]),
    sheet.profile, sheet.productName, ...allowed].join("\n"));
  const failures: PlanCheckFailure[] = [];
  for (const sentence of sentences(prose(markdown))) {
    const names = new Set<string>();
    for (const pattern of ATTRIBUTION) for (const m of sentence.matchAll(pattern)) names.add(m[1].trim().replace(/[.,]+$/, ""));
    for (const m of sentence.matchAll(ORGANISATION)) names.add(m[1].trim().replace(/[.,]+$/, ""));
    const unknown = [...names].filter((name) => !NOT_A_NAME.test(name.split(/\s+/)[0]) &&
      !name.split(/\s+/).filter((word) => /^[A-Z]/.test(word) && !/^(?:Inc|LLC|Ltd|Corp|Corporation|Company|Group|Agency|Foundation|Institute|Association|Labs|Partners|Consulting)\.?$/.test(word))
        .every((word) => known.includes(word.toLowerCase().replace(/[.,'’]+$/, ""))));
    if (unknown.length) failures.push({ check: "name", line: sentence, detail: `${unknown.join(", ")} is not named in the sources or your details` });
  }
  return failures;
}

const headingKey = (value: string) => normalize(value).replace(/^#+\s*/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const significant = (value: string) => headingKey(value).split(" ").filter((word) => word.length >= 3 &&
  !/^(?:the|and|for|with|how|what|why|your|you|are|its|our|from|into|that|this)$/.test(word));
/** P264: a section counts as present under a heading that keeps most of the planned heading's words (the writer's
 * "Worked template for a reconciliation" for "Worked example of a reconciliation"). */
export function missingOutlineSections(markdown: string, outline: ArticleOutline): PlanCheckFailure[] {
  const written = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const present = (planned: string) => written.some((heading) => {
    if (headingKey(heading) === headingKey(planned)) return true;
    const want = significant(planned), have = new Set(significant(heading));
    return want.length >= 2 && want.filter((word) => have.has(word)).length / want.length >= 0.6;
  });
  return outline.sections.filter((s) => !present(s))
    .map((s) => ({ check: "section" as const, detail: `The outline's section "${s}" is missing` }));
}

export function missingFormatElements(markdown: string, outline: ArticleOutline): PlanCheckFailure[] {
  const body = markdown.split(SOURCES_HEADING)[0];
  const failures: PlanCheckFailure[] = [];
  if (outline.format === "tutorial" && !HAS_CODE.test(body)) failures.push({ check: "format", detail: "A tutorial needs at least one code, command or settings block" });
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

/** P268 (Oct 31 2026): what Cowork failed batch 2 for that code can find, for the one fix (never a gate: it never holds a
 * draft): a passage said again ("a human mistake, a bank issue, or fraud" 3 times, the gas line and flue caveat about 7),
 * a reader sent elsewhere for an answer ("ask your plumber", "check the manufacturer"), a tutorial step without code, and
 * a list short of its options. */
export type FixFinding = { kind: "repetition" | "deflection" | "code" | "options"; line?: string; detail: string };

const FAQ_HEADING = /^#{2,3}\s+(?:frequently asked questions|faqs?|common questions)\b.*$/im;
/** The article's own sentences, without its FAQ, tables, code and Sources (an FAQ may sum up; a table restates by design). */
function bodySentences(markdown: string): string[] {
  let body = markdown.split(SOURCES_HEADING)[0];
  const faq = FAQ_HEADING.exec(body);
  if (faq) {
    const after = body.slice(faq.index + faq[0].length);
    const next = /^##\s+\S/m.exec(after);
    body = body.slice(0, faq.index) + (next ? after.slice(next.index) : "");
  }
  return sentences(prose(body.replace(CODE_BLOCK, " ").replace(/^\s*\|.*$/gm, " ")));
}
const FILLER = new Set(("a an the and or but if of to in on for with at by from as is are was were be been being it its this that these those your you we " +
  "our they their them not no so than then there here what which who when where why how do does did can could will would should may might must also just " +
  "only very more most less about into over under after before up out such each every any some all both per via one").split(" "));
const words = (sentence: string) => normalize(sentence).replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ").match(/[a-z0-9$%][a-z0-9$%'.-]*/g)?.map((w) => w.replace(/[.'-]+$/, "")) ?? [];

const stem = (word: string) => word.replace(/(?:ies)$/, "y").replace(/(?<=[a-z]{3})s$/, "");
/** Passages of six or more words that appear in more than one sentence of the article's body. A passage made only of the
 * subject's own terms (its search, outline and coverage: "outstanding checks and deposits in transit") is vocabulary, not
 * a repeat. */
export function repeatedPassages(markdown: string, n = 6, topic = ""): { phrase: string; count: number; repeats: string[] }[] {
  const all = bodySentences(markdown), tokens = all.map(words);
  const vocabulary = new Set(words(topic).map(stem));
  const grams = new Map<string, Set<number>>();
  tokens.forEach((t, i) => {
    for (let k = 0; k + n <= t.length; k++) {
      const gram = t.slice(k, k + n), content = gram.filter((w) => !FILLER.has(w));
      if (content.length < 3 || content.every((w) => vocabulary.has(stem(w)))) continue;
      const key = gram.join(" ");
      grams.set(key, (grams.get(key) ?? new Set()).add(i));
    }
  });
  const found = new Map<string, { phrase: string; at: Set<number> }>();
  tokens.forEach((t, i) => {
    // The longest runs of shared six-word grams in this sentence, each grown to its whole shared passage.
    let k = 0;
    while (k + n <= t.length) {
      const shared = (pos: number) => (grams.get(t.slice(pos, pos + n).join(" "))?.size ?? 0) > 1;
      if (!shared(k)) { k++; continue; }
      let end = k;
      while (end + 1 + n <= t.length && shared(end + 1)) end++;
      const phrase = t.slice(k, end + n).join(" ");
      if (!found.has(phrase)) found.set(phrase, { phrase, at: new Set() });
      found.get(phrase)!.at.add(i);
      k = end + n;
    }
  });
  // A passage counts where its first six words appear; a longer one wins over the shorter passages inside it.
  const results = [...found.values()].map(({ phrase }) => {
    const head = phrase.split(" ").slice(0, n).join(" ");
    const at = [...(grams.get(head) ?? [])].sort((a, b) => a - b);
    return { phrase, count: at.length, repeats: at.slice(1).map((i) => all[i]) };
  }).filter((r) => r.count > 1).sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);
  const kept: typeof results = [];
  for (const r of results) if (!kept.some((k) => k.phrase.includes(r.phrase))) kept.push(r);
  return kept.sort((a, b) => b.count - a.count).slice(0, 8);
}

/** A reader sent elsewhere for the answer, the way Cowork marked it ("check the manufacturer", "ask your plumber"). */
const DEFLECTION = /\b(?:check|confirm|verify|ask|consult|contact|call|talk to|speak (?:to|with)|refer to|look up|see)\b[^.!?]{0,50}?\b(?:the|your|a|an|each|local|their)\s+(?:\w+\s+){0,2}?(?:manufacturer|maker|brand|plumber|installer|contractor|electrician|technician|provider|vendor|retailer|dealer|utility|city|county|municipality|accountant|bookkeeper|tax (?:pro|professional|adviser|advisor)|professional|expert|documentation|docs|official (?:site|website|page)|product page|pricing page|(?:care |product )?label|packaging)(?:'s|s|’s)?\b/i;
export function deflections(markdown: string): string[] {
  return sentences(prose(markdown)).filter((sentence) => DEFLECTION.test(sentence));
}

const NO_CODE_SECTION = /^(?:what|why|when|who|which|is|are|should|frequently|faqs?|common questions|sources|references|related|conclusion|summary|next steps|key takeaways|wrapping up|final thoughts|prerequisites|requirements|before you|comparison|compar|alternatives|performance|benchmark|pros|cons|choosing|how to choose)/i;
/** P268: a tutorial section that teaches a step without a code block (Cowork: "child loggers, pino-http, redaction and
 * shipping are prose only"). */
export function sectionsWithoutCode(markdown: string): string[] {
  const body = markdown.split(SOURCES_HEADING)[0];
  const parts = body.split(/^##\s+/m).slice(1);
  return parts.map((part) => ({ heading: part.split("\n")[0].trim(), text: part }))
    .filter(({ heading, text }) => heading && !NO_CODE_SECTION.test(heading) && !/\bvs\.?\b|\bversus\b/i.test(heading) && !HAS_CODE.test(text))
    .map(({ heading }) => heading);
}

/** The options a list names (its H3 entries), without the business's own product. */
export function listOptionCount(markdown: string, productName: string): number {
  const body = markdown.split(SOURCES_HEADING)[0];
  const own = normalize(productName).replace(/[^a-z0-9]/g, "");
  return [...body.matchAll(/^###\s+(.+)$/gm)].filter((m) => !own || !normalize(m[1]).replace(/[^a-z0-9]/g, "").includes(own)).length;
}

export function fixFindings(markdown: string, outline: ArticleOutline, productName: string, topic = ""): FixFinding[] {
  const findings: FixFinding[] = [];
  for (const passage of repeatedPassages(markdown, 6, topic)) {
    findings.push({ kind: "repetition", line: passage.repeats[0], detail: `"${passage.phrase}" is said ${passage.count} times; keep it the first time and cut or rewrite the repeats` });
  }
  for (const sentence of deflections(markdown).slice(0, 6)) {
    findings.push({ kind: "deflection", line: sentence, detail: "This sends the reader elsewhere for an answer: give the figure or answer from the fact sheet instead, or cut the referral when the fact sheet has none (keep a check the reader does themselves)" });
  }
  if (outline.format === "tutorial") {
    for (const heading of sectionsWithoutCode(markdown)) findings.push({ kind: "code", detail: `The section "${heading}" teaches a step without code; show it in a complete, runnable code block` });
  }
  if (outline.format === "list") {
    const needed = outline.minItems ?? 6, named = listOptionCount(markdown, productName);
    if (named < needed) findings.push({ kind: "options", detail: `The list names ${named} options${productName ? ` besides ${productName}` : ""}; add options from the fact sheet, each from its own page with its price, until it names ${needed}` });
  }
  return findings;
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
export function articleOutlinePrompt(plan: { format: PlanFormat; sections: string[]; minItems?: number }, covers: ReadonlyMap<string, string>,
  productName = ""): string {
  // P264 (Oct 31 2026): what each format must deliver, from Cowork's judgement of the plan's first 5 articles.
  // P268 (Oct 31 2026), Cowork's batch 2: a list of options built for the search's audience, the business's own product
  // not counted, each price once with its conditions; a tutorial with code in every step; a comparison with numbers.
  const formatRule = {
    list: `FORMAT: a list. In the section that holds the list, name at least ${plan.minItems ?? 6} real options built for this search's audience${productName ? ` (${productName} does not count toward them)` : ""}, each as an H3 (### Name) with its price exactly as its own page states it (the plan name, billing period and any introductory period), what it is, who it suits and one limitation; then compare them in a markdown table. Give each price once in its entry and once in the table, nowhere else.`,
    tutorial: "FORMAT: a tutorial. Build one runnable example end to end as numbered steps (1., 2., 3.): the install command, then a complete fenced code block for each step (one file, or the lines it adds), how to run it, and the output it prints. Every section that teaches a pattern (configuration, context, middleware, redaction, transports, errors, shutdown, or whatever the top results teach) shows it in code, not only in prose. Use every API name, option and command exactly as the official documentation in the fact sheet gives it; never invent one.",
    "how-to": "FORMAT: step by step. Give the steps as a numbered list (1., 2., 3.), and finish every worked example with every number.",
    comparison: "FORMAT: a comparison. Say what each option is, compare them in a markdown table on the attributes the top results compare, with each option's key numbers from the fact sheet (temperatures, weights, lifespans, prices), then say which suits whom.",
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
