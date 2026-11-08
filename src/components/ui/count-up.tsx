"use client";

import { useLayoutEffect, useRef } from "react";
import { DURATION, easeOut } from "@/lib/motion";
import { cx } from "@/lib/cx";

const format = new Intl.NumberFormat("en-US");

/**
 * A count that ticks up once when it first scrolls into view (600ms, ease-out, tabular so the width never
 * jumps). The server renders the real number, so crawlers, screen readers and no-JS visitors see it; a count
 * already on screen at load, or under reduced motion, simply stays put.
 */
export function CountUp({
  value,
  duration = DURATION.countUp,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || value === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return; // already visible: no flash, no replay
    if (typeof IntersectionObserver === "undefined") return;

    node.textContent = format.format(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          node.textContent = format.format(Math.round(easeOut(progress) * value));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      node.textContent = format.format(value);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={cx("tabular-nums", className)}>
      {format.format(value)}
    </span>
  );
}
