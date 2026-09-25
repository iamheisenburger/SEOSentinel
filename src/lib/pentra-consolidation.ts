/**
 * pentra.dev's own blog, consolidated (owner decision, Sep 25 2026): the old
 * engine published many near-duplicate articles on the same searches. Each
 * group now points to its strongest article with a permanent redirect, so
 * Google sees one page per topic. The articles themselves are kept unchanged
 * in Pentra; only pentra.dev stops serving the duplicates.
 *
 * duplicate slug → the article it now redirects to
 */
export const PENTRA_DOMAIN = "pentra.dev";

export const PENTRA_CONSOLIDATED: Readonly<Record<string, string>> = Object.freeze({
  // How to refresh old posts
  "how-to-refresh-blog-posts-for-seo": "article-refresh-strategy-guide",
  "content-refresh-seo-automated-strategy": "article-refresh-strategy-guide",
  "automated-article-refresh-keep-posts-ranking": "article-refresh-strategy-guide",
  // When / how often to update posts
  "when-update-blog-posts-seo": "when-update-blog-posts-seo-rankings",
  "best-time-update-blog-posts-seo": "when-update-blog-posts-seo-rankings",
  "how-often-update-blog-posts-seo": "when-update-blog-posts-seo-rankings",
  "when-to-update-blog-posts-seo": "when-update-blog-posts-seo-rankings",
  "when-to-refresh-old-blog-posts-2": "when-update-blog-posts-seo-rankings",
  "when-to-refresh-old-blog-posts": "when-update-blog-posts-seo-rankings",
  // Which posts to update first
  "which-blog-posts-to-update-first": "which-articles-to-refresh-first-ranking-data",
  // Why posts lose traffic (content decay)
  "why-articles-stop-ranking-content-decay": "why-blog-posts-stop-getting-traffic-fix",
  "why-articles-lose-rankings-content-decay": "why-blog-posts-stop-getting-traffic-fix",
  "why-blog-posts-lose-rankings-content-decay": "why-blog-posts-stop-getting-traffic-fix",
  // Detecting ranking drops
  "detect-declining-blog-posts-before-rankings-drop": "how-to-detect-ranking-drops-seo",
  "detect-declining-rankings-before-traffic-drops": "how-to-detect-ranking-drops-seo",
  "detect-blog-posts-stop-ranking": "how-to-detect-ranking-drops-seo",
  "detect-blog-posts-stop-ranking-content-decay": "how-to-detect-ranking-drops-seo",
  "detect-content-decay-ranking-drops-guide": "how-to-detect-ranking-drops-seo",
  // Automating rank monitoring
  "automated-seo-ranking-monitoring-setup-guide": "how-to-automate-seo-ranking-monitoring",
  "automated-seo-monitoring-rank-tracking": "how-to-automate-seo-ranking-monitoring",
  "automated-seo-monitoring-daily-metrics-checklist": "how-to-automate-seo-ranking-monitoring",
  "automated-ranking-monitoring-track-fix-declining-articles": "how-to-automate-seo-ranking-monitoring",
  "monitor-seo-rankings-automatically": "how-to-automate-seo-ranking-monitoring",
  // Rank monitoring tools
  "seo-ranking-monitoring-tools-automated-vs-manual": "best-seo-monitoring-tools-small-teams",
  // Content gaps
  "detect-content-gaps-automatically": "how-to-detect-seo-content-gaps-website",
  "detect-content-gaps-website-automatically": "how-to-detect-seo-content-gaps-website",
  "how-to-detect-content-gaps-website": "how-to-detect-seo-content-gaps-website",
  "find-content-gaps-website-seo": "how-to-detect-seo-content-gaps-website",
  "content-gap-analysis-seo": "how-to-detect-seo-content-gaps-website",
  // Keyword clustering
  "keyword-clustering-for-content-planning": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-explained": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-content-planning": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-for-seo-guide": "keyword-clustering-strategy-organize-by-intent",
  "keyword-clustering-seo-strategy-guide": "keyword-clustering-strategy-organize-by-intent",
  // Automating the content calendar
  "automated-seo-content-calendar-30-minutes": "automate-seo-content-calendar",
  "automate-seo-content-calendar-planning": "automate-seo-content-calendar",
  // Content calendar tools
  "automated-content-calendar-tools-comparison": "seo-content-calendar-tools-small-teams",
  // Publishing frequency
  "saas-blog-publishing-frequency-rankings": "how-often-publish-blog-posts-seo",
  // Automating the SEO workflow
  "how-to-automate-seo-workflow": "automated-seo-workflow-complete-guide",
  "automate-seo-content-pipeline": "automated-seo-workflow-complete-guide",
  // SEO articles at scale without writers
  "write-seo-articles-at-scale-without-hiring": "automate-seo-article-writing-at-scale",
  "seo-content-at-scale-building-articles-without-team": "automate-seo-article-writing-at-scale",
  "automate-seo-content-creation-without-writers": "automate-seo-article-writing-at-scale",
  // AI content generators for SEO
  "ai-seo-content-generator-rankings": "ai-content-generator-seo-automated-article-writing",
  "ai-seo-content-writing-autonomous-tools": "ai-content-generator-seo-automated-article-writing",
  "ai-article-writer-seo-ranking": "ai-content-generator-seo-automated-article-writing",
  "ai-content-generator-seo-articles": "ai-content-generator-seo-automated-article-writing",
  // AI vs manual writing
  "automated-vs-manual-seo-content-creation-roi": "ai-content-generator-vs-manual-writing-rankings",
  // Free content generators
  "free-seo-content-generator-evaluation-guide": "text-generator-seo-free-vs-automated",
  // On-page and off-page SEO
  "on-page-off-page-optimization-seo-tactics": "on-page-off-page-seo-strategy-guide",
  "on-page-off-page-optimization-integrated-seo-strategy": "on-page-off-page-seo-strategy-guide",
  "on-page-off-page-seo-complete-framework": "on-page-off-page-seo-strategy-guide",
  // Content marketing best practices
  "b2b-content-marketing-best-practice-automated-authority": "best-practices-content-marketing-strategy-saas-b2b",
  "best-practices-content-marketing-2024": "best-practices-content-marketing-strategy-saas-b2b",
  "content-marketing-best-practices-scaling-strategy": "best-practices-content-marketing-strategy-saas-b2b",
  // B2B conversion rate optimization
  "b2b-conversion-optimization-seo-traffic-qualified-leads": "b2b-conversion-rate-optimization-seo-traffic-customers",
  "b2b-conversion-rate-optimization-content-automation": "b2b-conversion-rate-optimization-seo-traffic-customers",
  "b2b-conversion-optimisation-quality-content-sales-leads": "b2b-conversion-rate-optimization-seo-traffic-customers",
  // Fact-checking AI content
  "fact-check-ai-generated-content": "fact-check-ai-generated-content-verification-framework",
  // SEO tools for small teams
  "best-seo-tools-small-teams-2025": "best-free-seo-tools-for-small-teams",
  // Keyword research automation
  "keyword-research-automation-tools-best-practices": "automate-keyword-research-seo",
  // SaaS content strategy
  "saas-blog-strategy-scaling-content": "b2b-saas-content-strategy-ranking-lead-generation",
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
