/**
 * Relevance matching between a dead link and one of our articles.
 *
 * A replacement suggestion is only credible when our page genuinely covers
 * what the dead link covered. The previous matcher tokenised article titles
 * naively, so stopwords like "to", "the" and "for" matched almost any URL and
 * every opportunity was answered with the same article — which is exactly the
 * kind of irrelevant pitch that gets outreach marked as spam.
 *
 * Pure and deterministic so the matching can be tested without a data
 * provider.
 */

/** Bump when tokenisation or scoring changes. */
export const LINK_RELEVANCE_VERSION = 1;

/**
 * Both gates must clear. One shared term is coincidence — "conversion" and
 * "marketing" appear on half the web — so a match needs two distinct terms,
 * at least one of which is a keyword the tenant actually declared.
 */
export const MIN_RELEVANCE_SCORE = 3;
export const MIN_MATCHED_TERMS = 2;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "you", "our",
  "are", "was", "were", "how", "what", "why", "when", "who", "which", "into",
  "onto", "about", "over", "under", "than", "then", "them", "they", "their",
  "will", "can", "could", "should", "would", "have", "has", "had", "not",
  "but", "all", "any", "some", "more", "most", "other", "such", "only",
  "just", "also", "very", "best", "top", "guide", "complete", "ultimate",
  "blog", "post", "article", "page", "www", "com", "http", "https", "html",
  "index", "new", "now", "get", "use", "using", "make", "does", "did", "here",
  "out", "off", "its", "his", "her", "one", "two",
]);

/**
 * Split text or a URL into comparable terms. Short tokens and stopwords are
 * dropped because they carry no topical signal.
 */
export function relevanceTokens(value: string): Set<string> {
  const words = String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/);
  const tokens = new Set<string>();
  for (const word of words) {
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    tokens.add(word);
  }
  return tokens;
}

export type RelevanceCandidate = {
  articleId: string;
  title: string;
  slug: string;
  metaKeywords?: string[];
};

export type RelevanceMatch<T extends RelevanceCandidate> = {
  article: T;
  score: number;
  matchedTerms: string[];
};

/**
 * Score how well one article answers a dead link.
 *
 * A term the tenant explicitly declared as a target keyword counts double: it
 * is a stated topic rather than an incidental word in a headline.
 */
export function relevanceScore(args: {
  anchorText?: string;
  brokenUrl?: string;
  article: RelevanceCandidate;
}): { score: number; matchedTerms: string[] } {
  const wanted = new Set([
    ...relevanceTokens(args.anchorText ?? ""),
    ...relevanceTokens(args.brokenUrl ?? ""),
  ]);
  if (wanted.size === 0) return { score: 0, matchedTerms: [] };

  const keywordTokens = new Set<string>();
  for (const keyword of args.article.metaKeywords ?? []) {
    for (const token of relevanceTokens(keyword)) keywordTokens.add(token);
  }
  const titleTokens = new Set([
    ...relevanceTokens(args.article.title),
    ...relevanceTokens(args.article.slug),
  ]);

  let score = 0;
  const matchedTerms: string[] = [];
  for (const term of wanted) {
    if (keywordTokens.has(term)) {
      score += 2;
      matchedTerms.push(term);
    } else if (titleTokens.has(term)) {
      score += 1;
      matchedTerms.push(term);
    }
  }
  return { score, matchedTerms: matchedTerms.sort() };
}

/**
 * The best article to offer as a replacement, or null when nothing we have
 * published is close enough. Returning null is the point: offering an
 * unrelated page is worse than not writing at all.
 */
export function bestReplacementArticle<T extends RelevanceCandidate>(args: {
  anchorText?: string;
  brokenUrl?: string;
  articles: T[];
  minScore?: number;
}): RelevanceMatch<T> | null {
  const threshold = args.minScore ?? MIN_RELEVANCE_SCORE;
  let best: RelevanceMatch<T> | null = null;
  for (const article of args.articles) {
    const { score, matchedTerms } = relevanceScore({
      anchorText: args.anchorText,
      brokenUrl: args.brokenUrl,
      article,
    });
    if (score < threshold || matchedTerms.length < MIN_MATCHED_TERMS) continue;
    // Ties resolve by article id so the same inputs always pick the same page.
    if (
      !best ||
      score > best.score ||
      (score === best.score && article.articleId < best.article.articleId)
    ) {
      best = { article, score, matchedTerms };
    }
  }
  return best;
}
