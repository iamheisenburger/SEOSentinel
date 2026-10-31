// P260 (Oct 31 2026), Arshad's order: "Ship P260 now: the fixed article plan from ops/ARTICLE-PLAN-V1.md. Read Google's top 5
// results, build the outline from them, collect 3–5 primary sources into a fact sheet, write once, then check with code only
// (every number in the fact sheet, product facts match the profile, every outline section present, the format the search
// needs). At most one fix, then hand it to the user as a draft with doubtful lines marked. Remove the AI review score step
// completely. Keep the $0.50 cap." And: "Fix the Webflow page title" (tests/cms-publishers.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { articleOutlinePrompt, flaggedLines, missingFormatElements, missingOutlineSections, namesOutsideSources, numbersOutsideFactSheet,
  planCheckIssues, productFactsOutsideProfile, runPlanChecks, statedNumbers, type FactSheet } from "../convex/lib/articlePlanChecks.ts";
import { ownerAcceptableIssue, ownerWaivableIssue, PLAN_CHECK_ISSUE } from "../convex/lib/articleQuality.ts";
import { markDoubtfulLines, plainReviewNotes } from "../convex/lib/plainReviewNotes.ts";
import { googleRedirect, medianWords, pageShape, planFormat, serpPagesPrompt, technicalSearch, type SerpBrief } from "../convex/lib/serpBrief.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const work = readFileSync("convex/contentWork.ts", "utf8");

const sheet: FactSheet = {
  sources: [
    { url: "https://www.irs.gov/businesses/small-businesses-self-employed/late-payment", title: "Late payments | IRS",
      text: "Late fees are capped at 1.5% a month. Invoices are usually due in 30 days. QuickBooks and Xero both send automatic reminders." },
    { url: "https://www.xero.com/us/guides/invoice-reminders/", title: "Invoice reminders",
      text: "Send the first reminder 3 days before the due date and a second 7 days after it." },
  ],
  profile: "Name: Madman Invoice\n\nSummary: Madman Invoice is a web app for freelancers. Free plan: up to 5 invoices a month. Paid plan: $9 a month.",
  productName: "Madman Invoice",
};

test("P260 the brief reads each top result's own page: headings, length, code, tables and list items", () => {
  const html = `<html><body><nav><h2>Menu</h2></nav><main><h1>Start</h1><h2>Install the CLI</h2><p>${"word ".repeat(400)}</p>` +
    `<pre><code>npm i example</code></pre><h3>Configure it</h3><table><tr><td>a</td></tr></table><ul><li>a</li><li>b</li></ul></main>` +
    `<footer><h2>Footer links</h2></footer><script>var h2 = "<h2>no</h2>";</script></body></html>`;
  const page = pageShape("https://docs.example/start", html);
  assert.deepEqual(page.headings, ["Install the CLI", "Configure it"], "navigation, footer and scripts are not the article");
  assert.equal(page.codeBlocks, 1); assert.equal(page.tables, 1); assert.equal(page.items, 2);
  assert.ok(page.words >= 400 && page.words < 420, String(page.words));
  const brief = { results: [{ title: "Start here", url: "https://docs.example/start" }, { title: "Other", url: "https://other.example/" }], pages: [page] };
  const prompt = serpPagesPrompt({ ...brief, observedAt: 1, locationCode: 2840, languageCode: "en", format: "guide", questions: [] });
  assert.match(prompt, /^1\. Start here \(docs\.example\) · about \d+ words\n {3}Headings: Install the CLI \| Configure it$/, "the results whose pages were read");
  assert.match(serpPagesPrompt({ ...brief, pages: [], observedAt: 1, locationCode: 2840, languageCode: "en", format: "guide", questions: [] }),
    /^1\. Start here \(docs\.example\) · page not readable\n2\. Other \(other\.example\) · page not readable$/);
  // Live trial (Oct 31): 5 of the 8 organic results for "how to reconcile bank statements" were Google redirect links.
  assert.equal(googleRedirect("https://google.com/goto?url=CAESlwEB6zsw"), true);
  assert.equal(googleRedirect("https://www.google.com/goto?url=CAESlwEB6zsw"), true);
  assert.equal(googleRedirect("https://www.google.com/search?q=x"), false);
  assert.equal(googleRedirect("https://www.netgain.tech/blog/sample-bank-reconciliation"), false);
});

