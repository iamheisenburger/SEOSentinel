import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Script from "next/script";
import "./design-system.css";
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

const TITLE = "Pentra: see what AI assistants say about your business";
const DESCRIPTION =
  "Pentra asks ChatGPT, Perplexity, Gemini and Google's AI the questions your buyers ask, shows who they name with every answer as proof, and writes the pages that answer them. Start with a free snapshot.";

export const metadata: Metadata = {
  title: {
    default: TITLE,
    template: "%s | Pentra",
  },
  description: DESCRIPTION,
  metadataBase: new URL("https://pentra.dev"),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://pentra.dev",
    siteName: "Pentra",
    locale: "en_US",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pentra: see what AI assistants say about your business" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-scroll-behavior keeps route changes instant while in-page anchor links glide (Next.js 16).
    <html lang="en" className="dark" data-scroll-behavior="smooth">
      <body className={`${geistSans.variable} ${geistMono.variable} bg-bg text-text antialiased`}>
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
              colorBackground: "#0F1011",
              colorInput: "#161718",
              colorInputForeground: "#F7F8F8",
              colorForeground: "#F7F8F8",
              colorMutedForeground: "#8A8F98",
              colorDanger: "#F27A72",
              colorSuccess: "#3FCF8E",
              colorWarning: "#E8B24A",
              borderRadius: "0.375rem",
              fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
            },
            elements: {
              rootBox: {
                width: "100%",
              },
              card: {
                width: "100%",
                backgroundColor: "#0F1011",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "10px",
                boxShadow: "none",
              },
              headerTitle: {
                color: "#F7F8F8",
                fontWeight: 500,
                letterSpacing: "-0.012em",
              },
              headerSubtitle: {
                color: "#8A8F98",
              },
              formFieldLabel: {
                color: "#B4B8C0",
              },
              formFieldInput: {
                backgroundColor: "#161718",
                borderColor: "rgba(255,255,255,0.08)",
                color: "#F7F8F8",
              },
              footerActionLink: {
                color: "#F7F8F8",
              },
              dividerLine: {
                borderColor: "rgba(255,255,255,0.08)",
              },
              dividerText: {
                color: "#8A8F98",
              },
              socialButtonsBlockButton: {
                backgroundColor: "transparent",
                borderColor: "rgba(255,255,255,0.14)",
                color: "#F7F8F8",
              },
              formButtonPrimary: {
                backgroundColor: "#F7F8F8",
                color: "#08090A",
                boxShadow: "none",
                fontWeight: 600,
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
              {`if(/(^|\\.)pentra\\.dev$/.test(location.hostname)){window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');}`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
