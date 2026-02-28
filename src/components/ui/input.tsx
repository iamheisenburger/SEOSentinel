"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const baseStyles =
  "w-full rounded-lg border border-[#1E293B] bg-[#0B1120] px-3.5 py-2.5 text-sm text-[#F1F5F9] placeholder-[#64748B] outline-none transition-all duration-150 focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 hover:border-[#334155] disabled:opacity-50 disabled:cursor-not-allowed";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-[#94A3B8]">{label}</label>
        )}
        <input ref={ref} className={`${baseStyles} ${className}`} {...props} />
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
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
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-[#94A3B8]">{label}</label>
        )}
        <textarea
          ref={ref}
          className={`${baseStyles} min-h-[80px] resize-y ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
