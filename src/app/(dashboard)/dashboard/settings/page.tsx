"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersSettings } from "@/components/answers/dashboard/settings";

/** Settings: business facts, where pages publish, autopublish, the weekly email and asking again. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersSettings siteId={site.siteId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
