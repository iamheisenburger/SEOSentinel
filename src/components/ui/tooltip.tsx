"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cx } from "@/lib/cx";

/**
 * A short label on hover or keyboard focus (and on tap for touch). It fades in over 120ms after a brief
 * delay, is linked to its trigger with aria-describedby, and closes on Escape. The trigger must be a real
 * interactive element (a button or link).
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 250,
  className,
}: {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  delay?: number;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const lastPointer = useRef<string>("mouse");

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current) window.clearTimeout(pending.current);
    };
  }, []);

  if (!isValidElement(children)) return children;
  const describedBy = [children.props["aria-describedby"], open ? id : null].filter(Boolean).join(" ") || undefined;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(event) => {
        lastPointer.current = event.pointerType;
        if (event.pointerType !== "mouse") return;
        clear();
        timer.current = window.setTimeout(() => setOpen(true), delay);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        clear();
        setOpen(false);
      }}
      onFocus={() => {
        clear();
        setOpen(true);
      }}
      onBlur={() => {
        clear();
        setOpen(false);
      }}
      onClick={() => {
        if (lastPointer.current !== "mouse") setOpen((value) => !value);
      }}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none absolute z-50 w-max max-w-[260px] rounded-control border border-border-strong bg-surface-2 px-2.5 py-1.5 text-left text-[12px] font-normal leading-[18px] tracking-[0.01em] text-text-2 shadow-overlay",
          "transition-[opacity,visibility] duration-[var(--d-instant)] ease-out",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
          open ? "visible opacity-100" : "invisible opacity-0",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
