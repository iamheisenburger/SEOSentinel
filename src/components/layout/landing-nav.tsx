"use client";

import Link from "next/link";
import { Radar, Menu, X } from "lucide-react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { useState } from "react";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#pipeline" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "/contact" },
];

export function LandingNav() {
  const { isSignedIn } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 backdrop-blur-md bg-[#08090E]/80 border-b border-white/[0.04]">
      <div className="mx-auto max-w-6xl px-6">
        <nav className="flex h-18 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.1]">
              <Radar className="h-5 w-5 text-[#0EA5E9]" />
            </div>
            <span className="text-[18px] font-bold tracking-tight">
              Pentra
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map((link) => (
              link.href.startsWith("/") ? (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white"
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
                  className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white"
                >
                  Dashboard
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white hidden sm:block cursor-pointer">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="rounded-lg bg-[#0EA5E9] px-6 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#38BDF8] cursor-pointer">
                    Get started
                  </button>
                </SignUpButton>
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
        <div className="md:hidden border-t border-white/[0.04] bg-[#08090E]/95 backdrop-blur-md px-6 py-4 space-y-3">
          {navLinks.map((link) => (
            link.href.startsWith("/") ? (
              <Link
                key={link.label}
                href={link.href}
                className="block text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white py-2"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                href={link.href}
                className="block text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white py-2"
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
