"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { EvidenceCard, SourceGlyph } from "@/components/ui/evidence-card";
import { Reveal } from "@/components/ui/reveal";
import { Sheet } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SAMPLE_BUSINESS, SHEET_ANSWERS } from "@/components/marketing/samples";
import { SNAPSHOT } from "@/lib/product-facts";

function Column({ title, body, visual }: { title: string; body: string; visual: ReactNode }) {
  return (
    <div data-reveal className="flex flex-col py-10 first:pt-0 last:pb-0 md:px-8 md:py-0 md:first:pl-0 md:last:pr-0">
      <h3 className="type-h4 text-text">{title}</h3>
      <p className="mt-2 max-w-[340px] text-[15px] leading-6 text-text-2 [text-wrap:pretty] md:min-h-[72px]">{body}</p>
      <div className="mt-8">{visual}</div>
    </div>
  );
}

/** 1 · A count that opens the answers behind it, in a sheet. */
function CountVisual({ onOpen }: { onOpen: () => void }) {
  const named = SHEET_ANSWERS.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="lift group w-full rounded-card border border-border bg-surface-1 p-5 text-left"
    >
      <span className="flex items-center justify-between gap-3">
        <AssistantMark assistant="chatgpt" showLabel labelClassName="text-[13px]" />
        <span className="mono-caps text-[11px] text-text-3">Visibility</span>
      </span>
      <span className="mt-6 block text-[13px] text-text-3">Named you in</span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="type-number text-text">{named}</span>
        <span className="text-[15px] text-text-2">
          of <span className="tabular-nums">{SNAPSHOT.questions}</span> answers
        </span>
      </span>
      <span className="mt-5 flex items-center justify-between border-t border-border pt-3.5 text-[13px] font-medium text-text-2 transition-colors group-hover:text-text">
        Open the {named} answers
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-[translate] duration-[var(--d-state)] group-hover:translate-x-0.5" strokeWidth={1.75} />
      </span>
    </button>
  );
}

/** 2 · A page paragraph whose facts carry their sources. */
function SourcesVisual() {
  const sources = [
    { n: 1, domain: SAMPLE_BUSINESS.domain, path: "/services", title: "Services", read: "Nov 3, 2026" },
    { n: 2, domain: SAMPLE_BUSINESS.domain, path: "/pricing", title: "Pricing and quotes", read: "Nov 3, 2026" },
  ];
  const marker = (n: number) => {
    const source = sources[n - 1]!;
    return (
      <Tooltip
        content={
          <>
            <span className="block text-text">
              {source.domain}
              {source.path}
            </span>
            <span className="block text-text-3">Read {source.read}</span>
          </>
        }
      >
        <button
          type="button"
          aria-label={`Source ${n}: ${source.domain}${source.path}`}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] translate-y-[-2px] items-center justify-center rounded-tag border border-border-strong bg-surface-2 px-1 align-middle font-mono text-[10px] leading-none text-text-2 transition-colors duration-[var(--d-instant)] hover:border-text-3 hover:text-text"
        >
          {n}
        </button>
      </Tooltip>
    );
  };
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5">
      <p className="mono-caps text-[11px] text-text-3">Answer page · draft</p>
      <p className="mt-3 text-[15px] font-semibold leading-[22px] text-text">How much does a composite deck cost in Austin?</p>
      <p className="mt-2 text-[14px] leading-[24px] text-text-2">
        Kettlewood Decks builds composite and hardwood decks across Austin and Round Rock{marker(1)}. Every quote is a fixed
        price and includes the city permit fee{marker(2)}.
      </p>
      <ul className="mt-4 space-y-1.5 border-t border-border pt-3.5">
        {sources.map((source) => (
          <li key={source.n} className="flex items-center gap-2 text-[12px] leading-5">
            <span className="w-3 font-mono text-[10px] text-text-4">{source.n}</span>
            <SourceGlyph domain={source.domain} />
            <span className="min-w-0 truncate text-text-2">
              {source.domain}
              {source.path}
            </span>
            <span className="mono-label ml-auto shrink-0 text-[11px] text-text-3">read Nov 3</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 3 · A win: the answer quotes the customer's page, and the quote is highlighted. */
function QuoteVisual() {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5">
      <div className="flex items-center justify-between gap-3">
        <AssistantMark assistant="gemini" showLabel labelClassName="text-[13px]" />
        <time className="mono-label text-[11px] text-text-3">Nov 4 · 14:02 UTC</time>
      </div>
      <p className="mt-4 text-[14px] leading-[24px] text-text-2">
        If you want one price for everything, <mark className="hl-you">Kettlewood Decks</mark> is a good fit: its site
        says <mark className="hl-quote">every quote includes the deck, the permit and cleanup</mark>.
      </p>
      <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-3.5">
        <SourceGlyph domain={SAMPLE_BUSINESS.domain} />
        <span className="text-[13px] text-text">{SAMPLE_BUSINESS.domain}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium text-text-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-named" />
          Your page
        </span>
      </div>
    </div>
  );
}

export function Proof() {
  const [open, setOpen] = useState(false);
  return (
    <Section id="proof" labelledBy="proof-title">
      <SectionHeading
        id="proof-title"
        title="Proof, not scores."
        lead="Pentra has no visibility score. Every number is a count you can open, and every count ends in the answers themselves."
      />
      <Reveal className="mt-14 grid grid-cols-1 divide-y divide-border md:mt-16 md:grid-cols-3 md:divide-x md:divide-y-0">
        <Column
          title="Every number opens to the answer"
          body="Click any count to read the exact answers behind it, with the time each one was asked."
          visual={<CountVisual onOpen={() => setOpen(true)} />}
        />
        <Column
          title="Every page shows its sources"
          body="Each answer page cites where every fact came from, mostly your own site, and when it was read."
          visual={<SourcesVisual />}
        />
        <Column
          title="Every win shows the quote"
          body="When an assistant cites your page, you see the sentence it used and the full answer around it."
          visual={<QuoteVisual />}
        />
      </Reveal>
      <p className="mt-10 text-[13px] leading-5 text-text-3">Example data for a sample business.</p>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Example data · sample business"
        title={`ChatGPT named ${SAMPLE_BUSINESS.name} in ${SHEET_ANSWERS.length} of ${SNAPSHOT.questions} answers`}
        description="Every answer where it was named, newest first, each exactly as recorded."
        footer={
          <p className="text-[13px] leading-5 text-text-3">
            The other {SNAPSHOT.questions - SHEET_ANSWERS.length} answers are listed too, each with the businesses ChatGPT named instead.
          </p>
        }
      >
        <ul className="space-y-3">
          {SHEET_ANSWERS.map((answer) => (
            <li key={answer.id}>
              <EvidenceCard answer={answer} variant="compact" sample showSources={false} showFooter={false} />
            </li>
          ))}
        </ul>
      </Sheet>
    </Section>
  );
}
