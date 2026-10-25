/**
 * pentra.dev's own blog, consolidated (owner decision, Sep 25 2026): the old
 * engine published many near-duplicate articles on the same searches. Each
 * group now points to its strongest article with a permanent redirect, so
 * Google sees one page per topic. The articles themselves are kept unchanged
 * in Pentra; only pentra.dev stops serving the duplicates.
 *
 * Round 2 (P193, Oct 25 2026), measured: several round-1 survivors were never
 * shown by Google (0 impressions in Search Console's 28 days to Oct 22), and
 * Google skipped recent near-copies of pages it already indexed ("Discovered -
 * currently not indexed" or unknown). Each group's survivor is now the page
 * Google shows; the pages it never showed (published 60+ days ago) and the
 * copies it skipped join that page, one hop, never a chain.
 *
 * duplicate slug → the article it now redirects to
 */
export const PENTRA_DOMAIN = "pentra.dev";

export const PENTRA_CONSOLIDATED: Readonly<Record<string, string>> = Object.freeze({
  // Refreshing and updating old posts
  "how-to-refresh-blog-posts-for-seo": "article-refresh-strategy-guide",
  "content-refresh-seo-automated-strategy": "article-refresh-strategy-guide",
  "automated-article-refresh-keep-posts-ranking": "article-refresh-strategy-guide",
  "when-update-blog-posts-seo-rankings": "article-refresh-strategy-guide",
  "when-update-blog-posts-seo": "article-refresh-strategy-guide",
  "best-time-update-blog-posts-seo": "article-refresh-strategy-guide",
  "how-often-update-blog-posts-seo": "article-refresh-strategy-guide",
  "when-to-update-blog-posts-seo": "article-refresh-strategy-guide",
  "when-to-refresh-old-blog-posts-2": "article-refresh-strategy-guide",
  "when-to-refresh-old-blog-posts": "article-refresh-strategy-guide",
  "which-articles-to-refresh-first-ranking-data": "article-refresh-strategy-guide",
  "which-blog-posts-to-update-first": "article-refresh-strategy-guide",
  // Ranking drops and content decay
  "why-blog-posts-stop-getting-traffic-fix": "how-to-detect-ranking-drops-seo",
  "why-articles-stop-ranking-content-decay": "how-to-detect-ranking-drops-seo",
  "why-articles-lose-rankings-content-decay": "how-to-detect-ranking-drops-seo",
  "why-blog-posts-lose-rankings-content-decay": "how-to-detect-ranking-drops-seo",
  "detect-declining-blog-posts-before-rankings-drop": "how-to-detect-ranking-drops-seo",
  "detect-declining-rankings-before-traffic-drops": "how-to-detect-ranking-drops-seo",
  "detect-blog-posts-stop-ranking": "how-to-detect-ranking-drops-seo",
  "detect-blog-posts-stop-ranking-content-decay": "how-to-detect-ranking-drops-seo",
  "detect-content-decay-ranking-drops-guide": "how-to-detect-ranking-drops-seo",
  // Rank monitoring
  "how-to-automate-seo-ranking-monitoring": "best-seo-monitoring-tools-small-teams",
  "automated-seo-ranking-monitoring-setup-guide": "best-seo-monitoring-tools-small-teams",
  "automated-seo-monitoring-rank-tracking": "best-seo-monitoring-tools-small-teams",
  "automated-seo-monitoring-daily-metrics-checklist": "best-seo-monitoring-tools-small-teams",
  "automated-ranking-monitoring-track-fix-declining-articles": "best-seo-monitoring-tools-small-teams",
  "monitor-seo-rankings-automatically": "best-seo-monitoring-tools-small-teams",
  "seo-ranking-monitoring-tools-automated-vs-manual": "best-seo-monitoring-tools-small-teams",
  // Content gaps
  "detect-content-gaps-automatically": "how-to-detect-seo-content-gaps-website",
  "detect-content-gaps-website-automatically": "how-to-detect-seo-content-gaps-website",
  "how-to-detect-content-gaps-website": "how-to-detect-seo-content-gaps-website",
  "find-content-gaps-website-seo": "how-to-detect-seo-content-gaps-website",
  "content-gap-analysis-seo": "how-to-detect-seo-content-gaps-website",
  // Keyword clustering and planning
  "keyword-clustering-for-content-planning": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-explained": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-content-planning": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-for-seo-guide": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-seo-strategy-guide": "keyword-clustering-strategy-organize-by-intent",
  "keyword-planning-for-content-scale": "keyword-clustering-strategy-organize-by-intent",
  // Content calendars
  "automate-seo-content-calendar": "seo-content-calendar-tools-small-teams",
  "automated-seo-content-calendar-30-minutes": "seo-content-calendar-tools-small-teams",
  "automate-seo-content-calendar-planning": "seo-content-calendar-tools-small-teams",
  "automated-content-calendar-tools-comparison": "seo-content-calendar-tools-small-teams",
  // Publishing frequency
  "saas-blog-publishing-frequency-rankings": "how-often-publish-blog-posts-seo",
  // The SEO workflow and articles at scale
  "how-to-automate-seo-workflow": "automated-seo-workflow-complete-guide",
  "automate-seo-content-pipeline": "automated-seo-workflow-complete-guide",
  "automate-seo-article-writing-at-scale": "automated-seo-workflow-complete-guide",
  "write-seo-articles-at-scale-without-hiring": "automated-seo-workflow-complete-guide",
  "seo-content-at-scale-building-articles-without-team": "automated-seo-workflow-complete-guide",
  "automate-seo-content-creation-without-writers": "automated-seo-workflow-complete-guide",
  // AI content generators for SEO
  "ai-seo-content-generator-rankings": "ai-content-generator-seo-automated-article-writing",
  "ai-seo-content-writing-autonomous-tools": "ai-content-generator-seo-automated-article-writing",
  "ai-article-writer-seo-ranking": "ai-content-generator-seo-automated-article-writing",
  "ai-content-generator-seo-articles": "ai-content-generator-seo-automated-article-writing",
  "write-seo-articles-faster-without-sacrificing-quality": "ai-content-generator-seo-automated-article-writing",
  "text-generator-seo-free-vs-automated": "ai-content-generator-seo-automated-article-writing",
  "free-seo-content-generator-evaluation-guide": "ai-content-generator-seo-automated-article-writing",
  // AI vs manual writing
  "automated-vs-manual-seo-content-creation-roi": "ai-content-generator-vs-manual-writing-rankings",
  "how-fast-ai-write-articles-ranking-seo": "ai-content-generator-vs-manual-writing-rankings",
  // Content automation
  "automatic-content-creation": "intelligent-content-automation",
  "ai-content-automation-governance-workflow": "intelligent-content-automation",
  // Evaluating content automation tools
  "content-automation-platforms-explained": "ai-powered-content-generation",
  // On-page and off-page SEO
  "on-page-off-page-optimization-seo-tactics": "on-page-off-page-seo-strategy-guide",
  "on-page-off-page-optimization-integrated-seo-strategy": "on-page-off-page-seo-strategy-guide",
  "on-page-off-page-seo-complete-framework": "on-page-off-page-seo-strategy-guide",
  "off-page-seo-for-website": "on-page-off-page-seo-strategy-guide",
  // B2B and SaaS content strategy
  "saas-blog-strategy-scaling-content": "b2b-saas-content-strategy-ranking-lead-generation",
  "best-practices-content-marketing-strategy-saas-b2b": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-content-marketing-best-practice-automated-authority": "b2b-saas-content-strategy-ranking-lead-generation",
  "best-practices-content-marketing-2024": "b2b-saas-content-strategy-ranking-lead-generation",
  "content-marketing-best-practices-scaling-strategy": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-lead-generation-seo-content-strategy": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-conversion-rate-optimization-seo-traffic-customers": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-conversion-optimization-seo-traffic-qualified-leads": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-conversion-rate-optimization-content-automation": "b2b-saas-content-strategy-ranking-lead-generation",
  "b2b-conversion-optimisation-quality-content-sales-leads": "b2b-saas-content-strategy-ranking-lead-generation",
  // Fact-checking AI content
  "fact-check-ai-generated-content": "fact-check-ai-generated-content-verification-framework",
  // SEO tools for small teams
  "best-seo-tools-small-teams-2025": "best-free-seo-tools-for-small-teams",
  // Keyword research automation
  "keyword-research-automation-tools-best-practices": "automate-keyword-research-seo",
  "keyword-research-content-automation-practical-guide-3-edited": "automate-keyword-research-seo",
  // Keyword research by market
  "international-keyword-research": "localized-keyword-research-2",
  // Digital marketing keywords
  "keyword-research-digital-marketing-channel-routing": "digital-marketing-keyword-guide",
  // Publishing automatically
  "auto-posting-wordpress-methods-and-checks": "publish-blog-posts-wordpress-nextjs-automatically",
  "automated-publishing-software-content-workflow": "publish-blog-posts-wordpress-nextjs-automatically",
  // Ranking higher, faster
  "how-to-rank-articles-faster": "increase-seo-ranking",
  // Site SEO checks
  "technical-seo-audit-checklist-site-crawl-issues": "weekly-website-seo-health-checks",
  // SaaS SEO without a team
  "autonomous-content-marketing-saas-founders": "saas-seo-without-team",
  // Video marketing
  "video-marketing-best-practices-seo-integration": "best-practices-video-marketing-seo-optimized",
});

const normalizeHost = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

/** The article a consolidated pentra.dev slug now redirects to, or null. */
export function consolidatedTarget(domain: string, slug: string): string | null {
  if (normalizeHost(domain) !== PENTRA_DOMAIN) return null;
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  return Object.prototype.hasOwnProperty.call(PENTRA_CONSOLIDATED, clean) ? PENTRA_CONSOLIDATED[clean] : null;
}

/** True when an article is still served on its own URL (not consolidated away). */
export function servedOnItsOwnUrl(domain: string, slug: string): boolean {
  return consolidatedTarget(domain, slug) === null;
}

/** A link inside an article body, pointed straight at the article a consolidated
 * pentra.dev slug now redirects to (P193): Google follows no redirect hop and
 * spends no crawl on it. Any other link is returned unchanged. */
export function canonicalBlogHref(domain: string, href: string): string {
  const match = /^(?:https:\/\/(?:www\.)?pentra\.dev)?\/blog\/([a-z0-9-]+)\/?(?:[?#].*)?$/i.exec(href.trim());
  const target = match ? consolidatedTarget(domain, match[1].toLowerCase()) : null;
  return target ? `/blog/${target}` : href;
}
