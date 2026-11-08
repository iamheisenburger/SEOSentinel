import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { FinalCta } from "@/components/marketing/final-cta";
import { OnThisPage } from "@/components/marketing/method-toc";
import { HERO_ANSWERS } from "@/components/marketing/samples";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { StatusPill } from "@/components/ui/status-pill";
import { pageSocial } from "@/lib/page-social";
import { ASSISTANTS, HONESTY_LINE, SNAPSHOT } from "@/lib/product-facts";

const DESCRIPTION =
  "How Pentra measures what AI assistants say about a business: which assistants, how each question is asked, what is recorded, how answers are counted, and what the numbers can't tell you.";

export const metadata: Metadata = {
  title: "How we measure",
  description: DESCRIPTION,
  alternates: { canonical: "https://pentra.dev/method" },
  ...pageSocial("How Pentra measures AI answers", DESCRIPTION, "https://pentra.dev/method"),
};

const SECTIONS = [
  { id: "assistants", title: "The five assistants" },
  { id: "asking", title: "How each question is asked" },
  { id: "questions", title: "Where the questions come from" },
  { id: "recording", title: "What we record" },
  { id: "counting", title: "How we count" },
  { id: "variance", title: "Why counts show both numbers" },
  { id: "limits", title: "What we can't do" },
] as const;

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t border-border py-12 first:border-t-0 first:pt-0 lg:py-14">
      <h2 id={`${id}-title`} className="type-h3 text-text">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[16px] leading-[27px] text-text-2 [&_p]:[text-wrap:pretty]">{children}</div>
    </section>
  );
}

const DEFINITIONS: { term: string; pill?: ReactNode; body: string }[] = [
  {
    term: "Named",
    pill: <StatusPill kind="named">Named you · position 2 of 4</StatusPill>,
    body: "The answer mentions your business by name. Position is where you appear among the businesses it names.",
  },
  {
    term: "Not mentioned",
    pill: <StatusPill kind="none">Not mentioned</StatusPill>,
    body: "The answer names other businesses and not yours. We record which ones.",
  },
  {
    term: "Cited",
    pill: <StatusPill kind="named">Cited your page</StatusPill>,
    body: "One of your pages appears among the sources the answer links to.",
  },
  {
    term: "Wrong fact",
    pill: <StatusPill kind="wrong">Wrong fact</StatusPill>,
    body: "The answer states something about your business that your own site contradicts, such as hours, prices or services. We show both, and the source the assistant relied on.",
  },
];

export default function MethodPage() {
  return (
    <MarketingShell>
      <header className="pb-14 pt-[124px] sm:pt-[140px] lg:pb-20 lg:pt-[164px]">
        <div className="container-page">
          <div className="max-w-[760px]">
            <h1 className="type-h1 text-text">How we measure</h1>
            <p className="type-lead mt-5 max-w-[640px]">
              Every number in Pentra is a count of real answers. This is exactly how we collect them, and what the
              numbers can and can&apos;t tell you.
            </p>
          </div>
        </div>
      </header>

      <div className="container-page pb-24 lg:pb-32">
        <div className="grid grid-cols-1 gap-12 border-t border-border pt-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16 lg:pt-14">
          <div className="hidden lg:block">
            <OnThisPage sections={SECTIONS} />
          </div>

          <article className="max-w-[680px]">
            <Block id="assistants" title="The five assistants">
              <p>
                Pentra asks the assistants people use to decide what to buy and who to hire. When we say &ldquo;Google&apos;s
                AI&rdquo;, we mean both of Google&apos;s: AI Mode and the AI Overviews at the top of search results.
              </p>
              <ul className="mt-6 divide-y divide-border rounded-card border border-border bg-surface-1">
                {ASSISTANTS.map((assistant) => (
                  <li key={assistant.id} className="flex items-center px-4 py-3">
                    <AssistantMark assistant={assistant.id} showLabel labelClassName="text-[14px] font-medium" />
                  </li>
                ))}
              </ul>
            </Block>

            <Block id="asking" title="How each question is asked">
              <p>
                We send each question to each assistant&apos;s live product, the same one your customers use, from a fresh
                session with web search, from your country.
              </p>
              <ul className="list-disc space-y-2 pl-5 marker:text-text-4">
                <li>
                  <strong className="font-medium text-text">Live product.</strong> The same assistant your customers
                  use.
                </li>
                <li>
                  <strong className="font-medium text-text">Fresh session.</strong> No account history and no earlier
                  conversation that could steer the answer.
                </li>
                <li>
                  <strong className="font-medium text-text">Web search on.</strong> So answers can draw on current pages,
                  including yours.
                </li>
                <li>
                  <strong className="font-medium text-text">Your country.</strong> Questions are asked from the market you
                  sell in, because answers differ by location.
                </li>
              </ul>
            </Block>

            <Block id="questions" title="Where the questions come from">
              <p>
                Pentra reads your site to learn what you sell, where, and who you compete with, then lists about{" "}
                {SNAPSHOT.questions} questions your buyers ask AI assistants before they choose. You can see every
                question. On the plan, new questions are added every week.
              </p>
            </Block>

            <Block id="recording" title="What we record">
              <p>
                For every answer: the full text, the assistant, the time it was asked, the businesses it names and their
                order, and every source it cites. Nothing is summarized away. Each count in Pentra opens to the answers
                behind it, like this one:
              </p>
              <div className="mt-6">
                <EvidenceCard answer={HERO_ANSWERS[0]!} sample />
                <p className="mt-3 text-[13px] leading-5 text-text-3">Example answer for a sample business with fictional names.</p>
              </div>
            </Block>

            <Block id="counting" title="How we count">
              <p>Each answer gets one or more outcomes, shown as a label beside it:</p>
              <dl className="mt-6 divide-y divide-border border-t border-border">
                {DEFINITIONS.map((definition) => (
                  <div key={definition.term} className="grid grid-cols-1 gap-2 py-5 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:gap-6">
                    <dt className="flex flex-col items-start gap-2">
                      <span className="text-[15px] font-semibold text-text">{definition.term}</span>
                      {definition.pill}
                    </dt>
                    <dd className="text-[15px] leading-6 text-text-2">{definition.body}</dd>
                  </div>
                ))}
              </dl>
            </Block>

            <Block id="variance" title="Why counts show both numbers">
              <p>
                Ask the same assistant the same question twice and you can get a different list. So we never turn a run
                into a percentage or a score. You&apos;ll see &ldquo;23 of {SNAPSHOT.answers}&rdquo;, not &ldquo;15%&rdquo;,
                and you can open all {SNAPSHOT.answers}.
              </p>
              <p>
                If an assistant doesn&apos;t respond to some questions, the count says so: &ldquo;144 of {SNAPSHOT.answers}{" "}
                answered&rdquo;. We retry, and never fill the gap with a guess.
              </p>
            </Block>

            <Block id="limits" title="What we can't do">
              <p className="text-[18px] leading-[29px] text-text">{HONESTY_LINE}</p>
              <p>
                What Pentra can do is publish accurate pages that answer your buyers&apos; questions, tell search engines
                they&apos;re live, and keep asking, so that when something changes, you have the answers that show it.
              </p>
            </Block>
          </article>
        </div>
      </div>

      <FinalCta title="See what AI says about you." />
    </MarketingShell>
  );
}
