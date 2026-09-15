import { z } from "zod";

/** Recover one redundant display field from the provider's own SEO headline.
 * This changes neither the retained raw receipt nor the article body, and does
 * not confer quality approval. Missing/invalid substantive fields still fail.
 */
export function recoverArticleToolTitle(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const article = value as Record<string, unknown>;
  if (article.title !== undefined || typeof article.metaTitle !== "string") return value;
  const title = article.metaTitle.trim();
  if (!title || title.length > 65 || /[\r\n\x00-\x1f]/.test(title)) return value;
  return { ...article, title };
}

export const ArticleSchema = z.preprocess(recoverArticleToolTitle, z.object({
  title: z.string(),
  slug: z.string(),
  markdown: z.string(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.array(z.string()).optional(),
  sources: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional(),
}));
