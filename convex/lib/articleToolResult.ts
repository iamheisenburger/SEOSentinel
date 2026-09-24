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

const ENVELOPE_FIELDS = new Set(["title", "slug", "metaTitle", "metaDescription", "metaKeywords", "sources", "notes"]);
const ENVELOPE_TAIL = /<\/markdown>\s*((?:<([A-Za-z]+)>[\s\S]*?<\/\2>\s*)*)$/;

/** A structured response sometimes closes the Markdown field with XML-style
 * tags and repeats the other fields inside the body, leaving placeholder text
 * (for example "wait" / "no.") in the real fields. Strip only that trailing
 * envelope, and only when every trailing tag is a known tool field. The raw
 * provider receipt is retained and all quality/review gates still apply. */
export function stripLeakedToolEnvelope(markdown: string): { markdown: string; fields: Record<string, string> } | null {
  const match = ENVELOPE_TAIL.exec(markdown);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const tag of match[1].matchAll(/<([A-Za-z]+)>([\s\S]*?)<\/\1>/g)) {
    if (!ENVELOPE_FIELDS.has(tag[1])) return null;
    fields[tag[1]] = tag[2].trim();
  }
  const body = markdown.slice(0, match.index).replace(/^\s*<markdown>\s*/, "").trimEnd();
  return body ? { markdown: body, fields } : null;
}

/** Recover search metadata from a leaked envelope only when the real field is
 * unusable and the leaked value fits the publication limits exactly. */
export function recoverLeakedArticleEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const article = value as Record<string, unknown>;
  if (typeof article.markdown !== "string") return value;
  const leaked = stripLeakedToolEnvelope(article.markdown);
  if (!leaked) return value;
  const next: Record<string, unknown> = { ...article, markdown: leaked.markdown };
  const oneLine = (text: string | undefined) => text && !/[\r\n<>]/.test(text) ? text : undefined;
  const title = oneLine(leaked.fields.metaTitle), description = oneLine(leaked.fields.metaDescription);
  const current = (field: string) => typeof article[field] === "string" ? (article[field] as string).trim() : "";
  if (title && title.length >= 10 && title.length <= 60 && current("metaTitle").length < 10) next.metaTitle = title;
  if (description && description.length >= 100 && description.length <= 155 && current("metaDescription").length < 100) next.metaDescription = description;
  return next;
}

export const ArticleSchema = z.preprocess(value => recoverArticleToolTitle(recoverLeakedArticleEnvelope(value)), z.object({
  title: z.string(),
  slug: z.string(),
  markdown: z.string(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.array(z.string()).optional(),
  sources: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional(),
}));
