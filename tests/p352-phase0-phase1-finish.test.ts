// Finishing Phase 0 and Phase 1 (Nov 2026). The diagnosis never reports something that isn't wrong: a page taken down on
// purpose is not broken, a support page is not "thin content", speed is Google's own measurement. Every new article gets
// an image again (Autopilot published none from Aug 27), bought inside its $0.50 ledger, and no AI score decides any of
// it (rule 2a). Fictional sites only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";
import { diagnoseSite, type CrawledPage, type GscRow } from "../convex/lib/siteDiagnosis.ts";

/** The optional-step rule, read from its source (contentWork.ts can't load outside Convex's bundler). */
const ARTICLE_OPTIONAL_STEP = new RegExp(/export const ARTICLE_OPTIONAL_STEP = \/(.+)\/;/.exec(readFileSync("convex/contentWork.ts", "utf8"))![1]);

const site = "https://quillpad.example";
const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const series = (query: string, impressions: number, position: number, url: string): GscRow[] =>
  Array.from({ length: 28 }, (_, i) => ({ date: day(i), query, page: url, impressions: Math.round(impressions / 28), clicks: 0, position }));
const now = Date.UTC(2026, 9, 29);
const live = (path: string, extra: Partial<CrawledPage> = {}): CrawledPage => ({ url: `${site}${path}`, status: 200, title: path, description: true,
  h1: 1, words: 1200, images: 2, links: [], structuredData: true, article: true, publishedAt: now - 60 * 86_400_000, ...extra });

test("a page taken down on purpose answers not found as it should; it is never reported as broken", () => {
  const pages: CrawledPage[] = [live("/blog/kept"), { url: `${site}/blog/retired`, status: 404, removed: true }, { url: `${site}/blog/lost`, status: 404 }];
  const d = diagnoseSite({ domain: "quillpad.example", gsc: [], pages, now });
  assert.deepEqual(d.findings.find((f) => f.problem === "Published pages that don't load")!.items, ["/blog/lost (HTTP 404)"]);
  const context = readFileSync("convex/siteDiagnosis.ts", "utf8");
  assert.match(context, /retired: retiredArticle\(site\.domain, row\.slug\)/, "the weekly run learns which articles were retired");
  assert.match(readFileSync("convex/actions/siteDiagnosis.ts", "utf8"), /if \(removed\.has\(normalize\(p\.url\)\)\) return \{ \.\.\.p, removed: true \};/);
});

test("only pages meant to rank are judged as content: articles, the home page, pages Google shows, and the sitemap before Search Console", () => {
  const support: CrawledPage = { url: `${site}/support`, status: 200, title: "Support", description: false, h1: 0, words: 176, images: 0, links: [], structuredData: false };
  const verification: CrawledPage = { url: `${site}/verify`, status: 200, title: "Verify", description: false, h1: 0, words: 56, images: 0, links: [], structuredData: false, noindex: true };
  const gsc = series("lead scoring system", 560, 18, `${site}/blog/kept`);
  const withConsole = diagnoseSite({ domain: "quillpad.example", gsc, pages: [live("/blog/kept"), support, verification], now });
  for (const problem of ["Thin pages", "Pages without images", "Pages without a meta description", "Pages without a main heading", "Published pages tell Google not to index them"]) {
    assert.equal(withConsole.findings.find((f) => f.problem === problem), undefined, `${problem}: a support page and a verification file are not content`);
  }
  const shown = diagnoseSite({ domain: "quillpad.example", gsc: [...gsc, ...series("lead scoring help hours", 280, 22, `${site}/support`)],
    pages: [live("/blog/kept"), support], now });
  assert.deepEqual(shown.findings.find((f) => f.problem === "Thin pages")!.items, ["/support (176 words)"], "a page Google shows for a search is content");
  const onboarding = diagnoseSite({ domain: "quillpad.example", gsc: [], pages: [{ ...support, url: `${site}/` }, support],
    sitemap: { found: true, urls: [`${site}/`, `${site}/support`] }, now });
  assert.match(onboarding.findings.find((f) => f.problem === "Thin pages")!.evidence, /^2 pages/, "before Search Console, the owner's sitemap says what is meant to rank");
});

