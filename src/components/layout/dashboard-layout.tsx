"use client";

import type { ReactNode } from "react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { Sidebar } from "./sidebar";
import { OverLimitBanner } from "./over-limit-banner";
import { SiteProvider } from "@/contexts/site-context";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // Clerk's browser session can be ready before Convex accepts its JWT.
  // Mounting owner-only queries in that interval throws into the route error
  // boundary, which does not reset just because authentication later succeeds.
  // Gate the whole private subtree, including its site/capacity providers.
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#08090E] px-6 text-[#EDEEF1]">
        <div className="max-w-md text-center">
          <p className="mb-4 text-xs font-semibold tracking-widest text-[#0EA5E9]">PENTRA</p>
          {isLoading ? (
            <p role="status" className="text-sm text-[#8B8FA3]">Connecting your workspace…</p>
          ) : (
            <>
              <h1 className="text-lg font-semibold">Your workspace session is not ready</h1>
              <p className="mt-2 text-sm text-[#8B8FA3]">
                We could not verify your session. Try again, or sign in to continue. Your work is saved.
              </p>
              <div className="mt-5 flex justify-center gap-4 text-sm">
                <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-white/15 px-4 py-2">
                  Try again
                </button>
                <Link href="/sign-in" className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-white">Sign in</Link>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }
  return (
    <SiteProvider>
      <div className="min-h-screen bg-[#08090E]">
        <Sidebar />
        <main className="lg:pl-60">
          <div className="mx-auto max-w-6xl px-6 py-6 pt-16 lg:pt-6">
            <OverLimitBanner />
            {children}
          </div>
        </main>
      </div>
    </SiteProvider>
  );
}
