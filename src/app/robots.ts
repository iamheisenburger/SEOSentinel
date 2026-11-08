import type { MetadataRoute } from "next";
import { isHostedAnswersHost, requestHost } from "@/lib/hosted-answers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Pentra Answers (Nov 2026): a customer's hosted answers address lists its own sitemap.
  const host = await requestHost();
  if (isHostedAnswersHost(host)) return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `https://${host}/sitemap.xml` };
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/"],
      },
    ],
    sitemap: "https://pentra.dev/sitemap.xml",
  };
}
