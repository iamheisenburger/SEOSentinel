"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { cx } from "@/lib/cx";

type ToastType = "success" | "error" | "info";

interface ToastOptions {
  /** An undo (or other) action for reversible changes. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it leaves; errors stay until dismissed unless this is set. */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastOptions["action"];
  closing: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;
const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 200;

/**
 * Toasts: bottom right, surface-2, 10px radius, one overlay shadow, 14px text. They rise 8px in over 320ms and
 * leave after 5s; errors stay until dismissed. Errors are announced assertively, everything else politely.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", options: ToastOptions = {}) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type, action: options.action, closing: false }]);
      const duration = options.duration ?? (type === "error" ? null : AUTO_DISMISS_MS);
      if (duration) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 sm:bottom-6 sm:right-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
            data-state={t.closing ? "closed" : "open"}
            className="motion-toast pointer-events-auto flex items-start gap-3 rounded-card bg-surface-2 py-3 pl-3.5 pr-2 text-[14px] leading-5 text-text shadow-overlay"
          >
            <span className={cx("mt-0.5 shrink-0", t.type === "error" ? "text-wrong" : "text-text-3")} aria-hidden="true">
              {t.type === "success" ? (
                <Check className="h-4 w-4" strokeWidth={1.5} />
              ) : t.type === "error" ? (
                <AlertCircle className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <Info className="h-4 w-4" strokeWidth={1.5} />
              )}
            </span>
            <p className="min-w-0 flex-1 py-px">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded-control px-2 py-0.5 text-[13px] font-semibold text-text transition-colors duration-[var(--d-instant)] hover:bg-surface-3"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-3 hover:text-text"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
