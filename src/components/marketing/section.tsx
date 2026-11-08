import type { ReactNode } from "react";
import { Reveal } from "@/components/ui/reveal";
import { cx } from "@/lib/cx";

/** A marketing section: 96–128px of air, a hairline above, an optional id the nav glides to. */
export function Section({
  id,
  children,
  className,
  divider = true,
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  divider?: boolean;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cx("section", divider && "border-t border-border", className)}>
      <div className="container-page">{children}</div>
    </section>
  );
}

/** Heading and lead for a section. They reveal first; the section's items follow. */
export function SectionHeading({
  id,
  title,
  lead,
  align = "left",
  className,
}: {
  id?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <Reveal className={cx(align === "center" ? "mx-auto max-w-[720px] text-center" : "max-w-[680px]", className)}>
      <h2 id={id} data-reveal className="type-h2 text-text">
        {title}
      </h2>
      {lead && (
        <p data-reveal className={cx("type-lead mt-4", align === "center" && "mx-auto max-w-[600px] [text-wrap:balance]")}>
          {lead}
        </p>
      )}
    </Reveal>
  );
}
