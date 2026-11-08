import type { ReactNode } from "react";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { Reveal } from "@/components/ui/reveal";
import { StatusPill } from "@/components/ui/status-pill";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SAMPLE_BUSINESS } from "@/components/marketing/samples";
import { ASSISTANTS, SNAPSHOT, TIMING } from "@/lib/product-facts";

/* Each step shows a small piece of the real interface (sample business), never an icon. */

function Fragment({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-card border border-border bg-surface-1 p-4 lg:h-[188px] lg:p-3.5 xl:p-4">{children}</div>
  );
}

function FragmentLabel({ children }: { children: ReactNode }) {
  return <p className="mono-caps text-[11px] text-text-3">{children}</p>;
}

function ReadFragment() {
  const rows = [
    ["Business", SAMPLE_BUSINESS.name],
    ["Sells", "Composite decks"],
    ["Market", SAMPLE_BUSINESS.market],
  ] as const;
  return (
    <Fragment>
      <FragmentLabel>What we read</FragmentLabel>
      <dl className="mt-3 space-y-2 text-[12.5px] leading-[18px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
            <dt className="text-text-3">{label}</dt>
            <dd className="truncate text-text">{value}</dd>
          </div>
        ))}
        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
          <dt className="text-text-3">Rivals</dt>
          <dd className="flex flex-wrap gap-1">
            {["Cedar Row", `+${SAMPLE_BUSINESS.competitors.length - 1}`].map((name) => (
              <span key={name} className="rounded-tag bg-surface-3 px-1.5 py-px text-[11.5px] text-text-2">
                {name}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </Fragment>
  );
}

function QuestionsFragment() {
  const questions = [
    "Best deck builders in Austin?",
    "Composite or wood in Texas heat?",
    "Do I need a permit for a deck?",
  ];
  return (
    <Fragment>
      <FragmentLabel>
        Questions · <span className="tabular-nums">{SNAPSHOT.questions}</span>
      </FragmentLabel>
      <ol className="mt-3 space-y-2">
        {questions.map((question, index) => (
          <li key={question} className="flex items-baseline gap-2 text-[12.5px] leading-[18px] text-text-2">
            <span className="mono-label shrink-0 text-[11px] text-text-4">Q{index + 1}</span>
            <span className="truncate">{question}</span>
          </li>
        ))}
      </ol>
      <p className="mono-label mt-3 text-[11px] text-text-3">+ {SNAPSHOT.questions - questions.length} more</p>
    </Fragment>
  );
}

function AskFragment() {
  const progress = [30, 18, 9, 5, 0];
  const answered = progress.reduce((sum, value) => sum + value, 0);
  return (
    <Fragment>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] font-medium leading-none tracking-[-0.02em] tabular-nums text-text">{answered}</span>
        <span className="mono-label text-[11px] text-text-3">of {SNAPSHOT.answers} answers</span>
      </div>
      <ul className="mt-3.5 space-y-[7px]">
        {ASSISTANTS.map((assistant, index) => (
          <li key={assistant.id} className="flex items-center gap-2">
            <AssistantMark assistant={assistant.id} size="sm" />
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <span className="block h-full rounded-full bg-text-3" style={{ width: `${(progress[index]! / SNAPSHOT.questions) * 100}%` }} />
            </span>
            <span className="mono-label w-9 text-right text-[11px] text-text-3">
              {progress[index]}/{SNAPSHOT.questions}
            </span>
          </li>
        ))}
      </ul>
    </Fragment>
  );
}

/** Only the businesses named instead of you: the business itself is never on this list. */
const NAMED_INSTEAD = [
  { name: SAMPLE_BUSINESS.competitors[0], count: 41 },
  { name: SAMPLE_BUSINESS.competitors[1], count: 27 },
  { name: SAMPLE_BUSINESS.competitors[2], count: 12 },
] as const;

