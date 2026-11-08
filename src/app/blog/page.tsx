import type { Metadata } from "next";
import { pageSocial } from "@/lib/page-social";
import { headers } from "next/headers";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { api } from "../../../convex/_generated/api";
import { LandingNav } from "@/components/layout/landing-nav";
import { convexHttp } from "@/lib/convexHttpClient";
import { servedOnItsOwnUrl } from "@/lib/pentra-consolidation";
import { cachedPublishedListing } from "@/lib/published-listing";

// Server-rendered so search engines see every article link in the HTML.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const domain = await requestDomain();
  return {
    title: "SEO and content guides",
    description: "Practical guides on SEO, content and winning customers from Google, written and fact-checked by Pentra.",
    alternates: { canonical: `https://${domain}/blog` },
    ...pageSocial("SEO and content guides", "Practical guides on SEO, content and winning customers from Google, written and fact-checked by Pentra.", `https://${domain}/blog`),
  };
}

async function requestDomain(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || requestHeaders.get("host")?.trim();
  for (const candidate of [host, process.env.NEXT_PUBLIC_SITE_URL?.trim()]) {
    if (!candidate) continue;
    try {
      const url = new URL(/^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`);
      if (url.hostname) return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch { /* try the next candidate */ }
  }
  return "pentra.dev";
}

export default async function BlogIndex() {
  const domain = await requestDomain();
  let articles: Awaited<ReturnType<typeof convexHttp.query<typeof api.blog.listPublishedByDomain>>> | null = null;
  // Read at most hourly per domain, not on every view (P169, V9).
  try { articles = (await cachedPublishedListing(domain)).filter(article => servedOnItsOwnUrl(domain, article.slug)); }
  catch { articles = null; }
  // Structured data so Google and AI answer engines understand the index and its posts.
  const blogSchema = {
    "@context": "https://schema.org", "@type": "Blog", name: "SEO and content guides", url: `https://${domain}/blog`,
    blogPost: (articles ?? []).slice(0, 30).map(article => ({ "@type": "BlogPosting", headline: article.title,
      url: `https://${domain}/blog/${article.slug}`, datePublished: new Date(article.createdAt).toISOString() })),
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogSchema).replace(/</g, "\\u003c") }} />
      <LandingNav />

      <main id="main" className="page-enter container-page pb-24 pt-[124px] sm:pt-[140px] lg:pb-32 lg:pt-[164px]">
        <h1 className="type-h1 max-w-[16ch] text-text">SEO and content guides</h1>
        <p className="type-lead mt-5 max-w-[38rem]">
          Practical guides on SEO, content and getting customers from Google. Every article is
          written, fact-checked and published by Pentra.
        </p>

        {articles === null && (
          <p className="mt-16 text-[15px] text-text-3">Articles could not be loaded. Please refresh.</p>
        )}

        {articles && articles.length === 0 && (
          <p className="mt-16 text-[15px] text-text-3">No articles published yet. Check back soon.</p>
        )}

        {articles && articles.length > 0 && (
          <ol className="mt-14 border-t border-border lg:mt-16">
            {articles.map((article) => (
              <li key={article._id} className="border-b border-border">
                <Link href={`/blog/${article.slug}`} className="group grid grid-cols-1 gap-2 py-6 md:grid-cols-[9rem_1fr_auto] md:items-baseline md:gap-8 md:py-7">
                  <span className="mono-label flex items-center gap-3 text-text-3">
                    {format(new Date(article.createdAt), "MMM d, yyyy")}
                    {article.readingTime && <span className="flex items-center gap-1 md:hidden"><Clock className="h-3 w-3" strokeWidth={1.75} />{article.readingTime} min</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[18px] font-medium leading-[26px] tracking-[-0.01em] text-text md:text-[20px] md:leading-7">
                      {article.title}
                    </span>
                    {article.metaDescription && (
                      <span className="mt-2 line-clamp-2 block max-w-[46rem] text-[15px] leading-6 text-text-2">
                        {article.metaDescription}
                      </span>
                    )}
                  </span>
                  <span className="hidden items-center gap-3 text-[13px] text-text-3 md:flex">
                    {article.readingTime && <span className="tabular-nums">{article.readingTime} min read</span>}
                    <ArrowRight className="h-4 w-4 text-text-4 transition-[translate,color] duration-[var(--d-state)] group-hover:translate-x-0.5 group-hover:text-text" strokeWidth={1.75} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
