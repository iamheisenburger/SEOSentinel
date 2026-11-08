"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/answers/ui";
import { EvidenceProvider } from "@/components/answers/evidence-sheet";
import { Understood } from "@/components/answers/onboarding/understood";
import { FirstHour } from "@/components/answers/onboarding/first-hour";
import { SnapshotResults } from "@/components/answers/onboarding/results";
import type { StartStep } from "@/components/answers/onboarding/start-flow";
import { useAnswersQuery, useAppHref } from "@/lib/answers/backend";
import type { SetupState } from "@/lib/answers/types";

export type SetupPhase = "reading" | "confirm" | "first-hour" | "results";

/** Which step a site is on, from its own record: read, confirmed, asking, done. */
export function setupPhase(state: Pick<SetupState, "readAt" | "confirmedAt" | "run">): SetupPhase {
  if (!state.readAt) return "reading";
  if (!state.confirmedAt) return "confirm";
  if (!state.run || state.run.status !== "done") return "first-hour";
  return "results";
}

const STEP_OF: Record<SetupPhase, StartStep> = { reading: 2, confirm: 2, "first-hour": 3, results: 4 };

export function SiteSetup({ siteId, onStep }: { siteId: string; onStep: (step: StartStep) => void }) {
  const state = useAnswersQuery("setupState", { siteId });
  const params = useSearchParams();
  const href = useAppHref();
  const phase = state ? setupPhase(state) : null;
  useEffect(() => { if (phase) onStep(STEP_OF[phase]); }, [phase, onStep]);

  if (state === undefined) {
    return (
      <div className="mx-auto max-w-[720px] px-[var(--gutter)] py-16" aria-busy="true" aria-label="Loading your setup">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-9 w-2/3" />
        <Skeleton className="mt-10 h-72 w-full" />
      </div>
    );
  }
  if (state === null) {
    return (
      <div className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
        <h1 className="type-h2 text-text">This setup isn&apos;t in your account</h1>
        <Notice className="mt-6" actions={<><ButtonLink href={href("/start")} variant="secondary" size="sm">Start a check</ButtonLink><ButtonLink href={href("/dashboard")} size="sm">Dashboard</ButtonLink></>}>
          You may be signed in with a different account, or the site doesn&apos;t run Pentra Answers.
        </Notice>
      </div>
    );
  }
  const business = { name: state.name ?? state.domain, domain: state.domain };
  return (
    <EvidenceProvider business={business}>
      {phase === "reading" || phase === "confirm" ? (
        <Understood state={state} reading={phase === "reading"} />
      ) : phase === "first-hour" ? (
        <FirstHour state={state} />
      ) : (
        <SnapshotResults state={state} view={params.get("view") === "drafts" ? "drafts" : "snapshot"} pageId={params.get("page")} />
      )}
    </EvidenceProvider>
  );
}