test("speed is Google's mobile speed test; its answer is parsed exactly and a missing answer is no finding", () => {
  const crawl = bundle("convex/lib/pageCrawl.ts") as { parsePageSpeed: (url: string, psi: unknown) => unknown };
  const parsed = crawl.parsePageSpeed(`${site}/`, { lighthouseResult: { categories: { performance: { score: 0.43 } },
    audits: { "largest-contentful-paint": { numericValue: 5321.7 } } } });
  assert.deepEqual(plain(parsed), { url: `${site}/`, score: 43, lcpMs: 5322 });
  assert.equal(crawl.parsePageSpeed(`${site}/`, { error: { code: 429 } }), null);
  const d = diagnoseSite({ domain: "quillpad.example", gsc: [], pages: [live("/blog/kept", { loadMs: 12_000 })], now });
  assert.equal(d.findings.find((f) => f.problem === "Slow pages"), undefined, "a slow fetch from Pentra's server is the network, not the page");
});

test("the record shows the site after this run's merges, with page one's evidence and Google's speed checks", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /pages = pages\.map\(\(p\) => moved\.has\(normalize\(p\.url\)\) \? \{ url: p\.url, status: 308, location: moved\.get\(normalize\(p\.url\)\)! \} : p\);\n    d = diagnoseSite\(\{ \.\.\.inputs, pages \}\);/);
  assert.match(action, /pageOne: pageOne\.map/);
  assert.match(action, /speed: speedChecks/);
  const schema = readFileSync("convex/lib/siteDiagnosisSchema.ts", "utf8");
  assert.match(schema, /pageOne: v\.optional/);
  assert.match(schema, /speed: v\.optional/);
});

/** Values made inside the bundle's sandbox, as plain values of this realm. */
const plain = <T>(value: T): T => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)));
function bundle(entry: string): Record<string, unknown> {
  const text = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const mod = { exports: {} as Record<string, unknown> };
  runInNewContext(text, { module: mod, exports: mod.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder, console,
    process: { env: {} }, Buffer, setTimeout, clearTimeout });
  return mod.exports;
}

test("a new article's image is bought inside its own ledger, charged from the API's usage, never twice", async () => {
  const provider = bundle("convex/actions/contentWorkProvider.ts") as {
    contentHeroImage: (make: () => Promise<{ url: string | null; attempts: Array<{ inputTokens: number; outputTokens: number; reviewed: boolean }> }>) => Promise<string | null>;
    withContentProvider: <T>(scope: unknown, run: () => Promise<T>) => Promise<T>;
    HERO_IMAGE_CEILING_MICRO_USD: number };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let admission: Record<string, unknown> = { kind: "started", key: "k1" };
  const ctx = { runMutation: async (ref: unknown, args: Record<string, unknown>) => { calls.push({ name: getFunctionName(ref as never), args });
    return getFunctionName(ref as never) === "contentWork:beginProviderCall" ? admission : null; } };
  const scope = { ctx, job: { _id: "job", contentWork: { replacements: 0, revisions: 1 } }, workerToken: "worker", phase: "review" };
  let made = 0;
  const make = async () => { made++; return { url: "https://files.example/hero.webp", attempts: [{ inputTokens: 300, outputTokens: 1568, reviewed: false }] }; };
  assert.equal(await provider.withContentProvider(scope, () => provider.contentHeroImage(make)), "https://files.example/hero.webp");
  assert.equal(calls[0].name, "contentWork:beginProviderCall");
  assert.equal(calls[0].args.key, "0:1:review:hero_image");
  assert.equal(calls[0].args.ceilingMicroUsd, provider.HERO_IMAGE_CEILING_MICRO_USD);
  assert.equal(calls[1].name, "contentWork:completeProviderCall");
  assert.equal(calls[1].args.actualMicroUsd, 1568 * 32 + 300 * 5, "$0.05 for the image and its prompt (P357: no look at it)");
  assert.ok(ARTICLE_OPTIONAL_STEP.test("0:1:review:hero_image"), "an optional step: bought only while it fits under the $0.50 cap");
  admission = { kind: "cached", result: { url: "https://files.example/hero.webp" } };
  assert.equal(await provider.withContentProvider(scope, () => provider.contentHeroImage(make)), "https://files.example/hero.webp");
  assert.equal(made, 1, "a retried job reuses the stored image");
});

