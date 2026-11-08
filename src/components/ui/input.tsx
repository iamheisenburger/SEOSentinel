"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Text fields: 40px, surface-1, 1px border, 6px radius, 15px text. Focus is a Signal Blue border with a 3px
 * tint ring; an error turns the border red and says what to fix underneath (role="alert").
 */
export const fieldStyles =
  "w-full rounded-control border border-border bg-surface-1 px-3 text-[15px] text-text placeholder:text-text-3 " +
  "outline-none transition-[border-color,box-shadow,background-color] duration-[var(--d-instant)] ease-out " +
  "hover:border-border-strong focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--you-tint)] " +
  "aria-[invalid=true]:border-wrong aria-[invalid=true]:focus:shadow-[0_0_0_3px_var(--wrong-tint)] " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-[13px] leading-5 text-wrong">
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="mt-[3px] h-3.5 w-3.5 shrink-0">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.75v3.75M8 10.9v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

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
          <label htmlFor={inputId} className="text-[13px] font-medium text-text-2">{label}</label>
        )}
        <input ref={ref} id={inputId} className={`${fieldStyles} h-10 ${className}`}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          aria-invalid={invalid ?? (error ? true : undefined)} {...props} />
        {error && <FieldError id={errorId}>{error}</FieldError>}
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
          <label htmlFor={inputId} className="text-[13px] font-medium text-text-2">{label}</label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          aria-invalid={invalid ?? (error ? true : undefined)}
          className={`${fieldStyles} min-h-[88px] resize-y py-2.5 leading-6 ${className}`}
          {...props}
        />
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
