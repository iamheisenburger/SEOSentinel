import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Calendar, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import { api } from "../../../../convex/_generated/api";
import { markdownHasSourcesSection } from "../../../../convex/lib/sourcesHeading";
import { LandingNav } from "@/components/layout/landing-nav";
import { convexHttp } from "@/lib/convexHttpClient";
import "./article-content.css";
import { articleFaq } from "@/lib/article-faq";
import { canonicalBlogHref, consolidatedTarget, retiredArticle, retiredHref, servedOnItsOwnUrl } from "@/lib/pentra-consolidation";
import { relatedArticles } from "@/lib/related-articles";
import { cachedPublishedListing } from "@/lib/published-listing";
import { publishedOrCommitted } from "@/lib/committed-articles";

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

// P240 (Oct 29 2026): when Convex cannot be read, a pentra.dev article is served from its committed file, not a 500.
const getPublishedArticle = cache(async (domain: string, slug: string) =>
  publishedOrCommitted(domain, slug, () => convexHttp.query(api.blog.getPublishedBySlug, { domain, slug })),
);

// The listing behind "Related guides", read at most hourly per domain (P167).
const getPublishedList = cachedPublishedListing;

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

function MarkdownRenderer({ markdown, domain, slug }: { markdown: string; domain: string; slug: string }) {
  return (
    <div className="article-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // The page already renders the article title as its only h1.
          h1: ({ children }) => <h2>{children}</h2>,
          a: ({ href, children }) => {
            // A link to a consolidated duplicate goes straight to its article;
            // one that would then point at this page stays plain text (P193).
            const target = href ? canonicalBlogHref(domain, href) : href;
            if (target !== href && target === `/blog/${slug}`) return <>{children}</>;
            if (href && retiredHref(domain, href)) return <>{children}</>;
            const safe = target?.startsWith("/") || target?.startsWith("https://");
            return safe ? <a href={target}>{children}</a> : <>{children}</>;
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
  const merged = consolidatedTarget(domain, slug);
  if (merged) permanentRedirect(`/blog/${merged}`);
  if (retiredArticle(domain, slug)) return { title: "Article not found", robots: { index: false, follow: false } };
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
    title: { absolute: article.metaTitle || article.title },
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
  // A consolidated duplicate on pentra.dev permanently points to its group's article.
  const merged = consolidatedTarget(domain, slug);
  if (merged) permanentRedirect(`/blog/${merged}`);
  // P246: a retired article (invented quotes or wrong prices from the old engine) is gone.
  if (retiredArticle(domain, slug)) notFound();
  const article = await getPublishedArticle(domain, slug);
  if (!article) notFound();

  // Related guides (P159): each article links the ones on its subject and the
  // newest, so none is reachable only from the blog index.
  let related: Awaited<ReturnType<typeof getPublishedList>> = [];
  try {
    related = relatedArticles(article, (await getPublishedList(domain)).filter((item) => servedOnItsOwnUrl(domain, item.slug)));
  } catch {
    // The article still renders without them.
  }

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

  const faqs = articleFaq(article.markdown);
  const faqSchema = faqs.length >= 2 ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  } : null;

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
    <div className="min-h-screen bg-[#08090A]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }}
        />
      )}
      <LandingNav />

      <main className="mx-auto max-w-[46rem] px-6 pt-32 pb-24 md:pt-40">
        <Link
          href="/blog"
          className="mb-10 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#8A8F98] transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All guides
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

        <h1 className="text-[clamp(2rem,4.6vw,3rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-[#F7F8F8] [text-wrap:balance]">
          {article.title}
        </h1>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[0.06] pb-8 text-[13px] text-[#62666D]">
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
            <span className="flex items-center gap-1.5 text-[#4CB782]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Fact-checked
            </span>
          )}
        </div>

        <div className="mt-10">
          <MarkdownRenderer markdown={article.markdown} domain={domain} slug={slug} />
        </div>

        {article.sources && article.sources.length > 0 && !markdownHasSourcesSection(article.markdown) && (
          <div className="mt-12 pt-8 border-t border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-[#F7F8F8] mb-4">
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

        {related.length > 0 && (
          <nav aria-labelledby="related-guides-heading" className="mt-12 pt-8 border-t border-white/[0.06]">
            <h2 id="related-guides-heading" className="text-[14px] font-semibold text-[#F7F8F8] mb-4">
              Related guides
            </h2>
            <ul className="flex flex-col gap-2">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className="text-[14px] text-[#0EA5E9] hover:text-[#38BDF8] underline underline-offset-2 transition"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </main>
    </div>
  );
}
