export type CadenceArticle = {
  createdAt: number;
  status?: string;
};

export type CadenceWindow = {
  canGenerate: boolean;
  recentAttempts: number;
  hasRecentPublication: boolean;
};

export function evaluateCadenceWindow({
  articles,
  now,
  hoursPerArticle,
  maxAttempts,
}: {
  articles: CadenceArticle[];
  now: number;
  hoursPerArticle: number;
  maxAttempts: number;
}): CadenceWindow {
  const windowMs = Math.max(1, hoursPerArticle) * 60 * 60 * 1000;
  const recent = articles.filter(
    (article) =>
      article.createdAt <= now && now - article.createdAt < windowMs,
  );
  const hasRecentPublication = recent.some(
    (article) => article.status === "published",
  );

  return {
    canGenerate:
      !hasRecentPublication && recent.length < Math.max(1, maxAttempts),
    recentAttempts: recent.length,
    hasRecentPublication,
  };
}
