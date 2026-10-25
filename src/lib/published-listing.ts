import { unstable_cache } from "next/cache";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";

/** A domain's published articles for listings (the /blog index, the "Related
 * guides" of each article page and the home page's latest guides), read from
 * Convex at most every 6 hours per domain (P167, P169, P182, V9: ~1 MB a read
 * on pentra.dev by Oct 25, growing with each revised article, and the home
 * page read it separately every hour). A new article joins the listings within
 * 6 hours; the article page itself and the sitemap are read fresh, so
 * delivery, live checks and Google's discovery never see a stale copy. */
export const cachedPublishedListing = unstable_cache(
  async (domain: string) => convexHttp.query(api.blog.listPublishedByDomain, { domain }),
  ["blog-related-listing"],
  { revalidate: 21_600 },
);
