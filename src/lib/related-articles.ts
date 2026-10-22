/** Related guides for a Pentra-hosted article page (P159, Oct 22 2026).
 *
 * 58 of pentra.dev's 80 articles linked to no other article, and most were
 * linked only from the /blog index (median one internal link in); Google left
 * 10 recent ones "discovered, currently not indexed". LeadPilot's articles,
 * whose site links 5-9 related articles from each page, are ~90% indexed.
 * Each page now links the articles that share the most title words with it,
 * plus the newest ones, so every article has several links in and a new
 * article is linked from every page until newer ones arrive. */
const STOP_WORDS = new Set(["about", "after", "all", "and", "are", "before", "best", "can", "complete", "does", "for", "from",
  "guide", "guides", "how", "into", "its", "more", "practical", "step", "steps", "than", "that", "the", "their", "this", "tips",
  "ultimate", "vs", "ways", "what", "when", "where", "which", "who", "why", "with", "without", "you", "your"]);

function titleWords(title: string, slug: string): Set<string> {
  return new Set(`${title} ${slug.replace(/[-/]+/g, " ")}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word.length > 2 && !/^\d+$/.test(word) && !STOP_WORDS.has(word))
    .map((word) => word.replace(/ies$/, "y").replace(/(?<!s)s$/, "")));
}

export function relatedArticles<T extends { slug: string; title: string; createdAt: number }>(
  current: { slug: string; title: string },
  articles: readonly T[],
  options: { related?: number; newest?: number } = {},
): T[] {
  const currentSlug = current.slug.replace(/^\/+|\/+$/g, "");
  const others = articles.filter((article) => article.title && article.slug.replace(/^\/+|\/+$/g, "") !== currentSlug);
  const mine = titleWords(current.title, currentSlug);
  const shared = (article: T) => [...titleWords(article.title, article.slug)].filter((word) => mine.has(word)).length;
  const related = others.map((article) => ({ article, score: shared(article) })).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.article.createdAt - a.article.createdAt)
    .slice(0, options.related ?? 3).map(({ article }) => article);
  const newest = [...others].sort((a, b) => b.createdAt - a.createdAt).filter((article) => !related.includes(article))
    .slice(0, (options.related ?? 3) + (options.newest ?? 2) - related.length);
  return [...related, ...newest];
}
