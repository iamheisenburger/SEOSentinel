import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/marketing/wordmark";
import { ASSISTANT_NAMES_SENTENCE, HONESTY_LINE, SNAPSHOT } from "@/lib/product-facts";

const workflow = [
  { label: "Reads your site", detail: `Lists about ${SNAPSHOT.questions} questions your buyers ask AI assistants.` },
  { label: "Asks the assistants", detail: `${ASSISTANT_NAMES_SENTENCE}: about ${SNAPSHOT.answers} answers, each kept in full.` },
  { label: "Shows the proof", detail: "Who they name instead of you and what they get wrong, with every answer." },
  { label: "Writes the answers", detail: "Pages that answer those questions from your own facts, published on the plan." },
];

/**
 * Sign-in and sign-up live inside Pentra, never on Clerk's hosted portal: the product's promise on the left,
 * the form on the right (or alone on phones), and the Terms and Privacy links under it.
 */
export function AuthShell({
  mode,
  children,
}: {
  mode: "sign-in" | "sign-up";
  children: React.ReactNode;
}) {
  const isSignIn = mode === "sign-in";

  return (
    <main className="relative min-h-screen bg-bg text-text">
      <header className="absolute inset-x-0 top-0 z-20 flex h-[60px] items-center justify-between px-[var(--gutter)] lg:px-12">
        <Wordmark />
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 rounded-control text-[13px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:text-text"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5 transition-[translate] duration-[var(--d-state)] group-hover:-translate-x-0.5" strokeWidth={1.75} />
          Product home
        </Link>
      </header>

      <div className="grid grid-cols-1 min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,0.95fr)]">
        <section className="hidden items-center px-12 pb-16 pt-28 lg:flex xl:px-24">
          <div className="page-enter w-full max-w-[34rem]">
            <p className="text-[13px] font-medium text-text-3">{isSignIn ? "Your workspace" : "Free snapshot"}</p>

            {/* The Clerk form owns the page's single h1 ("Create your account" / "Sign in"). */}
            <p className="type-h1 mt-4 text-text [text-wrap:balance]">
              {isSignIn ? "Welcome back. See what changed." : "See what AI assistants say about your business."}
            </p>

            <p className="type-lead mt-5 max-w-[30rem]">
              {isSignIn
                ? "Your answers, citations and pages, as of the last time Pentra asked."
                : "Create your account to save your snapshot. It's free, and there's no card."}
            </p>

            <div className="mt-12 border-t border-border pt-6">
              <p className="text-[13px] font-medium text-text-3">How Pentra works</p>
              <ol className="mt-3 divide-y divide-border">
                {workflow.map(({ label, detail }, n) => (
                  <li key={label} className="grid grid-cols-[2.25rem_1fr] gap-x-2 py-3.5">
                    <span className="mono-label pt-0.5 text-text-3">0{n + 1}</span>
                    <span>
                      <span className="block text-[14px] font-medium text-text">{label}</span>
                      <span className="mt-0.5 block text-[13px] leading-5 text-text-3">{detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-[13px] leading-5 text-text-3">{HONESTY_LINE}</p>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center px-5 py-24 sm:px-10 lg:min-h-0 lg:border-l lg:border-border lg:px-12">
          <div className="w-full max-w-[26rem]">
            <div className="mb-7 lg:hidden">
              <p className="text-[13px] font-medium text-text-3">Pentra workspace</p>
              <h2 className="type-h3 mt-1.5 text-text">{isSignIn ? "Welcome back" : "Create your account"}</h2>
            </div>

            {children}

            <p className="mt-7 text-center text-[12px] leading-5 text-text-3">
              By continuing, you agree to Pentra&apos;s{" "}
              <Link href="/legal/terms" className="text-text-2 underline decoration-border-strong underline-offset-2 transition-colors hover:text-text">
                Terms
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/legal/privacy" className="whitespace-nowrap text-text-2 underline decoration-border-strong underline-offset-2 transition-colors hover:text-text">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export function AuthFormLoading({ label }: { label: string }) {
  return (
    <div aria-live="polite" aria-label={label} className="w-full overflow-hidden rounded-card border border-border bg-surface-1">
      <div className="space-y-3 px-8 pb-5 pt-8 text-center">
        <div className="skeleton mx-auto h-5 w-36 rounded-control" />
        <div className="skeleton mx-auto h-3 w-52 rounded-control" />
      </div>
      <div className="space-y-5 px-8 py-7">
        <div className="skeleton h-10 rounded-control" />
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-border" />
          <span className="skeleton h-2.5 w-5 rounded-control" />
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-24 rounded-control" />
          <div className="skeleton h-10 rounded-control" />
        </div>
        <div className="h-10 rounded-control bg-surface-3" />
      </div>
      <div className="border-t border-border px-8 py-5 text-center text-[12px] text-text-3">{label}</div>
    </div>
  );
}
