import { unstable_cache } from "next/cache";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";

/** A domain's published articles for listings (the /blog index and the
 * "Related guides" of each article page), read from Convex at most hourly per
 * domain (P167, P169, V9: about 0.55 MB a read, and the index read it on every
 * view). A new article joins the listings within the hour; the article page
 * itself is read fresh, so delivery and live checks never see a stale copy. */
export const cachedPublishedListing = unstable_cache(
  async (domain: string) => convexHttp.query(api.blog.listPublishedByDomain, { domain }),
  ["blog-related-listing"],
  { revalidate: 3600 },
);
