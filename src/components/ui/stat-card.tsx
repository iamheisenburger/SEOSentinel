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
    <div className="group rounded-2xl border border-[#1E293B] bg-[#111827] p-5 transition-all duration-200 hover:border-[#0EA5E9]/30 hover:shadow-lg hover:shadow-[#0EA5E9]/5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0EA5E9]/10 text-[#0EA5E9] transition-colors group-hover:bg-[#0EA5E9]/15">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[#64748B]">
            {label}
          </p>
          <p className="text-2xl font-bold tracking-tight text-[#F1F5F9]">
            {value}
          </p>
        </div>
      </div>
      {subtitle && (
        <p className="mt-3 text-xs text-[#64748B]">{subtitle}</p>
      )}
    </div>
  );
}
