import { assistantName, type AssistantId } from "@/lib/product-facts";
import { cx } from "@/lib/cx";

/**
 * Simple monochrome marks that identify each assistant next to its name. They are drawn here, not official
 * logo files, and only ever identify the service: never decoration, never a claim of partnership.
 */
function Glyph({ id, size }: { id: AssistantId; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (id) {
    case "chatgpt":
      // Three interlocking loops.
      return (
        <svg {...common} stroke="currentColor" strokeWidth="1.25">
          <ellipse cx="8" cy="8" rx="2.6" ry="5.6" />
          <ellipse cx="8" cy="8" rx="2.6" ry="5.6" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="2.6" ry="5.6" transform="rotate(120 8 8)" />
        </svg>
      );
    case "perplexity":
      // An open book seen end-on: spine, covers and pages.
      return (
        <svg {...common} stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
          <path d="M8 1.75v12.5" />
          <path d="M3 4.5 8 1.75 13 4.5M3 4.5v6.75L8 8.5l5 2.75V4.5M3 4.5l5 4 5-4" />
          <path d="M3 11.25 8 14.25l5-3" />
        </svg>
      );
    case "gemini":
      // A four-point spark.
      return (
        <svg {...common}>
          <path
            d="M8 1.5c.42 3.36 3.14 6.08 6.5 6.5-3.36.42-6.08 3.14-6.5 6.5-.42-3.36-3.14-6.08-6.5-6.5 3.36-.42 6.08-3.14 6.5-6.5Z"
            fill="currentColor"
          />
        </svg>
      );
    case "google-ai-mode":
      // A G drawn as a ring with its crossbar.
      return (
        <svg {...common} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M13.25 6.6A5.5 5.5 0 1 0 13.5 8.6" />
          <path d="M8.25 8h5.25" />
        </svg>
      );
    case "google-ai-overviews":
      // A spark above summary lines.
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M5 1.75c.22 1.66 1.59 3.03 3.25 3.25C6.59 5.22 5.22 6.59 5 8.25 4.78 6.59 3.41 5.22 1.75 5 3.41 4.78 4.78 3.41 5 1.75Z" fill="currentColor" />
          <path d="M10.25 4.5h4M10.25 7.5h4M1.75 11h12.5M1.75 14h8.5" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
  }
}

export function AssistantMark({
  assistant,
  size = "md",
  showLabel = false,
  labelClassName,
  className,
}: {
  assistant: AssistantId;
  /** sm: 20px box, 12px glyph. md: 24px box, 16px glyph. */
  size?: "sm" | "md";
  showLabel?: boolean;
  labelClassName?: string;
  className?: string;
}) {
  const name = assistantName(assistant);
  const box = (
    <span
      role={showLabel ? undefined : "img"}
      aria-label={showLabel ? undefined : name}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-control bg-surface-2 text-text shadow-[inset_0_0_0_1px_var(--border)]",
        size === "sm" ? "h-5 w-5" : "h-6 w-6",
      )}
    >
      <Glyph id={assistant} size={size === "sm" ? 12 : 16} />
    </span>
  );
  if (!showLabel) return <span className={cx("inline-flex", className)}>{box}</span>;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2", className)}>
      {box}
      <span className={cx("truncate text-[14px] font-semibold text-text", labelClassName)}>{name}</span>
    </span>
  );
}
