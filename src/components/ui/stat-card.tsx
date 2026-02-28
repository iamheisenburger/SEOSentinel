"use client";

import type { ReactNode } from "react";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
}

export function StatCard({ icon, label, value, subtitle }: StatCardProps) {
  return (
    <div className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-5 transition-all duration-200 hover:border-white/[0.1] hover:bg-[#111319]">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.08] text-[#0EA5E9]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
            {label}
          </p>
          <p className="text-xl font-bold tracking-tight text-[#EDEEF1]">
            {value}
          </p>
        </div>
      </div>
      {subtitle && (
        <p className="mt-3 text-[11px] text-[#565A6E]">{subtitle}</p>
      )}
    </div>
  );
}
