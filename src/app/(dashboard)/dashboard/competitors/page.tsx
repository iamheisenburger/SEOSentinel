"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersCompetitors } from "@/components/answers/dashboard/competitors";

/** Competitors: who the answers name, per assistant, and where they're named instead of the business. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersCompetitors siteId={site.siteId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
