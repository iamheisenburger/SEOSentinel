"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ScreenSkeleton, useAnswersSelection } from "@/components/answers/dashboard/selection";

/** The article routes Pentra Answers replaced: a site on Answers is sent to its dashboard instead. */
export const ARTICLE_ONLY_ROUTES = ["/articles", "/plan", "/jobs", "/analytics", "/backlinks"] as const;

/**
 * Wraps the old article screens (/articles, /articles/[id], /plan, /jobs, /analytics, /backlinks). An articles site sees
 * them as before; a site on Pentra Answers goes to /dashboard, and nothing of the article screens renders or loads first.
 */
export function ArticlesOnly({ children }: { children: ReactNode }) {
  const selection = useAnswersSelection();
  const router = useRouter();
  const answers = selection.status === "answers";
  useEffect(() => {
    if (answers) router.replace("/dashboard");
  }, [answers, router]);
  if (selection.status === "loading" || answers) return <ScreenSkeleton />;
  return <>{children}</>;
}
