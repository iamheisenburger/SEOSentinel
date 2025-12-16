import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "SEO Sentinel",
  description: "Personal SEObot-style automation for your sites",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const navItems = [
    { href: "/", label: "Home" },
    { href: "/sites", label: "Sites" },
    { href: "/plan", label: "Plan" },
    { href: "/articles", label: "Articles" },
  ];

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <div className="fixed inset-x-0 top-0 z-50 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-sm text-slate-100">
              <div className="font-semibold tracking-tight text-white">
                SEO Sentinel
              </div>
              <div className="flex items-center gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full border border-transparent px-3 py-1.5 font-medium text-slate-200 transition hover:border-emerald-400/70 hover:text-emerald-200"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="pt-16">{children}</div>
        </Providers>
      </body>
    </html>
  );
}





