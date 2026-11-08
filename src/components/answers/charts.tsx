"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { assistantLabel, isAssistantId, num, shortDate } from "@/lib/answers/format";
import type { AssistantRow } from "@/lib/answers/derive";
import type { TrendPoint } from "@/lib/answers/types";
import { cx } from "@/lib/cx";

/*
 * Charts follow the dataviz rules: thin marks (8px bars, 2px lines), 4px rounded data ends square at the baseline,
 * solid hairline grid, values in text tokens beside the marks, a hover/focus layer that never gates a value, and a
 * table twin. Signal Blue is the business; competitors are neutral (emphasis: one highlighted, the rest gray).
 */

/* ─── Visibility by assistant ──────────────────────────────────────────── */

/**
 * One row per assistant: "ChatGPT · 4 of 29". The track is the answers it gave, the blue fill the answers naming you,
 * and a thin gray tick the most-named competitor's count when the answer log is loaded. Each row opens its answers.
 */
export function AssistantBars({ rows, onOpen, label = "Answers naming you, by assistant" }: { rows: AssistantRow[]; onOpen?: (assistant: string) => void; label?: string }) {
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.asked, r.answered)));
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => {
        const content = (
          <>
            <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 @[22rem]:w-[150px] @[22rem]:shrink-0">
              {isAssistantId(row.assistant) ? (
                <AssistantMark assistant={row.assistant} size="sm" showLabel labelClassName="truncate text-[13px] font-medium" />
              ) : (
                <span className="truncate text-[13px] font-medium text-text">{assistantLabel(row.assistant)}</span>
              )}
            </span>
            <span className="relative col-span-2 row-start-2 block h-2 min-w-0 flex-1" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-surface-3" style={{ width: `${(row.answered / scale) * 100}%` }} />
              {row.named > 0 && (
                <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-you" style={{ width: `${(row.named / scale) * 100}%` }} />
              )}
              {row.rivalTop && row.rivalTop.named > 0 && (
                <span
                  className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-text-3"
                  style={{ left: `${(row.rivalTop.named / scale) * 100}%` }}
                />
              )}
            </span>
            <span className="col-start-2 row-start-1 shrink-0 text-right text-[13px] tabular-nums text-text-2 @[22rem]:w-[72px]">
              <span className="font-medium text-text">{row.named}</span> of {row.answered}
            </span>
          </>
        );
        const description = `${assistantLabel(row.assistant)}: named you in ${row.named} of ${row.answered} answers${row.asked > row.answered ? ` (${row.asked - row.answered} not answered)` : ""}${row.rivalTop ? `; ${row.rivalTop.name} in ${row.rivalTop.named}` : ""}.`;
        return (
          <li key={row.assistant} className="@container border-b border-border last:border-b-0">
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(row.assistant)}
                aria-label={`${description} Open these answers.`}
                className="-mx-2 grid w-[calc(100%+16px)] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-control px-2 py-3 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-2 @[22rem]:flex"
              >
                {content}
              </button>
            ) : (
              <div aria-label={description} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 @[22rem]:flex">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ─── Named instead: you and the competitors, ranked ───────────────────── */

export function RivalBars({ rows, onOpen }: { rows: { name: string; named: number; you: boolean }[]; onOpen?: (row: { name: string; you: boolean }) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.named));
  return (
    <ol aria-label="Answers naming each business" className="flex flex-col gap-1">
      {rows.map((row) => {
        const inner = (
          <>
            <span className={cx("min-w-0 truncate text-[13px]", row.you ? "font-medium text-text" : "text-text-2")}>
              {row.name}
              {row.you && <span className="ml-1.5 text-text-3">(you)</span>}
            </span>
            <span className="relative block h-2 min-w-0" aria-hidden="true">
              {row.named > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-r-[4px]", row.you ? "bg-you" : "bg-text-4")} style={{ width: `${(row.named / max) * 100}%` }} />}
            </span>
            <span className="w-10 text-right text-[13px] font-medium tabular-nums text-text">{num(row.named)}</span>
          </>
        );
        const className = cx(
          "grid w-full grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded-control px-2.5 py-2 text-left sm:grid-cols-[minmax(0,13rem)_1fr_auto]",
          row.you && "bg-you-tint",
        );
        return (
          <li key={`${row.name}-${row.you}`}>
            {onOpen ? (
              <button type="button" onClick={() => onOpen(row)} aria-label={`${row.name}${row.you ? " (you)" : ""}: named in ${row.named} answers. Open them.`}
                className={cx(className, "transition-colors duration-[var(--d-instant)]", !row.you && "hover:bg-surface-2", row.you && "hover:brightness-125")}>
                {inner}
              </button>
            ) : (
              <div className={className}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Trend ────────────────────────────────────────────────────────────── */

const SERIES_STYLE = [
  { stroke: "var(--you)", width: 2, key: "bg-you" },
  { stroke: "var(--text-2)", width: 1.5, key: "bg-text-2" },
  { stroke: "var(--text-4)", width: 1.5, key: "bg-text-4" },
];

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const step = value <= 20 ? 5 : value <= 50 ? 10 : value <= 100 ? 20 : 50;
  return Math.ceil(value / step) * step;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Named answers per full run, oldest to newest: the business in Signal Blue (2px) and the two most-named competitors
 * of the latest run in gray. A crosshair snaps to the nearest run and lists every series; each run opens its answers.
 */
export function TrendChart({
  points,
  businessName,
  onOpenRun,
  footnote,
}: {
  points: TrendPoint[];
  businessName: string;
  onOpenRun?: (index: number) => void;
  footnote?: ReactNode;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const latest = points[points.length - 1];
  const rivals = useMemo(() => [...(latest?.competitors ?? [])].sort((a, b) => b.named - a.named).slice(0, 2).map((c) => c.name), [latest]);
  const series = useMemo(() => [
    { name: businessName, you: true, values: points.map((p) => p.named) },
    ...rivals.map((name) => ({ name, you: false, values: points.map((p) => p.competitors.find((c) => c.name === name)?.named ?? 0) })),
  ], [points, rivals, businessName]);

  const height = 196;
  const pad = { top: 14, right: 16, bottom: 28, left: 32 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const ticks = [0, yMax / 2, yMax];
  const x = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  // Date labels need about 70px each; on narrow charts every other (or every third) run is labelled.
  const spacing = points.length > 1 ? plotW / (points.length - 1) : plotW;
  const labelEvery = Math.max(1, Math.ceil(70 / Math.max(1, spacing)));

  const nearest = (clientX: number, rect: DOMRect) => {
    if (points.length === 1) return 0;
    const rel = clientX - rect.left - pad.left;
    return Math.max(0, Math.min(points.length - 1, Math.round((rel / Math.max(1, plotW)) * (points.length - 1))));
  };
  const onMove = (event: PointerEvent<SVGSVGElement>) => setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((current) => {
        const from = current ?? points.length - 1;
        return Math.max(0, Math.min(points.length - 1, from + (event.key === "ArrowRight" ? 1 : -1)));
      });
    } else if ((event.key === "Enter" || event.key === " ") && active !== null && onOpenRun) {
      event.preventDefault();
      onOpenRun(active);
    }
  };

  const tip = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 90), Math.max(90, width - 90)) : 0;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-3">
        {series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("h-0.5 w-3.5 rounded-full", SERIES_STYLE[i]!.key)} />
            <span className={s.you ? "text-text-2" : undefined}>{s.you ? `${s.name} (you)` : s.name}</span>
          </span>
        ))}
      </figcaption>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Answers naming ${businessName} per run: ${points.map((p) => `${shortDate(p.at)} ${p.named} of ${p.answered}`).join(", ")}.`}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((current) => current ?? points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKey}
            onClick={() => active !== null && onOpenRun?.(active)}
            className={cx("block rounded-control outline-none focus-visible:ring-2 focus-visible:ring-border-focus/60", onOpenRun && "cursor-pointer")}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-text-4 font-mono text-[11px] tabular-nums">{t}</text>
              </g>
            ))}
            {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (
              <text key={p.at} x={x(i)} y={height - 8} textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                className="fill-text-4 font-mono text-[11px]">{shortDate(p.at)}</text>
            ))}
            {active !== null && (
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
            )}
            {[...series].reverse().map((s) => {
              const i = series.indexOf(s);
              const style = SERIES_STYLE[i]!;
              const d = s.values.map((v, k) => `${k === 0 ? "M" : "L"}${x(k)},${y(v)}`).join(" ");
              return (
                <g key={s.name}>
                  {points.length > 1 && (
                    <path d={d} pathLength={1} fill="none" stroke={style.stroke} strokeWidth={style.width} strokeLinejoin="round" strokeLinecap="round" className="chart-draw" />
                  )}
                  {s.you && s.values.map((v, k) => (
                    <circle key={k} cx={x(k)} cy={y(v)} r={k === active || points.length === 1 ? 5 : 4} fill="var(--you)" stroke="var(--surface-1)" strokeWidth={2} />
                  ))}
                  {!s.you && active !== null && (
                    <circle cx={x(active)} cy={y(s.values[active]!)} r={3.5} fill={style.stroke} stroke="var(--surface-1)" strokeWidth={2} />
                  )}
                </g>
              );
            })}
            {latest && (
              <text x={Math.min(x(points.length - 1) + 10, width - 4)} y={y(series[0]!.values[points.length - 1]!)} dy="-0.9em"
                textAnchor={points.length === 1 ? "start" : "end"} className="fill-text font-mono text-[11px] font-medium tabular-nums">
                {latest.named} of {latest.answered}
              </text>
            )}
          </svg>
        )}
        {tip && active !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 w-[180px] -translate-x-1/2 rounded-control border border-border-strong bg-surface-2 px-3 py-2.5 shadow-overlay"
            style={{ left: tipLeft }}
          >
            <p className="mono-label text-text-3">{shortDate(tip.at)}</p>
            <ul className="mt-1.5 space-y-1">
              {series.map((s, i) => (
                <li key={s.name} className="flex items-center gap-2 text-[12px] leading-4">
                  <span className={cx("h-0.5 w-3 shrink-0 rounded-full", SERIES_STYLE[i]!.key)} />
                  <span className="font-medium tabular-nums text-text">{s.values[active]}{s.you ? ` of ${tip.answered}` : ""}</span>
                  <span className="min-w-0 truncate text-text-3">{s.you ? "you" : s.name}</span>
                </li>
              ))}
            </ul>
            {onOpenRun && <p className="mt-2 text-[11px] text-text-4">Click to open this run&apos;s answers</p>}
          </div>
        )}
      </div>
      {footnote}
      <details className="group text-[13px] text-text-3">
        <summary className="w-fit cursor-pointer list-none rounded-control text-text-3 underline decoration-border-strong underline-offset-2 hover:text-text [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show as a table</span>
          <span className="hidden group-open:inline">Hide the table</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="mono-caps py-2 pr-4 font-normal text-text-3">Run</th>
                <th scope="col" className="mono-caps py-2 pr-4 text-right font-normal text-text-3">You</th>
                {(latest?.competitors ?? []).map((c) => (
                  <th key={c.name} scope="col" className="mono-caps py-2 pr-4 text-right font-normal text-text-3">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.at} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-4 font-mono text-[12px] text-text-2">{shortDate(p.at)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-text">{p.named} of {p.answered}</td>
                  {(latest?.competitors ?? []).map((c) => (
                    <td key={c.name} className="py-2 pr-4 text-right tabular-nums text-text-2">{p.competitors.find((x) => x.name === c.name)?.named ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
