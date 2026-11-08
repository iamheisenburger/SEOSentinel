"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOverlay } from "@/components/ui/overlay";
import { cx } from "@/lib/cx";

/**
 * The evidence sheet: a 560px panel from the right that keeps the list behind it in context. It slides 24px
 * and fades in (320ms), leaves in 200ms, traps focus, closes on Escape or a click outside, and scrolls on its
 * own (overscroll contained).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  eyebrow,
  footer,
  children,
  initialFocusRef,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** A mono line above the title, e.g. "EXAMPLE DATA". */
  eyebrow?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { present, state, onAnimationEnd } = useOverlay({ open, onClose, panelRef, initialFocusRef });

  if (!present || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div
        data-state={state}
        aria-hidden="true"
        onClick={onClose}
        className="motion-scrim absolute inset-0 bg-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-state={state}
        onAnimationEnd={onAnimationEnd}
        className={cx(
          "motion-sheet absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-border-strong bg-surface-1 shadow-overlay outline-none",
          className,
        )}
      >
        <header className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="mono-caps mb-2 text-text-3">{eyebrow}</p>}
            <h2 id={titleId} className="text-[16px] font-semibold leading-[22px] tracking-[-0.005em] text-text">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-[13px] leading-5 text-text-3">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] ease-out hover:bg-surface-2 hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="border-t border-border px-5 py-4 sm:px-6">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