test("P260 the format is decided in code from what the top results share", () => {
  const brief = (titles: string[], code = 0): Pick<SerpBrief, "results" | "pages"> => ({
    results: titles.map((title, i) => ({ title, url: `https://r${i}.example/` })),
    pages: titles.map((_, i) => ({ url: `https://r${i}.example/`, headings: [], words: 1200 + i * 100, codeBlocks: i < code ? 2 : 0, tables: 0, items: 0 })) });
  assert.equal(planFormat(brief(["Notion vs Obsidian", "Obsidian vs. Notion in 2026", "Notion review"]), false), "comparison");
  assert.equal(planFormat(brief(["12 Best Invoice Apps", "Top Invoice Apps for Freelancers", "Invoice guide"]), false), "list");
  assert.equal(planFormat(brief(["Invoice guide", "Invoicing explained"]), true), "list", "a search for products gets a list of them");
  assert.equal(planFormat(brief(["Deploy Next.js to Vercel", "Next.js deployment", "Docs"], 2), false), "tutorial", "code on 2 of the pages");
  assert.equal(planFormat(brief(["How to File a 1099", "How to file 1099-NEC step by step", "1099 basics"]), false), "how-to");
  assert.equal(planFormat(brief(["2026 Tax Brackets and Rates", "2026 tax brackets explained", "1099 Forms: What They Are"]), false), "guide",
    "a year or a form number at the start of a title is not a list's count");
  assert.equal(medianWords({ pages: [250, 900, 1500, 2100].map((words, i) => ({ url: `https://r${i}.example/`, headings: [], words, codeBlocks: 0, tables: 0, items: 0 })) }), 1500,
    "the median of the pages that are articles (300 words or more)");
  assert.equal(medianWords({ pages: [] }), undefined);
  // Live trial: "node.js structured logging with pino" read no page (Reddit, Medium, Stack Overflow refuse automated reads).
  assert.equal(technicalSearch("node.js structured logging with pino"), true);
  assert.equal(technicalSearch("tankless water heater installation austin"), false);
  assert.equal(planFormat({ results: [{ title: "Best practices for app logs with Pino", url: "https://www.reddit.com/r/node/x" }], pages: [] }, false, true), "tutorial");
  assert.equal(planFormat(brief(["What is an API", "APIs explained"]), false, true), "guide", "a technical search whose pages show no code is not a tutorial");
  // Live trial: the search itself says what it wants when few results can be read.
  assert.equal(planFormat({ results: [], pages: [] }, false, false, "ceramic vs cast iron cookware"), "comparison");
  assert.equal(planFormat({ results: [], pages: [] }, false, false, "how to reconcile bank statements"), "how-to");
  assert.equal(planFormat({ results: [], pages: [] }, false, false, "tankless water heater installation austin"), "guide");
  assert.match(pipeline, /const url = googleRedirect\(result\.url\) \? await resolveGoogleRedirect\(result\.url\)\.catch\(\(\) => null\) : result\.url;/,
    "a redirect is resolved without loading its page, so a page that refuses automated reads keeps its result");
});

test("P260 every number must be in the fact sheet or the confirmed details; list and step numbers and citations are not claims", () => {
  assert.deepEqual(statedNumbers("Step 3: wait 2 weeks [1] and pay $1,200 (40%)."), ["2", "1200", "40"]);
  const markdown = [
    "## When invoices are due", "Most invoices are due in 30 days [1]. A late fee of 2% a month is common.",
    "1. Send the first reminder 3 days before the due date [2].", "2. Keep it short.",
    "```", "fee = 0.015 * 999", "```", "## Sources", "[1] IRS 2026 guidance",
  ].join("\n\n");
  const failures = numbersOutsideFactSheet(markdown, sheet);
  assert.deepEqual(failures.map(f => f.line), ["A late fee of 2% a month is common."], "code and the Sources section are not prose");
  assert.match(failures[0].detail, /^2 is not in the fact sheet or your confirmed details$/);
  assert.deepEqual(numbersOutsideFactSheet("The free plan covers up to 5 invoices a month.", sheet), [], "the confirmed details are part of the sheet");
});

