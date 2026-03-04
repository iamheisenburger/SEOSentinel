"use client";

import Link from "next/link";
import { Radar } from "lucide-react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";

export function LandingNav() {
  const { isSignedIn } = useAuth();

  return (
    <header className="fixed inset-x-0 top-0 z-50 backdrop-blur-md bg-[#08090E]/80">
      <div className="mx-auto max-w-6xl px-6">
        <nav className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.1]">
              <Radar className="h-4 w-4 text-[#0EA5E9]" />
            </div>
            <span className="text-[16px] font-bold tracking-tight">
              Pentra
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="text-[14px] font-medium text-[#8B8FA3] transition hover:text-white hidden sm:block"
            >
              Pricing
            </Link>
            {isSignedIn ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-[14px] font-medium text-[#8B8FA3] transition hover:text-white"
                >
                  Dashboard
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="text-[14px] font-medium text-[#8B8FA3] transition hover:text-white hidden sm:block cursor-pointer">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="rounded-lg bg-[#0EA5E9] px-5 py-2 text-[14px] font-semibold text-white transition hover:bg-[#38BDF8] cursor-pointer">
                    Get started
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
