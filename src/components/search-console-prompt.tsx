"use client";

import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

/** Search Console belongs to the customer's own Google account, so Pentra
 * cannot connect it for them. The dashboard says plainly what it unlocks:
 * without it Pentra publishes new articles but cannot see or improve the pages
 * Google already shows, or report results (Phase 4, Oct 20 2026). */
export function SearchConsolePrompt({ siteId }: { siteId: Id<"sites"> }) {
  return <section className="rounded-xl border border-[#0EA5E9]/25 bg-[#0EA5E9]/[0.05] px-5 py-4" aria-labelledby="search-console-prompt-heading">
    <h2 id="search-console-prompt-heading" className="text-[14px] font-semibold text-[#F7F8F8]">Connect Google Search Console</h2>
    <p className="mt-1.5 text-[13px] leading-relaxed text-[#C9CDD6]">
      Pentra uses it to see which searches already show your pages, then improves those pages and picks new topics you can win.
      Without it, Pentra can only publish new articles, and it can&apos;t show you clicks from Google.
    </p>
    <p className="mt-1 text-[12px] text-[#8A8F98]">Pentra reads your search data and submits your sitemap so Google finds new articles sooner. It takes about a minute.</p>
    <Button className="mt-3" size="sm" onClick={() => window.open(`/api/gsc/auth?siteId=${siteId}`, "gsc-connect", "width=600,height=720,popup=yes")}>
      Connect Search Console
    </Button>
  </section>;
}
