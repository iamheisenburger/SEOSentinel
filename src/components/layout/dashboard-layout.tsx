"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { OverLimitBanner } from "./over-limit-banner";
import { SiteProvider } from "@/contexts/site-context";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
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
