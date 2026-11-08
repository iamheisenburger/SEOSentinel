import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Cards hold something you interact with or evidence you read, nothing else: surface-1, a 1px border,
 * 10px radius, no shadow. Marketing feature copy is never carded.
 */
export function Card({
  as: Tag = "div",
  padding = "md",
  interactive = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li" | "figure" | "aside";
  padding?: "none" | "sm" | "md" | "lg";
  /** Clickable cards rise 2px and their border brightens on hover. */
  interactive?: boolean;
  children?: ReactNode;
}) {
  return (
    <Tag
      className={cx(
        "rounded-card border border-border bg-surface-1",
        padding === "sm" && "p-4",
        padding === "md" && "p-5",
        padding === "lg" && "p-6",
        interactive && "lift cursor-pointer",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
