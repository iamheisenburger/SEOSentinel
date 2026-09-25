import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { api } from "../../../convex/_generated/api";
import { LandingNav } from "@/components/layout/landing-nav";
import { convexHttp } from "@/lib/convexHttpClient";
import { servedOnItsOwnUrl } from "@/lib/pentra-consolidation";

// Server-rendered so search engines see every article link in the HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO and content guides",
  description: "Practical guides on SEO, content and winning customers from Google and AI answers, written and fact-checked by Pentra.",
};

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
  try { articles = (await convexHttp.query(api.blog.listPublishedByDomain, { domain })).filter(article => servedOnItsOwnUrl(domain, article.slug)); }
  catch { articles = null; }
  // Structured data so Google and AI answer engines understand the index and its posts.
  const blogSchema = {
    "@context": "https://schema.org", "@type": "Blog", name: "SEO and content guides", url: `https://${domain}/blog`,
    blogPost: (articles ?? []).slice(0, 30).map(article => ({ "@type": "BlogPosting", headline: article.title,
      url: `https://${domain}/blog/${article.slug}`, datePublished: new Date(article.createdAt).toISOString() })),
  };

  return (
    <div className="min-h-screen bg-[#08090A] text-[#F7F8F8]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogSchema).replace(/</g, "\\u003c") }} />
      <LandingNav />

      <main className="mx-auto w-full max-w-[1200px] px-6 pt-32 pb-24 md:pt-40">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]">Guides</p>
        <h1 className="mt-4 max-w-[16ch] text-[clamp(2.4rem,5.5vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-[#F7F8F8]">
          SEO and content guides
        </h1>
        <p className="mt-5 max-w-[38rem] text-[17px] leading-relaxed text-[#8A8F98]">
          Practical guides on SEO, content and getting customers from Google and AI answers. Every article is
          written, fact-checked and published by Pentra.
        </p>

        {articles === null && (
          <p className="mt-16 text-[15px] text-[#62666D]">Articles could not be loaded. Please refresh.</p>
        )}

        {articles && articles.length === 0 && (
          <p className="mt-16 text-[15px] text-[#62666D]">No articles published yet. Check back soon.</p>
        )}

        {articles && articles.length > 0 && (
          <ol className="mt-16 border-t border-white/[0.06]">
            {articles.map((article) => (
              <li key={article._id} className="border-b border-white/[0.06]">
                <Link href={`/blog/${article.slug}`} className="group grid gap-2 py-7 md:grid-cols-[10rem_1fr_auto] md:items-baseline md:gap-8">
                  <span className="flex items-center gap-2 text-[13px] text-[#62666D]">
                    {format(new Date(article.createdAt), "MMM d, yyyy")}
                    {article.readingTime && <span className="flex items-center gap-1 md:hidden"><Clock className="h-3 w-3" />{article.readingTime} min</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[18px] font-medium leading-snug tracking-[-0.01em] text-[#F7F8F8] transition-colors group-hover:text-white md:text-[20px]">
                      {article.title}
                    </span>
                    {article.metaDescription && (
                      <span className="mt-2 block max-w-[46rem] text-[14.5px] leading-relaxed text-[#8A8F98] line-clamp-2">
                        {article.metaDescription}
                      </span>
                    )}
                  </span>
                  <span className="hidden items-center gap-3 text-[13px] text-[#62666D] md:flex">
                    {article.readingTime && <span>{article.readingTime} min read</span>}
                    <ArrowRight className="h-4 w-4 text-[#62666D] transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
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
