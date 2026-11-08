import { AssistantMark } from "@/components/ui/assistant-mark";
import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SAMPLE_BUSINESS, WEEKLY_EMAIL } from "@/components/marketing/samples";
import { ASSISTANTS } from "@/lib/product-facts";

const PLAN_WORK = [
  {
    title: "Publishes your answer pages",
    body: "To WordPress, Webflow, Shopify, Ghost, GitHub or any CMS by webhook, or hosted at answers.yourdomain.com.",
  },
  {
    title: "Gets them indexed fast",
    body: "IndexNow tells Bing the moment a page is live, and your sitemap goes to Google through Search Console.",
  },
  {
    title: "Keeps asking the assistants",
    body: "Every question again, with every citation recorded next to the full answer it came from.",
  },
  { title: "Adds questions every week", body: "New questions your buyers ask join the list, so the snapshot never goes stale." },
  { title: "Rewrites pages that aren't cited", body: "A page the assistants keep passing over gets rewritten." },
  { title: "Keeps your facts current", body: "When a price, address or opening time changes, every page that states it is updated." },
  { title: "Emails you every week", body: "What was asked, who was named, what was published and what changed." },
];

function WeeklyEmail() {
  const email = WEEKLY_EMAIL;
  const delta = email.named - email.lastWeek;
  const short = (id: string) => ASSISTANTS.find((assistant) => assistant.id === id)?.short ?? id;
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-card border border-border bg-surface-1">
        <div className="space-y-1.5 border-b border-border px-5 py-4 text-[13px] leading-5 sm:px-6">
          <p className="flex gap-3">
            <span className="w-14 shrink-0 text-text-3">From</span>
            <span className="truncate text-text-2">Pentra · hello@pentra.dev</span>
          </p>
          <p className="flex gap-3">
            <span className="w-14 shrink-0 text-text-3">Subject</span>
            <span className="truncate text-text">
              {SAMPLE_BUSINESS.name}: named in {email.named} of {email.total} answers
            </span>
          </p>
        </div>
        <div className="px-5 py-6 sm:px-6">
          <p className="mono-caps text-[11px] text-text-3">{email.week} · Example</p>
          <p className="mt-3 text-[22px] font-medium leading-7 tracking-[-0.012em] text-text">
            Named in <span className="tabular-nums">{email.named}</span> of <span className="tabular-nums">{email.total}</span> answers.
          </p>
          <p className="mt-1 text-[14px] leading-[22px] text-text-3">
            Last week: <span className="tabular-nums">{email.lastWeek}</span> of <span className="tabular-nums">{email.total}</span>.{" "}
            {delta > 0 ? (
              <span className="text-named">+{delta} answers</span>
            ) : delta === 0 ? (
              <span>No change.</span>
            ) : (
              <span>{delta} answers</span>
            )}
          </p>

          <ul className="mt-6 space-y-2.5" aria-label="Answers that named you, by assistant">
            {email.byAssistant.map((row) => (
              <li key={row.assistant} className="grid grid-cols-[20px_88px_minmax(0,1fr)_56px] items-center gap-2.5">
                <AssistantMark assistant={row.assistant} size="sm" />
                <span className="truncate text-[13px] text-text-2">{short(row.assistant)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <span className="block h-full rounded-full bg-you" style={{ width: `${(row.named / email.perAssistant) * 100}%` }} />
                </span>
                <span className="mono-label text-right text-[11px] text-text-3">
                  {row.named} of {email.perAssistant}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mono-caps text-[11px] text-text-3">This week Pentra</p>
            <ul className="mt-3 space-y-2 text-[14px] leading-[22px] text-text-2">
              {[
                "Published 2 answer pages",
                "Rewrote 1 page no assistant had cited in 3 weeks",
                "Added 6 questions buyers ask",
                "Updated 3 pages with your new Saturday hours",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-text-4" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 rounded-card border border-border bg-bg p-4">
            <p className="flex items-center gap-2 text-[13px] text-text-2">
              <AssistantMark assistant="perplexity" size="sm" />
              <span>Perplexity cited your page</span>
            </p>
            <p className="mt-2.5 text-[14px] leading-[22px] text-text-2">
              <mark className="hl-quote">Kettlewood files the city permit for every deck it builds</mark> and includes the fee in the
              quote.
            </p>
          </div>
        </div>
        <p className="border-t border-border px-5 py-3.5 text-[12px] leading-5 text-text-3 sm:px-6">
          Every count in this email links to the answers behind it.
        </p>
      </div>
      <figcaption className="mt-3 text-[13px] leading-5 text-text-3">Example email for a sample business.</figcaption>
    </figure>
  );
}

export function AfterHour() {
  return (
    <Section labelledBy="after-title">
      <div className="grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-16 xl:gap-24">
        <div>
          <SectionHeading
            id="after-title"
            title="After the first hour, Pentra keeps going."
            lead="On the plan, Pentra publishes your answer pages, gets them indexed and keeps asking the assistants. Then it tells you what changed."
          />
          <Reveal as="ul" className="mt-10 border-t border-border">
            {PLAN_WORK.map((item) => (
              <li key={item.title} data-reveal className="grid grid-cols-1 gap-1 border-b border-border py-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-6">
                <h3 className="text-[15px] font-semibold leading-6 text-text">{item.title}</h3>
                <p className="text-[15px] leading-6 text-text-2 [text-wrap:pretty]">{item.body}</p>
              </li>
            ))}
          </Reveal>
        </div>
        <Reveal className="lg:pt-2">
          <div data-reveal>
            <WeeklyEmail />
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