test("P260 product facts must match the confirmed details; names must come from the sources, the details or the search", () => {
  const product = productFactsOutsideProfile("Madman Invoice's paid plan costs $15 a month. Madman Invoice's free plan covers 5 invoices.", sheet);
  assert.deepEqual(product.map(f => f.line), ["Madman Invoice's paid plan costs $15 a month."]);
  const names = namesOutsideSources("Tools such as QuickBooks and Xero send reminders. According to Jane Doe, reminders work. HubSpot sends them too.", sheet);
  // P261: a person or company the article attributes something to or names as an organisation, never any capitalised word.
  assert.deepEqual(names.map(f => f.detail), ["Jane Doe is not named in the sources or your details"]);
  assert.deepEqual(namesOutsideSources("Use FreshBooks for this.", sheet, ["freshbooks alternatives"]), [], "the search itself may name it");
});

test("P260 the outline's sections and the format's elements must be present", () => {
  const outline = { format: "tutorial" as const, sections: ["Install the CLI", "Configure the project", "Deploy"] };
  const draft = "Intro.\n\n## Install the CLI\n\nText.\n\n## configure the project!\n\nText.";
  assert.deepEqual(missingOutlineSections(draft, outline).map(f => f.detail), ['The outline\'s section "Deploy" is missing'], "headings match without case or punctuation");
  assert.deepEqual(missingFormatElements(draft, outline).map(f => f.detail), ["A tutorial needs at least one code, command or settings block",
    "Step-by-step instructions need numbered steps"]);
  assert.deepEqual(missingFormatElements("1. Run it.\n\n```bash\nnpm i\n```", outline), []);
  assert.deepEqual(missingFormatElements("### One\n\n### Two\n\n### Three", { format: "list", sections: [], minItems: 5 }).map(f => f.detail),
    ["A list needs at least 5 items (it has 3)"]);
  assert.deepEqual(missingFormatElements("| A | B |\n| --- | --- |\n| 1 | 2 |", { format: "comparison", sections: [] }), []);
  assert.equal(missingFormatElements("No table here.", { format: "comparison", sections: [] }).length, 1);
});

test("P260 the checks become plain, blocking issues for Autopilot and marked lines the owner may approve after reading", () => {
  const markdown = "Intro.\n\n## When invoices are due\n\nA late fee of **2%** a month is common, says [Jane Doe](https://jane.example).\n\n## Sources\n\n[1] IRS";
  const failures = runPlanChecks(markdown, sheet, { format: "guide", sections: ["When invoices are due", "Reminders"] });
  const issues = planCheckIssues(failures);
  assert.deepEqual(issues, ["Plan check: 1 sentence(s) state a number that is not in the fact sheet or the confirmed details.",
    "Plan check: 1 sentence(s) name a person or company the sources and details don't.", "Plan check: The outline's section \"Reminders\" is missing."]);
  const uncited = "1 quantified outcome or operational claim(s) lack an inline citation.";
  assert.equal(ownerAcceptableIssue(uncited, { qualityPlan: "fixed_v1" }), true, "in a planned draft an uncited number is a marked line too");
  assert.equal(ownerAcceptableIssue(uncited, {}), false, "outside the plan the rule is unchanged");
  assert.match(pipeline, /`Cite the fact-sheet source \[n\] for the numbers in this passage, or remove those numbers: «\$\{passage\.slice\(0, 900\)\}»`/);
  for (const issue of issues) {
    assert.ok(PLAN_CHECK_ISSUE.test(issue));
    assert.equal(ownerWaivableIssue(issue, {}), false, "Autopilot never publishes them unread");
    assert.equal(ownerAcceptableIssue(issue, {}), true, "the owner who read the marked lines decides");
  }
  const lines = flaggedLines(failures);
  assert.deepEqual(lines, ["A late fee of 2% a month is common, says Jane Doe."], "a link reads as its text");
  const marked = markDoubtfulLines(markdown, lines);
  assert.match(marked, /<mark title="[^"]+">A late fee of \*\*2%\*\* a month is common, says \[Jane Doe\]\(https:\/\/jane\.example\)\.<\/mark>/,
    "a line is found in the draft with its bold and link markup");
  assert.deepEqual(plainReviewNotes(issues), [
    "Some highlighted sentences state a number that isn't in the sources Pentra used. Check them, or edit them out, before you publish.",
    "A highlighted sentence names a person or company the sources don't mention. Check it, or edit it out.",
    "The planned section “Reminders” is missing. Most top results for this search cover it."]);
  const page = readFileSync("src/app/(dashboard)/articles/[id]/page.tsx", "utf8");
  assert.match(page, /const blockingGateIssues = gateIssues\.filter\(\(issue\) => !ownerAcceptableIssue\(issue, article\)\);/);
  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /acceptedBy === AUTOPILOT_ACCEPTANCE \? ownerWaivableIssue\(issue, candidate\)\n\s+: ownerAcceptableIssue\(issue, candidate\)/);
});

