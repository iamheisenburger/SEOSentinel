import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Status pills: 20px, pill radius, 12px/500, a tint background with a solid 6px dot and a --text label.
 * Green, amber and red appear here only as evidence outcomes: named you, a competitor named, a wrong fact.
 */
export type PillKind =
  | "named"
  | "rival"
  | "none"
  | "wrong"
  | "published"
  | "draft"
  | "indexing"
  | "failed"
  | "neutral";

const kinds: Record<PillKind, { bg: string; dot: string; pulse?: boolean }> = {
  named: { bg: "bg-named-tint", dot: "bg-named" },
  rival: { bg: "bg-rival-tint", dot: "bg-rival" },
  none: { bg: "bg-surface-3", dot: "bg-text-4" },
  wrong: { bg: "bg-wrong-tint", dot: "bg-wrong" },
  published: { bg: "bg-named-tint", dot: "bg-named" },
  draft: { bg: "bg-surface-3", dot: "bg-text-4" },
  indexing: { bg: "bg-you-tint", dot: "bg-you", pulse: true },
  failed: { bg: "bg-wrong-tint", dot: "bg-wrong" },
  neutral: { bg: "bg-surface-3", dot: "bg-text-3" },
};

export function StatusPill({
  kind,
  children,
  className,
}: {
  kind: PillKind;
  children: ReactNode;
  className?: string;
}) {
  const style = kinds[kind];
  return (
    <span
      className={cx(
        "inline-flex h-5 max-w-full items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[12px] font-medium leading-none tracking-[0.01em]",
        style.bg,
        kind === "none" || kind === "draft" ? "text-text-2" : "text-text",
        className,
      )}
    >
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, style.pulse && "pulse-dot")} />
      <span className="truncate">{children}</span>
    </span>
  );
}
