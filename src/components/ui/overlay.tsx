"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("inert") && element.getClientRects().length > 0,
  );
}

let locks = 0;

/** Freezes page scroll under an overlay without the page jumping sideways when the scrollbar goes. */
function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  const html = document.documentElement;
  const scrollbar = window.innerWidth - html.clientWidth;
  html.style.setProperty("--scrollbar-comp", `${scrollbar}px`);
  html.style.overflow = "hidden";
  document.body.style.paddingRight = scrollbar ? `${scrollbar}px` : "";
}

function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  const html = document.documentElement;
  html.style.overflow = "";
  html.style.removeProperty("--scrollbar-comp");
  document.body.style.paddingRight = "";
}

/**
 * Shared behaviour for sheets and modals: stays mounted through its exit animation, traps focus, closes on
 * Escape, locks page scroll, and returns focus to whatever opened it.
 */
export function useOverlay({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  exitMs = 200,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  exitMs?: number;
}) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Unmount after the exit animation (with a timer as a backstop if animations are off).
  useEffect(() => {
    if (open || !present) return;
    const timer = window.setTimeout(() => setPresent(false), exitMs + 80);
    return () => window.clearTimeout(timer);
  }, [open, present, exitMs]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, panelRef, initialFocusRef]);

  return {
    present,
    state: open ? ("open" as const) : ("closed" as const),
    onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => {
      if (!open && event.target === event.currentTarget) setPresent(false);
    },
  };
}
