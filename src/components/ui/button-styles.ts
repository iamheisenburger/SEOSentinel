import { cx } from "@/lib/cx";

/**
 * Buttons. White fill is the one primary action per view; blue is never a button fill.
 * Hover shifts the background (120ms); press scales to .98 (90ms); loading keeps the width fixed.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "destructive-solid"
  /** @deprecated kept for existing screens; renders as "destructive". */
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// Focus: the global :focus-visible ring in design-system.css (2px Signal Blue, 2px offset) follows the 6px radius.
const base =
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none font-semibold tracking-[0.005em] " +
  "rounded-control transition-[background-color,border-color,color,translate,scale,opacity] duration-[var(--d-instant)] ease-out " +
  "active:scale-[0.98] active:duration-[90ms] disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-action text-on-action hover:bg-action-hover hover:-translate-y-px active:bg-action-active",
  secondary: "border border-border-strong bg-transparent text-text hover:bg-surface-2",
  ghost: "bg-transparent text-text-2 hover:bg-surface-2 hover:text-text",
  destructive: "border border-border-strong bg-transparent text-wrong hover:bg-wrong-tint",
  "destructive-solid": "bg-wrong text-on-action hover:brightness-110",
  danger: "border border-border-strong bg-transparent text-wrong hover:bg-wrong-tint",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-4 text-[14px]",
  lg: "h-11 gap-2 px-5 text-[15px]",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cx(base, variants[variant], sizes[size], className);
}
