import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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

export const metadata: Metadata = {
  title: "Pentra — AI-Powered SEO Content Engine",
  description:
    "Generate research-backed, fact-checked SEO articles on autopilot. Crawl, plan, write, verify, and publish — all from one dashboard.",
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
