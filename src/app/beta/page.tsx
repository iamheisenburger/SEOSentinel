import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Radar } from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";

export const metadata: Metadata = {
  title: "Founding beta",
  description:
    "Pentra is opening to 10 businesses: the Starter plan free for 60 days (10 researched, fact-checked articles a month on Autopilot) in exchange for honest feedback.",
  alternates: { canonical: "https://pentra.dev/beta" },
};

const WRAP = "mx-auto w-full max-w-[1000px] px-6";
const EYEBROW = "font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]";
const EMAIL = "pentrahelp@gmail.com";
const MAILTO = `mailto:${EMAIL}?subject=${encodeURIComponent("Pentra beta")}&body=${encodeURIComponent(
  "Hi Pentra team,\n\nI'd like to join the founding beta.\n\nMy website: \nWhat I sell: \nThe email I signed up with: \n",
)}`;

const GET = [
  ["Starter free for 60 days", "10 articles a month on 1 website. No card needed, and nothing is charged when the beta ends."],
  ["The whole system, on Autopilot", "Keyword research, writing from your confirmed facts, an independent fact check and publishing to your site on the schedule you pick."],
  ["A direct line to the founder", "Tell us what's wrong and we fix it. Your feedback decides what Pentra builds next."],
] as const;

const ASK = [
  ["Let Pentra run", "Connect your site and choose Autopilot or Review first. Pause any time."],
  ["Two short calls", "15 minutes after week 2 and after week 6: what worked, what didn't, what's missing."],
  ["A testimonial, only if it's true", "If you like the results, a few honest sentences we can share. If you don't, tell us why."],
] as const;

const FIT = [
  "Your site runs on WordPress, or is built from Markdown or MDX files in a GitHub repository (Next.js, Astro, Hugo, Jekyll, Gatsby). On other platforms Pentra writes and you paste.",
  "You sell a real product or service and want more customers from Google and AI answers.",
  "You can give SEO time. New articles usually take weeks to months to rank. In 60 days you'll see the full system working and early Search Console data, not a guaranteed traffic spike.",
] as const;

const STEPS = [
  ["Create your free account", "Add your website. Pentra reads it and drafts your business profile for you to confirm."],
  ["Email us “Beta”", `Send your website to ${EMAIL}, or reply to the message you got from us.`],
  ["We switch you to Starter", "Within a day. Pentra then publishes on the schedule you chose."],
] as const;

function PrimaryCta({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-full bg-[#F7F8F8] px-5 py-2.5 text-[15px] font-medium text-[#08090A] transition hover:bg-white">
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function List({ title, items }: { title: string; items: readonly (readonly [string, string])[] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0B0C0E] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className={EYEBROW}>{title}</p>
      <ul className="mt-5 space-y-5">
        {items.map(([head, body]) => (
          <li key={head} className="flex gap-3">
            <Check className="mt-[3px] h-4 w-4 flex-none text-[#4CB782]" />
            <div>
              <p className="text-[15px] font-medium text-[#F7F8F8]">{head}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[#8A8F98]">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BetaPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08090A]">
      <LandingNav />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(600px_300px_at_70%_0%,rgba(14,165,233,0.10),transparent_70%)]" />

      <section className="relative pt-32 md:pt-40">
        <div className={WRAP}>
          <p className="flex items-center gap-2 text-[13px] text-[#8A8F98]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4CB782]" />Founding beta · 10 websites
          </p>
          <h1 className="mt-6 max-w-[17ch] text-[clamp(2.3rem,5.6vw,4.2rem)] font-semibold leading-[1.04] tracking-[-0.04em] [text-wrap:balance]">
            Run Pentra free for 60 days. Tell us the truth.
          </h1>
          <p className="mt-6 max-w-[40rem] text-[17px] leading-relaxed text-[#8A8F98] md:text-[18px] [text-wrap:pretty]">
            We&apos;re opening Pentra to 10 businesses. You get the Starter plan free for 60 days: 10 researched,
            fact-checked articles a month, published to your site on Autopilot. In return, you tell us what works and what doesn&apos;t.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <PrimaryCta href="/sign-up">Create free account</PrimaryCta>
            <a href={MAILTO} className="text-[15px] font-medium text-[#D0D6E0] transition hover:text-white">Email us to join <span aria-hidden>→</span></a>
          </div>
        </div>
      </section>

      <section className="relative mt-20 md:mt-24">
        <div className={`${WRAP} grid gap-4 md:grid-cols-2`}>
          <List title="What you get" items={GET} />
          <List title="What we ask" items={ASK} />
        </div>
      </section>

      <section className="relative mt-20 border-t border-white/[0.06] pt-16 md:mt-24 md:pt-20">
        <div className={WRAP}>
          <p className={EYEBROW}>How to join</p>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map(([head, body], index) => (
              <li key={head}>
                <span className="font-mono text-[13px] text-[#0EA5E9]">0{index + 1}</span>
                <p className="mt-3 text-[17px] font-medium tracking-[-0.01em]">{head}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-[#8A8F98]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="relative mt-20 border-t border-white/[0.06] pt-16 md:mt-24 md:pt-20">
        <div className={WRAP}>
          <p className={EYEBROW}>Is it a fit?</p>
          <ul className="mt-8 max-w-[46rem] space-y-5">
            {FIT.map((item) => (
              <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-[#D0D6E0]">
                <span className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-[#62666D]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative mt-20 border-t border-white/[0.06] py-20 md:mt-24 md:py-28">
        <div className={`${WRAP} flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between`}>
          <div>
            <h2 className="max-w-[20ch] text-[clamp(1.8rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
              10 spots. First come, first served.
            </h2>
            <p className="mt-4 max-w-[34rem] text-[15px] leading-relaxed text-[#8A8F98]">
              Questions first? Email {EMAIL}. A person reads every message.
            </p>
          </div>
          <PrimaryCta href="/sign-up">Create free account</PrimaryCta>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-10">
        <div className={`${WRAP} flex flex-col gap-4 text-[13px] text-[#62666D] sm:flex-row sm:items-center sm:justify-between`}>
          <Link href="/" className="flex items-center gap-2 text-[#8A8F98] hover:text-white">
            <Radar className="h-4 w-4 text-[#0EA5E9]" />Pentra
          </Link>
          <div className="flex gap-6">
            <Link href="/legal/terms" className="hover:text-white">Terms</Link>
            <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
