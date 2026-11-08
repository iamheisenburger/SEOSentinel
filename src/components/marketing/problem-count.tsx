import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SNAPSHOT } from "@/lib/product-facts";
import { cx } from "@/lib/cx";

/** An illustration of the snapshot format (not data): the visitor's business against two competitors. */
const ROWS = [
  { label: "Your business", count: 0, you: true },
  { label: "Competitor A", count: 41, you: false },
  { label: "Competitor B", count: 27, you: false },
] as const;

export function ProblemCount() {
  const total = SNAPSHOT.answers;
  return (
    <Section labelledBy="problem-title">
      <SectionHeading
        id="problem-title"
        align="center"
        title="Buyers ask AI what to buy and who to hire. It answers with a short list."
        lead="If you're not on it, you never find out. Your snapshot counts every answer, assistant by assistant."
      />
      <Reveal className="mx-auto mt-14 max-w-[880px]">
        <figure data-reveal>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
            {ROWS.map((row) => (
              <div key={row.label} className={cx("flex flex-col p-6 sm:p-7", row.you ? "bg-[color-mix(in_srgb,var(--you)_14%,var(--bg))]" : "bg-bg")}>
                <p className={cx("flex items-center gap-2 text-[14px] font-medium", row.you ? "text-text" : "text-text-2")}>
                  {row.you && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-you" />}
                  {row.label}
                </p>
                <p className="mt-5 flex items-baseline gap-2">
                  <span className="type-number text-text">
                    {row.count === 0 ? "0" : <CountUp value={row.count} />}
                  </span>
                  <span className="text-[14px] text-text-3">
                    of <span className="tabular-nums">{total}</span> answers
                  </span>
                </p>
                <div className="mt-5 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <div
                    className={cx("h-full rounded-full", row.you ? "bg-you" : row.label === "Competitor A" ? "bg-series-c1" : "bg-series-c2")}
                    style={{ width: `${(row.count / total) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <figcaption className="mt-4 text-center text-[13px] leading-5 text-text-3">
            Illustration of the snapshot format, not real data.
          </figcaption>
        </figure>
      </Reveal>
    </Section>
  );
}
