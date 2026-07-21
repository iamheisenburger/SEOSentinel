import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Calendar, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import { api } from "../../../../convex/_generated/api";
import { LandingNav } from "@/components/layout/landing-nav";
import { convexHttp } from "@/lib/convexHttpClient";

export const dynamic = "force-dynamic";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

const getRequestDomain = cache(async (): Promise<string> => {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const requestHost = forwardedHost || requestHeaders.get("host")?.trim();
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  for (const candidate of [requestHost, configuredSiteUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(
        candidate.startsWith("http://") || candidate.startsWith("https://")
          ? candidate
          : `https://${candidate}`,
      );
      if (url.hostname) return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // Ignore malformed proxy/configuration values and try the safe fallback.
    }
  }

  return "pentra.dev";
});

const getPublishedArticle = cache(async (domain: string, slug: string) =>
  convexHttp.query(api.blog.getPublishedBySlug, { domain, slug }),
);

type PublishedArticle = NonNullable<
  Awaited<ReturnType<typeof getPublishedArticle>>
>;

function safeHttpsUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeSiteOrigin(raw: string): string | undefined {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      !hostname.includes(".")
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function canonicalUrlFor(article: PublishedArticle): string | undefined {
  const origin = safeSiteOrigin(article.domain);
  if (!origin) return undefined;

  const configuredTemplate = article.urlStructure ?? "/blog/[slug]";
  let decodedTemplate = "";
  try {
    decodedTemplate = decodeURIComponent(configuredTemplate);
  } catch {
    // Invalid encoded paths fall back to this route's known-safe structure.
  }
  const pathSegments = decodedTemplate.startsWith("/")
    ? decodedTemplate.slice(1).split("/")
    : [];
  const pathTemplate =
    !/[?#\\\u0000-\u001f]/.test(configuredTemplate) &&
    !/%(?:2f|5c|00)/i.test(configuredTemplate) &&
    pathSegments.length > 0 &&
    pathSegments.at(-1) === "[slug]" &&
    pathSegments.filter((segment) => segment === "[slug]").length === 1 &&
    pathSegments.every(
      (segment) =>
        segment === "[slug]" ||
        /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(segment),
    )
      ? `/${pathSegments.join("/")}`
      : "/blog/[slug]";
  const path = pathTemplate.replace(/\[slug\]/i, encodeURIComponent(article.slug));
  const canonical = new URL(path, origin);
  return canonical.origin === origin ? canonical.toString() : undefined;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function toIsoDate(timestamp: number | undefined): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <div className="article-content prose prose-invert max-w-none text-[#c9cdd8]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = href?.startsWith("/") || href?.startsWith("https://");
            return safe ? <a href={href}>{children}</a> : <>{children}</>;
          },
          img: ({ src, alt }) => {
            const safeSrc =
              typeof src === "string" ? safeHttpsUrl(src) : undefined;
            return safeSrc ? (
              <img
                src={safeSrc}
                alt={alt ?? ""}
                className="my-6 h-auto max-w-full rounded-xl"
              />
            ) : null;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const [{ slug }, domain] = await Promise.all([params, getRequestDomain()]);
  const article = await getPublishedArticle(domain, slug);

  if (!article) {
    return {
      title: "Article not found",
      robots: { index: false, follow: false },
    };
  }

  const canonical = canonicalUrlFor(article);
  const featuredImage = safeHttpsUrl(article.featuredImage);
  const description = article.metaDescription || undefined;

  return {
    title: { absolute: article.title },
    description,
    keywords: article.metaKeywords,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      type: "article",
      title: article.title,
      description,
      url: canonical,
      publishedTime: toIsoDate(article.publishedAt ?? article.createdAt),
      modifiedTime: toIsoDate(article.updatedAt ?? article.createdAt),
      siteName: article.siteName || undefined,
      images: featuredImage
        ? [{ url: featuredImage, alt: article.title }]
        : undefined,
    },
    twitter: {
      card: featuredImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
      images: featuredImage ? [featuredImage] : undefined,
    },
  };
}

export default async function BlogPost({ params }: BlogPostPageProps) {
  const [{ slug }, domain] = await Promise.all([params, getRequestDomain()]);
  const article = await getPublishedArticle(domain, slug);
  if (!article) notFound();

  const canonical = canonicalUrlFor(article);
  const origin = safeSiteOrigin(article.domain);
  const featuredImage = safeHttpsUrl(article.featuredImage);
  const publishedDate = toIsoDate(article.publishedAt ?? article.createdAt);
  const modifiedDate = toIsoDate(article.updatedAt ?? article.createdAt);
  const publisherName = article.siteName || article.domain;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.metaDescription || undefined,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    wordCount: article.wordCount || undefined,
    author: {
      "@type": "Organization",
      name: publisherName,
      url: origin,
    },
    publisher: {
      "@type": "Organization",
      name: publisherName,
      url: origin,
    },
    image: featuredImage,
    mainEntityOfPage: canonical
      ? { "@type": "WebPage", "@id": canonical }
      : undefined,
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      origin
        ? { "@type": "ListItem", position: 1, name: "Home", item: origin }
        : undefined,
      origin
        ? {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: new URL("/blog", origin).toString(),
          }
        : undefined,
      {
        "@type": "ListItem",
        position: 3,
        name: article.title,
        item: canonical,
      },
    ].filter(Boolean),
  };

  return (
    <div className="min-h-screen bg-[#08090E]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }}
      />
      <LandingNav />

      <main className="mx-auto max-w-3xl px-6 pt-32 pb-20">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#565A6E] hover:text-[#0EA5E9] transition mb-8"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to blog
        </Link>

        {featuredImage && (
          <div className="overflow-hidden rounded-xl border border-white/[0.06] mb-8">
            <img
              src={featuredImage}
              alt={article.title}
              className="w-full h-auto"
            />
          </div>
        )}

        <h1 className="text-3xl font-bold text-[#EDEEF1] tracking-tight leading-tight">
          {article.title}
        </h1>

        <div className="mt-4 flex items-center gap-4 text-[13px] text-[#565A6E]">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {format(new Date(article.createdAt), "MMMM d, yyyy")}
          </span>
          {article.readingTime && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {article.readingTime} min read
            </span>
          )}
          {article.factCheckScore && article.factCheckScore > 80 && (
            <span className="flex items-center gap-1 text-[#22C55E]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Fact-checked
            </span>
          )}
        </div>

        <div className="mt-10">
          <MarkdownRenderer markdown={article.markdown} />
        </div>

        {article.sources && article.sources.length > 0 && (
          <div className="mt-12 pt-8 border-t border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-[#EDEEF1] mb-4">
              Sources
            </h3>
            <ul className="flex flex-col gap-2">
              {article.sources.map((source, index) => {
                const sourceUrl = safeHttpsUrl(source.url);
                return sourceUrl ? (
                  <li key={`${sourceUrl}-${index}`}>
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-[#0EA5E9] hover:text-[#38BDF8] underline underline-offset-2 transition"
                    >
                      {source.title || sourceUrl}
                    </a>
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
