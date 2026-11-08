import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Wordmark } from "@/components/marketing/wordmark";

/**
 * Not-found and error screens stay inside Pentra: the wordmark, what happened in one line, and the next action.
 * No glow, no grid: the same quiet canvas as everywhere else.
 */
export function BrandedErrorState({
  eyebrow,
  title,
  description,
  onRetry,
}: {
  eyebrow: string;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const back = (
    <Link
      href="/"
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-[15px] font-semibold transition-[background-color,color,scale] duration-[var(--d-instant)] ease-out active:scale-[0.98] ${
        onRetry ? "border border-border-strong text-text hover:bg-surface-2" : "bg-action text-on-action hover:bg-action-hover"
      }`}
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
      Back to Pentra
    </Link>
  );

  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex h-[60px] items-center px-[var(--gutter)] lg:px-12">
        <Wordmark />
      </header>
      <div className="flex flex-1 items-center justify-center px-[var(--gutter)] pb-[60px]">
        <div className="page-enter w-full max-w-[520px] text-center">
          <p className="mono-caps text-text-3">{eyebrow}</p>
          <h1 className="type-h1 mt-4 text-text">{title}</h1>
          <p className="mx-auto mt-4 max-w-[420px] text-[16px] leading-[26px] text-text-2 [text-wrap:pretty]">{description}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-[15px] font-semibold text-on-action transition-[background-color,scale] duration-[var(--d-instant)] ease-out hover:bg-action-hover active:scale-[0.98]"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                Try again
              </button>
            )}
            {back}
          </div>
        </div>
      </div>
    </main>
  );
}
