// P247 (Oct 30 2026): Cowork's launch audit (ops/LAUNCH-GAPS.md), read as a prospect would. pentra.dev still served 32
// posts the old engine wrote before evidence rules (unsourced numbers, Pentra prices that were never true); the pages
// named WordPress, Shopify, Webflow and Ghost as working when none had published to a real site; "independent fact
// check" (the same AI vendor) and "AI answers" (nothing measures them); a typo; every page previewed as the homepage;
// Settings asked again for the platform chosen at setup and named the wrong folder; the article page showed the fact
// checker's internal paragraph and score on an article Autopilot publishes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PENTRA_CONSOLIDATED, consolidatedTarget, retiredArticle, servedOnItsOwnUrl } from "../convex/lib/pentraConsolidation.ts";

const read = (path: string) => readFileSync(path, "utf8");

const OLD_ENGINE_LIVE = ["12-month-seo-content-calendar-autopilot", "ai-content-generator-seo-automated-article-writing",
  "ai-content-generator-vs-manual-writing-rankings", "ai-seo-content-generator-vs-manual-writing", "ai-seo-tools-comparison-guide",
  "ai-website-crawling-niche-detection-guide", "article-refresh-strategy-guide", "automate-keyword-research-seo",
  "automated-seo-workflow-complete-guide", "autonomous-publishing-saves-time", "b2b-case-study-best-practices",
  "b2b-saas-content-strategy-ranking-lead-generation", "best-free-seo-tools-for-small-teams", "best-practices-video-marketing-seo-optimized",
  "best-seo-monitoring-tools-small-teams", "build-backlinks-automatically-proven-methods", "content-pipeline-optimization-checklist-topic-to-publishing",
  "fact-check-ai-generated-content-verification-framework", "fact-checking-ai-generated-content-framework", "how-long-does-seo-take-timeline",
  "how-to-detect-ranking-drops-seo", "how-to-detect-seo-content-gaps-website", "keyword-clustering-strategy-organize-by-intent",
  "keyword-gap-analysis-find-content-opportunities", "keyword-research-for-content-creators-guide", "landing-page-url-best-practices-seo-structure",
  "on-page-off-page-seo-strategy-guide", "scale-blog-output-without-hiring-writers", "seo-content-calendar-tools-small-teams",
  "seo-roi-calculator-content-automation-cost", "website-crawling-for-seo-guide", "website-crawling-keyword-research-guide"];

test("P247 no old-engine post is served: each redirects to the newer article on its question, or is retired", () => {
  for (const slug of OLD_ENGINE_LIVE) {
    assert.equal(servedOnItsOwnUrl("pentra.dev", slug), false, slug);
    const target = consolidatedTarget("pentra.dev", slug);
    assert.ok(target ? servedOnItsOwnUrl("pentra.dev", target) && !OLD_ENGINE_LIVE.includes(target) : retiredArticle("pentra.dev", slug), slug);
  }
  assert.equal(consolidatedTarget("pentra.dev", "automated-seo-workflow-complete-guide"), "intelligent-content-automation");
  assert.equal(retiredArticle("pentra.dev", "seo-roi-calculator-content-automation-cost"), true, "nothing newer answers it");
  // Every redirect is one hop to a page that is served or retired, never a chain.
  for (const [from, to] of Object.entries(PENTRA_CONSOLIDATED)) {
    assert.equal(PENTRA_CONSOLIDATED[to], undefined, `${from} -> ${to} chains`);
    assert.ok(servedOnItsOwnUrl("pentra.dev", to) || retiredArticle("pentra.dev", to), `${from} -> ${to}`);
  }
  assert.equal(PENTRA_CONSOLIDATED["how-to-refresh-blog-posts-for-seo"], "improving-pages-close-to-page-one", "a duplicate goes straight to the successor");
  const toRetired = Object.entries(PENTRA_CONSOLIDATED).find(([, to]) => to === "best-practices-video-marketing-seo-optimized")?.[0];
  assert.ok(toRetired && retiredArticle("pentra.dev", toRetired), "a duplicate of a retired article is retired with it");
  for (const slug of ["competitive-keyword-research-method", "autonomous-site-crawling-and-niche-detection-guide-edited"])
    assert.equal(servedOnItsOwnUrl("pentra.dev", slug), true, `${slug}: today's engine stays`);
  assert.equal(retiredArticle("leadpilot.chat", "seo-roi-calculator-content-automation-cost"), false, "only pentra.dev's own blog");
  assert.equal(consolidatedTarget("leadpilot.chat", "article-refresh-strategy-guide"), null);
  const page = read("src/app/blog/[slug]/page.tsx");
  for (const fn of ["generateMetadata", "BlogPost"]) {
    const body = page.slice(page.indexOf(`function ${fn}`));
    assert.ok(body.indexOf("retiredArticle(domain, slug)") < body.indexOf("consolidatedTarget(domain, slug)"), `${fn}: 404 before any redirect`);
  }
});