function NamedInsteadFragment() {
  return (
    <Fragment>
      <FragmentLabel>Named instead</FragmentLabel>
      <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-[18px]">
        {NAMED_INSTEAD.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-3">
            <span className="hl-rival truncate">{row.name}</span>
            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-text">{row.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-border pt-2.5">
        <FragmentLabel>Sources they cite</FragmentLabel>
        <p className="mt-1 truncate text-[12.5px] leading-[18px] text-text-3">reddit.com · houzz.com · angi.com</p>
      </div>
    </Fragment>
  );
}

function PagesFragment() {
  return (
    <Fragment>
      <StatusPill kind="draft">Draft · not published</StatusPill>
      <p className="mt-3 text-[13px] font-semibold leading-[18px] text-text">Do I need a permit for a deck in Austin?</p>
      <p className="mt-1.5 text-[12px] leading-[18px] text-text-2">
        Kettlewood files the permit for every deck it builds
        <sup className="ml-px font-mono text-[9px] text-text-3">[1]</sup> and includes the fee in the quote
        <sup className="ml-px font-mono text-[9px] text-text-3">[2]</sup>.
      </p>
      <p className="mono-label mt-2.5 text-[11px] text-text-3">1,140 words · 6 sources</p>
    </Fragment>
  );
}

const STEPS: { title: string; body: string; fragment: ReactNode }[] = [
  { title: "Reads your site", body: "Learns what you sell, where, and who you compete with.", fragment: <ReadFragment /> },
  {
    title: `Lists about ${SNAPSHOT.questions} questions`,
    body: "The ones your buyers ask AI assistants before they choose.",
    fragment: <QuestionsFragment />,
  },
  {
    title: `Asks ${SNAPSHOT.assistants} assistants every question`,
    body: `About ${SNAPSHOT.answers} answers, each stored in full as proof.`,
    fragment: <AskFragment />,
  },
  {
    title: "Shows who gets named instead",
    body: "The competitors the answers name, and the sources the assistants cite.",
    fragment: <NamedInsteadFragment />,
  },
  {
    title: `Writes your first ${SNAPSHOT.draftPages} pages`,
    body: "Answer pages for questions you can win now, as drafts.",
    fragment: <PagesFragment />,
  },
];

export function FirstHour() {
  return (
    <Section id="how-it-works" labelledBy="first-hour-title">
      <SectionHeading
        id="first-hour-title"
        title="Your first hour, free."
        lead={`Enter your domain. In about ${TIMING.snapshotMinutes} minutes you have a snapshot of how ${SNAPSHOT.assistants} AI assistants answer your buyers, and ${SNAPSHOT.draftPages} draft pages that answer back. The first answers arrive in under ${TIMING.firstAnswersMinutes} minutes. No card.`}
      />
      <Reveal as="ol" stagger={80} className="relative mt-14 grid grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-5 lg:gap-5">
        {/* The rail: a hairline through the step markers on wide screens, down the left edge on phones. */}
        <span aria-hidden="true" className="absolute bottom-2 left-[3px] top-2 w-px bg-border lg:bottom-auto lg:left-0 lg:right-0 lg:top-2 lg:h-px lg:w-auto" />
        {STEPS.map((step, index) => (
          <li key={step.title} data-reveal className="relative pl-7 lg:pl-0">
            <div className="flex items-center">
              <span className="relative inline-flex items-center gap-3 bg-bg lg:pr-3">
                <span aria-hidden="true" className="absolute left-[-28px] top-1 h-[7px] w-[7px] rounded-full border border-border-strong bg-bg lg:static" />
                <span className="mono-label text-text-3">0{index + 1}</span>
              </span>
            </div>
            <h3 className="type-h4 mt-3 text-text lg:mt-4">{step.title}</h3>
            <p className="mt-1.5 text-[14px] leading-[22px] text-text-2 [text-wrap:pretty]">{step.body}</p>
            {step.fragment}
          </li>
        ))}
      </Reveal>
      <p className="mt-6 text-[13px] leading-5 text-text-3">Fragments show a sample business.</p>
    </Section>
  );
}
