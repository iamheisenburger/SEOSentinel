"use client";

import Link from "next/link";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";

import { buttonStyles, type ButtonSize, type ButtonVariant } from "@/components/ui/button-styles";
import { cx } from "@/lib/cx";

export { buttonStyles, type ButtonSize, type ButtonVariant };

export function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cx("h-3 w-3 animate-spin", className)}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Label and loading label share one grid cell, so the button keeps the width of the wider of the two
 * and nothing next to it moves when it starts loading.
 */
function ButtonContent({
  loading,
  loadingLabel,
  icon,
  iconRight,
  children,
}: {
  loading?: boolean;
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
}) {
  if (loadingLabel === undefined) {
    return (
      <>
        {loading ? <Spinner /> : icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
        {children}
        {iconRight ? <span className="inline-flex shrink-0">{iconRight}</span> : null}
      </>
    );
  }
  return (
    <span className="grid">
      <span
        className={cx("col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]", loading && "invisible")}
        aria-hidden={loading || undefined}
      >
        {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
        {children}
        {iconRight ? <span className="inline-flex shrink-0">{iconRight}</span> : null}
      </span>
      <span
        className={cx("col-start-1 row-start-1 inline-flex items-center justify-center gap-2", !loading && "invisible")}
        aria-hidden={!loading || undefined}
      >
        <Spinner />
        {loadingLabel}
      </span>
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Shown with a spinner while loading, e.g. "Checking…". The button keeps its width. */
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel,
    icon,
    iconRight,
    children,
    disabled,
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      <ButtonContent loading={loading} loadingLabel={loadingLabel} icon={icon} iconRight={iconRight}>
        {children}
      </ButtonContent>
    </button>
  );
});

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

/** A link that looks like a button (navigation stays a real link: Cmd+click, middle-click and prefetch work). */
export function ButtonLink({ variant = "primary", size = "md", className, icon, iconRight, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonStyles({ variant, size, className })} {...props}>
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {children}
      {iconRight ? <span className="inline-flex shrink-0">{iconRight}</span> : null}
    </Link>
  );
}

/** Same as ButtonLink for in-page anchors and external URLs. */
export function ButtonAnchor({
  variant = "primary",
  size = "md",
  className,
  icon,
  iconRight,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
}) {
  return (
    <a className={buttonStyles({ variant, size, className })} {...props}>
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {children}
      {iconRight ? <span className="inline-flex shrink-0">{iconRight}</span> : null}
    </a>
  );
}
