"use client";

import { useId, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type AccordionItem = { id: string; title: ReactNode; content: ReactNode };

/**
 * Accordion rows divided by hairlines. Each title is a button (aria-expanded) that opens its panel with a
 * height animation (grid rows, 320ms); the plus turns into a minus. Closed panels stay in the HTML for search
 * engines but are inert, so keyboard and screen-reader users skip them.
 */
export function Accordion({
  items,
  allowMultiple = false,
  defaultOpen = [],
  headingLevel = 3,
  className,
}: {
  items: AccordionItem[];
  allowMultiple?: boolean;
  defaultOpen?: string[];
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const [open, setOpen] = useState<string[]>(defaultOpen);
  const baseId = useId();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  function toggle(id: string) {
    setOpen((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : allowMultiple ? [...current, id] : [id],
    );
  }

  return (
    <div className={cx("border-t border-border", className)}>
      {items.map((item) => {
        const expanded = open.includes(item.id);
        const buttonId = `${baseId}-${item.id}-button`;
        const panelId = `${baseId}-${item.id}-panel`;
        return (
          <div key={item.id} className="border-b border-border">
            <Heading className="m-0">
              <button
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="group flex w-full items-start justify-between gap-6 py-5 text-left text-[16px] font-medium leading-6 tracking-[-0.005em] text-text transition-colors duration-[var(--d-instant)] ease-out hover:text-text"
              >
                <span className="min-w-0 [text-wrap:pretty]">{item.title}</span>
                <span
                  aria-hidden="true"
                  className="relative mt-1 h-4 w-4 shrink-0 text-text-3 transition-colors duration-[var(--d-instant)] group-hover:text-text-2"
                >
                  <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current" />
                  <span
                    className={cx(
                      "absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-current transition-[scale] duration-[var(--d-state)] ease-in-out",
                      expanded ? "scale-y-0" : "scale-y-100",
                    )}
                  />
                </span>
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!expanded}
              className={cx(
                "grid transition-[grid-template-rows,opacity] duration-[var(--d-enter)] ease-out",
                expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="max-w-[640px] pb-6 pr-10 text-[15px] leading-[25px] text-text-2 [text-wrap:pretty]">
                  {item.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
