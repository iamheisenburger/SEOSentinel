"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-[#0EA5E9] text-white shadow-lg shadow-[#0EA5E9]/20 hover:bg-[#38BDF8] hover:shadow-[#0EA5E9]/30 active:bg-[#0284C7]",
  secondary:
    "bg-transparent border border-[#1E293B] text-[#F1F5F9] hover:border-[#0EA5E9]/50 hover:text-[#38BDF8] active:bg-[#1E293B]/50",
  danger:
    "bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#EF4444] hover:bg-[#EF4444]/20 hover:border-[#EF4444]/40 active:bg-[#EF4444]/30",
  ghost:
    "bg-transparent text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#1E293B]/50 active:bg-[#1E293B]",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-6 py-2.5 text-base gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      children,
      disabled,
      className = "",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          inline-flex items-center justify-center rounded-lg font-medium
          transition-all duration-150 focus-ring
          disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {loading ? (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
