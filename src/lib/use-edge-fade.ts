"use client";

import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** The hidden side of a row that scrolls sideways fades out over 28px, so it reads as "more this way". */
const EDGE_MASK = {
  right: "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
  left: "linear-gradient(to right, transparent, #000 28px)",
  both: "linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent)",
} as const;

/**
 * For a row of tabs or filter chips that scrolls sideways on a narrow screen: a mask that fades whichever edge has
 * more to show. Spread `style` and `onScroll` onto the scrolling element. Measured on resize (the row and each item)
 * and on scroll, never during render.
 */
export function useEdgeFade<T extends HTMLElement>(ref: RefObject<T | null>): { style: CSSProperties | undefined; onScroll: () => void; measure: () => void } {
  const [edge, setEdge] = useState<keyof typeof EDGE_MASK | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge(left && right ? "both" : left ? "left" : right ? "right" : null);
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, measure]);

  return { style: edge ? { maskImage: EDGE_MASK[edge], WebkitMaskImage: EDGE_MASK[edge] } : undefined, onScroll: measure, measure };
}
