/** P291 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md step 0 and hole 4): pick topics Pentra can write well, and keep tutorial code to
 * what the documentation shows. */
import type { PlanFormat } from "./articlePlanChecks.ts";

export type SourcingCounts = { owner: number; publication: number; context: number };

/** What a planned article's sources must include before anything is written (step 0); an empty list means it can be
 * written. A list needs its options' own pricing or product pages, a tutorial the official documentation, a comparison
 * pages that own or report each side's facts; a how-to or guide at least three usable sources. Choosing well is cheaper
 * than fixing: a topic that fails costs its research (about $0.10), never a draft, and the slot takes the next topic. */
export const SOURCING_NEEDS: Record<PlanFormat, { owner?: number; strong?: number; total: number }> = {
  list: { owner: 4, total: 4 },
  tutorial: { owner: 2, total: 2 },
  comparison: { strong: 2, total: 2 },
  "how-to": { total: 3 },
  guide: { total: 3 },
};
export function sourcingGaps(format: PlanFormat, counts: SourcingCounts): string[] {
  const need = SOURCING_NEEDS[format] ?? SOURCING_NEEDS.guide;
  const total = counts.owner + counts.publication + counts.context, strong = counts.owner + counts.publication;
  const gaps: string[] = [];
  if (need.owner && counts.owner < need.owner) gaps.push(format === "list"
    ? `a list needs its options' own pricing or product pages (found ${counts.owner}, needs ${need.owner})`
    : `a tutorial needs the official documentation (found ${counts.owner} owner page(s), needs ${need.owner})`);
  if (need.strong && strong < need.strong) gaps.push(`a comparison needs pages that own or report each side's facts (found ${strong}, needs ${need.strong})`);
  if (total < need.total) gaps.push(`research kept ${total} usable source(s), needs ${need.total}`);
  return gaps;
}

/** Raised inside the article step when research can't source what the search needs: the job ends before any writing. */
export class TopicNotSourceable extends Error {
  readonly gaps: string[];
  constructor(gaps: string[]) {
    super(`Topic skipped before writing: ${gaps.join("; ")}`);
    this.name = "TopicNotSourceable";
    this.gaps = gaps;
  }
}

/** Language and runtime names a snippet may use without the documentation naming them. */
const BUILT_IN = new Set(("console log info warn error debug JSON stringify parse process env exit argv on once emit require module exports " +
  "import from default Promise resolve reject then catch finally async await map filter reduce forEach push pop shift slice splice " +
  "join split replace trim includes keys values entries assign freeze length toString toFixed Buffer setTimeout setInterval " +
  "clearTimeout Date now toISOString Math floor ceil round random max min Object Array String Number Boolean Error new return const " +
  "let var function class extends constructor this super if else for while switch case break continue try throw typeof instanceof " +
  "listen get post put delete use send json status end write writeHead createServer http https fs path join readFileSync " +
  "writeFileSync url URL fetch headers body method params query req res next app router express server port host " +
  "print len range open dict list str int float bool set tuple format append extend items get update def lambda self None True " +
  "False with as raise except pass yield global nonlocal assert del is not and or in sys os time datetime").split(" "));

/** Hole 4: function, method and option names a tutorial's code uses that its documentation sources don't show. Each goes to
 * the one fix ("rewrite with only documented APIs"), never straight to the reader. */
export function undocumentedCodeNames(markdown: string, docs: string): string[] {
  const known = docs.toLowerCase();
  const names = new Set<string>();
  for (const block of markdown.matchAll(/^[ \t]{0,6}```[^\n]*\n([\s\S]*?)^[ \t]{0,6}```/gm)) {
    const code = block[1].replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, " ").replace(/\/\/.*$|#.*$/gm, " ");
    for (const m of code.matchAll(/\.([A-Za-z_$][\w$]{2,})\s*\(/g)) names.add(m[1]);
    for (const m of code.matchAll(/^\s*([A-Za-z_$][\w$]{2,})\s*:/gm)) names.add(m[1]);
  }
  return [...names].filter((name) => !BUILT_IN.has(name) && !known.includes(name.toLowerCase())).slice(0, 12);
}
