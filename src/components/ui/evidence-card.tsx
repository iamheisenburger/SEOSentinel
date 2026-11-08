"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { StatusPill } from "@/components/ui/status-pill";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { assistantName, ASSISTANTS, type AssistantId } from "@/lib/product-facts";
import { DURATION } from "@/lib/motion";
import { cx } from "@/lib/cx";

/* ─── Data shape: one recorded AI answer ─────────────────────────────────── */

/** Answer text is plain strings plus marked spans: the business, competitors, a wrong fact, a quote, a citation. */
export type Segment =
  | string
  | { you: string }
  | { rival: string }
  | { wrong: string }
  | { quote: string }
  | { cite: number };

export type AnswerBlock = { p: Segment[] } | { ol: Segment[][] } | { ul: Segment[][] };

export type EvidenceOutcome = { kind: "named" | "none" | "wrong" | "cited"; label: string };

export type EvidenceSource = { domain: string; title: string; url?: string; yours?: boolean };

export type EvidenceAnswer = {
  id: string;
  assistant: AssistantId;
  /** As recorded, e.g. "2026-11-06 09:14 UTC". */
  askedAt: string;
  question: string;
  answer: AnswerBlock[];
  outcomes: EvidenceOutcome[];
  sources: EvidenceSource[];
  /** e.g. "US English". */
  locale: string;
  /** Link to the stored full response, when there is one. */
  rawHref?: string;
};

type InkState = "idle" | "play";

/* ─── Answer text ──────────────────────────────────────────────────────── */

function renderSegment(segment: Segment, key: number, ink: InkState): ReactNode {
  if (typeof segment === "string") return segment;
  if ("you" in segment)
    return (
      <mark key={key} className="hl-you" data-ink={ink}>
        {segment.you}
      </mark>
    );
  if ("rival" in segment)
    return (
      <span key={key} className="hl-rival">
        {segment.rival}
      </span>
    );
  if ("wrong" in segment)
    return (
      <span key={key} className="hl-wrong">
        {segment.wrong}
        <span className="sr-only"> (wrong)</span>
      </span>
    );
  if ("quote" in segment)
    return (
      <mark key={key} className="hl-quote">
        {segment.quote}
      </mark>
    );
  return (
    <sup key={key} className="ml-0.5 font-mono text-[10px] leading-none tracking-normal text-text-3">
      [{segment.cite}]
    </sup>
  );
}

function Segments({ segments, ink }: { segments: Segment[]; ink: InkState }) {
  return <>{segments.map((segment, index) => renderSegment(segment, index, ink))}</>;
}

