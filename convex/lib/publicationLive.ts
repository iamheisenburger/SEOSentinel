import { normalizeSiteOrigin } from "./articleQuality.ts";
import { publishedArticleInternalHref } from "./internalLinks.ts";

function canonicalUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname =
    parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
  return parsed.href;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'");
}

function normalizedVisibleText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return decodeHtmlEntities(
    body
      .replace(
        /<(?:head|script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:head|script|style|noscript|template|svg)>/gi,
        " ",
      )
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function publishedArticlePublicUrl(input: {
  domain: string;
  urlStructure?: string;
  slug: string;
}): string {
  const origin = normalizeSiteOrigin(input.domain);
  const path = publishedArticleInternalHref(input.urlStructure, input.slug);
  return new URL(path, `${origin}/`).href;
}

export function verifyLivePublicationPage(input: {
  expectedUrl: string;
  fetchedUrl: string;
  html: string;
  title: string;
}): void {
  if (canonicalUrl(input.fetchedUrl) !== canonicalUrl(input.expectedUrl)) {
    throw new Error("The public page resolved to a different canonical URL");
  }
  const title = decodeHtmlEntities(input.title)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!title || !normalizedVisibleText(input.html).includes(title)) {
    throw new Error(
      "The public page does not contain the published article title",
    );
  }
}