test("no AI score decides anything an article gets: images wait only on code checks, and no AI look decides whether a generated image is used", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.doesNotMatch(pipeline, /(?:editorialQualityScore|factCheckScore|reviewedConfidenceScore)(?: \?\? 0\))? *>= *\d{2}/,
    "a score threshold is a quality gate (rule 2a)");
  // P357 (Nov 5 2026): the look turned away every image of the first runs ("may imply context"); only a screenshot is
  // looked at, for objective failures (an error, loading or blank page, the wrong site).
  assert.match(pipeline, /if \(kind === "screenshot"\) \{\n    const review = await reviewMediaAsset\(/);
  assert.doesNotMatch(pipeline, /record\.reviewed = true/);
  assert.doesNotMatch(readFileSync("convex/lib/mediaQuality.ts", "utf8"), /strict production editor|polished|premium wide article hero/);
  const review = pipeline.slice(pipeline.indexOf("async function reviewPlannedArticle("), pipeline.indexOf("async function reviewExistingArticleHandler("));
  assert.match(review, /if \(preLinkIssues\.length === 0 && !media\.featuredImage && contentProviderActive\(\) && contentProviderMayRepairDraft\(\)\) \{/,
    "an image only for a new article that is ready to publish (never an owner's page or an improvement)");
  assert.ok(review.indexOf("contentHeroImage(") < review.indexOf("const contentHash = readyForPublication ? publicationArtifactHash(candidate)"),
    "the image is part of the article that is sealed and published");
  assert.match(review, /featuredImage: media\.featuredImage, reviewedMediaUrls: media\.reviewedMediaUrls,\n    mediaQualityStatus/);
});

test("AI answers: buyer questions that never name the business, each assistant's reply read exactly, named means the business or its site", async () => {
  const ai = await import("../convex/lib/aiAnswers.ts");
  const business = { name: "LeadPilot", domain: "leadpilot.chat" };
  assert.deepEqual(ai.parseAiQuestions({ questions: ["What's the best AI chatbot to qualify website leads for a small B2B team?",
    "Is LeadPilot good for lead qualification?", "lead scoring", "What's the best AI chatbot to qualify website leads for a small B2B team?",
    "Which tools answer website visitors' questions and book sales calls automatically?"] }, business),
    ["What's the best AI chatbot to qualify website leads for a small B2B team?", "Which tools answer website visitors' questions and book sales calls automatically?"]);
  assert.equal(ai.mentionsBusiness("Try Lead Pilot or Drift.", business), true);
  assert.equal(ai.mentionsBusiness("A lead piloting program.", business), false);
  assert.equal(ai.mentionsBusiness("Pentra and others", { name: "Pentra", domain: "pentra.dev" }), true);
  assert.equal(ai.mentionsBusiness("Pentrax is different", { name: "Pentra", domain: "pentra.dev" }), false);
  // P396: a cited page is a source, not a recommendation; only the answer's words name the business.
  assert.deepEqual(ai.judgeAnswer({ text: "Consider Drift or Qualified.", sources: ["https://www.leadpilot.chat/blog/x"] }, business), { named: false, cited: true });
  const chatgpt = ai.parseAssistantAnswer("chatgpt", { rows: [{ answer_text: "I'd start with Crawl4AI.", citations: [{ url: "https://crawl4ai.com" }], sources: [] }] });
  assert.deepEqual(chatgpt, { text: "I'd start with Crawl4AI.", sources: ["https://crawl4ai.com"] });
  // Nov 8 2026: ChatGPT is asked through cloro (crawl4ai succeeded 3.9% of the time); its shape is read too.
  assert.equal(ai.AI_ASSISTANT_ENDPOINTS.chatgpt, "cloro.ai-search.chatgpt.scrape");
  assert.deepEqual(ai.parseAssistantAnswer("chatgpt", { success: true, result: { text: "Try LeadPilot.", sources: [{ url: "https://leadpilot.chat/" }] } }),
    { text: "Try LeadPilot.", sources: ["https://leadpilot.chat/"] });
  assert.deepEqual(ai.parseAssistantAnswer("gemini", { success: true, result: { text: "A stock split is…", sources: [{ link: "https://example.com/a" }] } }),
    { text: "A stock split is…", sources: ["https://example.com/a"] });
  assert.deepEqual(ai.parseAssistantAnswer("google_ai_mode", { answered: true, answer: { source: "google_ai_mode", text: "Stripe was founded…" } }),
    { text: "Stripe was founded…", sources: [] });
  assert.equal(ai.parseAssistantAnswer("google_ai_mode", { answered: false, answer: null }), null, "no answer is not an answer that left the business out");
  const totals = ai.aiAnswerTotals([
    { question: "q1", assistant: "chatgpt", answered: true, named: true, cited: false },
    { question: "q1", assistant: "gemini", answered: true, named: false, cited: false },
    { question: "q1", assistant: "google_ai_mode", answered: false, named: false, cited: false }]);
  // P362: the totals also name the sites the answers cite most (none here).
  assert.deepEqual(plain(totals), { asked: 2, named: 1, cited: 0, byAssistant: [{ assistant: "chatgpt", asked: 1, named: 1 }, { assistant: "gemini", asked: 1, named: 0 }],
    citedSites: [], namedInstead: [] });
  const d = diagnoseSite({ domain: "leadpilot.example", gsc: [], aiAnswers: { asked: 15, named: 0, byAssistant: [{ assistant: "chatgpt", asked: 5, named: 0 },
    { assistant: "gemini", asked: 5, named: 0 }, { assistant: "google_ai_mode", asked: 5, named: 0 }] } });
  assert.equal(d.findings.find((f) => f.problem === "AI assistants don't name it")!.evidence,
    "Named in 0 of 15 answers to buyer questions (ChatGPT 0 of 5, Gemini 0 of 5, Google AI Mode 0 of 5)");
  assert.equal(d.factors.ai, "failing");
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /out\.questions = site\.aiQuestions;/, "the same questions every week, so weeks compare");
  assert.match(action, /costMicroUsd \+= AI_CALL_MAX_MICRO_USD;/, "a lost answer is charged at its bound, never assumed free");
});

