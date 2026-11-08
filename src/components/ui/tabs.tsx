"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list. */
  label?: string;
  /** id prefix: tab buttons get `${idPrefix}-tab-${id}` and control `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
  className?: string;
}

/**
 * Underline tabs: 13px/500, inactive --text-3, active --text with a 2px --text underline that slides between
 * tabs (200ms ease-in-out). Arrow keys, Home and End move between tabs. Pair with useTabParam to keep the
 * active tab in the URL.
 */
export function Tabs({ tabs, active, onChange, label, idPrefix, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // The underline is positioned directly (no re-render); it slides only after its first placement.
  const place = useCallback(() => {
    const indicator = indicatorRef.current;
    const button = buttons.current.get(active);
    if (!indicator) return;
    if (!button) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.opacity = "1";
    indicator.style.width = `${button.offsetWidth}px`;
    indicator.style.translate = `${button.offsetLeft}px 0`;
  }, [active]);

  useLayoutEffect(() => {
    place();
    const indicator = indicatorRef.current;
    const frame = requestAnimationFrame(() => indicator?.setAttribute("data-ready", ""));
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [place, tabs]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = tabs[next]!.id;
    onChange(id);
    buttons.current.get(id)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("scrollbar-none relative flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) buttons.current.set(tab.id, node);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cx(
              "relative shrink-0 whitespace-nowrap px-3 pb-2.5 pt-1.5 text-[13px] font-medium tracking-[0.01em]",
              "transition-colors duration-[var(--d-instant)] ease-out",
              selected ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cx("ml-1.5 font-mono text-[11px] tabular-nums", selected ? "text-text-2" : "text-text-4")}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-0 rounded-full bg-text opacity-0 data-[ready]:transition-[translate,width] data-[ready]:duration-[var(--d-state)] data-[ready]:ease-in-out"
      />
    </div>
  );
}

/**
 * Keeps a tab choice in the URL (?tab=…), so it survives reloads, can be shared, and works with back and
 * forward. Uses useSearchParams, so the component calling it must sit inside a <Suspense> boundary.
 */
export function useTabParam<T extends string>(param: string, values: readonly T[], fallback: T): [T, (value: T) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get(param);
  const current = values.includes(raw as T) ? (raw as T) : fallback;
  const set = useCallback(
    (value: T) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === fallback) next.delete(param);
      else next.set(param, value);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [fallback, param, pathname, router, searchParams],
  );
  return [current, set];
}
