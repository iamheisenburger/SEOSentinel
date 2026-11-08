"use client";

import type { ReactNode } from "react";
import { AnswersOverview, OverviewSkeleton } from "@/components/answers/dashboard/overview";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { GoToStart, useAnswersSelection } from "@/components/answers/dashboard/selection";
import { SwitchToAnswersCard } from "@/components/answers/dashboard/switch-card";

/**
 * /dashboard: the Answers overview for a site on Pentra Answers; the articles dashboard (passed in, untouched) with a
 * card offering the switch for an articles site; /start for an account with no website yet.
 */
export function DashboardSwitch({ legacy }: { legacy: ReactNode }) {
  const selection = useAnswersSelection();
  if (selection.status === "loading") return <OverviewSkeleton />;
  if (selection.status === "none") return <GoToStart />;
  if (selection.status === "legacy") {
    return (
      <>
        {selection.site && <SwitchToAnswersCard site={selection.site} />}
        {legacy}
      </>
    );
  }
  if (!selection.site.confirmed) return <GoToStart siteId={selection.site.siteId} />;
  return (
    <AnswersScreen siteId={selection.site.siteId} domain={selection.site.domain} name={selection.site.name}>
      <AnswersOverview siteId={selection.site.siteId} />
    </AnswersScreen>
  );
}
