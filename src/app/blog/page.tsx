"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { Clock, ArrowRight } from "lucide-react";
import { format } from "date-fns";

const DOMAIN = "pentra.dev";

export default function BlogIndex() {
  const articles = useQuery(api.articles.listPublishedByDomain, {
    domain: DOMAIN,
  });

  return (
    <div className="min-h-screen bg-[#08090E]">
      <LandingNav />

      <main className="mx-auto max-w-4xl px-6 pt-32 pb-20">
        <h1 className="text-3xl font-bold text-[#EDEEF1] tracking-tight">
          Blog
        </h1>
        <p className="mt-2 text-[15px] text-[#8B8FA3]">
          Insights on SEO, content strategy, and AI-powered publishing.
        </p>

        {articles === undefined && (
          <div className="mt-12 flex flex-col gap-6">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6 animate-pulse"
              >
                <div className="h-5 w-2/3 rounded bg-white/[0.04]" />
                <div className="mt-3 h-3 w-full rounded bg-white/[0.03]" />
                <div className="mt-2 h-3 w-4/5 rounded bg-white/[0.03]" />
              </div>
            ))}
          </div>
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
