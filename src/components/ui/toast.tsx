"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-up flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-sm ${
              t.type === "success"
                ? "border-[#22C55E]/20 bg-[#111827]/95 text-[#4ADE80]"
                : t.type === "error"
                  ? "border-[#EF4444]/20 bg-[#111827]/95 text-[#F87171]"
                  : "border-[#0EA5E9]/20 bg-[#111827]/95 text-[#38BDF8]"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : t.type === "error" ? (
              <XCircle className="h-4 w-4 shrink-0" />
            ) : (
              <Info className="h-4 w-4 shrink-0" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
