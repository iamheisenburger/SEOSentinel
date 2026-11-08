"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { useActiveSite, type AnswersSiteEntry } from "@/contexts/site-context";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswersSidebar } from "@/components/answers/dashboard/answers-sidebar";
import { SwitchToAnswersCard } from "@/components/answers/dashboard/switch-card";
import type { MySite } from "@/lib/answers/types";

export type AnswersSelection =
  | { status: "loading" }
  | { status: "none" }
  /** An articles site; null when the route names a site this account doesn't own (the legacy screens say so). */
  | { status: "legacy"; site: { _id: string; domain: string; siteName?: string } | null }
  | { status: "answers"; site: MySite };

/**
 * The active site, and whether it runs Pentra Answers. The legacy site context stays the source of truth for which
 * site is selected; api.answers.mySites says which ones run Answers.
 */
export function useAnswersSelection(): AnswersSelection {
  const { sites, activeSite, answersSites, answersStatus } = useActiveSite();
  if (answersStatus === "loading" || sites === undefined) return { status: "loading" };
  if (sites.length === 0) return { status: answersSites?.length ? "loading" : "none" };
  if (!activeSite) return { status: "legacy", site: null };
  const entry = (answersSites ?? []).find((s: AnswersSiteEntry) => s.siteId === activeSite._id);
  return entry?.answers ? { status: "answers", site: entry } : { status: "legacy", site: activeSite };
}

/** No website yet: every new account starts at /start (with an unconfirmed Answers site, at its setup). */
export function GoToStart({ siteId }: { siteId?: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(siteId ? `/start?site=${encodeURIComponent(siteId)}` : "/start");
  }, [router, siteId]);
  return (
    <div className="flex flex-col gap-4 py-10" aria-busy="true" aria-label="Opening setup">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </div>
  );
}

/**
 * An Answers screen in the app: waits for the selection, sends sites still being set up to /start, and tells an
 * articles site how to switch, so a Questions or Citations link never shows another product's empty screen.
 */
export function AnswersRoute({ children }: { children: (site: MySite) => ReactNode }) {
  const selection = useAnswersSelection();
  if (selection.status === "loading") return <ScreenSkeleton />;
  if (selection.status === "none") return <GoToStart />;
  if (selection.status === "legacy") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.015em] text-text">This page is part of Pentra Answers</h1>
        {selection.site ? <SwitchToAnswersCard site={selection.site} /> : <p className="text-[14px] text-text-3">Choose one of your websites in the sidebar.</p>}
      </div>
    );
  }
  if (!selection.site.confirmed) return <GoToStart siteId={selection.site.siteId} />;
  return <>{children(selection.site)}</>;
}

/** The app's sidebar for an Answers site: the legacy context selects the site; overview says the plan. */
export function AnswersSidebarConnected() {
  const { setActiveSiteId, answersSites, activeSite } = useActiveSite();
  // Syncs the Clerk plan to Pentra on load and whenever the session's features change (after checkout), so a paid
  // account's access shows without waiting for the billing webhook.
  usePlanLimits();
  const pathname = usePathname();
  const siteId = activeSite?._id ?? null;
  return (
    <AnswersSidebar
      sites={(answersSites ?? []) as MySite[]}
      activeSiteId={siteId}
      onSelectSite={(id) => setActiveSiteId(id as never)}
      pathname={pathname}
      account={<><UserButton userProfileMode="modal" /><span className="truncate text-[12px] text-text-3">Account</span></>}
    />
  );
}