test("a merged page's ground is kept: its own searches become sections of the page it joined, each answered once", async () => {
  const { foldQuestionsFor } = await import("../convex/lib/duplicatePages.ts");
  const from = `${site}/blog/crm-scoring`, to = `${site}/blog/scoring-system`;
  const gsc = [...series("dealership lead scoring system", 140, 22, from), ...series("dealership lead scoring system", 112, 15, to),
    ...series("banded revenue range scoring", 84, 30, from), ...series("crm lead scoring model", 56, 26, from), ...series("quillpad pricing", 280, 3, from),
    ...series("lead score decay", 28, 40, from), ...series("rare search", 3, 50, from)];
  assert.deepEqual(foldQuestionsFor(gsc, from, to, "quillpad.example"), ["banded revenue range scoring", "crm lead scoring model", "lead score decay"],
    "not a search the kept page already shows for, not the brand, not a handful of impressions");
  const mod = bundle("convex/siteRedirects.ts") as Record<string, { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }>;
  const summary = (slug: string) => ({ _id: `sum-${slug}`, siteId: "site", slug, status: "published", canonicalDomain: "quillpad.example", domainRevision: 0 });
  const tables: Record<string, Array<Record<string, unknown>>> = { sites: [{ _id: "site", domain: "quillpad.example", canonicalDomain: "quillpad.example", canonicalDomainRevision: 0 }],
    article_summaries: [summary("crm-scoring"), summary("scoring-system"), summary("old-a"), summary("old-b")],
    site_redirects: [{ _id: "older", siteId: "site", fromSlug: "old-a", toSlug: "old-b", reason: "merged_duplicate", delivery: "repository", createdAt: 1 }] };
  const ctx = { db: fakeDb(tables) };
  await mod.recordMerges._handler(ctx, { siteId: "site", merges: [{ fromSlug: "crm-scoring", toSlug: "scoring-system", evidence: "e",
    foldQuestions: ["banded revenue range scoring", "crm lead scoring model", "lead score decay", "a fourth"] }] });
  assert.deepEqual(tables.site_redirects.find((r) => r.fromSlug === "crm-scoring")!.foldQuestions, ["banded revenue range scoring", "crm lead scoring model", "lead score decay"]);
  assert.deepEqual(plain(await mod.unfoldedInternal._handler(ctx, { siteId: "site" })), [{ id: "older", fromSlug: "old-a", toSlug: "old-b", folded: false }],
    "a merge recorded before folds existed is found and given its searches");
  await mod.setFoldQuestions._handler(ctx, { siteId: "site", id: "older", foldQuestions: ["old search"] });
  assert.deepEqual(tables.site_redirects.find((r) => r._id === "older")!.foldQuestions, ["old search"]);
  const choice = readFileSync("convex/selectedPages.ts", "utf8");
  const fold = choice.slice(choice.indexOf("for (const fold of (await activeRedirects("), choice.indexOf("if (!candidates.length) return null;"));
  assert.match(fold, /!refreshAllowed/, "folds share the refresh rota with other improvements, never starving new articles");
  assert.match(fold, /now - \(e\.lastImprovedAt \?\? 0\) < CONTENT_PAGE_COOLDOWN_MS/);
  assert.match(fold, /evaluateTopicBusinessFit/, "a merged page's off-business search is never written into the kept page");
  assert.match(fold, /fold: \{ redirectId: fold\._id, question \}/);
  assert.match(readFileSync("convex/contentWork.ts", "utf8"), /foldedQuestions: \[\.\.\.\(fold\.foldedQuestions \?\? \[\]\), improvement\.fold\.question\]/,
    "a search is answered once, when its improvement job exists");
});

