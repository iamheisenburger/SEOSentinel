"use client";

import Link from "next/link";
import { Radar, Menu, X } from "lucide-react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useState } from "react";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#pipeline" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
];

export function LandingNav() {
  const { isSignedIn } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#08090A]/75 backdrop-blur-xl">
      <div className="mx-auto max-w-[1200px] px-6">
        <nav className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0EA5E9]/15">
              <Radar className="h-4 w-4 text-[#0EA5E9]" />
            </div>
            <span className="text-[16px] font-semibold tracking-tight">
              Pentra
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              link.href.startsWith("/") ? (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-[14px] font-medium text-[#8A8F98] transition hover:text-white"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[14px] font-medium text-[#8A8F98] transition hover:text-white"
                >
                  {link.label}
                </a>
              )
            ))}
          </div>

          <div className="flex items-center gap-4">
            {isSignedIn ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-[14px] font-medium text-[#8A8F98] transition hover:text-white"
                >
                  Dashboard
                </Link>
                <UserButton userProfileMode="modal" />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="hidden text-[14px] font-medium text-[#8A8F98] transition hover:text-white sm:block"
                >
                  Log in
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-full bg-[#F7F8F8] px-4 py-1.5 text-[14px] font-medium text-[#08090A] transition hover:bg-white"
                >
                  Start free
                </Link>
              </>
            )}

            {/* Mobile menu button */}
            <button
              className="md:hidden ml-1 p-1.5 text-[#8B8FA3] hover:text-white transition cursor-pointer"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/[0.04] bg-[#08090A]/95 backdrop-blur-xl px-6 py-4 space-y-3">
          {navLinks.map((link) => (
            link.href.startsWith("/") ? (
              <Link
                key={link.label}
                href={link.href}
                className="block text-[15px] font-medium text-[#8A8F98] transition hover:text-white py-2"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                href={link.href}
                className="block text-[15px] font-medium text-[#8A8F98] transition hover:text-white py-2"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            )
          ))}
        </div>
      )}
    </header>
  );
}
