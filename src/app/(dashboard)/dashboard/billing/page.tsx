"use client";

import { Suspense } from "react";
import { AnswersRoute, ScreenSkeleton } from "@/components/answers/dashboard/selection";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersBilling } from "@/components/answers/dashboard/billing";
import UpgradePage from "../../upgrade/page";

/** Billing: the one plan and its checkout (the /upgrade flow); Pentra's own sites are never billed. */
export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AnswersRoute>
        {(site) => (
          <AnswersScreen siteId={site.siteId} domain={site.domain} name={site.name}>
            <AnswersBilling siteId={site.siteId} checkout={<UpgradePage />} />
          </AnswersScreen>
        )}
      </AnswersRoute>
    </Suspense>
  );
}