test("P247 one platform list: pages name only the GitHub layouts proven live, and the unverified connectors say beta", () => {
  const marketing = ["src/app/page.tsx", "src/app/layout.tsx", "src/app/beta/page.tsx", "src/app/(dashboard)/upgrade/page.tsx",
    "src/components/landing/pricing-section.tsx", "src/app/check/page.tsx", "src/components/free-check/check-result.tsx"];
  for (const path of marketing) {
    const text = read(path);
    assert.doesNotMatch(text, /WordPress, Shopify, Webflow,? (?:or |and )?Ghost(?:,| or| and) (?:your )?GitHub|name: "(?:WordPress|Shopify, Webflow and Ghost)"/, path);
  }
  assert.match(read("src/app/page.tsx"), /Next\.js, Astro, Hugo, Jekyll and Gatsby blogs with Markdown posts/);
  const setup = read("src/components/onboarding/content-start.tsx");
  for (const name of ["WordPress", "Shopify", "Webflow", "Ghost"]) assert.match(setup, new RegExp(`>${name} \\(beta\\) · `), name);
  assert.match(read("src/app/(dashboard)/sites/[siteId]/page.tsx"), /\["wordpress", "WordPress \(beta\)"\], \["shopify", "Shopify \(beta\)"\]/);
});

test("P247 homepage claims are true as written, the typo is gone, and each public page previews as itself", () => {
  const home = read("src/app/page.tsx");
  assert.doesNotMatch(home, /Google and AI answers\.|Independent fact/);
  assert.doesNotMatch(home, /customers make, A draft/);
  for (const path of ["src/app/beta/page.tsx", "src/app/(dashboard)/upgrade/page.tsx", "src/components/landing/pricing-section.tsx"])
    assert.doesNotMatch(read(path), /[Ii]ndependent fact/, path);
  for (const [path, url] of [["src/app/blog/page.tsx", "`https://${domain}/blog`"], ["src/app/beta/page.tsx", '"https://pentra.dev/beta"'],
    ["src/app/check/page.tsx", '"https://pentra.dev/check"'], ["src/app/legal/terms/page.tsx", '"https://pentra.dev/legal/terms"'],
    ["src/app/legal/privacy/page.tsx", '"https://pentra.dev/legal/privacy"']])
    assert.ok(read(path).includes(`...pageSocial(`) && read(path).includes(`, ${url}),`), path);
});

test("P247 Settings keeps the platform chosen at setup and names the folder Pentra writes to; /articles matches Autopilot", () => {
  const settings = read("src/app/(dashboard)/sites/[siteId]/page.tsx");
  // P257: the folder Pentra found in the current repository; a site that already publishes keeps its folder.
  assert.match(settings, /\{site\.githubBlog\?\.state === "detected" \? site\.githubBlog\.postsDir : githubContentFolder\(site\.urlStructure\)\}\//);
  assert.match(settings, />Connect GitHub<\/button>/);
  assert.match(read("src/app/(dashboard)/articles/page.tsx"), /readiness\.autopilot\?\.on \? "Autopilot publishes your scheduled articles\./);
});

test("P247 the article page shows one plain fact-check line, never the checker's notes or score", () => {
  const article = read("src/app/(dashboard)/articles/[id]/page.tsx");
  assert.doesNotMatch(article, /Fact-check score \{|Fact-Check Notes|\{article\.factCheckNotes\}/);
  // P256: the notes are read only for the draft's own sentences the check could not source, never shown themselves.
  assert.equal(article.match(/factCheckNotes/g)?.length, article.match(/unverifiedClaimsFromFactCheckNotes\(article\.factCheckNotes\)/g)?.length);
  assert.match(article, /const factCheckLine = article\.publicationGateStatus !== "passed" \? null/);
  assert.match(article, /Checked before publishing: every statistic appears in its cited source/);
});

// P248: Cowork's review of recent pentra.dev posts: a "Fact-checked" badge on posts with zero sources, and no author.
test("P248 a post names who published it and claims a source check only when it cites sources", () => {
  const page = read("src/app/blog/[slug]/page.tsx");
  assert.doesNotMatch(page, /factCheckScore > 80/);
  assert.match(page, /\{article\.sources && article\.sources\.length > 0 && \(/);
  assert.match(page, /<span className="text-\[#8A8F98\]">By \{publisherName\}<\/span>/);
});