/** A small in-memory Convex database: indexed equality reads, inserts and patches. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const all = () => Object.values(tables).flat();
  return {
    async get(id: string) { return structuredClone(all().find((row) => row._id === id) ?? null); },
    async patch(id: string, patch: Record<string, unknown>) {
      const row = all().find((r) => r._id === id)!;
      for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); }
    },
    async insert(table: string, values: Record<string, unknown>) { const id = `${table}-${tables[table].length}`; tables[table].push({ _id: id, ...structuredClone(values) }); return id; },
    query(table: string) {
      const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
      const range = { eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return range; } };
      const rows = () => structuredClone((tables[table] ?? []).filter((row) => predicates.every((p) => p(row))));
      const chain = { withIndex(_name: string, fn?: (q: typeof range) => unknown) { fn?.(range); return chain; }, order() { return chain; },
        async take(n: number) { return rows().slice(0, n); }, async first() { return rows()[0] ?? null; }, async collect() { return rows(); } };
      return chain;
    },
  };
}

test("an image goes above an article's first paragraph through the exact correction path, and nothing else changes", () => {
  const correction = bundle("convex/lib/contentCorrection.ts") as {
    planCorrectiveChange: (site: unknown, page: unknown, input: unknown) => { after: string; sourceBefore: string; sourceAfter: string };
    verifyCorrectivePatch: (site: unknown, page: unknown, patch: unknown) => string;
    firstPlainParagraph: (markdown: string) => string | null; imageAdditionReplacement: (before: string, image: { url: string; alt: string }) => string };
  const first = "Lead scoring ranks every website lead by how ready it is to buy, so sales calls the right people first.";
  const markdown = `${first}\n\n## How it works\n\nA second paragraph.`;
  const page = { url: `${site}/blog/scoring`, slug: "/blog/scoring", editable: { active: true, kind: "github", markdown,
    sourceContent: `---\ntitle: "Lead Scoring"\n---\n\n${markdown}\n` } };
  const url = "https://wary-starfish-773.convex.cloud/api/storage/0a1b2c3d-4e5f";
  assert.equal(correction.firstPlainParagraph(`# Title\n\n- a list\n\n${first}\n\nMore.`), first);
  assert.equal(correction.firstPlainParagraph("## Only headings\n\n| a | b |"), null);
  const replacement = correction.imageAdditionReplacement(first, { url, alt: "Lead Scoring [guide]" });
  assert.equal(replacement, `![Lead Scoring guide](${url})\n\n${first}`);
  const patch = correction.planCorrectiveChange({ domain: "quillpad.example" }, page, { kind: "image_addition", before: first, replacement,
    reason: "Autopilot adds the image it made and checked for its own article." });
  assert.equal(patch.after, replacement);
  assert.equal(patch.sourceBefore, first);
  assert.equal(patch.sourceAfter, replacement, "the GitHub file changes by exactly the image line");
  assert.equal(correction.verifyCorrectivePatch({ domain: "quillpad.example" }, page, { ...patch, kind: "image_addition", before: first,
    reason: "Autopilot adds the image it made and checked for its own article." }), `${replacement}\n\n## How it works\n\nA second paragraph.`);
  const refuse = (input: Record<string, unknown>, target = page) => assert.throws(() => correction.planCorrectiveChange({ domain: "quillpad.example" }, target,
    { kind: "image_addition", before: first, reason: "Autopilot adds the image it made and checked for its own article.", ...input }));
  refuse({ replacement: `![x](https://evil.example/img.png)\n\n${first}` }, );
  refuse({ replacement: `![x](${url})\n\n${first} And a new sentence.` });
  refuse({ replacement }, { ...page, editable: { ...page.editable, markdown: `![old](https://x.example/a.png)\n\n${markdown}` } });
  refuse({ replacement }, { ...page, editable: { ...page.editable, kind: "wordpress" } });
  const repair = readFileSync("convex/contentImprovements.ts", "utf8");
  assert.match(repair, /const proposal = related \?\? stock \?\? image \?\? titled;/, "an image waits behind the page's other repairs, one commit at a time (P367: a title test after it)");
  assert.match(repair, /if \(prepared && kind === "image_addition"\) await ctx\.db\.patch\(prepared\._id, \{ status: "queued", jobId \}\);/);
  assert.match(repair, /throw new Error\("Related reading title repairs, image additions and search title tests are Autopilot's own"\)/);
  assert.match(readFileSync("convex/lib/contentCorrection.ts", "utf8"), /export const RELATED_REPAIR_VERSION = 8;/, "every page is visited once more for its image");
});

test("making images for live articles is the owner's call: a dry run buys nothing, and a real run is held, batched and settled", () => {
  const action = readFileSync("convex/actions/articleImages.ts", "utf8");
  assert.ok(action.indexOf("if (dryRun) return") < action.indexOf("internal.articleImages.reserve"), "a dry run returns before any spend");
  assert.match(action, /spent \+= HERO_IMAGE_CEILING_MICRO_USD;/, "a lost answer is charged at its ceiling");
  assert.match(action, /Math\.min\(want, IMAGE_BATCH\)/);
  assert.match(readFileSync("convex/lib/providerSpendReservation.ts", "utf8"), /args\.purpose !== "media_backfill"/);
  const images = readFileSync("convex/articleImages.ts", "utf8");
  assert.match(images, /e\.kind !== "github" \|\| !e\.managedArticleId/, "only the site's own articles, on a source Pentra can edit exactly");
  assert.match(images, /\.sort\(\(a, b\) => b\.impressions - a\.impressions/, "the pages Google shows most get theirs first");
  assert.match(readFileSync("convex/sites.ts", "utf8"), /case "article_images":/, "a deleted site's prepared images go with it");
});

test("the dashboard shows what Pentra found and fixed, in plain words", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const code = buildSync({ entryPoints: ["src/components/site-diagnosis-card.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const runtime = { exports: {} as Record<string, never> };
  const actual = createRequire(import.meta.url);
  runInNewContext(code, { module: runtime, exports: runtime.exports, TextEncoder, URL, Intl, require: (name: string) => name === "convex/react" ? { useQuery: (ref: never) => {
    const fn = getFunctionName(ref);
    if (fn === "siteDiagnosis:latest") return { createdAt: Date.UTC(2026, 10, 5), siteType: "struggling", window: { from: "2026-10-05", to: "2026-11-01" },
      factors: { searches: "weak", pages: "failing", authority: "failing", clicks: "failing", ai: "unknown" },
      summary: "This site got 3 clicks from 3064 search impressions in 28 days (searches for its own name aside).\nBiggest problems. A.\nWhat Pentra does next. Retitle the pages whose readers could buy. Earn links every week.",
      findings: [{ factor: "pages", severity: "high", problem: "Articles Google never shows", evidence: "55 of 106 articles older than 21 days got no impressions in 28 days" }],
      ai: { asked: 15, named: 0, questions: ["q1", "q2", "q3", "q4", "q5"] } };
    if (fn === "siteRedirects:listForSite") return [{ fromSlug: "crm-lead-scoring-guide", toSlug: "sales-lead-scoring-system-2", delivery: "repository", verifiedAt: 1, deliveryNote: null }];
    throw new Error(`Unexpected query ${fn}`);
  } } : actual(name) });
  const html = renderToStaticMarkup(createElement(runtime.exports.SiteDiagnosisCard, { siteId: "sites:synthetic" }));
  for (const text of ["What Pentra found", "This site got 3 clicks from 3064 search impressions", "Searches it can win", "Named by AI assistants", "Not measured",
    "Articles Google never shows", "named in 0 of 15 answers", "Merged duplicate", "/crm-lead-scoring-guide", "permanent redirect, checked live",
    "What Pentra does next: </span>Retitle the pages whose readers could buy. Earn links every week."]) assert.ok(html.includes(text), text);
});

test("page one is the sites that rank, never Google itself: goto results are read from Google's breadcrumb, each site once", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const items = [
    { type: "organic", url: "https://www.google.com/goto?url=CAESabc", breadcrumb: "https://www.salesforce.com › resources › articles" },
    { type: "organic", url: "https://www.hubspot.com/lead-scoring", breadcrumb: "https://www.hubspot.com › lead-scoring" },
    { type: "people_also_ask", url: "https://www.google.com/search?q=x" },
    { type: "organic", url: "https://www.google.com/goto?url=CAESdef", breadcrumb: "" },
    { type: "organic", url: "https://www.hubspot.com/another", breadcrumb: "https://www.hubspot.com" },
    { type: "organic", url: "https://support.google.com/answer/1" },
    { type: "organic", url: "https://smallblog.example/post" }];
  const text = buildSync({ entryPoints: ["convex/actions/seoData.ts"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const mod = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  runInNewContext(text, { module: mod, exports: mod.exports, require: createRequire(import.meta.url), URL, URLSearchParams, TextEncoder, TextDecoder, console, Buffer,
    setTimeout, clearTimeout, AbortSignal, process: { env: { DATAFORSEO_LOGIN: "login", DATAFORSEO_PASSWORD: "password" } },
    fetch: async (url: string, init: { body: string }) => { requests.push({ url, body: JSON.parse(init.body) });
      const lighthouse = url.includes("lighthouse");
      return { ok: true, status: 200, json: async () => ({ status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, cost: 0.002,
        result: [lighthouse ? { categories: { performance: { score: 0.62 } }, audits: { "largest-contentful-paint": { numericValue: 3100.4 } } } : { items }] }] }),
        text: async () => "" }; } });
  assert.deepEqual(plain(await mod.exports.pageOneDomains("lead scoring")), ["salesforce.com", "hubspot.com", "smallblog.example"]);
  assert.match(requests[0].url, /serp\/google\/organic\/live\/advanced$/, "the advanced results carry Google's breadcrumb");
  const crawl = bundle("convex/lib/pageCrawl.ts") as { parsePageSpeed: (url: string, psi: unknown) => unknown };
  const answer = await mod.exports.lighthouseMobile("https://quillpad.example/");
  assert.match(requests[1].url, /on_page\/lighthouse\/live\/json$/);
  assert.deepEqual(plain(requests[1].body), [{ url: "https://quillpad.example/", for_mobile: true, categories: ["performance"] }]);
  assert.deepEqual(plain(crawl.parsePageSpeed("https://quillpad.example/", answer)), { url: "https://quillpad.example/", score: 62, lcpMs: 3100 });
});

test("AI answers: a proper market code, Google AI Mode from cloro, and no verdict on too few answers", async () => {
  const ai = await import("../convex/lib/aiAnswers.ts");
  assert.equal(ai.countryCode("United States"), "US", "never \"UN\"");
  assert.equal(ai.countryCode("uk"), "GB");
  assert.equal(ai.countryCode(undefined), "US");
  assert.equal(ai.AI_ASSISTANT_ENDPOINTS.google_ai_mode, "cloro.google.serp.ai_mode");
  assert.deepEqual(ai.parseAssistantAnswer("google_ai_mode", { success: true, result: { text: "For a small B2B software company…", sources: [{ url: "https://intercom.com" }] } }),
    { text: "For a small B2B software company…", sources: ["https://intercom.com"] });
  const d = diagnoseSite({ domain: "leadpilot.example", gsc: [], aiAnswers: null, aiAttempt: { questions: 15, answered: 1 } });
  const f = d.findings.find((x) => x.problem === "AI answers not measured")!;
  assert.equal(f.evidence, "Only 1 of 15 buyer questions got an answer this week, too few to judge");
  assert.equal(d.factors.ai, "unknown", "one answer is no verdict");
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /if \(!got\.answer && got\.error !== "timeout" && Date\.now\(\) < deadline\) got = await call\(question, assistant\);/,
    "a call that failed fast gets one retry; one that timed out does not");
  assert.match(action, /error: "not asked \(time limit\)"/, "a question still waiting at the time limit is recorded as unasked");
  assert.match(action, /const \[crawlResult, measured, ai\] = await Promise\.all\(\[crawlPart\(\), measurePart\(\), aiPart\(\)\]\);/,
    "the crawl, the paid checks and the AI questions run side by side, well inside an action's ten minutes");
  assert.match(action, /error: got\.error \?\? "no answer"/, "every miss keeps its reason");
  assert.match(action, /aiAnswers: answered >= AI_MIN_ANSWERS \? aiAnswerTotals\(aiChecks\) : null,/);
});

test("a merged page is no longer 'close to page one': only pages that still load are worth improving", () => {
  const gsc = [...series("lead scoring system", 560, 15, `${site}/blog/kept`), ...series("lead handoff guide", 280, 16, `${site}/blog/merged`)];
  const pages: CrawledPage[] = [live("/blog/kept"), { url: `${site}/blog/merged`, status: 308, location: `${site}/blog/kept` }];
  const d = diagnoseSite({ domain: "quillpad.example", gsc, pages, now });
  assert.deepEqual(d.findings.find((f) => f.problem === "Pages close to page one")!.items, ["/blog/kept (position 15, 560 impressions)"]);
});

test("a DataForSEO answer that reports a failed task still states its charge: recorded, never left uncertain", async () => {
  const text = buildSync({ entryPoints: ["convex/actions/seoData.ts"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const mod = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  let reply: unknown = null, lost = false;
  runInNewContext(text, { module: mod, exports: mod.exports, require: createRequire(import.meta.url), URL, URLSearchParams, TextEncoder, TextDecoder, console, Buffer,
    setTimeout, clearTimeout, AbortSignal, process: { env: { DATAFORSEO_LOGIN: "login", DATAFORSEO_PASSWORD: "password" } },
    fetch: async () => { if (lost) throw new Error("socket hang up"); return { ok: true, status: 200, json: async () => reply, text: async () => "" }; } });
  const meter = mod.exports.meterDataForSeoCost as (run: () => Promise<unknown>) => Promise<{ result: unknown; usd: number; uncertain: boolean }>;
  reply = { status_code: 20000, cost: 0.002, tasks: [{ status_code: 40102, status_message: "No Search Results.", cost: 0.002 }] };
  assert.deepEqual(plain(await meter(async () => { try { await mod.exports.pageOneDomains("no such search"); } catch { /* the search stays unmeasured */ } return null; })),
    { result: null, usd: 0.004, uncertain: false }, "each answer's own charge is recorded (the search and its one retry)");
  lost = true;
  assert.equal((await meter(async () => { try { await mod.exports.pageOneDomains("lost"); } catch { /* lost */ } return null; })).uncertain, true,
    "a lost answer may have been billed: uncertain");
});
