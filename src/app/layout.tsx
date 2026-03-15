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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0B1120] text-[#F1F5F9]`}
      >
        <ClerkProvider
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "#0EA5E9",
              colorBackground: "#111318",
              colorInputBackground: "#1E2130",
              colorInputText: "#F1F5F9",
              colorText: "#F1F5F9",
              colorTextOnPrimaryBackground: "#FFFFFF",
              colorTextSecondary: "#CBD5E1",
              colorNeutral: "#E2E8F0",
              borderRadius: "0.5rem",
            },
            elements: {
              card: {
                backgroundColor: "#111318",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
              },
              headerTitle: {
                color: "#F1F5F9",
              },
              headerSubtitle: {
                color: "#94A3B8",
              },
              formFieldLabel: {
                color: "#CBD5E1",
              },
              formFieldInput: {
                backgroundColor: "#1E2130",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F1F5F9",
              },
              footerActionLink: {
                color: "#0EA5E9",
              },
              dividerLine: {
                borderColor: "rgba(255,255,255,0.08)",
              },
              dividerText: {
                color: "#64748B",
              },
              socialButtonsBlockButton: {
                backgroundColor: "#1E2130",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F1F5F9",
              },

            },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
