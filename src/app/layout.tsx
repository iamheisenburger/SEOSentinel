import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export const metadata: Metadata = {
  title: {
    default: "Pentra — AI-Powered SEO Content Engine",
    template: "%s | Pentra",
  },
  description:
    "Generate research-backed, fact-checked SEO articles on autopilot. Crawl, plan, write, verify, and publish — all from one dashboard.",
  metadataBase: new URL("https://pentra.dev"),
  openGraph: {
    title: "Pentra — AI-Powered SEO Content Engine",
    description:
      "Autonomous SEO pipeline that crawls your site, plans keywords, writes fact-checked articles, and publishes them. On autopilot.",
    url: "https://pentra.dev",
    siteName: "Pentra",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pentra — AI-Powered SEO Content Engine",
    description:
      "Autonomous SEO pipeline that crawls your site, plans keywords, writes fact-checked articles, and publishes them. On autopilot.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      {GA_ID && (
        <head>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </head>
      )}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0B1120] text-[#F1F5F9]`}
      >
        <ClerkProvider
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "#0EA5E9",
              colorBackground: "#0F1117",
              colorInputBackground: "#151821",
              colorText: "#EDEEF1",
              colorTextSecondary: "#8B8FA3",
              borderRadius: "0.5rem",
            },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