test("P260 the writer gets the outline with exact headings and the format's elements", () => {
  const prompt = articleOutlinePrompt({ format: "list", sections: ["What to look for", "The best invoice apps", "How to switch"], minItems: 7 },
    new Map([["The best invoice apps", "Seven apps with prices and who each suits."]]));
  assert.match(prompt, /^OUTLINE \(the fixed plan, built from Google's top results for this search: follow it exactly\):/);
  assert.match(prompt, /## What to look for\n## The best invoice apps \(covers: Seven apps with prices and who each suits\.\)\n## How to switch\n/);
  assert.match(prompt, /Add no other H2 section, except a Sources section when you cite sources\./);
  assert.match(prompt, /at least 7 named options, each as an H3/);
  assert.match(pipeline, /articleOutlinePrompt\(articlePlan, outlineCovers\)/);
  assert.match(pipeline, /toolName: "plan_article",/);
  assert.match(readFileSync("convex/actions/contentWorkProvider.ts", "utf8"), /"plan_article"/, "the outline call is priced like every other check");
});

test("P260 no AI review and no scores for a planned article: code checks, at most one targeted fix, then the owner", () => {
  assert.match(pipeline, /if \(article\.qualityPlan === "fixed_v1" && contentProviderActive\(\)\) \{\n\s+return reviewPlannedArticle\(/);
  const planned = pipeline.slice(pipeline.indexOf("async function reviewPlannedArticle"), pipeline.indexOf("async function reviewExistingArticleHandler"));
  assert.ok(planned.length > 1000);
  assert.doesNotMatch(planned, /callClaudeStructured|contentStructuredCall|review_article|audit_final_article|reviewArticle\(|auditFinalArticle\(/);
  assert.equal(planned.match(/await remediateFinalArticle\(/g)?.length, 1, "one targeted fix");
  assert.match(planned, /factCheckScore: undefined, editorialQualityScore: undefined/);
  assert.match(planned, /"Fix only these points and change nothing else:"/);
  const quality = readFileSync("convex/lib/articleQuality.ts", "utf8");
  assert.match(quality, /if \(planned\) \{\n\s+issues\.push\(\.\.\.planCheckIssues\(planChecksForArticle\(article\)\)\);/);
});

test("P260 an article's provider spend is capped at $0.50; the cap skips the fix, never ends in a retry loop", () => {
  assert.match(work, /export const ARTICLE_COST_CAP_MICRO_USD = 500_000;/);
  assert.match(work, /const cap = Math\.min\(cw\.budgetMicroUsd, ARTICLE_COST_CAP_MICRO_USD\);/);
  assert.match(work, /if \(spent >= cap \|\| \(optional && spent \+ args\.ceilingMicroUsd > cap\)\) \{/);
  assert.match(work, /export const ARTICLE_OPTIONAL_STEP = \/:remediate_final_article\$\|:review:submit_final_metadata\$\/;/,
    "research passes are stopped only by spend (live trial: their $0.59 ceiling refused every second pass)");
  assert.match(work, /\/Content work \(budget exhausted\|rollover blocked\|cost cap reached\)\/\.test\(error\) \? error/);
  assert.match(pipeline, /\.catch\(\(error: unknown\) => \{ if \(costCapRefusal\(error\)\) return null; throw error; \}\) : null;/);
  assert.match(pipeline, /The fix was skipped: this article reached its \$0\.50 cost cap\./);
});
