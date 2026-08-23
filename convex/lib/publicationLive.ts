import { normalizeSiteOrigin } from "./articleQuality.ts";
import { publishedArticleInternalHref } from "./internalLinks.ts";
import { publicationDeliveryKey } from "./publicationArtifact.ts";
import { PUBLICATION_LEASE_MS } from "./publicationLease.ts";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./publicationReceipts.ts";

/**
 * A stored public-page check is useful evidence, but it is not permanent
 * evidence. Authority outreach can offer a page for weeks after publication,
 * so require a recent receipt and then fetch the page again in the Node action
 * before an opportunity is persisted, drafted, or sent.
 */
export const AUTHORITY_TARGET_PUBLIC_RECEIPT_MAX_AGE_MS =
  30 * 24 * 60 * 60 * 1000;

type AuthorityTargetSite = {
  domain: string;
  urlStructure?: string;
  publishMethod?: string;
};

export type AuthorityTargetArticle<TId extends string = string> = {
  _id: TId;
  status: string;
  title: string;
  slug: string;
  metaKeywords?: string[];
  publishedContentHash?: string;
  publicationDeliveryHash?: string;
  publicationReceipt?: PublicationReceipt;
  publishedAt?: number;
  publicUrl?: string;
  publicUrlStatus?: "pending" | "verified" | "failed";
  publicUrlLastCheckedAt?: number;
  publicUrlVerifiedAt?: number;
  publicUrlCheckAttempts?: number;
};

export type VerifiedAuthorityTarget<TId extends string = string> = {
  articleId: TId;
  title: string;
  slug: string;
  metaKeywords?: string[];
  targetUrl: string;
  publicUrlVerifiedAt: number;
};

export function canonicalPublicationUrl(value: string): string {
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

/**
 * Return an article only when the durable publication record proves that the
 * exact tenant URL was delivered and recently observed live. `ready` is never
 * publication evidence. This pure gate is used by owner and growth scans and
 * is repeated when a draft is prepared and when a delivery is claimed.
 */
export function verifiedAuthorityTarget<TId extends string>(input: {
  site: AuthorityTargetSite;
  article: AuthorityTargetArticle<TId>;
  now: number;
}): VerifiedAuthorityTarget<TId> | null {
  const { article, site, now } = input;
  if (
    article.status !== "published" ||
    !Number.isFinite(now) ||
    !Number.isFinite(article.publishedAt) ||
    !Number.isFinite(article.publicUrlVerifiedAt) ||
    !Number.isFinite(article.publicUrlLastCheckedAt) ||
    article.publicUrlStatus !== "verified" ||
    article.publicUrlCheckAttempts === undefined ||
    article.publicUrlCheckAttempts < 1 ||
    article.publicUrlLastCheckedAt !== article.publicUrlVerifiedAt ||
    article.publicUrlVerifiedAt! < article.publishedAt! ||
    article.publicUrlVerifiedAt! > now + 5_000 ||
    now - article.publicUrlVerifiedAt! >
      AUTHORITY_TARGET_PUBLIC_RECEIPT_MAX_AGE_MS ||
    !article.publicationReceipt ||
    !article.publishedContentHash ||
    !article.publicationDeliveryHash
  ) {
    return null;
  }

  try {
    const receipt = validatePublicationReceipt(article.publicationReceipt);
    const targetUrl = publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    if (
      article.publicUrl !== targetUrl ||
      receipt.method !== (site.publishMethod ?? "github") ||
      receipt.contentHash !== article.publishedContentHash ||
      receipt.deliveryKey !==
        publicationDeliveryKey(article.publicationDeliveryHash) ||
      receipt.status !== ({
        github: "committed",
        wordpress: "published",
        webhook: "accepted",
      } as const)[receipt.method] ||
      receipt.receivedAt < article.publishedAt! - PUBLICATION_LEASE_MS ||
      receipt.receivedAt > article.publishedAt! + 60_000 ||
      receipt.receivedAt > now + 5_000 ||
      (
        receipt.method !== "github" &&
        canonicalPublicationUrl(receipt.url) !==
          canonicalPublicationUrl(targetUrl)
      )
    ) {
      return null;
    }
    return {
      articleId: article._id,
      title: article.title,
      slug: article.slug,
      metaKeywords: article.metaKeywords,
      targetUrl,
      publicUrlVerifiedAt: article.publicUrlVerifiedAt!,
    };
  } catch {
    return null;
  }
}

export function selectVerifiedAuthorityTargets<TId extends string>(input: {
  site: AuthorityTargetSite;
  articles: AuthorityTargetArticle<TId>[];
  now: number;
  focusArticleId?: TId;
}): VerifiedAuthorityTarget<TId>[] {
  return input.articles.flatMap((article) => {
    if (input.focusArticleId && article._id !== input.focusArticleId) return [];
    const target = verifiedAuthorityTarget({
      site: input.site,
      article,
      now: input.now,
    });
    return target ? [target] : [];
  });
}

export function verifyLivePublicationPage(input: {
  expectedUrl: string;
  fetchedUrl: string;
  html: string;
  title: string;
}): void {
  if (
    canonicalPublicationUrl(input.fetchedUrl) !==
    canonicalPublicationUrl(input.expectedUrl)
  ) {
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
