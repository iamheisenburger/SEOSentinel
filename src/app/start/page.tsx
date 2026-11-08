import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { Wordmark } from "@/components/marketing/wordmark";
import { Skeleton } from "@/components/ui/skeleton";
import { HONESTY_LINE } from "@/lib/product-facts";
import { StartGate } from "./start-gate";

export const metadata: Metadata = {
  title: "Start your free snapshot",
  description: "Enter your domain to see how ChatGPT, Perplexity, Gemini and Google's AI answer your buyers' questions.",
  robots: { index: false, follow: false },
};

/*
 * The free snapshot, start to finish (Nov 2026): domain → Pentra account (the domain survives the redirect) → the site
 * is created and read → "Here's what we understood" → the live first hour → the snapshot, the five drafts and the plan.
 * Every step reads the backend's own state (ops/design/answers-api.md), so an emailed link or a refresh lands on it.
 */

async function signedIn(): Promise<boolean> {
  try {
    return Boolean((await auth()).userId);
  } catch {
    // The local acceptance mode runs without Clerk's middleware: treat the visitor as signed out.
    return false;
  }
}

function StartFallback() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-border">
        <div className="mx-auto flex h-[60px] max-w-[1200px] items-center px-[var(--gutter)]">
          <Wordmark />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[640px] flex-1 px-[var(--gutter)] py-20" aria-busy="true">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-10 w-3/4" />
        <Skeleton className="mt-10 h-14 w-full" />
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-[1200px] px-[var(--gutter)] py-6 text-[13px] leading-5 text-text-3">{HONESTY_LINE}</p>
      </footer>
    </div>
  );
}

export default async function StartPage() {
  const serverSignedIn = await signedIn();
  return (
    <Suspense fallback={<StartFallback />}>
      <StartGate serverSignedIn={serverSignedIn} />
    </Suspense>
  );
}
