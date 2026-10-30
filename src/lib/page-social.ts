import type { Metadata } from "next";

/** P247 (Oct 30 2026): every public page inherited the homepage's link preview (og:title "Pentra — Autopilot SEO for
 * your website", og:url https://pentra.dev), so a shared /beta, /blog or Terms link previewed as the homepage. */
export function pageSocial(title: string, description: string, url: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: { title, description, url, siteName: "Pentra", locale: "en_US", type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pentra: Autopilot SEO for your website" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}
