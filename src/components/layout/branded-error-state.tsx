import Link from "next/link";
import { ArrowLeft, Radar, RefreshCw } from "lucide-react";

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
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#08090E] px-6 text-[#EDEEF1]">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-16rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.07] blur-[140px]" />
        <div className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:64px_64px]" />
      </div>

      <div className="relative w-full max-w-xl text-center">
        <Link
          href="/"
          aria-label="Pentra home"
          className="mx-auto flex w-fit items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#0EA5E9]/20 bg-[#0EA5E9]/10">
            <Radar className="h-5 w-5 text-[#38BDF8]" />
          </span>
          <span className="text-[19px] font-bold tracking-tight">Pentra</span>
        </Link>

        <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#38BDF8]">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
          {title}
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-7 text-[#8B8FA3]">
          {description}
        </p>

        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-5 py-3 text-[14px] font-semibold text-white transition hover:bg-[#38BDF8]"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          )}
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-[14px] font-semibold text-[#CBD5E1] transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pentra
          </Link>
        </div>
      </div>
    </main>
  );
}
