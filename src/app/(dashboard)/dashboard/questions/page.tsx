"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersQuestions } from "@/components/answers/dashboard/questions";

/** Questions: every question tracked, who's named, the top competitor, the page that answers it; add, pause, remove. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersQuestions siteId={site.siteId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
