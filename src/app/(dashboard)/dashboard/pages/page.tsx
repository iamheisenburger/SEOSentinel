"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersPages } from "@/components/answers/dashboard/pages";

/** Answer pages: published, drafts and not written, with publishing state and citations won. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersPages siteId={site.siteId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
