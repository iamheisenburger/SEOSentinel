"use client";

import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { STAGGER } from "@/lib/motion";
import { cx } from "@/lib/cx";

/**
 * Section reveal. Children marked with `data-reveal` fade up 12px in document order once the section is 15%
 * visible: the heading first, then each item 60ms apart (from the sixth on, together). A section that is
 * already on screen when the page loads is left alone, and nothing re-animates on the way back up.
 * Content is visible without JavaScript; under reduced motion it is a short fade with no travel.
 */
export function Reveal({
  as: Tag = "div",
  stagger = STAGGER.section,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "ol" | "ul" | "header" | "footer";
  /** Milliseconds between items (the first-hour timeline uses 80). */
  stagger?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (root.hasAttribute("data-reveal")) items.unshift(root);
    if (items.length === 0) return;
    const rect = root.getBoundingClientRect();
    // Only sections that start below the fold wait for the reader; the rest are already in view.
    if (rect.top < window.innerHeight * 0.92) return;

    items.forEach((item, index) => item.style.setProperty("--reveal-i", String(Math.min(index, STAGGER.maxItems - 1))));
    root.style.setProperty("--reveal-stagger", `${stagger}ms`);
    root.classList.add("reveal-pending");

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        root.classList.add("reveal-run");
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => root.classList.remove("reveal-pending"));
        });
      },
      // Fires once the section's top is 15% up the viewport, however tall the section is.
      { threshold: 0, rootMargin: "0px 0px -15% 0px" },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      root.classList.remove("reveal-pending", "reveal-run");
    };
  }, [stagger]);

  return (
    <Tag ref={ref as never} className={cx(className)} {...props}>
      {children}
    </Tag>
  );
}