export function AnswerText({
  blocks,
  ink = "idle",
  className,
}: {
  blocks: AnswerBlock[];
  ink?: InkState;
  className?: string;
}) {
  return (
    <div className={cx("space-y-3", className)}>
      {blocks.map((block, index) => {
        if ("p" in block)
          return (
            <p key={index}>
              <Segments segments={block.p} ink={ink} />
            </p>
          );
        const List = "ol" in block ? "ol" : "ul";
        const items = "ol" in block ? block.ol : block.ul;
        return (
          <List key={index} className={cx("space-y-1.5 pl-5", List === "ol" ? "list-decimal" : "list-disc", "marker:text-text-4")}>
            {items.map((item, itemIndex) => (
              <li key={itemIndex} className="pl-1">
                <Segments segments={item} ink={ink} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/* ─── Pieces ───────────────────────────────────────────────────────────── */

/** Favicon fallback: the first letter in a 16px rounded square (no third-party requests). */
export function SourceGlyph({ domain }: { domain: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-surface-3 font-mono text-[9px] font-medium uppercase leading-none text-text-2"
    >
      {domain.replace(/^www\./, "").charAt(0)}
    </span>
  );
}

function SourceRow({ source, linked }: { source: EvidenceSource; linked: boolean }) {
  const content = (
    <>
      <SourceGlyph domain={source.domain} />
      <span className="shrink-0 text-[13px] text-text">{source.domain}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-3">{source.title}</span>
      {source.yours && (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-text-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-named" />
          Your page
        </span>
      )}
    </>
  );
  if (linked && source.url)
    return (
      <li>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group -mx-2 flex h-7 items-center gap-2.5 rounded-control px-2 transition-colors duration-[var(--d-instant)] hover:bg-surface-2"
        >
          {content}
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-4 transition-colors group-hover:text-text-2" strokeWidth={1.5} />
        </a>
      </li>
    );
  return <li className="flex h-7 items-center gap-2.5">{content}</li>;
}

function OutcomePill({ outcome }: { outcome: EvidenceOutcome }) {
  const kind = outcome.kind === "cited" ? "named" : outcome.kind;
  return <StatusPill kind={kind}>{outcome.label}</StatusPill>;
}

/* ─── Clamp with height animation ──────────────────────────────────────── */

function useClamp(lines: number, lineHeight: number, expanded: boolean) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  const collapsed = lines * lineHeight;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setFullHeight(inner.scrollHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const overflows = fullHeight !== null && fullHeight > collapsed + 2;
  const height = fullHeight === null ? undefined : expanded ? fullHeight : Math.min(collapsed, fullHeight);
  return { innerRef, overflows, height, collapsed };
}

/* ─── The card ─────────────────────────────────────────────────────────── */

export function EvidenceCard({
  answer,
  variant = "default",
  sample = false,
  clampLines,
  ink = "idle",
  expanded: controlledExpanded,
  onExpandedChange,
  showSources = true,
  showFooter = true,
  className,
}: {
  answer: EvidenceAnswer;
  /** hero: 14px radius and the hero shadow. default: in-app, 10px. compact: lists and emails. */
  variant?: "hero" | "default" | "compact";
  /** Sample data: sources are not links and the footer describes the method instead of a recording. */
  sample?: boolean;
  clampLines?: number;
  ink?: InkState;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  showSources?: boolean;
  showFooter?: boolean;
  className?: string;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = (value: boolean) => {
    if (controlledExpanded === undefined) setInternalExpanded(value);
    onExpandedChange?.(value);
  };
  const compact = variant === "compact";
  const lines = clampLines ?? (compact ? 3 : variant === "hero" ? 5 : 6);
  const lineHeight = compact ? 22 : 24;
  const { innerRef, overflows, height, collapsed } = useClamp(lines, lineHeight, expanded);
  const answerId = useId();

  return (
    <article
      aria-label={`${assistantName(answer.assistant)} answer${sample ? " (example)" : ""}`}
      className={cx(
        "flex flex-col border border-border bg-surface-1 text-left",
        variant === "hero" ? "rounded-hero p-5 shadow-hero sm:p-6" : "rounded-card",
        variant === "default" && "p-5",
        compact && "p-4",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <AssistantMark assistant={answer.assistant} showLabel size={compact ? "sm" : "md"} labelClassName={compact ? "text-[13px]" : undefined} />
        <div className="flex shrink-0 items-center gap-3">
          <time className="mono-label text-text-3">{answer.askedAt}</time>
          {answer.rawHref && !sample && (
            <a href={answer.rawHref} className="mono-label text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">
              Raw
            </a>
          )}
        </div>
      </header>

      <div className={compact ? "mt-3" : "mt-5"}>
        {!compact && <p className="mono-caps text-text-3">Question</p>}
        <p className={cx("text-text", compact ? "text-[14px] font-medium leading-[21px]" : "mt-1.5 text-[16px] font-medium leading-6 tracking-[-0.005em]")}>
          {answer.question}
        </p>
      </div>

      <div className={compact ? "mt-2" : "mt-4"}>
        <div
          id={answerId}
          className={cx(
            "overflow-hidden transition-[height] duration-[var(--d-enter)] ease-in-out",
            overflows && !expanded && "[mask-image:linear-gradient(to_bottom,#000_calc(100%-22px),transparent)]",
          )}
          style={{ height, maxHeight: height === undefined ? collapsed : undefined }}
        >
          <div ref={innerRef}>
            <AnswerText
              blocks={answer.answer}
              ink={ink}
              className={cx("text-text-2", compact ? "text-[14px] leading-[22px]" : "text-[15px] leading-6")}
            />
          </div>
        </div>
        {!compact && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={answerId}
            onClick={() => setExpanded(!expanded)}
            tabIndex={overflows ? 0 : -1}
            aria-hidden={!overflows || undefined}
            className={cx(
              "mt-2 inline-flex h-6 items-center gap-1 rounded-control text-[13px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:text-text",
              !overflows && "invisible",
            )}
          >
            {expanded ? "Show less" : "Show full answer"}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {answer.outcomes.map((outcome) => (
          <OutcomePill key={outcome.label} outcome={outcome} />
        ))}
      </div>

      {/* Sources and footer sit at the bottom, so cards of different lengths line up when they crossfade. */}
      <div aria-hidden="true" className="flex-1" />

      {showSources && answer.sources.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mono-caps text-text-3">
            Cited sources · <span className="tabular-nums">{answer.sources.length}</span>
          </p>
          <ul className="mt-2">
            {answer.sources.map((source) => (
              <SourceRow key={`${source.domain}-${source.title}`} source={source} linked={!sample} />
            ))}
          </ul>
        </div>
      )}

      {showFooter && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3.5 text-[12px] leading-5 text-text-3">
          <span>
            {sample ? "Pentra asks from a fresh session with web search" : "Asked by Pentra from a fresh session"} · {answer.locale}
          </span>
          <Link href="/method" className="inline-flex items-center gap-1 text-text-3 transition-colors hover:text-text">
            How we measure
            <ArrowRight aria-hidden="true" className="h-3 w-3" strokeWidth={1.5} />
          </Link>
        </footer>
      )}
    </article>
  );
}

/* ─── The hero: five assistants, one question ─────────────────────────── */

/**
 * Cycles through the assistants every 6s with a 400ms crossfade. It pauses on hover, on focus, while an answer
 * is expanded, while the tab is hidden or the card is off screen, and stops for good once someone picks an
 * assistant. The pause button is always there; under reduced motion nothing moves on its own.
 */
export function EvidenceCarousel({
  answers,
  label,
  caption,
  interval = DURATION.cycle,
  className,
}: {
  answers: EvidenceAnswer[];
  label: ReactNode;
  caption?: ReactNode;
  interval?: number;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const [userPicked, setUserPicked] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const rotating = !reducedMotion && !userPicked && !userPaused;
  const paused = !rotating || hovered || focused || hidden || offscreen || expandedId !== null;

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry?.isIntersecting), { threshold: 0.25 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const show = useCallback((index: number) => {
    setActive(index);
    setExpandedId(null);
    setSeen((current) => (current.has(index) ? current : new Set(current).add(index)));
  }, []);

  const advance = useCallback(() => show((active + 1) % answers.length), [active, answers.length, show]);

  function pick(index: number) {
    setUserPicked(true);
    show(index);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next = -1;
    if (event.key === "ArrowRight") next = (active + 1) % answers.length;
    else if (event.key === "ArrowLeft") next = (active - 1 + answers.length) % answers.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = answers.length - 1;
    if (next < 0) return;
    event.preventDefault();
    pick(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={cx("w-full", className)}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label="Example AI answers"
    >
      {/* Fixed height, so the row doesn't move when the pause control goes away. */}
      <div className="mb-3 flex h-7 items-center justify-between gap-3">
        <p className="mono-caps text-text-3">{label}</p>
        {!reducedMotion && !userPicked && (
          <button
            type="button"
            onClick={() => setUserPaused((value) => !value)}
            aria-label={userPaused ? "Play the examples" : "Pause the examples"}
            className="inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-[12px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-2 hover:text-text"
          >
            {userPaused ? <Play aria-hidden="true" className="h-3 w-3" strokeWidth={1.5} /> : <Pause aria-hidden="true" className="h-3 w-3" strokeWidth={1.5} />}
            <span>{userPaused ? "Play" : "Pause"}</span>
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Assistant" onKeyDown={onTabKeyDown} className="scrollbar-none mb-3 flex gap-1 overflow-x-auto">
        {answers.map((answer, index) => {
          const selected = index === active;
          const short = ASSISTANTS.find((assistant) => assistant.id === answer.assistant)?.short ?? answer.assistant;
          return (
            <button
              key={answer.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-controls={`${baseId}-panel-${index}`}
              aria-selected={selected}
              aria-label={assistantName(answer.assistant)}
              tabIndex={selected ? 0 : -1}
              onClick={() => pick(index)}
              className={cx(
                "relative inline-flex h-9 min-w-9 flex-1 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-control border px-2 text-[13px] font-medium tracking-[0.01em] sm:flex-none sm:px-2.5 lg:gap-1.5 lg:px-2 xl:gap-2 xl:px-2.5",
                "transition-[background-color,border-color,color] duration-[var(--d-state)] ease-in-out",
                selected ? "border-border-strong bg-surface-2 text-text" : "border-transparent text-text-3 hover:bg-surface-1 hover:text-text-2",
              )}
            >
              <AssistantMark assistant={answer.assistant} size="sm" />
              <span className="hidden sm:inline">{short}</span>
              {selected && rotating && (
                <span
                  key={`progress-${index}`}
                  aria-hidden="true"
                  onAnimationEnd={advance}
                  className="absolute inset-x-0 bottom-0 h-px origin-left bg-text-2"
                  style={{
                    animation: `progress-fill ${interval}ms linear both`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1" aria-live={rotating && !paused ? "off" : "polite"}>
        {answers.map((answer, index) => {
          const selected = index === active;
          return (
            <div
              key={answer.id}
              id={`${baseId}-panel-${index}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${index}`}
              aria-hidden={!selected}
              inert={!selected}
              className={cx(
                "col-start-1 row-start-1 min-w-0 transition-[opacity,visibility] duration-[400ms] ease-in-out",
                selected ? "visible opacity-100" : "invisible opacity-0",
              )}
            >
              <EvidenceCard
                answer={answer}
                variant="hero"
                sample
                ink={seen.has(index) ? "play" : "idle"}
                expanded={expandedId === answer.id}
                onExpandedChange={(value) => setExpandedId(value ? answer.id : null)}
                className="h-full"
              />
            </div>
          );
        })}
      </div>

      {caption && <p className="mt-3 text-[13px] leading-5 text-text-3">{caption}</p>}
    </div>
  );
}
