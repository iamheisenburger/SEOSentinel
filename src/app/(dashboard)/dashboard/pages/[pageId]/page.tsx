"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersPageScreen } from "@/components/answers/dashboard/pages";

/** One answer page: preview with source markers, facts, sources, publishing, citations and versions. */
export default function Page() {
  const params = useParams<{ pageId: string }>();
  const pageId = typeof params.pageId === "string" ? decodeURIComponent(params.pageId) : "";
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersPageScreen siteId={site.siteId} pageId={pageId} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
