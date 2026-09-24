import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { api } from "../../../convex/_generated/api";
import { LandingNav } from "@/components/layout/landing-nav";
import { convexHttp } from "@/lib/convexHttpClient";

// Server-rendered so search engines see every article link in the HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO and content guides",
  description: "Practical guides on SEO, content and winning customers from Google and AI answers, researched and fact-checked with Pentra.",
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
  try { articles = await convexHttp.query(api.blog.listPublishedByDomain, { domain }); }
  catch { articles = null; }
  // Structured data so Google and AI answer engines understand the index and its posts.
  const blogSchema = {
    "@context": "https://schema.org", "@type": "Blog", name: "SEO and content guides", url: `https://${domain}/blog`,
    blogPost: (articles ?? []).slice(0, 30).map(article => ({ "@type": "BlogPosting", headline: article.title,
      url: `https://${domain}/blog/${article.slug}`, datePublished: new Date(article.createdAt).toISOString() })),
  };

  return (
    <div className="min-h-screen bg-[#08090E]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogSchema).replace(/</g, "\\u003c") }} />
      <LandingNav />

      <main className="mx-auto max-w-4xl px-6 pt-32 pb-20">
        <h1 className="text-3xl font-bold text-[#EDEEF1] tracking-tight">
          Blog
        </h1>
        <p className="mt-2 text-[15px] text-[#8B8FA3]">
          Practical guides on SEO, content and getting customers from Google and AI answers. Every article is
          researched on the live web and fact-checked before it is published.
        </p>

        {articles === null && (
          <p className="mt-16 text-center text-[15px] text-[#565A6E]">Articles could not be loaded. Please refresh.</p>
        )}

        {articles && articles.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-[15px] text-[#565A6E]">
              No articles published yet. Check back soon.
            </p>
          </div>
        )}

        {articles && articles.length > 0 && (
          <div className="mt-10 flex flex-col gap-0 divide-y divide-white/[0.06]">
            {articles.map((article) => (
              <Link
                key={article._id}
                href={`/blog/${article.slug}`}
                className="group flex flex-col gap-3 py-8 first:pt-0 transition-colors"
              >
                {article.featuredImage && (
                  <div className="overflow-hidden rounded-lg border border-white/[0.06]">
                    <img
                      src={article.featuredImage}
                      alt={article.title}
                      className="w-full h-48 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-3 text-[12px] text-[#565A6E]">
                    <span>
                      {format(new Date(article.createdAt), "MMM d, yyyy")}
                    </span>
                    {article.readingTime && (
                      <>
                        <span className="text-white/[0.08]">&middot;</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {article.readingTime} min read
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-[#EDEEF1] group-hover:text-[#0EA5E9] transition-colors">
                    {article.title}
                  </h2>
                  {article.metaDescription && (
                    <p className="mt-1.5 text-[14px] text-[#8B8FA3] line-clamp-2 leading-relaxed">
                      {article.metaDescription}
                    </p>
                  )}
                  <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-[#0EA5E9]">
                    Read article
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
