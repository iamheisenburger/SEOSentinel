"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const baseStyles =
  "w-full rounded-lg border border-white/[0.06] bg-[#0E0F11] px-3 py-2 text-[13px] text-[#F7F8F8] placeholder-[#62666D] outline-none transition-all duration-150 focus:border-[#0EA5E9]/50 focus:ring-1 focus:ring-[#0EA5E9]/20 hover:border-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, "aria-describedby": describedBy,
    "aria-invalid": invalid, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${generatedId}-error`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-[12px] font-medium text-[#8A8F98]">{label}</label>
        )}
        <input ref={ref} id={inputId} className={`${baseStyles} ${className}`}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          aria-invalid={invalid ?? (error ? true : undefined)} {...props} />
        {error && <p id={errorId} className="text-[11px] text-[#EF4444]">{error}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = "", id, "aria-describedby": describedBy,
    "aria-invalid": invalid, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${generatedId}-error`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-[12px] font-medium text-[#8A8F98]">{label}</label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          aria-invalid={invalid ?? (error ? true : undefined)}
          className={`${baseStyles} min-h-[80px] resize-y ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="text-[11px] text-[#EF4444]">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
