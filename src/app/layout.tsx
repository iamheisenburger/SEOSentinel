import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { PentraSalesAgent } from "@/components/pentra-sales-agent";

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
    default: "Pentra — Autopilot SEO for your website",
    template: "%s | Pentra",
  },
  description:
    "Add your website and Pentra takes it from there: researched, fact-checked articles published on schedule, pages improved, and results in Search Console.",
  metadataBase: new URL("https://pentra.dev"),
  openGraph: {
    title: "Pentra — Autopilot SEO for your website",
    description:
      "Autopilot SEO: researched, fact-checked articles published to your WordPress or GitHub-based site on a schedule, with Search Console reporting.",
    url: "https://pentra.dev",
    siteName: "Pentra",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pentra — Autopilot SEO for your website",
    description:
      "Autopilot SEO: researched, fact-checked articles published to your WordPress or GitHub-based site on a schedule, with Search Console reporting.",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#08090A] text-[#F7F8F8]`}
      >
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
          afterSignOutUrl="/"
          appearance={{
            theme: dark,
            variables: {
              colorPrimary: "#F7F8F8",
              colorPrimaryForeground: "#08090A",
              colorBackground: "#0E0F11",
              colorInput: "#141518",
              colorInputForeground: "#F7F8F8",
              colorForeground: "#F7F8F8",
              colorMutedForeground: "#8A8F98",
              borderRadius: "0.5rem",
            },
            elements: {
              rootBox: {
                width: "100%",
              },
              card: {
                width: "100%",
                backgroundColor: "#0E0F11",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 24px 48px -16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
              },
              headerTitle: {
                color: "#F7F8F8",
              },
              headerSubtitle: {
                color: "#8A8F98",
              },
              formFieldLabel: {
                color: "#D0D6E0",
              },
              formFieldInput: {
                backgroundColor: "#141518",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F7F8F8",
              },
              footerActionLink: {
                color: "#F7F8F8",
              },
              dividerLine: {
                borderColor: "rgba(255,255,255,0.08)",
              },
              dividerText: {
                color: "#62666D",
              },
              socialButtonsBlockButton: {
                backgroundColor: "#141518",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F7F8F8",
              },
              formButtonPrimary: {
                backgroundColor: "#F7F8F8",
                color: "#08090A",
                boxShadow: "none",
              },
            },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
        <PentraSalesAgent />
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
