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
    "bg-[#F7F8F8] text-[#08090A] hover:bg-white active:bg-[#E4E5E7]",
  secondary:
    "bg-transparent border border-white/[0.1] text-[#F7F8F8] hover:border-white/[0.18] hover:bg-white/[0.04] active:bg-white/[0.07]",
  danger:
    "bg-[#EF4444]/[0.08] border border-[#EF4444]/[0.15] text-[#F87171] hover:bg-[#EF4444]/[0.12] hover:border-[#EF4444]/[0.25] active:bg-[#EF4444]/[0.18]",
  ghost:
    "bg-transparent text-[#8A8F98] hover:text-[#F7F8F8] hover:bg-white/[0.04] active:bg-white/[0.06]",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[12px] gap-1.5 rounded-lg",
  md: "px-4 py-2 text-[13px] gap-2 rounded-lg",
  lg: "px-5 py-2.5 text-[14px] gap-2 rounded-lg",
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
          inline-flex items-center justify-center font-medium
          transition-all duration-150 focus-ring
          disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {loading ? (
          <svg
            className="h-3.5 w-3.5 animate-spin"
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
