"use client";

import type { ReactNode } from "react";
import { useConvexAuth } from "convex/react";
import { Sidebar } from "./sidebar";
import { OverLimitBanner } from "./over-limit-banner";
import { DASHBOARD_COLUMN, WorkspaceConnecting, WorkspaceSessionError } from "./workspace-gate";
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
  if (isLoading) return <WorkspaceConnecting />;
  if (!isAuthenticated) return <WorkspaceSessionError />;
  return (
    <SiteProvider>
      <div className="min-h-dvh bg-bg">
        <Sidebar />
        <main id="main" className="lg:pl-60">
          <div className={DASHBOARD_COLUMN}>
            <OverLimitBanner />
            {children}
          </div>
        </main>
      </div>
    </SiteProvider>
  );
}
