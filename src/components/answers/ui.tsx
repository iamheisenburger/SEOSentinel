"use client";

import { Component, Fragment, useRef, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { domainWidthEm } from "@/lib/answers/format";
import { cx } from "@/lib/cx";
import { useEdgeFade } from "@/lib/use-edge-fade";

/** Up to ~40 characters a domain stays on one line at 16px or more, even in a phone's 358px column. */
const FIT_MAX_EM = 22;

/**
 * A domain on its own line inside a headline, sized to fit the headline's width whole, so a long address never
 * breaks mid-word ("osterkampfamilydental.co / m"). The size follows the column (container query units on the
 * headline, which carries `@container`) up to the headline's own size; a longer address may wrap, only after a dot.
 */
export function FitDomain({ domain, after = "", className }: { domain: string; after?: string; className?: string }) {
  const em = domainWidthEm(`${domain}${after}`);
  const whole = em <= FIT_MAX_EM;
  return (
    <span
      style={{ "--fit-em": em.toFixed(3) } as CSSProperties}
      className={cx(
        "block font-medium leading-[1.15] tracking-[-0.03em] [--fit-max:32px] md:[--fit-max:40px] xl:[--fit-max:48px] [font-size:clamp(16px,calc(100cqi/var(--fit-em)),var(--fit-max))]",
        whole ? "whitespace-nowrap" : "[overflow-wrap:anywhere]",
        className,
      )}
    >
      {whole ? domain : domain.split(/(?<=\.)/).map((part, i) => <Fragment key={i}>{i > 0 && <wbr />}{part}</Fragment>)}
      {after}
    </span>
  );
}

/**
 * A row of filter chips (a radio group). On a phone it scrolls sideways and fades at the edge that has more chips,
 * so a cut-off chip never looks like a mistake.
 */
export function ChipScroller({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onScroll={fade.onScroll} style={fade.style}
      className={cx("scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1", className)}>
      {children}
    </div>
  );
}

/** A table (or anything wider than a phone) that scrolls sideways, fading at the edge with more to show. */
export function ScrollX({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref);
  return (
    <div ref={ref} onScroll={fade.onScroll} style={fade.style} className={cx("overflow-x-auto", className)}>
      {children}
    </div>
  );
}

/** A titled container for one piece of evidence or one control area (app cards: 10px radius, 20px padding). */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
  as: Tag = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag id={id} className={cx("min-w-0 rounded-card border border-border bg-surface-1", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold leading-5 text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-5 text-text-3">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cx("px-5 pb-5", title || action ? "pt-3" : "pt-5", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/** A count that opens its evidence: tabular, underlined dotted, never just a number. */
export function CountButton({ children, onClick, label, className }: { children: ReactNode; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(
        "rounded-[3px] tabular-nums underline decoration-dotted decoration-text-4 underline-offset-[5px] transition-colors duration-[var(--d-instant)] hover:decoration-text-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** What happened, why if known, and the next action, said in place. */
export function InlineError({ title, children, actions, className }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx("flex gap-3 rounded-card border border-wrong/30 bg-wrong-tint px-4 py-3.5", className)}>
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-wrong" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-[22px] text-text">{title}</p>
        {children && <div className="mt-0.5 text-[13px] leading-5 text-text-2">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A calm notice (not an error): something to know, with an optional action. */
export function Notice({ children, actions, tone = "neutral", className }: { children: ReactNode; actions?: ReactNode; tone?: "neutral" | "you"; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 rounded-card border px-4 py-3.5 sm:flex-row sm:items-center", tone === "you" ? "border-you/30 bg-you-tint" : "border-border bg-surface-2/50", className)}>
      <div className="min-w-0 flex-1 text-[14px] leading-[22px] text-text-2">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A dashboard screen's heading: the title, one mono line of recorded context, and the screen's actions. */
export function ScreenHeader({ title, meta, actions, children }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.015em] text-text [text-wrap:balance]">{title}</h1>
        {meta && <p className="mono-label mt-1.5 text-text-3">{meta}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PanelSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("rounded-card border border-border bg-surface-1 p-5", className)} aria-hidden="true">
      <Skeleton className="h-4 w-32" />
      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cx("h-3", i % 3 === 2 ? "w-2/3" : "w-full")} />)}
      </div>
    </div>
  );
}

/** A quiet dot that says something is happening right now (pulses; static under reduced motion). */
export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("pulse-dot inline-block h-2 w-2 shrink-0 rounded-full bg-you", className)} />;
}

type BoundaryProps = { children: ReactNode; title?: string; onRetry?: () => void; fallbackClassName?: string };
type BoundaryState = { error: Error | null; attempt: number };

/** A screen that couldn't load says so in place, keeps the chrome, and offers to try again. */
export class ScreenErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };
  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Pentra Answers screen failed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
    return (
      <div className={this.props.fallbackClassName}>
      <InlineError
        title={this.props.title ?? "We couldn't load this. Your data is safe."}
        actions={
          <Button variant="secondary" size="sm" icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
            onClick={() => { this.props.onRetry?.(); this.setState((s) => ({ error: null, attempt: s.attempt + 1 })); }}>
            Try again
          </Button>
        }
      >
        The connection dropped or the server didn&apos;t answer. Nothing was lost.
      </InlineError>
      </div>
    );
  }
}
