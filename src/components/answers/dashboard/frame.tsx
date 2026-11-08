"use client";

import type { ReactNode } from "react";
import { EvidenceProvider } from "@/components/answers/evidence-sheet";
import { ScreenErrorBoundary } from "@/components/answers/ui";
import { useAnswersQuery } from "@/lib/answers/backend";

/**
 * Every Answers screen sits in this frame: the evidence sheet (any count on the screen opens it) and an in-place error
 * that keeps the sidebar and offers to try again.
 */
export function AnswersScreen({ siteId, domain, name, children }: { siteId: string; domain: string; name?: string | null; children: ReactNode }) {
  return (
    <ScreenErrorBoundary title="We couldn't load this. Your data is safe.">
      <ScreenBody siteId={siteId} domain={domain} name={name}>{children}</ScreenBody>
    </ScreenErrorBoundary>
  );
}

function ScreenBody({ siteId, domain, name, children }: { siteId: string; domain: string; name?: string | null; children: ReactNode }) {
  const overview = useAnswersQuery("overview", { siteId });
  const business = { name: overview?.site.name ?? name ?? domain, domain: overview?.site.domain ?? domain };
  return (
    <EvidenceProvider business={business}>
      <div className="page-enter flex flex-col gap-8">{children}</div>
    </EvidenceProvider>
  );
}
