import Link from "next/link";
import { ArrowLeft, Radar, ShieldCheck } from "lucide-react";

const workflow = [
  { label: "Research", detail: "Finds the searches your customers make that your site doesn't answer yet." },
  { label: "Write and fact-check", detail: "Written only from the facts you confirm. Drafts that fail the fact check are held back." },
  { label: "Publish", detail: "On Autopilot at your pace, or after your approval. Your choice." },
  { label: "Verify and measure", detail: "Confirms each page is live, then tracks clicks in Search Console." },
];

export function AuthShell({
  mode,
  children,
}: {
  mode: "sign-in" | "sign-up";
  children: React.ReactNode;
}) {
  const isSignIn = mode === "sign-in";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08090A] text-[#F7F8F8]">
      {/* One soft light from above; decorative only. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-[22%] top-[-14rem] h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.07] blur-[120px]" />

      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-6 sm:px-8 lg:px-12">
        <Link
          href="/"
          aria-label="Pentra home"
          className="flex items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0EA5E9]/15">
            <Radar className="h-4 w-4 text-[#0EA5E9]" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Pentra</span>
        </Link>

        <Link
          href="/"
          className="group flex items-center gap-1.5 text-[13px] text-[#8A8F98] transition-colors hover:text-[#F7F8F8]"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Product home
        </Link>
      </header>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(30rem,0.9fr)]">
        <section className="hidden items-center px-6 pb-16 pt-24 sm:px-10 lg:flex lg:px-16 xl:px-24">
          <div className="mx-auto w-full max-w-[34rem] lg:mx-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8F98]">Autopilot SEO</p>

            {/* The Clerk form owns the page's single h1 ("Create your account" / "Sign in"). */}
            <p className="mt-5 text-[clamp(2.25rem,4.4vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
              {isSignIn ? (
                <>
                  Your next article is
                  <span className="block text-[#62666D]">ready when you are.</span>
                </>
              ) : (
                <>
                  More customers from Google,
                  <span className="block text-[#62666D]">on autopilot.</span>
                </>
              )}
            </p>

            <p className="mt-5 max-w-[30rem] text-[15px] leading-7 text-[#8A8F98]">
              {isSignIn
                ? "Review your drafts, approve what is ready, and see how published pages perform."
                : "Add your website, connect it once, and Pentra researches, writes and publishes on your plan's schedule. The Free plan includes 3 articles a month."}
            </p>

            <div className="mt-12 border-t border-white/[0.08] pt-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#62666D]">How Pentra works</p>
              <ol className="mt-4 divide-y divide-white/[0.06]">
                {workflow.map(({ label, detail }, n) => (
                  <li key={label} className="grid grid-cols-[2rem_1fr] gap-x-2 py-3.5">
                    <span className="pt-px font-mono text-[12px] text-[#62666D]">0{n + 1}</span>
                    <span>
                      <span className="block text-[14px] font-medium text-[#F7F8F8]">{label}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-[#8A8F98]">{detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex items-center gap-2 text-[12px] text-[#8A8F98]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#4CB782]" />
                Drafts that don&apos;t pass the fact check never go live.
              </p>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center border-t border-white/[0.06] bg-[#0B0C0E] px-5 py-24 sm:px-10 lg:min-h-0 lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full max-w-[26rem]">
            <div className="mb-7 lg:hidden">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8F98]">
                Pentra workspace
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                {isSignIn ? "Welcome back" : "Create your account"}
              </h2>
            </div>

            {children}

            <p className="mt-7 text-center text-[11px] leading-5 text-[#62666D]">
              By continuing, you agree to Pentra&apos;s{" "}
              <Link href="/legal/terms" className="underline-offset-2 transition-colors hover:text-[#8A8F98] hover:underline">
                Terms
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/legal/privacy" className="underline-offset-2 transition-colors hover:text-[#8A8F98] hover:underline">
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
    <div
      aria-live="polite"
      aria-label={label}
      className="w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#0E0F11] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="space-y-3 px-9 pb-5 pt-8 text-center">
        <div className="mx-auto h-5 w-36 animate-pulse rounded bg-white/[0.08]" />
        <div className="mx-auto h-3 w-52 animate-pulse rounded bg-white/[0.04]" />
      </div>
      <div className="space-y-5 px-9 py-7">
        <div className="h-10 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-white/[0.06]" />
          <span className="h-2.5 w-5 animate-pulse rounded bg-white/[0.04]" />
          <span className="h-px flex-1 bg-white/[0.06]" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-10 animate-pulse rounded-lg bg-white/[0.06]" />
        </div>
        <div className="h-10 animate-pulse rounded-lg bg-white/[0.12]" />
      </div>
      <div className="border-t border-white/[0.05] px-8 py-5 text-center text-[11px] text-[#62666D]">
        {label}
      </div>
    </div>
  );
}
