"use client";

import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button, ButtonLink, Spinner } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What the dashboard shows while Convex accepts the Clerk session: the app's own frame (sidebar, phone top bar,
 * content column) drawn as a quiet skeleton, so the real dashboard settles into place instead of replacing a
 * splash screen. One status line says what is happening.
 */
export function WorkspaceConnecting() {
  return (
    <WorkspaceFrame loading>
      <p role="status" className="flex items-center gap-2 text-[13px] leading-5 text-text-3">
        <Spinner className="text-text-3" />
        Connecting your workspace…
      </p>
      <div aria-hidden="true" className="mt-6 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-card" />
          <Skeleton className="h-56 w-full rounded-card" />
        </div>
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </WorkspaceFrame>
  );
}

/** The session couldn't be verified: say so plainly and offer the two ways forward, in the same order as /start's (sign in is the one primary). */
export function WorkspaceSessionError() {
  return (
    <WorkspaceFrame>
      <section aria-labelledby="workspace-session-title" className="mx-auto mt-6 max-w-md rounded-card border border-border bg-surface-1 p-6 sm:mt-16">
        <h1 id="workspace-session-title" className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-text">
          Your workspace session is not ready
        </h1>
        <p className="mt-2 text-[14px] leading-[22px] text-text-2">
          We could not verify your session. Try again, or sign in to continue. Your work is saved.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={() => window.location.reload()}>
            Try again
          </Button>
          <ButtonLink href="/sign-in">Sign in</ButtonLink>
        </div>
      </section>
    </WorkspaceFrame>
  );
}

/** The dashboard's content column (the same geometry as AnswersMain): 1152px, the page gutter, room for the phone top bar. */
export const DASHBOARD_COLUMN = "mx-auto max-w-6xl px-[var(--gutter)] pb-16 pt-20 sm:px-6 lg:pt-8";

/**
 * The dashboard's geometry without its data: 240px sidebar from lg, a 56px top bar on phones, the 1152px column.
 * While loading, the sidebar's controls are drawn as skeletons; otherwise only the wordmark shows.
 */
function WorkspaceFrame({ children, loading = false }: { children: ReactNode; loading?: boolean }) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-bg px-4 lg:hidden">
        {loading && <Skeleton className="h-9 w-9 shrink-0" />}
        <Wordmark href={null} />
      </div>
      <aside aria-hidden="true" className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface-1 lg:flex">
        <div className="flex h-14 items-center px-4">
          <Wordmark href={null} />
        </div>
        {loading && <SidebarSkeleton />}
      </aside>
      <main className="lg:pl-60">
        <div className={DASHBOARD_COLUMN}>{children}</div>
      </main>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <>
      <div className="px-3">
        <div className="flex h-10 items-center gap-2.5 rounded-control border border-border px-2.5">
          <Skeleton className="h-4 w-4 rounded-[4px]" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-0.5 px-3">
        {["w-16", "w-[72px]", "w-[92px]", "w-[68px]", "w-[84px]", "w-[60px]", "w-[52px]"].map((width) => (
          <div key={width} className="flex h-8 items-center gap-2.5 px-2.5">
            <Skeleton className="h-4 w-4 rounded-[4px]" />
            <Skeleton className={`h-3 ${width}`} />
          </div>
        ))}
      </div>
    </>
  );
}
