"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  description?: string;
}

export function Dialog({
  open,
  onClose,
  children,
  title,
  description,
}: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-lg rounded-2xl border border-[#1E293B] bg-[#111827] p-6 shadow-2xl shadow-black/40 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-[#F1F5F9]">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-[#94A3B8]">{description}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
