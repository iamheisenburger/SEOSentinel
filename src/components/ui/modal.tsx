"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOverlay } from "@/components/ui/overlay";
import { cx } from "@/lib/cx";

/**
 * Modals: at most 520px wide, 14px radius, one soft overlay shadow over a dark scrim. They fade and scale up
 * from .97 (320ms), leave in 200ms, trap focus and close on Escape. Use a Sheet for evidence instead, so the
 * list behind stays in view.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  dismissible = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, clicking the scrim does nothing (use for confirm steps). Escape still closes. */
  dismissible?: boolean;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { present, state, onAnimationEnd } = useOverlay({ open, onClose, panelRef, initialFocusRef });

  if (!present || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        data-state={state}
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
        className="motion-scrim absolute inset-0 bg-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-state={state}
        onAnimationEnd={onAnimationEnd}
        className={cx(
          "motion-modal relative max-h-[calc(100dvh-2rem)] w-full max-w-[520px] overflow-y-auto overscroll-contain rounded-hero bg-surface-1 shadow-overlay outline-none",
          className,
        )}
      >
        {title && (
          <div className="flex items-start gap-4 px-6 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-semibold leading-[22px] tracking-[-0.005em] text-text">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1.5 text-[14px] leading-[22px] text-text-2">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] ease-out hover:bg-surface-2 hover:text-text"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className={cx("px-6 pb-6", title ? "pt-5" : "pt-6")}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
