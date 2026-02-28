"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0B1120]">
      <Sidebar />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-6 py-8 pt-20 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
