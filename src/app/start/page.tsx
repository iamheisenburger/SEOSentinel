import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { buttonStyles } from "@/components/ui/button-styles";
import { DomainInput } from "@/components/ui/domain-input";
import { DOMAIN_ERROR, normalizeDomain } from "@/lib/domain-input";
import { HONESTY_LINE, SNAPSHOT } from "@/lib/product-facts";

export const metadata: Metadata = {
  title: "Start your free snapshot",
  description: "Enter your domain to see how ChatGPT, Perplexity, Gemini and Google's AI answer your buyers' questions.",
  robots: { index: false, follow: false },
};

/*
 * Step one of the free snapshot: the domain. The hero field sends people here with ?domain=…; this page confirms
 * it and hands over to account creation, which is where the snapshot is saved.
 * BRIDGE: until the snapshot flow (confirm what we read → live analysis → results) is built, "Create free
 * account" leads to sign-up and the existing dashboard. Replace the action, not the page, when that ships.
 */

const STEPS = [
  "Reads your site and confirms what you sell, where, and who you compete with.",
  `Lists about ${SNAPSHOT.questions} questions your buyers ask AI assistants.`,
  `Asks ${SNAPSHOT.assistants} assistants every question: about ${SNAPSHOT.answers} answers, each kept in full.`,
  "Flags what they get wrong about you, with the source each one used.",
  `Writes your first ${SNAPSHOT.draftPages} answer pages, as drafts.`,
];

export default async function StartPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = (await searchParams).domain;
  const requested = typeof raw === "string" ? raw : undefined;
  const domain = normalizeDomain(requested);
  const signUpHref = `/sign-up?redirect_url=${encodeURIComponent("/dashboard")}`;

  return (
    <MarketingShell>
      <section aria-labelledby="start-title" className="pb-24 pt-[124px] sm:pt-[140px] lg:pb-32 lg:pt-[164px]">
        <div className="container-page">
          <div className="mx-auto max-w-[640px]">
            <p className="text-[14px] font-medium text-text-3">Free snapshot</p>
            {domain ? (
              <>
                <h1 id="start-title" className="type-h1 mt-3 text-text [overflow-wrap:anywhere]">
                  Check {domain}
                </h1>
                <p className="type-lead mt-5">
                  In about an hour you&apos;ll see how {SNAPSHOT.assistants} AI assistants answer your buyers, with every
                  answer as proof. No card.
                </p>

                <ol className="mt-10 border-t border-border">
                  {STEPS.map((step, index) => (
                    <li key={step} className="grid grid-cols-[40px_minmax(0,1fr)] border-b border-border py-4 text-[15px] leading-6 text-text-2">
                      <span className="mono-label pt-1 text-text-3">0{index + 1}</span>
                      <span className="[text-wrap:pretty]">{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                  <Link href={signUpHref} className={buttonStyles({ size: "lg", className: "w-full sm:w-auto" })}>
                    Create free account
                    <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  </Link>
                  <p className="text-[14px] leading-[22px] text-text-3">
                    Already have one?{" "}
                    <Link href={`/sign-in?redirect_url=${encodeURIComponent("/dashboard")}`} className="link">
                      Sign in
                    </Link>
                  </p>
                </div>
                <p className="mt-4 text-[13px] leading-5 text-text-3">Your account is where the snapshot is saved, so you can come back to it.</p>

                <details className="group mt-12 border-t border-border pt-6">
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-control text-[14px] font-medium text-text-2 transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
                    Not your site? Use a different domain
                    <ChevronDown aria-hidden="true" className="h-4 w-4 text-text-3 transition-[rotate] duration-[var(--d-state)] ease-in-out group-open:rotate-180" strokeWidth={1.5} />
                  </summary>
                  <div className="mt-5">
                    <DomainInput id="start-domain-change" defaultValue={domain} note={null} buttonLabel="Check this site" />
                  </div>
                </details>
              </>
            ) : (
              <>
                <h1 id="start-title" className="type-h1 mt-3 text-text">
                  Which site should we check?
                </h1>
                <p className="type-lead mt-5">
                  Enter your domain. Pentra asks {SNAPSHOT.assistants} AI assistants the questions your buyers ask and shows
                  you every answer.
                </p>
                {requested && (
                  <p role="alert" className="mt-6 text-[14px] leading-[22px] text-wrong">
                    &ldquo;{requested.slice(0, 80)}&rdquo; isn&apos;t a website address. {DOMAIN_ERROR}
                  </p>
                )}
                <div className="mt-8">
                  <DomainInput id="start-domain" autoFocus={!requested} />
                </div>
              </>
            )}
            <p className="mt-16 text-[13px] leading-5 text-text-3">{HONESTY_LINE}</p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
