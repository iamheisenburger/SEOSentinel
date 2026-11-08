"use client";

import type { ReactNode } from "react";

interface StatCardProps {
  icon?: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
}

/** A labelled count. Counts are tabular; the label is a mono caption, never a score. */
export function StatCard({ icon, label, value, subtitle }: StatCardProps) {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5">
      <div className="flex items-center gap-2 text-text-3">
        {icon && <span className="inline-flex [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
        <p className="mono-caps">{label}</p>
      </div>
      <p className="mt-3 text-[28px] font-medium leading-8 tracking-[-0.02em] tabular-nums text-text">{value}</p>
      {subtitle && <p className="mt-2 text-[13px] text-text-3">{subtitle}</p>}
    </div>
  );
}
