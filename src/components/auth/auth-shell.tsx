import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  FileCheck2,
  Radar,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";

const workflow = [
  { label: "Research", detail: "Demand & intent measured", icon: Search },
  { label: "Create", detail: "Evidence-backed content", icon: FileCheck2 },
  { label: "Publish", detail: "Destination verified", icon: Send },
  { label: "Measure", detail: "Outcomes recorded", icon: BarChart3 },
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
    <main className="relative min-h-screen overflow-hidden bg-[#08090E] text-[#EDEEF1]">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-48 top-[-18rem] h-[44rem] w-[44rem] rounded-full bg-[#0EA5E9]/[0.07] blur-[140px]" />
        <div className="absolute -bottom-72 right-[-16rem] h-[42rem] w-[42rem] rounded-full bg-[#22D3EE]/[0.045] blur-[150px]" />
        <div className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:64px_64px]" />
      </div>

      <header className="absolute inset-x-0 top-0 z-20 flex h-20 items-center justify-between px-6 sm:px-8 lg:px-12">
        <Link
          href="/"
          aria-label="Pentra home"
          className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#0EA5E9]/20 bg-[#0EA5E9]/10 shadow-[0_0_28px_rgba(14,165,233,0.08)]">
            <Radar className="h-5 w-5 text-[#38BDF8]" />
          </span>
          <span className="text-[18px] font-bold tracking-[-0.02em]">Pentra</span>
        </Link>

        <Link
          href="/"
          className="group flex items-center gap-2 text-[13px] font-medium text-[#8B8FA3] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Product home
        </Link>
      </header>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.08fr)_minmax(31rem,0.92fr)]">
        <section className="hidden items-center px-6 pb-16 pt-28 sm:px-10 lg:flex lg:px-16 xl:px-24">
          <div className="mx-auto w-full max-w-xl lg:mx-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.06] px-3 py-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#38BDF8] opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#38BDF8]" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#38BDF8]">
                Autonomous SEO operations
              </span>
            </div>

            <h1 className="mt-7 max-w-lg text-[clamp(2.25rem,5vw,4.35rem)] font-bold leading-[1.02] tracking-[-0.045em]">
              {isSignIn ? (
                <>
                  Your growth engine is
                  <span className="block text-[#565A6E]">ready when you are.</span>
                </>
              ) : (
                <>
                  Put search growth
                  <span className="block text-[#565A6E]">on a measured loop.</span>
                </>
              )}
            </h1>

            <p className="mt-5 max-w-lg text-[15px] leading-7 text-[#8B8FA3] sm:text-[16px]">
              {isSignIn
                ? "Return to the workspace that researches, creates, publishes, and measures every SEO outcome for you."
                : "Connect your site once. Pentra turns verified opportunities into content, distribution, and measurable growth."}
            </p>

            <div className="mt-10 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0B10]/85 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.05] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#EF4444]/50" />
                  <span className="h-2 w-2 rounded-full bg-[#F59E0B]/50" />
                  <span className="h-2 w-2 rounded-full bg-[#22C55E]/60" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#565A6E]">
                  Pentra growth loop
                </span>
              </div>

              <div className="grid gap-px bg-white/[0.04] sm:grid-cols-2">
                {workflow.map(({ label, detail, icon: Icon }) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 bg-[#0A0B10] px-5 py-4"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.08]">
                      <Icon className="h-4 w-4 text-[#38BDF8]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[#EDEEF1]">
                        {label}
                      </span>
                      <span className="block truncate text-[11px] text-[#565A6E]">
                        {detail}
                      </span>
                    </span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#22C55E]/10">
                      <Check className="h-3 w-3 text-[#22C55E]" />
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 border-t border-white/[0.05] px-5 py-3 text-[11px] text-[#8B8FA3]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#22C55E]" />
                Every material action is gated, measured, and recorded.
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center border-t border-white/[0.05] bg-[#05060A]/70 px-5 py-24 backdrop-blur-sm sm:px-10 lg:min-h-0 lg:border-l lg:border-t-0 lg:px-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0EA5E9]/30 to-transparent lg:inset-y-0 lg:left-0 lg:h-auto lg:w-px lg:bg-gradient-to-b" />
          <div className="w-full max-w-[27rem]">
            <div className="mb-7 lg:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#38BDF8]">
                Pentra workspace
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">
                {isSignIn ? "Welcome back" : "Create your account"}
              </h2>
            </div>

            {children}

            <p className="mt-7 text-center text-[11px] leading-5 text-[#565A6E]">
              By continuing, you agree to Pentra&apos;s{" "}
              <Link href="/legal/terms" className="transition-colors hover:text-[#8B8FA3]">
                Terms
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/legal/privacy" className="transition-colors hover:text-[#8B8FA3]">
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
