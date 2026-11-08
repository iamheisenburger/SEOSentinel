"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersCitations } from "@/components/answers/dashboard/citations";

/** Citations: every answer that cited one of the business's pages, in full. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersCitations siteId={site.siteId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
