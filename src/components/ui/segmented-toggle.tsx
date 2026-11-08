"use client";

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type SegmentOption<T extends string> = { value: T; label: ReactNode; tag?: ReactNode };

/**
 * A 36px pill segmented control (radiogroup). The selected segment sits on a surface-3 thumb that slides
 * between options (200ms ease-in-out); arrow keys move the selection.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  const place = useCallback(() => {
    const thumb = thumbRef.current;
    const button = buttons.current.get(value);
    if (!thumb || !button) return;
    thumb.style.width = `${button.offsetWidth}px`;
    thumb.style.translate = `${button.offsetLeft}px 0`;
    thumb.style.opacity = "1";
  }, [value]);

  useLayoutEffect(() => {
    place();
    const thumb = thumbRef.current;
    const frame = requestAnimationFrame(() => thumb?.setAttribute("data-ready", ""));
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(place);
    observer.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [place]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.value === value);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    if (next < 0) return;
    event.preventDefault();
    const nextValue = options[next]!.value;
    onChange(nextValue);
    buttons.current.get(nextValue)?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("relative inline-flex h-9 items-center rounded-full border border-border bg-surface-1 p-[3px]", className)}
    >
      <span
        ref={thumbRef}
        aria-hidden="true"
        className="absolute bottom-[3px] left-0 top-[3px] w-0 rounded-full bg-surface-3 opacity-0 shadow-[inset_0_0_0_1px_var(--border)] data-[ready]:transition-[translate,width] data-[ready]:duration-[var(--d-state)] data-[ready]:ease-in-out"
      />
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cx(
              "relative z-10 inline-flex h-full items-center gap-2 rounded-full px-4 text-[13px] font-medium tracking-[0.01em] transition-colors duration-[var(--d-instant)] ease-out",
              checked ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            {option.label}
            {option.tag && <span className="mono-caps text-[11px] leading-none text-text-3">{option.tag}</span>}
          </button>
        );
      })}
    </div>
  );
}
